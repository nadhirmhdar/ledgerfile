import { createInflateRaw } from "node:zlib";

/**
 * How many rows a spreadsheet holds, found WITHOUT loading it. The Excel reader keeps the whole workbook in memory, so a large workbook must be refused
 * before it is opened: this reads each worksheet's XML as a stream (inflating a piece at a time) and counts its rows, stopping as soon as the limit is
 * passed. For a CSV it counts lines. A rough count that never understates: a quoted newline in a CSV counts as a line.
 */

const MAX_UNCOMPRESSED = 1024 * 1024 * 1024;
const UNREADABLE = "The file could not be read as an Excel workbook.";

interface Entry {
  name: string;
  method: number;
  compressed: number;
  offset: number;
}

function entries(zip: Buffer): Entry[] {
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error(UNREADABLE);
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const out: Entry[] = [];
  for (let i = 0; i < count; i++) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== 0x02014b50) throw new Error(UNREADABLE);
    const nameLength = zip.readUInt16LE(at + 28);
    out.push({ name: zip.subarray(at + 46, at + 46 + nameLength).toString("utf8"), method: zip.readUInt16LE(at + 10), compressed: zip.readUInt32LE(at + 20), offset: zip.readUInt32LE(at + 42) });
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return out;
}

const ROW_TAG = /<(?:[A-Za-z]+:)?row[\s>/]/g;

/** Count `<row` tags in one stored or deflated entry, a chunk at a time. Stops early once `stopAfter` is passed. */
async function countEntryRows(zip: Buffer, e: Entry, stopAfter: number): Promise<number> {
  const local = e.offset;
  if (local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) throw new Error(UNREADABLE);
  const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
  const data = zip.subarray(start, start + e.compressed);
  let rows = 0;
  let seen = 0;
  let tail = "";
  const take = (chunk: Buffer): boolean => {
    seen += chunk.length;
    if (seen > MAX_UNCOMPRESSED) throw new Error("The workbook is too large when unpacked.");
    const text = tail + chunk.toString("latin1");
    // Keep the last few characters so a tag split between chunks is counted once.
    const keep = Math.max(0, text.length - 24);
    ROW_TAG.lastIndex = 0;
    for (let m = ROW_TAG.exec(text); m; m = ROW_TAG.exec(text)) if (m.index < keep) rows++;
    tail = text.slice(keep);
    return rows > stopAfter;
  };
  const finish = () => {
    ROW_TAG.lastIndex = 0;
    rows += (tail.match(ROW_TAG) ?? []).length;
    return rows;
  };
  if (e.method === 0) {
    for (let i = 0; i < data.length; i += 65536) if (take(data.subarray(i, i + 65536))) return rows;
    return finish();
  }
  if (e.method !== 8) throw new Error(UNREADABLE);
  const inflate = createInflateRaw();
  const done = new Promise<number>((resolve, reject) => {
    inflate.on("data", (chunk: Buffer) => {
      try {
        if (take(chunk)) {
          inflate.destroy();
          resolve(rows);
        }
      } catch (error) {
        inflate.destroy();
        reject(error);
      }
    });
    inflate.on("end", () => resolve(finish()));
    inflate.on("error", () => reject(new Error(UNREADABLE)));
  });
  // Fed in pieces so the decompressor never holds the whole sheet.
  (async () => {
    for (let i = 0; i < data.length && !inflate.destroyed; i += 65536) {
      if (!inflate.write(data.subarray(i, i + 65536))) await new Promise<void>((r) => (inflate.once("drain", r), inflate.once("close", r)));
    }
    if (!inflate.destroyed) inflate.end();
  })().catch(() => inflate.destroy());
  return done;
}

/** Rows in the largest worksheet of an .xlsx, or lines in a .csv; counting stops once past `stopAfter`. Anything else counts as 0 (the reader refuses it). */
export async function countRows(fileName: string, data: Uint8Array, stopAfter: number): Promise<number> {
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) {
    let lines = 0;
    for (let i = buffer.indexOf(10); i >= 0 && lines <= stopAfter; i = buffer.indexOf(10, i + 1)) lines++;
    return buffer.length > 0 && buffer[buffer.length - 1] !== 10 ? lines + 1 : lines;
  }
  if (!lower.endsWith(".xlsx")) return 0;
  const sheets = entries(buffer).filter((e) => /^xl\/worksheets\/[^/]+\.xml$/.test(e.name));
  let largest = 0;
  for (const sheet of sheets) {
    largest = Math.max(largest, await countEntryRows(buffer, sheet, stopAfter));
    if (largest > stopAfter) break;
  }
  return largest;
}
