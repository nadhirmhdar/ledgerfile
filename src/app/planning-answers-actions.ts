"use server";

import { revalidatePath } from "next/cache";
import { getDb, withFirm, type Tx } from "@/server/db";
import { getSession } from "@/server/session";
import type { Session } from "@/server/repo";
import * as answers from "@/server/planning-answers";
import type { FormState } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const field = (form: FormData, name: string) => String(form.get(name) ?? "");

/** Run one questionnaire operation as the signed-in user and report the outcome to the form. */
async function run(engagementId: string, work: (tx: Tx, session: Session) => Promise<string>): Promise<FormState> {
  if (!UUID.test(engagementId)) return { ok: false, message: "Engagement not found." };
  const session = await getSession();
  let message: string;
  try {
    message = await withFirm(await getDb(), session.firmId, (tx) => work(tx, session));
  } catch (e) {
    // Messages thrown by the rules are written for users. Database errors are not shown.
    const known = e instanceof Error && !("code" in e);
    if (!known) console.error("planning questionnaire action failed:", e instanceof Error ? e.message : "unknown error");
    return { ok: false, message: known ? e.message : "Something went wrong. Please try again." };
  }
  revalidatePath(`/engagements/${engagementId}`, "layout");
  return { ok: true, message };
}

/** Save, confirm or override one answer. The reason field is read only when the answer replaces a value the app suggested. */
export async function savePlanningAnswerAction(_prev: FormState, form: FormData): Promise<FormState> {
  const engagementId = field(form, "engagementId");
  return run(engagementId, async (tx, s) => ((await answers.savePlanningAnswer(tx, s, engagementId, field(form, "key"), field(form, "value"), field(form, "reason"))) ? "Saved." : "No change: that is already the answer."));
}

export async function rebutRevenuePresumptionAction(_prev: FormState, form: FormData): Promise<FormState> {
  const engagementId = field(form, "engagementId");
  return run(engagementId, async (tx, s) => {
    await answers.rebutRevenuePresumption(tx, s, engagementId, field(form, "reason"));
    return "The presumption is rebutted, with your reason, and shown on the review page.";
  });
}

export async function reinstateRevenuePresumptionAction(_prev: FormState, form: FormData): Promise<FormState> {
  const engagementId = field(form, "engagementId");
  return run(engagementId, async (tx, s) => {
    await answers.reinstateRevenuePresumption(tx, s, engagementId);
    return "The presumption stands again.";
  });
}

export async function confirmPlanningMaterialityAction(_prev: FormState, form: FormData): Promise<FormState> {
  const engagementId = field(form, "engagementId");
  return run(engagementId, async (tx, s) => {
    const warnings = await answers.confirmPlanningMateriality(tx, s, engagementId, field(form, "rationale"));
    return ["Materiality confirmed and saved as a new revision.", ...warnings.map((w) => `Note: ${w}`)].join(" ");
  });
}
