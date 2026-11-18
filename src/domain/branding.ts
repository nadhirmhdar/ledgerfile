/**
 * A firm's branding: its address, contact and registration lines and its logo, shown on the letters, statements and auditor's report it
 * downloads. Pure: the checks on an uploaded logo (what it really is, how big, how many pixels) and the lines drawn from the details.
 *
 * A logo is only ever a PNG or a JPEG, told apart by their first bytes and never by the file name or the type the browser claims, so a
 * script, an SVG or a document renamed to .png is refused. Its size in pixels is read from the file's own header.
 */

export const MAX_LOGO_BYTES = 1024 * 1024;
export const MIN_LOGO_PX = 32;
export const MAX_LOGO_PX = 2000;
export const MAX_ADDRESS = 300;
export const MAX_ADDRESS_LINES = 6;
export const MAX_LINE = 200;

export type LogoType = "image/png" | "image/jpeg";

export interface LogoImage {
  data: Uint8Array;
  contentType: LogoType;
  width: number;
  height: number;
}

export interface Branding {
  firmName: string;
  address: string | null;
  contactLine: string | null;
  registrationLine: string | null;
  logo: LogoImage | null;
}

export interface ImageFacts {
  contentType: LogoType;
  width: number;
  height: number;
  /** A PNG saved in the interlaced (Adam7) form, which the PDF library cannot embed. */
  interlaced: boolean;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const u16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];

/** What the bytes are, from their first bytes, and their size from the header. Null for anything but a readable PNG or JPEG. */
export function detectImage(bytes: Uint8Array): ImageFacts | null {
  if (bytes.length >= 33 && PNG_SIGNATURE.every((v, i) => bytes[i] === v)) {
    // The first chunk of a PNG is IHDR: length 13, then "IHDR", then width, height, depth, colour type, compression, filter, interlace.
    const isIhdr = u32(bytes, 8) === 13 && bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52;
    if (!isIhdr) return null;
    return { contentType: "image/png", width: u32(bytes, 16), height: u32(bytes, 20), interlaced: bytes[28] !== 0 };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    let i = 2;
    while (i + 3 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      let marker = bytes[i + 1];
      while (marker === 0xff && i + 2 < bytes.length) {
        i++;
        marker = bytes[i + 1];
      }
      // Markers that stand alone have no length.
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
        i += 2;
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) return null; // end of image or start of scan before any frame header
      if (i + 3 >= bytes.length) return null;
      const length = u16(bytes, i + 2);
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) {
        if (i + 9 > bytes.length) return null;
        return { contentType: "image/jpeg", height: u16(bytes, i + 5), width: u16(bytes, i + 7), interlaced: false };
      }
      if (length < 2) return null;
      i += 2 + length;
    }
  }
  return null;
}

export type LogoCheck = { ok: true; contentType: LogoType; width: number; height: number } | { ok: false; message: string };

/** Whether bytes may be kept as the firm's logo: a real PNG or JPEG, at most 1 MB, 32 to 2000 pixels each way. */
export function checkLogo(bytes: Uint8Array): LogoCheck {
  if (bytes.length === 0) return { ok: false, message: "Choose an image file." };
  if (bytes.length > MAX_LOGO_BYTES) return { ok: false, message: "The logo is larger than 1 MB. Save a smaller image and try again." };
  const facts = detectImage(bytes);
  if (!facts) return { ok: false, message: "The logo must be a PNG or JPEG image. Other types, including SVG, GIF and WebP, are not accepted." };
  if (facts.interlaced) return { ok: false, message: "That PNG is saved in the interlaced form. Save it again without interlacing, or as a JPEG." };
  if (facts.width < MIN_LOGO_PX || facts.height < MIN_LOGO_PX) return { ok: false, message: `The logo is too small. It must be at least ${MIN_LOGO_PX} pixels wide and high.` };
  if (facts.width > MAX_LOGO_PX || facts.height > MAX_LOGO_PX) return { ok: false, message: `The logo is too large. It must be at most ${MAX_LOGO_PX} by ${MAX_LOGO_PX} pixels.` };
  return { ok: true, contentType: facts.contentType, width: facts.width, height: facts.height };
}

export interface BrandingText {
  address: string | null;
  contactLine: string | null;
  registrationLine: string | null;
}

const tidy = (s: string) => s.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").replace(/[ \t]+/g, " ").trim();

/** The text fields as typed, cleaned and checked. Blank becomes null. Returns the problem as a sentence when something is too long. */
export function cleanBrandingText(input: { address: string; contactLine: string; registrationLine: string }): { ok: true; value: BrandingText } | { ok: false; message: string } {
  const lines = input.address
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(tidy)
    .filter((l) => l !== "");
  const address = lines.length === 0 ? null : lines.join("\n");
  if (address && address.length > MAX_ADDRESS) return { ok: false, message: `The address is too long. Keep it to ${MAX_ADDRESS} characters.` };
  if (lines.length > MAX_ADDRESS_LINES) return { ok: false, message: `The address has too many lines. Keep it to ${MAX_ADDRESS_LINES}.` };
  const contactLine = tidy(input.contactLine.replace(/\s+/g, " ")) || null;
  const registrationLine = tidy(input.registrationLine.replace(/\s+/g, " ")) || null;
  if (contactLine && contactLine.length > MAX_LINE) return { ok: false, message: `The contact line is too long. Keep it to ${MAX_LINE} characters.` };
  if (registrationLine && registrationLine.length > MAX_LINE) return { ok: false, message: `The registration line is too long. Keep it to ${MAX_LINE} characters.` };
  return { ok: true, value: { address, contactLine, registrationLine } };
}

/** Whether the firm has set anything at all. When it has not, every output is exactly as it was before branding existed. */
export const hasBranding = (b: Branding | null | undefined): boolean => !!b && !!(b.logo || b.address || b.contactLine || b.registrationLine);

export const addressLines = (b: Pick<Branding, "address">): string[] => (b.address ? b.address.split("\n") : []);

/** The lines under the firm's name on a letterhead: the address, then the contact line, then the registration line. */
export function letterheadLines(b: Branding | null | undefined): string[] {
  if (!b) return [];
  return [...addressLines(b), ...(b.contactLine ? [b.contactLine] : []), ...(b.registrationLine ? [b.registrationLine] : [])];
}

/** The lines the signature block of the auditor's report carries for the firm: the address and the registration line. */
export function signatureFirmLines(b: Branding | null | undefined): string[] {
  if (!b) return [];
  return [...addressLines(b), ...(b.registrationLine ? [b.registrationLine] : [])];
}

/** The size a logo is drawn at: its own proportions, within a box. */
export function fitLogo(logo: Pick<LogoImage, "width" | "height">, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const scale = Math.min(maxWidth / logo.width, maxHeight / logo.height);
  return { width: Math.round(logo.width * scale * 100) / 100, height: Math.round(logo.height * scale * 100) / 100 };
}
