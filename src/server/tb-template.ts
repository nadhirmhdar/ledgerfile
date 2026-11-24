import ExcelJS from "exceljs";
import { INSTRUCTIONS, INSTRUCTIONS_SHEET, MARKER_SHEET, MARKER_TEXT, SAMPLE_ROWS, TEMPLATE_ACCOUNT_ROWS, TEMPLATE_HEADINGS, TEMPLATE_SHEET, TEMPLATE_VERSION } from "../domain/tb-template";

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const NUMBER_FORMAT = "#,##0.00";
const TEXT_FORMAT = "@";

/**
 * The LedgerFile trial balance template as an .xlsx: the trial balance sheet (fixed headings, a frozen heading row, number and text formats, three example
 * rows that are ignored on import, and a totals row), an instructions sheet, and a hidden marker sheet that tells the app its own template. Contains no
 * client data.
 */
export async function buildTrialBalanceTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "LedgerFile";

  const ws = wb.addWorksheet(TEMPLATE_SHEET, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = TEMPLATE_HEADINGS.map((h, n) => ({ header: h, key: String(n), width: n === 1 ? 40 : n === 0 ? 14 : 18 }));
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.alignment = { vertical: "middle" };
  head.eachCell((c) => {
    c.numFmt = TEXT_FORMAT;
    c.border = { bottom: { style: "medium" } };
  });
  const last = TEMPLATE_ACCOUNT_ROWS + 1;
  for (let r = 2; r <= last; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= 6; c++) row.getCell(c).numFmt = c <= 2 ? TEXT_FORMAT : NUMBER_FORMAT;
  }
  SAMPLE_ROWS.forEach((s, n) => {
    const row = ws.getRow(n + 2);
    row.getCell(1).value = s.code;
    row.getCell(2).value = s.name;
    if (s.debit !== undefined) row.getCell(3).value = s.debit;
    if (s.credit !== undefined) row.getCell(4).value = s.credit;
    row.font = { italic: true, color: { argb: "FF595959" } };
  });
  // The totals line, below the account rows. The import skips it.
  const total = ws.getRow(last + 1);
  total.getCell(2).value = "Total";
  total.getCell(2).numFmt = TEXT_FORMAT;
  for (let c = 3; c <= 6; c++) {
    const col = String.fromCharCode(64 + c);
    const sums = c === 3 ? SAMPLE_ROWS.reduce((n, x) => n + (x.debit ?? 0), 0) : c === 4 ? SAMPLE_ROWS.reduce((n, x) => n + (x.credit ?? 0), 0) : 0;
    total.getCell(c).value = { formula: `SUM(${col}2:${col}${last})`, result: sums };
    total.getCell(c).numFmt = NUMBER_FORMAT;
  }
  total.font = { bold: true };
  total.border = { top: { style: "thin" } };

  const help = wb.addWorksheet(INSTRUCTIONS_SHEET);
  help.getColumn(1).width = 110;
  INSTRUCTIONS.forEach((line, n) => {
    const cell = help.getRow(n + 1).getCell(1);
    cell.value = line;
    cell.alignment = { wrapText: true, vertical: "top" };
    if (n === 0) cell.font = { bold: true, size: 14 };
  });

  const marker = wb.addWorksheet(MARKER_SHEET, { state: "hidden" });
  marker.getRow(1).getCell(1).value = MARKER_TEXT;
  marker.getRow(1).getCell(2).value = TEMPLATE_VERSION;

  return Buffer.from(await wb.xlsx.writeBuffer());
}
