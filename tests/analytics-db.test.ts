import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import * as analytics from "../src/server/analytics";

// Invented figures, in fils.
const TB = [
  { code: "1000", name: "Bank - current account", closingMinor: 50_000_000, priorMinor: 20_000_000 },
  { code: "1100", name: "Trade receivables", closingMinor: 20_000_000, priorMinor: 19_900_000 },
  { code: "3000", name: "Share capital", closingMinor: -10_000_000, priorMinor: -10_000_000 },
  { code: "4000", name: "Sales", closingMinor: -100_000_000, priorMinor: -60_000_000 },
  { code: "6100", name: "Office rent", closingMinor: 40_000_000, priorMinor: 30_100_000 },
];
// Overall 1,000,000; performance 750,000; trivial 50,000.
const materiality = { benchmark: "revenue", percentageBp: 100, performancePct: 75, trivialPct: 5, rationale: "Revenue is the measure the owners watch." };
const FLAGGED = ["ADMIN", "CASH", "REVENUE"];

describe("analytical review", () => {
  const FIRM = "aaaaaaaa-9999-4000-8000-000000000001";
  const OTHER = "bbbbbbbb-9999-4000-8000-000000000001";
  const user = (n: number, role: repo.Session["role"], firmId = FIRM): repo.Session => ({ firmId, userId: `${firmId.slice(0, 8)}-9999-4000-8000-00000000001${n}`, role });
  const prep = user(1, "preparer");
  const rev = user(2, "reviewer");
  const partner = user(4, "partner");
  const outsider = user(3, "partner", OTHER);
  let db: PGlite;
  let engagement: string;
  type T = Parameters<Parameters<typeof withFirm>[2]>[0];
  const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
  const data = async () => (await as(prep, (tx) => analytics.getAnalytics(tx, engagement)))!;
  const blocker = async () => (await as(prep, (tx) => audit.getAuditOverview(tx, engagement)))!.blockers.find((b) => b.includes("analytical review"));
  const explain = (s: repo.Session, key: string, text = "Agreed to the bank statements and the sales ledger.") => as(s, (tx) => analytics.saveExplanation(tx, s, engagement, key, text));
  const newEngagement = (tb: typeof TB, auditOn: boolean) =>
    as(partner, async (tx) => {
      const client = await repo.createClient(tx, partner, `Analytics Co ${Math.random().toString(36).slice(2, 7)}`);
      const id = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
      await repo.importTrialBalance(tx, partner, id, "tb.xlsx", tb);
      await repo.approveAllMappings(tx, partner, id);
      if (auditOn) await audit.setAuditEnabled(tx, partner, id, true);
      return id;
    });

  beforeAll(async () => {
    db = await openDatabase();
    for (const firm of [FIRM, OTHER]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [firm]);
    for (const u of [prep, rev, partner, outsider]) {
      await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-1)}`, u.role]);
    }
    engagement = await newEngagement(TB, true);
  });

  it("flags nothing until materiality is set, and says so through no blocker", async () => {
    const d = await data();
    expect(d).toMatchObject({ thresholds: null, hasComparatives: true, editable: true, unexplained: 0 });
    expect(d.rows.some((r) => r.flag)).toBe(false);
    expect(await blocker()).toBeUndefined();
    await expect(explain(prep, "CASH")).rejects.toThrow(/does not need an explanation/);
  });

  it("flags the large movements once materiality is set, and holds up the lock for them", async () => {
    await as(rev, (tx) => audit.setMateriality(tx, rev, engagement, materiality));
    const d = await data();
    expect(d.rows.filter((r) => r.flag).map((r) => r.key).sort()).toEqual(FLAGGED);
    expect(d.unexplained).toBe(3);
    expect(await blocker()).toBe("Audit: 3 significant movement(s) in the analytical review have no explanation.");
    expect(d.ratios.find((r) => r.key === "WORKCAP")!.current).not.toBeNull();
  });

  it("takes an explanation from any role, only for a flagged line, and counts it", async () => {
    await expect(explain(prep, "CASH", "too short")).rejects.toThrow(/Explain the movement/);
    await expect(explain(prep, "TRADEREC")).rejects.toThrow(/does not need an explanation/);
    await expect(explain(prep, "NOPE")).rejects.toThrow(/does not need an explanation/);
    await explain(prep, "CASH");
    const cash = (await data()).rows.find((r) => r.key === "CASH")!;
    expect(cash.explanation).toMatchObject({ text: "Agreed to the bank statements and the sales ledger.", writtenByName: "preparer 1", stale: false });
    expect(await blocker()).toContain("2 significant");
  });

  it("clears the blocker once every flagged line is explained, and an edit replaces the explanation", async () => {
    await explain(rev, "REVENUE", "Two new contracts won in the year, agreed to signed contracts.");
    await explain(rev, "ADMIN", "Rent increased on renewal, agreed to the new lease.");
    expect(await blocker()).toBeUndefined();
    await explain(rev, "ADMIN", "Rent increased on renewal; checked to the lease and payments.");
    expect((await data()).rows.find((r) => r.key === "ADMIN")!.explanation!.text).toContain("checked to the lease");
    const stored = await db.query("select count(*)::int as n from analytical_explanations where engagement_id = $1", [engagement]);
    expect((stored.rows[0] as { n: number }).n).toBe(3);
  });

  it("marks an explanation as needing re-confirmation when the figures change, and the lock is held up again", async () => {
    await db.query("update accounts set closing_minor = -110000000 where engagement_id = $1 and code = '4000'", [engagement]);
    const revenue = (await data()).rows.find((r) => r.key === "REVENUE")!;
    expect(revenue.current).toBe(110_000_000);
    expect(revenue.explanation).toMatchObject({ stale: true });
    expect((await data()).unexplained).toBe(1);
    expect(await blocker()).toContain("1 significant");
    await expect(as(rev, (tx) => analytics.reconfirmExplanation(tx, rev, engagement, "CASH"))).rejects.toThrow(/already matches/);
    await expect(as(rev, (tx) => analytics.reconfirmExplanation(tx, rev, engagement, "TRADEREC"))).rejects.toThrow(/does not need/);

    await as(prep, (tx) => analytics.reconfirmExplanation(tx, prep, engagement, "REVENUE"));
    expect((await data()).rows.find((r) => r.key === "REVENUE")!.explanation).toMatchObject({ stale: false, writtenByName: "preparer 1" });
    expect(await blocker()).toBeUndefined();

    // A rewrite also settles it.
    await db.query("update accounts set closing_minor = -120000000 where engagement_id = $1 and code = '4000'", [engagement]);
    expect(await blocker()).toContain("1 significant");
    await explain(rev, "REVENUE", "Further growth from the new contracts, agreed to invoices.");
    expect(await blocker()).toBeUndefined();
  });

  it("logs every write", async () => {
    const rows = await db.query("select action from audit_log where entity_id = $1 and action like 'analytical_%'", [engagement]);
    const actions = new Set(rows.rows.map((r) => (r as { action: string }).action));
    expect(actions).toEqual(new Set(["analytical_explain", "analytical_reconfirm"]));
  });

  it("is invisible to, and cannot be written by, another firm", async () => {
    expect(await as(outsider, (tx) => analytics.getAnalytics(tx, engagement))).toBeNull();
    await expect(as(outsider, (tx) => analytics.saveExplanation(tx, outsider, engagement, "CASH", "Trying to write into another firm."))).rejects.toThrow(/not found/);
    await expect(as(outsider, (tx) => analytics.reconfirmExplanation(tx, outsider, engagement, "REVENUE"))).rejects.toThrow(/not found/);
  });

  it("cannot be written when the audit is off", async () => {
    const off = await newEngagement(TB, false);
    await as(rev, (tx) => audit.setAuditEnabled(tx, rev, off, true));
    await as(rev, (tx) => audit.setMateriality(tx, rev, off, materiality));
    await as(rev, (tx) => audit.setAuditEnabled(tx, rev, off, false));
    const d = (await as(prep, (tx) => analytics.getAnalytics(tx, off)))!;
    expect(d).toMatchObject({ auditOn: false, editable: false });
    await expect(as(prep, (tx) => analytics.saveExplanation(tx, prep, off, "CASH", "Written while the audit is off."))).rejects.toThrow(/Turn the audit on/);
    // And with the audit off, nothing holds up the lock.
    expect((await as(prep, (tx) => audit.getAuditOverview(tx, off)))!.blockers).toEqual([]);
  });

  it("has nothing to flag, and says nothing blocks, without a prior year", async () => {
    const single = await newEngagement(TB.map((a) => ({ ...a, priorMinor: null as unknown as number })), true);
    await as(rev, (tx) => audit.setMateriality(tx, rev, single, materiality));
    const d = (await as(prep, (tx) => analytics.getAnalytics(tx, single)))!;
    expect(d.hasComparatives).toBe(false);
    expect(d.rows.some((r) => r.flag)).toBe(false);
    expect(d.ratios.find((r) => r.key === "WORKCAP")!.prior).toBeNull();
    expect((await as(prep, (tx) => audit.getAuditOverview(tx, single)))!.blockers.some((b) => b.includes("analytical review"))).toBe(false);
  });

  it("cannot be written on a locked engagement, but can still be read", async () => {
    await db.query("update engagements set status = 'locked' where id = $1", [engagement]);
    await expect(explain(prep, "CASH", "Changed after the engagement was locked.")).rejects.toThrow(/locked/);
    await expect(as(prep, (tx) => analytics.reconfirmExplanation(tx, prep, engagement, "CASH"))).rejects.toThrow(/locked/);
    const d = await data();
    expect(d.editable).toBe(false);
    expect(d.rows.find((r) => r.key === "CASH")!.explanation).not.toBeNull();
    await db.query("update engagements set status = 'open' where id = $1", [engagement]);
  });
});
