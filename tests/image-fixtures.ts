import { crc32, deflateSync } from "node:zlib";

/** Tiny invented images for the branding tests: generated here, no real logo anywhere. */

const chunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
};

/** A solid-colour RGB PNG of the given size (the interlace flag is only set in the header). */
export function makePng(width = 64, height = 48, options: { interlaced?: boolean; rgb?: [number, number, number] } = {}): Buffer {
  const [r, g, b] = options.rgb ?? [30, 90, 160];
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  ihdr[12] = options.interlaced ? 1 : 0;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/**
 * A small JPEG that is a real frame header (baseline, 3 components) followed by an end marker. It is what the header checks and the document
 * libraries' embedding need; it is not meant to be decoded as a picture.
 */
export function makeJpeg(width = 64, height = 48): Buffer {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

export const svgBytes = (): Buffer => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><script>alert(1)</script><rect width="64" height="64"/></svg>');
export const gifBytes = (): Buffer => Buffer.concat([Buffer.from("GIF89a", "latin1"), Buffer.from([64, 0, 64, 0, 0, 0, 0]), Buffer.alloc(40)]);
export const webpBytes = (): Buffer => Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.from([40, 0, 0, 0]), Buffer.from("WEBPVP8 ", "latin1"), Buffer.alloc(40)]);
