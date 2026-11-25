"use server";

import { revalidatePath } from "next/cache";
import { getDb, withFirm, type Tx } from "@/server/db";
import { getSession } from "@/server/session";
import type { Session } from "@/server/repo";
import * as methodology from "@/server/firm-methodology";
import { adoptMethodology, withdrawAdoption } from "@/server/methodology-adoption";
import type { FormState } from "./actions";

const field = (form: FormData, name: string) => String(form.get(name) ?? "");

/** Run one change as the signed-in user and report it to the form. Messages from the methodology rules are written for users; others are not shown. */
async function run(form: FormData, done: string, work: (tx: Tx, s: Session, templateId: string) => Promise<void>): Promise<FormState> {
  const session = await getSession();
  const templateId = field(form, "templateId");
  try {
    await withFirm(await getDb(), session.firmId, (tx) => work(tx, session, templateId));
  } catch (e) {
    const known = e instanceof Error && !("code" in e);
    if (!known) console.error("methodology action failed:", e instanceof Error ? e.message : "unknown error");
    return { ok: false, message: known ? e.message : "The change was not saved." };
  }
  revalidatePath("/firm/methodology");
  return { ok: true, message: done };
}

export async function editProcedureAction(_prev: FormState, form: FormData): Promise<FormState> {
  return run(form, "Saved. Programmes loaded from now on use this wording.", (tx, s, id) => methodology.editProcedure(tx, s, id, { body: field(form, "body"), evidence: field(form, "evidence"), reference: field(form, "reference") }));
}

export async function hideProcedureAction(_prev: FormState, form: FormData): Promise<FormState> {
  return run(form, "Hidden. Programmes loaded from now on leave it out.", (tx, s, id) => methodology.hideProcedure(tx, s, id));
}

export async function showProcedureAction(_prev: FormState, form: FormData): Promise<FormState> {
  return run(form, "Shown again.", (tx, s, id) => methodology.showProcedure(tx, s, id));
}

export async function resetProcedureAction(_prev: FormState, form: FormData): Promise<FormState> {
  return run(form, "Back to the library wording.", (tx, s, id) => methodology.resetProcedure(tx, s, id));
}

/** The fields of the add and edit forms for the firm's own procedures. */
const ownInput = (form: FormData) => ({ tier: field(form, "tier"), assertions: form.getAll("assertion").map(String), body: field(form, "body"), evidence: field(form, "evidence"), reference: field(form, "reference") });

export async function addProcedureAction(_prev: FormState, form: FormData): Promise<FormState> {
  const areaCode = field(form, "areaCode");
  return run(form, "Added. Programmes loaded from now on include it.", (tx, s) => methodology.addProcedure(tx, s, areaCode, ownInput(form)).then(() => undefined));
}

export async function editOwnProcedureAction(_prev: FormState, form: FormData): Promise<FormState> {
  return run(form, "Saved. Programmes loaded from now on use this wording.", (tx, s, id) => methodology.editOwnProcedure(tx, s, id, ownInput(form)));
}

export async function retireOwnProcedureAction(_prev: FormState, form: FormData): Promise<FormState> {
  return run(form, "Retired. Programmes loaded from now on leave it out.", (tx, s, id) => methodology.retireOwnProcedure(tx, s, id));
}

export async function restoreOwnProcedureAction(_prev: FormState, form: FormData): Promise<FormState> {
  return run(form, "Restored.", (tx, s, id) => methodology.restoreOwnProcedure(tx, s, id));
}

/** Record the firm's adoption of the methodology. The role is read again from the database and the confirmation is checked again on the server. */
export async function adoptMethodologyAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await getSession();
  try {
    await withFirm(await getDb(), session.firmId, (tx) => adoptMethodology(tx, session, { confirmed: field(form, "confirm") === "yes", note: field(form, "note") }));
  } catch (e) {
    const known = e instanceof Error && !("code" in e);
    if (!known) console.error("adoption failed:", e instanceof Error ? e.message : "unknown error");
    return { ok: false, message: known ? e.message : "The adoption was not recorded." };
  }
  revalidatePath("/firm/methodology");
  revalidatePath("/engagements", "layout");
  return { ok: true, message: "Adoption recorded." };
}

export async function withdrawAdoptionAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await getSession();
  try {
    await withFirm(await getDb(), session.firmId, (tx) => withdrawAdoption(tx, session, field(form, "reason")));
  } catch (e) {
    const known = e instanceof Error && !("code" in e);
    if (!known) console.error("withdrawal failed:", e instanceof Error ? e.message : "unknown error");
    return { ok: false, message: known ? e.message : "The adoption was not withdrawn." };
  }
  revalidatePath("/firm/methodology");
  revalidatePath("/engagements", "layout");
  return { ok: true, message: "Adoption withdrawn." };
}
