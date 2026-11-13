import ExcelJS from "exceljs";
import { TICKMARKS, TICKMARK_BY_CODE } from "../domain/tickmarks";
import { THRESHOLDS } from "../domain/test-schedule";
import { movement } from "../domain/rollforward";
import type { ScheduleView } from "./test-schedules";

export interface ExportContext {
  clientName: string;
  periodStart: string;
  periodEnd: string;
}

const AMOUNT = "#,##0.00;(#,##0.00);0.00";
const PERCENT = "0.0%";
const BOLD = { bold: true } as const;

/**
 * A text cell is always written as text. exceljs stores a plain string as a string, never as a formula, but a client's
 * description that begins with =, +, - or @ would still be taken as a formula by anyone who saves the sheet as CSV or retypes
 * the cell, so those cells also carry the text format.
 */
function setText(cell: ExcelJS.Cell, value: string | null | undefined) {
  const text = value ?? "";
  cell.value = text;
  cell.numFmt = "@";
}

function setAmount(cell: ExcelJS.Cell, minor: number | null) {
  if (minor === null) return;
  cell.value = minor / 100;
  cell.numFmt = AMOUNT;
}

/** Sheet names: at most 31 characters, none of []:*?/\, and unique within the workbook. */
function sheetName(reference: string, used: Set<string>): string {
  const base = reference.replace(/[[\]:*?/\\]/g, "-").slice(0, 31) || "Schedule";
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 28)}-${n}`;
  used.add(name.toLowerCase());
  return name;
}

/** Write one schedule onto a worksheet: header block, line table, totals, coverage and the tickmark legend. */
function writeSchedule(sheet: ExcelJS.Worksheet, v: ScheduleView, ctx: ExportContext) {
  sheet.columns = [{ width: 16 }, { width: 44 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 10 }, { width: 14 }, { width: 28 }, { width: 36 }];

  let row = 1;
  const put = (label: string, value: string | null | undefined) => {
    const r = sheet.getRow(row++);
    r.getCell(1).value = label;
    r.getCell(1).font = BOLD;
    setText(r.getCell(2), value);
  };
  const banner = sheet.getRow(row++);
  setText(banner.getCell(1), v.reviewed ? (v.selfReviewed ? "Reviewed (self-review: no second person)" : "Reviewed") : "Draft: not reviewed");
  banner.getCell(1).font = { bold: true, color: { argb: v.reviewed ? "FF166534" : "FF991B1B" } };

  put("Client", ctx.clientName);
  put("Period", `${ctx.periodStart} to ${ctx.periodEnd}`);
  put("Reference", v.reference);
  put("Title", v.title);
  put("Area", `${v.areaCode} ${v.areaTitle}${v.groupName ? `, ${v.groupName}` : ""}`);
  put("Prepared by", v.preparedByName ? `${v.preparedByName} on ${v.preparedAt}` : "Not yet");
  put("Reviewed by", v.reviewedByName ? `${v.reviewedByName} on ${v.reviewedAt}${v.selfReviewed ? " (self-review)" : ""}` : "Not yet");
  const putAmount = (label: string, minor: number) => {
    const r = sheet.getRow(row++);
    r.getCell(1).value = label;
    r.getCell(1).font = BOLD;
    setAmount(r.getCell(2), minor);
  };
  if (v.thresholds) {
    putAmount("Overall materiality", v.thresholds.overall);
    putAmount("Performance materiality", v.thresholds.performance);
    putAmount("Half of performance materiality", v.thresholds.half_performance);
    putAmount("A quarter of performance materiality", v.thresholds.quarter_performance);
    putAmount("Key items are lines at or above", v.thresholdMinor);
    put("Key item threshold chosen", THRESHOLDS.find((x) => x.code === v.threshold)?.label ?? v.threshold);
  } else {
    put("Materiality", "Not set");
  }
  put("Objective", v.objective);
  put("Work done", v.workDone);
  put("Conclusion", v.conclusion);
  put("Explanation of difference", v.explanation);
  if (v.priorWorkDone) put("Last year's work done", v.priorWorkDone);
  row++;

  // Line table
  const hasPrior = v.comparatives !== null;
  const headers = ["Reference", "Description", "Amount", "Prior year", "Movement", "Tested", "Tickmarks", "Evidence", "Remarks"];
  const head = sheet.getRow(row++);
  headers.forEach((h, i) => {
    head.getCell(i + 1).value = h;
    head.getCell(i + 1).font = BOLD;
    head.getCell(i + 1).border = { bottom: { style: "thin" } };
  });
  const fileName = new Map(v.files.map((f) => [f.id, f.fileName]));
  for (const l of v.lines) {
    const r = sheet.getRow(row++);
    setText(r.getCell(1), l.docRef);
    setText(r.getCell(2), l.description);
    setAmount(r.getCell(3), l.amountMinor);
    if (hasPrior) {
      setAmount(r.getCell(4), l.priorAmountMinor);
      setAmount(r.getCell(5), movement(l.amountMinor, l.priorAmountMinor));
    }
    setText(r.getCell(6), l.tested ? "Yes" : "No");
    setText(r.getCell(7), l.tickmarks.map((c) => TICKMARK_BY_CODE.get(c)?.symbol ?? c).join(" "));
    setText(r.getCell(8), l.workingPaperId ? (fileName.get(l.workingPaperId) ?? "") : "");
    setText(r.getCell(9), l.remarks);
  }

  // Totals and agreement, as real numbers.
  const total = sheet.getRow(row++);
  total.getCell(2).value = "Total";
  total.getCell(2).font = BOLD;
  setAmount(total.getCell(3), v.totalMinor);
  total.getCell(3).font = BOLD;
  if (hasPrior && v.comparatives) {
    setAmount(total.getCell(4), v.comparatives.priorMinor);
    setAmount(total.getCell(5), v.comparatives.movementMinor);
  }
  total.getCell(3).border = { top: { style: "thin" } };

  if (v.balanceMinor !== null && v.differenceMinor !== null) {
    const bal = sheet.getRow(row++);
    bal.getCell(2).value = `Balance agreed to (${v.groupName ?? "lead sheet"})`;
    setAmount(bal.getCell(3), v.balanceMinor);
    const diff = sheet.getRow(row++);
    diff.getCell(2).value = "Difference";
    diff.getCell(2).font = BOLD;
    setAmount(diff.getCell(3), v.differenceMinor);
    if (v.differenceMinor !== 0) diff.getCell(3).font = { bold: true, color: { argb: "FF991B1B" } };
  }

  const cov = v.coverage;
  row++;
  const covRow = sheet.getRow(row++);
  covRow.getCell(2).value = "Coverage: value marked tested";
  setAmount(covRow.getCell(3), cov.testedMinor);
  const pctRow = sheet.getRow(row++);
  pctRow.getCell(2).value = "Coverage: share of the listing";
  if (cov.pct !== null) {
    pctRow.getCell(3).value = cov.pct / 100;
    pctRow.getCell(3).numFmt = PERCENT;
  } else {
    setText(pctRow.getCell(3), "n/a");
  }
  const keyRow = sheet.getRow(row++);
  keyRow.getCell(2).value = "Key items tested";
  keyRow.getCell(3).value = cov.keyItemsTested;
  const keyOf = sheet.getRow(row++);
  keyOf.getCell(2).value = "Key items";
  keyOf.getCell(3).value = cov.keyItems;

  row++;
  const legend = sheet.getRow(row++);
  legend.getCell(1).value = "Tickmark legend";
  legend.getCell(1).font = BOLD;
  for (const t of TICKMARKS) {
    const r = sheet.getRow(row++);
    setText(r.getCell(1), t.symbol);
    setText(r.getCell(2), t.meaning);
  }
}

/** One schedule as a workbook with one sheet, named from its reference. */
export async function buildScheduleWorkbook(views: ScheduleView[], ctx: ExportContext): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "LedgerFile";
  const used = new Set<string>();
  for (const v of views) writeSchedule(workbook.addWorksheet(sheetName(v.reference, used)), v, ctx);
  if (views.length === 0) workbook.addWorksheet("No schedules").getCell("A1").value = "There are no test schedules on this engagement.";
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
