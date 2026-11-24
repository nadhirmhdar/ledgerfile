"use server";

import { revalidatePath } from "next/cache";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as planning from "@/server/planning";
import { BENCHMARK_ORDER } from "@/domain/planning-settings";
import type { FormState } from "./actions";

const num = (form: FormData, name: string): number => {
  const raw = String(form.get(name) ?? "").trim().replace(",", ".");
  return raw === "" ? Number.NaN : Number(raw);
};

/** The form's fields as settings: percentages typed as percent (5 or 0.5), everything else as whole numbers. The server checks every number again. */
function fromForm(form: FormData) {
  return {
    percentages: Object.fromEntries(BENCHMARK_ORDER.map((b) => [b, { minBp: Math.round(num(form, `min_${b}`) * 100), maxBp: Math.round(num(form, `max_${b}`) * 100) }])),
    performance: {
      guideMinPct: num(form, "guideMinPct"),
      guideMaxPct: num(form, "guideMaxPct"),
      defaultPct: num(form, "defaultPct"),
      reducedMinPct: num(form, "reducedMinPct"),
      reducedMaxPct: num(form, "reducedMaxPct"),
    },
    trivial: { pct: num(form, "trivialPct"), maxPct: num(form, "trivialMaxPct") },
    thresholds: {
      movementPct: num(form, "movementPct"),
      revenueDropPct: num(form, "revenueDropPct"),
      marginSwingPoints: num(form, "marginSwingPoints"),
      pbtMovementPct: num(form, "pbtMovementPct"),
      nearBreakEvenPct: num(form, "nearBreakEvenPct"),
    },
  };
}

async function run(work: (tx: Parameters<Parameters<typeof withFirm>[2]>[0], s: Awaited<ReturnType<typeof getSession>>) => Promise<void>, done: string): Promise<FormState> {
  const session = await getSession();
  try {
    await withFirm(await getDb(), session.firmId, (tx) => work(tx, session));
  } catch (e) {
    const known = e instanceof Error && !("code" in e);
    if (!known) console.error("planning settings action failed:", e instanceof Error ? e.message : "unknown error");
    return { ok: false, message: known ? e.message : "The settings were not saved." };
  }
  revalidatePath("/firm/planning");
  revalidatePath("/engagements", "layout");
  return { ok: true, message: done };
}

export async function updatePlanningSettingsAction(_prev: FormState, form: FormData): Promise<FormState> {
  return run((tx, s) => planning.updatePlanningSettings(tx, s, fromForm(form)).then(() => undefined), "Saved. The suggestions and the guide warnings use these from now on.");
}

export async function resetPlanningSettingsAction(): Promise<FormState> {
  return run((tx, s) => planning.resetPlanningSettings(tx, s), "Back to the defaults.");
}
