import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import * as planning from "../src/server/planning";
import * as answers from "../src/server/planning-answers";
import { AREA_BY_CODE, assertionsOf } from "../src/domain/audit";

const X = "aaaaaaaa-5050-4000-8000-000000000001";
const Y = "bbbbbbbb-5050-4000-8000-000000000001";
const user = (n: number, role: repo.Session["role"], firmId = X): repo.Session => ({ firmId, userId: `${firmId.slice(0, 8)}-5050-4000-8000-00000000001${n}`, role });
const prep = user(1, "preparer");
const rev = user(2, "reviewer");
const partner = user(3, "partner");
const otherPartner = user(5, "partner", Y);

// Invented trial balances. PROFIT: revenue 100,000, costs 70,000. LOSS: the same costs against revenue of 60,000.
const tb = (revenue: number) => [
  { code: "1000", name: "Bank - current account", closingMinor: 30000000, priorMinor: 25000000 },
  { code: "1100", name: "Trade receivables", closingMinor: 20000000, priorMinor: 18000000 },
  { code: "2000", name: "Trade payables", closingMinor: -10000000, priorMinor: -9000000 },
  { code: "3000", name: "Share capital", closingMinor: -10000000, priorMinor: -10000000 },
  { code: "3200", name: "Retained earnings", closingMinor: -20000000, priorMinor: -17000000 },
  { code: "4000", name: "Sales", closingMinor: -revenue * 1000, priorMinor: -90000000 },
  { code: "5000", name: "Cost of goods sold", closingMinor: 50000000, priorMinor: 45000000 },
  { code: "6100", name: "Office rent", closingMinor: 20000000, priorMinor: 18000000 },
];

let db: Db;
let profit: string;
let loss: string;
let off: string;
let openAfterTwo = 0;
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
const count = async (sql: string, args: unknown[] = []) => Number((await db.query<{ n: string }>(`select count(*)::text as n from ${sql}`, args)).rows[0].n);
const rows = (engagement: string) => count("planning_answers where engagement_id = $1", [engagement]);
const questionnaire = async (id: string, s = prep) => (await as(s, (tx) => answers.getQuestionnaire(tx, id)))!;
const find = async (id: string, key: string) => (await questionnaire(id)).sections.flatMap((s) => s.questions).find((q) => q.key === key)!;
const save = (id: string, s: repo.Session, key: string, value: string, reason = "") => as(s, (tx) => answers.savePlanningAnswer(tx, s, id, key, value, reason));

async function newEngagement(revenue: number, auditOn: boolean): Promise<string> {
  return as(partner, async (tx) => {
    const client = await repo.createClient(tx, partner, `Questionnaire Co ${Math.random().toString(36).slice(2, 7)}`);
    const id = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
    await repo.importTrialBalance(tx, partner, id, "tb.xlsx", tb(revenue));
    await repo.approveAllMappings(tx, partner, id);
    if (auditOn) await audit.setAuditEnabled(tx, rev, id, true);
    return id;
  });
}

beforeAll(async () => {
  db = await openDatabase();
  for (const firm of [X, Y]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [firm]);
  for (const u of [prep, rev, partner, otherPartner]) {
    await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-1)}`, u.role]);
  }
  profit = await newEngagement(100000, true);
  loss = await newEngagement(60000, true);
  off = await newEngagement(100000, false);
});

afterAll(async () => {
  await db.close();
});

describe("an engagement that already has materiality and ratings", () => {
  it("shows them, and the questionnaire, without any re-entry and without saving anything", async () => {
    await as(rev, (tx) => audit.setMateriality(tx, rev, profit, { benchmark: "pbt", percentageBp: 750, performancePct: 75, trivialPct: 5, rationale: "Profit is what the owners focus on." }));
    const levels = Object.fromEntries(assertionsOf(AREA_BY_CODE.get("C13")!).map((a) => [a, "moderate"]));
    await as(rev, (tx) => audit.setAreaRisks(tx, rev, profit, "C13", levels));
    const before = await rows(profit);
    const onFile = (await as(prep, (tx) => answers.getPlanningOnFile(tx, profit)))!;
    expect(onFile.enabled).toBe(true);
    expect(onFile.materiality).toMatchObject({ benchmark: "pbt", percentageBp: 750, rationale: "Profit is what the owners focus on." });
    expect(onFile.areas.find((a) => a.code === "C13")).toMatchObject({ assessed: true });
    const q = await questionnaire(profit);
    expect(q.sections.map((s) => s.n)).toEqual([1, 8, 9, 10, 11]);
    expect(q.derivation.suggested).not.toBeNull();
    expect(await rows(profit)).toBe(before);
    expect(before).toBe(0);
  });
});

describe("answers", () => {
  it("keep a person's answer with its source, who and when, and need no reason when the app suggested nothing", async () => {
    expect(await save(profit, prep, "reliance_bank", "yes", "ignored: no suggestion to override")).toBe(true);
    const q = await find(profit, "reliance_bank");
    expect(q.state).toBe("answered");
    expect(q.stored).toMatchObject({ value: "yes", source: "person", reason: null });
    expect(q.stored!.by).toContain("preparer");
    expect(q.stored!.at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("move the suggestion: a first year lowers the percentage and performance materiality", async () => {
    const before = (await questionnaire(profit)).derivation;
    expect(before.percentage!.position).toBe("low end"); // the bank answer above
    expect(before.performance.reduced).toBe(false);
    await save(profit, rev, "first_year", "yes");
    expect((await questionnaire(profit)).derivation.performance.reduced).toBe(true);
  });

  it("let a person confirm what the app suggested, with no reason, and record it as the app's value confirmed", async () => {
    const suggested = await find(profit, "controls_reliance");
    expect(suggested).toMatchObject({ state: "suggested", value: "no" });
    expect(await save(profit, rev, "controls_reliance", "no")).toBe(true);
    const confirmed = await find(profit, "controls_reliance");
    expect(confirmed.state).toBe("confirmed");
    expect(confirmed.stored).toMatchObject({ source: "auto", reason: null });
  });

  it("need a reason to override a suggestion, and keep it", async () => {
    await expect(save(profit, rev, "controls_reliance", "yes")).rejects.toThrow(/Record why/);
    await expect(save(profit, rev, "controls_reliance", "yes", "  no ")).rejects.toThrow(/Record why/);
    expect(await save(profit, rev, "controls_reliance", "yes", "We will test the sales controls to reduce substantive work.")).toBe(true);
    const q = await find(profit, "controls_reliance");
    expect(q.state).toBe("overridden");
    expect(q.stored).toMatchObject({ value: "yes", source: "person", reason: "We will test the sales controls to reduce substantive work." });
  });

  it("keep the history, newest first, and never rewrite an old row", async () => {
    const q = await find(profit, "controls_reliance");
    expect(q.history.map((h) => `${h.value}:${h.source}`)).toEqual(["yes:person", "no:auto"]);
    await expect(as(partner, (tx) => tx.query("update planning_answers set value = 'no'"))).rejects.toThrow(/permission denied/);
    await expect(as(partner, (tx) => tx.query("delete from planning_answers"))).rejects.toThrow(/permission denied/);
  });

  it("write nothing when the answer in force is saved again", async () => {
    const before = await rows(profit);
    expect(await save(profit, rev, "controls_reliance", "yes", "We will test the sales controls to reduce substantive work.")).toBe(false);
    expect(await save(profit, prep, "reliance_bank", "yes")).toBe(false);
    expect(await rows(profit)).toBe(before);
  });

  it("are checked: the question must exist and the value must fit it", async () => {
    await expect(save(profit, prep, "not_a_question", "yes")).rejects.toThrow(/not in the questionnaire/);
    await expect(save(profit, prep, "reliance_bank", "maybe")).rejects.toThrow(/yes or no/);
    await expect(save(profit, prep, "entity_type", "something")).rejects.toThrow(/Choose one/);
    await expect(save(profit, prep, "industry", "   ")).rejects.toThrow(/Enter an answer/);
    await expect(save(profit, prep, "ind_not_an_indicator", "text")).rejects.toThrow(/not in the questionnaire/);
  });

  it("need the audit to be on and the engagement open", async () => {
    await expect(save(off, prep, "reliance_bank", "yes")).rejects.toThrow(/Turn the audit on/);
    expect(await rows(off)).toBe(0);
    // It can still be read while the audit is off.
    expect((await questionnaire(off)).sections).toHaveLength(5);
  });

  it("log each change", async () => {
    const logged = await count("audit_log where firm_id = $1 and action = 'answer_planning_question'", [X]);
    expect(logged).toBeGreaterThanOrEqual(4);
  });
});

describe("going concern", () => {
  it("is mandatory on a loss, with the indicator's own question, and a suggestion does not count as an answer", async () => {
    const q = await questionnaire(loss);
    expect(q.derivation.goingConcern.required).toBe(true);
    const gc = q.sections.find((s) => s.n === 8)!.questions;
    expect(gc.map((x) => x.key)).toEqual(expect.arrayContaining(["gc_assessment", "gc_period", "gc_support", "ind_loss"]));
    expect(gc.every((x) => x.mandatory && x.state === "unanswered")).toBe(true);
    expect(q.mandatoryOpen).toBe(gc.length);
    // Nothing holds up the lock because of it.
    const overview = (await as(prep, (tx) => audit.getAuditOverview(tx, loss)))!;
    expect(overview.blockers.join(" ")).not.toMatch(/questionnaire|going concern/i);
  });

  it("is answered by a person, one question at a time", async () => {
    const open = (await questionnaire(loss)).mandatoryOpen;
    await save(loss, rev, "gc_assessment", "Management has a twelve-month cash forecast approved by the board.");
    await save(loss, rev, "gc_period", "yes");
    expect((await questionnaire(loss)).mandatoryOpen).toBe(open - 2);
    openAfterTwo = open - 2;
  });

  it("follows the firm's list: with no trigger ticked a loss does not make it mandatory", async () => {
    const defaults = (await as(partner, (tx) => planning.getPlanningSettings(tx))).settings;
    await as(partner, (tx) => planning.updatePlanningSettings(tx, partner, { ...defaults, goingConcernTriggers: [] }));
    try {
      const q = await questionnaire(loss);
      expect(q.derivation.goingConcern.required).toBe(false);
      expect(q.mandatoryOpen).toBe(0);
      // The loss still opens its own question, in section 10, and the answers already given stay.
      expect(q.sections.find((s) => s.n === 10)!.questions.map((x) => x.key)).toContain("ind_loss");
      expect(q.sections.find((s) => s.n === 8)!.questions.map((x) => x.key)).toEqual(expect.arrayContaining(["gc_assessment", "gc_period"]));
    } finally {
      await as(partner, (tx) => planning.resetPlanningSettings(tx, partner));
    }
    expect((await questionnaire(loss)).mandatoryOpen).toBe(openAfterTwo);
  });
});

describe("confirming materiality", () => {
  it("writes exactly one revision, through setMateriality, from the derivation and the typed rationale", async () => {
    const q = await questionnaire(profit);
    const before = await count("materiality where engagement_id = $1", [profit]);
    const warnings = await as(rev, (tx) => answers.confirmPlanningMateriality(tx, rev, profit, q.rationale));
    expect(Array.isArray(warnings)).toBe(true);
    expect(await count("materiality where engagement_id = $1", [profit])).toBe(before + 1);
    const now = (await as(rev, (tx) => audit.getAuditOverview(tx, profit)))!.materiality!;
    expect(now.overallMinor).toBe(q.derivation.suggested!.overallMinor);
    expect(now.performanceMinor).toBe(q.derivation.suggested!.performanceMinor);
    expect(now.trivialMinor).toBe(q.derivation.suggested!.trivialMinor);
    expect(now.benchmark).toBe(q.derivation.benchmark!.benchmark);
    expect(now.rationale).toBe(q.rationale);
    expect(await count("audit_log where firm_id = $1 and action = 'confirm_planning_materiality'", [X])).toBe(1);
  });

  it("takes the rationale as edited", async () => {
    await as(rev, (tx) => answers.confirmPlanningMateriality(tx, rev, profit, "Profit is what the owners and the bank look at; we kept the middle of the firm's range."));
    expect((await as(rev, (tx) => audit.getAuditOverview(tx, profit)))!.materiality!.rationale).toContain("we kept the middle");
  });

  it("is for a reviewer or partner, needs a rationale, and does not need the mandatory questions answered", async () => {
    await expect(as(prep, (tx) => answers.confirmPlanningMateriality(tx, prep, profit, "A reasonable rationale."))).rejects.toThrow(/reviewer or partner/);
    await expect(as(rev, (tx) => answers.confirmPlanningMateriality(tx, rev, profit, "short"))).rejects.toThrow(/Record why/);
    expect((await questionnaire(loss)).mandatoryOpen).toBeGreaterThan(0);
    await as(rev, (tx) => answers.confirmPlanningMateriality(tx, rev, loss, "Revenue, because the entity made a loss; the middle of the range."));
    expect((await as(rev, (tx) => audit.getAuditOverview(tx, loss)))!.materiality!.benchmark).toBe("revenue");
  });

  it("is refused while the audit is off", async () => {
    await expect(as(rev, (tx) => answers.confirmPlanningMateriality(tx, rev, off, "A reasonable rationale."))).rejects.toThrow(/Turn the audit on/);
  });
});

describe("the revenue presumption", () => {
  it("stands by default", async () => {
    expect(await as(prep, (tx) => answers.getRevenuePresumption(tx, profit))).toEqual({ rebutted: false, reason: null, by: null, at: null });
  });

  it("can be rebutted only by a partner, and only with a reason", async () => {
    for (const s of [prep, rev]) await expect(as(s, (tx) => answers.rebutRevenuePresumption(tx, s, profit, "Revenue is a single contract with no judgement in it.")), s.role).rejects.toThrow(/Only a partner/);
    const stale: repo.Session = { ...rev, role: "partner" }; // the session says partner, the database says reviewer
    await expect(as(stale, (tx) => answers.rebutRevenuePresumption(tx, stale, profit, "Revenue is a single contract with no judgement in it."))).rejects.toThrow(/Only a partner/);
    await expect(as(partner, (tx) => answers.rebutRevenuePresumption(tx, partner, profit, ""))).rejects.toThrow(/reason/);
    await expect(as(partner, (tx) => answers.rebutRevenuePresumption(tx, partner, profit, "too short"))).rejects.toThrow(/reason/);
    expect((await as(prep, (tx) => answers.getRevenuePresumption(tx, profit))).rebutted).toBe(false);
  });

  it("is kept with the reason, who and when, logged, and shown from then on", async () => {
    await as(partner, (tx) => answers.rebutRevenuePresumption(tx, partner, profit, "Revenue is a single contract with no judgement in it."));
    const p = await as(prep, (tx) => answers.getRevenuePresumption(tx, profit));
    expect(p).toMatchObject({ rebutted: true, reason: "Revenue is a single contract with no judgement in it." });
    expect(p.by).toContain("partner");
    expect(await count("audit_log where firm_id = $1 and action = 'rebut_revenue_presumption'", [X])).toBe(1);
    await expect(as(partner, (tx) => answers.rebutRevenuePresumption(tx, partner, profit, "Another reason, written twice."))).rejects.toThrow(/already rebutted/);
  });

  it("can be put back by a partner only, and the history keeps both decisions", async () => {
    await expect(as(rev, (tx) => answers.reinstateRevenuePresumption(tx, rev, profit))).rejects.toThrow(/Only a partner/);
    await as(partner, (tx) => answers.reinstateRevenuePresumption(tx, partner, profit));
    expect((await as(prep, (tx) => answers.getRevenuePresumption(tx, profit))).rebutted).toBe(false);
    expect(await count("planning_answers where engagement_id = $1 and question_key = 'revenue_presumption'", [profit])).toBe(2);
    await expect(as(partner, (tx) => answers.reinstateRevenuePresumption(tx, partner, profit))).rejects.toThrow(/not been rebutted/);
  });

  it("is not changed by the answers form: it is not an ordinary question", async () => {
    await expect(save(profit, partner, "revenue_presumption", "rebutted", "Trying to go around the partner check.")).rejects.toThrow(/not in the questionnaire/);
  });
});

describe("another firm", () => {
  it("sees nothing, and cannot answer, confirm or rebut", async () => {
    expect(await as(otherPartner, (tx) => answers.getQuestionnaire(tx, profit))).toBeNull();
    expect(await as(otherPartner, (tx) => answers.getPlanningOnFile(tx, profit))).toBeNull();
    expect((await as(otherPartner, (tx) => tx.query("select * from planning_answers"))).rows).toHaveLength(0);
    await expect(save(profit, otherPartner, "reliance_bank", "no")).rejects.toThrow();
    await expect(as(otherPartner, (tx) => answers.confirmPlanningMateriality(tx, otherPartner, profit, "A reasonable rationale."))).rejects.toThrow();
    await expect(as(otherPartner, (tx) => answers.rebutRevenuePresumption(tx, otherPartner, profit, "A reason that is long enough."))).rejects.toThrow();
  });
});
