import { createHash, randomUUID } from "node:crypto";
import type { Tx } from "./db";
import type { FileStore } from "./file-store";
import { maxUploadBytes, uploadTooLargeMessage } from "./config";
import { audit as log, getEngagement, type Session } from "./repo";
import { canReview } from "../domain/signoff";
import { GROUP_BY_CODE } from "../domain/groups";
import { cleanFileReference, cleanSectionCode, homeOfFile } from "../domain/wp-index";

export const MAX_FILE_BYTES = maxUploadBytes();
/** File types accepted as working papers. Anything else is refused. */
export const ALLOWED_EXTENSIONS = ["pdf", "xlsx", "xls", "csv", "docx", "doc", "png", "jpg", "jpeg", "txt"];

export type TargetKind = "engagement" | "lead_sheet" | "procedure";

export interface WorkingPaper {
  id: string;
  targetKind: TargetKind;
  /** Group code for a lead sheet, procedure id for a procedure, null for the engagement. */
  target: string | null;
  /** Readable name of what the file supports. */
  targetLabel: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  description: string | null;
  /** The reference the preparer gave the file on the working paper index, such as C5-F1; null when none. */
  reference: string | null;
  /** The area or checklist an engagement-level file is filed under on the index; null when unfiled or when the file follows what it supports. */
  sectionCode: string | null;
  uploadedBy: string;
  uploadedByName: string;
  uploadedAt: string;
}

async function requireOpen(tx: Tx, engagementId: string) {
  const engagement = await getEngagement(tx, engagementId);
  if (!engagement) throw new Error("Engagement not found.");
  if (engagement.status !== "open") throw new Error("This engagement is locked.");
}

/** Reduce an uploaded name to a plain file name: no folders, no control characters, a sensible length. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  if (cleaned.length <= 150) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 ? cleaned.slice(dot) : "";
  return cleaned.slice(0, 150 - ext.length) + ext;
}

const SELECT = `
  select w.id, w.target_kind as "targetKind", w.target, w.file_name as "fileName", w.size_bytes::float8 as "sizeBytes", w.sha256,
         w.description, w.reference, w.section_code as "sectionCode", w.uploaded_by as "uploadedBy", u.name as "uploadedByName", to_char(w.uploaded_at, 'YYYY-MM-DD') as "uploadedAt",
         p.template_id as "procedureCode"
  from working_papers w
  join users u on u.id = w.uploaded_by
  left join audit_procedures p on w.target_kind = 'procedure' and p.id::text = w.target`;

type Row = Omit<WorkingPaper, "targetLabel"> & { procedureCode: string | null };
const label = (r: Row): WorkingPaper => {
  const { procedureCode, ...rest } = r;
  const targetLabel =
    r.targetKind === "engagement" ? "General" : r.targetKind === "lead_sheet" ? (GROUP_BY_CODE.get(r.target ?? "")?.name ?? r.target ?? "") : `Procedure ${procedureCode ?? ""}`.trim();
  return { ...rest, targetLabel };
};

export async function listWorkingPapers(tx: Tx, engagementId: string): Promise<WorkingPaper[]> {
  const { rows } = await tx.query<Row>(`${SELECT} where w.engagement_id = $1 order by w.uploaded_at, w.file_name`, [engagementId]);
  return rows.map(label);
}

/**
 * Give an uploaded file its reference and the place it is filed on the working paper index. Anyone in the firm may; an engagement that
 * is locked refuses. The file's bytes and description are untouched, and only these two columns can be changed (the database grants no more).
 *
 * A file that supports a lead sheet or a procedure is filed where that lead sheet or procedure is, so it takes no place of its own. A file
 * that supports the engagement generally is filed under the area or checklist chosen, or the one its reference starts with.
 */
export async function setFileFiling(tx: Tx, s: Session, id: string, input: { reference: string; sectionCode: string }): Promise<string> {
  const { rows } = await tx.query<{ engagementId: string; targetKind: TargetKind; target: string | null; template: string | null; reference: string | null; sectionCode: string | null }>(
    `select w.engagement_id as "engagementId", w.target_kind as "targetKind", w.target, p.template_id as template, w.reference, w.section_code as "sectionCode"
     from working_papers w left join audit_procedures p on w.target_kind = 'procedure' and p.id::text = w.target
     where w.id::text = $1`,
    [id],
  );
  if (rows.length === 0) throw new Error("Working paper not found.");
  const row = rows[0];
  await requireOpen(tx, row.engagementId);

  const reference = cleanFileReference(input.reference);
  let sectionCode = cleanSectionCode(input.sectionCode);
  if (row.targetKind !== "engagement" && sectionCode) throw new Error("This file is filed where the lead sheet or procedure it supports is. Only a file that supports the engagement generally can be filed elsewhere.");
  if (row.targetKind === "engagement" && reference && !sectionCode) sectionCode = reference.split("-")[0];

  const home = homeOfFile({ targetKind: row.targetKind, target: row.target, procedureTemplate: row.template, sectionCode });
  if (reference && !home) throw new Error("This file is not filed under an area or checklist (what it supported is no longer on the file), so it cannot take a reference. File it under one first.");
  if (reference && home && reference.split("-")[0] !== home) throw new Error(`The reference ${reference} does not match where this file is filed (${home}). Start it with ${home}.`);

  if (reference) {
    const taken = await tx.query("select 1 from working_papers where engagement_id = $1 and reference = $2 and id::text <> $3", [row.engagementId, reference, id]);
    if (taken.rows.length > 0) throw new Error(`Another file already has the reference ${reference}.`);
  }
  if (reference === row.reference && sectionCode === row.sectionCode) return row.engagementId; // nothing changed: no write, no log entry
  await tx.query("update working_papers set reference = $2, section_code = $3 where id::text = $1", [id, reference, sectionCode]);
  await log(tx, s, "file", "working_paper", id, { engagementId: row.engagementId, reference, sectionCode, previousReference: row.reference, previousSectionCode: row.sectionCode });
  return row.engagementId;
}

/**
 * Store a file as a working paper. The bytes are written first; if recording the file
 * then fails, they are removed again so nothing is left unreferenced.
 */
export async function addWorkingPaper(
  tx: Tx,
  s: Session,
  store: FileStore,
  engagementId: string,
  input: { targetKind: string; target: string | null; fileName: string; data: Uint8Array; description: string },
): Promise<string> {
  await requireOpen(tx, engagementId);

  const fileName = cleanFileName(input.fileName);
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  if (!fileName || !ALLOWED_EXTENSIONS.includes(ext)) {
    throw new Error(`That file type is not accepted. Upload one of: ${ALLOWED_EXTENSIONS.join(", ")}.`);
  }
  if (input.data.byteLength === 0) throw new Error("The file is empty.");
  if (input.data.byteLength > MAX_FILE_BYTES) throw new Error(uploadTooLargeMessage());
  const description = input.description.trim();
  if (description.length > 500) throw new Error("The description is too long.");

  let target: string | null = null;
  if (input.targetKind === "lead_sheet") {
    if (!input.target || !GROUP_BY_CODE.has(input.target)) throw new Error("Choose the lead sheet the file supports.");
    target = input.target;
  } else if (input.targetKind === "procedure") {
    const found = await tx.query<{ reviewed: boolean }>("select reviewed_by is not null as reviewed from audit_procedures where id::text = $1 and engagement_id = $2", [input.target ?? "", engagementId]);
    if (found.rows.length === 0) throw new Error("That procedure is not on this engagement.");
    // A review vouches for the evidence as it stood, so more cannot be added under it.
    if (found.rows[0].reviewed) throw new Error("This procedure has been reviewed. Ask the reviewer to withdraw the review before attaching evidence.");
    const audited = await tx.query<{ on: boolean }>('select audit_enabled as "on" from engagements where id = $1', [engagementId]);
    if (!audited.rows[0]?.on) throw new Error("Turn the audit on for this engagement first.");
    target = input.target;
  } else if (input.targetKind !== "engagement") {
    throw new Error("Choose what the file supports.");
  }

  const id = randomUUID();
  const storageKey = `${s.firmId}/${id}`;
  await store.put(storageKey, input.data);
  try {
    await tx.query(
      `insert into working_papers (id, firm_id, engagement_id, target_kind, target, file_name, size_bytes, sha256, storage_key, description, uploaded_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [id, s.firmId, engagementId, input.targetKind, target, fileName, input.data.byteLength, createHash("sha256").update(input.data).digest("hex"), storageKey, description || null, s.userId],
    );
    await log(tx, s, "upload", "working_paper", id, { engagementId, fileName, targetKind: input.targetKind, target });
  } catch (e) {
    await store.remove(storageKey);
    throw e;
  }
  return id;
}

/** Read a working paper's file. Returns null when it does not exist or belongs to another firm. */
export async function readWorkingPaper(tx: Tx, store: FileStore, engagementId: string, id: string): Promise<{ fileName: string; data: Uint8Array } | null> {
  const { rows } = await tx.query<{ fileName: string; storageKey: string; sha256: string }>(
    'select file_name as "fileName", storage_key as "storageKey", sha256 from working_papers where id::text = $1 and engagement_id::text = $2',
    [id, engagementId],
  );
  if (rows.length === 0) return null;
  const data = await store.get(rows[0].storageKey);
  if (!data) return null;
  // Evidence must be exactly what was uploaded: refuse to serve a file that has changed on disk.
  if (createHash("sha256").update(data).digest("hex") !== rows[0].sha256) throw new Error("The stored file does not match its record.");
  return { fileName: rows[0].fileName, data };
}

/**
 * Remove a working paper's record while the engagement is open. The uploader, or a reviewer or
 * partner, may do so. The caller deletes the bytes (the returned storage key) only after the
 * transaction has committed, so a failed commit never leaves a record whose file is gone.
 */
export async function removeWorkingPaper(tx: Tx, s: Session, id: string): Promise<{ engagementId: string; storageKey: string }> {
  const { rows } = await tx.query<{ engagementId: string; uploadedBy: string; storageKey: string; fileName: string; targetKind: TargetKind; target: string | null }>(
    'select engagement_id as "engagementId", uploaded_by as "uploadedBy", storage_key as "storageKey", file_name as "fileName", target_kind as "targetKind", target from working_papers where id::text = $1',
    [id],
  );
  if (rows.length === 0) throw new Error("Working paper not found.");
  await requireOpen(tx, rows[0].engagementId);
  if (rows[0].uploadedBy !== s.userId && !canReview(s.role)) throw new Error("Only the person who uploaded this file, or a reviewer or partner, can remove it.");
  // Evidence that work already relies on stays put: reopen the procedure, or withdraw the sign-off, first.
  if (rows[0].targetKind === "procedure") {
    const done = await tx.query("select 1 from audit_procedures where id::text = $1 and status <> 'open'", [rows[0].target]);
    if (done.rows.length > 0) throw new Error("This file supports a completed procedure. Reopen the procedure before removing it.");
  }
  const used = await tx.query("select 1 from test_schedule_lines where working_paper_id::text = $1 limit 1", [id]);
  if (used.rows.length > 0) throw new Error("This file is linked as evidence on a test schedule. Unlink it there before removing it.");
  const answers = await tx.query("select 1 from client_request_files where working_paper_id::text = $1 limit 1", [id]);
  if (answers.rows.length > 0) throw new Error("This file is linked to a client request. Unlink it there before removing it.");
  const confirmed = await tx.query("select 1 from confirmation_files where working_paper_id::text = $1 limit 1", [id]);
  if (confirmed.rows.length > 0) throw new Error("This file is linked to a confirmation. Unlink it there before removing it.");
  if (rows[0].targetKind === "lead_sheet") {
    const signed = await tx.query("select 1 from sign_offs where engagement_id = $1 and target = $2 limit 1", [rows[0].engagementId, rows[0].target]);
    if (signed.rows.length > 0) throw new Error("This file supports a lead sheet that has been signed off. Withdraw the sign-off before removing it.");
  }
  await tx.query("delete from working_papers where id::text = $1", [id]);
  await log(tx, s, "remove", "working_paper", id, { engagementId: rows[0].engagementId, fileName: rows[0].fileName });
  return { engagementId: rows[0].engagementId, storageKey: rows[0].storageKey };
}
