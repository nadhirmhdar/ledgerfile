import { readFileSync } from "node:fs";
import path from "node:path";
import type PDFDocument from "pdfkit";
import { resolveLevels, visualRuns, type Direction } from "../domain/bidi";

/**
 * Text that holds Arabic, in the PDFs. pdfkit's built-in fonts cannot print it, so a line is put in the order it is seen (our own bidi
 * code), and each stretch of Arabic is drawn with Noto Naskh Arabic, whose joined letter forms pdfkit's font engine applies. Everything
 * else stays in the document's own font. Text with no Arabic never comes here, so those documents are drawn exactly as before and the
 * font is not embedded.
 *
 * Lines are broken at spaces and each line is ordered on its own (UAX #9 would resolve the paragraph first; for names and the short
 * sentences around them the two agree). The documents are English, so a line is laid out left to right unless it has no Latin letter and
 * begins with Arabic.
 */

type Doc = InstanceType<typeof PDFDocument>;

const FONT_DIR = ["assets", "fonts", "noto-naskh-arabic"];
const FONTS = { regular: "NotoNaskhArabic-Regular.ttf", bold: "NotoNaskhArabic-Bold.ttf" } as const;
const cache = new Map<string, Buffer>();

const ARABIC = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufefc]/;

export const hasArabic = (text: string): boolean => ARABIC.test(text);

export function baseDirection(text: string): Direction {
  return !/\p{Script=Latin}/u.test(text) && resolveLevels(text).direction === "rtl" ? "rtl" : "ltr";
}

/** A stretch drawn with one font. `text` is what is handed to pdfkit. */
export interface Piece {
  arabic: boolean;
  text: string;
}

/**
 * One line as the stretches to draw, left to right. For an Arabic stretch the text is in the order the font engine expects: it lays out
 * anything in the Arabic script from right to left, so Arabic-Indic digits, which read left to right, are handed over reversed.
 */
export function linePieces(line: string, direction: Direction, covers: (codePoint: number) => boolean, plain: (text: string) => string): Piece[] {
  const pieces: Piece[] = [];
  for (const run of visualRuns(line, direction)) {
    const rtl = run.direction === "rtl";
    const parts: { arabic: boolean; chars: string[] }[] = [];
    for (const ch of run.text) {
      // The font has no brackets: those, and anything else it lacks, stay in the document's font.
      const wanted = ARABIC.test(ch) || (rtl && /[ .\u200c\u200d]/.test(ch));
      const arabic = wanted && covers(ch.codePointAt(0)!);
      const last = parts[parts.length - 1];
      if (last && last.arabic === arabic) last.chars.push(ch);
      else parts.push({ arabic, chars: [ch] });
    }
    // Within a right-to-left run the later stretch is further left.
    if (rtl) parts.reverse();
    for (const { arabic, chars } of parts) {
      const seen = arabic ? (rtl ? chars : [...chars].reverse()) : rtl ? [...chars].reverse() : chars;
      pieces.push({ arabic, text: arabic ? seen.join("") : plain(seen.join("")) });
    }
  }
  return pieces;
}

// An empty feature list makes pdfkit hand the whole stretch to the font engine at once, rather than word by word.
const SHAPE = { features: [] as never[] };

interface Style {
  /** The document's font in use, which is put back afterwards. */
  font: "Helvetica" | "Helvetica-Bold" | "Helvetica-Oblique";
  size: number;
  /** Characters outside Arabic go through this, as all other text does. */
  plain: (text: string) => string;
}

function fontData(weight: keyof typeof FONTS): Buffer {
  const file = path.join(process.cwd(), ...FONT_DIR, FONTS[weight]);
  let data = cache.get(file);
  if (!data) cache.set(file, (data = readFileSync(file)));
  return data;
}

/** Whether the font can be read. A deployment that did not carry the files prints Arabic as "?" rather than failing the download. */
export function arabicAvailable(): boolean {
  try {
    fontData("regular");
    fontData("bold");
    return true;
  } catch {
    console.error("The Arabic font could not be read: Arabic is printed as question marks.");
    return false;
  }
}

function selectArabic(doc: Doc, style: Style) {
  const weight = style.font === "Helvetica-Bold" ? "bold" : "regular";
  const data = fontData(weight);
  doc.registerFont(`Arabic-${weight}`, data);
  doc.font(`Arabic-${weight}`).fontSize(style.size);
}

const selectPlain = (doc: Doc, style: Style) => doc.font(style.font).fontSize(style.size);

function coverage(doc: Doc, style: Style): (codePoint: number) => boolean {
  selectArabic(doc, style);
  const font = (doc as unknown as { _font: { font: { hasGlyphForCodePoint(c: number): boolean } } })._font.font;
  selectPlain(doc, style);
  return (c) => font.hasGlyphForCodePoint(c);
}

function measure(doc: Doc, style: Style, pieces: Piece[]): number[] {
  const widths = pieces.map((p) => {
    if (p.arabic) selectArabic(doc, style);
    else selectPlain(doc, style);
    return doc.widthOfString(p.text, p.arabic ? SHAPE : {});
  });
  selectPlain(doc, style);
  return widths;
}

const sum = (n: number[]) => n.reduce((a, b) => a + b, 0);

/** Arabic letters reach further above and below the line than Helvetica's. */
const lineHeight = (style: Style) => style.size * 1.6;

/** The text broken into lines that fit the width (a single word that is wider keeps a line to itself). */
function layout(doc: Doc, style: Style, text: string, width: number | null): Piece[][] {
  const covers = coverage(doc, style);
  const clean = text.normalize("NFC").replace(/\t/g, " ");
  return clean.split(/\r?\n|\u2028|\u2029/).flatMap((paragraph) => {
    const direction = baseDirection(paragraph);
    const pieces = (line: string) => linePieces(line, direction, covers, style.plain);
    if (width === null) return [pieces(paragraph)];
    const lines: string[] = [];
    let current = "";
    for (const word of paragraph.split(" ")) {
      const next = current ? `${current} ${word}` : word;
      if (current && sum(measure(doc, style, pieces(next))) > width) {
        lines.push(current);
        current = word;
      } else current = next;
    }
    lines.push(current);
    return lines.map(pieces);
  });
}

/** The height text with Arabic takes at this width. */
export function arabicHeight(doc: Doc, style: Style, text: string, width: number): number {
  return layout(doc, style, text, width).length * lineHeight(style);
}

export interface Placement {
  width: number;
  align?: "left" | "right" | "center";
  /** False for a single line that is never broken (a page header, a figure). */
  lineBreak?: boolean;
  /** Where a new page starts and ends, for a paragraph that runs over. */
  page?: { top: number; bottom: number };
}

/** Draw text with Arabic at (x, y), leaving the cursor under it and the document's font as it was. */
export function drawArabic(doc: Doc, style: Style, text: string, x: number, y: number, place: Placement): void {
  const lines = layout(doc, style, text, place.lineBreak === false ? null : place.width);
  const height = lineHeight(style);
  // All fonts sit on one baseline: that of the document's font.
  selectPlain(doc, style);
  const ascent = (doc as unknown as { _font: { ascender: number } })._font.ascender;
  // The same place pdfkit puts Latin text drawn from the top, so a bullet or a figure beside the line sits level with it.
  const baseline = ((ascent || 718) / 1000) * style.size;
  let top = y;
  for (const pieces of lines) {
    if (place.page && top + height > place.page.bottom) {
      doc.addPage();
      top = place.page.top;
    }
    const widths = measure(doc, style, pieces);
    const spare = Math.max(0, place.width - sum(widths));
    let at = x + (place.align === "right" ? spare : place.align === "center" ? spare / 2 : 0);
    pieces.forEach((p, i) => {
      if (p.arabic) selectArabic(doc, style);
      else selectPlain(doc, style);
      doc.text(p.text, at, top + baseline, { lineBreak: false, baseline: "alphabetic", ...(p.arabic ? SHAPE : {}) });
      at += widths[i];
    });
    top += height;
  }
  selectPlain(doc, style);
  doc.x = x;
  doc.y = top;
}
