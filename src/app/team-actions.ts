"use server";

import { revalidatePath } from "next/cache";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { assignTeam } from "@/server/engagement-team";
import { setAreaAssignment } from "@/server/area-assignments";
import type { FormState } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const optional = (form: FormData, name: string) => field(form, name) || null;

/** Save an engagement's team and report due date. The role is read again from the database; every rule is checked again on the server. */
export async function assignTeamAction(_prev: FormState, form: FormData): Promise<FormState> {
  const id = field(form, "engagementId");
  if (!UUID.test(id)) return { ok: false, message: "Engagement not found." };
  const session = await getSession();
  try {
    const result = await withFirm(await getDb(), session.firmId, (tx) =>
      assignTeam(tx, session, id, {
        preparerId: optional(form, "preparerId"),
        reviewerId: optional(form, "reviewerId"),
        partnerId: optional(form, "partnerId"),
        reportDueOn: optional(form, "reportDueOn"),
      }),
    );
    revalidatePath(`/engagements/${id}`);
    revalidatePath("/");
    revalidatePath("/my-work");
    return { ok: true, message: result.changed.length === 0 ? "No change: this is the team already saved." : `Saved: ${result.changed.join(", ").toLowerCase()}.` };
  } catch (e) {
    const known = e instanceof Error && !("code" in e);
    if (!known) console.error("team assignment failed:", e instanceof Error ? e.message : "unknown error");
    return { ok: false, message: known ? e.message : "The team was not saved." };
  }
}

/** Set or clear one audit area's own preparer and reviewer. Empty means "Same as the engagement". Every rule is checked again on the server. */
export async function setAreaAssignmentAction(_prev: FormState, form: FormData): Promise<FormState> {
  const id = field(form, "engagementId");
  if (!UUID.test(id)) return { ok: false, message: "Engagement not found." };
  const session = await getSession();
  try {
    const result = await withFirm(await getDb(), session.firmId, (tx) =>
      setAreaAssignment(tx, session, id, { areaCode: field(form, "areaCode"), preparerId: optional(form, "preparerId"), reviewerId: optional(form, "reviewerId") }),
    );
    revalidatePath(`/engagements/${id}`);
    revalidatePath(`/engagements/${id}/audit`);
    revalidatePath("/my-work");
    return { ok: true, message: result.changed ? "Saved: the area's team." : "No change: this is the area's team already saved." };
  } catch (e) {
    const known = e instanceof Error && !("code" in e);
    if (!known) console.error("area assignment failed:", e instanceof Error ? e.message : "unknown error");
    return { ok: false, message: known ? e.message : "The area's team was not saved." };
  }
}
