import { inflateSync } from "node:zlib";

/**
 * Read the text back out of a PDF made by renderPdf (no dependency; compressed or not): each page is one content stream, and each piece of text
 * is a hex string inside a TJ array, in the order it was drawn. The standard fonts are WinAnsi, so the bytes are read as Windows-1252.
 */
const WIN_ANSI_HIGH: Record<number, string> = { 0x80: "€", 0x85: "…", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x99: "™" };

const decode = (hex: string): string => {
  let out = "";
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const byte = parseInt(hex.slice(i, i + 2), 16);
    out += WIN_ANSI_HIGH[byte] ?? String.fromCharCode(byte);
  }
  return out;
};

/** The pieces of text on each page, in drawing order (the body first, then the page header and footer). */
export function pdfPages(buffer: Buffer): string[][] {
  const text = buffer.toString("latin1");
  const pages: string[][] = [];
  for (const m of text.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const pieces: string[] = [];
    // A compressed stream (the default) is inflated first; an uncompressed one is read as it is.
    let content = m[1];
    try {
      content = inflateSync(Buffer.from(m[1], "latin1")).toString("latin1");
    } catch {
      // not compressed
    }
    for (const tj of content.matchAll(/\[((?:<[0-9a-f]*>|\s|-?[\d.]+)*)\]\s*TJ/g)) {
      pieces.push([...tj[1].matchAll(/<([0-9a-f]*)>/g)].map((h) => decode(h[1])).join(""));
    }
    // Streams with no text (the pictures) are not pages.
    if (pieces.length > 0) pages.push(pieces);
  }
  return pages;
}

/** All the text, page by page, one piece per line. */
export const pdfText = (buffer: Buffer): string => pdfPages(buffer).map((p) => p.join("\n")).join("\n");

export const pageCount = (buffer: Buffer): number => (buffer.toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length;
