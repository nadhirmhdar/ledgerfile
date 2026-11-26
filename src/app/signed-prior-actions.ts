"use server";

import { revalidatePath } from "next/cache";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { saveSignedPrior } from "@/server/signed-prior";
import type { FormState } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIX = "amount:";

/** Save the signed prior-year figures typed on the statements page. Every rule is checked again on the server. */
export async function saveSignedPriorAction(_prev: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get("engagementId") ?? "");
  if (!UUID.test(id)) return { ok: false, message: "Engagement not found." };
  const amounts: Record<string, string> = {};
  for (const [name, value] of form.entries()) if (name.startsWith(PREFIX)) amounts[name.slice(PREFIX.length)] = String(value);
  const session = await getSession();
  try {
    const result = await withFirm(await getDb(), session.firmId, (tx) => saveSignedPrior(tx, session, id, { amounts }));
    revalidatePath(`/engagements/${id}/statements`);
    revalidatePath(`/engagements/${id}`);
    return { ok: true, message: result.changed.length === 0 ? "No change: these are the figures already saved." : `Saved: ${result.changed.length} ${result.changed.length === 1 ? "figure" : "figures"}.` };
  } catch (e) {
    const known = e instanceof Error && !("code" in e);
    if (!known) console.error("signed prior figures failed:", e instanceof Error ? e.message : "unknown error");
    return { ok: false, message: known ? e.message : "The figures were not saved." };
  }
}
