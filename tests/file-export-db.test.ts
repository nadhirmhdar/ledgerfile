import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import * as papers from "../src/server/working-papers";
import * as schedules from "../src/server/test-schedules";
import { readZip } from "./read-zip";

// Invented firms and people.
const A = "aaaaaaaa-9393-4000-8000-000000000001";
const B = "bbbbbbbb-9393-4000-8000-000000000001";
const user = (firm: string, n: number, role: repo.Session["role"]): repo.Session => ({ firmId: firm, userId: `${firm.slice(0, 8)}-9393-4000-8000-00000000009${n}`, role });
const partner = user(A, 1, "partner");
const admin = user(A, 2, "admin");
const reviewer = user(A, 3, "reviewer");
const preparer = user(A, 4, "preparer");
const partnerB = user(B, 1, "partner");

const mem = vi.hoisted(() => ({ files: new Map<string, Uint8Array>() }));
let db: Db;
let session: repo.Session;
const store = { put: async (k: string, d: Uint8Array) => void mem.files.set(k, d), get: async (k: string) => mem.files.get(k) ?? null, remove: async (k: string) => void mem.files.delete(k) };
vi.mock("../src/server/session", () => ({ getSession: async () => session, getOptionalSession: async () => session }));
vi.mock("../src/server/db", async (original) => {
  const real = await original<typeof import("../src/server/db")>();
  return { ...real, getDb: async () => db };
});
vi.mock("../src/server/file-store", async (original) => {
  const real = await original<typeof import("../src/server/file-store")>();
  return { ...real, getFileStore: () => store };
});

type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
const text = (s: string) => new TextEncoder().encode(s);
const TB = [
  { code: "1000", name: "Bank - current account", closingMinor: 15000000, priorMinor: 10000000 },
  { code: "3000", name: "Share capital", closingMinor: -5000000, priorMinor: -5000000 },
  { code: "4000", name: "Sales", closingMinor: -10000000, priorMinor: -5000000 },
];

let engagement: string;
let other: string;

async function download(who: repo.Session, id: string) {
  session = who;
  const { GET } = await import("../src/app/(app)/engagements/[id]/index/download-all/route");
  return GET(new Request("http://t/x"), { params: Promise.resolve({ id }) });
}
const zipOf = async (r: Response) => readZip(Buffer.from(await r.arrayBuffer()));
const textOf = (entries: ReturnType<typeof readZip>, name: string) => Buffer.from(entries.find((e) => e.name === name)!.data).toString("utf8");

async function make(name: string): Promise<string> {
  return as(partner, async (tx) => {
    const client = await repo.createClient(tx, partner, name);
    const e = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
    await repo.importTrialBalance(tx, partner, e, "tb.xlsx", TB);
    await repo.approveAllMappings(tx, partner, e);
    await audit.setAuditEnabled(tx, partner, e, true);
    return e;
  });
}

beforeAll(async () => {
  db = await openDatabase();
  for (const f of [A, B]) await db.query("insert into firms (id, name) values ($1, 'Invented Audit Firm')", [f]);
  for (const u of [partner, admin, reviewer, preparer, partnerB]) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, u === partner ? "Pia Partner" : `${u.role} ${u.userId.slice(-1)}`, u.role]);
  session = partner;
  engagement = await make("Export Trading LLC");
  other = await make("Other Client LLC");
  await as(partner, async (tx) => {
    const first = await papers.addWorkingPaper(tx, partner, store, engagement, { targetKind: "engagement", target: null, fileName: "Bank statement.txt", data: text("version one"), description: "Invented." });
    await papers.addWorkingPaperVersion(tx, partner, store, first, { fileName: "Bank statement.txt", data: text("version two"), description: "" });
    await papers.addWorkingPaper(tx, partner, store, engagement, { targetKind: "engagement", target: null, fileName: "Bank statement.txt", data: text("a second paper with the same name"), description: "" });
    await schedules.createSchedule(tx, partner, engagement, { areaCode: "C5", groupCode: null, title: "Invented listing" });
  });
  await as(partner, async (tx) => {
    await papers.addWorkingPaper(tx, partner, store, other, { targetKind: "engagement", target: null, fileName: "theirs.txt", data: text("other client"), description: "" });
  });
});
afterAll(async () => {
  await db.close();
});

describe("the whole-file download", () => {
  it("is a zip of the index, statements, letters, schedules, confirmations, current working papers, the audit log and a README", async () => {
    const response = await download(partner, engagement);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toContain("Export-Trading-LLC-file-2025-12-31.zip");
    const entries = await zipOf(response);
    const names = entries.map((e) => e.name);
    expect(names[0]).toBe("00 Index.xlsx");
    expect(names).toEqual(expect.arrayContaining(["01 Financial statements/Export-Trading-LLC-financial-statements-2025-12-31.pdf", "01 Financial statements/Export-Trading-LLC-financial-statements-2025-12-31.docx"]));
    expect(names.filter((n) => n.startsWith("03 Letters/"))).toHaveLength(2);
    expect(names.filter((n) => n.startsWith("04 Test schedules/"))).toHaveLength(1);
    expect(names.filter((n) => n.startsWith("05 Confirmations/"))).toHaveLength(1);
    // No opinion is recorded, so there is no report.
    expect(names.some((n) => n.startsWith("02 "))).toBe(false);
    const working = entries.filter((e) => e.name.startsWith("06 Working papers/"));
    expect(working.map((e) => e.name.split("/").pop()).sort()).toEqual(["Bank statement (2).txt", "Bank statement.txt"]);
    // Only the current version of the replaced paper: version two, not version one.
    expect(working.map((e) => Buffer.from(e.data).toString()).sort()).toEqual(["a second paper with the same name", "version two"]);
    expect(names.at(-2)).toBe("Audit log.csv");
    expect(names.at(-1)).toBe("README.txt");
    expect(names.every((n) => !n.includes("..") && !n.includes("\\"))).toBe(true);
    const readme = textOf(entries, "README.txt");
    expect(readme).toContain("Client: Export Trading LLC");
    expect(readme).toContain("Period: 2025-01-01 to 2025-12-31");
    expect(readme).toContain("Produced by: Pia Partner");
    expect(readme).toContain(`Files, not counting this one: ${names.length - 1}`);
    expect(readme).not.toContain("Not included");
    // The statements are produced by the page's own generators.
    expect(Buffer.from(entries.find((e) => e.name.endsWith(".pdf"))!.data).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("holds only this engagement's audit log entries, in the firm export's columns", async () => {
    const entries = await zipOf(await download(partner, engagement));
    const csv = textOf(entries, "Audit log.csv");
    expect(csv.split(/\r?\n/)[0]).toContain("Who");
    expect(csv).toContain("Export Trading LLC");
    expect(csv).not.toContain("Other Client LLC");
    expect(csv).not.toContain("theirs.txt");
  });

  it("is logged with who, the number of files and the total bytes", async () => {
    const entries = await zipOf(await download(admin, engagement));
    const row = (await db.query<{ user_id: string; detail: { files: number; bytes: number; complete: boolean; notProduced: number } }>("select user_id, detail from audit_log where action = 'export_whole_file' and entity_id = $1 order by id desc limit 1", [engagement])).rows[0];
    expect(row.user_id).toBe(admin.userId);
    expect(row.detail).toMatchObject({ files: entries.length, bytes: entries.reduce((t, e) => t + e.size, 0), complete: true, notProduced: 0 });
  });

  it("is refused (not found) to a reviewer, a preparer, another firm, a demoted partner and a bad id", async () => {
    for (const who of [reviewer, preparer, partnerB, { ...reviewer, role: "partner" as const }]) expect((await download(who, engagement)).status, who.userId).toBe(404);
    expect((await download(partner, "not-an-id")).status).toBe(404);
    await db.query("update users set role = 'reviewer' where id = $1", [partner.userId]);
    expect((await download(partner, engagement)).status).toBe(404);
    await db.query("update users set role = 'partner' where id = $1", [partner.userId]);
  });

  it("works on a locked and an archived engagement, and names a file that cannot be read instead of failing", async () => {
    await db.query("update engagements set status = 'locked' where id = $1", [engagement]);
    expect((await download(partner, engagement)).status).toBe(200);
    await db.query("update engagements set archived_at = now() where id = $1", [engagement]);
    const key = (await db.query<{ storage_key: string }>("select storage_key from working_papers where engagement_id = $1 and file_name = 'Bank statement.txt' and replaces_id is not null", [engagement])).rows[0].storage_key;
    const kept = mem.files.get(key)!;
    mem.files.delete(key);
    const response = await download(partner, engagement);
    expect(response.status).toBe(200);
    const entries = await zipOf(response);
    expect(textOf(entries, "README.txt")).toContain("Not included");
    expect(textOf(entries, "README.txt")).toContain("Working paper Bank statement.txt");
    mem.files.set(key, kept);
  });
});

const get = async (who: repo.Session, id: string, section?: string) => {
  session = who;
  const { GET } = await import("../src/app/(app)/engagements/[id]/index/download-all/route");
  return GET(new Request(`http://t/x${section === undefined ? "" : `?section=${section}`}`), { params: Promise.resolve({ id }) });
};
const outline = (id: string) => as(partner, async (tx) => (await (await import("../src/server/file-export")).outlineExport(tx, id))!);

describe("the size shown before the download", () => {
  it("matches the zip: the same number of files, and bytes within a third or 150 KB", async () => {
    const o = await outline(engagement);
    const entries = await zipOf(await get(partner, engagement));
    expect(o.whole.files).toBe(entries.length);
    const actual = entries.reduce((t, e) => t + e.size, 0);
    expect(Math.abs(o.whole.bytes - actual)).toBeLessThanOrEqual(Math.max(actual / 3, 150 * 1024));
    for (const section of o.sections) {
      const own = await zipOf(await get(partner, engagement, section.code));
      expect(section.files, section.code).toBe(own.length);
      const size = own.reduce((t, e) => t + e.size, 0);
      expect(Math.abs(section.bytes - size), section.code).toBeLessThanOrEqual(Math.max(size / 3, 150 * 1024));
    }
  });
});

describe("the cap", () => {
  it("refuses the whole file before anything is sent, with the message, and still allows a section", async () => {
    const logged = async () => (await db.query<{ n: number }>("select count(*)::int as n from audit_log where action = 'export_whole_file'")).rows[0].n;
    const before = await logged();
    process.env.EXPORT_MAX_BYTES = "1000";
    try {
      const response = await get(partner, engagement);
      expect(response.status).toBe(413);
      expect(response.headers.get("content-type")).toContain("text/plain");
      expect(await response.text()).toMatch(/cannot be downloaded in one piece\. Download it by section instead\./);
      expect(await logged()).toBe(before);
      const section = await get(partner, engagement, "UNFILED");
      expect(section.status).toBe(200);
      await section.arrayBuffer();
    } finally {
      delete process.env.EXPORT_MAX_BYTES;
    }
    const { exportMaxBytes, DEFAULT_EXPORT_MAX_BYTES } = await import("../src/server/config");
    expect(exportMaxBytes({})).toBe(DEFAULT_EXPORT_MAX_BYTES);
    expect(exportMaxBytes({ EXPORT_MAX_BYTES: "5" })).toBe(5);
    expect(exportMaxBytes({ EXPORT_MAX_BYTES: "nonsense" })).toBe(DEFAULT_EXPORT_MAX_BYTES);
  });
});

describe("a section download", () => {
  it("holds only that section's papers and generated documents, plus the audit log and the README, and says which section", async () => {
    const o = await outline(engagement);
    expect(o.sections.map((s) => s.code)).toEqual(expect.arrayContaining(["G", "A", "D", "C5", "UNFILED"]));
    const names = async (code: string) => (await zipOf(await get(partner, engagement, code))).map((e) => e.name);
    const unfiled = await names("UNFILED");
    expect(unfiled.filter((n) => n.startsWith("06 Working papers/"))).toHaveLength(2);
    expect(unfiled).toHaveLength(4);
    const general = await names("G");
    expect(general.every((n) => n.startsWith("01 Financial statements/") || n === "Audit log.csv" || n === "README.txt")).toBe(true);
    expect(general).toHaveLength(4);
    const area = await names("C5");
    expect(area.filter((n) => n.startsWith("04 Test schedules/"))).toHaveLength(1);
    expect(area.some((n) => n.startsWith("01 ") || n.startsWith("03 ") || n === "00 Index.xlsx")).toBe(false);
    expect((await names("A")).filter((n) => n.startsWith("03 Letters/"))).toEqual([expect.stringContaining("engagement-letter")]);
    const entries = await zipOf(await get(partner, engagement, "G"));
    expect(textOf(entries, "README.txt")).toContain("This download holds one index section only: G General.");
    const row = (await db.query<{ detail: { section?: string; files: number } }>("select detail from audit_log where action = 'export_whole_file' and entity_id = $1 order by id desc limit 1", [engagement])).rows[0];
    expect(row.detail).toMatchObject({ section: "G", files: entries.length });
  });

  it("is refused for an unknown section, and to a reviewer, a preparer or another firm", async () => {
    expect((await get(partner, engagement, "NOPE")).status).toBe(404);
    for (const who of [reviewer, preparer, partnerB]) expect((await get(who, engagement, "G")).status, who.userId).toBe(404);
  });
});

describe("telling a complete zip from a cut-off one", () => {
  it("ends the README, the last entry, with the number of entries", async () => {
    for (const section of [undefined, "G"]) {
      const entries = await zipOf(await get(partner, engagement, section));
      expect(entries.at(-1)!.name).toBe("README.txt");
      expect(textOf(entries, "README.txt").trimEnd().split(/\r\n/).at(-1)).toBe(`End of file: ${entries.length} entries`);
    }
  });
});
