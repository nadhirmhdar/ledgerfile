import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { safeName, uniquePath, zipChunks, zipStream, ZIP_MAX_ENTRIES, ZipLimitError, type ZipEntry } from "../src/server/zip";
import { readZip } from "./read-zip";

async function* of(entries: ZipEntry[]) {
  for (const e of entries) yield e;
}
const collect = async (entries: ZipEntry[], at?: Date) => {
  const parts: Uint8Array[] = [];
  for await (const c of zipChunks(of(entries), at)) parts.push(c);
  return Buffer.concat(parts);
};
const bytes = (s: string) => new Uint8Array(Buffer.from(s, "utf8"));

describe("the zip writer", () => {
  it("writes a known small archive: local headers, stored data, CRC and sizes, the central directory and its end record", async () => {
    const zip = await collect([{ name: "a.txt", data: bytes("hello") }], new Date("2026-01-02T03:04:06Z"));
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt16LE(6)).toBe(0x0800); // UTF-8 names
    expect(zip.readUInt16LE(8)).toBe(0); // stored
    expect(zip.readUInt16LE(10)).toBe((3 << 11) | (4 << 5) | 3);
    expect(zip.readUInt16LE(12)).toBe(((2026 - 1980) << 9) | (1 << 5) | 2);
    expect(zip.readUInt32LE(14)).toBe(0x3610a686); // CRC-32 of "hello"
    expect(zip.readUInt32LE(18)).toBe(5);
    expect(zip.readUInt32LE(22)).toBe(5);
    expect(zip.subarray(30, 35).toString()).toBe("a.txt");
    expect(zip.subarray(35, 40).toString()).toBe("hello");
    const end = zip.subarray(zip.length - 22);
    expect(end.readUInt32LE(0)).toBe(0x06054b50);
    expect(end.readUInt16LE(10)).toBe(1);
    expect(zip.readUInt32LE(end.readUInt32LE(16))).toBe(0x02014b50);
  });

  it("reads back byte for byte, with spaces and non-ASCII names, empty and binary entries", async () => {
    const binary = new Uint8Array(70_000).map((_, i) => (i * 31) % 256);
    const entries = [
      { name: "02 Letters/A letter with spaces.docx", data: bytes("x") },
      { name: "Café résumé – €.txt", data: bytes("accents") },
      { name: "empty.bin", data: new Uint8Array() },
      { name: "06 Working papers/C5 Receivables/binary.bin", data: binary },
    ];
    const read = readZip(await collect(entries));
    expect(read.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    read.forEach((e, i) => {
      expect(Buffer.from(e.data).equals(Buffer.from(entries[i].data)), e.name).toBe(true);
      expect(e.crc).toBe(crc32(entries[i].data) >>> 0);
      expect(e.utf8).toBe(true);
      expect(e.size).toBe(entries[i].data.length);
    });
  });

  it("is an empty but valid archive with no entries, and streams one entry at a time", async () => {
    expect((await collect([])).length).toBe(22);
    let asked = 0;
    async function* source() {
      for (let i = 0; i < 3; i++) {
        asked++;
        yield { name: `f${i}`, data: bytes("data") };
      }
    }
    const reader = zipStream(source()).getReader();
    await reader.read();
    // Only the first entry has been asked for (a stream may read one ahead).
    expect(asked).toBeLessThanOrEqual(2);
    await reader.cancel();
    expect(asked).toBeLessThan(3);
  });

  it("refuses past the classic limits rather than write a broken file", async () => {
    async function* many() {
      for (let i = 0; i <= ZIP_MAX_ENTRIES; i++) yield { name: `f${i}`, data: new Uint8Array() };
    }
    await expect(
      (async () => {
        for await (const _ of zipChunks(many())) void _;
      })(),
    ).rejects.toThrow(ZipLimitError);
  });
});

describe("names", () => {
  it("never hold a path separator, '..' or a control character, and are never empty or overlong", () => {
    for (const bad of ["../../etc/passwd", "a/b\\c", "..", "...", "  ", "x\u0000y", 'a:b*c?"<>|', "name..ext"]) {
      const n = safeName(bad);
      expect(n, bad).not.toMatch(/[/\\\u0000-\u001f]|\.\./);
      expect(n.length, bad).toBeGreaterThan(0);
    }
    expect(safeName("a/b\\c")).toBe("a b c");
    expect(safeName("..")).toBe("file");
    expect(safeName(`${"x".repeat(300)}.pdf`)).toMatch(/x\.pdf$/);
    expect(safeName(`${"x".repeat(300)}.pdf`).length).toBeLessThanOrEqual(150);
    expect(safeName("Bank statement 2025.pdf")).toBe("Bank statement 2025.pdf");
  });

  it("make duplicates ' (2)', ' (3)', ignoring case, before the extension", () => {
    const taken = new Set<string>();
    expect(uniquePath("d/report.pdf", taken)).toBe("d/report.pdf");
    expect(uniquePath("d/report.pdf", taken)).toBe("d/report (2).pdf");
    expect(uniquePath("d/REPORT.pdf", taken)).toBe("d/REPORT (3).pdf");
    expect(uniquePath("other/report.pdf", taken)).toBe("other/report.pdf");
    expect(uniquePath("noext", taken)).toBe("noext");
    expect(uniquePath("noext", taken)).toBe("noext (2)");
  });
});
