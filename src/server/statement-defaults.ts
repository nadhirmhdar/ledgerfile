import type { Tx } from "./db";
import { canLock, type Role } from "../domain/signoff";
import { carriesForward, cutForLog, describeKey, isKnownKey, policyKey, STANDARD_NOTES, type NoteSource } from "../domain/note-texts";
import { POLICIES } from "../domain/policies";
import { checkCurrency, checkDefaultText, isUnit, NOT_PARTNER_DEFAULTS, paragraphsToText, type Unit } from "../domain/statement-defaults";

/**
 * The firm's statement defaults (currency, rounding, default wording for some notes passages) and their one use: a snapshot onto a NEW engagement.
 * Partner-level only (the rule for the methodology and for locking; the firm administrator counts), with the role read again from the database. The
 * wording is an append-only list of versions (migration 0035). Nothing here touches an existing engagement except its own currency, by a partner while
 * it is open.
 */

/** The passages a firm can set a default for: the three framework notes, the policies' introduction, each policy, and the five standard notes after the group notes. */
export const DEFAULT_KEYS: string[] = ["general", "basis", "policies", ...POLICIES.map((p) => policyKey(p.title)), ...STANDARD_NOTES.map((n) => n.key)];

export interface FirmDefaults {
  currency: string | null;
  unit: Unit | null;
  /** Current default wording by key (only passages with text), with its version and when it was written. */
  notes: Map<string, { version: number; paragraphs: string[]; by: string; at: string }>;
  /** Every version of every passage, oldest first, for the history. */
  history: Map<string, { version: number; paragraphs: string[]; by: string; at: string }[]>;
}

interface NoteRow {
  key: string;
  version: number;
  paragraphs: unknown;
  by: string;
  at: string;
}

export async function loadFirmDefaults(tx: Tx): Promise<FirmDefaults> {
  const firm = (await tx.query<{ currency: string | null; unit: string | null }>("select statement_currency as currency, statement_unit as unit from firms")).rows[0];
  const { rows } = await tx.query<NoteRow>(
    `select d.note_key as key, d.version, d.paragraphs, u.name as by, to_char(d.written_at at time zone 'UTC', 'YYYY-MM-DD') as at
     from firm_note_defaults d join users u on u.id = d.written_by order by d.note_key, d.version`,
  );
  const history: FirmDefaults["history"] = new Map();
  for (const r of rows) history.set(r.key, [...(history.get(r.key) ?? []), { version: r.version, paragraphs: Array.isArray(r.paragraphs) ? (r.paragraphs as string[]) : [], by: r.by, at: r.at }]);
  const notes: FirmDefaults["notes"] = new Map();
  for (const [k, v] of history) {
    const last = v[v.length - 1];
    if (last.paragraphs.length > 0) notes.set(k, last);
  }
  return { currency: firm?.currency ?? null, unit: firm?.unit && isUnit(firm.unit) ? firm.unit : null, notes, history };
}

async function requirePartner(tx: Tx, s: { firmId: string; userId: string }): Promise<void> {
  const who = await tx.query<{ role: Role; active: boolean }>("select role, active from users where id = $1 and firm_id = $2", [s.userId, s.firmId]);
  if (!who.rows[0]?.active || !canLock(who.rows[0].role)) throw new Error(NOT_PARTNER_DEFAULTS);
}

const audit = (tx: Tx, s: { firmId: string; userId: string }, action: string, entity: string, entityId: string, detail: unknown) =>
  tx.query("insert into audit_log (firm_id, user_id, action, entity, entity_id, detail) values ($1, $2, $3, $4, $5, $6)", [s.firmId, s.userId, action, entity, entityId, JSON.stringify(detail)]);

export interface DefaultsInput {
  currency: string;
  unit: string;
  /** Typed wording by key: blank clears the default. Only the keys present are looked at. */
  notes: Record<string, string>;
}

export interface SaveResult {
  changed: string[];
}

/** Save the firm's defaults. Every value is checked here; what did not change writes nothing; each change is audit-logged with before and after. */
export async function saveFirmDefaults(tx: Tx, s: { firmId: string; userId: string }, input: DefaultsInput): Promise<SaveResult> {
  await requirePartner(tx, s);
  const cur = await checkCurrency(input.currency);
  if (!cur.ok) throw new Error(cur.message);
  const unit = input.unit === "" ? null : isUnit(input.unit) ? input.unit : undefined;
  if (unit === undefined) throw new Error("Choose exact or whole units.");
  // Check everything before writing anything.
  const wanted: { key: string; paragraphs: string[] | null }[] = [];
  for (const [key, text] of Object.entries(input.notes)) {
    if (!isKnownKey(key) || key.startsWith("group:")) throw new Error("That passage is not part of the notes.");
    const checked = checkDefaultText(text);
    if (!checked.ok) throw new Error(`${describeKey(key)}: ${checked.message}`);
    wanted.push({ key, paragraphs: checked.paragraphs });
  }
  await tx.query("select pg_advisory_xact_lock(hashtext($1))", [`firm_defaults:${s.firmId}`]);
  const before = await loadFirmDefaults(tx);
  const changed: string[] = [];
  const detail: Record<string, unknown> = {};
  if (before.currency !== cur.code) {
    await tx.query("update firms set statement_currency = $2 where id = $1", [s.firmId, cur.code]);
    changed.push("Currency");
    detail.currency = { before: before.currency, after: cur.code };
  }
  if (before.unit !== unit) {
    await tx.query("update firms set statement_unit = $2 where id = $1", [s.firmId, unit]);
    changed.push("Rounding");
    detail.unit = { before: before.unit, after: unit };
  }
  const notes: Record<string, { version: number; before: string | null; after: string | null }> = {};
  for (const w of wanted) {
    const current = before.notes.get(w.key) ?? null;
    const same = w.paragraphs === null ? current === null : current !== null && paragraphsToText(current.paragraphs) === paragraphsToText(w.paragraphs);
    if (same) continue;
    const version = (before.history.get(w.key)?.at(-1)?.version ?? 0) + 1;
    await tx.query("insert into firm_note_defaults (firm_id, note_key, version, paragraphs, written_by) values ($1, $2, $3, $4::jsonb, $5)", [s.firmId, w.key, version, JSON.stringify(w.paragraphs ?? []), s.userId]);
    changed.push(describeKey(w.key));
    notes[w.key] = { version, before: cutForLog(current?.paragraphs ?? null), after: cutForLog(w.paragraphs) };
  }
  if (Object.keys(notes).length > 0) detail.notes = notes;
  if (changed.length > 0) await audit(tx, s, "statement_defaults_update", "firm", s.firmId, { changed, ...detail });
  return { changed };
}

/**
 * Copy the firm's defaults onto a NEW engagement: its currency and rounding, and version 1 of each passage that has default wording, marked as coming
 * from the firm defaults. Called right after an engagement is created (single creation and bulk roll-forward) and nowhere else, so an existing
 * engagement is never touched. Writes nothing when the firm has set nothing.
 */
export async function applyFirmDefaults(tx: Tx, s: { firmId: string; userId: string }, engagementId: string, carried: ReadonlySet<string> = new Set()): Promise<void> {
  const d = await loadFirmDefaults(tx);
  if (d.currency === null && d.unit === null && d.notes.size === 0) return;
  await tx.query("update engagements set currency = $2, statement_unit = $3 where id = $1 and firm_id = $4", [engagementId, d.currency, d.unit, s.firmId]);
  // A passage carried from last year already has version 1 here and takes precedence over the firm default for the same key.
  for (const [key, v] of [...d.notes].filter(([k]) => !carried.has(k))) {
    await tx.query("insert into note_texts (firm_id, engagement_id, note_key, version, paragraphs, is_generated, written_by, source) values ($1, $2, $3, 1, $4::jsonb, false, $5, 'firm_default')", [
      s.firmId,
      engagementId,
      key,
      JSON.stringify(v.paragraphs),
      s.userId,
    ]);
  }
  await audit(tx, s, "apply_firm_defaults", "engagement", engagementId, { currency: d.currency, unit: d.unit, notes: [...d.notes.keys()].filter((k) => !carried.has(k)) });
}

/**
 * Roll-forward: carry last year's person-written passages onto the NEW engagement (owner decision 2026-11-25), as version 1 with source 'carried_forward',
 * written now by the person rolling forward. For each key it takes the prior engagement's CURRENT version and carries it only when that was a person's own
 * words: written by a person (source null or 'person'), or itself carried and not edited since ('carried_forward', so edited wording keeps moving year to
 * year). A current version that is a firm default or "back to the generated wording" is not carried. A group:<CODE> passage is carried like any other; if
 * that group has no note this year it is simply stored and not shown, as for any unused key. Returns the keys carried, which the firm defaults then skip.
 */
export async function carryPriorNotes(tx: Tx, s: { firmId: string; userId: string }, priorEngagementId: string, engagementId: string): Promise<string[]> {
  const { rows } = await tx.query<{ key: string; paragraphs: unknown; generated: boolean; source: NoteSource | null }>(
    `select distinct on (note_key) note_key as key, paragraphs, is_generated as generated, source
     from note_texts where engagement_id = $1 and firm_id = $2 order by note_key, version desc`,
    [priorEngagementId, s.firmId],
  );
  const keys: string[] = [];
  for (const r of rows) {
    if (!carriesForward(r)) continue;
    await tx.query("insert into note_texts (firm_id, engagement_id, note_key, version, paragraphs, is_generated, written_by, source) values ($1, $2, $3, 1, $4::jsonb, false, $5, 'carried_forward')", [
      s.firmId,
      engagementId,
      r.key,
      JSON.stringify(r.paragraphs),
      s.userId,
    ]);
    keys.push(r.key);
  }
  return keys;
}

/** A partner changes one engagement's own currency while it is open. Logged with before and after. Existing notes and the firm's defaults are untouched. */
export async function setEngagementCurrency(tx: Tx, s: { firmId: string; userId: string }, engagementId: string, input: string): Promise<{ changed: boolean }> {
  await requirePartner(tx, s);
  const cur = checkCurrency(input);
  if (!cur.ok) throw new Error(cur.message);
  const e = await tx.query<{ status: string; currency: string | null }>("select status, currency from engagements where id = $1 and firm_id = $2", [engagementId, s.firmId]);
  if (e.rows.length === 0) throw new Error("Engagement not found.");
  if (e.rows[0].status !== "open") throw new Error("This engagement is locked.");
  if (e.rows[0].currency === cur.code) return { changed: false };
  await tx.query("update engagements set currency = $2 where id = $1", [engagementId, cur.code]);
  await audit(tx, s, "set_engagement_currency", "engagement", engagementId, { before: e.rows[0].currency, after: cur.code });
  return { changed: true };
}
