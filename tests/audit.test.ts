import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import * as review from "../src/server/review";
import * as journals from "../src/server/journals";
import library from "../src/domain/methodology-library.json";
import { buildLibrary } from "../scripts/methodology-parser";
import { AREAS, AREA_BY_CODE, areasInScope, assertionsOf, computeMateriality, isAssessed, selectProcedures } from "../src/domain/audit";
import { GROUP_BY_CODE } from "../src/domain/groups";

describe("methodology library", () => {
  it("loads every fieldwork area with unique, complete procedures", () => {
    expect(AREAS.map((a) => a.code)).toEqual(Array.from({ length: 16 }, (_, i) => `C${i + 1}`));
    const ids = AREAS.flatMap((a) => a.procedures.map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(150);
    for (const a of AREAS) {
      expect(a.objective.length, a.code).toBeGreaterThan(20);
      expect(a.procedures.some((p) => p.tier === "core"), a.code).toBe(true);
      for (const g of a.groups) expect(GROUP_BY_CODE.has(g), `${a.code} ${g}`).toBe(true);
    }
  });

  it("is in step with the methodology documents", () => {
    // If this fails, the documents in docs/ were edited without running: npm run methodology
    expect(buildLibrary()).toEqual(library);
  });

  it("carries no notes addressed to the methodology reviewer in procedure wording", () => {
    const wording = AREAS.flatMap((a) => [a.objective, ...a.procedures.flatMap((p) => [p.text, p.evidence])]).join(" ");
    expect(wording).not.toMatch(/reviewer (to|should) confirm|proposed as firm policy|build plan/i);
  });

  it("covers every statement group with some area", () => {
    const covered = new Set(AREAS.flatMap((a) => a.groups));
    expect([...GROUP_BY_CODE.keys()].filter((g) => !covered.has(g))).toEqual([]);
  });
});

describe("scope and programme selection", () => {
  it("always includes the completeness-driven areas, and others only when they have balances", () => {
    const codes = (groups: string[]) => areasInScope(new Set(groups)).map((a) => a.code);
    expect(codes([])).toEqual(["C7", "C8", "C10", "C13", "C15", "C16"]);
    expect(codes(["CASH", "PPE"])).toEqual(["C1", "C6", "C7", "C8", "C10", "C13", "C15", "C16"]);
  });

  it("loads core always, extended for moderate or above, significant only when flagged, per assertion", () => {
    const c5 = AREA_BY_CODE.get("C5")!;
    const ids = (risks: Parameters<typeof selectProcedures>[1]) => selectProcedures(c5, risks).map((p) => p.id);
    const allLow = Object.fromEntries(assertionsOf(c5).map((a) => [a, "low"]));
    const core = c5.procedures.filter((p) => p.tier === "core").map((p) => p.id);
    expect(ids(allLow)).toEqual(core);

    // Valuation rated high: the extended procedures that address valuation load; the existence-only ones do not.
    const valuationHigh = ids({ ...allLow, V: "high" });
    expect(valuationHigh).toContain("C5.11");
    expect(valuationHigh).toContain("C5.14");
    expect(valuationHigh).not.toContain("C5.12");
    expect(valuationHigh.some((id) => c5.procedures.find((p) => p.id === id)!.tier === "significant")).toBe(false);

    // Existence flagged significant: its significant-risk procedures load too.
    const existenceSignificant = ids({ ...allLow, E: "significant" });
    expect(existenceSignificant).toContain("C5.16");
    expect(existenceSignificant).toContain("C5.12");
  });

  it("treats management override as significant without an assessment", () => {
    const c16 = AREA_BY_CODE.get("C16")!;
    expect(isAssessed(c16, {})).toBe(true);
    expect(selectProcedures(c16, {})).toHaveLength(c16.procedures.length);
    expect(isAssessed(AREA_BY_CODE.get("C5")!, { E: "low" })).toBe(false);
  });
});

describe("materiality", () => {
  it("calculates overall, performance and trivial amounts", () => {
    const r = computeMateriality({ benchmark: "revenue", benchmarkAmountMinor: 389040000, percentageBp: 100, performancePct: 75, trivialPct: 5 });
    expect(r).toEqual({ overallMinor: 3890400, performanceMinor: 2917800, trivialMinor: 194520, warnings: [], errors: [] });
  });
  it("warns outside the guide ranges but still calculates", () => {
    const r = computeMateriality({ benchmark: "pbt", benchmarkAmountMinor: 1000000, percentageBp: 1500, performancePct: 90, trivialPct: 10 });
    expect(r.overallMinor).toBe(150000);
    expect(r.warnings).toHaveLength(3);
    expect(r.errors).toEqual([]);
  });
  it("rejects a zero benchmark and impossible percentages", () => {
    expect(computeMateriality({ benchmark: "pbt", benchmarkAmountMinor: 0, percentageBp: 500, performancePct: 75, trivialPct: 5 }).errors[0]).toContain("greater than zero");
    expect(computeMateriality({ benchmark: "pbt", benchmarkAmountMinor: 100, percentageBp: 0, performancePct: 0, trivialPct: 101 }).errors).toHaveLength(3);
  });
});

describe("the audit on an engagement", () => {
  const FIRM = "aaaaaaaa-3333-4000-8000-000000000001";
  const OTHER = "bbbbbbbb-3333-4000-8000-000000000001";
  const user = (n: number, role: repo.Session["role"], firmId = FIRM): repo.Session => ({ firmId, userId: `${firmId.slice(0, 8)}-3333-4000-8000-00000000001${n}`, role });
  const prep = user(1, "preparer");
  const rev = user(2, "reviewer");
  const partner = user(3, "partner");
  const outsider = user(4, "partner", OTHER);
  const TB = [
    { code: "1000", name: "Bank - current account", closingMinor: 30000000, priorMinor: null },
    { code: "1100", name: "Trade receivables", closingMinor: 20000000, priorMinor: null },
    { code: "3000", name: "Share capital", closingMinor: -10000000, priorMinor: null },
    { code: "4000", name: "Sales", closingMinor: -100000000, priorMinor: null },
    { code: "6100", name: "Office rent", closingMinor: 60000000, priorMinor: null },
  ];
  let db: PGlite;
  let engagement: string;
  type T = Parameters<Parameters<typeof withFirm>[2]>[0];
  const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
  const overview = async () => (await as(prep, (tx) => audit.getAuditOverview(tx, engagement)))!;
  const rate = (code: string, level: string) => Object.fromEntries(assertionsOf(AREA_BY_CODE.get(code)!).map((a) => [a, level]));

  beforeAll(async () => {
    db = await openDatabase();
    for (const firm of [FIRM, OTHER]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [firm]);
    for (const u of [prep, rev, partner, outsider]) {
      await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-1)}`, u.role]);
    }
    await as(partner, async (tx) => {
      const client = await repo.createClient(tx, partner, "Audit Co");
      engagement = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
      await repo.importTrialBalance(tx, partner, engagement, "tb.xlsx", TB);
      await repo.approveAllMappings(tx, partner, engagement);
    });
  });

  it("starts with the areas in scope, benchmarks from the statements, and no blockers", async () => {
    const o = await overview();
    expect(o.areas.map((a) => a.code)).toEqual(["C5", "C6", "C7", "C8", "C10", "C12", "C13", "C14", "C15", "C16"]);
    expect(o.benchmarks).toEqual({ pbt: 40000000, revenue: 100000000, assets: 50000000, equity: 50000000 });
    expect(o).toMatchObject({ enabled: false, blockers: [], materiality: null });
    // An engagement that is not being audited is not held up by audit work.
    expect((await as(prep, (tx) => review.getOverview(tx, engagement)))!.readiness.blockers.some((b) => b.startsWith("Audit"))).toBe(false);
  });

  it("does nothing until a reviewer turns the audit on, and can be turned off before work is recorded", async () => {
    const input = { benchmark: "revenue", percentageBp: 100, performancePct: 75, trivialPct: 5, rationale: "Revenue is the measure the owners and the bank focus on." };
    await expect(as(rev, (tx) => audit.setMateriality(tx, rev, engagement, input))).rejects.toThrow(/Turn the audit on/);
    await expect(as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, "C5", rate("C5", "low")))).rejects.toThrow(/Turn the audit on/);
    await expect(as(prep, (tx) => audit.setAuditEnabled(tx, prep, engagement, true))).rejects.toThrow(/Only a reviewer or partner/);
    await as(rev, (tx) => audit.setAuditEnabled(tx, rev, engagement, true));
    expect((await overview()).blockers[0]).toContain("materiality has not been set");
    await as(rev, (tx) => audit.setAuditEnabled(tx, rev, engagement, false));
    expect(await overview()).toMatchObject({ enabled: false, blockers: [] });
    await as(rev, (tx) => audit.setAuditEnabled(tx, rev, engagement, true));
  });

  it("sets materiality from the engagement's own figures and keeps revisions", async () => {
    const input = { benchmark: "revenue", percentageBp: 100, performancePct: 75, trivialPct: 5, rationale: "Revenue is the measure the owners and the bank focus on." };
    await expect(as(prep, (tx) => audit.setMateriality(tx, prep, engagement, input))).rejects.toThrow(/Only a reviewer or partner/);
    await expect(as(rev, (tx) => audit.setMateriality(tx, rev, engagement, { ...input, rationale: "short" }))).rejects.toThrow(/Record why/);
    await expect(as(rev, (tx) => audit.setMateriality(tx, rev, engagement, { ...input, benchmark: "turnover" }))).rejects.toThrow(/Choose a benchmark/);
    await as(rev, (tx) => audit.setMateriality(tx, rev, engagement, input));
    expect(await as(partner, (tx) => audit.setMateriality(tx, partner, engagement, { ...input, percentageBp: 150 }))).toEqual([]);
    // Outside the guide range: saved, and the warning is returned for the user.
    expect((await as(partner, (tx) => audit.setMateriality(tx, partner, engagement, { ...input, percentageBp: 500 })))[0]).toContain("outside the guide range");
    await as(partner, (tx) => audit.setMateriality(tx, partner, engagement, { ...input, percentageBp: 150 }));
    const o = await overview();
    expect(o.materiality).toMatchObject({ benchmark: "revenue", benchmarkAmountMinor: 100000000, overallMinor: 1500000, performanceMinor: 1125000, trivialMinor: 75000, setBy: "partner 3" });
    expect(o.revisions).toBe(4);
    expect(o.enabled).toBe(true);
    expect(o.blockers[0]).toContain("risk has not been assessed for 9 area(s)");
  });

  it("assesses an area and loads its programme; the application role cannot rewrite materiality history", async () => {
    await expect(as(prep, (tx) => audit.setAreaRisks(tx, prep, engagement, "C5", rate("C5", "low")))).rejects.toThrow(/Only a reviewer or partner/);
    await expect(as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, "C5", { E: "low" }))).rejects.toThrow(/Rate every assertion/);
    await expect(as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, "C4", rate("C4", "low")))).rejects.toThrow(/not in scope/);
    await expect(as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, "C99", {}))).rejects.toThrow(/Unknown audit area/);

    const change = await as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, "C5", rate("C5", "low")));
    expect(change).toEqual({ added: 11, removed: 0 });
    const procedures = await as(prep, (tx) => audit.listProcedures(tx, engagement, "C5"));
    expect(procedures.map((p) => p.templateId).slice(0, 3)).toEqual(["C5.01", "C5.02", "C5.03"]);
    expect(procedures.every((p) => p.tier === "core" && p.status === "open")).toBe(true);
    expect(procedures[0].body).toContain("customer-by-customer listing");

    await expect(as(rev, (tx) => tx.query("update materiality set overall_minor = 1"))).rejects.toThrow(/permission denied/);
    await expect(as(rev, (tx) => tx.query("delete from materiality"))).rejects.toThrow(/permission denied/);
  });

  it("re-assessing adds procedures, and removes only those with no work recorded", async () => {
    const up = await as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, "C5", { ...rate("C5", "low"), V: "high", E: "significant" }));
    expect(up.added).toBeGreaterThan(3);
    const loaded = await as(prep, (tx) => audit.listProcedures(tx, engagement, "C5"));
    const extended = loaded.find((p) => p.templateId === "C5.11")!;
    const significant = loaded.find((p) => p.templateId === "C5.16")!;
    await as(prep, (tx) => audit.updateProcedure(tx, prep, extended.id, { status: "done", workDone: "Traced 10 invoices to their dates.", conclusion: "Ageing is accurate." }));

    const down = await as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, "C5", rate("C5", "low")));
    expect(down.removed).toBeGreaterThan(0);
    const after = await as(prep, (tx) => audit.listProcedures(tx, engagement, "C5"));
    // The untouched significant-risk procedure is gone; the completed extended one stays on the file.
    expect(after.some((p) => p.id === significant.id)).toBe(false);
    expect(after.find((p) => p.id === extended.id)).toMatchObject({ status: "done", performedByName: "preparer 1" });
  });

  it("records work on a procedure: completed, not applicable with a reason, and reopened", async () => {
    const [first, second] = await as(prep, (tx) => audit.listProcedures(tx, engagement, "C5"));
    await expect(as(prep, (tx) => audit.updateProcedure(tx, prep, first.id, { status: "done", workDone: "", conclusion: "Fine" }))).rejects.toThrow(/Describe the work done/);
    await expect(as(prep, (tx) => audit.updateProcedure(tx, prep, first.id, { status: "done", workDone: "Agreed listing to TB.", conclusion: "" }))).rejects.toThrow(/Record the conclusion/);
    await expect(as(prep, (tx) => audit.updateProcedure(tx, prep, second.id, { status: "na", workDone: "", conclusion: "" }))).rejects.toThrow(/why the procedure does not apply/);
    await expect(as(prep, (tx) => audit.updateProcedure(tx, prep, first.id, { status: "finished", workDone: "x", conclusion: "y" }))).rejects.toThrow(/Unknown status/);

    await as(prep, (tx) => audit.updateProcedure(tx, prep, first.id, { status: "done", workDone: "Agreed listing to TB.", conclusion: "Agrees." }));
    await as(prep, (tx) => audit.updateProcedure(tx, prep, second.id, { status: "na", workDone: "No comparatives in a first-year audit.", conclusion: "" }));
    let c5 = (await overview()).areas.find((a) => a.code === "C5")!;
    expect(c5.completed).toBe(3);

    await as(prep, (tx) => audit.updateProcedure(tx, prep, first.id, { status: "open", workDone: "Agreed listing to TB.", conclusion: "" }));
    const reopened = (await as(prep, (tx) => audit.listProcedures(tx, engagement, "C5")))[0];
    expect(reopened).toMatchObject({ status: "open", performedByName: null, workDone: "Agreed listing to TB." });
    c5 = (await overview()).areas.find((a) => a.code === "C5")!;
    expect(c5.completed).toBe(2);
  });

  it("cannot be turned off once work has been recorded", async () => {
    await expect(as(partner, (tx) => audit.setAuditEnabled(tx, partner, engagement, false))).rejects.toThrow(/cannot be turned off/);
  });

  it("flags materiality when the benchmark figure moves", async () => {
    expect((await overview()).materialityStale).toBe(false);
    const ids = Object.fromEntries((await as(prep, (tx) => repo.listAccounts(tx, engagement))).map((a) => [a.code, a.id]));
    const entry = await as(prep, (tx) =>
      journals.createJournal(tx, prep, engagement, { type: "adjusting", description: "Reverse a sale", lines: [{ accountId: ids["4000"], amountMinor: 500000 }, { accountId: ids["1100"], amountMinor: -500000 }] }),
    );
    const o = await overview();
    expect(o.materialityStale).toBe(true);
    expect(o.blockers.some((b) => b.includes("benchmark figure has changed"))).toBe(true);
    await as(prep, (tx) => journals.deleteJournal(tx, prep, entry));
    expect((await overview()).materialityStale).toBe(false);
  });

  it("holds up the lock until the audit work is finished", async () => {
    const readiness = (await as(prep, (tx) => review.getOverview(tx, engagement)))!.readiness;
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.filter((b) => b.startsWith("Audit")).length).toBeGreaterThanOrEqual(2);
    await expect(as(partner, (tx) => review.lockEngagement(tx, partner, engagement))).rejects.toThrow(/not ready to lock/);
  });

  it("management override loads fully as a significant risk without ratings", async () => {
    const change = await as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, "C16", {}));
    expect(change.added).toBe(AREA_BY_CODE.get("C16")!.procedures.length);
    expect((await overview()).areas.find((a) => a.code === "C16")).toMatchObject({ assessed: true, fixedRisk: "significant" });
  });

  it("only a reviewer can set aside a response to a significant risk", async () => {
    const [override] = await as(prep, (tx) => audit.listProcedures(tx, engagement, "C16"));
    const reason = { status: "na", workDone: "The entity posts no manual journals.", conclusion: "" };
    await expect(as(prep, (tx) => audit.updateProcedure(tx, prep, override.id, reason))).rejects.toThrow(/Only a reviewer or partner can mark a significant-risk/);
    await expect(as(rev, (tx) => audit.updateProcedure(tx, rev, override.id, { ...reason, workDone: "n/a" }))).rejects.toThrow(/why the procedure does not apply/);
    await as(rev, (tx) => audit.updateProcedure(tx, rev, override.id, reason));
    const o = await overview();
    expect(o.notApplicable).toBe(2);
    expect((await as(prep, (tx) => review.getOverview(tx, engagement)))!.auditNotApplicable).toBe(2);
  });

  it("is invisible and closed to another firm, and frozen once locked", async () => {
    expect(await as(outsider, (tx) => audit.getAuditOverview(tx, engagement))).toBeNull();
    expect(await as(outsider, (tx) => audit.listProcedures(tx, engagement, "C5"))).toEqual([]);
    const [first] = await as(prep, (tx) => audit.listProcedures(tx, engagement, "C5"));
    await expect(as(outsider, (tx) => audit.updateProcedure(tx, outsider, first.id, { status: "na", workDone: "Intrusion", conclusion: "" }))).rejects.toThrow(/not found/);
    await expect(as(outsider, (tx) => audit.setAreaRisks(tx, outsider, engagement, "C5", rate("C5", "low")))).rejects.toThrow(/not found/);

    await db.query("update engagements set status = 'locked' where id = $1", [engagement]);
    await expect(as(prep, (tx) => audit.updateProcedure(tx, prep, first.id, { status: "na", workDone: "After lock", conclusion: "" }))).rejects.toThrow(/locked/);
    await expect(as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, "C6", rate("C6", "low")))).rejects.toThrow(/locked/);
    await expect(
      as(rev, (tx) => audit.setMateriality(tx, rev, engagement, { benchmark: "revenue", percentageBp: 100, performancePct: 75, trivialPct: 5, rationale: "After the lock, should be refused." })),
    ).rejects.toThrow(/locked/);
  });
});
