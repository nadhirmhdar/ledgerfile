"use server";

import { revalidatePath } from "next/cache";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { approve, withdrawApproval } from "@/server/partner-approvals";
import type { FormState } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function run(form: FormData, work: typeof approve, done: string): Promise<FormState> {
  const id = String(form.get("engagementId") ?? "");
  if (!UUID.test(id)) return { ok: false, message: "Engagement not found." };
  const kind = String(form.get("approval") ?? "");
  const session = await getSession();
  try {
    await withFirm(await getDb(), session.firmId, (tx) => work(tx, session, id, kind));
    revalidatePath(`/engagements/${id}`, "layout");
    revalidatePath("/my-work");
    return { ok: true, message: done };
  } catch (e) {
    const known = e instanceof Error && !("code" in e);
    if (!known) console.error("partner approval failed:", e instanceof Error ? e.message : "unknown error");
    return { ok: false, message: known ? e.message : "Nothing was recorded." };
  }
}

export async function partnerApproveAction(_prev: FormState, form: FormData): Promise<FormState> {
  return run(form, approve, "Approved.");
}

export async function partnerWithdrawAction(_prev: FormState, form: FormData): Promise<FormState> {
  return run(form, withdrawApproval, "Approval withdrawn.");
}
