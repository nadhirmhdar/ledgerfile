"use server";

import { revalidatePath } from "next/cache";
import { getDb, withFirm, type Tx } from "@/server/db";
import { getSession } from "@/server/session";
import { setEqReview, signEqReview, withdrawEqReview } from "@/server/eq-review";
import { otherLockBlockers } from "@/server/review";
import type { Session } from "@/server/repo";
import type { FormState } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const field = (form: FormData, name: string) => String(form.get(name) ?? "");

async function run(form: FormData, work: (tx: Tx, s: Session, id: string) => Promise<string>): Promise<FormState> {
  const id = field(form, "engagementId");
  if (!UUID.test(id)) return { ok: false, message: "Engagement not found." };
  const session = await getSession();
  try {
    const message = await withFirm(await getDb(), session.firmId, (tx) => work(tx, session, id));
    revalidatePath(`/engagements/${id}`, "layout");
    revalidatePath("/my-work");
    return { ok: true, message };
  } catch (e) {
    const known = e instanceof Error && !("code" in e);
    if (!known) console.error("engagement quality review failed:", e instanceof Error ? e.message : "unknown error");
    return { ok: false, message: known ? e.message : "Nothing was saved." };
  }
}

export async function setEqReviewAction(_prev: FormState, form: FormData): Promise<FormState> {
  return run(form, async (tx, s, id) => {
    const r = await setEqReview(tx, s, id, { required: field(form, "required") === "on", reviewerId: field(form, "reviewerId") || null });
    return r.changed ? "Saved." : "No change: this is already how it is set.";
  });
}

export async function signEqReviewAction(_prev: FormState, form: FormData): Promise<FormState> {
  return run(form, async (tx, s, id) => {
    await signEqReview(tx, s, id, field(form, "note"), () => otherLockBlockers(tx, id));
    return "Signed.";
  });
}

export async function withdrawEqReviewAction(_prev: FormState, form: FormData): Promise<FormState> {
  return run(form, async (tx, s, id) => {
    await withdrawEqReview(tx, s, id);
    return "Sign-off withdrawn.";
  });
}
