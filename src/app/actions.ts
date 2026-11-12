"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import { readGrid } from "@/server/excel";
import { parseTrialBalance } from "@/domain/tb-parse";
import { formatAmount } from "@/domain/money";

export interface FormState {
  ok: boolean;
  message: string;
  details?: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function createClientAction(_prev: FormState, form: FormData): Promise<FormState> {
  const name = String(form.get("name") ?? "").trim();
  if (name.length < 2 || name.length > 200) return { ok: false, message: "Enter the client's name." };
  const session = await getSession();
  await withFirm(await getDb(), session.firmId, (tx) => repo.createClient(tx, session, name));
  revalidatePath("/");
  return { ok: true, message: `Added ${name}.` };
}

export async function createEngagementAction(_prev: FormState, form: FormData): Promise<FormState> {
  const clientId = String(form.get("clientId") ?? "");
  const start = String(form.get("periodStart") ?? "");
  const end = String(form.get("periodEnd") ?? "");
  if (!UUID.test(clientId)) return { ok: false, message: "Choose a client." };
  if (!DATE.test(start) || !DATE.test(end)) return { ok: false, message: "Enter both period dates." };
  if (end <= start) return { ok: false, message: "The period end must be after the period start." };

  const session = await getSession();
  const id = await withFirm(await getDb(), session.firmId, (tx) => repo.createEngagement(tx, session, clientId, start, end));
  redirect(`/engagements/${id}`);
}

export async function uploadTrialBalanceAction(_prev: FormState, form: FormData): Promise<FormState> {
  const engagementId = String(form.get("engagementId") ?? "");
  const file = form.get("file");
  if (!UUID.test(engagementId)) return { ok: false, message: "Engagement not found." };
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a trial balance file to upload." };

  let grid: unknown[][];
  try {
    grid = await readGrid(file.name, await file.arrayBuffer());
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "The file could not be read." };
  }

  const parsed = parseTrialBalance(grid);
  if (parsed.errors.length > 0) {
    return { ok: false, message: "The trial balance was not imported.", details: parsed.errors.slice(0, 20) };
  }
  if (!parsed.balanced) {
    return {
      ok: false,
      message: `The trial balance does not balance: debits and credits differ by ${formatAmount(Math.abs(parsed.differenceMinor))}. Nothing was imported.`,
    };
  }

  const session = await getSession();
  try {
    const r = await withFirm(await getDb(), session.firmId, (tx) =>
      repo.importTrialBalance(tx, session, engagementId, file.name, parsed.accounts),
    );
    revalidatePath(`/engagements/${engagementId}`);
    return {
      ok: true,
      message: `Imported ${r.imported} accounts: ${r.carriedForward} mapped from earlier work, ${r.suggested} suggested for review, ${r.unmapped} left unmapped.`,
      details: parsed.warnings.slice(0, 20),
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "The import failed." };
  }
}

export async function setMappingAction(form: FormData): Promise<void> {
  const engagementId = String(form.get("engagementId") ?? "");
  const accountId = String(form.get("accountId") ?? "");
  const groupCode = String(form.get("groupCode") ?? "");
  if (!UUID.test(engagementId) || !UUID.test(accountId)) return;
  const session = await getSession();
  await withFirm(await getDb(), session.firmId, (tx) => repo.setMapping(tx, session, accountId, groupCode === "" ? null : groupCode));
  revalidatePath(`/engagements/${engagementId}`);
}

export async function approveAllAction(form: FormData): Promise<void> {
  const engagementId = String(form.get("engagementId") ?? "");
  if (!UUID.test(engagementId)) return;
  const session = await getSession();
  await withFirm(await getDb(), session.firmId, (tx) => repo.approveAllMappings(tx, session, engagementId));
  revalidatePath(`/engagements/${engagementId}`);
}
