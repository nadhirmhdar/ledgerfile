import type { Tx } from "./db";
import { audit as log, getEngagement, type Session } from "./repo";
import { assertMayReview, requireAudit } from "./audit";
import { canReview } from "../domain/signoff";
import { AREA_BY_CODE } from "../domain/audit";
import { todayIso } from "../domain/client-requests";
import {
  checkAmount,
  checkReminder,
  checkReply,
  checkSent,
  cleanAccountRef,
  cleanContact,
  cleanParty,
  cleanReplyNote,
  cleanWork,
  compareAreas,
  confirmationState,
  differenceMinor,
  isKind,
  prepareBlocker,
  resolveArea,
  summarise,
  type ConfirmationKind,
  type ConfirmationState,
  type Reply,
  type SummaryRow,
} from "../domain/confirmations";

/**
 * External confirmations on an audited engagement. Every write needs the engagement open and the audit on (requireAudit), is written
 * to the audit log, and is refused once a reviewer has reviewed the confirmation: the review is withdrawn first. Any role may add,
 * change and prepare; reviewing and withdrawing a review need a reviewer or partner. A change to the substance of a confirmation
 * after it was prepared clears the preparation, so a reviewer never signs off work that changed under them.
 */

export interface ConfirmationFile {
  id: string;
  fileName: string;
  sizeBytes: number;
}

export interface ConfirmationView {
  id: string;
  seq: number;
  reference: string;
  kind: ConfirmationKind;
  areaCode: string;
  areaTitle: string;
  partyName: string;
  contact: string | null;
  accountRef: string | null;
  bookMinor: number;
  sentOn: string | null;
  reminders: string[];
  reply: Reply | null;
  repliedOn: string | null;
  confirmedMinor: number | null;
  differenceMinor: number | null;
  reconciliation: string | null;
  alternativeProcedures: string | null;
  replyNote: string | null;
  preparedByName: string | null;
  preparedAt: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  /** The reviewer also did some of the work (possible only where the firm has no other reviewer). */
  selfReviewed: boolean;
  state: ConfirmationState;
  files: ConfirmationFile[];
}

interface Row {
  id: string;
  engagementId: string;
  seq: number;
  reference: string;
  kind: ConfirmationKind;
  areaCode: string;
  partyName: string;
  contact: string | null;
  accountRef: string | null;
  bookMinor: number;
  sentOn: string | null;
  reminders: string[];
  reply: Reply | null;
  repliedOn: string | null;
  confirmedMinor: number | null;
  reconciliation: string | null;
  alternativeProcedures: string | null;
  replyNote: string | null;
  preparedBy: string | null;
  preparedByName: string | null;
  preparedAt: string | null;
  contributors: string[];
  reviewedBy: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
}

const SELECT = `
  select c.id, c.engagement_id as "engagementId", c.seq, c.reference, c.kind, c.area_code as "areaCode", c.party_name as "partyName", c.contact,
         c.account_ref as "accountRef", c.book_balance_minor::float8 as "bookMinor", to_char(c.sent_on, 'YYYY-MM-DD') as "sentOn",
         coalesce((select array_agg(to_char(d, 'YYYY-MM-DD') order by d) from unnest(c.reminders) d), '{}') as reminders,
         c.reply, to_char(c.replied_on, 'YYYY-MM-DD') as "repliedOn", c.confirmed_balance_minor::float8 as "confirmedMinor",
         c.reconciliation, c.alternative_procedures as "alternativeProcedures", c.reply_note as "replyNote",
         c.prepared_by as "preparedBy", pu.name as "preparedByName", to_char(c.prepared_at, 'YYYY-MM-DD') as "preparedAt", c.contributors,
         c.reviewed_by as "reviewedBy", ru.name as "reviewedByName", to_char(c.reviewed_at, 'YYYY-MM-DD') as "reviewedAt"
  from confirmations c left join users pu on pu.id = c.prepared_by left join users ru on ru.id = c.reviewed_by`;

/** Everyone whose work a reviewer must not be: who prepared it and everyone who changed it. */
const workedBy = (r: Pick<Row, "preparedBy" | "contributors">): string[] => [...new Set([r.preparedBy, ...r.contributors].filter((x): x is string => !!x))];

const areaTitle = (code: string) => `${code} ${AREA_BY_CODE.get(code)?.title ?? ""}`.trim();

async function load(tx: Tx, id: string): Promise<Row> {
  const { rows } = await tx.query<Row>(`${SELECT} where c.id::text = $1`, [id]);
  if (rows.length === 0) throw new Error("Confirmation not found.");
  return rows[0];
}

/** Writes need the audit on, the engagement open, and a confirmation nobody has reviewed. */
async function loadForEdit(tx: Tx, id: string): Promise<Row> {
  const row = await load(tx, id);
  await requireAudit(tx, row.engagementId);
  if (row.reviewedBy) throw new Error("This confirmation has been reviewed. Ask the reviewer to withdraw the review before changing it.");
  return row;
}

/**
 * Apply a change of substance: the given columns, and in the same statement clear the preparation and record this user as a
 * contributor. The set clause uses parameters from $3 on; $1 is the id and $2 the user.
 */
async function change(tx: Tx, row: Row, s: Session, set: string, params: unknown[]): Promise<void> {
  await tx.query(
    `update confirmations set ${set}, prepared_by = null, prepared_at = null,
            contributors = case when $2::uuid = any(contributors) then contributors else array_append(contributors, $2::uuid) end, updated_at = clock_timestamp()
     where id = $1`,
    [row.id, s.userId, ...params],
  );
}
const wasPrepared = (row: Row) => row.preparedBy !== null;

async function nextSeq(tx: Tx, engagementId: string): Promise<number> {
  const { rows } = await tx.query<{ n: number }>("select coalesce(max(seq), 0)::int + 1 as n from confirmations where engagement_id = $1", [engagementId]);
  return rows[0].n;
}

/** Every confirmation on the engagement, by area then reference, with files, names and the derived difference and state. */
export async function listConfirmations(tx: Tx, engagementId: string): Promise<ConfirmationView[]> {
  const { rows } = await tx.query<Row>(`${SELECT} where c.engagement_id = $1 order by c.seq`, [engagementId]);
  if (rows.length === 0) return [];
  const linked = await tx.query<{ confirmationId: string; id: string; fileName: string; sizeBytes: number }>(
    `select f.confirmation_id as "confirmationId", w.id, w.file_name as "fileName", w.size_bytes::float8 as "sizeBytes"
     from confirmation_files f join working_papers w on w.id = f.working_paper_id where f.engagement_id = $1 order by w.file_name`,
    [engagementId],
  );
  const files = new Map<string, ConfirmationFile[]>();
  for (const f of linked.rows) files.set(f.confirmationId, [...(files.get(f.confirmationId) ?? []), { id: f.id, fileName: f.fileName, sizeBytes: f.sizeBytes }]);
  return rows
    .map((r): ConfirmationView => ({
      id: r.id,
      seq: r.seq,
      reference: r.reference,
      kind: r.kind,
      areaCode: r.areaCode,
      areaTitle: areaTitle(r.areaCode),
      partyName: r.partyName,
      contact: r.contact,
      accountRef: r.accountRef,
      bookMinor: r.bookMinor,
      sentOn: r.sentOn,
      reminders: r.reminders,
      reply: r.reply,
      repliedOn: r.repliedOn,
      confirmedMinor: r.confirmedMinor,
      differenceMinor: differenceMinor(r.bookMinor, r.confirmedMinor),
      reconciliation: r.reconciliation,
      alternativeProcedures: r.alternativeProcedures,
      replyNote: r.replyNote,
      preparedByName: r.preparedByName,
      preparedAt: r.preparedAt,
      reviewedByName: r.reviewedByName,
      reviewedAt: r.reviewedAt,
      selfReviewed: !!r.reviewedBy && workedBy(r).includes(r.reviewedBy),
      state: confirmationState({ sentOn: r.sentOn, reply: r.reply, prepared: r.preparedBy !== null, reviewed: r.reviewedBy !== null }),
      files: files.get(r.id) ?? [],
    }))
    .sort((a, b) => compareAreas(a.areaCode, b.areaCode) || a.seq - b.seq);
}

/** Counts and totals by area, and overall: for the page's summary and the audit area pages. */
export async function confirmationSummary(tx: Tx, engagementId: string): Promise<{ overall: SummaryRow; byArea: Map<string, SummaryRow> }> {
  const { rows } = await tx.query<{ areaCode: string; bookMinor: number; confirmedMinor: number | null; reply: Reply | null; sentOn: string | null; prepared: boolean; reviewed: boolean }>(
    `select area_code as "areaCode", book_balance_minor::float8 as "bookMinor", confirmed_balance_minor::float8 as "confirmedMinor", reply,
            sent_on is not null as "sentOn", prepared_by is not null as prepared, reviewed_by is not null as reviewed
     from confirmations where engagement_id = $1`,
    [engagementId],
  );
  return summarise(rows.map((r) => ({ ...r, state: confirmationState({ sentOn: r.sentOn ? "x" : null, reply: r.reply, prepared: r.prepared, reviewed: r.reviewed }) })));
}

export async function addConfirmation(
  tx: Tx,
  s: Session,
  engagementId: string,
  input: { kind: string; areaCode?: string | null; partyName: string; contact?: string | null; accountRef?: string | null; bookMinor?: number },
): Promise<string> {
  await requireAudit(tx, engagementId);
  if (!isKind(input.kind)) throw new Error("Choose what kind of confirmation this is.");
  const areaCode = resolveArea(input.kind, input.areaCode);
  const partyName = cleanParty(input.partyName);
  const book = checkAmount(input.bookMinor ?? 0, "The book balance");
  const seq = await nextSeq(tx, engagementId);
  const { rows } = await tx.query<{ id: string }>(
    `insert into confirmations (firm_id, engagement_id, seq, reference, kind, area_code, party_name, contact, account_ref, book_balance_minor, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
    [s.firmId, engagementId, seq, `CF-${seq}`, input.kind, areaCode, partyName, cleanContact(input.contact), cleanAccountRef(input.accountRef), book, s.userId],
  );
  await log(tx, s, "confirmation_add", "confirmation", rows[0].id, { engagementId, reference: `CF-${seq}`, kind: input.kind, areaCode, partyName });
  return rows[0].id;
}

/** Change who it goes to, the kind, the area or the book balance. The book balance cannot change while an amount-bearing reply is recorded. */
export async function editConfirmation(
  tx: Tx,
  s: Session,
  id: string,
  input: { kind: string; areaCode?: string | null; partyName: string; contact?: string | null; accountRef?: string | null; bookMinor: number },
): Promise<string> {
  const row = await loadForEdit(tx, id);
  if (!isKind(input.kind)) throw new Error("Choose what kind of confirmation this is.");
  const areaCode = resolveArea(input.kind, input.areaCode);
  const book = checkAmount(input.bookMinor, "The book balance");
  if (book !== row.bookMinor && (row.reply === "agreed" || row.reply === "differs")) throw new Error("Clear the reply first: the book balance cannot change while a reply is recorded against it.");
  await change(tx, row, s, "kind = $3, area_code = $4, party_name = $5, contact = $6, account_ref = $7, book_balance_minor = $8", [
    input.kind, areaCode, cleanParty(input.partyName), cleanContact(input.contact), cleanAccountRef(input.accountRef), book,
  ]);
  await log(tx, s, "confirmation_edit", "confirmation", id, { engagementId: row.engagementId, reference: row.reference, unprepared: wasPrepared(row) });
  return row.engagementId;
}

export async function markSent(tx: Tx, s: Session, id: string, sentOn?: string | null, today: string = todayIso()): Promise<string> {
  const row = await loadForEdit(tx, id);
  const date = checkSent(sentOn, today, { repliedOn: row.repliedOn, reminders: row.reminders });
  await change(tx, row, s, "sent_on = $3", [date]);
  await log(tx, s, "confirmation_sent", "confirmation", id, { engagementId: row.engagementId, reference: row.reference, sentOn: date, unprepared: wasPrepared(row) });
  return row.engagementId;
}

export async function clearSent(tx: Tx, s: Session, id: string): Promise<string> {
  const row = await loadForEdit(tx, id);
  if (!row.sentOn) throw new Error("This confirmation has not been sent.");
  if (row.reply) throw new Error("Clear the reply first.");
  if (row.reminders.length > 0) throw new Error("Remove the reminders first.");
  await change(tx, row, s, "sent_on = null", []);
  await log(tx, s, "confirmation_unsent", "confirmation", id, { engagementId: row.engagementId, reference: row.reference });
  return row.engagementId;
}

export async function addReminder(tx: Tx, s: Session, id: string, on?: string | null, today: string = todayIso()): Promise<string> {
  const row = await loadForEdit(tx, id);
  const date = checkReminder(on, today, row.sentOn, row.reminders);
  await change(tx, row, s, "reminders = array_append(reminders, $3::date)", [date]);
  await log(tx, s, "confirmation_reminder", "confirmation", id, { engagementId: row.engagementId, reference: row.reference, date });
  return row.engagementId;
}

export async function removeReminder(tx: Tx, s: Session, id: string, date: string): Promise<string> {
  const row = await loadForEdit(tx, id);
  if (!row.reminders.includes(date)) throw new Error("There is no reminder on that date.");
  await change(tx, row, s, "reminders = array_remove(reminders, $3::date)", [date]);
  await log(tx, s, "confirmation_reminder_removed", "confirmation", id, { engagementId: row.engagementId, reference: row.reference, date });
  return row.engagementId;
}

/**
 * Record the reply. Agreed takes the book balance as the confirmed amount; differs needs the confirmed amount; no reply has no date or
 * amount. The explanation of a difference or the alternative work belongs to one kind of reply, so the other is cleared.
 */
export async function recordReply(
  tx: Tx,
  s: Session,
  id: string,
  input: { reply: string; repliedOn?: string | null; confirmedMinor?: number | null; replyNote?: string | null },
  today: string = todayIso(),
): Promise<string> {
  const row = await loadForEdit(tx, id);
  const v = checkReply(input, { bookMinor: row.bookMinor, sentOn: row.sentOn, today });
  await change(
    tx,
    row,
    s,
    `reply = $3, replied_on = $4, confirmed_balance_minor = $5, reply_note = $6,
     reconciliation = case when $3 = 'differs' then reconciliation else null end,
     alternative_procedures = case when $3 = 'no_reply' then alternative_procedures else null end`,
    [v.reply, v.repliedOn, v.confirmedMinor, cleanReplyNote(input.replyNote)],
  );
  await log(tx, s, "confirmation_reply", "confirmation", id, { engagementId: row.engagementId, reference: row.reference, reply: v.reply, unprepared: wasPrepared(row) });
  return row.engagementId;
}

export async function clearReply(tx: Tx, s: Session, id: string): Promise<string> {
  const row = await loadForEdit(tx, id);
  if (!row.reply) throw new Error("No reply is recorded.");
  await change(tx, row, s, "reply = null, replied_on = null, confirmed_balance_minor = null, reply_note = null", []);
  await log(tx, s, "confirmation_reply_cleared", "confirmation", id, { engagementId: row.engagementId, reference: row.reference, was: row.reply });
  return row.engagementId;
}

export async function saveReconciliation(tx: Tx, s: Session, id: string, text: string): Promise<string> {
  const row = await loadForEdit(tx, id);
  if (row.reply !== "differs") throw new Error("A reconciliation is recorded when the reply differs from the books.");
  await change(tx, row, s, "reconciliation = $3", [cleanWork(text, "The reconciliation")]);
  await log(tx, s, "confirmation_reconciliation", "confirmation", id, { engagementId: row.engagementId, reference: row.reference, unprepared: wasPrepared(row) });
  return row.engagementId;
}

export async function saveAlternativeProcedures(tx: Tx, s: Session, id: string, text: string): Promise<string> {
  const row = await loadForEdit(tx, id);
  if (row.reply !== "no_reply") throw new Error("Alternative procedures are recorded when no reply came.");
  await change(tx, row, s, "alternative_procedures = $3", [cleanWork(text, "The alternative procedures")]);
  await log(tx, s, "confirmation_alternatives", "confirmation", id, { engagementId: row.engagementId, reference: row.reference, unprepared: wasPrepared(row) });
  return row.engagementId;
}

/** Link a file already uploaded to this engagement (a working paper) as the reply or its support. */
export async function linkFile(tx: Tx, s: Session, id: string, workingPaperId: string): Promise<string> {
  const row = await loadForEdit(tx, id);
  const paper = await tx.query<{ fileName: string }>('select file_name as "fileName" from working_papers where id::text = $1 and engagement_id = $2', [workingPaperId, row.engagementId]);
  if (paper.rows.length === 0) throw new Error("That file is not on this engagement. Upload it under Working papers first.");
  const made = await tx.query(
    "insert into confirmation_files (firm_id, engagement_id, confirmation_id, working_paper_id, linked_by) values ($1, $2, $3, $4, $5) on conflict do nothing returning confirmation_id",
    [s.firmId, row.engagementId, id, workingPaperId, s.userId],
  );
  if (made.rows.length === 0) throw new Error("That file is already linked to this confirmation.");
  await change(tx, row, s, "party_name = party_name", []);
  await log(tx, s, "confirmation_link", "confirmation", id, { engagementId: row.engagementId, reference: row.reference, fileName: paper.rows[0].fileName, unprepared: wasPrepared(row) });
  return row.engagementId;
}

export async function unlinkFile(tx: Tx, s: Session, id: string, workingPaperId: string): Promise<string> {
  const row = await loadForEdit(tx, id);
  const gone = await tx.query("delete from confirmation_files where confirmation_id = $1 and working_paper_id::text = $2 returning confirmation_id", [id, workingPaperId]);
  if (gone.rows.length === 0) throw new Error("That file is not linked to this confirmation.");
  await change(tx, row, s, "party_name = party_name", []);
  await log(tx, s, "confirmation_unlink", "confirmation", id, { engagementId: row.engagementId, reference: row.reference, workingPaperId, unprepared: wasPrepared(row) });
  return row.engagementId;
}

/** Mark the confirmation prepared: sent, a reply recorded, and the reconciliation or alternative work written where the reply needs one. */
export async function prepareConfirmation(tx: Tx, s: Session, id: string): Promise<string> {
  const row = await loadForEdit(tx, id);
  if (row.preparedBy) throw new Error("This confirmation is already prepared.");
  const blocker = prepareBlocker(row);
  if (blocker) throw new Error(blocker);
  await tx.query("update confirmations set prepared_by = $2, prepared_at = now(), updated_at = clock_timestamp() where id = $1", [id, s.userId]);
  await log(tx, s, "confirmation_prepare", "confirmation", id, { engagementId: row.engagementId, reference: row.reference });
  return row.engagementId;
}

/** Withdraw the preparation. The preparer may, or any reviewer or partner. */
export async function unprepareConfirmation(tx: Tx, s: Session, id: string): Promise<string> {
  const row = await loadForEdit(tx, id);
  if (!row.preparedBy) throw new Error("This confirmation is not prepared.");
  if (row.preparedBy !== s.userId && !canReview(s.role)) throw new Error("Only the person who prepared it, or a reviewer or partner, can withdraw the preparation.");
  await tx.query("update confirmations set prepared_by = null, prepared_at = null, updated_at = clock_timestamp() where id = $1", [id]);
  await log(tx, s, "confirmation_unprepare", "confirmation", id, { engagementId: row.engagementId, reference: row.reference });
  return row.engagementId;
}

/** Review a prepared confirmation. The reviewer must differ from everyone who did the work, unless the firm has no other reviewer. */
export async function reviewConfirmation(tx: Tx, s: Session, id: string): Promise<string> {
  const row = await load(tx, id);
  await requireAudit(tx, row.engagementId);
  const { selfReview } = await assertMayReview(tx, s, workedBy(row));
  if (!row.preparedBy) throw new Error("The confirmation must be prepared before it is reviewed.");
  if (row.reviewedBy) throw new Error("This confirmation has already been reviewed.");
  await tx.query("update confirmations set reviewed_by = $2, reviewed_at = now(), updated_at = clock_timestamp() where id = $1", [id, s.userId]);
  await log(tx, s, "confirmation_review", "confirmation", id, { engagementId: row.engagementId, reference: row.reference, selfReview });
  return row.engagementId;
}

export async function unreviewConfirmation(tx: Tx, s: Session, id: string): Promise<string> {
  const row = await load(tx, id);
  await requireAudit(tx, row.engagementId);
  if (!canReview(s.role)) throw new Error("Only a reviewer or partner can withdraw a review.");
  if (!row.reviewedBy) throw new Error("This confirmation has not been reviewed.");
  await tx.query("update confirmations set reviewed_by = null, reviewed_at = null, updated_at = clock_timestamp() where id = $1", [id]);
  await log(tx, s, "confirmation_unreview", "confirmation", id, { engagementId: row.engagementId, reference: row.reference, reviewedBy: row.reviewedBy });
  return row.engagementId;
}

/** Delete one that is not reviewed and has no files linked. Once a reply is recorded it is someone's work, so only a reviewer or partner may. */
export async function deleteConfirmation(tx: Tx, s: Session, id: string): Promise<string> {
  const row = await loadForEdit(tx, id);
  if (row.reply && !canReview(s.role)) throw new Error("Only a reviewer or partner can delete a confirmation that has a reply.");
  const linked = await tx.query("select 1 from confirmation_files where confirmation_id = $1 limit 1", [id]);
  if (linked.rows.length > 0) throw new Error("This confirmation has files linked to it. Unlink them before deleting it.");
  await tx.query("delete from confirmations where id = $1", [id]);
  await log(tx, s, "confirmation_delete", "confirmation", id, { engagementId: row.engagementId, reference: row.reference, partyName: row.partyName });
  return row.engagementId;
}

const key = (kind: string, party: string, accountRef: string | null) => `${kind}|${party.trim().toLowerCase()}|${(accountRef ?? "").trim().toLowerCase()}`;

/**
 * Copy last year's confirmations as new ones to send: kind, area, party, contact and account reference, with a book balance of zero
 * and nothing else (no dates, reply or sign-off). The prior engagement must be for the same client. One already brought forward, or
 * for the same kind, party and account already on this engagement, is skipped.
 */
export async function bringForwardConfirmations(tx: Tx, s: Session, engagementId: string): Promise<{ created: number; skipped: number }> {
  await requireAudit(tx, engagementId);
  const engagement = await getEngagement(tx, engagementId);
  if (!engagement?.priorEngagementId) throw new Error("This engagement is not linked to a prior year, so there is nothing to bring forward.");
  const prior = await getEngagement(tx, engagement.priorEngagementId);
  if (!prior || prior.clientId !== engagement.clientId) throw new Error("The prior-year engagement is not for the same client.");

  const last = await tx.query<{ id: string; kind: string; areaCode: string; partyName: string; contact: string | null; accountRef: string | null }>(
    `select id, kind, area_code as "areaCode", party_name as "partyName", contact, account_ref as "accountRef" from confirmations where engagement_id = $1 order by seq`,
    [prior.id],
  );
  const here = await tx.query<{ kind: string; partyName: string; accountRef: string | null; from: string | null }>(
    `select kind, party_name as "partyName", account_ref as "accountRef", rolled_from_id as "from" from confirmations where engagement_id = $1`,
    [engagementId],
  );
  const brought = new Set(here.rows.map((r) => r.from).filter((x): x is string => !!x));
  const have = new Set(here.rows.map((r) => key(r.kind, r.partyName, r.accountRef)));
  let seq = await nextSeq(tx, engagementId);
  let created = 0;
  for (const p of last.rows) {
    const k = key(p.kind, p.partyName, p.accountRef);
    if (brought.has(p.id) || have.has(k)) continue;
    have.add(k);
    await tx.query(
      `insert into confirmations (firm_id, engagement_id, seq, reference, kind, area_code, party_name, contact, account_ref, book_balance_minor, rolled_from_id, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $10, $11)`,
      [s.firmId, engagementId, seq, `CF-${seq}`, p.kind, p.areaCode, p.partyName, p.contact, p.accountRef, p.id, s.userId],
    );
    seq++;
    created++;
  }
  const skipped = last.rows.length - created;
  await log(tx, s, "confirmation_rollforward", "engagement", engagementId, { fromEngagementId: prior.id, created, skipped });
  return { created, skipped };
}
