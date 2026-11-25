"use server";

import { revalidatePath } from "next/cache";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { DEFAULT_KEYS, saveFirmDefaults, setEngagementCurrency } from "@/server/statement-defaults";
import type { FormState } from "./actions";

const field = (form: FormData, name: string) => String(form.get(name) ?? "");

async function run(work: () => Promise<string>, failure: string): Promise<FormState> {
  try {
    return { ok: true, message: await work() };
  } catch (e) {
    const known = e instanceof Error && !("code" in e);
    if (!known) console.error("statement defaults failed:", e instanceof Error ? e.message : "unknown error");
    return { ok: false, message: known ? e.message : failure };
  }
}

/** Save the firm's statement defaults. The role is read again from the database and every value is checked again. */
export async function saveFirmDefaultsAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await getSession();
  const notes: Record<string, string> = {};
  for (const key of DEFAULT_KEYS) if (form.has(`note:${key}`)) notes[key] = field(form, `note:${key}`);
  return run(async () => {
    const r = await withFirm(await getDb(), session.firmId, (tx) => saveFirmDefaults(tx, session, { currency: field(form, "currency"), unit: field(form, "unit"), notes }));
    revalidatePath("/firm");
    return r.changed.length === 0 ? "No change: these are the defaults already saved." : `Saved: ${r.changed.join(", ")}. New engagements use them; existing ones are unchanged.`;
  }, "The defaults were not saved.");
}

/** A partner changes this engagement's own currency while it is open. */
export async function setEngagementCurrencyAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await getSession();
  const id = field(form, "engagementId");
  return run(async () => {
    const r = await withFirm(await getDb(), session.firmId, (tx) => setEngagementCurrency(tx, session, id, field(form, "currency")));
    revalidatePath(`/engagements/${id}/statements`);
    return r.changed ? "Currency saved." : "No change.";
  }, "The currency was not saved.");
}
