import { AlignmentType, BorderStyle, Document, HeadingLevel, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import type { Block } from "../domain/letters";
import { fitLogo, type LogoImage } from "../domain/branding";

const SIZE = 21;
const RULE = { style: BorderStyle.SINGLE, size: 4, color: "808080" };

function cell(text: string, widthPct: number, opts: { right?: boolean; bold?: boolean } = {}): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    borders: { top: RULE, bottom: RULE, left: RULE, right: RULE },
    margins: { left: 80, right: 80 },
    children: [
      new Paragraph({
        alignment: opts.right ? AlignmentType.RIGHT : AlignmentType.LEFT,
        spacing: { before: 40, after: 40 },
        children: [new TextRun({ text, bold: opts.bold, size: SIZE })],
      }),
    ],
  });
}

function render(block: Block, notice: boolean): (Paragraph | Table)[] {
  switch (block.kind) {
    case "heading":
      return [new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 100 }, children: [new TextRun({ text: block.text, bold: true, size: 24, color: "000000" })] })];
    case "para":
      // Bracketed paragraphs at the top are notices to the firm, not part of the letter.
      return [new Paragraph({ spacing: { after: 140 }, children: [new TextRun({ text: block.text, size: SIZE, italics: notice, bold: notice })] })];
    case "bullet": {
      const left = block.level === 2 ? 1080 : 540;
      return [new Paragraph({ spacing: { after: 80 }, indent: { left, hanging: 270 }, children: [new TextRun({ text: `•\t${block.text}`, size: SIZE })] })];
    }
    case "numbered": {
      const dot = block.text.indexOf(". ");
      const text = dot > 0 ? `${block.text.slice(0, dot + 1)}\t${block.text.slice(dot + 2)}` : block.text;
      return [new Paragraph({ spacing: { after: 120 }, indent: { left: 540, hanging: 540 }, children: [new TextRun({ text, size: SIZE })] })];
    }
    case "signature":
      return block.lines.map((line) => new Paragraph({ spacing: { before: 200, after: 60 }, children: [new TextRun({ text: line, size: SIZE })] }));
    case "table": {
      const widths = block.header.map((_, i) => (i === 0 ? 100 - 30 * (block.header.length - 1) : 30));
      return [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({ tableHeader: true, children: block.header.map((h, i) => cell(h, widths[i], { bold: true, right: i > 0 })) }),
            ...block.rows.map((r) => new TableRow({ children: r.map((text, i) => cell(text, widths[i], { right: i > 0 })) })),
          ],
        }),
      ];
    }
  }
}

/** The firm's logo as a picture in a paragraph, at a sensible height with its own proportions (96 pixels to the inch). */
export function logoParagraph(logo: LogoImage, maxWidthPx = 240, maxHeightPx = 64): Paragraph {
  const size = fitLogo(logo, maxWidthPx, maxHeightPx);
  return new Paragraph({
    spacing: { after: 140 },
    children: [new ImageRun({ type: logo.contentType === "image/png" ? "png" : "jpg", data: logo.data, transformation: { width: Math.round(size.width), height: Math.round(size.height) }, altText: { name: "Firm logo", description: "Firm logo", title: "Firm logo" } })],
  });
}

/** Lay a letter out as a Word document. A logo, when the firm has one, goes right after the first paragraph (the draft notice). */
export async function buildLetterDocx(title: string, blocks: Block[], options: { logo?: LogoImage | null } = {}): Promise<Buffer> {
  const children = blocks.flatMap((b, i) => render(b, i < 2 && b.kind === "para" && b.text.startsWith("[") && b.text.endsWith("]")));
  if (options.logo) children.splice(blocks.length > 0 ? render(blocks[0], false).length : 0, 0, logoParagraph(options.logo));
  const doc = new Document({
    creator: "LedgerFile",
    title,
    styles: { default: { document: { run: { font: "Calibri", size: SIZE } } } },
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}
