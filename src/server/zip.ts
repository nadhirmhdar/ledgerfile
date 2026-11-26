import { crc32 } from "node:zlib";

/**
 * A small zip writer: STORE only (no compression), one entry at a time, produced as a stream so the whole archive is never held in memory. It writes
 * the classic format only (no ZIP64): at most 65,535 entries, and every size and offset below 4 GiB; past a limit it fails with a message rather than
 * write a broken file. File names are UTF-8, flagged as such (general purpose bit 11).
 */

export interface ZipEntry {
  /** Path inside the archive, with "/" between folders. */
  name: string;
  data: Uint8Array;
}

export const ZIP_MAX_ENTRIES = 0xffff;
export const ZIP_MAX_BYTES = 0xffffffff;
export const ZIP_LIMIT_MESSAGE = "The file is too large for one download: a zip of this kind holds under 4 GB and 65,535 files.";

export class ZipLimitError extends Error {
  constructor() {
    super(ZIP_LIMIT_MESSAGE);
  }
}

const UTF8_FLAG = 0x0800;
const VERSION = 20; // 2.0: the classic format

/** The DOS date and time of a moment, as zip records it (UTC, to two seconds; years before 1980 are written as 1980). */
function dosDateTime(at: Date): { date: number; time: number } {
  const year = Math.max(at.getUTCFullYear(), 1980);
  return {
    date: ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
    time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | Math.floor(at.getUTCSeconds() / 2),
  };
}

interface Central {
  name: Buffer;
  crc: number;
  size: number;
  offset: number;
}

function localHeader(c: Central, stamp: { date: number; time: number }): Buffer {
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(VERSION, 4);
  h.writeUInt16LE(UTF8_FLAG, 6);
  h.writeUInt16LE(0, 8); // stored
  h.writeUInt16LE(stamp.time, 10);
  h.writeUInt16LE(stamp.date, 12);
  h.writeUInt32LE(c.crc, 14);
  h.writeUInt32LE(c.size, 18);
  h.writeUInt32LE(c.size, 22);
  h.writeUInt16LE(c.name.length, 26);
  h.writeUInt16LE(0, 28);
  return Buffer.concat([h, c.name]);
}

function centralHeader(c: Central, stamp: { date: number; time: number }): Buffer {
  const h = Buffer.alloc(46);
  h.writeUInt32LE(0x02014b50, 0);
  h.writeUInt16LE(VERSION, 4);
  h.writeUInt16LE(VERSION, 6);
  h.writeUInt16LE(UTF8_FLAG, 8);
  h.writeUInt16LE(0, 10);
  h.writeUInt16LE(stamp.time, 12);
  h.writeUInt16LE(stamp.date, 14);
  h.writeUInt32LE(c.crc, 16);
  h.writeUInt32LE(c.size, 20);
  h.writeUInt32LE(c.size, 24);
  h.writeUInt16LE(c.name.length, 28);
  // extra, comment, disk, internal and external attributes: none
  h.writeUInt32LE(c.offset, 42);
  return Buffer.concat([h, c.name]);
}

function endOfCentral(entries: number, size: number, offset: number): Buffer {
  const h = Buffer.alloc(22);
  h.writeUInt32LE(0x06054b50, 0);
  h.writeUInt16LE(entries, 8);
  h.writeUInt16LE(entries, 10);
  h.writeUInt32LE(size, 12);
  h.writeUInt32LE(offset, 16);
  return h;
}

/** The archive as chunks, taking one entry at a time from the source. */
export async function* zipChunks(source: AsyncIterable<ZipEntry>, at: Date = new Date()): AsyncGenerator<Uint8Array> {
  const stamp = dosDateTime(at);
  const done: Central[] = [];
  let offset = 0;
  for await (const entry of source) {
    const name = Buffer.from(entry.name, "utf8");
    if (done.length >= ZIP_MAX_ENTRIES || entry.data.length > ZIP_MAX_BYTES || name.length > 0xffff) throw new ZipLimitError();
    const c: Central = { name, crc: crc32(entry.data) >>> 0, size: entry.data.length, offset };
    const header = localHeader(c, stamp);
    offset += header.length + entry.data.length;
    if (offset > ZIP_MAX_BYTES) throw new ZipLimitError();
    done.push(c);
    yield header;
    if (entry.data.length > 0) yield entry.data;
  }
  const central = Buffer.concat(done.map((c) => centralHeader(c, stamp)));
  if (offset + central.length > ZIP_MAX_BYTES) throw new ZipLimitError();
  yield central;
  yield endOfCentral(done.length, central.length, offset);
}

/** The archive as a web stream: the source is asked for the next entry only when the response is ready for more. */
export function zipStream(source: AsyncIterable<ZipEntry>, at: Date = new Date()): ReadableStream<Uint8Array> {
  const chunks = zipChunks(source, at);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await chunks.next();
      if (next.done) controller.close();
      else controller.enqueue(new Uint8Array(next.value));
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
}

/** One folder or file name safe for any system: no path separator, no "..", no control or reserved character, never empty, not overlong. */
export function safeName(name: string, fallback = "file"): string {
  let n = name.normalize("NFC").replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, " ").replace(/\.{2,}/g, ".").replace(/\s+/g, " ").trim();
  n = n.replace(/^[. ]+|[. ]+$/g, "");
  if (n.length > 150) {
    const dot = n.lastIndexOf(".");
    const ext = dot > 0 && n.length - dot <= 12 ? n.slice(dot) : "";
    n = `${n.slice(0, 150 - ext.length).trim()}${ext}`;
  }
  return n === "" ? fallback : n;
}

/** The same path with " (2)", " (3)" and so on before the extension when it is already taken (names compared without case, as Windows does). */
export function uniquePath(path: string, taken: Set<string>): string {
  let candidate = path;
  const slash = path.lastIndexOf("/");
  const dir = path.slice(0, slash + 1);
  const file = path.slice(slash + 1);
  const dot = file.lastIndexOf(".");
  const stem = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot) : "";
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${dir}${stem} (${n})${ext}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}
