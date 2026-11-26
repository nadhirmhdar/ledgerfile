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

/** One version of a working paper, for its history. */
export interface PaperVersion {
  id: string;
  /** 1 for the first upload, counted along the chain of replacements. */
  version: number;
  fileName: string;
  sizeBytes: number;
  uploadedByName: string;
  uploadedAt: string;
}

export interface WorkingPaper {
  id: string;
  /** The version number of this (the current) version. */
  version: number;
  /** Every version of this paper, newest first, the current one included. One entry when the paper has never been replaced. */
  history: PaperVersion[];
  /** The earlier version this one replaced, or null for version 1. */
  replacesId: string | null;
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
         w.replaces_id as "replacesId", p.template_id as "procedureCode"
  from working_papers w
  join users u on u.id = w.uploaded_by
  left join audit_procedures p on w.target_kind = 'procedure' and p.id::text = w.target`;

type Row = Omit<WorkingPaper, "targetLabel" | "version" | "history"> & { procedureCode: string | null };
const label = (r: Row, version: number, history: PaperVersion[]): WorkingPaper => {
  const { procedureCode, ...rest } = r;
  const targetLabel =
    r.targetKind === "engagement" ? "General" : r.targetKind === "lead_sheet" ? (GROUP_BY_CODE.get(r.target ?? "")?.name ?? r.target ?? "") : `Procedure ${procedureCode ?? ""}`.trim();
  return { ...rest, version, history, targetLabel };
};

/** The rows no other row replaces, for SQL that must show a paper once, at its latest version. The working_papers row must be aliased w. */
export const CURRENT = `not exists (select 1 from working_papers newer where newer.replaces_id = w.id)`;

/**
 * The engagement's working papers, each shown once at its CURRENT version (the row no other row replaces), with its version number and its
 * history: every version, newest first, each of which can still be downloaded by its id.
 */
export async function listWorkingPapers(tx: Tx, engagementId: string): Promise<WorkingPaper[]> {
  const { rows } = await tx.query<Row>(`${SELECT} where w.engagement_id = $1 order by w.uploaded_at, w.file_name`, [engagementId]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const replaced = new Set(rows.map((r) => r.replacesId).filter((x): x is string => !!x));
  return rows
    .filter((r) => !replaced.has(r.id))
    .map((current) => {
      // Walk back along the chain; the first upload is version 1.
      const chain: Row[] = [];
      for (let r: Row | undefined = current; r; r = r.replacesId ? byId.get(r.replacesId) : undefined) chain.push(r);
      const history = chain.map((r, i): PaperVersion => ({ id: r.id, version: chain.length - i, fileName: r.fileName, sizeBytes: r.sizeBytes, uploadedByName: r.uploadedByName, uploadedAt: r.uploadedAt }));
      return label(current, chain.length, history);
    });
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

/** What a working paper is about to become: the rules below have been applied to it. */
export interface CheckedPaper {
  targetKind: TargetKind;
  target: string | null;
  fileName: string;
  description: string | null;
}

/**
 * The rules every working paper meets, whichever way its bytes arrive: an open engagement, an accepted file type, a size within the
 * limit, a real thing for it to support, and (for a procedure) one that has not been reviewed and an audit that is on. Applied when a
 * file is stored through the server AND again when a direct upload is finished, so a lock or a review that happened in between counts.
 */
export async function checkWorkingPaper(
  tx: Tx,
  engagementId: string,
  input: { targetKind: string; target: string | null; fileName: string; sizeBytes: number; description: string },
  limit: { bytes: number; message: string } = { bytes: MAX_FILE_BYTES, message: uploadTooLargeMessage() },
): Promise<CheckedPaper> {
  await requireOpen(tx, engagementId);

  const fileName = cleanFileName(input.fileName);
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  if (!fileName || !ALLOWED_EXTENSIONS.includes(ext)) {
    throw new Error(`That file type is not accepted. Upload one of: ${ALLOWED_EXTENSIONS.join(", ")}.`);
  }
  if (input.sizeBytes === 0) throw new Error("The file is empty.");
  if (input.sizeBytes > limit.bytes) throw new Error(limit.message);
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
  return { targetKind: input.targetKind as TargetKind, target, fileName, description: description || null };
}

/**
 * Record a stored file as a working paper and write the audit-log entry. The one place a working paper row is created: the upload
 * through the server and a finished direct upload both end here, so they cannot drift apart.
 */
export async function registerWorkingPaper(
  tx: Tx,
  s: Session,
  p: { id: string; storageKey: string; engagementId: string; checked: CheckedPaper; sizeBytes: number; sha256: string; replacesId?: string | null },
): Promise<void> {
  let reference: string | null = null;
  let sectionCode: string | null = null;
  let version = 1;
  if (p.replacesId) {
    const old = await currentVersionOf(tx, p.engagementId, p.replacesId, p.sha256);
    if (old.targetKind !== p.checked.targetKind || old.target !== p.checked.target) throw new Error("A new version supports the same thing as the file it replaces.");
    // The reference follows the current file: cleared on the old row first, so the unique rule holds, then set on the new one.
    reference = old.reference;
    sectionCode = old.sectionCode;
    await tx.query("update working_papers set reference = null, section_code = null where id = $1", [p.replacesId]);
    version = old.version + 1;
  }
  await tx.query(
    `insert into working_papers (id, firm_id, engagement_id, target_kind, target, file_name, size_bytes, sha256, storage_key, description, uploaded_by, reference, section_code, replaces_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [p.id, s.firmId, p.engagementId, p.checked.targetKind, p.checked.target, p.checked.fileName, p.sizeBytes, p.sha256, p.storageKey, p.checked.description, s.userId, reference, sectionCode, p.replacesId ?? null],
  );
  if (p.replacesId) {
    await log(tx, s, "upload_version", "working_paper", p.id, {
      engagementId: p.engagementId,
      id: p.id,
      replacesId: p.replacesId,
      version,
      fileName: p.checked.fileName,
      targetKind: p.checked.targetKind,
      target: p.checked.target,
      reference,
    });
  } else {
    await log(tx, s, "upload", "working_paper", p.id, { engagementId: p.engagementId, fileName: p.checked.fileName, targetKind: p.checked.targetKind, target: p.checked.target });
  }
}

/** How many versions a paper has up to and including this row, counted back along the chain of replacements. */
async function versionNumber(tx: Tx, id: string): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    `with recursive c(id, replaces_id) as (
       select id, replaces_id from working_papers where id = $1
       union all select w.id, w.replaces_id from working_papers w join c on w.id = c.replaces_id
     ) select count(*)::int as n from c`,
    [id],
  );
  return rows[0].n;
}

/**
 * The paper a new version would replace, locked, or a refusal: it is on this engagement, it is still the current version (nothing has replaced it
 * since the page was shown), and the new file is not byte-for-byte the current one.
 */
async function currentVersionOf(tx: Tx, engagementId: string, id: string, newSha256: string) {
  const { rows } = await tx.query<{ targetKind: TargetKind; target: string | null; reference: string | null; sectionCode: string | null; sha256: string; description: string | null }>(
    `select target_kind as "targetKind", target, reference, section_code as "sectionCode", sha256, description
     from working_papers where id::text = $1 and engagement_id = $2 for update`,
    [id, engagementId],
  );
  if (rows.length === 0) throw new Error("Working paper not found.");
  const newer = await tx.query("select 1 from working_papers where replaces_id = $1", [id]);
  if (newer.rows.length > 0) throw new Error("A newer version of this file has been uploaded. Reload the page and upload against the latest version.");
  if (rows[0].sha256 === newSha256) throw new Error("This is the same file as the current version.");
  return { ...rows[0], version: await versionNumber(tx, id) };
}

/** What a new version inherits from the paper it replaces. Throws when there is no such paper. Also used when a direct upload begins. */
export async function paperToReplace(tx: Tx, replacesId: string) {
  const { rows } = await tx.query<{ engagementId: string; targetKind: TargetKind; target: string | null; description: string | null; sha256: string }>(
    'select engagement_id as "engagementId", target_kind as "targetKind", target, description, sha256 from working_papers where id::text = $1',
    [replacesId],
  );
  if (rows.length === 0) throw new Error("Working paper not found.");
  return rows[0];
}

/**
 * Store a file as a new version of a current working paper, through the server. It supports the same thing, keeps the description unless a new one is
 * written, and takes over the reference. Whoever may upload today may upload a version; the engagement must be open.
 */
export async function addWorkingPaperVersion(
  tx: Tx,
  s: Session,
  store: FileStore,
  replacesId: string,
  input: { fileName: string; data: Uint8Array; description: string },
): Promise<{ id: string; engagementId: string }> {
  const old = await paperToReplace(tx, replacesId);
  const checked = await checkWorkingPaper(tx, old.engagementId, { targetKind: old.targetKind, target: old.target, fileName: input.fileName, sizeBytes: input.data.byteLength, description: input.description.trim() || old.description || "" });
  const sha256 = createHash("sha256").update(input.data).digest("hex");
  // Refused before anything is stored when it is the same file; the registration checks again inside the transaction that records it.
  if (old.sha256 === sha256) throw new Error("This is the same file as the current version.");
  const id = randomUUID();
  const storageKey = `${s.firmId}/${id}`;
  await store.put(storageKey, input.data);
  try {
    await registerWorkingPaper(tx, s, { id, storageKey, engagementId: old.engagementId, checked, sizeBytes: input.data.byteLength, sha256, replacesId });
  } catch (e) {
    await store.remove(storageKey);
    throw e;
  }
  return { id, engagementId: old.engagementId };
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
  const checked = await checkWorkingPaper(tx, engagementId, { ...input, sizeBytes: input.data.byteLength });

  const id = randomUUID();
  const storageKey = `${s.firmId}/${id}`;
  await store.put(storageKey, input.data);
  try {
    await registerWorkingPaper(tx, s, { id, storageKey, engagementId, checked, sizeBytes: input.data.byteLength, sha256: createHash("sha256").update(input.data).digest("hex") });
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
  const { rows } = await tx.query<{ engagementId: string; uploadedBy: string; storageKey: string; fileName: string; targetKind: TargetKind; target: string | null; replacesId: string | null; reference: string | null; sectionCode: string | null }>(
    `select engagement_id as "engagementId", uploaded_by as "uploadedBy", storage_key as "storageKey", file_name as "fileName", target_kind as "targetKind", target,
            replaces_id as "replacesId", reference, section_code as "sectionCode"
     from working_papers where id::text = $1`,
    [id],
  );
  if (rows.length === 0) throw new Error("Working paper not found.");
  await requireOpen(tx, rows[0].engagementId);
  // An earlier version is part of the history of a newer one: only the current version can be removed, and then the one before it is current again.
  const newer = await tx.query("select 1 from working_papers where replaces_id::text = $1", [id]);
  if (newer.rows.length > 0) throw new Error("An earlier version cannot be removed on its own. Remove the newer version first.");
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
  // The version before it is the current one again, and the reference (and filing) move back to it.
  if (rows[0].replacesId) {
    await tx.query("update working_papers set reference = $2, section_code = $3 where id = $1", [rows[0].replacesId, rows[0].reference, rows[0].sectionCode]);
  }
  await log(tx, s, "remove", "working_paper", id, { engagementId: rows[0].engagementId, fileName: rows[0].fileName, ...(rows[0].replacesId ? { restoredId: rows[0].replacesId, reference: rows[0].reference } : {}) });
  return { engagementId: rows[0].engagementId, storageKey: rows[0].storageKey };
}
