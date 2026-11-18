import { needsPartner, type Area, type ProcedureTemplate } from "./audit";

/**
 * A firm's changes to the methodology library's procedures: its own wording in place of the library's, and procedures it leaves out. Pure.
 *
 * The library stays as it is. applyFirmChanges returns the firm's own copy of the areas, which is what loads procedures into new programmes (an
 * engagement keeps the wording it was loaded with). Ids, tiers and assertions are not editable here, and a change for an id that is not in the library
 * is ignored.
 */

export const MAX_BODY = 2000;
export const MAX_EVIDENCE = 300;
export const MAX_REFERENCE = 300;

/** One library procedure's change. A null field means "use the library's"; hidden leaves the procedure out of new programmes. */
export interface FirmChange {
  templateId: string;
  body: string | null;
  evidence: string | null;
  reference: string | null;
  hidden: boolean;
}

/** A procedure the firm cannot hide: a core procedure of an area whose risk is fixed (management override). Its wording can still be edited. */
export const isProtected = (area: Pick<Area, "fixedRisk">, p: Pick<ProcedureTemplate, "tier">): boolean => !!area.fixedRisk && p.tier === "core";

/** Whether a change alters any wording (not only the hidden flag). */
export const changesWording = (c: Pick<FirmChange, "body" | "evidence" | "reference">): boolean => c.body !== null || c.evidence !== null || c.reference !== null;

/**
 * The firm's areas: for each library procedure with a change, the edited fields replace the library's, field by field, and a hidden procedure is left
 * out. With no changes the result has the library's own procedures, unchanged. Hiding a protected procedure has no effect.
 */
export function applyFirmChanges(areas: Area[], changes: FirmChange[]): Area[] {
  if (changes.length === 0) return areas;
  const byId = new Map(changes.map((c) => [c.templateId, c]));
  return areas.map((area) => ({
    ...area,
    procedures: area.procedures.flatMap((p): ProcedureTemplate[] => {
      const c = byId.get(p.id);
      if (!c) return [p];
      if (c.hidden && !isProtected(area, p)) return [];
      if (!changesWording(c)) return [p];
      return [{ ...p, text: c.body ?? p.text, evidence: c.evidence ?? p.evidence, reference: c.reference ?? p.reference, firmWording: true }];
    }),
  }));
}

export interface WordingInput {
  body: string;
  evidence: string;
  reference: string;
}

/**
 * The wording as the firm typed it, checked against the library's own entry. Blank is refused (so a firm cannot save a procedure with no text) unless the
 * library's own field is blank; text over the limits is refused. A field equal to the library's is returned as null, so it stays "the library's".
 */
export function checkWording(input: WordingInput, library: { text: string; evidence: string; reference: string }): { ok: true; value: Pick<FirmChange, "body" | "evidence" | "reference"> } | { ok: false; message: string } {
  const field = (what: string, typed: string, max: number, original: string): { ok: true; value: string | null } | { ok: false; message: string } => {
    const t = typed.replace(/\r\n?/g, "\n").trim();
    if (t === "" && original.trim() !== "") return { ok: false, message: `Write the ${what}: it cannot be blank.` };
    if (t.length > max) return { ok: false, message: `The ${what} is too long. Keep it to ${max.toLocaleString("en-US")} characters.` };
    return { ok: true, value: t === original.trim() ? null : t };
  };
  const body = field("procedure wording", input.body, MAX_BODY, library.text);
  if (!body.ok) return body;
  const evidence = field("evidence", input.evidence, MAX_EVIDENCE, library.evidence);
  if (!evidence.ok) return evidence;
  // Evidence that starts "Partner sign-off" makes a step the partner's own sign-off, which skips review. Rewording must never change that control, either way.
  if (needsPartner(input.evidence.trim()) !== needsPartner(library.evidence.trim())) {
    return { ok: false, message: "The evidence cannot start with \"Partner sign-off\" unless the library's does: that wording makes a step the partner's own sign-off, which is not reviewed. Reword it another way." };
  }
  const reference = field("reference", input.reference, MAX_REFERENCE, library.reference);
  if (!reference.ok) return reference;
  return { ok: true, value: { body: body.value, evidence: evidence.value, reference: reference.value } };
}

/** The firm's state of one procedure, for the page: the library's, the firm's own wording, or hidden. */
export type ProcedureState = "library" | "edited" | "hidden";
export const stateOf = (c: FirmChange | undefined): ProcedureState => (!c ? "library" : c.hidden ? "hidden" : changesWording(c) ? "edited" : "library");
