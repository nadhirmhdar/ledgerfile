import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import * as papers from "../src/server/working-papers";
import { blobOps, type BlobSdk } from "../src/server/blob-file-store";
import { beginDirectUpload, claimPending, finishDirectUpload, loadPending, sweepExpired, tokenOptionsFor, type BlobOps } from "../src/server/direct-upload";
import { DIRECT_UPLOAD_BYTES } from "../src/server/config";
import type { FileStore } from "../src/server/file-store";

const FIRM = "aaaaaaaa-5555-4000-8000-000000000001";
const OTHER = "bbbbbbbb-5555-4000-8000-000000000001";
const user = (n: number, role: repo.Session["role"], firmId = FIRM): repo.Session => ({ firmId, userId: `${firmId.slice(0, 8)}-5555-4000-8000-00000000001${n}`, role });
const prep = user(1, "preparer");
const prep2 = user(2, "preparer");
const partner = user(4, "partner");
const outsider = user(5, "partner", OTHER);
const bytes = (text: string) => new TextEncoder().encode(text);
const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const MIN = 60_000;

let db: Db;
let engagement: string;
let otherEngagement: string;
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);

/** A Blob store in memory behind the real SDK-shaped interface: nothing calls Vercel. */
const blobs = new Map<string, Uint8Array>();
const removed: string[] = [];
const sdk: BlobSdk = {
  put: async (pathname, body) => void blobs.set(pathname, body),
  get: async (pathname) => (blobs.has(pathname) ? { statusCode: 200, stream: new Response(blobs.get(pathname) as BodyInit).body } : null),
  del: async (pathname) => {
    removed.push(pathname);
    blobs.delete(pathname);
  },
};
const ops: BlobOps = blobOps({ sdk });
const asStore: FileStore = { put: async (k, d) => void blobs.set(k, d), get: async (k) => blobs.get(k) ?? null, remove: async (k) => void blobs.delete(k) };

const begin = (s: repo.Session, over: Partial<Parameters<typeof beginDirectUpload>[3]> = {}, now = new Date()) =>
  beginDirectUpload(db, s, ops, { engagementId: engagement, targetKind: "engagement", target: null, fileName: "statement.pdf", sizeBytes: 12, description: "", ...over }, now);
const pendingCount = async () => Number((await db.query<{ n: string }>("select count(*) as n from pending_uploads")).rows[0].n);
const paperCount = async () => Number((await db.query<{ n: string }>("select count(*) as n from working_papers")).rows[0].n);

beforeAll(async () => {
  db = await openDatabase();
  for (const firm of [FIRM, OTHER]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [firm]);
  for (const u of [prep, prep2, partner, outsider]) {
    await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-1)}`, u.role]);
  }
  await as(partner, async (tx) => {
    const client = await repo.createClient(tx, partner, "Uploads Co");
    engagement = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
    await audit.setAuditEnabled(tx, partner, engagement, true);
  });
  await as(outsider, async (tx) => {
    const client = await repo.createClient(tx, outsider, "Elsewhere Ltd");
    otherEngagement = await repo.createEngagement(tx, outsider, client, "2025-01-01", "2025-12-31");
  });
});

afterAll(async () => {
  await db.close();
});

describe("beginning an upload", () => {
  it("records the key the browser may write, for the signed-in user, and nothing else about where it goes", async () => {
    const { key, fileName } = await begin(prep, { fileName: "Bank  statement.PDF", sizeBytes: 30 * 1024 * 1024, description: " Q4 " });
    expect(key).toMatch(new RegExp(`^${FIRM}/[0-9a-f-]{36}$`));
    expect(fileName).toBe("Bank statement.PDF");
    const row = await as(prep, (tx) => loadPending(tx, prep, key));
    expect(row).toMatchObject({ key, firmId: FIRM, engagementId: engagement, userId: prep.userId, targetKind: "engagement", fileName: "Bank statement.PDF", sizeBytes: 30 * 1024 * 1024, description: "Q4" });
    // The row expires about 15 minutes ahead.
    const ahead = row!.expiresAt.getTime() - Date.now();
    expect(ahead).toBeGreaterThan(14 * MIN);
    expect(ahead).toBeLessThanOrEqual(15 * MIN + 1000);
    await as(prep, (tx) => claimPending(tx, prep, key, null));
  });

  it("stores no blob URL, token or hash: only the key, who, what for and how big", async () => {
    const { rows } = await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'pending_uploads' and table_schema = current_schema() order by column_name");
    expect(rows.map((r) => r.column_name)).toEqual(["created_at", "description", "engagement_id", "expires_at", "file_name", "firm_id", "key", "size_bytes", "target", "target_kind", "user_id"]);
  });

  it("applies the working paper rules and leaves no row when refused", async () => {
    const before = await pendingCount();
    await expect(begin(prep, { fileName: "program.exe" })).rejects.toThrow(/file type is not accepted/);
    await expect(begin(prep, { sizeBytes: 0 })).rejects.toThrow(/empty/);
    await expect(begin(prep, { sizeBytes: DIRECT_UPLOAD_BYTES + 1 })).rejects.toThrow(/larger than 50 MB/);
    await expect(begin(prep, { targetKind: "lead_sheet", target: "NOPE" })).rejects.toThrow(/Choose the lead sheet/);
    await expect(begin(prep, { targetKind: "procedure", target: "dddddddd-5555-4000-8000-000000000001" })).rejects.toThrow(/not on this engagement/);
    await expect(begin(prep, { targetKind: "other" })).rejects.toThrow(/Choose what the file supports/);
    await expect(begin(prep, { description: "x".repeat(501) })).rejects.toThrow(/too long/);
    expect(await pendingCount()).toBe(before);
  });

  it("does not let a user begin an upload to another firm's engagement", async () => {
    await expect(begin(prep, { engagementId: otherEngagement })).rejects.toThrow(/Engagement not found/);
    await expect(begin(outsider, { engagementId: engagement })).rejects.toThrow(/Engagement not found/);
  });

  it("limits how many uploads one user can have waiting", async () => {
    const keys: string[] = [];
    for (let i = 0; i < 20; i++) keys.push((await begin(prep2)).key);
    await expect(begin(prep2)).rejects.toThrow(/Too many uploads/);
    for (const k of keys) await as(prep2, (tx) => claimPending(tx, prep2, k, null));
  });
});

describe("row-level security", () => {
  it("another firm cannot see, load, claim or sweep a row", async () => {
    const { key } = await begin(prep, {}, new Date(Date.now() - 60 * MIN));
    expect((await db.query("select 1 from pending_uploads where key = $1", [key])).rows).toHaveLength(1);
    expect(await as(outsider, async (tx) => (await tx.query("select 1 from pending_uploads where key = $1", [key])).rows)).toHaveLength(0);
    expect(await as(outsider, (tx) => loadPending(tx, prep, key))).toBeNull();
    expect(await as(outsider, (tx) => claimPending(tx, prep, key, null))).toBeNull();
    expect(await as(outsider, (tx) => sweepExpired(tx, new Date()))).toEqual([]);
    expect((await db.query("select 1 from pending_uploads where key = $1", [key])).rows).toHaveLength(1);
    await as(prep, (tx) => claimPending(tx, prep, key, null));
  });

  it("a row cannot be written for another firm", async () => {
    const key = `${OTHER}/aaaaaaaa-0000-4000-8000-000000000009`;
    await expect(
      as(prep, (tx) =>
        tx.query("insert into pending_uploads (key, firm_id, engagement_id, user_id, target_kind, file_name, size_bytes, expires_at) values ($1, $2, $3, $4, 'engagement', 'x.pdf', 5, now() + interval '5 minutes')", [key, OTHER, otherEngagement, outsider.userId]),
      ),
    ).rejects.toThrow();
    // And the key must carry the firm's own id.
    await expect(
      as(prep, (tx) =>
        tx.query("insert into pending_uploads (key, firm_id, engagement_id, user_id, target_kind, file_name, size_bytes, expires_at) values ($1, $2, $3, $4, 'engagement', 'x.pdf', 5, now() + interval '5 minutes')", [key, FIRM, engagement, prep.userId]),
      ),
    ).rejects.toThrow();
  });

  it("the token check refuses another firm's key and another user's key, and the key of a finished upload", async () => {
    const { key } = await begin(prep, { sizeBytes: 5 * 1024 * 1024 });
    const options = await tokenOptionsFor(db, prep, key);
    expect(options).toMatchObject({ maximumSizeInBytes: 5 * 1024 * 1024, addRandomSuffix: false, allowOverwrite: false });
    await expect(tokenOptionsFor(db, outsider, key)).rejects.toThrow(/not allowed/);
    await expect(tokenOptionsFor(db, prep2, key)).rejects.toThrow(/not allowed/);
    await expect(tokenOptionsFor(db, prep, `${FIRM}/eeeeeeee-0000-4000-8000-000000000001`)).rejects.toThrow(/not allowed/);
    await expect(tokenOptionsFor(db, prep, "statement.pdf")).rejects.toThrow(/not allowed/);
    // After the row is gone the key is dead.
    await as(prep, (tx) => claimPending(tx, prep, key, null));
    await expect(tokenOptionsFor(db, prep, key)).rejects.toThrow(/not allowed/);
  });

  it("the token check refuses an expired key", async () => {
    const { key } = await begin(prep, {}, new Date(Date.now() - 20 * MIN));
    await expect(tokenOptionsFor(db, prep, key)).rejects.toThrow(/not allowed/);
    await as(prep, (tx) => claimPending(tx, prep, key, null));
  });
});

describe("finishing an upload", () => {
  it("creates the working paper through the usual registration and removes the pending row", async () => {
    const data = bytes("%PDF-1.7 scanned statement");
    const { key } = await begin(prep, { sizeBytes: data.byteLength, description: "March" });
    blobs.set(key, data);
    const done = await finishDirectUpload(db, prep, ops, key);
    expect(done).toEqual({ id: key.split("/")[1], engagementId: engagement, fileName: "statement.pdf" });

    const paper = (await db.query<Record<string, unknown>>("select id, firm_id, engagement_id, target_kind, file_name, size_bytes::float8 as size, sha256, storage_key, description, uploaded_by from working_papers where id = $1", [done.id])).rows[0];
    expect(paper).toMatchObject({ firm_id: FIRM, engagement_id: engagement, target_kind: "engagement", file_name: "statement.pdf", size: data.byteLength, sha256: sha(data), storage_key: key, description: "March", uploaded_by: prep.userId });
    expect(await as(prep, (tx) => loadPending(tx, prep, key))).toBeNull();
    // The file is kept, and it reads back through the same integrity check as any other working paper.
    expect(blobs.has(key)).toBe(true);
    const read = await as(prep, (tx) => papers.readWorkingPaper(tx, asStore, engagement, done.id));
    expect(read?.fileName).toBe("statement.pdf");
    // The same audit-log entry as an upload through the server.
    const log = (await db.query<{ action: string; entity: string; detail: { fileName: string; targetKind: string } }>("select action, entity, detail from audit_log where entity_id = $1", [done.id])).rows;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: "upload", entity: "working_paper", detail: { engagementId: engagement, fileName: "statement.pdf", targetKind: "engagement" } });
    // No URL or token is in the row.
    expect(JSON.stringify(paper)).not.toMatch(/https?:|token/i);
  });

  it("a blob that is not the size declared never becomes a working paper, and is deleted", async () => {
    const { key } = await begin(prep, { sizeBytes: 100 });
    blobs.set(key, bytes("only a few bytes"));
    const papersBefore = await paperCount();
    await expect(finishDirectUpload(db, prep, ops, key)).rejects.toThrow(/not the size that was declared/);
    expect(await paperCount()).toBe(papersBefore);
    expect(blobs.has(key)).toBe(false);
    expect(removed).toContain(key);
    expect(await as(prep, (tx) => loadPending(tx, prep, key))).toBeNull();
  });

  it("a blob that never arrived is refused and its row removed", async () => {
    const { key } = await begin(prep);
    await expect(finishDirectUpload(db, prep, ops, key)).rejects.toThrow(/did not arrive/);
    expect(await as(prep, (tx) => loadPending(tx, prep, key))).toBeNull();
  });

  it("a blob over the hosted maximum is refused whatever was declared", async () => {
    const { key } = await begin(prep, { sizeBytes: 50 });
    blobs.set(key, bytes("x".repeat(50)));
    const huge: BlobOps = { inspect: async () => ({ size: DIRECT_UPLOAD_BYTES + 1, sha256: "" }), remove: ops.remove };
    await expect(finishDirectUpload(db, prep, huge, key)).rejects.toThrow(/larger than 50 MB/);
    expect(blobs.has(key)).toBe(false);
  });

  it("an error while reading the blob deletes it and says nothing about the key", async () => {
    const { key } = await begin(prep);
    blobs.set(key, bytes("x".repeat(12)));
    const broken: BlobOps = { inspect: async () => Promise.reject(new Error(`boom ${key}`)), remove: ops.remove };
    await expect(finishDirectUpload(db, prep, broken, key)).rejects.toThrow(/^The uploaded file could not be checked, so it was not kept\. Try uploading it again\.$/);
    expect(blobs.has(key)).toBe(false);
  });

  it("an expired upload is refused, its row removed and its blob deleted", async () => {
    const { key } = await begin(prep, {}, new Date(Date.now() - 20 * MIN));
    blobs.set(key, bytes("x".repeat(12)));
    await expect(finishDirectUpload(db, prep, ops, key)).rejects.toThrow(/expired/);
    expect(blobs.has(key)).toBe(false);
    expect(await as(prep, (tx) => loadPending(tx, prep, key))).toBeNull();
  });

  it("another user, or another firm, cannot finish a key and cannot delete its blob", async () => {
    const { key } = await begin(prep);
    blobs.set(key, bytes("x".repeat(12)));
    await expect(finishDirectUpload(db, prep2, ops, key)).rejects.toThrow(/not found/);
    await expect(finishDirectUpload(db, outsider, ops, key)).rejects.toThrow(/not found/);
    expect(blobs.has(key)).toBe(true);
    expect(await as(prep, (tx) => loadPending(tx, prep, key))).not.toBeNull();
    await finishDirectUpload(db, prep, ops, key);
  });

  it("finishing twice does not delete a file that is now a working paper", async () => {
    const data = bytes("twice");
    const { key } = await begin(prep, { sizeBytes: data.byteLength });
    blobs.set(key, data);
    await finishDirectUpload(db, prep, ops, key);
    const removedBefore = removed.length;
    await expect(finishDirectUpload(db, prep, ops, key)).rejects.toThrow(/not found/);
    expect(blobs.has(key)).toBe(true);
    expect(removed.length).toBe(removedBefore);
    expect((await db.query("select 1 from working_papers where storage_key = $1", [key])).rows).toHaveLength(1);
  });

  it("two finishes racing make one working paper and keep the blob", async () => {
    const data = bytes("racing");
    const { key } = await begin(prep, { sizeBytes: data.byteLength });
    blobs.set(key, data);
    const results = await Promise.allSettled([finishDirectUpload(db, prep, ops, key), finishDirectUpload(db, prep, ops, key)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(blobs.has(key)).toBe(true);
    expect((await db.query("select 1 from working_papers where storage_key = $1", [key])).rows).toHaveLength(1);
  });

  it("re-applies the rules at finish: an engagement locked since begin refuses the file and deletes it", async () => {
    const data = bytes("late");
    const { key } = await begin(prep, { sizeBytes: data.byteLength });
    blobs.set(key, data);
    await db.query("update engagements set status = 'locked' where id = $1", [engagement]);
    try {
      await expect(finishDirectUpload(db, prep, ops, key)).rejects.toThrow(/locked/);
    } finally {
      await db.query("update engagements set status = 'open' where id = $1", [engagement]);
    }
    expect(blobs.has(key)).toBe(false);
    expect(await as(prep, (tx) => loadPending(tx, prep, key))).toBeNull();
    expect((await db.query("select 1 from working_papers where storage_key = $1", [key])).rows).toHaveLength(0);
  });
});

describe("clearing out expired uploads", () => {
  it("a new upload sweeps this firm's expired rows and removes their blobs, and only this firm's", async () => {
    const old = await begin(prep, {}, new Date(Date.now() - 40 * MIN));
    const old2 = await begin(prep2, {}, new Date(Date.now() - 30 * MIN));
    blobs.set(old.key, bytes("x"));
    blobs.set(old2.key, bytes("y"));
    const fresh = await begin(prep2);
    // Another firm's expired row, written as the owner (a sweep for FIRM must not touch it).
    const foreign = `${OTHER}/aaaaaaaa-0000-4000-8000-000000000042`;
    await db.query("insert into pending_uploads (key, firm_id, engagement_id, user_id, target_kind, file_name, size_bytes, created_at, expires_at) values ($1, $2, $3, $4, 'engagement', 'x.pdf', 5, now() - interval '2 hours', now() - interval '1 hour')", [foreign, OTHER, otherEngagement, outsider.userId]);
    blobs.set(foreign, bytes("z"));

    await begin(prep); // sweeps FIRM
    expect(await as(prep, (tx) => loadPending(tx, prep, old.key))).toBeNull();
    expect(await as(prep2, (tx) => loadPending(tx, prep2, old2.key))).toBeNull();
    expect(blobs.has(old.key)).toBe(false);
    expect(blobs.has(old2.key)).toBe(false);
    // A live row survives, and so does the other firm's.
    expect(await as(prep2, (tx) => loadPending(tx, prep2, fresh.key))).not.toBeNull();
    expect((await db.query("select 1 from pending_uploads where key = $1", [foreign])).rows).toHaveLength(1);
    expect(blobs.has(foreign)).toBe(true);
    await db.query("delete from pending_uploads where key = $1", [foreign]);
  });

  it("a failed blob removal does not fail the new upload", async () => {
    await begin(prep, {}, new Date(Date.now() - 40 * MIN));
    const failing: BlobOps = { inspect: ops.inspect, remove: async () => Promise.reject(new Error("store is down")) };
    await expect(beginDirectUpload(db, prep, failing, { engagementId: engagement, targetKind: "engagement", target: null, fileName: "a.pdf", sizeBytes: 5, description: "" })).resolves.toMatchObject({ key: expect.any(String) });
  });
});
