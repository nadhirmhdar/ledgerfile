import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, PageBreak, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { statementsDocument, type FigureKind, type FigureRow, type StatementBlock, type StatementsDocumentInput } from "../domain/statements-document";

/** The Word download of the financial statements. Drawn from the same block list as the PDF (src/domain/statements-document.ts). */
export type DocxInput = StatementsDocumentInput;

const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const RULE = { style: BorderStyle.SINGLE, size: 6, color: "000000" };
const DOUBLE = { style: BorderStyle.DOUBLE, size: 6, color: "000000" };

function cell(text: string, widthPct: number, opts: { right?: boolean; bold?: boolean; top?: boolean; bottom?: boolean } = {}): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    borders: { top: opts.top ? RULE : NONE, bottom: opts.bottom ? DOUBLE : NONE, left: NONE, right: NONE },
    children: [
      new Paragraph({
        alignment: opts.right ? AlignmentType.RIGHT : AlignmentType.LEFT,
        spacing: { before: 40, after: 40 },
        children: [new TextRun({ text, bold: opts.bold, size: 20 })],
      }),
    ],
  });
}

/** One table row: a label, then right-aligned figures. Subtotals get a rule above; totals a double rule below. */
function row(r: FigureRow, labelPct: number): TableRow {
  const kind: FigureKind = r.kind;
  const bold = kind !== "line";
  const each = (100 - labelPct) / Math.max(r.figures.length, 1);
  return new TableRow({
    children: [cell(r.label, labelPct, { bold }), ...r.figures.map((f) => cell(f, each, { right: true, bold, top: kind === "subtotal" || kind === "total", bottom: kind === "total" }))],
  });
}

function render(b: StatementBlock): (Paragraph | Table)[] {
  switch (b.kind) {
    case "title":
      return [new Paragraph({ text: b.text, heading: HeadingLevel.HEADING_1, spacing: { after: 40 } })];
    case "heading":
      return [new Paragraph({ text: b.text, heading: b.level === 3 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_2, spacing: { before: 240, after: 80 } })];
    case "para":
      return [new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: b.text, size: 20, italics: b.italics, bold: b.bold })] })];
    case "figures":
      return [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
          rows: b.rows.map((r) => row(r, b.labelPct)),
        }),
      ];
    case "pagebreak":
      return [new Paragraph({ children: [new PageBreak()] })];
  }
}

export async function buildStatementsDocx(input: DocxInput): Promise<Buffer> {
  const doc = new Document({
    creator: "LedgerFile",
    title: `${input.clientName} financial statements ${input.periodEnd}`,
    styles: { default: { document: { run: { font: "Calibri", size: 20 } } } },
    sections: [{ children: statementsDocument(input).flatMap(render) }],
  });
  return Packer.toBuffer(doc);
}
