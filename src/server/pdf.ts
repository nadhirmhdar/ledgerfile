import PDFDocument from "pdfkit";
import type { Block } from "../domain/letters";
import type { FigureRow, StatementBlock } from "../domain/statements-document";
import { fitLogo, type LogoImage } from "../domain/branding";

/**
 * A small PDF renderer for the downloads: A4, headings, paragraphs, bullets and numbered items, tables of figures (right-aligned, bold
 * totals, the header repeated when a table runs onto another page), the client and period at the top of every page and "Page N of M" at the
 * bottom. Both the financial statements and the auditor's report are drawn with it from the same block lists as their Word files.
 *
 * Only pdfkit's built-in Helvetica family is used, so no font file of ours is needed. Those fonts take WinAnsi (Windows-1252) text, so every
 * string goes through toWinAnsi first: anything outside it is replaced, never sent as a missing glyph.
 */

export type PdfBlock = StatementBlock | Block;

export interface PdfOptions {
  /** The document's title property. */
  title: string;
  /** Printed at the top of every page: the client and the period. */
  header: string;
  /** Tests turn compression off to read the text back. */
  compress?: boolean;
  /** The firm's logo for a letterhead or report: drawn right after the first block (the draft notice). */
  logo?: LogoImage | null;
  /** A discreet firm header for every page (the statements): the logo, small, and the firm's name at the right. */
  brand?: { firmName: string; logo: LogoImage | null } | null;
}

// --- WinAnsi ------------------------------------------------------------------------------------------------------------------

/** The characters Windows-1252 has beyond ASCII and Latin-1: what the PDF's standard fonts can print. */
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

const REPLACEMENTS: Record<string, string> = {
  "−": "-", // minus sign
  "‐": "-", // hyphen
  "‑": "-", // non-breaking hyphen
  "‒": "-", // figure dash
  "―": "-", // horizontal bar
  " ": " ", // figure space
  " ": " ", // thin space
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ", // narrow no-break space
  "≤": "<=",
  "≥": ">=",
  "≠": "!=",
  "→": "->",
  "←": "<-",
  "✓": "[x]",
  "✔": "[x]",
  "•": "•",
  "′": "'",
  "″": '"',
  "­": "", // soft hyphen
  "​": "", // zero-width space
  "‌": "",
  "‍": "",
  "﻿": "",
  " ": "\n",
  " ": "\n",
};

const inWinAnsi = (ch: string) => {
  const c = ch.charCodeAt(0);
  return ch === "\n" || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.has(ch);
};

/**
 * Text the standard fonts can print. Characters in WinAnsi (letters with accents, "–", "×", "÷", curly quotes, the bullet) are kept; a few
 * look-alikes are mapped ("−" to "-", "≥" to ">="); a letter with a mark that WinAnsi lacks becomes its plain letter; control characters are
 * dropped; anything else, such as Arabic or Chinese, becomes "?" (one for each character, so a name stays recognisably a name).
 */
export function toWinAnsi(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC")) {
    if (ch.length === 1 && inWinAnsi(ch)) {
      out += ch;
      continue;
    }
    if (ch in REPLACEMENTS) {
      out += REPLACEMENTS[ch];
      continue;
    }
    const code = ch.codePointAt(0)!;
    if (code < 0x20 || (code >= 0x7f && code < 0xa0)) {
      if (ch === "\t") out += " ";
      continue;
    }
    const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    out += base.length > 0 && [...base].every((b) => b.length === 1 && inWinAnsi(b)) ? base : "?";
  }
  return out;
}

// --- Layout ---------------------------------------------------------------------------------------------------------------------

const MARGIN = { left: 56, right: 56, top: 78, bottom: 64 };
const PAGE = { width: 595.28, height: 841.89 };
const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right;
const BODY = 9.5;
const LINE_AFTER = 5;
const PAD = 3;

type Doc = InstanceType<typeof PDFDocument>;

function drawFigures(doc: Doc, rows: FigureRow[], labelPct: number) {
  const labelW = (CONTENT_WIDTH * labelPct) / 100;
  const cols = Math.max(...rows.map((r) => r.figures.length), 1);
  const colW = (CONTENT_WIDTH - labelW) / cols;
  const bottom = PAGE.height - MARGIN.bottom;
  const header = rows.find((r) => r.kind === "header");

  const draw = (r: FigureRow, y: number): number => {
    const bold = r.kind !== "line";
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(BODY);
    const label = toWinAnsi(r.label);
    const h = Math.max(doc.heightOfString(label || " ", { width: labelW - 6 }), BODY * 1.15) + PAD * 2;
    if (y + h > bottom) return -1;
    doc.text(label, MARGIN.left, y + PAD, { width: labelW - 6, align: "left", lineBreak: true });
    r.figures.forEach((f, i) => doc.text(toWinAnsi(f), MARGIN.left + labelW + colW * i, y + PAD, { width: colW - 2, align: "right", lineBreak: false }));
    const left = MARGIN.left + labelW;
    const right = MARGIN.left + CONTENT_WIDTH;
    doc.lineWidth(0.6).strokeColor("#000000");
    if (r.kind === "subtotal" || r.kind === "total") doc.moveTo(left, y).lineTo(right, y).stroke();
    if (r.kind === "header") doc.moveTo(MARGIN.left, y + h).lineTo(right, y + h).stroke();
    if (r.kind === "total") {
      doc.moveTo(left, y + h - 1.2).lineTo(right, y + h - 1.2).stroke();
      doc.moveTo(left, y + h + 0.4).lineTo(right, y + h + 0.4).stroke();
    }
    return y + h;
  };

  let y = doc.y + 2;
  for (const r of rows) {
    let next = draw(r, y);
    if (next < 0) {
      // A new page: the header row again, then this row.
      doc.addPage();
      y = MARGIN.top;
      if (header && r !== header) y = draw(header, y);
      next = draw(r, y);
    }
    y = next;
  }
  doc.y = y + 8;
  doc.x = MARGIN.left;
}

/** Draw a logo at the current position, at its own proportions within a box. A logo the library cannot embed is left out, never failing the document. */
function drawLogo(doc: Doc, logo: LogoImage, maxWidth: number, maxHeight: number, x: number, y: number): { width: number; height: number } | null {
  const size = fitLogo(logo, maxWidth, maxHeight);
  try {
    doc.image(Buffer.from(logo.data), x, y, { width: size.width, height: size.height });
    return size;
  } catch {
    return null;
  }
}

/** Make room: start a new page when fewer than `needed` points are left. */
function ensure(doc: Doc, needed: number) {
  if (doc.y + needed > PAGE.height - MARGIN.bottom) doc.addPage();
}

function render(doc: Doc, b: PdfBlock) {
  switch (b.kind) {
    case "title":
      ensure(doc, 60);
      doc.font("Helvetica-Bold").fontSize(15).text(toWinAnsi(b.text), MARGIN.left, doc.y, { width: CONTENT_WIDTH });
      doc.moveDown(0.2);
      return;
    case "heading": {
      const level = "level" in b && b.level === 3 ? 3 : 2;
      ensure(doc, 50);
      doc.moveDown(level === 3 ? 0.5 : 0.7);
      doc.font("Helvetica-Bold").fontSize(level === 3 ? 10.5 : 12).text(toWinAnsi(b.text), MARGIN.left, doc.y, { width: CONTENT_WIDTH });
      doc.moveDown(0.3);
      return;
    }
    case "para": {
      const italics = "italics" in b && b.italics;
      const bold = "bold" in b && b.bold;
      doc.font(bold ? "Helvetica-Bold" : italics ? "Helvetica-Oblique" : "Helvetica").fontSize(BODY);
      doc.text(toWinAnsi(b.text), MARGIN.left, doc.y, { width: CONTENT_WIDTH, align: "left" });
      doc.moveDown(LINE_AFTER / BODY);
      return;
    }
    case "bullet": {
      const indent = b.level === 2 ? 34 : 18;
      doc.font("Helvetica").fontSize(BODY);
      const text = toWinAnsi(b.text);
      ensure(doc, doc.heightOfString(text, { width: CONTENT_WIDTH - indent }) + 4);
      const y = doc.y;
      doc.text("•", MARGIN.left + indent - 12, y, { width: 10, lineBreak: false });
      doc.text(text, MARGIN.left + indent, y, { width: CONTENT_WIDTH - indent });
      doc.moveDown(3 / BODY);
      return;
    }
    case "numbered": {
      doc.font("Helvetica").fontSize(BODY);
      const dot = b.text.indexOf(". ");
      const number = dot > 0 ? toWinAnsi(b.text.slice(0, dot + 1)) : "";
      const text = toWinAnsi(dot > 0 ? b.text.slice(dot + 2) : b.text);
      ensure(doc, doc.heightOfString(text, { width: CONTENT_WIDTH - 28 }) + 4);
      const y = doc.y;
      if (number) doc.text(number, MARGIN.left, y, { width: 24, lineBreak: false });
      doc.text(text, MARGIN.left + 28, y, { width: CONTENT_WIDTH - 28 });
      doc.moveDown(4 / BODY);
      return;
    }
    case "signature":
      doc.font("Helvetica").fontSize(BODY);
      doc.moveDown(0.6);
      for (const line of b.lines) {
        ensure(doc, 24);
        doc.text(toWinAnsi(line), MARGIN.left, doc.y, { width: CONTENT_WIDTH });
        doc.moveDown(0.5);
      }
      return;
    case "table": {
      const rows: FigureRow[] = [
        { label: b.header[0] ?? "", figures: b.header.slice(1), kind: "header" },
        ...b.rows.map((r, i) => ({ label: r[0] ?? "", figures: r.slice(1), kind: (i === b.rows.length - 1 && /^net /i.test(r[0] ?? "") ? "total" : "line") as FigureRow["kind"] })),
      ];
      drawFigures(doc, rows, Math.max(40, 100 - 30 * (b.header.length - 1)));
      return;
    }
    case "figures":
      drawFigures(doc, b.rows, b.labelPct);
      return;
    case "pagebreak":
      doc.addPage();
      return;
  }
}

/** Draw the document: the blocks in order, then the header and "Page N of M" on every page. */
export function renderPdf(blocks: PdfBlock[], options: PdfOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: MARGIN.top, bottom: MARGIN.bottom, left: MARGIN.left, right: MARGIN.right },
      bufferPages: true,
      compress: options.compress ?? true,
      info: { Title: toWinAnsi(options.title), Author: "LedgerFile", Creator: "LedgerFile", Producer: "LedgerFile" },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      doc.x = MARGIN.left;
      doc.y = MARGIN.top;
      blocks.forEach((b, i) => {
        render(doc, b);
        if (i === 0 && options.logo) {
          ensure(doc, 70);
          const drawn = drawLogo(doc, options.logo, 170, 46, MARGIN.left, doc.y);
          if (drawn) doc.y += drawn.height + 8;
          doc.x = MARGIN.left;
        }
      });

      const { start, count } = doc.bufferedPageRange();
      for (let i = start; i < start + count; i++) {
        doc.switchToPage(i);
        // The header and footer sit outside the margins: lift the bottom margin so writing there does not start another page.
        const saved = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc.font("Helvetica").fontSize(8).fillColor("#555555");
        const brand = options.brand;
        let textX = MARGIN.left;
        if (brand?.logo) {
          const drawn = drawLogo(doc, brand.logo, 56, 20, MARGIN.left, 24);
          if (drawn) textX += drawn.width + 8;
        }
        doc.text(toWinAnsi(options.header), textX, 34, { width: CONTENT_WIDTH - (textX - MARGIN.left) - (brand ? 150 : 0), align: "left", lineBreak: false });
        if (brand) doc.text(toWinAnsi(brand.firmName), PAGE.width - MARGIN.right - 146, 34, { width: 146, align: "right", lineBreak: false });
        doc.lineWidth(0.4).strokeColor("#999999").moveTo(MARGIN.left, 50).lineTo(PAGE.width - MARGIN.right, 50).stroke();
        doc.text(`Page ${i - start + 1} of ${count}`, MARGIN.left, PAGE.height - 40, { width: CONTENT_WIDTH, align: "center", lineBreak: false });
        doc.page.margins.bottom = saved;
        doc.fillColor("#000000");
      }
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
