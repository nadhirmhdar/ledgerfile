import ExcelJS from "exceljs";
import { parseCsv } from "../domain/tb-parse";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 20000;

/** Reduce an Excel cell to a plain value: formulas to their result, rich text to its text. */
function plain(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if ("result" in value) return plain(value.result as ExcelJS.CellValue);
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  if ("text" in value) return value.text;
  if ("error" in value) return String(value.error);
  return null;
}

/** Read the first worksheet of an .xlsx file, or a .csv file, into a grid of cells. */
export async function readGrid(fileName: string, data: ArrayBuffer): Promise<unknown[][]> {
  if (data.byteLength === 0) throw new Error("The file is empty.");
  if (data.byteLength > MAX_BYTES) throw new Error("The file is larger than 10 MB.");
  const lower = fileName.toLowerCase();

  if (lower.endsWith(".csv")) {
    return parseCsv(new TextDecoder("utf-8").decode(data)).slice(0, MAX_ROWS);
  }
  if (lower.endsWith(".xls")) {
    throw new Error("Old-format .xls files are not supported. Save the file as .xlsx or .csv and upload it again.");
  }
  if (!lower.endsWith(".xlsx")) {
    throw new Error("Upload an Excel (.xlsx) or CSV (.csv) file.");
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(data);
  } catch {
    throw new Error("The file could not be read as an Excel workbook.");
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("The workbook has no worksheets.");

  const grid: unknown[][] = [];
  const columns = Math.min(sheet.columnCount, 50);
  const last = Math.min(sheet.rowCount, MAX_ROWS);
  for (let r = 1; r <= last; r++) {
    const row = sheet.getRow(r);
    const cells: unknown[] = [];
    for (let c = 1; c <= columns; c++) cells.push(plain(row.getCell(c).value));
    grid.push(cells);
  }
  return grid;
}
