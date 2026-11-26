/**
 * Our ordering against Unicode's own conformance data: a subset of BidiCharacterTest.txt, Unicode 17.0.0. The fixture's header says where
 * it came from and how its lines were selected. Each line is: code points; paragraph direction (0 left-to-right, 1 right-to-left, 2 from the
 * first strong character); resolved paragraph level; the level of each character ("x" for a removed one); the order as seen.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveLevels, visualOrder } from "../src/domain/bidi";

const text = readFileSync("tests/fixtures/BidiCharacterTest-17.0.0-subset.txt", "utf8");
const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
const codesOf = (line: string) => line.split(";")[0].split(" ").map((h) => parseInt(h, 16));

describe("Unicode's bidirectional character tests (subset)", () => {
  it("keeps the Unicode notice and says which version it is", () => {
    expect(text).toContain("# BidiCharacterTest-17.0.0.txt");
    expect(text).toContain("© 2025 Unicode®, Inc.");
    expect(text).toContain("https://www.unicode.org/terms_of_use.html");
    expect(text).toContain("https://www.unicode.org/Public/17.0.0/ucd/BidiCharacterTest.txt");
  });

  it("holds only lines within what our ordering covers", () => {
    expect(lines.length).toBe(2036);
    for (const line of lines) {
      for (const c of codesOf(line)) {
        expect(c >= 0x202a && c <= 0x202e, line).toBe(false);
        expect(c >= 0x2066 && c <= 0x2069, line).toBe(false);
        if (/[\p{Ps}\p{Pe}]/u.test(String.fromCodePoint(c))) expect([0x28, 0x29, 0x5b, 0x5d], line).toContain(c);
      }
    }
  });

  it("passes every line: paragraph direction, levels and visual order", () => {
    const failures: string[] = [];
    for (const line of lines) {
      const [, direction, paragraph, levels, order] = line.split(";");
      const result = resolveLevels(String.fromCodePoint(...codesOf(line)), direction === "0" ? "ltr" : direction === "1" ? "rtl" : undefined);
      const got = [result.direction === "rtl" ? "1" : "0", result.levels.map((l) => (l === null ? "x" : String(l))).join(" "), visualOrder(result.levels).join(" ")];
      if (got.join(";") !== [paragraph, levels, order].join(";")) failures.push(line);
    }
    expect(failures).toEqual([]);
  });
});
