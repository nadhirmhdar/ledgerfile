import type { Tx } from "./db";
import { audit as log, getEngagement, type Session } from "./repo";
import { areaCodesInScope } from "./audit";
import { AREA_BY_CODE } from "../domain/audit";
import { DEFAULT_REQUESTS } from "../domain/client-request-defaults";
import {
  cleanDescription,
  cleanNote,
  descriptionKey,
  isIsoDate,
  isOverdue,
  summarise,
  todayIso,
  type Counts,
  type RequestStatus,
} from "../domain/client-requests";

/**
 * The client request list. It works on any open engagement, audited or not: a compilation job needs a request list too, and
 * nothing here depends on the audit being turned on. Every role in the firm may do everything on it; the rules that apply to
 * everyone are that a locked engagement cannot be changed and that every change is written to the audit log.
 */

export interface RequestFile {
  id: string;
  fileName: string;
  sizeBytes: number;
}

export interface RequestView {
  id: string;
  seq: number;
  reference: string;
  areaCode: string | null;
  areaTitle: string;
  description: string;
  requestedBy: string;
  requestedByName: string;
  requestedOn: string;
  dueOn: string | null;
  status: RequestStatus;
  receivedOn: string | null;
  note: string | null;
  overdue: boolean;
  files: RequestFile[];
}

interface Row {
  id: string;
  engagementId: string;
  seq: number;
  reference: string;
  areaCode: string | null;
  description: string;
  requestedBy: string;
  requestedByName: string;
  requestedOn: string;
  dueOn: string | null;
  status: RequestStatus;
  receivedOn: string | null;
  note: string | null;
}

const SELECT = `
  select r.id, r.engagement_id as "engagementId", r.seq, r.reference, r.area_code as "areaCode", r.description,
         r.requested_by as "requestedBy", u.name as "requestedByName",
         to_char(r.requested_on, 'YYYY-MM-DD') as "requestedOn", to_char(r.due_on, 'YYYY-MM-DD') as "dueOn",
         r.status, to_char(r.received_on, 'YYYY-MM-DD') as "receivedOn", r.note
  from client_requests r join users u on u.id = r.requested_by`;

async function requireOpen(tx: Tx, engagementId: string) {
  const engagement = await getEngagement(tx, engagementId);
  if (!engagement) throw new Error("Engagement not found.");
  if (engagement.status !== "open") throw new Error("This engagement is locked.");
  return engagement;
}

async function load(tx: Tx, id: string): Promise<Row> {
  const { rows } = await tx.query<Row>(`${SELECT} where r.id::text = $1`, [id]);
  if (rows.length === 0) throw new Error("Request not found.");
  return rows[0];
}

const areaTitle = (code: string | null) => (code ? `${code} ${AREA_BY_CODE.get(code)?.title ?? ""}`.trim() : "General");

/** An area is one of the audit areas, or none (a general request). Empty text means none. */
function cleanArea(code: string | null | undefined): string | null {
  const c = (code ?? "").trim();
  if (!c) return null;
  if (!AREA_BY_CODE.has(c)) throw new Error("Choose one of the audit areas, or leave the area blank for a general request.");
  return c;
}

function cleanDate(text: string | null | undefined, what: string): string | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  if (!isIsoDate(t)) throw new Error(`${what} is not a valid date.`);
  return t;
}

function checkDue(dueOn: string | null, requestedOn: string) {
  if (dueOn && dueOn < requestedOn) throw new Error("The due date cannot be before the date the request was made.");
}

/** Every request on the engagement, in reference order, with the files linked to each. */
export async function listRequests(tx: Tx, engagementId: string, today: string = todayIso()): Promise<RequestView[]> {
  const { rows } = await tx.query<Row>(`${SELECT} where r.engagement_id = $1 order by r.seq`, [engagementId]);
  if (rows.length === 0) return [];
  const linked = await tx.query<{ requestId: string; id: string; fileName: string; sizeBytes: number }>(
    `select f.request_id as "requestId", w.id, w.file_name as "fileName", w.size_bytes::float8 as "sizeBytes"
     from client_request_files f join working_papers w on w.id = f.working_paper_id
     join client_requests r on r.id = f.request_id
     where r.engagement_id = $1 order by w.file_name`,
    [engagementId],
  );
  const files = new Map<string, RequestFile[]>();
  for (const f of linked.rows) files.set(f.requestId, [...(files.get(f.requestId) ?? []), { id: f.id, fileName: f.fileName, sizeBytes: f.sizeBytes }]);
  return rows.map((r) => ({ ...r, areaTitle: areaTitle(r.areaCode), overdue: isOverdue(r, today), files: files.get(r.id) ?? [] }));
}

/** Counts overall and by area, for the list page and the audit area pages. */
export async function requestCounts(tx: Tx, engagementId: string, today: string = todayIso()): Promise<{ overall: Counts; byArea: Map<string, Counts> }> {
  const { rows } = await tx.query<{ status: RequestStatus; dueOn: string | null; areaCode: string | null }>(
    `select status, to_char(due_on, 'YYYY-MM-DD') as "dueOn", area_code as "areaCode" from client_requests where engagement_id = $1`,
    [engagementId],
  );
  return summarise(rows, today);
}

/** The next free number on the engagement: one more than the highest still on the list. */
async function nextSeq(tx: Tx, engagementId: string): Promise<number> {
  const { rows } = await tx.query<{ n: number }>("select coalesce(max(seq), 0)::int + 1 as n from client_requests where engagement_id = $1", [engagementId]);
  return rows[0].n;
}

async function insertRequest(
  tx: Tx,
  s: Session,
  engagementId: string,
  seq: number,
  v: { areaCode: string | null; description: string; requestedOn: string; dueOn: string | null; rolledFromId?: string | null },
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `insert into client_requests (firm_id, engagement_id, seq, reference, area_code, description, requested_by, requested_on, due_on, rolled_from_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [s.firmId, engagementId, seq, `R-${seq}`, v.areaCode, v.description, s.userId, v.requestedOn, v.dueOn, v.rolledFromId ?? null],
  );
  return rows[0].id;
}

export async function addRequest(
  tx: Tx,
  s: Session,
  engagementId: string,
  input: { description: string; areaCode?: string | null; dueOn?: string | null; requestedOn?: string | null },
  today: string = todayIso(),
): Promise<string> {
  await requireOpen(tx, engagementId);
  const description = cleanDescription(input.description);
  const areaCode = cleanArea(input.areaCode);
  const requestedOn = cleanDate(input.requestedOn, "The request date") ?? today;
  const dueOn = cleanDate(input.dueOn, "The due date");
  checkDue(dueOn, requestedOn);
  const id = await insertRequest(tx, s, engagementId, await nextSeq(tx, engagementId), { areaCode, description, requestedOn, dueOn });
  await log(tx, s, "client_request_add", "client_request", id, { engagementId, areaCode, dueOn });
  return id;
}

/** Change the wording, area, due date or note. Status changes have their own steps. Returns the engagement id. */
export async function editRequest(tx: Tx, s: Session, id: string, input: { description: string; areaCode?: string | null; dueOn?: string | null; note?: string | null }): Promise<string> {
  const row = await load(tx, id);
  await requireOpen(tx, row.engagementId);
  const description = cleanDescription(input.description);
  const areaCode = cleanArea(input.areaCode);
  const dueOn = cleanDate(input.dueOn, "The due date");
  checkDue(dueOn, row.requestedOn);
  const note = cleanNote(input.note);
  if (row.status === "not_applicable" && !note) throw new Error("A request marked not applicable needs the reason in its note.");
  await tx.query("update client_requests set description = $2, area_code = $3, due_on = $4, note = $5, updated_at = clock_timestamp() where id = $1", [id, description, areaCode, dueOn, note]);
  await log(tx, s, "client_request_edit", "client_request", id, { engagementId: row.engagementId, reference: row.reference });
  return row.engagementId;
}

/** The client has sent it. The date defaults to today and cannot be in the future. */
export async function markReceived(tx: Tx, s: Session, id: string, receivedOn?: string | null, today: string = todayIso()): Promise<string> {
  const row = await load(tx, id);
  await requireOpen(tx, row.engagementId);
  if (row.status !== "open") throw new Error("Only an open request can be marked received. Reopen it first.");
  const date = cleanDate(receivedOn, "The received date") ?? today;
  if (date > today) throw new Error("The received date cannot be in the future.");
  await tx.query("update client_requests set status = 'received', received_on = $2, updated_at = clock_timestamp() where id = $1", [id, date]);
  await log(tx, s, "client_request_received", "client_request", id, { engagementId: row.engagementId, reference: row.reference, receivedOn: date });
  return row.engagementId;
}

export async function markNotApplicable(tx: Tx, s: Session, id: string, note: string): Promise<string> {
  const row = await load(tx, id);
  await requireOpen(tx, row.engagementId);
  if (row.status !== "open") throw new Error("Only an open request can be marked not applicable. Reopen it first.");
  const reason = cleanNote(note);
  if (!reason) throw new Error("Say why the request is not applicable.");
  await tx.query("update client_requests set status = 'not_applicable', note = $2, updated_at = clock_timestamp() where id = $1", [id, reason]);
  await log(tx, s, "client_request_not_applicable", "client_request", id, { engagementId: row.engagementId, reference: row.reference });
  return row.engagementId;
}

/** Put a received or not applicable request back to open. Its note and any linked files stay. */
export async function reopenRequest(tx: Tx, s: Session, id: string): Promise<string> {
  const row = await load(tx, id);
  await requireOpen(tx, row.engagementId);
  if (row.status === "open") throw new Error("This request is already open.");
  await tx.query("update client_requests set status = 'open', received_on = null, updated_at = clock_timestamp() where id = $1", [id]);
  await log(tx, s, "client_request_reopen", "client_request", id, { engagementId: row.engagementId, reference: row.reference, from: row.status });
  return row.engagementId;
}

/** Remove a request that is still open and has no files linked. Anything that has been answered stays on the record. */
export async function deleteRequest(tx: Tx, s: Session, id: string): Promise<string> {
  const row = await load(tx, id);
  await requireOpen(tx, row.engagementId);
  if (row.status !== "open") throw new Error("Only an open request can be deleted. Reopen it first, or leave it as it is.");
  const linked = await tx.query("select 1 from client_request_files where request_id = $1 limit 1", [id]);
  if (linked.rows.length > 0) throw new Error("This request has files linked to it. Unlink them before deleting it.");
  await tx.query("delete from client_requests where id = $1", [id]);
  await log(tx, s, "client_request_delete", "client_request", id, { engagementId: row.engagementId, reference: row.reference, description: row.description });
  return row.engagementId;
}

/** Link a file already uploaded to this engagement (a working paper) to a request. */
export async function linkFile(tx: Tx, s: Session, requestId: string, workingPaperId: string): Promise<string> {
  const row = await load(tx, requestId);
  await requireOpen(tx, row.engagementId);
  const paper = await tx.query<{ fileName: string }>("select file_name as \"fileName\" from working_papers where id::text = $1 and engagement_id = $2", [workingPaperId, row.engagementId]);
  if (paper.rows.length === 0) throw new Error("That file is not on this engagement. Upload it under Working papers first.");
  const made = await tx.query(
    "insert into client_request_files (firm_id, request_id, working_paper_id, linked_by) values ($1, $2, $3, $4) on conflict do nothing returning request_id",
    [s.firmId, requestId, workingPaperId, s.userId],
  );
  if (made.rows.length === 0) throw new Error("That file is already linked to this request.");
  await log(tx, s, "client_request_link", "client_request", requestId, { engagementId: row.engagementId, reference: row.reference, fileName: paper.rows[0].fileName });
  return row.engagementId;
}

export async function unlinkFile(tx: Tx, s: Session, requestId: string, workingPaperId: string): Promise<string> {
  const row = await load(tx, requestId);
  await requireOpen(tx, row.engagementId);
  const gone = await tx.query("delete from client_request_files where request_id = $1 and working_paper_id::text = $2 returning request_id", [requestId, workingPaperId]);
  if (gone.rows.length === 0) throw new Error("That file is not linked to this request.");
  await log(tx, s, "client_request_unlink", "client_request", requestId, { engagementId: row.engagementId, reference: row.reference, workingPaperId });
  return row.engagementId;
}

/**
 * Add the standard requests for the engagement: the general ones, and those for each audit area with a balance on the trial
 * balance. The areas come from the trial balance whether or not the audit is turned on. A request whose wording is already on
 * the list (in any area, any status) is skipped, so the button can be pressed again after the trial balance changes.
 */
export async function addStandardRequests(tx: Tx, s: Session, engagementId: string, today: string = todayIso()): Promise<{ added: number; skipped: number }> {
  await requireOpen(tx, engagementId);
  const inScope = await areaCodesInScope(tx, engagementId);
  const existing = await tx.query<{ description: string }>("select description from client_requests where engagement_id = $1", [engagementId]);
  const have = new Set(existing.rows.map((r) => descriptionKey(r.description)));
  let seq = await nextSeq(tx, engagementId);
  let added = 0;
  let skipped = 0;
  for (const d of DEFAULT_REQUESTS) {
    if (d.areaCode && !inScope.has(d.areaCode)) continue;
    const key = descriptionKey(d.description);
    if (have.has(key)) {
      skipped++;
      continue;
    }
    have.add(key);
    await insertRequest(tx, s, engagementId, seq++, { areaCode: d.areaCode, description: d.description, requestedOn: today, dueOn: null });
    added++;
  }
  await log(tx, s, "client_request_starter", "engagement", engagementId, { added, skipped });
  return { added, skipped };
}

/**
 * Copy last year's requests into this engagement as open requests dated today, with no due date. The prior engagement must be
 * for the same client. A request already brought forward, or whose wording is already on this list, is skipped.
 */
export async function bringForwardRequests(tx: Tx, s: Session, engagementId: string, today: string = todayIso()): Promise<{ created: number; skipped: number }> {
  const engagement = await requireOpen(tx, engagementId);
  if (!engagement.priorEngagementId) throw new Error("This engagement is not linked to a prior year, so there is nothing to bring forward.");
  const prior = await getEngagement(tx, engagement.priorEngagementId);
  if (!prior || prior.clientId !== engagement.clientId) throw new Error("The prior-year engagement is not for the same client.");

  const last = await tx.query<{ id: string; areaCode: string | null; description: string }>(
    'select id, area_code as "areaCode", description from client_requests where engagement_id = $1 order by seq',
    [prior.id],
  );
  const here = await tx.query<{ description: string; from: string | null }>('select description, rolled_from_id as "from" from client_requests where engagement_id = $1', [engagementId]);
  const brought = new Set(here.rows.map((r) => r.from).filter((x): x is string => !!x));
  const have = new Set(here.rows.map((r) => descriptionKey(r.description)));
  let seq = await nextSeq(tx, engagementId);
  let created = 0;
  for (const p of last.rows) {
    const key = descriptionKey(p.description);
    if (brought.has(p.id) || have.has(key)) continue;
    have.add(key);
    await insertRequest(tx, s, engagementId, seq++, { areaCode: p.areaCode, description: p.description, requestedOn: today, dueOn: null, rolledFromId: p.id });
    created++;
  }
  const skipped = last.rows.length - created;
  await log(tx, s, "client_request_rollforward", "engagement", engagementId, { fromEngagementId: prior.id, created, skipped });
  return { created, skipped };
}
