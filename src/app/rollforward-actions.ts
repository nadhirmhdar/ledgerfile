"use server";

import { revalidatePath } from "next/cache";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { rollForward, RollForwardError } from "@/server/rollforward";
import type { Created, RollProblem } from "@/domain/bulk-rollforward";

export interface RollState {
  ok: boolean;
  message: string;
  problems?: RollProblem[];
  created?: Created[];
}

/**
 * Create next year's engagements for the clients chosen, all or none. The role is read again from the database and every rule is checked again
 * on the server. A refusal creates nothing and says which client and why.
 */
export async function rollForwardAction(_prev: RollState, form: FormData): Promise<RollState> {
  const ids = form.getAll("clientId").map(String);
  const items = ids.map((clientId) => ({ clientId, start: String(form.get(`start:${clientId}`) ?? "").trim(), end: String(form.get(`end:${clientId}`) ?? "").trim() }));
  const session = await getSession();
  try {
    const created = await withFirm(await getDb(), session.firmId, (tx) => rollForward(tx, session, items));
    revalidatePath("/");
    revalidatePath("/engagements/roll-forward");
    revalidatePath("/my-work");
    return { ok: true, message: `Created ${created.length} engagement${created.length === 1 ? "" : "s"}.`, created };
  } catch (e) {
    if (e instanceof RollForwardError) return { ok: false, message: e.message, problems: e.problems };
    const known = e instanceof Error && !("code" in e);
    if (!known) console.error("roll forward failed:", e instanceof Error ? e.message : "unknown error");
    return { ok: false, message: known ? e.message : "Nothing was created. Try again." };
  }
}
