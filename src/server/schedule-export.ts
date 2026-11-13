import type { Tx } from "./db";
import { audit as log, getEngagement, type Session } from "./repo";
import { areaCodesInScope } from "./audit";
import { getSchedule, type ScheduleView } from "./test-schedules";
import { buildScheduleWorkbook } from "./schedule-xlsx";

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Only plain characters in a file name, so a client's name or a reference cannot break the header or climb a path. */
export const safePart = (text: string, fallback: string): string => text.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || fallback;

/**
 * Build the workbook for one schedule, or for every schedule on the engagement (one sheet each), and record the export.
 * Returns null when the engagement, or the named schedule on it, is not there for this firm.
 */
export async function exportSchedules(tx: Tx, s: Session, engagementId: string, scheduleId?: string): Promise<{ buffer: Buffer; fileName: string } | null> {
  const engagement = await getEngagement(tx, engagementId);
  if (!engagement) return null;

  let views: ScheduleView[];
  if (scheduleId) {
    const v = await getSchedule(tx, scheduleId);
    if (!v || v.engagementId !== engagementId) return null;
    views = [v];
  } else {
    const { rows } = await tx.query<{ id: string }>("select id from test_schedules where engagement_id = $1 order by area_code, seq", [engagementId]);
    views = [];
    // The areas in scope come from the trial balance, so work them out once for the engagement, not once per schedule.
    const inScope = rows.length > 0 ? await areaCodesInScope(tx, engagementId) : undefined;
    for (const r of rows) {
      const v = await getSchedule(tx, r.id, inScope);
      if (v) views.push(v);
    }
  }
  await log(tx, s, "export", "test_schedule", scheduleId ?? engagementId, { engagementId, schedules: views.length, reference: views.length === 1 ? views[0].reference : undefined });
  const buffer = await buildScheduleWorkbook(views, { clientName: engagement.clientName, periodStart: engagement.periodStart, periodEnd: engagement.periodEnd });
  const client = safePart(engagement.clientName, "client");
  const what = scheduleId && views[0] ? safePart(views[0].reference, "schedule") : "test-schedules";
  return { buffer, fileName: `${client}-${what}-${engagement.periodEnd}.xlsx` };
}
