/** A small reader for the tests: walks the central directory and returns each stored entry. Not used by the application. */
export function readZip(zip: Buffer): { name: string; data: Uint8Array; crc: number; size: number; utf8: boolean }[] {
  const end = zip.length - 22;
  if (zip.readUInt32LE(end) !== 0x06054b50) throw new Error("no end record");
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const out: ReturnType<typeof readZip> = [];
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error("bad central header");
    const flags = zip.readUInt16LE(at + 8);
    if (zip.readUInt16LE(at + 10) !== 0) throw new Error("not stored");
    const crc = zip.readUInt32LE(at + 16);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    out.push({ name, data: zip.subarray(start, start + size), crc, size, utf8: (flags & 0x0800) !== 0 });
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return out;
}
