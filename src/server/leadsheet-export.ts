import ExcelJS from "exceljs";
import type { Tx } from "./db";
import { audit as log, getEngagement, listAccounts, type Session } from "./repo";
import { getOverview, type LeadSheetReview } from "./review";
import { PERCENT, setAmount, setText } from "./schedule-xlsx";
import { plainName } from "./http";
import { STATEMENT_NAME } from "../domain/groups";
import { buildLeadSheets, variancePct, type LeadSheetSet, type MappedAccount } from "../domain/leadsheet";

/**
 * The lead sheets as a workbook: a Summary sheet, one sheet for each lead sheet in statement order, and an Unmapped sheet when some accounts are
 * not on any lead sheet. The figures come from buildLeadSheets on the adjusted balances, exactly as the lead sheets page computes them; nothing is
 * worked out a second way. Amounts are numbers in major units with two decimals, and totals are plain numbers (not formulas), so the file shows the
 * same figures as the screen. Every piece of text is written as text, so a name that starts with = is never taken as a formula.
 */

export interface LeadSheetSignOff {
  preparer: { name: string; at: string } | null;
  reviewer: { name: string; at: string } | null;
  openPoints: number;
}

export interface LeadSheetExportContext {
  firmName: string;
  clientName: string;
  periodStart: string;
  periodEnd: string;
  /** Journal adjustments are included in the balances. */
  hasAdjustments: boolean;
  /** Sign-off for each lead sheet, by group code; a sheet with no entry has none. */
  signOffs?: Map<string, LeadSheetSignOff>;
}

const BOLD = { bold: true } as const;
const SUMMARY = "Summary";
const UNMAPPED = "Unmapped";

/**
 * A worksheet name Excel accepts: at most 31 characters, none of \ / ? * [ ] :, not starting or ending with an apostrophe, never empty, and unique in
 * the workbook whatever the case (names already in `used`, lower-cased, are taken). The name is recorded in `used`.
 */
export function leadSheetSheetName(base: string, used: Set<string>): string {
  const cleaned = base
    .replace(/[\\/?*[\]:]/g, "-")
    .trim()
    .replace(/^'+|'+$/g, "")
    .trim();
  const stem = cleaned.slice(0, 31) || "Sheet";
  let name = stem;
  for (let n = 2; used.has(name.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    name = `${stem.slice(0, 31 - suffix.length)}${suffix}`;
  }
  used.add(name.toLowerCase());
  return name;
}

function fitToWidth(sheet: ExcelJS.Worksheet) {
  sheet.pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

const pct = (cell: ExcelJS.Cell, value: number | null) => {
  if (value === null) return;
  cell.value = value / 100;
  cell.numFmt = PERCENT;
};

function heading(sheet: ExcelJS.Worksheet, row: number, labels: string[], numericFrom: number) {
  const r = sheet.getRow(row);
  labels.forEach((h, i) => {
    const c = r.getCell(i + 1);
    setText(c, h);
    c.font = BOLD;
    c.border = { bottom: { style: "thin" } };
    if (i + 1 >= numericFrom) c.alignment = { horizontal: "right", wrapText: true };
  });
}

/** The account rows of one sheet, with the total, from the lead sheet itself. Returns the next free row. */
function writeAccounts(sheet: ExcelJS.Worksheet, accounts: MappedAccount[], totals: { closingMinor: number; priorMinor: number; adjustmentMinor: number } | null, hasAdjustments: boolean, start: number): number {
  let r = start;
  const adj = hasAdjustments ? 2 : 0;
  for (const a of accounts) {
    const row = sheet.getRow(r++);
    setText(row.getCell(1), a.code);
    setText(row.getCell(2), a.name);
    if (hasAdjustments) {
      setAmount(row.getCell(3), a.closingMinor - (a.adjustmentMinor ?? 0));
      if (a.adjustmentMinor) setAmount(row.getCell(4), a.adjustmentMinor);
    }
    setAmount(row.getCell(3 + adj), a.closingMinor);
    setAmount(row.getCell(4 + adj), a.priorMinor);
    setAmount(row.getCell(5 + adj), a.closingMinor - (a.priorMinor ?? 0));
    pct(row.getCell(6 + adj), variancePct(a.closingMinor, a.priorMinor ?? 0));
  }
  if (totals) {
    const row = sheet.getRow(r++);
    setText(row.getCell(1), "Total");
    row.getCell(1).font = BOLD;
    // Every amount column adds up: per trial balance plus adjustments is the adjusted total.
    if (hasAdjustments) {
      setAmount(row.getCell(3), totals.closingMinor - totals.adjustmentMinor);
      setAmount(row.getCell(4), totals.adjustmentMinor);
    }
    setAmount(row.getCell(3 + adj), totals.closingMinor);
    setAmount(row.getCell(4 + adj), totals.priorMinor);
    setAmount(row.getCell(5 + adj), totals.closingMinor - totals.priorMinor);
    pct(row.getCell(6 + adj), variancePct(totals.closingMinor, totals.priorMinor));
    for (let c = 1; c <= 6 + adj; c++) {
      row.getCell(c).font = BOLD;
      row.getCell(c).border = { top: { style: "thin" }, bottom: { style: "double" } };
    }
  }
  return r;
}

const accountColumns = (hasAdjustments: boolean) =>
  hasAdjustments ? ["Code", "Account", "Per trial balance", "Adjustments", "Adjusted", "Prior year", "Movement", "Movement %"] : ["Code", "Account", "Closing", "Prior year", "Movement", "Movement %"];
const accountWidths = (hasAdjustments: boolean) => (hasAdjustments ? [12, 44, 18, 16, 18, 18, 18, 12] : [12, 44, 18, 18, 18, 12]);

function titleBlock(sheet: ExcelJS.Worksheet, ctx: LeadSheetExportContext, title: string, line2: string): number {
  setText(sheet.getRow(1).getCell(1), title);
  sheet.getRow(1).getCell(1).font = { bold: true, size: 13 };
  setText(sheet.getRow(2).getCell(1), line2);
  setText(sheet.getRow(3).getCell(1), `${ctx.clientName}, period ${ctx.periodStart} to ${ctx.periodEnd}${ctx.hasAdjustments ? ". Balances include journal adjustments." : ""}`);
  return 5; // the heading row
}

/** Build the workbook. Pure: it needs no database, only the lead sheets as the page computes them. */
export async function buildLeadSheetWorkbook(set: LeadSheetSet, ctx: LeadSheetExportContext): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "LedgerFile";
  const used = new Set<string>([SUMMARY.toLowerCase(), UNMAPPED.toLowerCase()]);

  // --- Summary -------------------------------------------------------------------------------------------------------------------
  const summary = wb.addWorksheet(SUMMARY);
  const adj = ctx.hasAdjustments;
  const labels = ["Lead sheet", "Statement", "Section", adj ? "Adjusted" : "Closing", "Prior year", "Movement", "Movement %", "Prepared by", "Prepared on", "Reviewed by", "Reviewed on", "Open review points"];
  summary.columns = [{ width: 34 }, { width: 22 }, { width: 24 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 12 }, { width: 22 }, { width: 13 }, { width: 22 }, { width: 13 }, { width: 12 }];
  const headRow = titleBlock(summary, ctx, `Lead sheets: ${ctx.clientName}`, ctx.firmName);
  heading(summary, headRow, labels, 4);
  summary.getRow(headRow).height = 30;
  summary.views = [{ state: "frozen", ySplit: headRow }];
  fitToWidth(summary);

  const sheetNames = new Map<string, string>();
  for (const s of set.sheets) sheetNames.set(s.groupCode, leadSheetSheetName(s.groupName, used));

  let r = headRow + 1;
  let priorTotal = 0;
  for (const s of set.sheets) {
    const row = summary.getRow(r++);
    const sign = ctx.signOffs?.get(s.groupCode);
    setText(row.getCell(1), s.groupName);
    setText(row.getCell(2), STATEMENT_NAME[s.statement as keyof typeof STATEMENT_NAME] ?? s.statement);
    setText(row.getCell(3), s.section);
    setAmount(row.getCell(4), s.closingMinor);
    setAmount(row.getCell(5), s.priorMinor);
    setAmount(row.getCell(6), s.varianceMinor);
    pct(row.getCell(7), s.variancePct);
    setText(row.getCell(8), sign?.preparer?.name ?? "");
    setText(row.getCell(9), sign?.preparer?.at ?? "");
    setText(row.getCell(10), sign?.reviewer?.name ?? "");
    setText(row.getCell(11), sign?.reviewer?.at ?? "");
    row.getCell(12).value = sign?.openPoints ?? 0;
    priorTotal += s.priorMinor;
  }
  if (set.unmapped.length > 0) {
    const closing = set.unmapped.reduce((n, a) => n + a.closingMinor, 0);
    const prior = set.unmapped.reduce((n, a) => n + (a.priorMinor ?? 0), 0);
    priorTotal += prior;
    const row = summary.getRow(r++);
    setText(row.getCell(1), "Accounts not on any lead sheet");
    setText(row.getCell(2), "Unmapped");
    setAmount(row.getCell(4), closing);
    setAmount(row.getCell(5), prior);
    setAmount(row.getCell(6), closing - prior);
    pct(row.getCell(7), variancePct(closing, prior));
  }
  const total = summary.getRow(r++);
  setText(total.getCell(1), "Total");
  setAmount(total.getCell(4), set.totalMinor);
  setAmount(total.getCell(5), priorTotal);
  setAmount(total.getCell(6), set.totalMinor - priorTotal);
  pct(total.getCell(7), variancePct(set.totalMinor, priorTotal));
  for (let c = 1; c <= 12; c++) {
    total.getCell(c).font = BOLD;
    total.getCell(c).border = { top: { style: "thin" }, bottom: { style: "double" } };
  }
  r++;
  setText(
    summary.getRow(r).getCell(1),
    set.tiesToTrialBalance ? "The lead sheet totals agree to the trial balance." : "The lead sheet totals do not agree to the trial balance. Check that every account is mapped and that the trial balance was read correctly.",
  );
  summary.getRow(r).getCell(1).font = { bold: true, color: { argb: set.tiesToTrialBalance ? "FF166534" : "FF991B1B" } };

  // --- One sheet for each lead sheet, in statement order ------------------------------------------------------------------------------
  for (const s of set.sheets) {
    const sheet = wb.addWorksheet(sheetNames.get(s.groupCode)!);
    sheet.columns = accountWidths(adj).map((width) => ({ width }));
    const head = titleBlock(sheet, ctx, s.groupName, `${STATEMENT_NAME[s.statement as keyof typeof STATEMENT_NAME] ?? s.statement}, ${s.section}`);
    heading(sheet, head, accountColumns(adj), 3);
    sheet.views = [{ state: "frozen", ySplit: head }];
    writeAccounts(sheet, s.accounts, { closingMinor: s.closingMinor, priorMinor: s.priorMinor, adjustmentMinor: s.accounts.reduce((n, a) => n + (a.adjustmentMinor ?? 0), 0) }, adj, head + 1);
    fitToWidth(sheet);
  }

  // --- Unmapped, only when there are some --------------------------------------------------------------------------------------------
  if (set.unmapped.length > 0) {
    const sheet = wb.addWorksheet(UNMAPPED);
    sheet.columns = accountWidths(adj).map((width) => ({ width }));
    const head = titleBlock(sheet, ctx, "Unmapped accounts", "These accounts are not on any lead sheet yet. Map them on the trial balance page.");
    heading(sheet, head, accountColumns(adj), 3);
    sheet.views = [{ state: "frozen", ySplit: head }];
    const sorted = [...set.unmapped].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    writeAccounts(sheet, sorted, null, adj, head + 1);
    fitToWidth(sheet);
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** The sign-off data of the Review page, by group code. */
export function signOffsOf(leadSheets: LeadSheetReview[]): Map<string, LeadSheetSignOff> {
  return new Map(
    leadSheets.map((l) => [l.groupCode, { preparer: l.preparer ? { name: l.preparer.name, at: l.preparer.at } : null, reviewer: l.reviewer ? { name: l.reviewer.name, at: l.reviewer.at } : null, openPoints: l.openPoints }]),
  );
}

/** Build the workbook for an engagement and record the export. Null when the engagement is not there for this firm, or has no trial balance. */
export async function exportLeadSheets(tx: Tx, s: Session, engagementId: string): Promise<{ buffer: Buffer; fileName: string } | null> {
  const engagement = await getEngagement(tx, engagementId);
  if (!engagement) return null;
  const accounts = await listAccounts(tx, engagementId);
  if (accounts.length === 0) return null;
  const overview = await getOverview(tx, engagementId);
  const firm = await tx.query<{ name: string }>("select name from firms");
  // The same balances as the lead sheets page: the trial balance plus journal adjustments.
  const set = buildLeadSheets(accounts.map((a) => ({ ...a, closingMinor: a.closingMinor + a.adjustmentMinor })));
  const hasAdjustments = accounts.some((a) => a.adjustmentMinor !== 0);
  await log(tx, s, "export", "lead_sheets", engagementId, { sheets: set.sheets.length, unmapped: set.unmapped.length });
  const buffer = await buildLeadSheetWorkbook(set, {
    firmName: firm.rows[0]?.name ?? "",
    clientName: engagement.clientName,
    periodStart: engagement.periodStart,
    periodEnd: engagement.periodEnd,
    hasAdjustments,
    signOffs: signOffsOf(overview?.leadSheets ?? []),
  });
  return { buffer, fileName: `Lead sheets - ${plainName(engagement.clientName)} - ${engagement.periodEnd}.xlsx` };
}
