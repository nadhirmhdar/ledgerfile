"use server";

import { revalidatePath } from "next/cache";
import { getDb, withFirm, type Tx } from "@/server/db";
import { getSession } from "@/server/session";
import * as review from "@/server/review";
import { archiveEngagement } from "@/server/archiving";
import type { FormState } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const field = (form: FormData, name: string) => String(form.get(name) ?? "");

/** Run one review operation as the signed-in user and report the outcome to the form. */
async function run(form: FormData, done: string, work: (tx: Tx, actor: review.Actor, engagementId: string) => Promise<unknown>): Promise<FormState> {
  const session = await getSession();
  const engagementId = field(form, "engagementId");
  if (!UUID.test(engagementId)) return { ok: false, message: "Engagement not found." };
  try {
    await withFirm(await getDb(), session.firmId, (tx) => work(tx, session, engagementId));
  } catch (e) {
    // Messages thrown by the review rules are written for users. Database errors are not shown.
    const known = e instanceof Error && !("code" in e);
    if (!known) console.error("review action failed:", e instanceof Error ? e.message : "unknown error");
    return { ok: false, message: known ? e.message : "Something went wrong. Please try again." };
  }
  revalidatePath(`/engagements/${engagementId}`, "layout");
  return { ok: true, message: done };
}

const level = (form: FormData) => (field(form, "level") === "reviewer" ? "reviewer" : "preparer");

export async function signOffAction(_prev: FormState, form: FormData): Promise<FormState> {
  return run(form, "", (tx, actor, id) => review.signOff(tx, actor, id, field(form, "groupCode"), level(form)));
}

export async function withdrawSignOffAction(_prev: FormState, form: FormData): Promise<FormState> {
  return run(form, "", (tx, actor, id) => review.withdrawSignOff(tx, actor, id, field(form, "groupCode"), level(form)));
}

export async function addReviewPointAction(_prev: FormState, form: FormData): Promise<FormState> {
  return run(form, "Review point raised.", (tx, actor, id) => review.addReviewPoint(tx, actor, id, field(form, "target"), field(form, "body")));
}

export async function respondReviewPointAction(_prev: FormState, form: FormData): Promise<FormState> {
  const pointId = field(form, "pointId");
  if (!UUID.test(pointId)) return { ok: false, message: "Review point not found." };
  return run(form, "", (tx, actor) => review.respondToReviewPoint(tx, actor, pointId, field(form, "response")));
}

export async function clearReviewPointAction(_prev: FormState, form: FormData): Promise<FormState> {
  const pointId = field(form, "pointId");
  if (!UUID.test(pointId)) return { ok: false, message: "Review point not found." };
  return run(form, "", (tx, actor) => review.clearReviewPoint(tx, actor, pointId));
}

export async function lockAction(_prev: FormState, form: FormData): Promise<FormState> {
  return run(form, "Engagement locked.", (tx, actor, id) => review.lockEngagement(tx, actor, id, field(form, "reason")));
}

export async function unlockAction(_prev: FormState, form: FormData): Promise<FormState> {
  return run(form, "Engagement unlocked.", (tx, actor, id) => review.unlockEngagement(tx, actor, id, field(form, "reason")));
}

export async function archiveAction(_prev: FormState, form: FormData): Promise<FormState> {
  return run(form, "The file is archived.", (tx, actor, id) => archiveEngagement(tx, actor, id, field(form, "confirmation")));
}
