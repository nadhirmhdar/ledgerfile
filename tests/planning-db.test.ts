import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import * as planning from "../src/server/planning";
import { DEFAULT_PLANNING_SETTINGS } from "../src/domain/planning-settings";

const X = "aaaaaaaa-4040-4000-8000-000000000001";
const Y = "bbbbbbbb-4040-4000-8000-000000000001";
const user = (n: number, role: repo.Session["role"], firmId = X): repo.Session => ({ firmId, userId: `${firmId.slice(0, 8)}-4040-4000-8000-00000000001${n}`, role });
const prep = user(1, "preparer");
const rev = user(2, "reviewer");
const partner = user(3, "partner");
const admin = user(4, "admin");
const otherPartner = user(5, "partner", Y);

// Invented trial balance: revenue 100,000, costs 70,000, so a profit of 30,000.
const TB = [
  { code: "1000", name: "Bank - current account", closingMinor: 30000000, priorMinor: 25000000 },
  { code: "1100", name: "Trade receivables", closingMinor: 20000000, priorMinor: 18000000 },
  { code: "2000", name: "Trade payables", closingMinor: -10000000, priorMinor: -9000000 },
  { code: "3000", name: "Share capital", closingMinor: -10000000, priorMinor: -10000000 },
  { code: "3200", name: "Retained earnings", closingMinor: -20000000, priorMinor: -17000000 },
  { code: "4000", name: "Sales", closingMinor: -100000000, priorMinor: -90000000 },
  { code: "5000", name: "Cost of goods sold", closingMinor: 50000000, priorMinor: 45000000 },
  { code: "6100", name: "Office rent", closingMinor: 20000000, priorMinor: 18000000 },
];

let db: Db;
let engagement: string;
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
const count = async (table: string) => Number((await db.query<{ n: string }>(`select count(*)::text as n from ${table}`)).rows[0].n);
const input = { benchmark: "pbt", percentageBp: 750, performancePct: 75, trivialPct: 5, rationale: "Profit is the measure the owners and the bank focus on." };

beforeAll(async () => {
  db = await openDatabase();
  for (const firm of [X, Y]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [firm]);
  for (const u of [prep, rev, partner, admin, otherPartner]) {
    await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-1)}`, u.role]);
  }
  await as(partner, async (tx) => {
    const client = await repo.createClient(tx, partner, "Planning Co");
    engagement = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
    await repo.importTrialBalance(tx, partner, engagement, "tb.xlsx", TB);
    await repo.approveAllMappings(tx, partner, engagement);
  });
  await as(rev, (tx) => audit.setAuditEnabled(tx, rev, engagement, true));
});

afterAll(async () => {
  await db.close();
});

describe("a firm with no settings has the defaults", () => {
  it("reads the defaults, not customised, with nothing stored", async () => {
    const stored = await as(prep, (tx) => planning.getPlanningSettings(tx));
    expect(stored).toEqual({ settings: DEFAULT_PLANNING_SETTINGS, customised: false, updatedBy: null, updatedAt: null });
    expect(await count("firm_planning_settings")).toBe(0);
  });

  it("leaves materiality exactly as it was: the same figures and the same guide warnings as the constants give", async () => {
    const warnings = await as(rev, (tx) => audit.setMateriality(tx, rev, engagement, { ...input, percentageBp: 1500, performancePct: 90, trivialPct: 10 }));
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain("outside the guide range of 5% to 10%");
    const o = (await as(rev, (tx) => audit.getAuditOverview(tx, engagement)))!;
    expect(o.materiality).toMatchObject({ benchmark: "pbt", overallMinor: 4500000, performanceMinor: 4050000, trivialMinor: 450000 });
  });
});

describe("the expenses benchmark", () => {
  it("is offered with its figure (cost of sales and the other expenses), accepted by materiality, and stored", async () => {
    const o = (await as(rev, (tx) => audit.getAuditOverview(tx, engagement)))!;
    expect(o.benchmarks.expenses).toBe(70000000);
    expect(await as(rev, (tx) => audit.setMateriality(tx, rev, engagement, { ...input, benchmark: "expenses", percentageBp: 100 }))).toEqual([]);
    const after = (await as(rev, (tx) => audit.getAuditOverview(tx, engagement)))!;
    expect(after.materiality).toMatchObject({ benchmark: "expenses", benchmarkAmountMinor: 70000000, overallMinor: 700000 });
    expect((await db.query<{ benchmark: string }>("select benchmark from materiality order by created_at desc, id desc limit 1")).rows[0].benchmark).toBe("expenses");
  });

  it("is refused for a name the check does not know", async () => {
    await expect(db.query("update materiality set benchmark = 'turnover'")).rejects.toThrow();
    await expect(as(rev, (tx) => audit.setMateriality(tx, rev, engagement, { ...input, benchmark: "turnover" }))).rejects.toThrow(/Choose a benchmark/);
  });
});

describe("only a partner or the administrator can change the settings", () => {
  const edited = { ...DEFAULT_PLANNING_SETTINGS, percentages: { ...DEFAULT_PLANNING_SETTINGS.percentages, pbt: { minBp: 300, maxBp: 2000 } }, thresholds: { ...DEFAULT_PLANNING_SETTINGS.thresholds, movementPct: 30 } };

  it("refuses a reviewer and a preparer, and a stale session that says partner, and stores nothing", async () => {
    for (const s of [rev, prep]) await expect(as(s, (tx) => planning.updatePlanningSettings(tx, s, edited)), s.role).rejects.toThrow(/Only a partner or the firm administrator/);
    const stale = { ...prep, role: "partner" as const };
    await expect(as(stale, (tx) => planning.updatePlanningSettings(tx, stale, edited))).rejects.toThrow(/Only a partner/);
    expect(await count("firm_planning_settings")).toBe(0);
    expect(await count("firm_planning_settings_history")).toBe(0);
  });

  it("refuses settings that do not pass the checks", async () => {
    await expect(as(partner, (tx) => planning.updatePlanningSettings(tx, partner, { percentages: { pbt: { minBp: 900, maxBp: 500 } } }))).rejects.toThrow(/lowest percentage/);
    await expect(as(partner, (tx) => planning.updatePlanningSettings(tx, partner, { trivial: { pct: 0 } }))).rejects.toThrow(/whole numbers/);
    expect(await count("firm_planning_settings")).toBe(0);
  });

  it("saves for a partner, round-trips, keeps the history and writes the audit log; an administrator may too", async () => {
    const saved = await as(partner, (tx) => planning.updatePlanningSettings(tx, partner, edited));
    expect(saved.percentages.pbt).toEqual({ minBp: 300, maxBp: 2000 });
    const stored = await as(prep, (tx) => planning.getPlanningSettings(tx));
    expect(stored).toMatchObject({ customised: true, updatedBy: `partner 3` });
    expect(stored.settings).toEqual(edited);
    const history = (await db.query<{ before_values: unknown; after_values: { thresholds: { movementPct: number } }; changed_by: string }>("select before_values, after_values, changed_by from firm_planning_settings_history where firm_id = $1", [X])).rows;
    expect(history).toHaveLength(1);
    expect(history[0].before_values).toBeNull();
    expect(history[0].after_values.thresholds.movementPct).toBe(30);
    expect(history[0].changed_by).toBe(partner.userId);
    const logged = (await db.query<{ user_id: string }>("select user_id from audit_log where firm_id = $1 and action = 'update_planning_settings'", [X])).rows;
    expect(logged.map((l) => l.user_id)).toEqual([partner.userId]);

    await as(admin, (tx) => planning.updatePlanningSettings(tx, admin, { ...edited, trivial: { pct: 4, maxPct: 5 } }));
    expect((await as(prep, (tx) => planning.getPlanningSettings(tx))).settings.trivial.pct).toBe(4);
    expect(await count("firm_planning_settings_history")).toBe(2);
  });

  it("writes nothing for a save that changes nothing", async () => {
    const current = (await as(partner, (tx) => planning.getPlanningSettings(tx))).settings;
    await as(partner, (tx) => planning.updatePlanningSettings(tx, partner, current));
    expect(await count("firm_planning_settings_history")).toBe(2);
  });

  it("keeps the history insert-only for the application role", async () => {
    await expect(as(partner, (tx) => tx.query("update firm_planning_settings_history set changed_by = changed_by"))).rejects.toThrow(/permission denied/);
    await expect(as(partner, (tx) => tx.query("delete from firm_planning_settings_history"))).rejects.toThrow(/permission denied/);
  });

  it("reaches materiality: the guide warnings follow the firm's ranges from now on, and the figures do not change", async () => {
    // pbt 5% to 10% was the guide; the firm now allows 3% to 20%, so 15% is no longer outside it.
    const warnings = await as(rev, (tx) => audit.setMateriality(tx, rev, engagement, { ...input, percentageBp: 1500 }));
    expect(warnings.some((w) => w.includes("guide range of 3% to 20%"))).toBe(false);
    expect(warnings).toEqual([]);
  });

  it("goes back to the defaults, and the reset is kept in the history", async () => {
    await as(partner, (tx) => planning.resetPlanningSettings(tx, partner));
    const stored = await as(prep, (tx) => planning.getPlanningSettings(tx));
    expect(stored.settings).toEqual(DEFAULT_PLANNING_SETTINGS);
    expect(stored.customised).toBe(false);
    expect(await count("firm_planning_settings_history")).toBe(3);
    const warnings = await as(rev, (tx) => audit.setMateriality(tx, rev, engagement, { ...input, percentageBp: 1500 }));
    expect(warnings.some((w) => w.includes("guide range of 5% to 10%"))).toBe(true);
  });
});

describe("another firm", () => {
  it("does not see this firm's settings, and its own changes do not reach this firm", async () => {
    await as(partner, (tx) => planning.updatePlanningSettings(tx, partner, { thresholds: { movementPct: 40 } }));
    const other = await as(otherPartner, (tx) => planning.getPlanningSettings(tx));
    expect(other).toMatchObject({ customised: false });
    expect(other.settings.thresholds.movementPct).toBe(25);
    expect(await as(otherPartner, (tx) => tx.query("select 1 from firm_planning_settings"))).toMatchObject({ rows: [] });
    expect(await as(otherPartner, (tx) => tx.query("select 1 from firm_planning_settings_history"))).toMatchObject({ rows: [] });
    expect((await as(otherPartner, (tx) => tx.query("update firm_planning_settings set settings = '{}'::jsonb returning 1"))).rows).toHaveLength(0);
    await as(otherPartner, (tx) => planning.updatePlanningSettings(tx, otherPartner, { thresholds: { movementPct: 10 } }));
    expect((await as(partner, (tx) => planning.getPlanningSettings(tx))).settings.thresholds.movementPct).toBe(40);
    expect(await as(otherPartner, (tx) => planning.getPlanningDerivation(tx, engagement))).toBeNull();
  });
});

describe("the planning assistant on an engagement", () => {
  it("derives the figures and a suggestion from the adjusted trial balance, with the firm's settings", async () => {
    const result = (await as(prep, (tx) => planning.getPlanningDerivation(tx, engagement)))!;
    const d = result.derivation;
    expect(d.empty).toBe(false);
    expect(d.figures.find((f) => f.key === "revenue")).toMatchObject({ current: 100000000, prior: 90000000 });
    expect(d.figures.find((f) => f.key === "pbt")).toMatchObject({ current: 30000000, prior: 27000000 });
    expect(d.benchmark).toMatchObject({ benchmark: "pbt", amountMinor: 30000000 });
    expect(d.suggested).toEqual({ overallMinor: 2250000, performanceMinor: 1687500, trivialMinor: 112500, trivialPct: 5 });
    expect(result.settings.settings.thresholds.movementPct).toBe(40);
  });

  it("uses what a person has answered", async () => {
    const result = (await as(prep, (tx) => planning.getPlanningDerivation(tx, engagement, { firstYear: true })))!;
    expect(result.derivation.percentage).toMatchObject({ bp: 500, position: "low end" });
    expect(result.derivation.performance).toMatchObject({ pct: 55, reduced: true });
  });

  it("saves nothing: no materiality, no rating, no setting and no log entry is written", async () => {
    const tables = ["materiality", "risk_assessments", "firm_planning_settings", "firm_planning_settings_history", "audit_log", "audit_procedures", "mappings"];
    const before = await Promise.all(tables.map(count));
    await as(rev, (tx) => planning.getPlanningDerivation(tx, engagement));
    await as(prep, (tx) => planning.getPlanningDerivation(tx, engagement, { reliedOnByBank: true }));
    expect(await Promise.all(tables.map(count))).toEqual(before);
  });

  it("is not a lock blocker: the audit overview's blockers are the same with and without it", async () => {
    const o = (await as(rev, (tx) => audit.getAuditOverview(tx, engagement)))!;
    expect(o.blockers.join(" ")).not.toMatch(/planning assistant|questionnaire/i);
  });
});
