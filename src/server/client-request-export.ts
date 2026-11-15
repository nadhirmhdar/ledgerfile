import ExcelJS from "exceljs";
import type { Tx } from "./db";
import { audit as log, getEngagement, type Session } from "./repo";
import { listRequests, type RequestView } from "./client-requests";
import { setText } from "./schedule-xlsx";
import { safePart } from "./schedule-export";
import { STATUS_LABEL, todayIso } from "../domain/client-requests";

/**
 * The sheet the firm sends to the client. It carries what the client needs to answer (reference, area, wording, dates, status
 * and the names of the files received) and leaves out the internal note, which may say why the firm decided something.
 */
export async function buildRequestWorkbook(requests: RequestView[], ctx: { clientName: string; periodStart: string; periodEnd: string; asAt: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "LedgerFile";
  const sheet = wb.addWorksheet("Requests");
  sheet.columns = [{ width: 8 }, { width: 34 }, { width: 70 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 14 }, { width: 44 }];

  const title = sheet.getRow(1);
  setText(title.getCell(1), `Information requested from ${ctx.clientName}`);
  title.getCell(1).font = { bold: true, size: 13 };
  setText(sheet.getRow(2).getCell(1), `Period ${ctx.periodStart} to ${ctx.periodEnd}. Status as at ${ctx.asAt}.`);

  const head = sheet.getRow(4);
  ["Reference", "Area", "Description", "Requested on", "Due", "Status", "Received on", "Files received"].forEach((h, i) => {
    const c = head.getCell(i + 1);
    setText(c, h);
    c.font = { bold: true };
    c.border = { bottom: { style: "thin" } };
  });
  sheet.views = [{ state: "frozen", ySplit: 4 }];

  requests.forEach((r, i) => {
    const row = sheet.getRow(5 + i);
    setText(row.getCell(1), r.reference);
    setText(row.getCell(2), r.areaTitle);
    setText(row.getCell(3), r.description);
    setText(row.getCell(4), r.requestedOn);
    setText(row.getCell(5), r.dueOn);
    setText(row.getCell(6), r.overdue ? `${STATUS_LABEL[r.status]} (overdue)` : STATUS_LABEL[r.status]);
    setText(row.getCell(7), r.receivedOn);
    setText(row.getCell(8), r.files.map((f) => f.fileName).join("; "));
    row.getCell(3).alignment = { wrapText: true, vertical: "top" };
    row.getCell(8).alignment = { wrapText: true, vertical: "top" };
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Build the request list workbook for an engagement and record the export. Null when the engagement is not there for this firm. */
export async function exportRequests(tx: Tx, s: Session, engagementId: string, today: string = todayIso()): Promise<{ buffer: Buffer; fileName: string } | null> {
  const engagement = await getEngagement(tx, engagementId);
  if (!engagement) return null;
  const requests = await listRequests(tx, engagementId, today);
  await log(tx, s, "export", "client_requests", engagementId, { engagementId, requests: requests.length });
  const buffer = await buildRequestWorkbook(requests, { clientName: engagement.clientName, periodStart: engagement.periodStart, periodEnd: engagement.periodEnd, asAt: today });
  return { buffer, fileName: `${safePart(engagement.clientName, "client")}-client-requests-${engagement.periodEnd}.xlsx` };
}
