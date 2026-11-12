import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, PageBreak, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import type { StatementPack } from "../domain/statement-pack";
import type { StatementLine } from "../domain/statements";
import { formatPresentation } from "../domain/money";

export interface DocxInput {
  clientName: string;
  periodStart: string;
  periodEnd: string;
  pack: StatementPack;
  /** True until the engagement is locked with all checks passing. */
  draft: boolean;
}

const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const RULE = { style: BorderStyle.SINGLE, size: 6, color: "000000" };
const DOUBLE = { style: BorderStyle.DOUBLE, size: 6, color: "000000" };

type Kind = "line" | "subtotal" | "total" | "header" | "section";

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
function row(label: string, figures: string[], kind: Kind, labelPct: number): TableRow {
  const bold = kind !== "line";
  const each = (100 - labelPct) / Math.max(figures.length, 1);
  return new TableRow({
    children: [
      cell(label, labelPct, { bold }),
      ...figures.map((f) => cell(f, each, { right: true, bold, top: kind === "subtotal" || kind === "total", bottom: kind === "total" })),
    ],
  });
}

function table(rows: TableRow[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
    rows,
  });
}

const heading = (text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_2) =>
  new Paragraph({ text, heading: level, spacing: { before: 240, after: 80 } });
const para = (text: string, opts: { italics?: boolean; bold?: boolean } = {}) =>
  new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text, size: 20, italics: opts.italics, bold: opts.bold })] });
const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

export async function buildStatementsDocx(input: DocxInput): Promise<Buffer> {
  const { pack } = input;
  const unit = pack.rounding.unitMinor;
  const fmt = (n: number) => formatPresentation(n, unit);
  const year = input.periodEnd.slice(0, 4);
  const priorYear = String(Number(year) - 1);
  const comparatives = pack.base.hasComparatives;
  const noteRef = (l: StatementLine) => (l.groupCode && pack.noteByGroup[l.groupCode] ? String(pack.noteByGroup[l.groupCode]) : "");
  const figures = (l: StatementLine) => [noteRef(l), fmt(l.current), ...(comparatives ? [fmt(l.prior)] : [])];
  const headerRow = () => row("", ["Note", year, ...(comparatives ? [priorYear] : [])], "header", 55);
  const title = (name: string, sub: string) => [
    new Paragraph({ text: input.clientName, heading: HeadingLevel.HEADING_1, spacing: { after: 40 } }),
    heading(name),
    para(sub, { italics: true }),
  ];

  const children: (Paragraph | Table)[] = [];
  if (input.draft) {
    children.push(para("DRAFT: these statements have outstanding checks or have not been approved. Not for issue.", { bold: true }));
  }

  // Statement of financial position
  children.push(...title("Statement of financial position", `At ${input.periodEnd}`));
  const sfpRows: TableRow[] = [headerRow()];
  for (const section of pack.base.financialPosition) {
    if (section.title) sfpRows.push(row(section.title, ["", "", ...(comparatives ? [""] : [])], "section", 55));
    for (const l of section.lines) sfpRows.push(row(l.label, figures(l), l.kind, 55));
  }
  children.push(table(sfpRows), pageBreak());

  // Statement of comprehensive income
  children.push(...title("Statement of comprehensive income", `For the period ended ${input.periodEnd}`));
  children.push(table([headerRow(), ...pack.base.comprehensiveIncome.map((l) => row(l.label, figures(l), l.kind, 55))]), pageBreak());

  // Statement of changes in equity
  if (pack.equity) {
    children.push(...title("Statement of changes in equity", `For the period ended ${input.periodEnd}`));
    children.push(
      table([
        row("", [...pack.equity.columns.map((c) => c.label), "Total"], "header", 34),
        ...pack.equity.rows.map((r) => row(r.label, [...r.values.map(fmt), fmt(r.total)], r.kind, 34)),
      ]),
      pageBreak(),
    );
  }

  // Statement of cash flows
  if (pack.cashFlow) {
    children.push(...title("Statement of cash flows", `For the period ended ${input.periodEnd}`));
    const cfRows: TableRow[] = [row("", [year], "header", 75)];
    for (const section of pack.cashFlow.sections) {
      cfRows.push(row(section.title, [""], "section", 75));
      for (const l of section.lines) cfRows.push(row(l.label, [fmt(l.current)], l.kind, 75));
    }
    cfRows.push(
      row("Net increase/(decrease) in cash and cash equivalents", [fmt(pack.cashFlow.netChange)], "subtotal", 75),
      row("Cash and cash equivalents at the start of the year", [fmt(pack.cashFlow.opening)], "line", 75),
      row("Cash and cash equivalents at the end of the year", [fmt(pack.cashFlow.closing)], "total", 75),
    );
    children.push(table(cfRows), pageBreak());
  }

  // Notes
  children.push(new Paragraph({ text: input.clientName, heading: HeadingLevel.HEADING_1, spacing: { after: 40 } }), heading("Notes to the financial statements"));
  for (const note of pack.notes) {
    children.push(heading(`${note.number}. ${note.title}`, HeadingLevel.HEADING_3));
    for (const p of note.paragraphs) children.push(para(p));
    for (const sub of note.subsections ?? []) children.push(para(sub.title, { bold: true }), para(sub.text));
    if (note.table) {
      children.push(
        table([
          row("", [year, ...(comparatives ? [priorYear] : [])], "header", 60),
          ...note.table.rows.map((r) => row(r.label, [fmt(r.current), ...(comparatives ? [r.prior === null ? "" : fmt(r.prior)] : [])], "line", 60)),
          row("Total", [fmt(note.table.totalCurrent), ...(comparatives ? [fmt(note.table.totalPrior)] : [])], "total", 60),
        ]),
      );
    }
  }

  const doc = new Document({
    creator: "LedgerFile",
    title: `${input.clientName} financial statements ${input.periodEnd}`,
    styles: { default: { document: { run: { font: "Calibri", size: 20 } } } },
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}
