import { describe, expect, it } from "vitest";
import { BENCHMARKS, computeMateriality, DEFAULT_GUIDE } from "../src/domain/audit";
import { derivePlanning, type DerivationInput, type PlanningAccount } from "../src/domain/planning";
import { BENCHMARK_ORDER, checkPlanningSettings, DEFAULT_PLANNING_SETTINGS, guideRangesOf, isDefault, type PlanningSettings } from "../src/domain/planning-settings";

// Invented accounts only. Amounts are in minor units, debit positive; "cur" and "pri" are the current and prior year balances (whole currency units).
const acc = (code: string, name: string, groupCode: string | null, cur: number, pri: number | null): PlanningAccount => ({ code, name, closingMinor: cur * 100, priorMinor: pri === null ? null : pri * 100, groupCode });

/** A profitable trading company: revenue 1,000,000, profit before tax 150,000 (125,000 last year), balanced. */
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
const derive = (accounts: PlanningAccount[], extra: Partial<DerivationInput> = {}) => derivePlanning({ accounts, ...extra });
const change = (code: string, cur: number, pri?: number) => BASE.map((a) => (a.code === code ? { ...a, closingMinor: cur * 100, priorMinor: pri === undefined ? a.priorMinor : pri * 100 } : a));
const indicator = (d: ReturnType<typeof derive>, key: string) => d.indicators.find((i) => i.key === key)!;
const settings = (over: Partial<PlanningSettings>): PlanningSettings => ({ ...DEFAULT_PLANNING_SETTINGS, ...over });

describe("the figures", () => {
  it("are worked out from the adjusted balances, current and prior, each with the lead sheets behind it and its source", () => {
    const d = derive(BASE);
    const by = Object.fromEntries(d.figures.map((f) => [f.key, f]));
    expect([by.revenue.current, by.revenue.prior]).toEqual([100000000, 90000000]);
    expect([by.pbt.current, by.pbt.prior]).toEqual([15000000, 12500000]);
    expect([by.expenses.current, by.expenses.prior]).toEqual([85000000, 77500000]);
    expect([by.assets.current, by.assets.prior]).toEqual([100000000, 94000000]);
    // Equity includes the year's profit: 100,000 capital + 400,000 retained + 150,000 profit (prior 100,000 + 380,000 + 125,000).
    expect([by.equity.current, by.equity.prior]).toEqual([65000000, 60500000]);
    expect(by.revenue.leadSheets).toEqual(["REVENUE"]);
    expect(by.expenses.leadSheets).toEqual(["COS", "STAFF", "DEPN", "ADMIN", "FINCOST"]);
    for (const f of d.figures) expect(f.source).toContain("adjusted trial balance");
  });

  it("are empty, with nothing suggested, when nothing is mapped", () => {
    const d = derive(BASE.map((a) => ({ ...a, groupCode: null })));
    expect(d.empty).toBe(true);
    expect([d.benchmark, d.percentage, d.suggested]).toEqual([null, null, null]);
    expect(d.notes[0]).toContain("no mapped trial balance");
    expect(derive([]).empty).toBe(true);
  });
});

describe("the benchmark", () => {
  it("is profit before tax when the entity is profitable and stable, with the reason", () => {
    const d = derive(BASE);
    expect(d.benchmark).toMatchObject({ benchmark: "pbt", amountMinor: 15000000 });
    expect(d.benchmark!.reason).toContain("profitable and its profit is stable");
    expect(d.benchmark!.reason).toContain("ISA 320");
  });

  it("is revenue for a loss", () => {
    const d = derive(change("4000", -800000));
    expect(d.benchmark).toMatchObject({ benchmark: "revenue", amountMinor: 80000000 });
    expect(d.benchmark!.reason).toContain("loss before tax");
  });

  it("is revenue near break-even (profit under 2% of revenue)", () => {
    const d = derive(change("4000", -855000)); // profit 5,000: 0.58% of revenue
    expect(d.benchmark!.benchmark).toBe("revenue");
    expect(d.benchmark!.reason).toContain("close to break-even");
    expect(derive(change("4000", -880000, -805000)).benchmark!.benchmark).toBe("pbt"); // profit 30,000, 3.4%, and 30,000 last year
  });

  it("is revenue when profit before tax moved by more than 50% on the prior year", () => {
    const d = derive(change("4000", -1000000, -700000)); // prior profit would be 700,000 - 775,000 = a loss, so use prior costs
    expect(["revenue", "pbt"]).toContain(d.benchmark!.benchmark);
    const moved = derive(BASE.map((a) => (a.code === "4000" ? { ...a, priorMinor: -760000 * 100 } : a)));
    expect(moved.benchmark!.benchmark).toBe("revenue");
    expect(moved.benchmark!.reason).toContain("moved by more than 50%");
    const steady = derive(BASE.map((a) => (a.code === "4000" ? { ...a, priorMinor: -880000 * 100 } : a)));
    expect(steady.benchmark!.benchmark).toBe("pbt");
  });

  it("does not test the movement when there is no prior year, and says so", () => {
    const d = derive(BASE.map((a) => ({ ...a, priorMinor: null })));
    expect(d.benchmark!.benchmark).toBe("pbt");
    expect(d.benchmark!.reason).toContain("no prior year to compare");
  });

  it("follows the entity type when it is known: expenses, assets or equity", () => {
    expect(derive(BASE, { answers: { entityType: "not_for_profit" } }).benchmark).toMatchObject({ benchmark: "expenses", amountMinor: 85000000 });
    expect(derive(BASE, { answers: { entityType: "asset_holding" } }).benchmark).toMatchObject({ benchmark: "assets", amountMinor: 100000000 });
    expect(derive(BASE, { answers: { entityType: "holding" } }).benchmark).toMatchObject({ benchmark: "equity", amountMinor: 65000000 });
    expect(derive(BASE, { answers: { entityType: "trading" } }).benchmark!.benchmark).toBe("pbt");
  });

  it("falls back to a benchmark that has a figure, and says why, when the chosen one is nil", () => {
    const noProfit = derive(BASE.filter((a) => !["REVENUE", "COS", "STAFF", "ADMIN"].includes(a.groupCode!)), { answers: { entityType: "not_for_profit" } });
    expect(noProfit.benchmark!.benchmark).toBe("assets");
    expect(noProfit.benchmark!.reason).toContain("is nil");
  });

  it("lists every benchmark's figure so a person can see what was not chosen", () => {
    expect(derive(BASE).benchmark!.figures).toEqual({ pbt: 15000000, revenue: 100000000, expenses: 85000000, assets: 100000000, equity: 65000000 });
  });
});

describe("the percentage and performance materiality", () => {
  it("starts in the middle of the firm's range, and moves to the low end for each risk answer", () => {
    expect(derive(BASE).percentage).toMatchObject({ bp: 750, position: "middle", minBp: 500, maxBp: 1000 });
    for (const answer of ["reliedOnByBank", "firstYear", "priorMisstatements"] as const) {
      const d = derive(BASE, { answers: { [answer]: true } });
      expect(d.percentage, answer).toMatchObject({ bp: 500, position: "low end" });
      expect(d.percentage!.reasons[0]).toContain("low end");
    }
    expect(derive(BASE, { answers: { reliedOnByBank: true, firstYear: true } }).percentage!.reasons[0]).toContain("a bank relies on the statements, it is a first-year audit");
  });

  it("uses each benchmark's own range", () => {
    expect(derive(BASE, { answers: { entityType: "holding" } }).percentage).toMatchObject({ bp: 350, minBp: 200, maxBp: 500 });
    expect(derive(change("4000", -800000)).percentage).toMatchObject({ bp: 125, minBp: 50, maxBp: 200 });
  });

  it("is 75% by default and 50 to 60% (the middle, 55) for a first year, prior adjustments above trivial, or control concerns", () => {
    expect(derive(BASE).performance).toMatchObject({ pct: 75, reduced: false });
    for (const answer of ["firstYear", "priorAdjustmentsAboveTrivial", "controlConcerns"] as const) {
      expect(derive(BASE, { answers: { [answer]: true } }).performance, answer).toMatchObject({ pct: 55, reduced: true });
    }
  });

  it("gives the suggested overall, performance and trivial figures", () => {
    const d = derive(BASE);
    expect(d.suggested).toEqual({ overallMinor: 1125000, performanceMinor: 843750, trivialMinor: 56250, trivialPct: 5 });
    expect(derive(BASE, { answers: { firstYear: true } }).suggested).toEqual({ overallMinor: 750000, performanceMinor: 412500, trivialMinor: 37500, trivialPct: 5 });
  });

  it("reads the firm's settings", () => {
    const custom = settings({ percentages: { ...DEFAULT_PLANNING_SETTINGS.percentages, pbt: { minBp: 300, maxBp: 700 } }, performance: { ...DEFAULT_PLANNING_SETTINGS.performance, defaultPct: 70 }, trivial: { pct: 4, maxPct: 5 } });
    expect(derive(BASE, { settings: custom }).suggested).toEqual({ overallMinor: 750000, performanceMinor: 525000, trivialMinor: 30000, trivialPct: 4 });
  });
});

describe("significant areas", () => {
  it("suggests a lead sheet significant when a balance or the movement is at or above performance materiality in either year", () => {
    const d = derive(BASE);
    const verdict = (g: string) => d.significant.find((s) => s.groupCode === g)!;
    expect(d.suggested!.performanceMinor).toBe(843750); // 8,437.50
    expect(verdict("REVENUE").verdict).toBe("significant");
    expect(verdict("CASH").verdict).toBe("significant");
    expect(verdict("REVENUE").reason).toContain("at or above performance materiality");
    // A small balance, with a large prior-year balance, is still significant.
    const prior = derive(change("1200", 1000, 500000)).significant.find((s) => s.groupCode === "INVENT")!;
    expect(prior.verdict).toBe("significant");
    // A movement alone is enough.
    const moved = derive(BASE.map((a) => (a.code === "1200" ? { ...a, closingMinor: 20000 * 100, priorMinor: 5000 * 100 } : a))).significant.find((s) => s.groupCode === "INVENT")!;
    expect(moved.verdict).toBe("significant");
  });

  it("suggests a lead sheet below the trivial figure in both years as not significant, and leaves the rest as a judgement", () => {
    const d = derive([...BASE, acc("1900", "Prepaid sundry", "TRADEREC", 0, 0)].map((a) => (a.code === "1100" ? { ...a, closingMinor: 300 * 100, priorMinor: 200 * 100 } : a)).map((a) => (a.code === "1000" ? { ...a, closingMinor: 700000, priorMinor: 700000 } : a)));
    const trivial = d.suggested!.trivialMinor;
    expect(trivial).toBeGreaterThan(30000);
    const receivables = d.significant.find((s) => s.groupCode === "TRADEREC")!;
    expect(receivables).toMatchObject({ verdict: "not_significant" });
    expect(receivables.reason).toContain("Below the clearly trivial threshold");
    const between = derive(BASE.map((a) => (a.code === "1200" ? { ...a, closingMinor: 20000 * 100 * 0 + 300000, priorMinor: 300000 } : a))).significant.find((s) => s.groupCode === "INVENT")!;
    expect(between.verdict).toBe("judgement");
  });

  it("is empty until there is a performance materiality to compare with", () => {
    expect(derive(BASE.map((a) => ({ ...a, groupCode: null }))).significant).toEqual([]);
  });
});

describe("the indicators", () => {
  const hit = (d: ReturnType<typeof derive>, key: string) => indicator(d, key).hit;

  it("lists all ten, each with what was found or checked and a question", () => {
    const d = derive(BASE);
    expect(d.indicators.map((i) => i.key)).toEqual(["loss", "negative_equity", "net_current_liabilities", "overdraft", "borrowings_against_cash", "related_parties", "suspense_unmapped", "large_movement", "revenue_down", "margin_swing"]);
    expect(d.indicators.every((i) => i.detail.length > 10 && i.question.length > 10 && !i.hit)).toBe(true);
    expect(d.goingConcern).toEqual({ required: false, hits: [] });
  });

  it("a loss, and negative equity", () => {
    expect(hit(derive(change("4000", -800000)), "loss")).toBe(true);
    const negative = derive(change("3200", 500000, -380000)); // equity: 100,000 - 500,000 + 150,000 profit
    expect(hit(negative, "negative_equity")).toBe(true);
    expect(indicator(negative, "negative_equity").detail).toContain("negative");
  });

  it("net current liabilities", () => {
    expect(hit(derive(change("2000", -700000)), "net_current_liabilities")).toBe(true);
    expect(hit(derive(BASE), "net_current_liabilities")).toBe(false);
  });

  it("a bank overdraft, by a credit balance on a bank account or an account named overdraft", () => {
    expect(hit(derive(change("1000", -20000)), "overdraft")).toBe(true);
    expect(hit(derive([...BASE, acc("2210", "Bank overdraft", "BORROW", -5000, 0)]), "overdraft")).toBe(true);
  });

  it("borrowings against cash: borrowings above cash and bank balances", () => {
    const d = derive(change("2200", -400000));
    expect(hit(d, "borrowings_against_cash")).toBe(true);
    expect(indicator(d, "borrowings_against_cash").detail).toContain("more than cash");
    expect(hit(derive(BASE), "borrowings_against_cash")).toBe(false);
  });

  it("related-party balances above performance materiality, in either year", () => {
    expect(hit(derive([...BASE, acc("1300", "Due from a shareholder", "RPREC", 20000, 0)]), "related_parties")).toBe(true);
    expect(hit(derive([...BASE, acc("2300", "Due to a director", "RPPAY", 0, -20000)]), "related_parties")).toBe(true);
    expect(hit(derive([...BASE, acc("1300", "Due from a shareholder", "RPREC", 100, 0)]), "related_parties")).toBe(false);
  });

  it("suspense, unmapped or unbalanced items", () => {
    expect(hit(derive([...BASE, acc("9999", "Suspense account", "ADMIN", 500, 0)]), "suspense_unmapped")).toBe(true);
    expect(hit(derive([...BASE, acc("7000", "Mystery", null, 0, 0)]), "suspense_unmapped")).toBe(true);
    const out = derive(change("1000", 300001));
    expect(hit(out, "suspense_unmapped")).toBe(true);
    expect(indicator(out, "suspense_unmapped").detail).toContain("out by");
  });

  it("a line moving more than 25% and more than performance materiality", () => {
    const d = derive(BASE.map((a) => (a.code === "1200" ? { ...a, closingMinor: 300000 * 100, priorMinor: 140000 * 100 } : a)));
    expect(hit(d, "large_movement")).toBe(true);
    expect(indicator(d, "large_movement").leadSheets).toContain("INVENT");
    // A big percentage on a small balance is not enough.
    expect(hit(derive(BASE.map((a) => (a.code === "1200" ? { ...a, closingMinor: 3000 * 100, priorMinor: 1000 * 100 } : a))), "large_movement")).toBe(false);
  });

  it("revenue down more than 20%", () => {
    expect(hit(derive(change("4000", -700000)), "revenue_down")).toBe(true);
    expect(hit(derive(change("4000", -800000)), "revenue_down")).toBe(false); // exactly 11%
    expect(indicator(derive(BASE.map((a) => ({ ...a, priorMinor: null }))), "revenue_down").detail).toContain("no prior-year revenue");
  });

  it("a gross margin swing of more than 5 points", () => {
    // Margin was 40% (cost of sales 540,000 on 900,000); now cost of sales is 700,000 on 1,000,000 = 30%.
    const d = derive(change("5000", 700000));
    expect(hit(d, "margin_swing")).toBe(true);
    expect(indicator(d, "margin_swing").detail).toContain("points");
    expect(hit(derive(change("5000", 595000)), "margin_swing")).toBe(false);
  });

  it("any hit makes the going-concern questions mandatory, and lists the hits", () => {
    const d = derive(change("4000", -800000));
    expect(d.goingConcern.required).toBe(true);
    expect(d.goingConcern.hits).toContain("A loss");
  });

  it("reads the firm's thresholds", () => {
    const strict = settings({ thresholds: { ...DEFAULT_PLANNING_SETTINGS.thresholds, revenueDropPct: 5 } });
    expect(hit(derive(change("4000", -800000), { settings: strict }), "revenue_down")).toBe(true);
  });
});

describe("the fraud presumptions and the area suggestions", () => {
  it("always shows revenue (C13) and management override (C16), by ISA number only", () => {
    const d = derive(BASE);
    expect(d.presumedRisks.map((r) => r.areaCode)).toEqual(["C13", "C16"]);
    expect(d.presumedRisks[0].text).toContain("rebut");
    expect(d.presumedRisks.every((r) => r.text.includes("ISA 240"))).toBe(true);
  });

  it("suggests moderate for inventory above performance materiality (existence and valuation), related parties, and borrowings valuation on a going-concern hit", () => {
    const d = derive([...change("4000", -800000), acc("1300", "Due from a shareholder", "RPREC", 30000, 0)]);
    const keys = d.areaSuggestions.map((a) => `${a.areaCode}:${a.assertion}`);
    expect(keys).toEqual(expect.arrayContaining(["C4:E", "C4:V", "C7:C", "C7:P", "C9:V"]));
    expect(d.areaSuggestions.every((a) => a.level === "moderate" && a.reason.length > 20)).toBe(true);
  });

  it("suggests nothing when no indicator calls for it", () => {
    const quiet = derive(BASE);
    expect(quiet.goingConcern.required).toBe(false);
    expect(quiet.areaSuggestions.map((a) => a.areaCode)).not.toContain("C7");
    expect(quiet.areaSuggestions.map((a) => a.areaCode)).not.toContain("C9");
  });

  it("only suggests assertions the library's area covers (so an assessed area stays assessed)", () => {
    const d = derive([...change("4000", -800000), acc("1300", "Due from a shareholder", "RPREC", 30000, 0)]);
    for (const a of d.areaSuggestions) expect(["C", "A", "E", "CO", "V", "R", "CL", "P"]).toContain(a.assertion);
  });
});

describe("the planning settings", () => {
  it("default to today's materiality constants: the guide ranges, the performance range and the trivial maximum", () => {
    expect(isDefault(DEFAULT_PLANNING_SETTINGS)).toBe(true);
    expect(guideRangesOf(DEFAULT_PLANNING_SETTINGS)).toEqual(DEFAULT_GUIDE);
    expect(DEFAULT_GUIDE.benchmarks).toMatchObject({ pbt: { minBp: 500, maxBp: 1000 }, revenue: { minBp: 50, maxBp: 200 }, assets: { minBp: 100, maxBp: 200 }, equity: { minBp: 200, maxBp: 500 }, expenses: { minBp: 50, maxBp: 200 } });
    expect(DEFAULT_GUIDE.performance).toEqual({ min: 50, max: 75 });
    expect(DEFAULT_GUIDE.trivialMax).toBe(5);
    expect(BENCHMARK_ORDER.every((b) => BENCHMARKS[b])).toBe(true);
  });

  it("leave materiality exactly as it was with the default settings", () => {
    const input = { benchmark: "pbt" as const, benchmarkAmountMinor: 100000000, percentageBp: 1500, performancePct: 90, trivialPct: 10 };
    expect(computeMateriality(input, guideRangesOf(DEFAULT_PLANNING_SETTINGS))).toEqual(computeMateriality(input));
    expect(computeMateriality(input).warnings).toHaveLength(3);
    const expenses = computeMateriality({ ...input, benchmark: "expenses" });
    expect(expenses.warnings[0]).toContain("total expenses");
  });

  it("change the guide warnings when the firm edits the ranges", () => {
    const wide = settings({ percentages: { ...DEFAULT_PLANNING_SETTINGS.percentages, pbt: { minBp: 500, maxBp: 2000 } }, performance: { ...DEFAULT_PLANNING_SETTINGS.performance, guideMaxPct: 90 }, trivial: { pct: 5, maxPct: 10 } });
    const input = { benchmark: "pbt" as const, benchmarkAmountMinor: 100000000, percentageBp: 1500, performancePct: 90, trivialPct: 10 };
    expect(computeMateriality(input, guideRangesOf(wide)).warnings).toEqual([]);
  });

  it("are completed with the defaults, and every number is checked", () => {
    expect(checkPlanningSettings({})).toEqual({ ok: true, value: DEFAULT_PLANNING_SETTINGS });
    expect(checkPlanningSettings(null)).toMatchObject({ ok: true });
    const partial = checkPlanningSettings({ thresholds: { movementPct: 30 } });
    expect(partial).toMatchObject({ ok: true, value: { thresholds: { movementPct: 30, revenueDropPct: 20 } } });
    expect(checkPlanningSettings({ percentages: { pbt: { minBp: 900, maxBp: 500 } } })).toEqual({ ok: false, message: "The lowest percentage for profit before tax is above the highest." });
    expect(checkPlanningSettings({ percentages: { revenue: { minBp: 0, maxBp: 100 } } })).toMatchObject({ ok: false });
    expect(checkPlanningSettings({ percentages: { revenue: { minBp: 50.5, maxBp: 100 } } })).toMatchObject({ ok: false });
    expect(checkPlanningSettings({ performance: { defaultPct: 101 } })).toMatchObject({ ok: false });
    expect(checkPlanningSettings({ performance: { reducedMinPct: 70, reducedMaxPct: 60 } })).toMatchObject({ ok: false });
    expect(checkPlanningSettings({ trivial: { pct: 0 } })).toMatchObject({ ok: false });
    expect(checkPlanningSettings({ thresholds: { movementPct: Number.NaN } })).toMatchObject({ ok: false, message: expect.stringContaining("line movement") });
  });
});
