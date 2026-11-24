import { describe, expect, it } from "vitest";
import { derivePlanning, type PlanningAccount } from "../src/domain/planning";
import { DEFAULT_PLANNING_SETTINGS } from "../src/domain/planning-settings";
import {
  answerState,
  autoAnswers,
  buildRationale,
  buildSections,
  checkValue,
  coveredInQuestionnaire,
  mandatoryOpen,
  planningAnswersOf,
  QUESTIONNAIRE_DRAFT,
  revenueRatingFlag,
  REVENUE_FLAG_TEXT,
  SECTIONS,
  STATIC_QUESTIONS,
  valuesInForce,
  type StoredAnswerView,
} from "../src/domain/planning-questions";

// Invented accounts only. Amounts in whole currency units, debit positive.
const acc = (code: string, name: string, groupCode: string | null, cur: number, pri: number | null): PlanningAccount => ({ code, name, closingMinor: cur * 100, priorMinor: pri === null ? null : pri * 100, groupCode });
const BASE: PlanningAccount[] = [
  acc("4000", "Sales", "REVENUE", -1000000, -900000),
  acc("5000", "Purchases", "COS", 600000, 540000),
  acc("6000", "Salaries", "STAFF", 150000, 140000),
  acc("6100", "Office costs", "ADMIN", 100000, 95000),
  acc("1000", "Bank", "CASH", 300000, 280000),
  acc("1100", "Trade receivables", "TRADEREC", 200000, 190000),
  acc("1200", "Inventory", "INVENT", 150000, 140000),
  acc("1500", "Equipment", "PPE", 350000, 330000),
  acc("2000", "Trade payables", "TRADEPAY", -250000, -240000),
  acc("2200", "Bank loan", "BORROW", -100000, -120000),
  acc("3000", "Share capital", "CAPITAL", -100000, -100000),
  acc("3200", "Retained earnings", "RETAINED", -400000, -380000),
];
const LOSS = BASE.map((a) => (a.code === "4000" ? { ...a, closingMinor: -800000 * 100 } : a));
const stored = (key: string, value: string, over: Partial<StoredAnswerView> = {}): StoredAnswerView => ({ key, value, source: "person", reason: null, by: "A Partner", at: "2025-03-01", ...over });
const sectionsOf = (accounts: PlanningAccount[], answers: StoredAnswerView[] = [], settings = DEFAULT_PLANNING_SETTINGS) => {
  // Newest first, as the server returns them: the first answer for a key is the one in force.
  const current = new Map<string, StoredAnswerView>();
  for (const a of answers) if (!current.has(a.key)) current.set(a.key, a);
  const auto = autoAnswers(accounts);
  const d = derivePlanning({ accounts, answers: planningAnswersOf(valuesInForce(current, auto)), settings });
  return { d, sections: buildSections(d, current, answers, auto) };
};
const questionsOf = (sections: ReturnType<typeof sectionsOf>["sections"]) => sections.flatMap((s) => s.questions);

describe("the answers the app fills in", () => {
  it("suggests a first year only when the trial balance has no prior-year balances", () => {
    expect(autoAnswers(BASE).first_year).toBeUndefined();
    const noPrior = BASE.map((a) => ({ ...a, priorMinor: null }));
    expect(autoAnswers(noPrior).first_year).toMatchObject({ value: "yes" });
    expect(autoAnswers(noPrior).first_year.source).toContain("no prior-year balances");
    expect(autoAnswers([]).first_year).toBeUndefined();
  });

  it("defaults controls reliance to no (a substantive approach), with its source", () => {
    expect(autoAnswers(BASE).controls_reliance).toMatchObject({ value: "no" });
    expect(autoAnswers(BASE).controls_reliance.source).toContain("ISA 330");
  });

  it("fills in the related-party balances from the related-party lead sheets, and only when there are some", () => {
    expect(autoAnswers(BASE).rp_balances).toBeUndefined();
    const withRp = [...BASE, acc("1300", "Due from a shareholder", "RPREC", 30000, 0), acc("2300", "Due to a director", "RPPAY", -12000, 0)];
    const rp = autoAnswers(withRp).rp_balances;
    expect(rp.value).toContain("due from related parties");
    expect(rp.value).toContain("due to related parties");
    expect(rp.source).toContain("related-party lead sheets");
  });

  it("is not an answer until a person confirms it", () => {
    const auto = { value: "no", source: "default" };
    expect(answerState(null, auto)).toBe("suggested");
    expect(answerState(null, null)).toBe("unanswered");
    expect(answerState(stored("controls_reliance", "no", { source: "auto" }), auto)).toBe("confirmed");
    expect(answerState(stored("controls_reliance", "yes", { reason: "We plan to test the sales controls." }), auto)).toBe("overridden");
    expect(answerState(stored("reliance_bank", "yes"), null)).toBe("answered");
  });
});

describe("the answers that move the suggestion", () => {
  it("map to the derivation's inputs, and leave out what has not been answered", () => {
    expect(planningAnswersOf({})).toEqual({});
    expect(planningAnswersOf({ entity_type: "holding", reliance_bank: "yes", first_year: "no", prior_misstatements: "yes", prior_adjustments: "yes", control_concerns: "no" })).toEqual({
      entityType: "holding",
      reliedOnByBank: true,
      firstYear: false,
      priorMisstatements: true,
      priorAdjustmentsAboveTrivial: true,
      controlConcerns: false,
    });
    expect(planningAnswersOf({ entity_type: "nonsense" })).toEqual({});
  });

  it("change the suggested benchmark, percentage and performance materiality", () => {
    const plain = sectionsOf(BASE).d;
    const risky = sectionsOf(BASE, [stored("first_year", "yes"), stored("reliance_bank", "yes"), stored("entity_type", "holding")]).d;
    expect(plain.percentage!.position).toBe("middle");
    expect(risky.percentage!.position).toBe("low end");
    expect(risky.performance.reduced).toBe(true);
    expect(risky.benchmark!.benchmark).toBe("equity");
  });
});

describe("the sections and the mandatory questions", () => {
  it("are sections 1, 8, 9, 10 and 11, each naming the standards by number", () => {
    expect(SECTIONS.map((s) => s.n)).toEqual([1, 8, 9, 10, 11]);
    for (const s of SECTIONS) expect(s.standards).toMatch(/^ISA \d+/);
    expect(new Set(STATIC_QUESTIONS.map((q) => q.key)).size).toBe(STATIC_QUESTIONS.length);
  });

  it("show no going-concern questions, and none mandatory, when no trigger indicator is found", () => {
    const { sections } = sectionsOf(BASE);
    expect(sections.find((s) => s.n === 8)!.questions).toEqual([]);
    expect(mandatoryOpen(sections)).toEqual([]);
  });

  it("make the going-concern questions, and the question of the indicator found, mandatory on a trigger", () => {
    const { sections, d } = sectionsOf(LOSS);
    expect(d.goingConcern.required).toBe(true);
    const gc = sections.find((s) => s.n === 8)!.questions;
    expect(gc.map((q) => q.key)).toEqual(expect.arrayContaining(["gc_assessment", "gc_period", "gc_support", "ind_loss"]));
    expect(gc.every((q) => q.mandatory)).toBe(true);
    expect(mandatoryOpen(sections).length).toBe(gc.length);
  });

  it("put the question of an indicator that is not a trigger in section 10, not mandatory", () => {
    const rp = [...BASE, acc("1300", "Due from a shareholder", "RPREC", 30000, 0)];
    const { sections, d } = sectionsOf(rp);
    expect(d.goingConcern.required).toBe(false);
    const q = questionsOf(sections).find((x) => x.key === "ind_related_parties")!;
    expect(q.section).toBe(10);
    expect(q.mandatory).toBe(false);
    expect(mandatoryOpen(sections)).toEqual([]);
  });

  it("follow the firm's list of triggers", () => {
    const rp = [...BASE, acc("1300", "Due from a shareholder", "RPREC", 30000, 0)];
    const { sections } = sectionsOf(rp, [], { ...DEFAULT_PLANNING_SETTINGS, goingConcernTriggers: ["related_parties"] });
    expect(questionsOf(sections).find((x) => x.key === "ind_related_parties")).toMatchObject({ section: 8, mandatory: true });
    const none = sectionsOf(LOSS, [], { ...DEFAULT_PLANNING_SETTINGS, goingConcernTriggers: [] });
    expect(mandatoryOpen(none.sections)).toEqual([]);
    expect(questionsOf(none.sections).find((x) => x.key === "ind_loss")).toMatchObject({ section: 10, mandatory: false });
  });

  it("count a mandatory question as answered once a person has answered it, but not when it is only suggested", () => {
    const answered = [stored("gc_assessment", "Management has a twelve month forecast."), stored("gc_period", "yes"), stored("gc_support", "A letter from the shareholder."), stored("ind_loss", "A one-off write-down.")];
    expect(mandatoryOpen(sectionsOf(LOSS, answered).sections)).toEqual([]);
    expect(mandatoryOpen(sectionsOf(LOSS, answered.slice(0, 2)).sections).map((q) => q.key)).toEqual(["gc_support", "ind_loss"]);
  });

  it("keep a section 8 question that has an answer even when the trigger is gone", () => {
    const { sections } = sectionsOf(BASE, [stored("gc_assessment", "Earlier answer.")]);
    expect(sections.find((s) => s.n === 8)!.questions.map((q) => q.key)).toEqual(["gc_assessment"]);
  });

  it("carry each question's history, newest first", () => {
    const first = stored("reliance_bank", "no", { at: "2025-03-01" });
    const second = stored("reliance_bank", "yes", { at: "2025-03-05" });
    const { sections } = sectionsOf(BASE, [second, first]);
    const q = questionsOf(sections).find((x) => x.key === "reliance_bank")!;
    expect(q.value).toBe("yes");
    expect(q.history.map((h) => h.value)).toEqual(["yes", "no"]);
  });
});

describe("checking an answer", () => {
  const yesno = STATIC_QUESTIONS.find((q) => q.key === "reliance_bank")!;
  const choice = STATIC_QUESTIONS.find((q) => q.key === "entity_type")!;
  const text = STATIC_QUESTIONS.find((q) => q.key === "industry")!;
  it("accepts what the question allows, trimmed", () => {
    expect(checkValue(yesno, " yes ")).toEqual({ ok: true, value: "yes" });
    expect(checkValue(choice, "holding")).toEqual({ ok: true, value: "holding" });
    expect(checkValue(text, "  Wholesale of tiles.  ")).toEqual({ ok: true, value: "Wholesale of tiles." });
  });
  it("refuses an empty answer, a value the question does not offer, and an answer that is too long", () => {
    expect(checkValue(text, "   ")).toMatchObject({ ok: false });
    expect(checkValue(yesno, "maybe")).toMatchObject({ ok: false });
    expect(checkValue(choice, "other")).toMatchObject({ ok: false });
    expect(checkValue(text, "x".repeat(2001))).toMatchObject({ ok: false });
  });
});

describe("the materiality rationale", () => {
  it("is built from the derivation and the answers, and stays within the limit", () => {
    const { d, sections } = sectionsOf(BASE, [stored("first_year", "yes")]);
    const values = valuesInForce(new Map([["first_year", stored("first_year", "yes")]]), autoAnswers(BASE));
    const text = buildRationale(d, values);
    expect(text).toContain("Benchmark: profit before tax");
    expect(text).toContain("Percentage:");
    expect(text).toContain("Performance materiality:");
    expect(text).toContain("Clearly trivial: 5%");
    expect(text).toContain("Is this the first audit of the entity: yes");
    expect(text).toContain("unreviewed draft");
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(sections.length).toBe(5);
  });
  it("is empty when nothing can be suggested", () => {
    const d = derivePlanning({ accounts: BASE.map((a) => ({ ...a, groupCode: null })) });
    expect(buildRationale(d, {})).toBe("");
  });
});

describe("the revenue presumption", () => {
  it("flags a C13 rating below significant for occurrence or cut-off while it stands", () => {
    expect(revenueRatingFlag("C13", { E: "moderate", CO: "significant" }, false)).toEqual(["existence and occurrence"]);
    expect(revenueRatingFlag("C13", { E: "low", CO: "high" }, false)).toEqual(["existence and occurrence", "cut-off"]);
    expect(revenueRatingFlag("C13", { E: "significant", CO: "significant", C: "low" }, false)).toEqual([]);
  });
  it("flags nothing once rebutted, for another area, or before anything is rated", () => {
    expect(revenueRatingFlag("C13", { E: "low", CO: "low" }, true)).toEqual([]);
    expect(revenueRatingFlag("C4", { E: "low" }, false)).toEqual([]);
    expect(revenueRatingFlag("C13", {}, false)).toEqual([]);
  });
  it("says it can be kept, and cites the standard by number", () => {
    const text = REVENUE_FLAG_TEXT(["cut-off"]);
    expect(text).toContain("ISA 240");
    expect(text).toContain("You can keep it");
  });
});

describe("the checklist steps the questionnaire covers", () => {
  it("point to a section or to the materiality confirmation, and say nothing for other steps", () => {
    expect(coveredInQuestionnaire("B7.02")).toEqual({ label: "the planning questionnaire, section 8", anchor: "section-8" });
    expect(coveredInQuestionnaire("B4.05")?.anchor).toBe("section-9");
    expect(coveredInQuestionnaire("B1.10")?.anchor).toBe("section-10");
    expect(coveredInQuestionnaire("B5.01")?.anchor).toBe("section-11");
    expect(coveredInQuestionnaire("B2.02")?.anchor).toBe("confirm-materiality");
    expect(coveredInQuestionnaire("B8.08")).toBeNull();
    expect(coveredInQuestionnaire("C5.01")).toBeNull();
  });
});

describe("the wording", () => {
  it("carries the unreviewed draft label and cites standards by number only", () => {
    expect(QUESTIONNAIRE_DRAFT).toContain("unreviewed draft");
    const all = [...STATIC_QUESTIONS.map((q) => `${q.label} ${q.help ?? ""}`), ...SECTIONS.map((s) => `${s.title} ${s.standards} ${s.blurb}`)].join(" ");
    for (const m of all.matchAll(/ISA\s*[\w ,]*/g)) expect(m[0]).toMatch(/^ISA \d{3}/);
    expect(all).not.toMatch(/International Standard on Auditing/);
  });
});
