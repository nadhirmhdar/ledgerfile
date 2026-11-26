import { randomUUID } from "node:crypto";
import { withFirm, type Db, type Tx } from "./db";
import { DIRECT_UPLOAD_BYTES, DIRECT_UPLOAD_LABEL, IMPORT_DIRECT_BYTES, IMPORT_DIRECT_LABEL, maxUploadBytes, PENDING_UPLOAD_MINUTES, uploadLimitLabel } from "./config";
import { fileStoreKind, FILE_KEY } from "./file-store";
import type { Session } from "./repo";
import { UPLOAD_CONTENT_TYPE } from "../ui/upload-view";
import { checkWorkingPaper, paperToReplace, registerWorkingPaper, type CheckedPaper } from "./working-papers";

/**
 * Hosted uploads that go straight from the browser to the private Blob store.
 *
 *   begin   The server checks the user, the engagement and the file's declared name and size, chooses the key and records it in
 *           pending_uploads. The row IS the permission to write that one key.
 *   token   The token route (src/app/api/blob-upload) issues a short-lived token only for a key that has an unexpired row of this
 *           user and firm, limited to the declared size, and never for any other key.
 *   finish  The server reads what arrived, compares its size with the declaration, hashes it itself, then creates the working
 *           paper and deletes the row in one transaction. Anything that does not match is deleted and refused.
 *
 * Every database step runs as the signed-in firm (row-level security), so another firm's row is not visible, let alone claimable.
 * Nothing here stores or returns a blob URL or a token: the key is all the browser is given, and the bytes are only ever read back
 * on the server.
 */

/** Whether this deployment sends working papers straight to Blob: the Blob store is chosen and a read-write token is present. */
export function directUploadAvailable(env: Record<string, string | undefined> = process.env): boolean {
  try {
    // handleUpload signs client tokens with the read-write token; the store id with OIDC alone cannot do that, so the form stays at the small limit.
    return fileStoreKind(env) === "vercel-blob" && !!env.BLOB_READ_WRITE_TOKEN?.trim();
  } catch {
    return false;
  }
}

export interface PendingRow {
  key: string;
  firmId: string;
  engagementId: string;
  userId: string;
  targetKind: string;
  target: string | null;
  fileName: string;
  sizeBytes: number;
  description: string | null;
  /** The working paper this upload will be a new version of, when it is one. */
  replacesId: string | null;
  /** What the upload is for: null (or absent) a working paper, otherwise a spreadsheet import. */
  purpose?: string | null;
  expiresAt: Date;
}

export interface TokenOptions {
  maximumSizeInBytes: number;
  addRandomSuffix: false;
  allowOverwrite: false;
  validUntil: number;
  allowedContentTypes: string[];
}

const REFUSED = "This upload is not allowed.";

/**
 * Whether the browser may be given a token for this pathname, and the limits the token carries. Pure. The browser names the pathname;
 * the pending row (looked up by that pathname for this user) is what the server issued. Nothing else passes: not another key, not
 * another user's key, not another firm's, not an expired one.
 */
export function decideToken(input: { pathname: string; session: { userId: string; firmId: string }; row: PendingRow | null; now: Date }): TokenOptions {
  const { pathname, session, row, now } = input;
  if (!FILE_KEY.test(pathname)) throw new Error(REFUSED);
  if (!row) throw new Error(REFUSED);
  if (row.key !== pathname) throw new Error(REFUSED);
  if (row.userId !== session.userId || row.firmId !== session.firmId) throw new Error(REFUSED);
  if (!pathname.startsWith(`${session.firmId}/`)) throw new Error(REFUSED);
  if (row.expiresAt.getTime() <= now.getTime()) throw new Error(REFUSED);
  return {
    // The token cannot write more than was declared (and never more than the hosted maximum).
    maximumSizeInBytes: Math.min(row.sizeBytes, row.purpose ? IMPORT_DIRECT_BYTES : DIRECT_UPLOAD_BYTES),
    addRandomSuffix: false,
    allowOverwrite: false,
    // The token dies with the row, so a late write cannot land after the sweep.
    validUntil: row.expiresAt.getTime(),
    // Stored as plain bytes whatever the name says. The browser asks for exactly this type (see DirectUploadForm).
    allowedContentTypes: [UPLOAD_CONTENT_TYPE],
  };
}

/** What arrived, against what was declared. Null when it matches; otherwise the plain message the user sees. */
export function arrivalProblem(declaredBytes: number, arrived: { size: number } | null): string | null {
  if (!arrived) return "The file did not arrive. Try uploading it again.";
  if (arrived.size > DIRECT_UPLOAD_BYTES) return `The file is larger than ${DIRECT_UPLOAD_LABEL}.`;
  if (arrived.size !== declaredBytes) return "The file that arrived is not the size that was declared, so it was not kept. Try uploading it again.";
  return null;
}

type Row = { key: string; firmId: string; engagementId: string; userId: string; targetKind: string; target: string | null; fileName: string; sizeBytes: number; description: string | null; replacesId: string | null; purpose: string | null; expiresAt: Date | string };
const COLUMNS = `key, firm_id as "firmId", engagement_id as "engagementId", user_id as "userId", target_kind as "targetKind", target, file_name as "fileName",
  size_bytes::float8 as "sizeBytes", description, replaces_id as "replacesId", purpose, expires_at as "expiresAt"`;
const toRow = (r: Row): PendingRow => ({ ...r, expiresAt: new Date(r.expiresAt) });

/** The pending row of this user for this key; null when there is none. Row-level security hides every other firm's rows. */
export async function loadPending(tx: Tx, s: { userId: string }, key: string): Promise<PendingRow | null> {
  const { rows } = await tx.query<Row>(`select ${COLUMNS} from pending_uploads where key = $1 and user_id = $2`, [key, s.userId]);
  return rows[0] ? toRow(rows[0]) : null;
}

/**
 * Take the row: delete it and return it. Finishing and the sweep both take rows this way, so a row is acted on by exactly one of them,
 * and a blob is only ever deleted by the one that holds the row. `now` set means an expired row is not taken (finishing); null takes it
 * whatever its age (discarding a failed upload).
 */
export async function claimPending(tx: Tx, s: { userId: string }, key: string, now: Date | null): Promise<PendingRow | null> {
  const { rows } = await tx.query<Row>(
    `delete from pending_uploads where key = $1 and user_id = $2 and ($3::timestamptz is null or expires_at > $3::timestamptz) returning ${COLUMNS}`,
    [key, s.userId, now ? now.toISOString() : null],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

/** Delete this firm's expired rows and return their keys; the caller removes the blobs after the transaction commits. */
export async function sweepExpired(tx: Tx, now: Date): Promise<string[]> {
  const { rows } = await tx.query<{ key: string }>("delete from pending_uploads where expires_at <= $1::timestamptz returning key", [now.toISOString()]);
  return rows.map((r) => r.key);
}

/** What an import upload also needs: the object's bytes, since it is parsed and then deleted. Reading stops once past the limit. */
export interface ImportBlobOps extends BlobOps {
  read(key: string, maxBytes: number): Promise<Uint8Array | null>;
}

export interface BlobOps {
  /** Read the object on the server: its size and sha256, stopping once it is clearly too large. Null when it is not there. */
  inspect(key: string, maxBytes: number): Promise<{ size: number; sha256: string } | null>;
  remove(key: string): Promise<void>;
}

/** Remove a blob and say nothing if that fails: a stray blob is also found by its expired row, and no message may carry a key or URL. */
async function removeQuietly(ops: BlobOps, keys: string[]) {
  for (const key of keys) {
    try {
      await ops.remove(key);
    } catch {
      console.error("direct upload: a blob could not be removed");
    }
  }
}

const MAX_PENDING_PER_USER = 20;
const tooLarge = { bytes: DIRECT_UPLOAD_BYTES, message: `The file is larger than ${DIRECT_UPLOAD_LABEL}.` };

/**
 * Begin an upload: apply the working paper rules to what the file claims to be, sweep this firm's expired rows, and record the key
 * the browser may write. Returns that key and nothing else.
 */
export async function beginDirectUpload(
  db: Db,
  s: Session,
  ops: BlobOps,
  input: { engagementId: string; targetKind: string; target: string | null; fileName: string; sizeBytes: number; description: string; replacesId?: string | null },
  now: Date = new Date(),
): Promise<{ key: string; fileName: string }> {
  const { key, swept, checked } = await withFirm(db, s.firmId, async (tx) => {
    const swept = await sweepExpired(tx, now);
    // A new version supports what the paper it replaces supports and keeps its description unless a new one is written; the rest of the rules are the same.
    let what = input;
    if (input.replacesId) {
      const old = await paperToReplace(tx, input.replacesId);
      if (old.engagementId !== input.engagementId) throw new Error("Working paper not found.");
      what = { ...input, targetKind: old.targetKind, target: old.target, description: input.description.trim() || old.description || "" };
    }
    const checked: CheckedPaper = await checkWorkingPaper(tx, input.engagementId, what, tooLarge);
    const open = await tx.query<{ n: number }>("select count(*)::int as n from pending_uploads where user_id = $1", [s.userId]);
    if (open.rows[0].n >= MAX_PENDING_PER_USER) throw new Error("Too many uploads are in progress. Wait a few minutes and try again.");
    const key = `${s.firmId}/${randomUUID()}`;
    await tx.query(
      `insert into pending_uploads (key, firm_id, engagement_id, user_id, target_kind, target, file_name, size_bytes, description, replaces_id, created_at, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz, $12::timestamptz)`,
      [key, s.firmId, input.engagementId, s.userId, checked.targetKind, checked.target, checked.fileName, input.sizeBytes, checked.description, input.replacesId ?? null, now.toISOString(), new Date(now.getTime() + PENDING_UPLOAD_MINUTES * 60_000).toISOString()],
    );
    return { key, swept, checked };
  });
  // The rows are gone and committed; now the blobs they named can go too.
  await removeQuietly(ops, swept);
  return { key, fileName: checked.fileName };
}

/** The token route's decision: look the key up as this user (row-level security limits it to their firm) and apply decideToken. */
export async function tokenOptionsFor(db: Db, s: Session, pathname: string, now: Date = new Date()): Promise<TokenOptions> {
  const row = FILE_KEY.test(pathname) ? await withFirm(db, s.firmId, (tx) => loadPending(tx, s, pathname)) : null;
  return decideToken({ pathname, session: s, row, now });
}

class Lost extends Error {}

/** Take the row and delete its blob. Nothing is deleted unless this caller took the row, so a repeated or racing finish cannot remove a file that now belongs to a working paper. */
async function discard(db: Db, s: Session, ops: BlobOps, key: string) {
  const held = await withFirm(db, s.firmId, (tx) => claimPending(tx, s, key, null));
  if (held) await removeQuietly(ops, [key]);
}

/**
 * Finish an upload. Reads the object on the server (size and sha256 are the server's own; nothing the browser sent is trusted),
 * then in one transaction takes the pending row, re-applies the working paper rules (the engagement may have been locked or the
 * procedure reviewed since begin) and creates the working paper through the same registration as an upload through the server.
 * Any failure deletes the blob and the row. Throws an Error whose message is written for the user.
 */
export async function finishDirectUpload(db: Db, s: Session, ops: BlobOps, key: string, now: Date = new Date()): Promise<{ id: string; engagementId: string; fileName: string }> {
  if (!FILE_KEY.test(key)) throw new Error("This upload was not found.");
  const row = await withFirm(db, s.firmId, (tx) => loadPending(tx, s, key));
  // An import upload is never a working paper: it is left exactly as it is, for the import that asked for it.
  if (!row || row.purpose) throw new Error("This upload was not found. It may already have been finished, or it may have expired.");
  if (row.expiresAt.getTime() <= now.getTime()) {
    await discard(db, s, ops, key);
    throw new Error("This upload took too long and has expired. Try uploading the file again.");
  }

  // The bytes are read and hashed outside any transaction: a large file must not hold a connection open.
  let arrived: { size: number; sha256: string } | null;
  try {
    arrived = await ops.inspect(key, DIRECT_UPLOAD_BYTES);
  } catch {
    await discard(db, s, ops, key);
    throw new Error("The uploaded file could not be checked, so it was not kept. Try uploading it again.");
  }
  const problem = arrivalProblem(row.sizeBytes, arrived);
  if (problem || !arrived) {
    await discard(db, s, ops, key);
    throw new Error(problem ?? "The file did not arrive.");
  }

  try {
    return await withFirm(db, s.firmId, async (tx) => {
      // Take the row inside the transaction that creates the paper: if this throws, the delete rolls back with it.
      const claimed = await claimPending(tx, s, key, now);
      if (!claimed) throw new Lost();
      const checked = await checkWorkingPaper(tx, claimed.engagementId, { targetKind: claimed.targetKind, target: claimed.target, fileName: claimed.fileName, sizeBytes: arrived.size, description: claimed.description ?? "" }, tooLarge);
      const id = key.split("/")[1];
      // A new version is re-checked here against the paper as it is now: still current, not the same bytes, same engagement.
      await registerWorkingPaper(tx, s, { id, storageKey: key, engagementId: claimed.engagementId, checked, sizeBytes: arrived.size, sha256: arrived.sha256, replacesId: claimed.replacesId });
      return { id, engagementId: claimed.engagementId, fileName: checked.fileName };
    });
  } catch (e) {
    // Another finish (or the sweep) took the row first: the blob is theirs now, so leave it alone.
    if (e instanceof Lost) throw new Error("This upload was already finished, or it has expired.");
    await discard(db, s, ops, key);
    throw e;
  }
}

/** The largest working paper this deployment takes through the upload form, and its label. The server checks again whichever path is used. */
export function workingPaperLimit(env: Record<string, string | undefined> = process.env): { bytes: number; label: string; direct: boolean } {
  const direct = directUploadAvailable(env);
  const bytes = direct ? DIRECT_UPLOAD_BYTES : maxUploadBytes(env);
  return { bytes, label: direct ? DIRECT_UPLOAD_LABEL : uploadLimitLabel(env), direct };
}

/** What an import form is told: whether a file over the function limit can go straight to the store, and the sizes to show and switch on. */
export function importLimits(env: Record<string, string | undefined> = process.env): { direct: boolean; maxBytes: number; label: string; viaStoreAbove: number } {
  const direct = directUploadAvailable(env);
  return { direct, maxBytes: direct ? IMPORT_DIRECT_BYTES : maxUploadBytes(env), label: direct ? IMPORT_DIRECT_LABEL : uploadLimitLabel(env), viaStoreAbove: maxUploadBytes(env) };
}
