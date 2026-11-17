import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import { AREA_BY_CODE, assertionsOf } from "../src/domain/audit";

const TB = [
  { code: "1000", name: "Bank - current account", closingMinor: 50000000, priorMinor: null },
  { code: "1100", name: "Trade receivables", closingMinor: 20000000, priorMinor: null },
  { code: "1300", name: "Inventories", closingMinor: 0, priorMinor: null },
  { code: "3000", name: "Share capital", closingMinor: -10000000, priorMinor: null },
  { code: "4000", name: "Sales", closingMinor: -100000000, priorMinor: null },
  { code: "6100", name: "Office rent", closingMinor: 40000000, priorMinor: null },
];
const materiality = { benchmark: "revenue", percentageBp: 100, performancePct: 75, trivialPct: 5, rationale: "Revenue is the measure the owners watch." };
const rate = (code: string, level: string) => Object.fromEntries(assertionsOf(AREA_BY_CODE.get(code)!).map((a) => [a, level]));
const work = (text: string) => ({ status: "done", workDone: `${text} done.`, conclusion: "No exceptions." });

type T = Parameters<Parameters<typeof withFirm>[2]>[0];

describe("self-review where the firm has only one reviewer-level user", () => {
  let db: Db;
  const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
  let n = 0;
  const mkFirm = async (roles: repo.Session["role"][]) => {
    n++;
    const firmId = `${n.toString(16).padStart(8, "e")}-0000-4000-8000-000000000001`;
    await db.query("insert into firms (id, name) values ($1, 'Firm')", [firmId]);
    const users: repo.Session[] = [];
    for (const [i, role] of roles.entries()) {
      const userId = `${firmId.slice(0, 8)}-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`;
      await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [userId, firmId, `${userId}@x.test`, `${role} ${i}`, role]);
      users.push({ firmId, userId, role });
    }
    // The first partner (or admin) sets the engagement up.
    const lead = users.find((u) => u.role === "partner" || u.role === "admin")!;
    const engagement = await as(lead, async (tx) => {
      const client = await repo.createClient(tx, lead, "Self Review Co");
      const id = await repo.createEngagement(tx, lead, client, "2025-01-01", "2025-12-31");
      await repo.importTrialBalance(tx, lead, id, "tb.xlsx", TB);
      await repo.approveAllMappings(tx, lead, id);
      await audit.setAuditEnabled(tx, lead, id, true);
      await audit.setMateriality(tx, lead, id, materiality);
      return id;
    });
    const first = (await as(lead, (tx) => audit.getAuditOverview(tx, engagement)))!.areas.find((a) => !a.assessed)!.code;
    await as(lead, (tx) => audit.setAreaRisks(tx, lead, engagement, first, rate(first, "low")));
    return { firmId, users, lead, engagement, area: first };
  };
  const procs = (f: { lead: repo.Session; engagement: string; area: string }) => as(f.lead, (tx) => audit.listProcedures(tx, f.engagement, f.area));
  const overview = (f: { lead: repo.Session; engagement: string }) => as(f.lead, async (tx) => (await audit.getAuditOverview(tx, f.engagement))!);

  beforeAll(async () => {
    db = await openDatabase();
  });

  it("lets the only reviewer-level user review their own work, visibly, and reach zero unreviewed", async () => {
    const f = await mkFirm(["partner", "preparer", "preparer"]);
    const [prep] = f.users.filter((u) => u.role === "preparer");
    const [a, b, c] = await procs(f);
    await as(f.lead, (tx) => audit.updateProcedure(tx, f.lead, a.id, work("Own one")));
    await as(f.lead, (tx) => audit.updateProcedure(tx, f.lead, b.id, work("Own two")));
    await as(prep, (tx) => audit.updateProcedure(tx, prep, c.id, work("Preparer's")));
    expect((await overview(f)).blockers.some((x) => x.includes("have not been reviewed"))).toBe(true);

    await as(f.lead, (tx) => audit.reviewProcedure(tx, f.lead, a.id));
    const after = await procs(f);
    expect(after.find((p) => p.id === a.id)).toMatchObject({ selfReviewed: true, reviewedByName: "partner 0" });
    expect(after.find((p) => p.id === c.id)!.selfReviewed).toBe(false);
    const logged = await db.query("select detail from audit_log where entity_id = $1 and action = 'procedure_review'", [a.id]);
    expect((logged.rows[0] as { detail: { selfReview: boolean } }).detail.selfReview).toBe(true);
    expect((await overview(f)).selfReviewed).toBe(1);

    // Review-all reviews the person's own work too, and reports how much of it was their own.
    const result = await as(f.lead, (tx) => audit.reviewArea(tx, f.lead, f.engagement, f.area));
    expect(result).toEqual({ reviewed: 2, skipped: 0, selfReviewed: 1 });
    const o = await overview(f);
    expect(o.areas.find((x) => x.code === f.area)!.unreviewed).toBe(0);
    expect(o.blockers.some((x) => x.includes("have not been reviewed"))).toBe(false);
    // Reviewed by someone else is not counted as self-review; only the two the partner did themselves.
    expect(o.selfReviewed).toBe(2);
    expect((await procs(f)).find((p) => p.id === c.id)!.selfReviewed).toBe(false);
  });

  it("is information only: self-reviewed work does not hold up the lock", async () => {
    const f = await mkFirm(["admin", "preparer"]);
    const [a] = await procs(f);
    await as(f.lead, (tx) => audit.updateProcedure(tx, f.lead, a.id, work("Admin's own")));
    await as(f.lead, (tx) => audit.reviewProcedure(tx, f.lead, a.id));
    const o = await overview(f);
    expect(o.selfReviewed).toBe(1);
    expect(o.blockers.some((x) => x.toLowerCase().includes("self"))).toBe(false);
  });

  it("keeps the different-person rule where the firm has two reviewer-level users", async () => {
    const f = await mkFirm(["partner", "reviewer", "preparer"]);
    const [a, b] = await procs(f);
    await as(f.lead, (tx) => audit.updateProcedure(tx, f.lead, a.id, work("Partner's own")));
    await as(f.lead, (tx) => audit.updateProcedure(tx, f.lead, b.id, work("Partner's own two")));
    await expect(as(f.lead, (tx) => audit.reviewProcedure(tx, f.lead, a.id))).rejects.toThrow(/different person/);
    expect(await as(f.lead, (tx) => audit.reviewArea(tx, f.lead, f.engagement, f.area))).toEqual({ reviewed: 0, skipped: 2, selfReviewed: 0 });
    const reviewer = f.users.find((u) => u.role === "reviewer")!;
    await as(reviewer, (tx) => audit.reviewProcedure(tx, reviewer, a.id));
    expect((await overview(f)).selfReviewed).toBe(0);
    // An admin and a partner are two reviewer-level users as well.
    const g = await mkFirm(["admin", "partner"]);
    const [x] = await procs(g);
    await as(g.lead, (tx) => audit.updateProcedure(tx, g.lead, x.id, work("Admin's own")));
    await expect(as(g.lead, (tx) => audit.reviewProcedure(tx, g.lead, x.id))).rejects.toThrow(/different person/);
  });

  it("still counts a deactivated second reviewer-level user", async () => {
    const f = await mkFirm(["partner", "preparer"]);
    const [a] = await procs(f);
    await as(f.lead, (tx) => audit.updateProcedure(tx, f.lead, a.id, work("Own")));
    // A second reviewer joins and is then deactivated: the partner cannot go back to reviewing their own work.
    await db.query("insert into users (id, firm_id, email, name, role, active) values ($1, $2, 'gone@x.test', 'Gone', 'reviewer', false)", [`${f.firmId.slice(0, 8)}-0000-4000-8000-0000000009ff`, f.firmId]);
    await expect(as(f.lead, (tx) => audit.reviewProcedure(tx, f.lead, a.id))).rejects.toThrow(/different person/);
    expect(await as(f.lead, (tx) => audit.reviewArea(tx, f.lead, f.engagement, f.area))).toEqual({ reviewed: 0, skipped: 1, selfReviewed: 0 });
  });

  it("is decided firm by firm, and another firm cannot review", async () => {
    const solo = await mkFirm(["partner", "preparer"]);
    const crowded = await mkFirm(["partner", "reviewer", "reviewer"]);
    const [a] = await procs(solo);
    await as(solo.lead, (tx) => audit.updateProcedure(tx, solo.lead, a.id, work("Own")));
    // The other firm's reviewers do not count towards this firm's rule, and cannot touch this firm's file.
    const outsider = crowded.users.find((u) => u.role === "reviewer")!;
    await expect(as(outsider, (tx) => audit.reviewProcedure(tx, outsider, a.id))).rejects.toThrow(/not found/);
    await expect(as(outsider, (tx) => audit.reviewArea(tx, outsider, solo.engagement, solo.area))).rejects.toThrow(/not found/);
    expect((await as(outsider, (tx) => audit.listProcedures(tx, solo.engagement, solo.area))).length).toBe(0);
    expect(await as(solo.lead, (tx) => repo.canSelfReviewAudit(tx))).toBe(true);
    expect(await as(outsider, (tx) => repo.canSelfReviewAudit(tx))).toBe(false);
  });
});
