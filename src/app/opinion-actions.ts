"use server";

import { revalidatePath } from "next/cache";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as opinion from "@/server/opinion";
import type { FormState } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const field = (form: FormData, name: string) => String(form.get(name) ?? "");

function failure(e: unknown): FormState {
  // Messages thrown by the opinion rules are written for users. Database errors are not shown.
  const known = e instanceof Error && !("code" in e);
  if (!known) console.error("opinion action failed:", e instanceof Error ? e.message : "unknown error");
  return { ok: false, message: known ? (e as Error).message : "Something went wrong. Please try again." };
}

export async function recordOpinionAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await getSession();
  const engagementId = field(form, "engagementId");
  if (!UUID.test(engagementId)) return { ok: false, message: "Engagement not found." };
  try {
    await withFirm(await getDb(), session.firmId, (tx) =>
      opinion.recordOpinion(tx, session, engagementId, {
        opinion: field(form, "opinion"),
        basisForModification: field(form, "basis"),
        goingConcern: field(form, "goingConcern") === "on",
        goingConcernNote: field(form, "goingConcernNote"),
        emphasisOfMatter: field(form, "emphasis"),
        otherMatter: field(form, "otherMatter"),
        reportDate: field(form, "reportDate"),
      }),
    );
  } catch (e) {
    return failure(e);
  }
  revalidatePath(`/engagements/${engagementId}`, "layout");
  return { ok: true, message: "The opinion is recorded." };
}

export async function clearOpinionAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await getSession();
  const engagementId = field(form, "engagementId");
  if (!UUID.test(engagementId)) return { ok: false, message: "Engagement not found." };
  try {
    await withFirm(await getDb(), session.firmId, (tx) => opinion.clearOpinion(tx, session, engagementId));
  } catch (e) {
    return failure(e);
  }
  revalidatePath(`/engagements/${engagementId}`, "layout");
  return { ok: true, message: "The opinion is cleared." };
}
