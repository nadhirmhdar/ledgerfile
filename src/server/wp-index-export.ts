import ExcelJS from "exceljs";
import type { Tx } from "./db";
import { audit as log, getEngagement, type Session } from "./repo";
import { buildWorkingPaperIndex } from "./wp-index";
import { setText } from "./schedule-xlsx";
import { safePart } from "./schedule-export";
import { KIND_LABEL, STATUS_LABEL, type WorkingPaperIndex } from "../domain/wp-index";

/**
 * The index as a workbook: one sheet, a heading, the counts, then the papers section by section in file order. Every cell is
 * written as text, so a file name or title that starts with =, +, - or @ is never taken as a formula.
 */
export async function buildIndexWorkbook(index: WorkingPaperIndex, ctx: { clientName: string; periodStart: string; periodEnd: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "LedgerFile";
  const sheet = wb.addWorksheet("Index");
  sheet.columns = [{ width: 11 }, { width: 44 }, { width: 20 }, { width: 22 }, { width: 13 }, { width: 22 }, { width: 13 }, { width: 15 }, { width: 60 }];

  setText(sheet.getRow(1).getCell(1), `Working paper index: ${ctx.clientName}`);
  sheet.getRow(1).getCell(1).font = { bold: true, size: 13 };
  setText(sheet.getRow(2).getCell(1), `Period ${ctx.periodStart} to ${ctx.periodEnd}. The reference scheme is a default for the firm to confirm.`);
  const o = index.overall;
  setText(
    sheet.getRow(3).getCell(1),
    `${o.total} papers: ${o.reviewed} reviewed, ${o.prepared} prepared, ${o.inProgress} in progress, ${o.notStarted} not started, ${o.notApplicable} not applicable. ${o.toReview} still to be reviewed.`,
  );

  const head = sheet.getRow(5);
  ["Reference", "Paper", "Type", "Prepared by", "Prepared on", "Reviewed by", "Reviewed on", "Status", "Note"].forEach((h, i) => {
    const c = head.getCell(i + 1);
    setText(c, h);
    c.font = { bold: true };
    c.border = { bottom: { style: "thin" } };
  });
  sheet.views = [{ state: "frozen", ySplit: 5 }];

  let r = 6;
  for (const section of index.sections) {
    const band = sheet.getRow(r++);
    setText(band.getCell(1), section.title);
    band.getCell(1).font = { bold: true };
    for (const e of section.entries) {
      const row = sheet.getRow(r++);
      const cells = [e.reference ?? "", e.title, KIND_LABEL[e.kind], e.preparedBy, e.preparedOn, e.reviewedBy, e.reviewedOn, STATUS_LABEL[e.status], e.note];
      cells.forEach((v, i) => setText(row.getCell(i + 1), v));
      row.getCell(2).alignment = { wrapText: true, vertical: "top" };
      row.getCell(9).alignment = { wrapText: true, vertical: "top" };
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Build the index workbook for an engagement and record the export. Null when the engagement is not there for this firm. */
export async function exportIndex(tx: Tx, s: Session, engagementId: string): Promise<{ buffer: Buffer; fileName: string } | null> {
  const engagement = await getEngagement(tx, engagementId);
  if (!engagement) return null;
  const index = await buildWorkingPaperIndex(tx, engagementId);
  if (!index) return null;
  await log(tx, s, "export", "working_paper_index", engagementId, { engagementId, papers: index.overall.total });
  const buffer = await buildIndexWorkbook(index, { clientName: engagement.clientName, periodStart: engagement.periodStart, periodEnd: engagement.periodEnd });
  return { buffer, fileName: `${safePart(engagement.clientName, "client")}-working-paper-index-${engagement.periodEnd}.xlsx` };
}
