"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, withFirm, type Tx } from "@/server/db";
import { getSession } from "@/server/session";
import type { Session } from "@/server/repo";
import * as schedules from "@/server/test-schedules";
import { readGrid } from "@/server/excel";
import { gridFromText, parseListing, type ListingLine, type ListingRejected } from "@/domain/listing-parse";
import { MAX_SCHEDULE_LINES } from "@/domain/test-schedule";
import type { FormState } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const field = (form: FormData, name: string) => String(form.get(name) ?? "");

/** Run one schedule operation as the signed-in user. Messages thrown by the rules are written for users; database errors are not shown. */
async function run<R>(work: (tx: Tx, session: Session) => Promise<R>): Promise<{ ok: true; result: R } | { ok: false; message: string }> {
  const session = await getSession();
  try {
    return { ok: true, result: await withFirm(await getDb(), session.firmId, (tx) => work(tx, session)) };
  } catch (e) {
    const known = e instanceof Error && !("code" in e);
    if (!known) console.error("test schedule action failed:", e instanceof Error ? e.message : "unknown error");
    return { ok: false, message: known ? e.message : "Something went wrong. Please try again." };
  }
}

const refresh = (engagementId: string) => revalidatePath(`/engagements/${engagementId}`, "layout");

export async function createScheduleAction(_prev: FormState, form: FormData): Promise<FormState> {
  const engagementId = field(form, "engagementId");
  if (!UUID.test(engagementId)) return { ok: false, message: "Engagement not found." };
  const areaCode = field(form, "areaCode");
  const r = await run((tx, s) =>
    schedules.createSchedule(tx, s, engagementId, { areaCode, groupCode: field(form, "groupCode") || null, title: field(form, "title"), fromTrialBalance: field(form, "fromTrialBalance") === "on" }),
  );
  if (!r.ok) return r;
  refresh(engagementId);
  redirect(`/engagements/${engagementId}/audit/${areaCode}/schedules/${r.result}`);
}

export async function updateScheduleHeaderAction(_prev: FormState, form: FormData): Promise<FormState> {
  const scheduleId = field(form, "scheduleId");
  if (!UUID.test(scheduleId)) return { ok: false, message: "Schedule not found." };
  const r = await run((tx, s) =>
    schedules.updateHeader(tx, s, scheduleId, {
      title: field(form, "title"),
      objective: field(form, "objective"),
      workDone: field(form, "workDone"),
      conclusion: field(form, "conclusion"),
      explanation: field(form, "explanation"),
      threshold: field(form, "threshold"),
    }),
  );
  if (!r.ok) return r;
  refresh(r.result);
  return { ok: true, message: "Saved." };
}

export interface LineChange {
  id: string | null;
  description: string;
  docRef: string | null;
  amountMinor: number;
  tested: boolean;
  tickmarks: string[];
  workingPaperId: string | null;
  remarks: string | null;
}

/** Save a batch of changed lines. Called from the line table with only the rows that changed. */
export async function saveLinesAction(scheduleId: string, rows: LineChange[], removeIds: string[]): Promise<FormState> {
  if (!UUID.test(scheduleId)) return { ok: false, message: "Schedule not found." };
  if (!Array.isArray(rows) || !Array.isArray(removeIds) || rows.length > MAX_SCHEDULE_LINES + 1000) return { ok: false, message: "Too many changes to save at once." };
  const engagement = await run((tx) => schedules.getScheduleEngagement(tx, scheduleId));
  if (!engagement.ok) return engagement;
  const r = await run((tx, s) => schedules.saveLines(tx, s, scheduleId, { rows, removeIds }));
  if (!r.ok) return r;
  if (engagement.result) refresh(engagement.result.engagementId);
  return { ok: true, message: `Saved ${r.result.saved} line(s)${r.result.removed > 0 ? `, removed ${r.result.removed}` : ""}.` };
}

export interface ListingPreview {
  ok: boolean;
  message: string;
  lines: ListingLine[];
  rejected: ListingRejected[];
  errors: string[];
  totalMinor: number;
}

/** Read a pasted listing or an uploaded file and show what would be imported. Nothing is saved. */
export async function previewListingAction(form: FormData): Promise<ListingPreview> {
  await getSession();
  const fail = (message: string): ListingPreview => ({ ok: false, message, lines: [], rejected: [], errors: [message], totalMinor: 0 });
  const file = form.get("file");
  const pasted = field(form, "pasted");
  let grid: unknown[][];
  if (file instanceof File && file.size > 0) {
    try {
      // A little over the line limit is read, so an over-long listing is reported and never silently cut short.
      grid = await readGrid(file.name, await file.arrayBuffer(), MAX_SCHEDULE_LINES + 200);
    } catch (e) {
      return fail(e instanceof Error ? e.message : "The file could not be read.");
    }
  } else if (pasted.trim() !== "") {
    if (pasted.length > 2_000_000) return fail("The pasted text is too long.");
    grid = gridFromText(pasted);
  } else {
    return fail("Paste the listing or choose a file.");
  }
  const parsed = parseListing(grid);
  return { ok: parsed.errors.length === 0 && parsed.lines.length > 0, message: parsed.errors[0] ?? (parsed.lines.length === 0 ? "No lines could be read." : ""), lines: parsed.lines, rejected: parsed.rejected, errors: parsed.errors, totalMinor: parsed.totalMinor };
}

/** Save a previewed listing. The server checks every row again. */
export async function importLinesAction(scheduleId: string, lines: ListingLine[], mode: string): Promise<FormState> {
  if (!UUID.test(scheduleId)) return { ok: false, message: "Schedule not found." };
  if (!Array.isArray(lines) || lines.length > MAX_SCHEDULE_LINES + 1000) return { ok: false, message: "Too many lines to import." };
  const engagement = await run((tx) => schedules.getScheduleEngagement(tx, scheduleId));
  if (!engagement.ok) return engagement;
  const r = await run((tx, s) => schedules.importLines(tx, s, scheduleId, lines, mode === "replace" ? "replace" : mode === "match" ? "match" : "append"));
  if (!r.ok) return r;
  if (engagement.result) refresh(engagement.result.engagementId);
  if (r.result.matched !== undefined) return { ok: true, message: `Imported ${r.result.imported.toLocaleString("en-US")} line(s): ${r.result.matched.toLocaleString("en-US")} put against last year's lines, ${(r.result.added ?? 0).toLocaleString("en-US")} added as new.` };
  return { ok: true, message: `Imported ${r.result.imported.toLocaleString("en-US")} line(s)${r.result.replaced > 0 ? `, replacing ${r.result.replaced.toLocaleString("en-US")}` : ""}.` };
}

export async function bringForwardAction(_prev: FormState, form: FormData): Promise<FormState> {
  const engagementId = field(form, "engagementId");
  if (!UUID.test(engagementId)) return { ok: false, message: "Engagement not found." };
  const r = await run((tx, s) => schedules.bringForwardSchedules(tx, s, engagementId));
  if (!r.ok) return r;
  refresh(engagementId);
  const { created, alreadyBrought, lines, outOfScope } = r.result;
  if (created === 0) return { ok: true, message: alreadyBrought > 0 ? `Nothing new: all ${alreadyBrought} schedule(s) from last year have already been brought forward.` : "Last year's engagement has no test schedules to bring forward." };
  return { ok: true, message: `Brought forward ${created} schedule(s) with ${lines.toLocaleString("en-US")} line(s)${alreadyBrought > 0 ? `; ${alreadyBrought} already brought forward earlier` : ""}${outOfScope > 0 ? `. ${outOfScope} are for areas no longer in scope this year and are flagged` : ""}.` };
}

export async function reviewScheduleAction(_prev: FormState, form: FormData): Promise<FormState> {
  const scheduleId = field(form, "scheduleId");
  if (!UUID.test(scheduleId)) return { ok: false, message: "Schedule not found." };
  const withdraw = field(form, "withdraw") === "true";
  const r = await run((tx, s) => (withdraw ? schedules.unreviewSchedule(tx, s, scheduleId) : schedules.reviewSchedule(tx, s, scheduleId)));
  if (!r.ok) return r;
  refresh(r.result);
  return { ok: true, message: withdraw ? "Review withdrawn." : "Reviewed." };
}

export async function deleteScheduleAction(_prev: FormState, form: FormData): Promise<FormState> {
  const scheduleId = field(form, "scheduleId");
  if (!UUID.test(scheduleId)) return { ok: false, message: "Schedule not found." };
  const r = await run((tx, s) => schedules.deleteSchedule(tx, s, scheduleId));
  if (!r.ok) return r;
  refresh(r.result.engagementId);
  redirect(`/engagements/${r.result.engagementId}/audit/${r.result.areaCode}`);
}
