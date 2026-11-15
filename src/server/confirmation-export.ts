import ExcelJS from "exceljs";
import type { Tx } from "./db";
import { audit as log, getEngagement, type Session } from "./repo";
import { confirmationSummary, listConfirmations, type ConfirmationView } from "./confirmations";
import { setText } from "./schedule-xlsx";
import { safePart } from "./schedule-export";
import { AREA_BY_CODE } from "../domain/audit";
import { todayIso } from "../domain/client-requests";
import { compareAreas, KIND_LABEL, REPLY_LABEL, STATE_LABEL, type SummaryRow } from "../domain/confirmations";

const AMOUNT = "#,##0.00;(#,##0.00);0.00";

function amount(cell: ExcelJS.Cell, minor: number | null) {
  if (minor === null) return;
  cell.value = minor / 100;
  cell.numFmt = AMOUNT;
}

/** The internal workbook: every column the page shows, with the reconciliation and alternative work, and a summary sheet by area. */
export async function buildConfirmationWorkbook(
  rows: ConfirmationView[],
  summary: { overall: SummaryRow; byArea: Map<string, SummaryRow> },
  ctx: { clientName: string; periodStart: string; periodEnd: string; asAt: string },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "LedgerFile";
  const title = (sheet: ExcelJS.Worksheet, heading: string) => {
    setText(sheet.getRow(1).getCell(1), `${heading}: ${ctx.clientName}`);
    sheet.getRow(1).getCell(1).font = { bold: true, size: 13 };
    setText(sheet.getRow(2).getCell(1), `Period ${ctx.periodStart} to ${ctx.periodEnd}. As at ${ctx.asAt}.`);
  };
  const header = (sheet: ExcelJS.Worksheet, names: string[]) => {
    const head = sheet.getRow(4);
    names.forEach((h, i) => {
      const c = head.getCell(i + 1);
      setText(c, h);
      c.font = { bold: true };
      c.border = { bottom: { style: "thin" } };
    });
    sheet.views = [{ state: "frozen", ySplit: 4 }];
  };

  const sheet = wb.addWorksheet("Confirmations");
  title(sheet, "External confirmations");
  const names = [
    "Reference", "Area", "Kind", "Party", "Contact", "Account reference", "Book balance", "Sent on", "Reminders", "Reply", "Replied on",
    "Confirmed balance", "Difference (book less confirmed)", "Reply note", "Reconciliation", "Alternative procedures", "Files", "State",
    "Prepared by", "Prepared on", "Reviewed by", "Reviewed on", "Self-reviewed",
  ];
  sheet.columns = names.map((_, i) => ({ width: [10, 28, 18, 28, 28, 18, 16, 12, 24, 12, 12, 16, 18, 36, 44, 44, 36, 16, 18, 12, 18, 12, 12][i] }));
  header(sheet, names);
  rows.forEach((c, i) => {
    const row = sheet.getRow(5 + i);
    const t = (n: number, v: string | null) => setText(row.getCell(n), v);
    t(1, c.reference);
    t(2, c.areaTitle);
    t(3, KIND_LABEL[c.kind]);
    t(4, c.partyName);
    t(5, c.contact);
    t(6, c.accountRef);
    amount(row.getCell(7), c.bookMinor);
    t(8, c.sentOn);
    t(9, c.reminders.join("; "));
    t(10, c.reply ? REPLY_LABEL[c.reply] : null);
    t(11, c.repliedOn);
    amount(row.getCell(12), c.confirmedMinor);
    amount(row.getCell(13), c.differenceMinor);
    t(14, c.replyNote);
    t(15, c.reconciliation);
    t(16, c.alternativeProcedures);
    t(17, c.files.map((f) => f.fileName).join("; "));
    t(18, STATE_LABEL[c.state]);
    t(19, c.preparedByName);
    t(20, c.preparedAt);
    t(21, c.reviewedByName);
    t(22, c.reviewedAt);
    t(23, c.selfReviewed ? "Yes" : "");
    for (const n of [14, 15, 16, 17]) row.getCell(n).alignment = { wrapText: true, vertical: "top" };
  });

  const sum = wb.addWorksheet("Summary");
  title(sum, "Confirmations by area");
  const sn = ["Area", "Confirmations", "Not sent", "Awaiting reply", "Agreed", "Differs", "No reply", "Prepared", "Reviewed", "Book total", "Confirmed total", "Net difference"];
  sum.columns = sn.map((_, i) => ({ width: i === 0 ? 34 : 15 }));
  header(sum, sn);
  const line = (r: number, label: string, s: SummaryRow, bold = false) => {
    const row = sum.getRow(r);
    setText(row.getCell(1), label);
    [s.count, s.notSent, s.awaitingReply, s.agreed, s.differs, s.noReply, s.prepared, s.reviewed].forEach((v, i) => (row.getCell(i + 2).value = v));
    amount(row.getCell(10), s.bookMinor);
    amount(row.getCell(11), s.confirmedMinor);
    amount(row.getCell(12), s.differenceMinor);
    if (bold) row.font = { bold: true };
  };
  let r = 5;
  for (const code of [...summary.byArea.keys()].sort(compareAreas)) line(r++, `${code} ${AREA_BY_CODE.get(code)?.title ?? ""}`.trim(), summary.byArea.get(code)!);
  line(r, "All areas", summary.overall, true);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Build the workbook for an engagement and record the export. Null when the engagement is not there for this firm, or the audit is off. */
export async function exportConfirmations(tx: Tx, s: Session, engagementId: string, today: string = todayIso()): Promise<{ buffer: Buffer; fileName: string } | null> {
  const engagement = await getEngagement(tx, engagementId);
  if (!engagement) return null;
  const on = await tx.query<{ on: boolean }>('select audit_enabled as "on" from engagements where id = $1', [engagementId]);
  if (!on.rows[0]?.on) return null;
  const rows = await listConfirmations(tx, engagementId);
  const summary = await confirmationSummary(tx, engagementId);
  await log(tx, s, "export", "confirmations", engagementId, { engagementId, confirmations: rows.length });
  const buffer = await buildConfirmationWorkbook(rows, summary, { clientName: engagement.clientName, periodStart: engagement.periodStart, periodEnd: engagement.periodEnd, asAt: today });
  return { buffer, fileName: `${safePart(engagement.clientName, "client")}-confirmations-${engagement.periodEnd}.xlsx` };
}
