import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import * as journals from "../src/server/journals";
import { AREA_BY_CODE, assertionsOf, assessmentSnapshot } from "../src/domain/audit";

describe("assessment snapshot", () => {
  const materiality = { benchmark: "revenue", benchmarkAmountMinor: 100, overallMinor: 10, performanceMinor: 7, trivialMinor: 1 };
  const a = { code: "C5", risks: { E: "low", V: "high" } as const };
  const b = { code: "C1", fixedRisk: "significant", risks: {} };

  it("is the same whatever order the areas and ratings arrive in", () => {
    const flipped = { code: "C5", risks: { V: "high", E: "low" } as const };
    expect(assessmentSnapshot({ materiality, areas: [a, b] })).toBe(assessmentSnapshot({ materiality, areas: [b, flipped] }));
  });

  it("differs when a rating, the materiality or the areas in scope differ", () => {
    const base = assessmentSnapshot({ materiality, areas: [a, b] });
    expect(assessmentSnapshot({ materiality, areas: [{ code: "C5", risks: { E: "low", V: "moderate" } }, b] })).not.toBe(base);
    expect(assessmentSnapshot({ materiality: { ...materiality, overallMinor: 11 }, areas: [a, b] })).not.toBe(base);
    expect(assessmentSnapshot({ materiality, areas: [a] })).not.toBe(base);
    expect(assessmentSnapshot({ materiality: null, areas: [a, b] })).not.toBe(base);
  });
});

describe("partner approval of the risk assessment", () => {
  const FIRM = "aaaaaaaa-7777-4000-8000-000000000001";
  const OTHER = "bbbbbbbb-7777-4000-8000-000000000001";
  const user = (n: number, role: repo.Session["role"], firmId = FIRM): repo.Session => ({ firmId, userId: `${firmId.slice(0, 8)}-7777-4000-8000-00000000001${n}`, role });
  const prep = user(1, "preparer");
  const rev = user(2, "reviewer");
  const partner = user(3, "partner");
  const outsider = user(4, "partner", OTHER);
  const TB = [
    { code: "1000", name: "Bank - current account", closingMinor: 50000000, priorMinor: null },
    { code: "1100", name: "Trade receivables", closingMinor: 20000000, priorMinor: null },
    { code: "1300", name: "Inventories", closingMinor: 0, priorMinor: null },
    { code: "3000", name: "Share capital", closingMinor: -10000000, priorMinor: null },
    { code: "4000", name: "Sales", closingMinor: -100000000, priorMinor: null },
    { code: "6100", name: "Office rent", closingMinor: 40000000, priorMinor: null },
  ];
  const materiality = { benchmark: "revenue", percentageBp: 100, performancePct: 75, trivialPct: 5, rationale: "Revenue is the measure the owners watch." };
  let db: PGlite;
  let engagement: string;
  type T = Parameters<Parameters<typeof withFirm>[2]>[0];
  const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
  const overview = async () => (await as(prep, (tx) => audit.getAuditOverview(tx, engagement)))!;
  const rate = (code: string, level: string) => Object.fromEntries(assertionsOf(AREA_BY_CODE.get(code)!).map((a) => [a, level]));
  const approve = (s: repo.Session = partner) => as(s, (tx) => audit.approveRiskAssessment(tx, s, engagement));
  const rateAll = async () => {
    for (const area of (await overview()).areas.filter((a) => !a.assessed)) await as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, area.code, rate(area.code, "low")));
  };
  const step = async () => (await as(prep, (tx) => audit.listProcedures(tx, engagement, "B8"))).find((p) => p.templateId === "B8.08")!;
  const done = { status: "done", workDone: "Reviewed materiality and every area's ratings.", conclusion: "Approved." };

  beforeAll(async () => {
    db = await openDatabase();
    for (const firm of [FIRM, OTHER]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [firm]);
    for (const u of [prep, rev, partner, outsider]) {
      await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-1)}`, u.role]);
    }
    await as(partner, async (tx) => {
      const client = await repo.createClient(tx, partner, "Approval Co");
      engagement = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
      await repo.importTrialBalance(tx, partner, engagement, "tb.xlsx", TB);
      await repo.approveAllMappings(tx, partner, engagement);
      await audit.setAuditEnabled(tx, partner, engagement, true);
    });
  });

  it("cannot be given until materiality is set and every area is assessed", async () => {
    expect((await overview()).approval).toMatchObject({ state: "none", notReady: "Set materiality first." });
    await expect(approve()).rejects.toThrow(/Set materiality first/);
    await as(partner, (tx) => audit.setMateriality(tx, partner, engagement, materiality));
    expect((await overview()).approval.notReady).toMatch(/Assess risk for the remaining \d+ area/);
    await expect(approve()).rejects.toThrow(/Assess risk for the remaining/);
    await rateAll();
    const o = await overview();
    expect(o.approval).toEqual({ state: "none", approvedBy: null, approvedAt: null, notReady: null });
    expect(o.blockers).toContain("Audit: the partner has not approved the risk assessment.");
  });

  it("is the partner's to give, and the planning step that records it waits for it", async () => {
    await expect(approve(rev)).rejects.toThrow(/Only a partner/);
    await expect(approve(outsider)).rejects.toThrow(/not found/);
    const b808 = await step();
    await expect(as(partner, (tx) => audit.updateProcedure(tx, partner, b808.id, done))).rejects.toThrow(/Approve the risk assessment on the audit page first/);

    await approve();
    const o = await overview();
    expect(o.approval).toMatchObject({ state: "current", approvedBy: "partner 3", notReady: null });
    expect(o.approval.approvedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(o.blockers.some((b) => b.includes("risk assessment"))).toBe(false);
    await expect(approve()).rejects.toThrow(/already approved/);
    // An approval is work on the audit file, so the audit can no longer be turned off.
    await expect(as(partner, (tx) => audit.setAuditEnabled(tx, partner, engagement, false))).rejects.toThrow(/cannot be turned off/);
    await as(partner, (tx) => audit.updateProcedure(tx, partner, b808.id, done));
    expect((await step()).status).toBe("done");
  });

  it("lapses when a rating changes, and stands again only for the assessment that was approved", async () => {
    await as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, "C5", { ...rate("C5", "low"), V: "high" }));
    let o = await overview();
    expect(o.approval).toMatchObject({ state: "lapsed", approvedBy: "partner 3" });
    expect(o.blockers).toContain("Audit: the risk assessment has changed since the partner approved it. It needs approving again.");

    // Putting the rating back restores exactly what the partner approved.
    await as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, "C5", rate("C5", "low")));
    expect((await overview()).approval.state).toBe("current");

    await as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, "C5", { ...rate("C5", "low"), V: "high" }));
    await approve();
    o = await overview();
    expect(o.approval.state).toBe("current");
    expect((await db.query("select 1 from risk_approvals where engagement_id = $1", [engagement])).rows).toHaveLength(2);
  });

  it("lapses when materiality is revised", async () => {
    await as(partner, (tx) => audit.setMateriality(tx, partner, engagement, { ...materiality, percentageBp: 150, rationale: "Raised after discussion with the partner." }));
    expect((await overview()).approval.state).toBe("lapsed");
    await approve();
    expect((await overview()).approval.state).toBe("current");
  });

  it("lapses when a new area comes into scope, and cannot be renewed until that area is assessed", async () => {
    const ids = Object.fromEntries((await as(prep, (tx) => repo.listAccounts(tx, engagement))).map((a) => [a.code, a.id]));
    const before = (await overview()).areas.length;
    await as(prep, (tx) =>
      journals.createJournal(tx, prep, engagement, { type: "reclassification", description: "Recognise closing inventory", lines: [{ accountId: ids["1300"], amountMinor: 300000 }, { accountId: ids["1000"], amountMinor: -300000 }] }),
    );
    const o = await overview();
    expect(o.areas.length).toBe(before + 1);
    expect(o.approval).toMatchObject({ state: "lapsed", notReady: expect.stringMatching(/remaining 1 area/) });
    await expect(approve()).rejects.toThrow(/remaining 1 area/);
    await rateAll();
    await approve();
    expect((await overview()).approval.state).toBe("current");
  });

  it("is never rewritten, and is invisible to another firm", async () => {
    await expect(as(partner, (tx) => tx.query("update risk_approvals set snapshot = 'x'"))).rejects.toThrow(/permission denied/);
    await expect(as(partner, (tx) => tx.query("delete from risk_approvals"))).rejects.toThrow(/permission denied/);
    expect(await as(outsider, async (tx) => (await tx.query("select id from risk_approvals")).rows.length)).toBe(0);
    const logged = await db.query("select detail from audit_log where action = 'approve_risk_assessment' and entity_id = $1", [engagement]);
    expect(logged.rows).toHaveLength(4);
  });

  it("cannot be given on a locked engagement", async () => {
    await db.query("update engagements set status = 'locked' where id = $1", [engagement]);
    await expect(approve()).rejects.toThrow(/locked/);
  });
});
