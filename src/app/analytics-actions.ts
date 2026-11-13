"use server";

import { revalidatePath } from "next/cache";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as analytics from "@/server/analytics";
import type { FormState } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const field = (form: FormData, name: string) => String(form.get(name) ?? "");

/** Run one analytical review write as the signed-in user and report the outcome to the form. */
async function run(engagementId: string, done: string, work: (tx: Parameters<Parameters<typeof withFirm>[2]>[0], session: Awaited<ReturnType<typeof getSession>>) => Promise<unknown>): Promise<FormState> {
  const session = await getSession();
  try {
    await withFirm(await getDb(), session.firmId, (tx) => work(tx, session));
  } catch (e) {
    // Messages thrown by the audit rules are written for users. Database errors are not shown.
    const known = e instanceof Error && !("code" in e);
    if (!known) console.error("analytical review action failed:", e instanceof Error ? e.message : "unknown error");
    return { ok: false, message: known ? e.message : "Something went wrong. Please try again." };
  }
  revalidatePath(`/engagements/${engagementId}`, "layout");
  return { ok: true, message: done };
}

export async function saveExplanationAction(_prev: FormState, form: FormData): Promise<FormState> {
  const engagementId = field(form, "engagementId");
  if (!UUID.test(engagementId)) return { ok: false, message: "Engagement not found." };
  return run(engagementId, "Explanation saved.", (tx, session) => analytics.saveExplanation(tx, session, engagementId, field(form, "lineKey"), field(form, "explanation")));
}

export async function reconfirmExplanationAction(_prev: FormState, form: FormData): Promise<FormState> {
  const engagementId = field(form, "engagementId");
  if (!UUID.test(engagementId)) return { ok: false, message: "Engagement not found." };
  return run(engagementId, "Explanation re-confirmed.", (tx, session) => analytics.reconfirmExplanation(tx, session, engagementId, field(form, "lineKey")));
}
