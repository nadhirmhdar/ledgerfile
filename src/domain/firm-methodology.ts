import { ASSERTIONS, needsPartner, type Area, type Assertion, type ProcedureTemplate, type Tier } from "./audit";

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
export function applyFirmChanges(areas: Area[], changes: FirmChange[], own: FirmOwnProcedure[] = []): Area[] {
  const active = own.filter((o) => !o.retired);
  if (changes.length === 0 && active.length === 0) return areas;
  const byId = new Map(changes.map((c) => [c.templateId, c]));
  return areas.map((area) => ({
    ...area,
    procedures: [...area.procedures.flatMap((p): ProcedureTemplate[] => {
      const c = byId.get(p.id);
      if (!c) return [p];
      if (c.hidden && !isProtected(area, p)) return [];
      if (!changesWording(c)) return [p];
      return [{ ...p, text: c.body ?? p.text, evidence: c.evidence ?? p.evidence, reference: c.reference ?? p.reference, firmWording: true }];
    }), ...active.filter((o) => o.areaCode === area.code).sort((a, b) => a.seq - b.seq).map(ownTemplate)],
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

// --- The firm's own procedures ----------------------------------------------------------------------------------------------------------

/** A procedure the firm wrote for one area. Its id is made from the area and seq, never reused (retire, never delete). */
export interface FirmOwnProcedure {
  areaCode: string;
  seq: number;
  tier: Tier;
  assertions: Assertion[];
  body: string;
  evidence: string;
  reference: string;
  retired: boolean;
}

/** At most this many own procedures per area. Retired ones count, so ids stay unique and are never reused. */
export const MAX_OWN_PER_AREA = 30;

/** C1.F01, C1.F02 ... Library ids end in two digits, so these cannot collide with them, and they sort after the library's. */
export const ownId = (areaCode: string, seq: number): string => `${areaCode}.F${String(seq).padStart(2, "0")}`;

/** The next sequence number for an area, given those already used (retired ones too). Null when the area is full. */
export function nextOwnSeq(used: number[]): number | null {
  const next = used.length === 0 ? 1 : Math.max(...used) + 1;
  return used.length >= MAX_OWN_PER_AREA || next > MAX_OWN_PER_AREA ? null : next;
}

export const ownTemplate = (o: FirmOwnProcedure): ProcedureTemplate => ({ id: ownId(o.areaCode, o.seq), tier: o.tier, assertions: o.assertions, text: o.body, evidence: o.evidence, reference: o.reference, firmOwn: true });

export interface OwnInput {
  tier: string;
  assertions: string[];
  body: string;
  evidence: string;
  reference: string;
}

const TIERS: Tier[] = ["core", "extended", "significant"];

/**
 * An own procedure as the firm typed it. The tier must be one of the three, there must be at least one assertion and only ones the LIBRARY's area covers
 * (an area's risk assessment asks for exactly those, so a new one would make assessed areas read as not assessed), the text and evidence cannot be blank,
 * the limits are part 1's, and evidence cannot start "Partner sign-off" (an own procedure can never be a partner step).
 */
export function checkOwnProcedure(input: OwnInput, allowed: Assertion[]): { ok: true; value: Pick<FirmOwnProcedure, "tier" | "assertions" | "body" | "evidence" | "reference"> } | { ok: false; message: string } {
  if (!TIERS.includes(input.tier as Tier)) return { ok: false, message: "Choose whether the procedure is core, extended or for a significant risk." };
  const chosen = new Set(input.assertions);
  const known = new Set(ASSERTIONS.map((a) => a.code as string));
  if (chosen.size === 0) return { ok: false, message: "Choose at least one assertion the procedure addresses." };
  for (const a of chosen) {
    if (!known.has(a) || !allowed.includes(a as Assertion)) return { ok: false, message: "Choose only assertions this area already covers." };
  }
  const text = (what: string, typed: string, max: number, required: boolean): { ok: true; value: string } | { ok: false; message: string } => {
    const t = typed.replace(/\r\n?/g, "\n").trim();
    if (t === "" && required) return { ok: false, message: `Write the ${what}: it cannot be blank.` };
    if (t.length > max) return { ok: false, message: `The ${what} is too long. Keep it to ${max.toLocaleString("en-US")} characters.` };
    return { ok: true, value: t };
  };
  const body = text("procedure wording", input.body, MAX_BODY, true);
  if (!body.ok) return body;
  const evidence = text("evidence", input.evidence, MAX_EVIDENCE, true);
  if (!evidence.ok) return evidence;
  if (needsPartner(evidence.value)) return { ok: false, message: PARTNER_EVIDENCE_MESSAGE };
  const reference = text("reference", input.reference, MAX_REFERENCE, false);
  if (!reference.ok) return reference;
  return { ok: true, value: { tier: input.tier as Tier, assertions: ASSERTIONS.map((a) => a.code).filter((a) => chosen.has(a)) as Assertion[], body: body.value, evidence: evidence.value, reference: reference.value } };
}

const PARTNER_EVIDENCE_MESSAGE = "The evidence cannot start with \"Partner sign-off\": that wording makes a step the partner's own sign-off, which is not reviewed. Reword it another way.";

/** The firm's own procedures as the methodology page shows them. */
export type OwnState = "active" | "retired";
