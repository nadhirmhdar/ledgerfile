"use server";

import { revalidatePath } from "next/cache";
import { getDb, withFirm, type Tx } from "@/server/db";
import { getSession } from "@/server/session";
import type { Session } from "@/server/repo";
import * as audit from "@/server/audit";
import { ASSERTIONS } from "@/domain/audit";
import { parseAmount } from "@/domain/money";
import type { FormState } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const field = (form: FormData, name: string) => String(form.get(name) ?? "");

/** Run one audit operation as the signed-in user and report the outcome to the form. */
async function run(done: (result: unknown) => string, work: (tx: Tx, session: Session) => Promise<unknown>, engagementId: () => string | Promise<string>): Promise<FormState> {
  const session = await getSession();
  let result: unknown;
  try {
    result = await withFirm(await getDb(), session.firmId, (tx) => work(tx, session));
  } catch (e) {
    // Messages thrown by the audit rules are written for users. Database errors are not shown.
    const known = e instanceof Error && !("code" in e);
    if (!known) console.error("audit action failed:", e instanceof Error ? e.message : "unknown error");
    return { ok: false, message: known ? e.message : "Something went wrong. Please try again." };
  }
  revalidatePath(`/engagements/${await engagementId()}`, "layout");
  return { ok: true, message: done(result) };
}

export async function setAuditEnabledAction(_prev: FormState, form: FormData): Promise<FormState> {
  const engagementId = field(form, "engagementId");
  if (!UUID.test(engagementId)) return { ok: false, message: "Engagement not found." };
  const on = field(form, "on") === "true";
  return run(
    () => (on ? "Audit turned on." : "Audit turned off."),
    (tx, session) => audit.setAuditEnabled(tx, session, engagementId, on),
    () => engagementId,
  );
}

export async function setMaterialityAction(_prev: FormState, form: FormData): Promise<FormState> {
  const engagementId = field(form, "engagementId");
  if (!UUID.test(engagementId)) return { ok: false, message: "Engagement not found." };
  // The percentage is typed as, for example, 1.5; it is stored in hundredths of a percent.
  const percentage = Number(field(form, "percentage"));
  if (!Number.isFinite(percentage)) return { ok: false, message: "Enter the percentage of the benchmark as a number." };
  return run(
    (warnings) => ["Materiality saved.", ...(warnings as string[]).map((w) => `Note: ${w}`)].join(" "),
    (tx, session) =>
      audit.setMateriality(tx, session, engagementId, {
        benchmark: field(form, "benchmark"),
        percentageBp: Math.round(percentage * 100),
        performancePct: Math.round(Number(field(form, "performancePct"))),
        trivialPct: Math.round(Number(field(form, "trivialPct"))),
        rationale: field(form, "rationale"),
      }),
    () => engagementId,
  );
}

export async function setAreaRisksAction(_prev: FormState, form: FormData): Promise<FormState> {
  const engagementId = field(form, "engagementId");
  if (!UUID.test(engagementId)) return { ok: false, message: "Engagement not found." };
  const levels = Object.fromEntries(ASSERTIONS.map((a) => [a.code, field(form, `risk-${a.code}`)]).filter(([, v]) => v !== ""));
  return run(
    (r) => {
      const { added, removed } = r as { added: number; removed: number };
      return `Saved. ${added} procedure(s) loaded${removed > 0 ? `, ${removed} removed` : ""}.`;
    },
    (tx, session) => audit.setAreaRisks(tx, session, engagementId, field(form, "areaCode"), levels),
    () => engagementId,
  );
}

export async function approveRiskAssessmentAction(_prev: FormState, form: FormData): Promise<FormState> {
  const engagementId = field(form, "engagementId");
  if (!UUID.test(engagementId)) return { ok: false, message: "Engagement not found." };
  return run(
    () => "Risk assessment approved.",
    (tx, session) => audit.approveRiskAssessment(tx, session, engagementId),
    () => engagementId,
  );
}

export async function addMisstatementAction(_prev: FormState, form: FormData): Promise<FormState> {
  const engagementId = field(form, "engagementId");
  if (!UUID.test(engagementId)) return { ok: false, message: "Engagement not found." };
  const amount = parseAmount(field(form, "amount"));
  if (amount === null || Number.isNaN(amount) || amount <= 0) return { ok: false, message: "Enter the amount as a positive number, and choose its direction." };
  // The direction says which way profit is wrong; the amount itself is always typed as positive.
  const signed = field(form, "direction") === "understated" ? -amount : amount;
  return run(
    () => "Misstatement recorded.",
    (tx, session) => audit.addMisstatement(tx, session, engagementId, { description: field(form, "description"), kind: field(form, "kind"), amountMinor: signed }),
    () => engagementId,
  );
}

export async function setMisstatementCorrectedAction(_prev: FormState, form: FormData): Promise<FormState> {
  const misstatementId = field(form, "misstatementId");
  if (!UUID.test(misstatementId)) return { ok: false, message: "Misstatement not found." };
  let engagementId = "";
  return run(
    () => "",
    async (tx, session) => {
      engagementId = await audit.setMisstatementCorrected(tx, session, misstatementId, field(form, "corrected") === "true");
    },
    () => engagementId,
  );
}

export async function reviewProcedureAction(_prev: FormState, form: FormData): Promise<FormState> {
  const procedureId = field(form, "procedureId");
  if (!UUID.test(procedureId)) return { ok: false, message: "Procedure not found." };
  const withdraw = field(form, "withdraw") === "true";
  let engagementId = "";
  return run(
    () => (withdraw ? "Review withdrawn." : "Reviewed."),
    async (tx, session) => {
      engagementId = withdraw ? await audit.unreviewProcedure(tx, session, procedureId) : await audit.reviewProcedure(tx, session, procedureId);
    },
    () => engagementId,
  );
}

export async function reviewAreaAction(_prev: FormState, form: FormData): Promise<FormState> {
  const engagementId = field(form, "engagementId");
  if (!UUID.test(engagementId)) return { ok: false, message: "Engagement not found." };
  return run(
    (r) => {
      const { reviewed, skipped } = r as { reviewed: number; skipped: number };
      return `Reviewed ${reviewed}.${skipped > 0 ? ` Skipped ${skipped} you did yourself: another reviewer needs to review those.` : ""}`;
    },
    (tx, session) => audit.reviewArea(tx, session, engagementId, field(form, "areaCode")),
    () => engagementId,
  );
}

export async function updateProcedureAction(_prev: FormState, form: FormData): Promise<FormState> {
  const procedureId = field(form, "procedureId");
  if (!UUID.test(procedureId)) return { ok: false, message: "Procedure not found." };
  // Each button on the form carries the status it sets.
  const status = field(form, "status");
  let engagementId = "";
  return run(
    () => (status === "done" ? "Marked completed." : status === "na" ? "Marked not applicable." : "Saved and reopened."),
    async (tx, session) => {
      engagementId = await audit.updateProcedure(tx, session, procedureId, { status, workDone: field(form, "workDone"), conclusion: field(form, "conclusion") });
    },
    () => engagementId,
  );
}
