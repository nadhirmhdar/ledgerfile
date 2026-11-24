import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import * as answers from "../src/server/planning-answers";
import { AREA_BY_CODE, assertionsOf } from "../src/domain/audit";

const X = "aaaaaaaa-7070-4000-8000-000000000001";
const Y = "bbbbbbbb-7070-4000-8000-000000000001";
const user = (n: number, role: repo.Session["role"], firmId = X): repo.Session => ({ firmId, userId: `${firmId.slice(0, 8)}-7070-4000-8000-00000000001${n}`, role });
const prep = user(1, "preparer");
const rev = user(2, "reviewer");
const partner = user(3, "partner");
const outsider = user(4, "partner", Y);

// Invented trial balance: revenue 1,000,000, costs 700,000, and inventories of 150,000, well above performance materiality.
const TB = [
  { code: "1000", name: "Bank - current account", closingMinor: 30000000, priorMinor: 25000000 },
  { code: "1100", name: "Trade receivables", closingMinor: 20000000, priorMinor: 18000000 },
  { code: "1300", name: "Inventories", closingMinor: 15000000, priorMinor: 14000000 },
  { code: "2000", name: "Trade payables", closingMinor: -10000000, priorMinor: -9000000 },
  { code: "3000", name: "Share capital", closingMinor: -10000000, priorMinor: -10000000 },
  { code: "4000", name: "Sales", closingMinor: -100000000, priorMinor: -90000000 },
  { code: "5000", name: "Cost of goods sold", closingMinor: 50000000, priorMinor: 45000000 },
  { code: "6100", name: "Office rent", closingMinor: 20000000, priorMinor: 18000000 },
];
const MATERIALITY = { benchmark: "revenue", percentageBp: 100, performancePct: 75, trivialPct: 5, rationale: "Revenue is the measure the owners watch." };

let db: Db;
let engagement: string;
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
const count = async (sql: string, args: unknown[] = []) => Number((await db.query<{ n: string }>(`select count(*)::text as n from ${sql}`, args)).rows[0].n);
const overview = async () => (await as(prep, (tx) => audit.getAuditOverview(tx, engagement)))!;
const rate = (code: string, level: string) => Object.fromEntries(assertionsOf(AREA_BY_CODE.get(code)!).map((a) => [a, level]));
const sig = async (code: string) => (await as(prep, (tx) => answers.getAreaSignificance(tx, engagement, [...AREA_BY_CODE.values()]))).get(code)!;
const saveSig = (s: repo.Session, code: string, value: string, reason = "") => as(s, (tx) => answers.savePlanningAnswer(tx, s, engagement, `sig_${code}`, value, reason));

beforeAll(async () => {
  db = await openDatabase();
  for (const firm of [X, Y]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [firm]);
  for (const u of [prep, rev, partner, outsider]) {
    await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-1)}`, u.role]);
  }
  await as(partner, async (tx) => {
    const client = await repo.createClient(tx, partner, "Suggest Co");
    engagement = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
    await repo.importTrialBalance(tx, partner, engagement, "tb.xlsx", TB);
    await repo.approveAllMappings(tx, partner, engagement);
    await audit.setAuditEnabled(tx, partner, engagement, true);
  });
});
afterAll(async () => {
  await db.close();
});

describe("suggested ratings", () => {
  it("come with a reason for each assertion, from the answers as well as the figures, and save nothing", async () => {
    const ratings = await count("risk_assessments where engagement_id = $1", [engagement]);
    const answered = await count("planning_answers where engagement_id = $1", [engagement]);
    const d = (await as(prep, (tx) => answers.getAnsweredDerivation(tx, engagement)))!.derivation;
    const c4 = d.areaSuggestions.filter((s) => s.areaCode === "C4");
    expect(c4.map((s) => s.assertion).sort()).toEqual(["E", "V"]);
    expect(c4.every((s) => s.level === "moderate" && s.reason.includes("performance materiality"))).toBe(true);
    expect(await count("risk_assessments where engagement_id = $1", [engagement])).toBe(ratings);
    expect(await count("planning_answers where engagement_id = $1", [engagement])).toBe(answered);
  });

  it("use the questionnaire's answers: a first year makes performance materiality lower, so more can be suggested", async () => {
    const before = (await as(prep, (tx) => answers.getAnsweredDerivation(tx, engagement)))!.derivation;
    await as(rev, (tx) => answers.savePlanningAnswer(tx, rev, engagement, "first_year", "yes"));
    const after = (await as(prep, (tx) => answers.getAnsweredDerivation(tx, engagement)))!.derivation;
    expect(after.performance.reduced).toBe(true);
    expect(after.suggested!.performanceMinor).toBeLessThan(before.suggested!.performanceMinor);
  });

  it("never overwrite an existing rating, and are never saved by looking", async () => {
    await as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, "C4", rate("C4", "low")));
    const stored = async () => (await db.query<{ assertion: string; level: string }>("select assertion, level from risk_assessments where engagement_id = $1 and area_code = 'C4' order by assertion", [engagement])).rows;
    const before = await stored();
    expect(before.every((r) => r.level === "low")).toBe(true);
    const d = (await as(prep, (tx) => answers.getAnsweredDerivation(tx, engagement)))!.derivation;
    expect(d.areaSuggestions.some((s) => s.areaCode === "C4")).toBe(true);
    await as(prep, (tx) => answers.getQuestionnaire(tx, engagement));
    expect(await stored()).toEqual(before);
    const o = await overview();
    expect(o.areas.find((a) => a.code === "C4")!.risks).toEqual(rate("C4", "low"));
  });
});

describe("significant areas", () => {
  it("are suggested from the lead sheets with a reason, and nothing is stored until a person confirms", async () => {
    const before = await count("planning_answers where engagement_id = $1 and question_key like 'sig_%'", [engagement]);
    const c4 = await sig("C4");
    expect(c4.suggested).toBe("yes");
    expect(c4.reason).toContain("performance materiality");
    expect(c4.stored).toBeNull();
    expect(await count("planning_answers where engagement_id = $1 and question_key like 'sig_%'", [engagement])).toBe(before);
  });

  it("are confirmed per area, with the source recorded, and need no reason to confirm the suggestion", async () => {
    expect(await saveSig(rev, "C4", "yes")).toBe(true);
    const c4 = await sig("C4");
    expect(c4.stored).toMatchObject({ value: "yes", source: "auto", reason: null });
    expect(c4.stored!.by).toContain("reviewer");
    expect(await saveSig(rev, "C4", "yes")).toBe(false);
  });

  it("need a reason to differ from the suggestion, and the history keeps both", async () => {
    await expect(saveSig(rev, "C4", "no")).rejects.toThrow(/Record why/);
    expect(await saveSig(rev, "C4", "no", "Inventory is held by a third party and counted at year end by us.")).toBe(true);
    const c4 = await sig("C4");
    expect(c4.stored).toMatchObject({ value: "no", source: "person", reason: "Inventory is held by a third party and counted at year end by us." });
    expect(c4.history.map((h) => `${h.value}:${h.source}`)).toEqual(["no:person", "yes:auto"]);
  });

  it("can be decided with no reason where the figures suggest nothing, and only for a real area", async () => {
    const none = [...(await as(prep, (tx) => answers.getAreaSignificance(tx, engagement, [...AREA_BY_CODE.values()]))).values()].find((s) => s.suggested === null)!;
    expect(await saveSig(prep, none.areaCode, "yes")).toBe(true);
    await expect(saveSig(prep, "C99", "yes")).rejects.toThrow(/not in the questionnaire/);
    await expect(saveSig(prep, "C4", "maybe")).rejects.toThrow(/yes or no/);
  });

  it("are another firm's business: it sees none and cannot record one", async () => {
    expect((await as(outsider, (tx) => answers.getAreaSignificance(tx, engagement, [...AREA_BY_CODE.values()]))).size).toBe(0);
    await expect(saveSig(outsider, "C4", "yes")).rejects.toThrow();
  });
});

describe("the revenue presumption and the partner's approval", () => {
  const approve = () => as(partner, (tx) => audit.approveRiskAssessment(tx, partner, engagement));
  const state = async () => (await overview()).approval.state;
  const rateAll = async () => {
    for (const area of (await overview()).areas.filter((a) => !a.assessed)) await as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, area.code, rate(area.code, "low")));
  };

  it("lapses an approval when it is rebutted, and again when it is put back", async () => {
    await as(rev, (tx) => audit.setMateriality(tx, rev, engagement, MATERIALITY));
    await rateAll();
    await approve();
    expect(await state()).toBe("current");

    await as(partner, (tx) => answers.rebutRevenuePresumption(tx, partner, engagement, "Revenue is a single long-term contract with no judgement in it."));
    expect(await state()).toBe("lapsed");

    await approve();
    expect(await state()).toBe("current");

    await as(partner, (tx) => answers.reinstateRevenuePresumption(tx, partner, engagement));
    expect(await state()).toBe("lapsed");

    await approve();
    expect(await state()).toBe("current");
  });

  it("is not disturbed by anything that does not change it: answering a question leaves the approval current", async () => {
    await as(rev, (tx) => answers.savePlanningAnswer(tx, rev, engagement, "industry", "Wholesale of building materials."));
    await saveSig(rev, "C5", "yes");
    expect(await state()).toBe("current");
  });
});
