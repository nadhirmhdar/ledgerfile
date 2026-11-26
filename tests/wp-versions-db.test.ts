import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as papers from "../src/server/working-papers";
import { blobOps, type BlobSdk } from "../src/server/blob-file-store";
import { beginDirectUpload, finishDirectUpload } from "../src/server/direct-upload";
import { buildWorkingPaperIndex } from "../src/server/wp-index";
import { exportIndex } from "../src/server/wp-index-export";
import type { FileStore } from "../src/server/file-store";

// Invented firms and people.
const A = "aaaaaaaa-8383-4000-8000-000000000001";
const B = "bbbbbbbb-8383-4000-8000-000000000001";
const user = (firm: string, n: number, role: repo.Session["role"]): repo.Session => ({ firmId: firm, userId: `${firm.slice(0, 8)}-8383-4000-8000-00000000006${n}`, role });
const prep = user(A, 1, "preparer");
const prep2 = user(A, 2, "preparer");
const partner = user(A, 3, "partner");
const outsider = user(B, 1, "partner");
const bytes = (text: string) => new TextEncoder().encode(text);
const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

let db: Db;
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
let n = 0;

/** A file store in memory, and a Blob store behind the SDK-shaped interface: nothing calls the network. */
const files = new Map<string, Uint8Array>();
const store: FileStore = { put: async (k, d) => void files.set(k, d), get: async (k) => files.get(k) ?? null, remove: async (k) => void files.delete(k) };
const sdk: BlobSdk = {
  put: async (pathname, body) => void files.set(pathname, body),
  get: async (pathname) => (files.has(pathname) ? { statusCode: 200, stream: new Response(files.get(pathname) as BodyInit).body } : null),
  del: async (pathname) => void files.delete(pathname),
};
const ops = blobOps({ sdk });

async function engagement(): Promise<string> {
  return as(partner, async (tx) => {
    const client = await repo.createClient(tx, partner, `Version Trading ${++n} LLC`);
    return repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
  });
}
const upload = (who: repo.Session, e: string, name: string, text: string, description = "Invented") =>
  as(who, (tx) => papers.addWorkingPaper(tx, who, store, e, { targetKind: "engagement", target: null, fileName: name, data: bytes(text), description }));
const version = (who: repo.Session, replaces: string, name: string, text: string, description = "") =>
  as(who, (tx) => papers.addWorkingPaperVersion(tx, who, store, replaces, { fileName: name, data: bytes(text), description }));
const file = (who: repo.Session, id: string, reference: string, sectionCode = "C5") => as(who, (tx) => papers.setFileFiling(tx, who, id, { reference, sectionCode }));
const list = (e: string, who: repo.Session = prep) => as(who, (tx) => papers.listWorkingPapers(tx, e));
const row = async (id: string) => (await db.query<{ reference: string | null; section_code: string | null; replaces_id: string | null; description: string | null }>("select reference, section_code, replaces_id, description from working_papers where id = $1", [id])).rows[0];
const read = (who: repo.Session, e: string, id: string) => as(who, (tx) => papers.readWorkingPaper(tx, store, e, id));

beforeAll(async () => {
  db = await openDatabase();
  for (const f of [A, B]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [f]);
  for (const u of [prep, prep2, partner, outsider]) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-1)}`, u.role]);
});
afterAll(async () => {
  await db.close();
});

describe("the migration", () => {
  it("is 0037, and an existing paper is version 1 with no change", async () => {
    expect((await db.query("select 1 from schema_migrations where name = $1", ["0037_working_paper_versions.sql"])).rows).toHaveLength(1);
    const e = await engagement();
    const id = await upload(prep, e, "plain.txt", "Plain file.");
    expect((await row(id)).replaces_id).toBeNull();
    const [p] = await list(e);
    expect(p).toMatchObject({ id, version: 1, replacesId: null });
    expect(p.history).toHaveLength(1);
  });

  it("allows one replacement per paper, never itself, and only within the engagement", async () => {
    const e = await engagement();
    const id = await upload(prep, e, "a.txt", "A.");
    await version(prep, id, "a2.txt", "A two.");
    // A second row replacing the same paper breaks the one-replacement rule.
    await expect(
      db.query("insert into working_papers (firm_id, engagement_id, target_kind, file_name, size_bytes, sha256, storage_key, uploaded_by, replaces_id) values ($1, $2, 'engagement', 'x.txt', 1, 'x', $3, $4, $5)", [A, e, `${A}/dup-1`, prep.userId, id]),
    ).rejects.toThrow();
    await expect(db.query("update working_papers set replaces_id = id where id = $1", [id])).rejects.toThrow();
    const other = await engagement();
    await expect(
      db.query("insert into working_papers (firm_id, engagement_id, target_kind, file_name, size_bytes, sha256, storage_key, uploaded_by, replaces_id) values ($1, $2, 'engagement', 'x.txt', 1, 'x', $3, $4, $5)", [A, other, `${A}/dup-2`, prep.userId, id]),
    ).rejects.toThrow();
  });
});

describe("a new version through the server upload", () => {
  it("moves the reference, keeps the filing and description, and the list shows only Version 2 with both in its history", async () => {
    const e = await engagement();
    const v1 = await upload(prep, e, "bank-confirmation.txt", "Confirmation, first.", "Bank confirmation");
    await file(prep, v1, "C5-F1");
    const v2 = (await version(prep2, v1, "bank-confirmation-final.txt", "Confirmation, final.")).id;
    expect(await row(v1)).toMatchObject({ reference: null, section_code: null });
    expect(await row(v2)).toMatchObject({ reference: "C5-F1", section_code: "C5", replaces_id: v1, description: "Bank confirmation" });
    const shown = await list(e);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ id: v2, version: 2, reference: "C5-F1", fileName: "bank-confirmation-final.txt" });
    expect(shown[0].history.map((h) => [h.version, h.id])).toEqual([[2, v2], [1, v1]]);
    // Both versions download, with the same rules as any file.
    expect(new TextDecoder().decode((await read(prep, e, v1))!.data)).toBe("Confirmation, first.");
    expect(new TextDecoder().decode((await read(prep, e, v2))!.data)).toBe("Confirmation, final.");
    // A new description replaces the kept one.
    const v3 = (await version(prep, v2, "bank-confirmation-v3.txt", "Confirmation, third.", "Final signed copy")).id;
    expect(await row(v3)).toMatchObject({ reference: "C5-F1", description: "Final signed copy" });
    expect((await list(e))[0]).toMatchObject({ id: v3, version: 3 });
  });

  it("refuses the same content, a locked engagement, another firm, and an older version", async () => {
    const e = await engagement();
    const v1 = await upload(prep, e, "a.txt", "Same bytes.");
    await expect(version(prep, v1, "a-copy.txt", "Same bytes.")).rejects.toThrow("This is the same file as the current version.");
    expect(await list(e)).toHaveLength(1);
    await expect(version(outsider, v1, "b.txt", "Another firm.")).rejects.toThrow(/not found/i);
    const v2 = (await version(prep, v1, "a2.txt", "Different bytes.")).id;
    // Uploading against the version that was replaced is refused, and so is repeating the current content.
    await expect(version(prep, v1, "a3.txt", "A third.")).rejects.toThrow(/newer version/);
    await expect(version(prep, v2, "a2-again.txt", "Different bytes.")).rejects.toThrow("This is the same file as the current version.");
    await db.query("update engagements set status = 'locked', locked_by = $2, locked_at = now() where id = $1", [e, partner.userId]);
    await expect(version(prep, v2, "late.txt", "Too late.")).rejects.toThrow(/locked/);
  });

  it("does not leave a stored file behind when it is refused", async () => {
    const e = await engagement();
    const v1 = await upload(prep, e, "a.txt", "Original.");
    const before = files.size;
    await expect(version(prep, v1, "a-copy.txt", "Original.")).rejects.toThrow(/same file/);
    expect(files.size).toBe(before);
  });
});

describe("a new version through the direct (hosted) upload", () => {
  async function direct(who: repo.Session, e: string, replacesId: string, name: string, text: string) {
    const data = bytes(text);
    const { key } = await beginDirectUpload(db, who, ops, { engagementId: e, targetKind: "engagement", target: null, fileName: name, sizeBytes: data.byteLength, description: "", replacesId });
    files.set(key, data);
    return finishDirectUpload(db, who, ops, key);
  }

  it("moves the reference the same way, and the list shows Version 2", async () => {
    const e = await engagement();
    const v1 = await upload(prep, e, "big.pdf", "Large file, first.");
    await file(prep, v1, "C5-F2");
    const done = await direct(prep, e, v1, "big-v2.pdf", "Large file, second.");
    expect(await row(v1)).toMatchObject({ reference: null });
    expect(await row(done.id)).toMatchObject({ reference: "C5-F2", replaces_id: v1, description: "Invented" });
    const shown = await list(e);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ id: done.id, version: 2 });
    expect(shown[0].history.map((h) => h.version)).toEqual([2, 1]);
    expect(new TextDecoder().decode((await read(prep, e, v1))!.data)).toBe("Large file, first.");
    // The audit entry names the version and both ids.
    const log = await db.query<{ detail: { version: number; replacesId: string; id: string } }>("select detail from audit_log where action = 'upload_version' and entity_id = $1", [done.id]);
    expect(log.rows[0].detail).toMatchObject({ version: 2, replacesId: v1, id: done.id });
  });

  it("refuses the same content and discards the blob and the pending row", async () => {
    const e = await engagement();
    const v1 = await upload(prep, e, "big.pdf", "Identical content.");
    const data = bytes("Identical content.");
    const { key } = await beginDirectUpload(db, prep, ops, { engagementId: e, targetKind: "engagement", target: null, fileName: "same.pdf", sizeBytes: data.byteLength, description: "", replacesId: v1 });
    files.set(key, data);
    await expect(finishDirectUpload(db, prep, ops, key)).rejects.toThrow("This is the same file as the current version.");
    expect(files.has(key)).toBe(false);
    expect((await db.query("select 1 from pending_uploads where key = $1", [key])).rows).toHaveLength(0);
    expect(await list(e)).toHaveLength(1);
  });

  it("will not begin for another firm's paper or on a locked engagement", async () => {
    const e = await engagement();
    const v1 = await upload(prep, e, "a.pdf", "Original.");
    const begin = (who: repo.Session, eng: string) => beginDirectUpload(db, who, ops, { engagementId: eng, targetKind: "engagement", target: null, fileName: "n.pdf", sizeBytes: 5, description: "", replacesId: v1 });
    await expect(begin(outsider, e)).rejects.toThrow(/not found/i);
    await db.query("update engagements set status = 'locked', locked_by = $2, locked_at = now() where id = $1", [e, partner.userId]);
    await expect(begin(prep, e)).rejects.toThrow(/locked/);
  });
});

describe("removing a version", () => {
  it("removing the current version makes the previous one current again, with the reference back", async () => {
    const e = await engagement();
    const v1 = await upload(prep, e, "a.txt", "One.");
    await file(prep, v1, "C5-F3");
    const v2 = (await version(prep, v1, "a2.txt", "Two.")).id;
    const gone = await as(prep, (tx) => papers.removeWorkingPaper(tx, prep, v2));
    expect(gone.storageKey).toBe((await db.query<{ k: string }>("select storage_key as k from working_papers where id = $1", [v2])).rows.length === 0 ? gone.storageKey : "");
    expect(await row(v1)).toMatchObject({ reference: "C5-F3", section_code: "C5" });
    const shown = await list(e);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ id: v1, version: 1, reference: "C5-F3" });
    const log = await db.query<{ detail: { restoredId: string; reference: string } }>("select detail from audit_log where action = 'remove' and entity_id = $1", [v2]);
    expect(log.rows[0].detail).toMatchObject({ restoredId: v1, reference: "C5-F3" });
  });

  it("refuses to remove an earlier version while a newer one exists, and removes version 1 on its own as today", async () => {
    const e = await engagement();
    const v1 = await upload(prep, e, "a.txt", "One.");
    const v2 = (await version(prep, v1, "a2.txt", "Two.")).id;
    await expect(as(prep, (tx) => papers.removeWorkingPaper(tx, prep, v1))).rejects.toThrow(/earlier version cannot be removed/);
    expect(await list(e)).toHaveLength(1);
    // Newest first: v2 goes, then v1 is the only one and goes as an ordinary file.
    await as(prep, (tx) => papers.removeWorkingPaper(tx, prep, v2));
    await as(prep, (tx) => papers.removeWorkingPaper(tx, prep, v1));
    expect(await list(e)).toHaveLength(0);
    // And a plain file with no versions is removed as before.
    const solo = await upload(prep, e, "solo.txt", "Solo.");
    await as(prep, (tx) => papers.removeWorkingPaper(tx, prep, solo));
    expect(await list(e)).toHaveLength(0);
  });

  it("keeps the rule about who may remove: the uploader of that version, or a reviewer or partner", async () => {
    const e = await engagement();
    const v1 = await upload(prep, e, "a.txt", "One.");
    const v2 = (await version(prep2, v1, "a2.txt", "Two.")).id;
    await expect(as(prep, (tx) => papers.removeWorkingPaper(tx, prep, v2))).rejects.toThrow(/Only the person who uploaded/);
    await as(partner, (tx) => papers.removeWorkingPaper(tx, partner, v2));
    expect((await list(e))[0].id).toBe(v1);
  });
});

describe("the index and its export", () => {
  it("list current versions only, with Version N, and the earlier version is not indexed", async () => {
    const e = await engagement();
    const v1 = await upload(prep, e, "old-name.txt", "Old.");
    await file(prep, v1, "C5-F4");
    await version(prep, v1, "new-name.txt", "New.");
    const index = (await as(prep, (tx) => buildWorkingPaperIndex(tx, e)))!;
    const entries = index.sections.flatMap((s) => s.entries).filter((x) => x.kind === "file");
    expect(entries.map((x) => x.title)).toEqual(["new-name.txt"]);
    expect(entries[0].reference).toBe("C5-F4");
    expect(entries[0].note).toContain("Version 2.");
    const out = (await as(prep, (tx) => exportIndex(tx, prep, e)))!;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out.buffer as unknown as ArrayBuffer);
    const text: string[] = [];
    wb.getWorksheet("Index")!.eachRow((r) => r.eachCell((c) => text.push(String(c.value ?? ""))));
    expect(text.some((t) => t.includes("new-name.txt"))).toBe(true);
    expect(text.some((t) => t.includes("old-name.txt"))).toBe(false);
  });
});

describe("audit", () => {
  it("logs a new version with its number and both ids", async () => {
    const e = await engagement();
    const v1 = await upload(prep, e, "a.txt", "One.");
    const v2 = (await version(prep, v1, "a2.txt", "Two.")).id;
    const v3 = (await version(prep, v2, "a3.txt", "Three.")).id;
    const log = await db.query<{ detail: { version: number; replacesId: string; id: string } }>("select detail from audit_log where action = 'upload_version' and entity_id in ($1, $2) order by id", [v2, v3]);
    expect(log.rows.map((r) => r.detail)).toMatchObject([
      { version: 2, replacesId: v1, id: v2 },
      { version: 3, replacesId: v2, id: v3 },
    ]);
    expect(sha(bytes("One."))).not.toBe(sha(bytes("Two.")));
  });
});
