import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as review from "../src/server/review";
import { checkFilters, countLog, exportLog, filterChoices, getLogPage, isAdmin } from "../src/server/audit-log";
import { NO_FILTERS, parseFilters, type LogFilters } from "../src/domain/audit-log";

let db: Db;
let current: { firmId: string; userId: string; name: string; firmName: string; role: string } | null;
vi.mock("../src/server/session", () => ({ getSession: async () => current, getOptionalSession: async () => current }));
vi.mock("../src/server/db", async (original) => {
  const real = await original<typeof import("../src/server/db")>();
  return { ...real, getDb: async () => db };
});

// Invented firms and people. Names include Arabic and one that starts with "=" to try the formula guard.
const A = "aaaaaaaa-6161-4000-8000-000000000001";
const B = "bbbbbbbb-6161-4000-8000-000000000001";
const user = (firm: string, n: number, role: repo.Session["role"]): repo.Session => ({ firmId: firm, userId: `${firm.slice(0, 8)}-6161-4000-8000-00000000004${n}`, role });
const admin = user(A, 1, "admin");
const partner = user(A, 2, "partner");
const reviewer = user(A, 3, "reviewer");
const preparer = user(A, 4, "preparer");
const lapsed = user(A, 5, "admin");
const adminB = user(B, 1, "admin");
const NAMES: Record<string, string> = { [admin.userId]: "Amal Admin", [partner.userId]: "=HYPERLINK(\"http://x\")", [reviewer.userId]: "ليلى المراجع", [preparer.userId]: "Pia Preparer", [lapsed.userId]: "Lapsed Admin", [adminB.userId]: "Other Firm Admin" };
const TB = [
  { code: "1000", name: "Bank - current account", closingMinor: 15000000, priorMinor: 10000000 },
  { code: "3000", name: "Share capital", closingMinor: -5000000, priorMinor: -5000000 },
  { code: "4000", name: "Sales", closingMinor: -10000000, priorMinor: 0 },
];

type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: { firmId: string }, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
const page = (f: Partial<LogFilters> = {}, cursor: Parameters<typeof getLogPage>[3] = null, size?: number) => as(admin, (tx) => getLogPage(tx, admin, { ...NO_FILTERS, ...f }, cursor, size));
const insert = (firm: string, who: string | null, action: string, entity: string, entityId: string | null, detail: unknown, at: string) =>
  db.query("insert into audit_log (firm_id, user_id, action, entity, entity_id, detail, at) values ($1, $2, $3, $4, $5, $6, $7::timestamptz)", [firm, who, action, entity, entityId, detail === null ? null : JSON.stringify(detail), at]);

let eng1: string;
let eng2: string;
let acct: string;

beforeAll(async () => {
  db = await openDatabase();
  for (const [id, n] of [[A, "Gulf Audit & Co"], [B, "Other Firm"]]) await db.query("insert into firms (id, name) values ($1, $2)", [id, n]);
  for (const u of [admin, partner, reviewer, preparer, lapsed, adminB]) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, NAMES[u.userId], u.role]);
  await db.query("update users set active = false where id = $1", [lapsed.userId]);

  // Real operations, so the actions are the ones the app writes.
  const made = await as(partner, async (tx) => {
    const c1 = await repo.createClient(tx, partner, "Al Noor Trading LLC");
    const e1 = await repo.createEngagement(tx, partner, c1, "2025-01-01", "2025-12-31");
    const c2 = await repo.createClient(tx, partner, "Desert Foods LLC");
    const e2 = await repo.createEngagement(tx, partner, c2, "2025-01-01", "2025-12-31");
    await repo.importTrialBalance(tx, partner, e1, "tb.xlsx", TB);
    await repo.approveAllMappings(tx, partner, e1);
    return { e1, e2 };
  });
  eng1 = made.e1;
  eng2 = made.e2;
  const accounts = await as(partner, (tx) => repo.listAccounts(tx, eng1));
  acct = accounts[0].id;
  await as(partner, (tx) => repo.setMapping(tx, partner, acct, accounts[2].groupCode as string));
  const sheets = (await as(partner, (tx) => review.getOverview(tx, eng1)))!.leadSheets;
  await as(preparer, (tx) => review.signOff(tx, preparer, eng1, sheets[0].groupCode, "preparer"));
  await as(reviewer, (tx) => review.addReviewPoint(tx, reviewer, eng1, "GENERAL", "Explain the opening balance."));
  // Sign-in and firm-level entries, and another firm's entry.
  await insert(A, preparer.userId, "sign_in", "user", preparer.userId, null, "2026-02-01T08:00:00Z");
  await insert(A, null, "sign_up", "firm", A, null, "2026-02-01T07:00:00Z");
  await insert(B, adminB.userId, "create", "client", "11111111-1111-4111-8111-111111111111", { name: "Other Firm Client" }, "2026-02-02T00:00:00Z");
});

afterAll(async () => {
  await db.close();
});

describe("who may see the log", () => {
  it("confirms an active administrator from the database, and nobody else", async () => {
    const check = (s: repo.Session) => as(s, (tx) => isAdmin(tx, { ...s, name: "x", email: "x@x", firmName: "F" }));
    expect(await check(admin)).toBe(true);
    for (const s of [partner, reviewer, preparer, lapsed]) expect(await check(s), s.role).toBe(false);
    // A session that claims to be an administrator is not believed: the database says preparer.
    expect(await as(preparer, (tx) => isAdmin(tx, { ...preparer, role: "admin", name: "x", email: "x@x", firmName: "F" }))).toBe(false);
  });

  it("shows the page to an administrator and says not found to everyone else", async () => {
    const { default: Page } = await import("../src/app/(app)/firm/audit-log/page");
    for (const s of [partner, reviewer, preparer, lapsed]) {
      current = { firmId: A, userId: s.userId, name: NAMES[s.userId], firmName: "Gulf Audit & Co", role: s.role };
      await expect(Page({ searchParams: Promise.resolve({}) }), s.role).rejects.toThrow();
    }
    current = { firmId: A, userId: admin.userId, name: "Amal Admin", firmName: "Gulf Audit & Co", role: "admin" };
    await expect(Page({ searchParams: Promise.resolve({}) })).resolves.toBeDefined();
  });

  it("answers the export with 404 to everyone else, 400 for no format, and a file to an administrator", async () => {
    const { GET } = await import("../src/app/(app)/firm/audit-log/export/route");
    const req = (q: string) => new Request(`http://x/firm/audit-log/export?${q}`);
    for (const s of [partner, reviewer, preparer, lapsed]) {
      current = { firmId: A, userId: s.userId, name: NAMES[s.userId], firmName: "Gulf Audit & Co", role: s.role };
      expect((await GET(req("format=csv"))).status, s.role).toBe(404);
      expect((await GET(req("format=xlsx"))).status, s.role).toBe(404);
    }
    current = { firmId: A, userId: admin.userId, name: "Amal Admin", firmName: "Gulf Audit & Co", role: "admin" };
    expect((await GET(req(""))).status).toBe(400);
    const csv = await GET(req("format=csv"));
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-disposition")).toMatch(/^attachment; filename="audit-log-Gulf-Audit-Co-first-latest\.csv"$/);
    const xlsx = await GET(req("format=xlsx&from=2026-01-01&to=2026-12-31"));
    expect(xlsx.headers.get("content-disposition")).toContain("audit-log-Gulf-Audit-Co-2026-01-01-2026-12-31.xlsx");
  });
});

describe("another firm's entries", () => {
  it("never appear in the page, the count, the choices or the export", async () => {
    const p = await page();
    expect(p.entries.some((e) => e.who === "Other Firm Admin" || e.summary.includes("Other Firm Client"))).toBe(false);
    const other = await as(adminB, (tx) => getLogPage(tx, adminB, NO_FILTERS, null));
    expect(other.entries.every((e) => e.who === "Other Firm Admin")).toBe(true);
    const choices = await as(admin, (tx) => filterChoices(tx, admin));
    expect(choices.people.map((x) => x.name)).not.toContain("Other Firm Admin");
    const res = await as(admin, (tx) => exportLog(tx, admin, NO_FILTERS, "csv"));
    expect(res.ok && String(res.body)).not.toContain("Other Firm Client");
    // Asking for the other firm's person or engagement is refused as not in this firm.
    const checked = await as(admin, (tx) => checkFilters(tx, { ...NO_FILTERS, person: adminB.userId }));
    expect(checked.filters.person).toBeNull();
    expect(checked.problems[0]).toMatch(/not on this firm's team/);
  });
});

describe("the list", () => {
  it("is newest first, with who, plain words and the raw action code", async () => {
    const p = await page();
    const times = p.entries.map((e) => e.at);
    expect([...times].sort().reverse()).toEqual(times);
    const signIn = p.entries.find((e) => e.action === "sign_in")!;
    expect(signIn).toMatchObject({ who: "Pia Preparer", what: "Signed in", engagement: null });
    expect(p.entries.find((e) => e.action === "sign_up")?.who).toBe("System");
    expect(p.entries.find((e) => e.action === "sign_off")?.what).toBe("Signed a lead sheet");
  });

  it("says Deleted user when the person is gone", async () => {
    await insert(A, "99999999-9999-4999-8999-999999999999", "sign_in", "user", null, null, "2026-02-03T00:00:00Z");
    expect((await page({ from: "2026-02-03", to: "2026-02-03" })).entries[0]).toMatchObject({ who: "Deleted user", at: "2026-02-03 00:00:00" });
  });
});

describe("the filters", () => {
  it("work on their own", async () => {
    expect((await page({ person: preparer.userId })).entries.every((e) => e.who === "Pia Preparer")).toBe(true);
    expect((await page({ person: preparer.userId })).entries.length).toBeGreaterThan(1);
    expect((await page({ action: "raise" })).entries.map((e) => e.action)).toEqual(["raise"]);
    const byEngagement = await page({ engagement: eng1 });
    expect(byEngagement.entries.length).toBeGreaterThan(3);
    expect(byEngagement.entries.every((e) => e.engagementId === eng1)).toBe(true);
    expect((await page({ engagement: eng2 })).entries.map((e) => e.action)).toEqual(["create"]);
  });

  it("combine", async () => {
    const p = await page({ engagement: eng1, person: partner.userId, action: "map" });
    expect(p.entries.map((e) => e.action)).toEqual(["map"]);
    expect((await page({ engagement: eng2, person: preparer.userId })).entries).toEqual([]);
  });

  it("take a date range as whole days, both ends included", async () => {
    await insert(A, admin.userId, "range_test", "firm", null, null, "2026-05-10T00:00:00Z");
    await insert(A, admin.userId, "range_test", "firm", null, null, "2026-05-10T23:59:59.999999Z");
    await insert(A, admin.userId, "range_test", "firm", null, null, "2026-05-11T00:00:00Z");
    await insert(A, admin.userId, "range_test", "firm", null, null, "2026-05-09T23:59:59.999999Z");
    const at = async (f: Partial<LogFilters>) => (await page({ action: "range_test", ...f })).entries.map((e) => e.at.slice(0, 10) + e.at.slice(10, 16)).reverse();
    expect(await at({ from: "2026-05-10", to: "2026-05-10" })).toEqual(["2026-05-10 00:00", "2026-05-10 23:59"]);
    expect(await at({ from: "2026-05-10" })).toHaveLength(3);
    expect(await at({ to: "2026-05-10" })).toHaveLength(3);
    expect(await at({ from: "2026-05-11", to: "2026-05-11" })).toEqual(["2026-05-11 00:00"]);
  });

  it("explain a bad value in words and ignore it instead of failing", async () => {
    const parsed = parseFilters({ from: "2026-02-31", to: "yesterday", person: "nobody", engagement: "123", action: "DROP TABLE" });
    expect(parsed.filters).toEqual(NO_FILTERS);
    expect(parsed.problems).toHaveLength(5);
    expect(parsed.problems.join(" ")).toMatch(/start date must be a real date/);
    expect(parseFilters({ from: "2026-06-02", to: "2026-06-01" }).problems[0]).toMatch(/start date is after the end date/);
    const unknown = await as(admin, (tx) => checkFilters(tx, { ...NO_FILTERS, person: "00000000-0000-4000-8000-000000000999", engagement: "00000000-0000-4000-8000-000000000998" }));
    expect(unknown.filters).toEqual(NO_FILTERS);
    expect(unknown.problems).toHaveLength(2);
    // The page still lists everything the valid filters allow.
    expect((await page(unknown.filters)).entries.length).toBeGreaterThan(5);
  });
});

describe("paging", () => {
  it("never repeats or skips an entry, even when many share the same time, in either direction", async () => {
    await db.query(
      `insert into audit_log (firm_id, user_id, action, entity, entity_id, detail, at)
       select $1, $2, 'same_time', 'firm', null, jsonb_build_object('n', g), '2026-01-01T12:00:00Z'::timestamptz from generate_series(1, 250) g`,
      [A, admin.userId],
    );
    const seen: string[] = [];
    const sizes: number[] = [];
    let p = await page({ action: "same_time" });
    for (;;) {
      expect(p.newer === null).toBe(seen.length === 0);
      sizes.push(p.entries.length);
      seen.push(...p.entries.map((e) => JSON.parse(e.json).n));
      if (!p.older) break;
      p = await page({ action: "same_time" }, { value: p.older, dir: "older" });
    }
    expect(sizes).toEqual([100, 100, 50]);
    expect(new Set(seen).size).toBe(250);
    expect(seen.map(Number)).toEqual(Array.from({ length: 250 }, (_, i) => 250 - i));
    // Back again with Newer: the same pages in the same order.
    const back: string[] = [];
    let q = p;
    for (;;) {
      back.unshift(...q.entries.map((e) => JSON.parse(e.json).n));
      if (!q.newer) break;
      q = await page({ action: "same_time" }, { value: q.newer, dir: "newer" });
    }
    expect(back).toEqual(seen);
  });

  it("counts the entries the filters select", async () => {
    expect(await as(admin, (tx) => countLog(tx, admin, { ...NO_FILTERS, action: "same_time" }))).toBe(250);
  });

  it("ignores a cursor that is not one", async () => {
    const p = await page({ action: "same_time" }, { value: "garbage", dir: "older" });
    expect(p.entries).toHaveLength(100);
  });
});

describe("which engagement an entry belongs to", () => {
  const find = async (action: string, engagement = eng1) => (await page({ engagement, action })).entries;

  it("is the entry's own entity when that is the engagement (create)", async () => {
    const e = await find("create", eng2);
    expect(e[0]).toMatchObject({ engagementId: eng2, engagement: "Desert Foods LLC, 2025-01-01 to 2025-12-31", entity: "engagement" });
  });
  it("is the engagementId in the detail (raise: a review point)", async () => {
    expect((await find("raise"))[0]).toMatchObject({ entity: "review_point", engagementId: eng1, engagement: "Al Noor Trading LLC, 2025-01-01 to 2025-12-31" });
  });
  it("is the engagement of the account (map)", async () => {
    expect((await find("map"))[0]).toMatchObject({ entity: "account", engagementId: eng1 });
  });
  it("is the entity id when the entity is kept per engagement (import trial_balance, approve_all mapping, sign_off lead_sheet)", async () => {
    for (const [action, entity] of [["import", "trial_balance"], ["approve_all", "mapping"], ["sign_off", "lead_sheet"]]) {
      expect((await find(action))[0], action).toMatchObject({ entity, engagementId: eng1 });
    }
  });
  it("is none for client, firm and sign-in entries", async () => {
    const all = (await page()).entries;
    for (const e of all.filter((e) => e.entity === "client" || e.entity === "firm" || e.entity === "user")) expect(e, e.action).toMatchObject({ engagementId: null, engagement: null });
    expect(all.some((e) => e.entity === "client")).toBe(true);
  });
  it("copes with an entity id that is not an id, and a detail that is not an object", async () => {
    await insert(A, admin.userId, "odd", "engagement", "not-a-uuid", "just text", "2026-04-01T00:00:00Z");
    await insert(A, admin.userId, "odd", "lead_sheet", null, { engagementId: "nope" }, "2026-04-01T00:00:01Z");
    const odd = (await page({ action: "odd" })).entries;
    expect(odd).toHaveLength(2);
    expect(odd.every((e) => e.engagementId === null)).toBe(true);
  });
  it("is found in one query for the whole page, not one per row", async () => {
    let queries = 0;
    const entries = await as(admin, async (tx) => {
      const counted = new Proxy(tx, { get: (t, k) => (k === "query" ? (...a: Parameters<T["query"]>) => (queries++, t.query(...a)) : Reflect.get(t, k)) }) as T;
      return (await getLogPage(counted, admin, NO_FILTERS, null)).entries;
    });
    expect(entries.length).toBe(100);
    expect(queries).toBe(1);
  });
});

describe("secrets", () => {
  it("never show in the summary, the fold or the export, at any depth", async () => {
    await insert(A, admin.userId, "secret_test", "firm", null, { password: "hunter2-secret", nested: { sessionToken: "tok-123", apiKey: "key-456", fine: "visible" }, list: [{ passwordHash: "$2b$10$abc" }], note: "ok" }, "2026-04-02T00:00:00Z");
    const e = (await page({ action: "secret_test" })).entries[0];
    for (const text of [e.summary, e.json]) {
      for (const secret of ["hunter2-secret", "tok-123", "key-456", "$2b$10$abc"]) expect(text).not.toContain(secret);
    }
    expect(e.json).toContain("[hidden]");
    expect(e.json).toContain("visible");
    expect(e.summary).toContain("Note: ok");
    const csv = await as(admin, (tx) => exportLog(tx, admin, { ...NO_FILTERS, action: "secret_test" }, "csv"));
    expect(csv.ok && String(csv.body)).not.toContain("hunter2-secret");
  });
});

describe("the export", () => {
  it("has the columns, the filtered rows only, and its own entry in the log with the filters and the count", async () => {
    const f = { ...NO_FILTERS, action: "sign_in" };
    const res = await as(admin, (tx) => exportLog(tx, admin, f, "csv"));
    if (!res.ok) throw new Error(res.message);
    const lines = String(res.body).replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe('"When (UTC)","Who","What","Action","Engagement","Details","Detail (JSON)"');
    expect(lines.length - 1).toBe(res.rows);
    expect(lines.slice(1).every((l) => l.includes('"sign_in"'))).toBe(true);
    const entry = (await page({ action: "export" })).entries.find((e) => e.entity === "audit_log")!;
    expect(entry).toMatchObject({ what: "Exported the audit log", who: "Amal Admin" });
    expect(JSON.parse(entry.json)).toMatchObject({ filters: { action: "sign_in" }, rows: res.rows, format: "csv" });
  });

  it("starts the CSV with a byte order mark and keeps Arabic names", async () => {
    const res = await as(admin, (tx) => exportLog(tx, admin, { ...NO_FILTERS, person: reviewer.userId }, "csv"));
    if (!res.ok) throw new Error(res.message);
    expect(String(res.body).charCodeAt(0)).toBe(0xfeff);
    expect(String(res.body)).toContain("ليلى المراجع");
    expect(res.contentType).toBe("text/csv; charset=utf-8");
  });

  it("guards a formula in the CSV with an apostrophe", async () => {
    const res = await as(admin, (tx) => exportLog(tx, admin, { ...NO_FILTERS, person: partner.userId }, "csv"));
    if (!res.ok) throw new Error(res.message);
    expect(String(res.body)).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(String(res.body)).not.toMatch(/,"=HYPERLINK/);
  });

  it("writes every Excel cell as text, so a formula-looking name is never a formula", async () => {
    const res = await as(admin, (tx) => exportLog(tx, admin, { ...NO_FILTERS, person: partner.userId }, "xlsx"));
    if (!res.ok) throw new Error(res.message);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as never);
    const sheet = wb.getWorksheet("Audit log")!;
    expect(sheet.getRow(1).values).toEqual([undefined, "When (UTC)", "Who", "What", "Action", "Engagement", "Details", "Detail (JSON)"]);
    const who = sheet.getRow(2).getCell(2);
    expect(who.type).toBe(ExcelJS.ValueType.String);
    expect(who.value).toBe('=HYPERLINK("http://x")');
    expect(who.numFmt).toBe("@");
    expect(sheet.rowCount).toBe(res.rows + 1);
  });

  it("refuses above the cap and says to narrow the dates, without logging an export", async () => {
    const before = await as(admin, (tx) => countLog(tx, admin, { ...NO_FILTERS, action: "export" }));
    const res = await as(admin, (tx) => exportLog(tx, admin, NO_FILTERS, "xlsx", 3));
    expect(res).toMatchObject({ ok: false });
    expect(!res.ok && res.message).toMatch(/at most 3\. Narrow the dates/);
    expect(await as(admin, (tx) => countLog(tx, admin, { ...NO_FILTERS, action: "export" }))).toBe(before);
    // At the cap exactly it is allowed.
    const n = await as(admin, (tx) => countLog(tx, admin, { ...NO_FILTERS, action: "range_test" }));
    expect((await as(admin, (tx) => exportLog(tx, admin, { ...NO_FILTERS, action: "range_test" }, "csv", n))).ok).toBe(true);
  });
});
