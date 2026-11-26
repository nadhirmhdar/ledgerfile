"use server";

import { revalidatePath } from "next/cache";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { recordConclusion, recordConfirmation } from "@/server/independence";
import type { FormState } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const field = (form: FormData, name: string) => String(form.get(name) ?? "");

async function run(form: FormData, work: (tx: Parameters<Parameters<typeof withFirm>[2]>[0], s: Awaited<ReturnType<typeof getSession>>, id: string) => Promise<void>, done: string): Promise<FormState> {
  const id = field(form, "engagementId");
  if (!UUID.test(id)) return { ok: false, message: "Engagement not found." };
  const session = await getSession();
  try {
    await withFirm(await getDb(), session.firmId, (tx) => work(tx, session, id));
    revalidatePath(`/engagements/${id}`);
    revalidatePath(`/engagements/${id}/review`);
    revalidatePath("/my-work");
    return { ok: true, message: done };
  } catch (e) {
    const known = e instanceof Error && !("code" in e);
    if (!known) console.error("independence record failed:", e instanceof Error ? e.message : "unknown error");
    return { ok: false, message: known ? e.message : "Nothing was recorded." };
  }
}

/** The signed-in person's own confirmation. The form carries no person: it is always the session's. */
export async function confirmIndependenceAction(_prev: FormState, form: FormData): Promise<FormState> {
  return run(form, (tx, s, id) => recordConfirmation(tx, s, id, { stage: field(form, "stage"), outcome: field(form, "outcome"), threats: field(form, "threats"), safeguards: field(form, "safeguards") }), "Recorded.");
}

export async function concludeIndependenceAction(_prev: FormState, form: FormData): Promise<FormState> {
  return run(form, (tx, s, id) => recordConclusion(tx, s, id, { stage: field(form, "stage"), conclusion: field(form, "conclusion"), note: field(form, "note") }), "Recorded.");
}
