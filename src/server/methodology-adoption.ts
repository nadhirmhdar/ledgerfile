import { createHash } from "node:crypto";
import type { Tx } from "./db";
import { audit, type Session } from "./repo";
import { loadFirmChanges, loadOwnProcedures, NOT_PARTNER } from "./firm-methodology";
import { canLock, type Role } from "../domain/signoff";
import { LIBRARY_VERSION } from "../domain/audit";
import library from "../domain/methodology-library.json";
import {
  ADOPT_STATEMENT,
  canonicalJson,
  MAX_NOTE,
  MAX_REASON,
  MIN_REASON,
  NOT_ADOPTED_SO_NO_WITHDRAW,
  NOT_CONFIRMED,
  NOTHING_CHANGED,
  stateFrom,
  type AdoptionRecord,
  type AdoptionState,
  type MethodologyNow,
} from "../domain/methodology-adoption";

/**
 * Recording that the firm has adopted the methodology library: which version, what it covered, who and when. Append-only (migration 0033): adopting
 * and withdrawing are rows, the current state is the latest, and nothing is ever updated or deleted. Partner-level only, the same rule as changing the
 * methodology (NOT_PARTNER; the firm administrator counts as partner-level), with the role read again from the database.
 */

/** Where the library and its version come from. A test passes another to stand for a library update. */
export interface LibrarySource {
  version: string;
  library: unknown;
}
export const CURRENT_LIBRARY: LibrarySource = { version: LIBRARY_VERSION, library };

/**
 * The fingerprint: a SHA-256 of the library's version and content together with the firm's changes to it (each wording edit and hidden procedure, and
 * each procedure the firm wrote, retired ones too), each in a fixed order and written canonically. A change to the library, or any change the firm makes
 * afterwards, gives a different fingerprint. It covers the methodology only: no engagement data.
 */
export async function methodologyNow(tx: Tx, source: LibrarySource = CURRENT_LIBRARY): Promise<MethodologyNow> {
  const changes = (await loadFirmChanges(tx)).sort((a, b) => a.templateId.localeCompare(b.templateId));
  const own = await loadOwnProcedures(tx);
  const text = canonicalJson({ version: source.version, library: source.library, changes, own });
  return { version: source.version, fingerprint: createHash("sha256").update(text).digest("hex"), changeCount: changes.length + own.length };
}

interface Row {
  id: number;
  kind: "adopted" | "withdrawn";
  version: string;
  fingerprint: string;
  changeCount: number;
  statement: string | null;
  note: string | null;
  reason: string | null;
  by: string;
  at: string;
}

/** Every adoption and withdrawal, newest first. */
export async function loadAdoptions(tx: Tx): Promise<AdoptionRecord[]> {
  const { rows } = await tx.query<Row>(
    `select m.id::float8 as id, m.kind, m.library_version as version, m.fingerprint, m.change_count as "changeCount", m.statement, m.note, m.reason, u.name as by,
            to_char(m.written_at at time zone 'UTC', 'YYYY-MM-DD') as at
     from methodology_adoptions m join users u on u.id = m.written_by order by m.id desc`,
  );
  return rows;
}

export interface AdoptionView {
  state: AdoptionState;
  history: AdoptionRecord[];
  now: MethodologyNow;
}

export async function getAdoption(tx: Tx, source: LibrarySource = CURRENT_LIBRARY): Promise<AdoptionView> {
  const [history, now] = await Promise.all([loadAdoptions(tx), methodologyNow(tx, source)]);
  return { state: stateFrom(history, now), history, now };
}

async function requirePartner(tx: Tx, s: Session): Promise<void> {
  const who = await tx.query<{ role: Role; active: boolean }>("select role, active from users where id = $1 and firm_id = $2", [s.userId, s.firmId]);
  if (!who.rows[0]?.active || !canLock(who.rows[0].role)) throw new Error(NOT_PARTNER);
}

/**
 * Record the adoption of the methodology as it is now. The partner must have ticked the confirmation (checked here too), and it is refused when
 * nothing has changed since the current adoption.
 */
export async function adoptMethodology(tx: Tx, s: Session, input: { confirmed: boolean; note?: string }, source: LibrarySource = CURRENT_LIBRARY): Promise<number> {
  await requirePartner(tx, s);
  if (input.confirmed !== true) throw new Error(NOT_CONFIRMED);
  const note = (input.note ?? "").trim();
  if (note.length > MAX_NOTE) throw new Error(`The note is too long: the most is ${MAX_NOTE.toLocaleString("en-GB")} characters.`);
  // One adoption at a time per firm, so the "nothing changed" check and the insert cannot race.
  await tx.query("select pg_advisory_xact_lock(hashtext($1))", [`methodology_adoptions:${s.firmId}`]);
  const view = await getAdoption(tx, source);
  if (view.state.kind === "current") throw new Error(`${NOTHING_CHANGED} (Adopted on ${view.state.adoption.at}.)`);
  const { rows } = await tx.query<{ id: number }>(
    "insert into methodology_adoptions (firm_id, kind, library_version, fingerprint, change_count, statement, note, written_by) values ($1, 'adopted', $2, $3, $4, $5, $6, $7) returning id::float8 as id",
    [s.firmId, view.now.version, view.now.fingerprint, view.now.changeCount, ADOPT_STATEMENT, note || null, s.userId],
  );
  await audit(tx, s, "methodology_adopt", "firm", s.firmId, {
    adoptionId: rows[0].id,
    libraryVersion: view.now.version,
    fingerprint: view.now.fingerprint,
    firmChanges: view.now.changeCount,
    replaces: view.state.kind === "changed" ? view.state.adoption.id : null,
    note: note || null,
  });
  return rows[0].id;
}

/** Withdraw the current adoption, with a reason. The adoption stays in the history. */
export async function withdrawAdoption(tx: Tx, s: Session, reason: string, source: LibrarySource = CURRENT_LIBRARY): Promise<number> {
  await requirePartner(tx, s);
  const why = reason.trim();
  if (why.length < MIN_REASON) throw new Error("Give the reason for withdrawing the adoption; it is recorded.");
  if (why.length > MAX_REASON) throw new Error(`The reason is too long: the most is ${MAX_REASON.toLocaleString("en-GB")} characters.`);
  await tx.query("select pg_advisory_xact_lock(hashtext($1))", [`methodology_adoptions:${s.firmId}`]);
  const view = await getAdoption(tx, source);
  if (view.state.kind === "none") throw new Error(NOT_ADOPTED_SO_NO_WITHDRAW);
  const withdrawn = view.state.adoption;
  const { rows } = await tx.query<{ id: number }>(
    "insert into methodology_adoptions (firm_id, kind, library_version, fingerprint, change_count, reason, written_by) values ($1, 'withdrawn', $2, $3, $4, $5, $6) returning id::float8 as id",
    [s.firmId, withdrawn.version, withdrawn.fingerprint, withdrawn.changeCount, why, s.userId],
  );
  await audit(tx, s, "methodology_withdraw", "firm", s.firmId, { adoptionId: rows[0].id, withdrawsAdoption: withdrawn.id, libraryVersion: withdrawn.version, reason: why });
  return rows[0].id;
}
