import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import * as schedules from "../src/server/test-schedules";
import { blobOps, type BlobSdk } from "../src/server/blob-file-store";
import { beginDirectUpload, finishDirectUpload, sweepExpired, tokenOptionsFor, importLimits, workingPaperLimit } from "../src/server/direct-upload";
import { beginImportUpload, IMPORT_NOT_FOUND, takeImportFile, tooManyRows, type ImportTarget } from "../src/server/direct-import";
import { countRows } from "../src/server/row-count";
import { HOSTED_UPLOAD_BYTES, IMPORT_DIRECT_BYTES, IMPORT_DIRECT_ROWS } from "../src/server/config";

// Invented firms, people and data. The Blob store is a double in memory behind the SDK-shaped interface: nothing calls Vercel.
const A = "aaaaaaaa-9494-4000-8000-000000000001";
const B = "bbbbbbbb-9494-4000-8000-000000000001";
const user = (firm: string, n: number, role: repo.Session["role"]): repo.Session => ({ firmId: firm, userId: `${firm.slice(0, 8)}-9494-4000-8000-00000000009${n}`, role });
const partner = user(A, 1, "partner");
const prep = user(A, 2, "preparer");
const outsider = user(B, 1, "partner");

const blobs = new Map<string, Uint8Array>();
const removed: string[] = [];
const sdk: BlobSdk = {
  put: async (p, body) => void blobs.set(p, body),
  get: async (p) => (blobs.has(p) ? { statusCode: 200, stream: new Response(blobs.get(p) as BodyInit).body } : null),
  del: async (p) => {
    removed.push(p);
    blobs.delete(p);
  },
};
const ops = blobOps({ sdk });

let db: Db;
let session: repo.Session;
vi.mock("../src/server/session", () => ({ getSession: async () => session, getOptionalSession: async () => session }));
vi.mock("../src/server/db", async (original) => {
  const real = await original<typeof import("../src/server/db")>();
  return { ...real, getDb: async () => db };
});
vi.mock("../src/server/blob-file-store", async (original) => {
  const real = await original<typeof import("../src/server/blob-file-store")>();
  return { ...real, blobOps: () => real.blobOps({ sdk }) };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
const pending = async () => Number((await db.query<{ n: string }>("select count(*) as n from pending_uploads")).rows[0].n);
const papers = async () => Number((await db.query<{ n: string }>("select count(*) as n from working_papers")).rows[0].n);

let engagement: string;
let other: string;
let schedule: string;

/** A balanced invented journal listing of at least `bytes` bytes: a long description pads each line, so few entries make a large file. */
function journalCsv(bytes: number, padding = 400): Uint8Array {
  const lines = ["Date,Journal number,Account code,Account name,Description,Posted by,Debit,Credit"];
  let size = lines[0].length;
  for (let i = 0; size < bytes; i++) {
    const text = `Invented sale ${i} ${"x".repeat(padding)}`;
    const a = `31/12/2025,J${i},1000,Bank,${text},Pia,100.00,`;
    const b = `31/12/2025,J${i},4000,Sales,${text},Pia,,100.00`;
    lines.push(a, b);
    size += a.length + b.length + 2;
  }
  return new TextEncoder().encode(lines.join("\n"));
}

/** Begin, then "upload" the bytes to the double, as the browser would. */
async function upload(s: repo.Session, t: ImportTarget, fileName: string, data: Uint8Array, declared = data.length): Promise<string> {
  const { key } = await beginImportUpload(db, s, ops, { ...t, fileName, sizeBytes: declared });
  blobs.set(key, data);
  return key;
}
const journal = (engagementId: string): ImportTarget => ({ engagementId, purpose: "journal_listing", target: null });
const take = (s: repo.Session, key: string, t: ImportTarget) => takeImportFile(db, s, ops, key, t);

beforeAll(async () => {
  db = await openDatabase();
  for (const f of [A, B]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [f]);
  for (const u of [partner, prep, outsider]) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-1)}`, u.role]);
  session = partner;
  await as(partner, async (tx) => {
    const client = await repo.createClient(tx, partner, "Large Imports Trading");
    engagement = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
    other = await repo.createEngagement(tx, partner, await repo.createClient(tx, partner, "Another Client"), "2025-01-01", "2025-12-31");
    for (const e of [engagement, other]) {
      await repo.importTrialBalance(tx, partner, e, "tb.xlsx", [
        { code: "1000", name: "Bank - current account", closingMinor: 500000, priorMinor: 0 },
        { code: "4000", name: "Sales", closingMinor: -500000, priorMinor: 0 },
      ]);
      await audit.setAuditEnabled(tx, partner, e, true);
    }
    schedule = await schedules.createSchedule(tx, partner, engagement, { areaCode: "C5", groupCode: null, title: "Invented listing" });
  });
});
afterAll(async () => {
  await db.close();
});

describe("the migration", () => {
  it("is 0045: a nullable purpose that refuses anything but the import kinds", async () => {
    expect((await db.query("select 1 from schema_migrations where name = $1", ["0045_upload_purpose.sql"])).rows).toHaveLength(1);
    const insert = (purpose: string | null, key: string) =>
      db.query(
        "insert into pending_uploads (key, firm_id, engagement_id, user_id, target_kind, file_name, size_bytes, purpose, expires_at) values ($1, $2, $3, $4, 'engagement', 'f.csv', 1, $5, now() + interval '5 minutes')",
        [`${A}/${key}`, A, engagement, partner.userId, purpose],
      );
    await expect(insert("working_paper", "11111111-1111-4111-8111-111111111111")).rejects.toThrow(/violates check/);
    await insert(null, "22222222-2222-4222-8222-222222222222");
    await db.query("delete from pending_uploads");
  });
});

describe("a journal listing over the function limit", () => {
  it("is uploaded straight to the store, imported through the ordinary action, and the object deleted", async () => {
    const data = journalCsv(HOSTED_UPLOAD_BYTES + 200_000);
    expect(data.length).toBeGreaterThan(HOSTED_UPLOAD_BYTES);
    process.env.FILE_STORE = "vercel-blob";
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    process.env.VERCEL = "1";
    try {
      const key = await upload(partner, journal(engagement), "journal.csv", data);
      const options = await tokenOptionsFor(db, partner, key);
      expect(options.maximumSizeInBytes).toBe(data.length);
      const { importLedgerAction } = await import("../src/app/ledger-actions");
      const form = new FormData();
      form.set("engagementId", engagement);
      form.set("uploadKey", key);
      const state = await importLedgerAction({ ok: true, message: "" }, form);
      expect(state.ok, state.message).toBe(true);
      expect(state.message).toMatch(/Imported [\d,]+ lines/);
      expect(blobs.has(key)).toBe(false);
      expect(removed).toContain(key);
      expect(await pending()).toBe(0);
      // A second use of the same key is refused.
      expect((await importLedgerAction({ ok: true, message: "" }, form)).message).toBe(IMPORT_NOT_FOUND);
      // The same file read the ordinary way says the same thing: the preview and the result match the small-file path.
      const small = new FormData();
      small.set("engagementId", engagement);
      small.set("file", new File([journalCsv(50_000) as BlobPart], "journal.csv"));
      expect((await importLedgerAction({ ok: true, message: "" }, small)).ok).toBe(true);
    } finally {
      delete process.env.FILE_STORE;
      delete process.env.BLOB_READ_WRITE_TOKEN;
      delete process.env.VERCEL;
    }
  });

  it("gives the ordinary parser the same rows as a form upload", async () => {
    const data = journalCsv(4_300_000);
    const key = await upload(partner, journal(engagement), "journal.csv", data);
    const file = await take(partner, key, journal(engagement));
    expect(file.name).toBe("journal.csv");
    expect(Buffer.from(await file.arrayBuffer()).equals(Buffer.from(data))).toBe(true);
    expect(blobs.has(key)).toBe(false);
  });
});

describe("the trial balance and the schedule listing", () => {
  it("take the same direct path, each for its own purpose", async () => {
    const tb = await upload(prep, { engagementId: engagement, purpose: "trial_balance", target: null }, "tb.csv", new TextEncoder().encode("Account code,Account name,Debit,Credit\n1000,Bank,5,\n4000,Sales,,5\n"));
    expect((await take(prep, tb, { engagementId: engagement, purpose: "trial_balance", target: null })).name).toBe("tb.csv");
    const t: ImportTarget = { engagementId: engagement, purpose: "schedule_listing", target: schedule };
    const key = await upload(prep, t, "list.csv", new TextEncoder().encode("Description,Amount\nInvented supplier,10.00\n"));
    expect((await take(prep, key, t)).name).toBe("list.csv");
    await expect(beginImportUpload(db, prep, ops, { ...t, target: "dddddddd-9494-4000-8000-000000000001", fileName: "x.csv", sizeBytes: 5 })).rejects.toThrow(/Schedule not found/);
  });
});

describe("refusals", () => {
  it("over 25 MB, at the start and again from what arrived", async () => {
    await expect(beginImportUpload(db, partner, ops, { ...journal(engagement), fileName: "big.csv", sizeBytes: IMPORT_DIRECT_BYTES + 1 })).rejects.toThrow(/larger than 25 MB/);
    const key = await upload(partner, journal(engagement), "big.csv", new Uint8Array(IMPORT_DIRECT_BYTES + 5), 100);
    await expect(take(partner, key, journal(engagement))).rejects.toThrow(/larger than 25 MB/);
    expect(blobs.has(key)).toBe(false);
    await expect(beginImportUpload(db, partner, ops, { ...journal(engagement), fileName: "x.pdf", sizeBytes: 5 })).rejects.toThrow(/Excel \(\.xlsx\) or CSV/);
    const wrong = await upload(partner, journal(engagement), "j.csv", new Uint8Array(10), 11);
    await expect(take(partner, wrong, journal(engagement))).rejects.toThrow(/not the size/);
    expect(blobs.has(wrong)).toBe(false);
  });

  it("over the row limit, before anything is parsed, for a CSV and a workbook", async () => {
    const limit = IMPORT_DIRECT_ROWS.journal_listing;
    const key = await upload(partner, journal(engagement), "rows.csv", new TextEncoder().encode("a\n".repeat(limit + 5)));
    await expect(take(partner, key, journal(engagement))).rejects.toThrow(tooManyRows(limit));
    expect(blobs.has(key)).toBe(false);
    const t: ImportTarget = { engagementId: engagement, purpose: "trial_balance", target: null };
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("TB");
    for (let i = 0; i < IMPORT_DIRECT_ROWS.trial_balance + 3; i++) sheet.addRow([i, "x"]);
    const xlsx = new Uint8Array(await wb.xlsx.writeBuffer());
    const big = await upload(partner, t, "tb.xlsx", xlsx);
    await expect(take(partner, big, t)).rejects.toThrow(tooManyRows(IMPORT_DIRECT_ROWS.trial_balance));
  });

  it("an upload begun as a working paper used as an import, and an import used as a working paper", async () => {
    const paper = await beginDirectUpload(db, partner, ops, { engagementId: engagement, targetKind: "engagement", target: null, fileName: "evidence.csv", sizeBytes: 4, description: "" });
    blobs.set(paper.key, new TextEncoder().encode("a,b\n"));
    await expect(take(partner, paper.key, journal(engagement))).rejects.toThrow(IMPORT_NOT_FOUND);
    // The working paper upload is left as it was and can still be finished.
    expect(blobs.has(paper.key)).toBe(true);
    await finishDirectUpload(db, partner, ops, paper.key);
    const before = await papers();
    const key = await upload(partner, journal(engagement), "j.csv", new TextEncoder().encode("a,b\n"));
    await expect(finishDirectUpload(db, partner, ops, key)).rejects.toThrow(/not found/);
    expect(await papers()).toBe(before);
    expect(blobs.has(key)).toBe(true);
    await take(partner, key, journal(engagement));
  });

  it("another purpose, engagement, user or firm, a locked engagement and an expired upload", async () => {
    const data = new TextEncoder().encode("a,b\n");
    const key = await upload(partner, journal(engagement), "j.csv", data);
    await expect(take(partner, key, { engagementId: engagement, purpose: "trial_balance", target: null })).rejects.toThrow(IMPORT_NOT_FOUND);
    await expect(take(partner, key, journal(other))).rejects.toThrow(IMPORT_NOT_FOUND);
    await expect(take(prep, key, journal(engagement))).rejects.toThrow(IMPORT_NOT_FOUND);
    await expect(take(outsider, key, journal(engagement))).rejects.toThrow(IMPORT_NOT_FOUND);
    await expect(beginImportUpload(db, outsider, ops, { ...journal(engagement), fileName: "j.csv", sizeBytes: 4 })).rejects.toThrow(/Engagement not found/);
    await db.query("update engagements set status = 'locked' where id = $1", [engagement]);
    await expect(take(partner, key, journal(engagement))).rejects.toThrow(/This engagement is locked/);
    await expect(beginImportUpload(db, partner, ops, { ...journal(engagement), fileName: "j.csv", sizeBytes: 4 })).rejects.toThrow(/This engagement is locked/);
    await db.query("update engagements set status = 'open' where id = $1", [engagement]);
    await expect(takeImportFile(db, partner, ops, key, journal(engagement), new Date(Date.now() + 60 * 60_000))).rejects.toThrow(IMPORT_NOT_FOUND);
  });

  it("an unfinished import upload is swept like a working paper one", async () => {
    const key = await upload(partner, journal(engagement), "j.csv", new TextEncoder().encode("a,b\n"));
    const swept = await as(partner, (tx) => sweepExpired(tx, new Date(Date.now() + 60 * 60_000)));
    expect(swept).toContain(key);
    // The next begin sweeps and removes the object.
    const stale = await upload(partner, journal(engagement), "j.csv", new TextEncoder().encode("a,b\n"));
    await beginImportUpload(db, partner, ops, { ...journal(engagement), fileName: "k.csv", sizeBytes: 4 }, new Date(Date.now() + 60 * 60_000));
    expect(removed).toContain(stale);
    expect(blobs.has(stale)).toBe(false);
  });
});

describe("what the pages are told", () => {
  it("shows 25 MB only when hosted with the token; otherwise the limit and wording stay", () => {
    const hosted = importLimits({ VERCEL: "1", FILE_STORE: "vercel-blob", BLOB_READ_WRITE_TOKEN: "t" });
    expect(hosted).toEqual({ direct: true, maxBytes: IMPORT_DIRECT_BYTES, label: "25 MB", viaStoreAbove: HOSTED_UPLOAD_BYTES });
    expect(importLimits({ VERCEL: "1", FILE_STORE: "vercel-blob" })).toMatchObject({ direct: false, label: "4 MB", maxBytes: HOSTED_UPLOAD_BYTES });
    expect(importLimits({})).toMatchObject({ direct: false, label: "10 MB" });
    expect(workingPaperLimit({})).toMatchObject({ direct: false });
  });
});

describe("counting rows without loading", () => {
  it("counts lines of a CSV and rows of a workbook, and stops once past the limit", async () => {
    expect(await countRows("a.csv", new TextEncoder().encode("a\nb\nc"), 10)).toBe(3);
    expect(await countRows("a.csv", new TextEncoder().encode("a\nb\n"), 10)).toBe(2);
    const wb = new ExcelJS.Workbook();
    const s = wb.addWorksheet("one");
    for (let i = 0; i < 1234; i++) s.addRow([i]);
    wb.addWorksheet("two").addRow(["x"]);
    const data = new Uint8Array(await wb.xlsx.writeBuffer());
    expect(await countRows("a.xlsx", data, 100_000)).toBe(1234);
    expect(await countRows("a.xlsx", data, 100)).toBeGreaterThan(100);
    await expect(countRows("a.xlsx", new TextEncoder().encode("not a zip"), 100)).rejects.toThrow(/could not be read/);
  });
});
