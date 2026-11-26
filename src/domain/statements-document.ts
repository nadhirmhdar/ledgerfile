import type { StatementPack } from "./statement-pack";
import type { StatementLine } from "./statements";
import { formatPresentation } from "./money";

/**
 * The financial statements as a flat list of blocks: titles, headings, paragraphs and tables of figures. Both downloads, Word and PDF,
 * are drawn from this one list, which is built from the statement pack, so they show exactly the same lines, figures, notes and wording.
 * Nothing here works a figure out again: it only formats what the pack holds.
 */

export type FigureKind = "line" | "subtotal" | "total" | "header" | "section";

export interface FigureRow {
  label: string;
  /** Already formatted, right-aligned in the table. */
  figures: string[];
  kind: FigureKind;
}

export type StatementBlock =
  | { kind: "title"; text: string }
  | { kind: "heading"; text: string; level?: 2 | 3 }
  | { kind: "para"; text: string; italics?: boolean; bold?: boolean }
  | { kind: "figures"; /** Share of the table's width taken by the label column, in percent. */ labelPct: number; rows: FigureRow[] }
  | { kind: "pagebreak" };

export interface StatementsDocumentInput {
  clientName: string;
  periodStart: string;
  periodEnd: string;
  pack: StatementPack;
  /** True until the engagement is locked with all checks passing. */
  draft: boolean;
}

export const DRAFT_BANNER = "DRAFT: these statements have outstanding checks or have not been approved. Not for issue.";

export function statementsDocument(input: StatementsDocumentInput): StatementBlock[] {
  const { pack } = input;
  const unit = pack.rounding.unitMinor;
  const fmt = (n: number) => formatPresentation(n, unit);
  const year = input.periodEnd.slice(0, 4);
  const priorYear = String(Number(year) - 1);
  const comparatives = pack.base.hasComparatives;
  const noteRef = (l: StatementLine) => (l.groupCode && pack.noteByGroup[l.groupCode] ? String(pack.noteByGroup[l.groupCode]) : "");
  const figures = (l: StatementLine) => [noteRef(l), fmt(l.current), ...(comparatives ? [fmt(l.prior)] : [])];
  const row = (label: string, figs: string[], kind: FigureKind): FigureRow => ({ label, figures: figs, kind });
  const headerRow = () => row("", ["Note", year, ...(comparatives ? [priorYear] : [])], "header");
  const title = (name: string, sub: string): StatementBlock[] => [
    { kind: "title", text: input.clientName },
    { kind: "heading", text: name },
    { kind: "para", text: sub, italics: true },
  ];

  const blocks: StatementBlock[] = [];
  if (input.draft) blocks.push({ kind: "para", text: DRAFT_BANNER, bold: true });

  // Statement of financial position
  blocks.push(...title("Statement of financial position", `At ${input.periodEnd}`));
  const sfp: FigureRow[] = [headerRow()];
  for (const section of pack.base.financialPosition) {
    if (section.title) sfp.push(row(section.title, ["", "", ...(comparatives ? [""] : [])], "section"));
    for (const l of section.lines) sfp.push(row(l.label, figures(l), l.kind));
  }
  blocks.push({ kind: "figures", labelPct: 55, rows: sfp }, { kind: "pagebreak" });

  // Statement of comprehensive income
  blocks.push(...title("Statement of comprehensive income", `For the period ended ${input.periodEnd}`));
  blocks.push({ kind: "figures", labelPct: 55, rows: [headerRow(), ...pack.base.comprehensiveIncome.map((l) => row(l.label, figures(l), l.kind))] }, { kind: "pagebreak" });

  // Statement of changes in equity
  if (pack.equity) {
    blocks.push(...title("Statement of changes in equity", `For the period ended ${input.periodEnd}`));
    blocks.push(
      {
        kind: "figures",
        labelPct: 34,
        rows: [row("", [...pack.equity.columns.map((c) => c.label), "Total"], "header"), ...pack.equity.rows.map((r) => row(r.label, [...r.values.map(fmt), fmt(r.total)], r.kind))],
      },
      { kind: "pagebreak" },
    );
  }

  // Statement of cash flows
  if (pack.cashFlow) {
    blocks.push(...title("Statement of cash flows", `For the period ended ${input.periodEnd}`));
    const cf: FigureRow[] = [row("", [year], "header")];
    for (const section of pack.cashFlow.sections) {
      cf.push(row(section.title, [""], "section"));
      for (const l of section.lines) cf.push(row(l.label, [fmt(l.current)], l.kind));
    }
    cf.push(
      row("Net increase/(decrease) in cash and cash equivalents", [fmt(pack.cashFlow.netChange)], "subtotal"),
      row("Cash and cash equivalents at the start of the year", [fmt(pack.cashFlow.opening)], "line"),
      row("Cash and cash equivalents at the end of the year", [fmt(pack.cashFlow.closing)], "total"),
    );
    blocks.push({ kind: "figures", labelPct: 75, rows: cf }, { kind: "pagebreak" });
  }

  // Notes
  blocks.push({ kind: "title", text: input.clientName }, { kind: "heading", text: "Notes to the financial statements" });
  for (const note of pack.notes) {
    blocks.push({ kind: "heading", text: `${note.number}. ${note.title}`, level: 3 });
    for (const p of note.paragraphs) blocks.push({ kind: "para", text: p });
    for (const sub of note.subsections ?? []) {
      blocks.push({ kind: "para", text: sub.title, bold: true });
      for (const p of sub.paragraphs) blocks.push({ kind: "para", text: p });
    }
    if (note.table) {
      blocks.push({
        kind: "figures",
        labelPct: 60,
        rows: [
          row("", [year, ...(comparatives ? [priorYear] : [])], "header"),
          ...note.table.rows.map((r) => row(r.label, [fmt(r.current), ...(comparatives ? [r.prior === null ? "" : fmt(r.prior)] : [])], "line")),
          ...(note.table.showTotal === false ? [] : [row("Total", [fmt(note.table.totalCurrent), ...(comparatives ? [fmt(note.table.totalPrior)] : [])], "total")]),
        ],
      });
    }
  }
  return blocks;
}
