import ExcelJS from "exceljs";
import { parseCsv } from "../domain/tb-parse";
import { maxUploadBytes, uploadTooLargeMessage } from "./config";

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

const MAX_SHEETS = 10;

/** Read every worksheet of an .xlsx file (up to ten), or a .csv file (one sheet), each as a grid of cells. Old .xls files are refused. */
/**
 * `keepIndent` puts two spaces in front of a text cell for each level of indent the cell has in Excel, so a reader of the grid can tell a group line from
 * the accounts indented below it (a CSV shows its own leading spaces). Readers that trim text, as the plain detection does, are not affected.
 */
export async function readSheets(fileName: string, data: ArrayBuffer, maxRows: number = MAX_ROWS, options: { keepIndent?: boolean } = {}): Promise<{ name: string; rows: unknown[][] }[]> {
  if (data.byteLength === 0) throw new Error("The file is empty.");
  if (data.byteLength > maxUploadBytes()) throw new Error(uploadTooLargeMessage());
  const lower = fileName.toLowerCase();

  if (lower.endsWith(".csv")) {
    return [{ name: "Sheet1", rows: parseCsv(new TextDecoder("utf-8").decode(data)).slice(0, maxRows) }];
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
  if (workbook.worksheets.length === 0) throw new Error("The workbook has no worksheets.");

  return workbook.worksheets.slice(0, MAX_SHEETS).map((sheet) => {
    const grid: unknown[][] = [];
    const columns = Math.min(sheet.columnCount, 50);
    const last = Math.min(sheet.rowCount, maxRows);
    for (let r = 1; r <= last; r++) {
      const row = sheet.getRow(r);
      const cells: unknown[] = [];
      for (let c = 1; c <= columns; c++) {
        const cell = row.getCell(c);
        const value = plain(cell.value);
        const indent = options.keepIndent ? (cell.alignment?.indent ?? 0) : 0;
        cells.push(typeof value === "string" && indent > 0 ? " ".repeat(indent * 2) + value : value);
      }
      grid.push(cells);
    }
    return { name: sheet.name, rows: grid };
  });
}

/** Read the first worksheet of an .xlsx file, or a .csv file, into a grid of cells. */
export async function readGrid(fileName: string, data: ArrayBuffer, maxRows: number = MAX_ROWS): Promise<unknown[][]> {
  return (await readSheets(fileName, data, maxRows))[0].rows;
}
