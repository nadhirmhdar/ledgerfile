import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import * as review from "../src/server/review";
import * as journals from "../src/server/journals";
import * as ledger from "../src/server/ledger";
import * as papers from "../src/server/working-papers";
import * as requests from "../src/server/client-requests";
import * as confirmations from "../src/server/confirmations";
import * as schedules from "../src/server/test-schedules";
import * as analytics from "../src/server/analytics";
import * as planning from "../src/server/planning-answers";
import { recordOpinion } from "../src/server/opinion";
import { saveNoteText } from "../src/server/note-texts";
import { approveDeletion, cancelDeletion, getRetention, partnerLevel, pastRetentionSince, removePendingFiles, requestDeletion, setRetentionYears } from "../src/server/retention";
import { localFileStore, type FileStore } from "../src/server/file-store";
import { NAME_MISMATCH, NOT_PARTNER, NOT_SET, ONE_PARTNER, SAME_PERSON } from "../src/domain/retention";
import type { AuthSession } from "../src/server/auth";

const A = "aaaaaaaa-7373-4000-8000-000000000001";
const B = "bbbbbbbb-7373-4000-8000-000000000001";
const user = (firm: string, n: number, role: repo.Session["role"]): repo.Session => ({ firmId: firm, userId: `${firm.slice(0, 8)}-7373-4000-8000-00000000009${n}`, role });
const partner = user(A, 1, "partner");
const partner2 = user(A, 2, "partner");
const admin = user(A, 3, "admin");
const reviewer = user(A, 4, "reviewer");
const preparer = user(A, 5, "preparer");
const outsider = user(B, 1, "partner");
const asAdmin = (s: repo.Session): AuthSession => ({ ...s, name: "Admin", email: "a@x.test", firmName: "Firm A" });
const TB = [
  { code: "1000", name: "Bank - current account", closingMinor: 15000000, priorMinor: 5000000 },
  { code: "3000", name: "Share capital", closingMinor: -5000000, priorMinor: -5000000 },
  { code: "4000", name: "Sales", closingMinor: -10000000, priorMinor: 0 },
];

let db: Db;
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: { firmId: string }, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);

/** A file store in memory that records removals and can be made to fail. */
function memoryStore() {
  const files = new Map<string, Uint8Array>();
  const state = { failing: false, removed: [] as string[] };
  const store: FileStore = {
    put: async (k, d) => void files.set(k, d),
    get: async (k) => files.get(k) ?? null,
    remove: async (k) => {
      if (state.failing) throw new Error("the store is unavailable");
      files.delete(k);
      state.removed.push(k);
    },
  };
  return { store, files, state };
}
const mem = memoryStore();

/** The tables that hold an engagement's rows: every table with an engagement_id column and the three children without one. */
async function engagementTables(): Promise<string[]> {
  const { rows } = await db.query<{ table_name: string }>("select table_name from information_schema.columns where table_schema = 'public' and column_name = 'engagement_id' and table_name not like 'retention\\_%' order by 1");
  return [...rows.map((r) => r.table_name), "journal_lines", "mappings", "test_schedule_lines"];
}
async function rowCounts(engagementId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of await engagementTables()) {
    const sql =
      t === "journal_lines" ? "select count(*)::int as n from journal_lines where journal_entry_id in (select id from journal_entries where engagement_id = $1)"
      : t === "mappings" ? "select count(*)::int as n from mappings where account_id in (select id from accounts where engagement_id = $1)"
      : t === "test_schedule_lines" ? "select count(*)::int as n from test_schedule_lines where schedule_id in (select id from test_schedules where engagement_id = $1)"
      : `select count(*)::int as n from ${t} where engagement_id = $1`;
    out[t] = (await db.query<{ n: number }>(sql, [id(engagementId)])).rows[0].n;
  }
  return out;
}
const id = (x: string) => x;

let n = 0;
/** An engagement with at least one row in EVERY table that holds engagement data, built through the application's own functions where they exist. */
async function populated(name: string): Promise<{ engagement: string; client: string; keys: string[] }> {
  const label = `${name} ${++n} LLC`;
  const made = await as(partner, async (tx) => {
    const client = await repo.createClient(tx, partner, label);
    const e = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
    await repo.importTrialBalance(tx, partner, e, "tb.xlsx", TB);
    await repo.approveAllMappings(tx, partner, e);
    await audit.setAuditEnabled(tx, partner, e, true);
    return { client, e };
  });
  const e = made.e;
  await as(partner, async (tx) => {
    await audit.setMateriality(tx, partner, e, { benchmark: "revenue", percentageBp: 100, performancePct: 75, trivialPct: 5, rationale: "Invented rationale for retention tests." });
    await audit.addMisstatement(tx, partner, e, { description: "An invented misstatement for the retention test.", kind: "factual", amountMinor: 12345 });
    const accounts = await repo.listAccounts(tx, e);
    const bank = accounts.find((a) => a.code === "1000")!.id;
    const sales = accounts.find((a) => a.code === "4000")!.id;
    await journals.createJournal(tx, partner, e, { type: "adjusting", description: "Invented adjustment", lines: [{ accountId: bank, amountMinor: 1000 }, { accountId: sales, amountMinor: -1000 }] });
    await ledger.importLedger(tx, partner, e, "gl.csv", [
      { entryNo: "J1", date: "2025-03-01", postedBy: "Pia", description: "Sale", accountCode: "1000", accountName: "Bank", amountMinor: 5000 },
      { entryNo: "J1", date: "2025-03-01", postedBy: "Pia", description: "Sale", accountCode: "4000", accountName: "Sales", amountMinor: -5000 },
    ]);
    await ledger.selectForTesting(tx, partner, e, "J1");
    await ledger.recordJournalTest(tx, partner, e, "J1", { workDone: "Agreed to the invoice.", conclusion: "No exception found." });
    await review.addReviewPoint(tx, partner, e, "GENERAL", "Explain the opening balance.");
    const sheets = (await review.getOverview(tx, e))!.leadSheets.map((l) => l.groupCode);
    await review.signOff(tx, preparer, e, sheets[0], "preparer").catch(() => undefined);
  });
  await as(preparer, (tx) => review.signOff(tx, preparer, e, "CASH", "preparer").catch(() => undefined));
  const wp = await as(partner, (tx) => papers.addWorkingPaper(tx, partner, mem.store, e, { targetKind: "engagement", target: null, fileName: "evidence.txt", data: new TextEncoder().encode("Invented evidence."), description: "Invented" }));
  const wpKey = (await db.query<{ storage_key: string }>("select storage_key from working_papers where id = $1", [wp])).rows[0].storage_key;
  await as(partner, async (tx) => {
    const req = await requests.addRequest(tx, partner, e, { description: "Send the invented bank statements." });
    await requests.linkFile(tx, partner, req, wp);
    const conf = await confirmations.addConfirmation(tx, partner, e, { kind: "bank", partyName: "Invented Bank", bookMinor: 100 });
    await confirmations.linkFile(tx, partner, conf, wp);
    const sch = await schedules.createSchedule(tx, partner, e, { areaCode: "C5", groupCode: null, title: "Invented listing" });
    await schedules.saveLines(tx, partner, sch, { rows: [{ id: null, description: "Line one", amountMinor: 100, workingPaperId: wp }] });
  });
  // The rest through direct inserts where the application's functions need more set-up than this test is about.
  await as(partner, async (tx) => {
    await analytics.saveExplanation(tx, partner, e, "REVENUE", "Revenue grew because of an invented new contract.").catch(() => undefined);
  });
  await as(partner, (tx) => saveNoteText(tx, partner, e, "general", ["Invented general information for the retention test."]));
  await as(partner, (tx) => planning.rebutRevenuePresumption(tx, partner, e, "An invented reason for rebutting the presumption, in words."));
  await recordOpinion2(e);
  const pendingKey = `${A}/${"cccccccc-7373-4000-8000-0000000000" + String(10 + n)}`;
  await db.query(
    "insert into pending_uploads (key, firm_id, engagement_id, user_id, target_kind, file_name, size_bytes, expires_at) values ($1, $2, $3, $4, 'engagement', 'unfinished.txt', 10, now() + interval '1 day')",
    [pendingKey, A, e, partner.userId],
  );
  mem.files.set(pendingKey, new Uint8Array([1]));
  await db.query("insert into risk_assessments (firm_id, engagement_id, area_code, assertion, level, updated_by) values ($1, $2, 'C1', 'E', 'low', $3) on conflict do nothing", [A, e, partner.userId]);
  await db.query("insert into risk_approvals (firm_id, engagement_id, snapshot, approved_by) values ($1, $2, 'invented snapshot', $3)", [A, e, partner.userId]);
  return { engagement: e, client: made.client, keys: [wpKey, pendingKey] };
}
async function recordOpinion2(e: string) {
  await as(partner, (tx) => recordOpinion(tx, partner, e, { opinion: "unmodified", basisForModification: "", goingConcern: false, goingConcernNote: "", emphasisOfMatter: "", otherMatter: "", reportDate: "2025-12-31" }).catch(() => undefined));
}

/** Lock and archive an engagement the way the database sees it, some years ago. */
async function archive(e: string, yearsAgo: number) {
  await db.query("update engagements set status = 'locked', locked_by = $2, locked_at = now() where id = $1", [e, partner.userId]);
  await db.query("update engagements set archived_at = now() - make_interval(years => $3), archived_by = $2 where id = $1", [e, partner.userId, yearsAgo]);
}
const setYears = (years: number | null) => db.query("update firms set retention_years = $2 where id = $1", [A, years]);
const nameOf = async (e: string) => (await db.query<{ name: string }>("select c.name from engagements e join clients c on c.id = e.client_id where e.id = $1", [e])).rows[0].name;
const requestFor = (s: repo.Session, e: string, reason = "The retention period has passed.") => as(s, (tx) => requestDeletion(tx, s, e, reason));
// The name is read before the transaction opens: the test database has one connection, so no query may run beside an open transaction.
const approveFor = async (s: repo.Session, requestId: number, e: string, typed?: string) => {
  const name = typed ?? (await nameOf(e));
  return as(s, (tx) => approveDeletion(tx, s, requestId, name));
};
const exists = async (e: string) => (await db.query("select 1 from engagements where id = $1", [e])).rows.length > 0;

beforeAll(async () => {
  db = await openDatabase();
  for (const f of [A, B]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [f]);
  for (const u of [partner, partner2, admin, reviewer, preparer, outsider]) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-1)}`, u.role]);
});

afterAll(async () => {
  await db.close();
});

describe("the retention period", () => {
  it("has no default, and nothing is eligible or deletable while it is empty", async () => {
    expect((await db.query<{ retention_years: number | null }>("select retention_years from firms where id = $1", [A])).rows[0].retention_years).toBeNull();
    const p = await populated("Unset Period");
    await archive(p.engagement, 50);
    expect((await as(partner, (tx) => getRetention(tx))).items.every((i) => !i.eligible && i.eligibleFrom === null)).toBe(true);
    await expect(requestFor(partner, p.engagement)).rejects.toThrow(NOT_SET);
    expect(await as(partner, (tx) => pastRetentionSince(tx, p.engagement))).toBeNull();
  });

  it("is set by an administrator only, between 1 and 30 years, logged with before and after, and blank clears it", async () => {
    await expect(setRetentionYears(db, asAdmin(partner), "5")).rejects.toThrow(/administrator/);
    await expect(setRetentionYears(db, asAdmin(admin), "0")).rejects.toThrow("The period must be from 1 to 30 years.");
    await expect(setRetentionYears(db, asAdmin(admin), "31")).rejects.toThrow(/from 1 to 30/);
    await expect(setRetentionYears(db, asAdmin(admin), "two")).rejects.toThrow(/whole number/);
    expect(await setRetentionYears(db, asAdmin(admin), "7")).toEqual({ before: null, after: 7 });
    expect(await setRetentionYears(db, asAdmin(admin), "")).toEqual({ before: 7, after: null });
    await setRetentionYears(db, asAdmin(admin), "3");
    const log = (await db.query<{ detail: { before: number | null; after: number | null } }>("select detail from audit_log where action = 'set_retention_period' order by id")).rows.map((r) => r.detail);
    expect(log).toEqual([{ before: null, after: 7 }, { before: 7, after: null }, { before: null, after: 3 }]);
    await expect(db.query("update firms set retention_years = 99 where id = $1", [A])).rejects.toThrow();
  });
});

describe("who and what is eligible", () => {
  it("counts the clock from archiving, and only archived files", async () => {
    await setYears(3);
    const old = await populated("Old Archive");
    const recent = await populated("Recent Archive");
    const locked = await populated("Only Locked");
    const open = await populated("Still Open");
    await archive(old.engagement, 4);
    await archive(recent.engagement, 1);
    await db.query("update engagements set status = 'locked', locked_by = $2, locked_at = now() - interval '10 years' where id = $1", [locked.engagement, partner.userId]);
    const view = await as(partner, (tx) => getRetention(tx));
    const byId = new Map(view.items.map((i) => [i.engagementId, i]));
    expect(byId.get(old.engagement)).toMatchObject({ eligible: true });
    expect(byId.get(recent.engagement)).toMatchObject({ eligible: false });
    expect(byId.has(locked.engagement)).toBe(false);
    expect(byId.has(open.engagement)).toBe(false);
    // Eligible first.
    const flags = view.items.map((i) => i.eligible);
    expect(flags).toEqual([...flags].sort((a, b) => Number(b) - Number(a)));
    expect(flags[0]).toBe(true);
    expect(flags.at(-1)).toBe(false);
    // The period end was in 2025 for all of them: the date shown is from archiving, not from the period.
    expect(byId.get(old.engagement)!.eligibleFrom!.slice(0, 4)).not.toBe("2028");
    expect(await as(partner, (tx) => pastRetentionSince(tx, old.engagement))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await as(partner, (tx) => pastRetentionSince(tx, recent.engagement))).toBeNull();
    for (const [s, e] of [[partner, recent.engagement], [partner, locked.engagement], [partner, open.engagement]] as const) await expect(requestFor(s, e)).rejects.toThrow(/archived file|not yet past/);
  });

  it("reads the role from the database: a preparer and a reviewer are refused, a partner and an administrator are not", async () => {
    for (const s of [preparer, reviewer]) expect(await as(s, (tx) => partnerLevel(tx, s))).toBeNull();
    expect(await as(partner, (tx) => partnerLevel(tx, { ...partner }))).toBe("partner");
    expect(await as(admin, (tx) => partnerLevel(tx, admin))).toBe("admin");
    expect(await as(preparer, (tx) => partnerLevel(tx, { ...preparer, role: "partner" }))).toBeNull();
    const p = await populated("Role Check");
    await archive(p.engagement, 5);
    for (const s of [preparer, reviewer]) await expect(requestFor(s, p.engagement), s.role).rejects.toThrow(NOT_PARTNER);
    await expect(requestFor(outsider, p.engagement)).rejects.toThrow(/archived file of this firm/);
  });
});

describe("the two-person deletion", () => {
  it("needs a reason, refuses a second open request, lets the requester or another partner cancel, and allows asking again", async () => {
    await setYears(3);
    const p = await populated("Cancel Flow");
    await archive(p.engagement, 5);
    await expect(requestFor(partner, p.engagement, "no")).rejects.toThrow("Give the reason for deleting this file; it is recorded.");
    const r1 = await requestFor(partner, p.engagement);
    await expect(requestFor(partner2, p.engagement)).rejects.toThrow(/already been requested/);
    const state = (await as(partner, (tx) => getRetention(tx))).items.find((i) => i.engagementId === p.engagement)!;
    expect(state.request).toMatchObject({ id: r1, state: "pending", reason: "The retention period has passed." });
    expect(Object.values(state.request!.counts).some((c) => c > 0)).toBe(true);
    await expect(as(reviewer, (tx) => cancelDeletion(tx, reviewer, r1))).rejects.toThrow(NOT_PARTNER);
    await as(partner2, (tx) => cancelDeletion(tx, partner2, r1));
    await expect(as(partner, (tx) => cancelDeletion(tx, partner, r1))).rejects.toThrow(/already been approved or cancelled/);
    await expect(approveFor(partner2, r1, p.engagement)).rejects.toThrow(/already been approved or cancelled/);
    expect((await as(partner, (tx) => getRetention(tx))).items.find((i) => i.engagementId === p.engagement)!.request).toMatchObject({ state: "cancelled" });
    const r2 = await requestFor(partner, p.engagement, "Asking again after the cancellation.");
    expect(r2).toBeGreaterThan(r1);
    expect(await exists(p.engagement)).toBe(true);
    const log = (await db.query<{ action: string }>("select action from audit_log where entity_id = $1 and action like 'retention_%' order by id", [p.engagement])).rows.map((r) => r.action);
    expect(log).toEqual(["retention_request", "retention_cancel", "retention_request"]);
  });

  it("never lets the requester approve their own request, and needs the client's name typed exactly", async () => {
    await setYears(3);
    const p = await populated("Name Check");
    await archive(p.engagement, 5);
    const r = await requestFor(partner, p.engagement);
    await expect(approveFor(partner, r, p.engagement)).rejects.toThrow(SAME_PERSON);
    for (const typed of ["", "name check", "Name Check 1", `${await nameOf(p.engagement)}.`]) await expect(approveFor(partner2, r, p.engagement, typed)).rejects.toThrow(NAME_MISMATCH);
    await expect(approveFor(reviewer, r, p.engagement)).rejects.toThrow(NOT_PARTNER);
    expect(await exists(p.engagement)).toBe(true);
    expect((await db.query("select 1 from retention_deletions where request_id = $1", [r])).rows).toHaveLength(0);
  });

  it("is impossible in a firm with only one partner-level person, and the page data says so", async () => {
    const f = "dddddddd-7373-4000-8000-000000000001";
    await db.query("insert into firms (id, name, retention_years) values ($1, 'Solo Firm', 1)", [f]);
    const solo = user(f, 1, "partner");
    const prep = user(f, 2, "preparer");
    for (const u of [solo, prep]) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, f, `${u.userId}@x.test`, u.role, u.role]);
    const e = await as(solo, async (tx) => repo.createEngagement(tx, solo, await repo.createClient(tx, solo, "Solo Client LLC"), "2020-01-01", "2020-12-31"));
    await db.query("update engagements set status = 'locked', locked_by = $2, locked_at = now() where id = $1", [e, solo.userId]);
    await db.query("update engagements set archived_at = now() - interval '5 years', archived_by = $2 where id = $1", [e, solo.userId]);
    const view = await as(solo, (tx) => getRetention(tx));
    expect(view.partners).toBe(1);
    const r = await as(solo, (tx) => requestDeletion(tx, solo, e, "Past the period I set."));
    await expect(as(solo, (tx) => approveDeletion(tx, solo, r, "Solo Client LLC"))).rejects.toThrow(SAME_PERSON);
    expect(ONE_PARTNER).toMatch(/only one/);
    expect(await exists(e)).toBe(true);
  });
});

describe("the purge", () => {
  it("deletes every row of an engagement in every table, writes the tombstone, keeps the audit log, and removes the files after the commit", async () => {
    await setYears(3);
    const p = await populated("Full Purge");
    const other = await populated("Untouched Sibling");
    await archive(p.engagement, 5);
    const before = await rowCounts(p.engagement);
    const tables = await engagementTables();
    const empty = tables.filter((t) => before[t] === 0);
    expect(empty, `tables with no row in the populated engagement: ${empty.join(", ")}`).toEqual([]);
    const otherBefore = await rowCounts(other.engagement);
    const auditBefore = (await db.query<{ n: number }>("select count(*)::int as n from audit_log where entity_id = $1", [p.engagement])).rows[0].n;
    expect(auditBefore).toBeGreaterThan(0);
    const siblingPrior = await db.query("update engagements set prior_engagement_id = $1 where id = $2 returning id", [p.engagement, other.engagement]).catch(() => null);

    const r = await requestFor(partner, p.engagement);
    const out = await approveFor(partner2, r, p.engagement);
    expect(out.keys.sort()).toEqual(p.keys.sort());
    expect(Object.values(out.counts).every((c) => typeof c === "number")).toBe(true);

    // Gone: the engagement and every table's rows.
    expect(await exists(p.engagement)).toBe(false);
    const after = await rowCounts(p.engagement);
    for (const t of tables) expect(after[t], t).toBe(0);
    // Kept: the audit log (and the record of the deletion itself), and the client.
    const auditAfter = (await db.query<{ n: number }>("select count(*)::int as n from audit_log where entity_id = $1", [p.engagement])).rows[0].n;
    expect(auditAfter).toBe(auditBefore + 2);
    expect((await db.query("select 1 from audit_log where entity_id = $1 and action = 'retention_purge'", [p.engagement])).rows).toHaveLength(1);
    expect((await db.query("select 1 from clients where id = $1", [p.client])).rows).toHaveLength(1);
    // The tombstone.
    const tomb = (await db.query<{ client_name: string; counts: Record<string, number>; deletion_id: string; engagement_id: string }>("select client_name, counts, deletion_id::text, engagement_id from retention_purges where engagement_id = $1", [p.engagement])).rows;
    expect(tomb).toHaveLength(1);
    expect(tomb[0]).toMatchObject({ client_name: await clientName(p.client), deletion_id: String(r) });
    expect(tomb[0].counts.engagements).toBe(1);
    expect(tomb[0].counts.accounts).toBe(before.accounts);
    // Another engagement of the same client or firm is untouched.
    expect(await rowCounts(other.engagement)).toEqual(otherBefore);
    expect(await exists(other.engagement)).toBe(true);
    if (siblingPrior) expect((await db.query<{ prior_engagement_id: string | null }>("select prior_engagement_id from engagements where id = $1", [other.engagement])).rows[0].prior_engagement_id).toBeNull();

    // The files: listed as still to remove until the store has removed them, after the commit.
    expect((await as(partner, (tx) => getRetention(tx))).pendingFiles.map((f) => f.key).sort()).toEqual(p.keys.sort());
    expect(mem.state.removed).not.toContain(p.keys[0]);
    const res = await removePendingFiles(db, A, mem.store);
    expect(res).toEqual({ removed: 2, failed: [] });
    expect(mem.state.removed).toEqual(expect.arrayContaining(p.keys));
    for (const k of p.keys) expect(mem.files.has(k)).toBe(false);
    expect((await as(partner, (tx) => getRetention(tx))).pendingFiles).toEqual([]);
    // The purged file is on the list of deletions, and the request cannot be used again.
    expect((await as(partner, (tx) => getRetention(tx))).purged.some((x) => x.clientName === tomb[0].client_name)).toBe(true);
  }, 120_000);

  it("lists a file-store failure, keeps it on the list, and the retry clears it", async () => {
    await setYears(3);
    const p = await populated("Store Failure");
    await archive(p.engagement, 5);
    const r = await requestFor(partner, p.engagement);
    await approveFor(partner2, r, p.engagement);
    mem.state.failing = true;
    const first = await removePendingFiles(db, A, mem.store, p.keys);
    expect(first.removed).toBe(0);
    expect(first.failed.map((f) => f.key).sort()).toEqual(p.keys.sort());
    expect(first.failed[0].message).toBe("the store is unavailable");
    expect((await as(partner, (tx) => getRetention(tx))).pendingFiles.map((f) => f.key).sort()).toEqual(p.keys.sort());
    mem.state.failing = false;
    const retry = await removePendingFiles(db, A, mem.store, p.keys);
    expect(retry).toEqual({ removed: 2, failed: [] });
    expect((await as(partner, (tx) => getRetention(tx))).pendingFiles).toEqual([]);
  }, 120_000);

  it("works with the real local file store too", async () => {
    await setYears(3);
    const { mkdtempSync, existsSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const root = mkdtempSync(path.join(tmpdir(), "lf-retention-"));
    const store = localFileStore(root);
    const p = await populated("Local Store");
    for (const k of p.keys) await store.put(k, new Uint8Array([7]));
    await archive(p.engagement, 5);
    const r = await requestFor(partner, p.engagement);
    await approveFor(partner2, r, p.engagement);
    expect(existsSync(path.join(root, ...p.keys[0].split("/")))).toBe(true);
    expect(await removePendingFiles(db, A, store, p.keys)).toEqual({ removed: 2, failed: [] });
    expect(existsSync(path.join(root, ...p.keys[0].split("/")))).toBe(false);
  }, 120_000);
});

const clientName = async (clientId: string) => (await db.query<{ name: string }>("select name from clients where id = $1", [clientId])).rows[0].name;

describe("the database refuses what it should", () => {
  it("still refuses to delete an archived file directly, to unlock it and to re-date it, word for word", async () => {
    await setYears(3);
    const p = await populated("Guard Words");
    await archive(p.engagement, 5);
    const archived = /^This file is archived\. Archived files cannot be unlocked or changed\.$/;
    await expect(db.query("delete from engagements where id = $1", [p.engagement])).rejects.toThrow("This file is archived. Archived files cannot be deleted.");
    await expect(as(partner, (tx) => tx.query("delete from engagements where id = $1", [p.engagement]))).rejects.toThrow("This file is archived. Archived files cannot be deleted.");
    await expect(db.query("update engagements set status = 'open', locked_by = null, locked_at = null where id = $1", [p.engagement])).rejects.toThrow(archived);
    await expect(db.query("update engagements set archived_at = now() where id = $1", [p.engagement])).rejects.toThrow(archived);
    await expect(db.query("update engagements set archived_by = $2 where id = $1", [p.engagement, admin.userId])).rejects.toThrow(archived);
    // A forged flag from the application's own role changes nothing.
    await expect(
      as(partner, async (tx) => {
        await tx.query("select set_config('app.purge', $1, true), set_config('app.purge_deletion', '1', true)", [p.engagement]);
        await tx.query("delete from engagements where id = $1", [p.engagement]);
      }),
    ).rejects.toThrow("This file is archived. Archived files cannot be deleted.");
    expect(await exists(p.engagement)).toBe(true);
  });

  it("refuses purge_engagement without an approval, with a self-approval, with a cancelled or used approval, before the date, and for another firm", async () => {
    await setYears(3);
    const call = (s: repo.Session, e: string, r: number) => as(s, (tx) => tx.query("select purge_engagement($1, $2)", [e, r]));
    const p = await populated("Purge Refusals");
    await archive(p.engagement, 5);
    const r = await requestFor(partner, p.engagement);
    // No approval yet.
    await expect(call(partner2, p.engagement, r)).rejects.toThrow("This deletion request has not been approved.");
    // A self-approval written straight into the table (the application would never do it): the function refuses it.
    await db.query("insert into retention_deletions (firm_id, engagement_id, kind, request_id, actor_id, confirmed_name) values ($1, $2, 'approved', $3, $4, $5)", [A, p.engagement, r, partner.userId, await nameOf(p.engagement)]);
    await expect(call(partner, p.engagement, r)).rejects.toThrow("A request cannot be approved by the person who made it.");
    expect(await exists(p.engagement)).toBe(true);

    // A cancelled request.
    const c = await populated("Purge Cancelled");
    await archive(c.engagement, 5);
    const rc = await requestFor(partner, c.engagement);
    await as(partner2, (tx) => cancelDeletion(tx, partner2, rc));
    await expect(call(partner2, c.engagement, rc)).rejects.toThrow("This deletion request was cancelled.");

    // An approval whose typed name does not match, written straight into the table.
    const m = await populated("Purge Name");
    await archive(m.engagement, 5);
    const rm = await requestFor(partner, m.engagement);
    await db.query("insert into retention_deletions (firm_id, engagement_id, kind, request_id, actor_id, confirmed_name) values ($1, $2, 'approved', $3, $4, 'Some Other Name')", [A, m.engagement, rm, partner2.userId]);
    await expect(call(partner2, m.engagement, rm)).rejects.toThrow("The client's name typed at approval does not match.");

    // Before the retention date: raise the period after the approval.
    const d = await populated("Purge Early");
    await archive(d.engagement, 5);
    const rd = await requestFor(partner, d.engagement);
    await db.query("insert into retention_deletions (firm_id, engagement_id, kind, request_id, actor_id, confirmed_name) values ($1, $2, 'approved', $3, $4, $5)", [A, d.engagement, rd, partner2.userId, await nameOf(d.engagement)]);
    await setYears(20);
    await expect(call(partner2, d.engagement, rd)).rejects.toThrow("This file is not yet past the firm's retention period.");
    await setYears(null);
    await expect(call(partner2, d.engagement, rd)).rejects.toThrow("The firm has not set a retention period, so nothing can be deleted.");
    await setYears(3);

    // An approver who is not partner-level any more.
    await db.query("update users set role = 'preparer' where id = $1", [partner2.userId]);
    await expect(call(partner, d.engagement, rd)).rejects.toThrow("The approval is not from an active partner-level person.");
    await db.query("update users set role = 'partner' where id = $1", [partner2.userId]);

    // A used approval: purge it properly, then try again.
    const u = await populated("Purge Used");
    await archive(u.engagement, 5);
    const ru = await requestFor(partner, u.engagement);
    await approveFor(partner2, ru, u.engagement);
    await expect(call(partner2, u.engagement, ru)).rejects.toThrow("Engagement not found.");
    // The tombstone's deletion cannot be reused for another engagement either.
    await expect(call(partner2, p.engagement, ru)).rejects.toThrow("There is no such deletion request for this file.");

    // Another firm: its transaction cannot see or delete this firm's file, whatever it passes.
    const w = await populated("Purge Other Firm");
    await archive(w.engagement, 5);
    const rw = await requestFor(partner, w.engagement);
    await approveFor(partner2, rw, w.engagement).catch(() => undefined);
    await expect(call(outsider, d.engagement, rd)).rejects.toThrow("Engagement not found.");
    // An open or merely locked engagement.
    const o = await populated("Purge Not Archived");
    await expect(call(partner2, o.engagement, rd)).rejects.toThrow(/no such deletion request|Only an archived file/);
    expect(await exists(o.engagement)).toBe(true);
    expect(await exists(d.engagement)).toBe(true);
  }, 120_000);
});
