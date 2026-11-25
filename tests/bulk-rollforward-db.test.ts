import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import { listRollForward, mayRollForward, rollForward, RollForwardError, type RollItem } from "../src/server/rollforward";
import { MAX_ROLL_FORWARD } from "../src/domain/bulk-rollforward";
import { ENGAGEMENT_REFUSAL } from "../src/domain/permissions";

const TODAY = "2026-03-01";
const A = "aaaaaaaa-8181-4000-8000-000000000001";
const B = "bbbbbbbb-8181-4000-8000-000000000001";
const user = (firm: string, n: number, role: repo.Session["role"]): repo.Session => ({ firmId: firm, userId: `${firm.slice(0, 8)}-8181-4000-8000-00000000006${n}`, role });
const partner = user(A, 1, "partner");
const admin = user(A, 2, "admin");
const reviewer = user(A, 3, "reviewer");
const preparer = user(A, 4, "preparer");
const outsider = user(B, 1, "partner");

let db: Db;
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: { firmId: string }, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
const roll = (s: repo.Session, items: RollItem[]) => as(s, (tx) => rollForward(tx, s, items, TODAY));
const rows = () => as(partner, (tx) => listRollForward(tx, A, TODAY));
const rowOf = async (name: string) => (await rows()).find((r) => r.clientName === name)!;
const count = async (clientId: string) => (await db.query<{ n: number }>("select count(*)::int as n from engagements where client_id = $1", [clientId])).rows[0].n;

/** A client with one ended engagement; the audit on when asked. */
async function client(name: string, start: string, end: string, auditOn = false, extra: [string, string][] = []): Promise<{ clientId: string; engagementId: string }> {
  return as(partner, async (tx) => {
    const clientId = await repo.createClient(tx, partner, name);
    const engagementId = await repo.createEngagement(tx, partner, clientId, start, end);
    for (const [s, e] of extra) await repo.createEngagement(tx, partner, clientId, s, e);
    if (auditOn) await audit.setAuditEnabled(tx, partner, engagementId, true);
    return { clientId, engagementId };
  });
}

let cal: { clientId: string; engagementId: string };
let march: { clientId: string; engagementId: string };
let short: { clientId: string; engagementId: string };
let theirs: { clientId: string; engagementId: string };

beforeAll(async () => {
  db = await openDatabase();
  for (const f of [A, B]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [f]);
  for (const u of [partner, admin, reviewer, preparer, outsider]) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} user`, u.role]);
  cal = await client("Calendar Year LLC", "2025-01-01", "2025-12-31", true);
  march = await client("March Year-End LLC", "2024-04-01", "2025-03-31");
  await db.query("update engagements set status = 'locked', locked_by = $2, locked_at = now() where id = $1", [march.engagementId, partner.userId]);
  await client("February LLC", "2023-03-01", "2024-02-29");
  short = await client("Short First Period LLC", "2025-06-01", "2025-12-31");
  await client("Done Already LLC", "2024-01-01", "2024-12-31", false, [["2025-01-01", "2025-12-31"]]);
  theirs = await as(outsider, async (tx) => {
    const clientId = await repo.createClient(tx, outsider, "Other Firm Client");
    return { clientId, engagementId: await repo.createEngagement(tx, outsider, clientId, "2025-01-01", "2025-12-31") };
  });
});

afterAll(async () => {
  await db.close();
});

describe("who may roll forward", () => {
  it("lets a partner, an administrator and a reviewer, and not a preparer, reading the role from the database", async () => {
    for (const s of [partner, admin, reviewer]) expect(await as(s, (tx) => mayRollForward(tx, s)), s.role).toBe(true);
    expect(await as(preparer, (tx) => mayRollForward(tx, preparer))).toBe(false);
    // A session that claims a better role is not believed.
    expect(await as(preparer, (tx) => mayRollForward(tx, { ...preparer, role: "partner" }))).toBe(false);
    await expect(roll({ ...preparer, role: "partner" }, [{ clientId: short.clientId, start: "2026-01-01", end: "2026-12-31" }])).rejects.toThrow(ENGAGEMENT_REFUSAL);
    expect(await count(short.clientId)).toBe(1);
  });
});

describe("the list and the proposed periods", () => {
  it("proposes the year after, for a calendar year, a 31 March year-end and a first period that was not twelve months", async () => {
    expect((await rowOf("Calendar Year LLC")).proposed).toEqual({ start: "2026-01-01", end: "2026-12-31" });
    expect((await rowOf("March Year-End LLC")).proposed).toEqual({ start: "2025-04-01", end: "2026-03-31" });
    expect((await rowOf("Short First Period LLC")).proposed).toEqual({ start: "2026-01-01", end: "2026-12-31" });
  });
  it("keeps a month-end on the month-end across a leap year", async () => {
    expect((await rowOf("February LLC")).proposed).toEqual({ start: "2024-03-01", end: "2025-02-28" });
  });
  it("shows the status in words and the audit setting, and one row per client", async () => {
    const all = await rows();
    expect(all.filter((r) => r.clientName === "Calendar Year LLC")).toHaveLength(1);
    expect(await rowOf("March Year-End LLC")).toMatchObject({ status: "Locked", auditEnabled: false });
    expect(await rowOf("Calendar Year LLC")).toMatchObject({ status: "Open", auditEnabled: true });
  });
  it("marks a client whose next year already exists, and never lists another firm's clients", async () => {
    const all = await rows();
    expect(all.find((r) => r.clientName === "Done Already LLC")).toMatchObject({ rolledForward: false, periodEnd: "2025-12-31" });
    expect(all.some((r) => r.clientName === "Other Firm Client")).toBe(false);
  });
});

describe("creating", () => {
  it("links each new engagement to last year's file, copies the audit setting and nothing else, and logs it", async () => {
    const created = await roll(partner, [
      { clientId: cal.clientId, start: "2026-01-01", end: "2026-12-31" },
      { clientId: march.clientId, start: "2025-04-01", end: "2026-03-31" },
    ]);
    expect(created.map((c) => c.clientName)).toEqual(["Calendar Year LLC", "March Year-End LLC"]);
    const e = async (id: string) => (await db.query<{ prior: string; audit: boolean; status: string; tb: number; proc: number; bc: number }>(
      `select prior_engagement_id as prior, audit_enabled as audit, status,
              (select count(*)::int from accounts where engagement_id = e.id) as tb,
              (select count(*)::int from audit_procedures where engagement_id = e.id) as proc,
              borrowings_current_minor::float8 as bc
       from engagements e where id = $1`, [id])).rows[0];
    expect(await e(created[0].engagementId)).toMatchObject({ prior: cal.engagementId, audit: true, status: "open", tb: 0, bc: 0 });
    expect(await e(created[1].engagementId)).toMatchObject({ prior: march.engagementId, audit: false, status: "open", tb: 0, proc: 0 });
    // The audit on is turned on the usual way, so its checklist steps are there; no requests, confirmations, schedules or materiality are.
    expect((await e(created[0].engagementId)).proc).toBeGreaterThan(0);
    for (const t of ["client_requests", "confirmations", "test_schedules", "materiality"]) {
      expect((await db.query<{ n: number }>(`select count(*)::int as n from ${t} where engagement_id = $1`, [created[0].engagementId])).rows[0].n, t).toBe(0);
    }
    const log = await db.query<{ action: string; entity: string; entity_id: string; detail: Record<string, unknown> }>("select action, entity, entity_id, detail from audit_log where firm_id = $1 and action in ('create', 'bulk_rollforward') and (entity_id = any($2) or action = 'bulk_rollforward') order by id", [A, created.map((c) => c.engagementId)]);
    const creates = log.rows.filter((r) => r.action === "create");
    expect(creates).toHaveLength(2);
    expect(creates.every((r) => r.detail.bulk === true && r.entity === "engagement")).toBe(true);
    const bulk = log.rows.filter((r) => r.action === "bulk_rollforward");
    expect(bulk).toHaveLength(1);
    expect(bulk[0]).toMatchObject({ entity: "firm", entity_id: A });
    expect(bulk[0].detail).toEqual({ count: 2, clientIds: [cal.clientId, march.clientId] });
  });

  it("no longer offers a client already rolled forward, and refuses it even if posted", async () => {
    expect((await rowOf("Calendar Year LLC")).rolledForward).toBe(true);
    const before = await count(cal.clientId);
    await expect(roll(partner, [{ clientId: cal.clientId, start: "2027-01-01", end: "2027-12-31" }])).rejects.toThrow(/Nothing was created/);
    expect(await count(cal.clientId)).toBe(before);
  });

  it("carries the mappings when a trial balance is imported on the new engagement", async () => {
    const c = await client("Carry Mapping LLC", "2025-01-01", "2025-12-31");
    const TB = [{ code: "9999", name: "Sundry balance", closingMinor: 100, priorMinor: 0 }, { code: "9998", name: "Sundry other", closingMinor: -100, priorMinor: 0 }];
    await as(partner, async (tx) => {
      await repo.importTrialBalance(tx, partner, c.engagementId, "ly.xlsx", TB);
      const accounts = await repo.listAccounts(tx, c.engagementId);
      await repo.setMapping(tx, partner, accounts.find((a) => a.code === "9999")!.id, "TRADEREC");
      await repo.approveAllMappings(tx, partner, c.engagementId);
    });
    const [made] = await roll(partner, [{ clientId: c.clientId, start: "2026-01-01", end: "2026-12-31" }]);
    expect(await as(partner, (tx) => repo.listAccounts(tx, made.engagementId))).toHaveLength(0);
    await as(partner, (tx) => repo.importTrialBalance(tx, partner, made.engagementId, "ty.xlsx", TB));
    const mapped = await as(partner, (tx) => repo.listAccounts(tx, made.engagementId));
    expect(mapped.find((a) => a.code === "9999")?.groupCode).toBe("TRADEREC");
    // It is the link that did it: the mapping arrives approved, from last year, not as an assistant suggestion.
    const m = await db.query<{ source: string; approved: boolean }>("select m.source, m.approved from mappings m join accounts a on a.id = m.account_id where a.engagement_id = $1 and a.code = '9999'", [made.engagementId]);
    expect(m.rows[0]).toEqual({ source: "prior_year", approved: true });
  });
});

describe("all or none", () => {
  it("creates nothing when one row is refused, and names the client and why for every refused row", async () => {
    const a = await client("All None A LLC", "2025-01-01", "2025-12-31");
    const b = await client("All None B LLC", "2025-01-01", "2025-12-31");
    const before = [await count(a.clientId), await count(b.clientId)];
    const err = await roll(partner, [
      { clientId: a.clientId, start: "2026-01-01", end: "2026-12-31" },
      { clientId: b.clientId, start: "2026-12-31", end: "2026-01-01" },
    ]).catch((e) => e);
    expect(err).toBeInstanceOf(RollForwardError);
    expect(err.message).toMatch(/^Nothing was created\. One client could not be rolled forward\.$/);
    expect(err.problems).toEqual([{ clientId: b.clientId, clientName: "All None B LLC", message: "The period end must be after the period start." }]);
    expect([await count(a.clientId), await count(b.clientId)]).toEqual(before);
    const bulk = await db.query("select 1 from audit_log where action = 'bulk_rollforward' and detail->'clientIds' ? $1", [a.clientId]);
    expect(bulk.rows).toHaveLength(0);
  });
  it("refuses bad dates, a client chosen twice, and an id that is not a client", async () => {
    const a = await client("Bad Rows LLC", "2025-01-01", "2025-12-31");
    const err = await roll(partner, [
      { clientId: a.clientId, start: "2026-02-31", end: "2026-12-31" },
      { clientId: a.clientId, start: "2026-01-01", end: "2026-12-31" },
      { clientId: "not-an-id", start: "2026-01-01", end: "2026-12-31" },
    ]).catch((e) => e);
    expect(err.problems.map((p: { message: string }) => p.message)).toEqual(["Enter both dates as real dates.", "This client was chosen twice.", "This is not one of the firm's clients with an engagement to roll forward."]);
    expect(await count(a.clientId)).toBe(1);
  });
  it("refuses another firm's client even when its id is posted", async () => {
    const err = await roll(partner, [{ clientId: theirs.clientId, start: "2026-01-01", end: "2026-12-31" }]).catch((e) => e);
    expect(err.problems[0].message).toMatch(/not one of the firm's clients/);
    expect(await count(theirs.clientId)).toBe(1);
  });
  it("refuses nothing chosen and more than 200, and creates nothing", async () => {
    await expect(roll(partner, [])).rejects.toThrow("Choose at least one client");
    const many = Array.from({ length: MAX_ROLL_FORWARD + 1 }, () => ({ clientId: short.clientId, start: "2026-01-01", end: "2026-12-31" }));
    await expect(roll(partner, many)).rejects.toThrow(`at most ${MAX_ROLL_FORWARD}`);
    expect(await count(short.clientId)).toBe(1);
  });
  it("accepts 200 and creates all of them in one go", async () => {
    const ids: RollItem[] = [];
    await as(partner, async (tx) => {
      for (let i = 0; i < MAX_ROLL_FORWARD; i++) {
        const c = await repo.createClient(tx, partner, `Cap Client ${i} LLC`);
        await repo.createEngagement(tx, partner, c, "2025-01-01", "2025-12-31");
        ids.push({ clientId: c, start: "2026-01-01", end: "2026-12-31" });
      }
    });
    expect(await roll(partner, ids)).toHaveLength(MAX_ROLL_FORWARD);
  });
});

describe("overlap", () => {
  it("is refused on a bulk roll-forward, naming the period it overlaps", async () => {
    const c = await client("Overlap Bulk LLC", "2025-01-01", "2025-12-31");
    // Another engagement of the client that runs into the proposed year without starting after last year ended.
    await db.query("insert into engagements (firm_id, client_id, period_start, period_end) values ($1, $2, '2025-07-01', '2026-06-30')", [A, c.clientId]);
    const err = await roll(partner, [{ clientId: c.clientId, start: "2026-01-01", end: "2026-12-31" }]).catch((e) => e);
    expect(err).toBeInstanceOf(RollForwardError);
    expect(err.problems[0].message).toBe("2026-01-01 to 2026-12-31 overlaps an existing engagement of Overlap Bulk LLC (2025-07-01 to 2026-06-30).");
    expect(await count(c.clientId)).toBe(2);
  });
  it("is refused on a single creation too, with both ends counting", async () => {
    const c = await client("Overlap Single LLC", "2025-01-01", "2025-12-31");
    const make = (start: string, end: string) => as(partner, (tx) => repo.createEngagement(tx, partner, c.clientId, start, end));
    await expect(make("2025-06-01", "2026-05-31")).rejects.toThrow("overlaps an existing engagement of Overlap Single LLC (2025-01-01 to 2025-12-31)");
    await expect(make("2025-12-31", "2026-12-30")).rejects.toThrow(/overlaps/);
    await expect(make("2024-01-01", "2025-01-01")).rejects.toThrow(/overlaps/);
    await expect(make("2026-01-01", "2026-12-31")).resolves.toBeDefined();
    await expect(make("2024-01-01", "2024-12-31")).resolves.toBeDefined();
  });
  it("holds the firm lock, so two roll-forwards of the same client cannot both create it", async () => {
    const c = await client("Race LLC", "2025-01-01", "2025-12-31");
    const item = { clientId: c.clientId, start: "2026-01-01", end: "2026-12-31" };
    const results = await Promise.allSettled([roll(partner, [item]), roll(admin, [item])]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await count(c.clientId)).toBe(2);
  });
});
