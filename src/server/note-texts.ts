import type { Tx } from "./db";
import { audit, type Session } from "./repo";
import { canEditNotes } from "../domain/permissions";
import type { Role } from "../domain/signoff";
import { checkParagraphs, cutForLog, describeKey, isKnownKey, overridesFrom, type NoteVersion } from "../domain/note-texts";

/**
 * The editable wording of the notes, kept as an append-only list of versions (migration 0032, note_texts). Every save, restore and "back to the
 * generated wording" is a new version; nothing is updated or deleted. Every rule is checked here, on the server.
 */

export const LOCKED = "This engagement is locked.";
export const NOT_ALLOWED = "You cannot edit the notes.";
export const UNKNOWN_PASSAGE = "That passage is not part of the notes.";

interface VersionRow {
  key: string;
  version: number;
  paragraphs: unknown;
  generated: boolean;
  by: string;
  at: string;
  source: "person" | "firm_default" | null;
}

const toVersion = (r: VersionRow): NoteVersion => ({
  version: r.version,
  paragraphs: Array.isArray(r.paragraphs) ? (r.paragraphs as string[]) : [],
  generated: r.generated,
  by: r.by,
  at: r.at,
  source: r.source,
});

const SELECT = `
  select n.note_key as key, n.version, n.paragraphs, n.is_generated as generated, n.source, u.name as by, to_char(n.written_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as at
  from note_texts n join users u on u.id = n.written_by`;

/** Every version of every passage of an engagement, oldest first within a passage. One query. */
export async function loadHistory(tx: Tx, engagementId: string): Promise<Map<string, NoteVersion[]>> {
  const { rows } = await tx.query<VersionRow>(`${SELECT} where n.engagement_id = $1 order by n.note_key, n.version`, [engagementId]);
  const out = new Map<string, NoteVersion[]>();
  for (const r of rows) out.set(r.key, [...(out.get(r.key) ?? []), toVersion(r)]);
  return out;
}

/** The current version of each passage (the highest). */
export const currentOf = (history: Map<string, NoteVersion[]>): Map<string, NoteVersion> => new Map([...history].map(([k, v]) => [k, v[v.length - 1]]));

/** What the statement pack takes: the paragraphs of each passage whose current version is a person's. */
export async function loadNoteOverrides(tx: Tx, engagementId: string): Promise<Record<string, string[]>> {
  return overridesFrom(currentOf(await loadHistory(tx, engagementId)));
}

async function authorise(tx: Tx, s: Session, engagementId: string, key: string): Promise<void> {
  const who = await tx.query<{ role: Role; active: boolean }>("select role, active from users where id = $1 and firm_id = $2", [s.userId, s.firmId]);
  if (!who.rows[0]?.active || !canEditNotes(who.rows[0].role)) throw new Error(NOT_ALLOWED);
  const e = await tx.query<{ status: string }>("select status from engagements where id = $1 and firm_id = $2", [engagementId, s.firmId]);
  if (e.rows.length === 0) throw new Error("Engagement not found.");
  // A locked file is read-only, and an archived one is locked.
  if (e.rows[0].status !== "open") throw new Error(LOCKED);
  if (!isKnownKey(key)) throw new Error(UNKNOWN_PASSAGE);
  // One writer at a time per engagement and passage, so two saves cannot take the same version number.
  await tx.query("select pg_advisory_xact_lock(hashtext($1))", [`note_texts:${engagementId}:${key}`]);
}

export interface WriteResult {
  /** False when nothing was written because the text was already what the passage says. */
  written: boolean;
  version: number;
  message: string;
}

async function write(
  tx: Tx,
  s: Session,
  engagementId: string,
  key: string,
  paragraphs: string[],
  generated: boolean,
  action: "note_text_save" | "note_text_restore" | "note_text_generated",
  extra: Record<string, unknown> = {},
): Promise<WriteResult> {
  const history = (await tx.query<VersionRow>(`${SELECT} where n.engagement_id = $1 and n.note_key = $2 order by n.version`, [engagementId, key])).rows.map(toVersion);
  const current = history[history.length - 1] ?? null;
  const sameAsCurrent = current ? current.generated === generated && JSON.stringify(current.paragraphs) === JSON.stringify(paragraphs) : generated;
  if (sameAsCurrent) {
    return { written: false, version: current?.version ?? 0, message: generated ? "This passage already reads as the generated wording." : "No change: this is the wording already saved." };
  }
  const version = (current?.version ?? 0) + 1;
  await tx.query("insert into note_texts (firm_id, engagement_id, note_key, version, paragraphs, is_generated, written_by) values ($1, $2, $3, $4, $5::jsonb, $6, $7)", [
    s.firmId,
    engagementId,
    key,
    version,
    JSON.stringify(paragraphs),
    generated,
    s.userId,
  ]);
  const before = current && !current.generated ? current.paragraphs : null;
  await audit(tx, s, action, "engagement", engagementId, {
    noteKey: key,
    passage: describeKey(key),
    version,
    ...extra,
    before: cutForLog(before),
    after: generated ? null : cutForLog(paragraphs),
    ...(generated ? { generatedWording: true } : {}),
  });
  return { written: true, version, message: action === "note_text_generated" ? "Back to the generated wording." : action === "note_text_restore" ? `Restored as version ${version}.` : `Saved as version ${version}.` };
}

/** Save a person's wording for a passage as the next version. Identical wording writes nothing. */
export async function saveNoteText(tx: Tx, s: Session, engagementId: string, key: string, paragraphs: unknown): Promise<WriteResult> {
  await authorise(tx, s, engagementId, key);
  const checked = checkParagraphs(paragraphs);
  if (!checked.ok) throw new Error(checked.message);
  return write(tx, s, engagementId, key, checked.paragraphs, false, "note_text_save");
}

/** Write an earlier version's wording again as the next version, so the history keeps going forward. */
export async function restoreNoteText(tx: Tx, s: Session, engagementId: string, key: string, version: number): Promise<WriteResult> {
  await authorise(tx, s, engagementId, key);
  const { rows } = await tx.query<VersionRow>(`${SELECT} where n.engagement_id = $1 and n.note_key = $2 and n.version = $3`, [engagementId, key, version]);
  if (rows.length === 0) throw new Error("That version does not exist.");
  const v = toVersion(rows[0]);
  return write(tx, s, engagementId, key, v.paragraphs, v.generated, "note_text_restore", { restoredVersion: version });
}

/** Go back to the generated wording: a version marked generated, with no paragraphs. */
export async function useGeneratedWording(tx: Tx, s: Session, engagementId: string, key: string): Promise<WriteResult> {
  await authorise(tx, s, engagementId, key);
  return write(tx, s, engagementId, key, [], true, "note_text_generated");
}
