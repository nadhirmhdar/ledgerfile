import { AREA_BY_CODE, assertionsOf, BENCHMARKS, EXPENSE_BENCHMARK_GROUPS, type Benchmark } from "./audit";
import { formatAmount } from "./money";
import { buildLeadSheets, variancePct } from "./leadsheet";
import { DEFAULT_PLANNING_SETTINGS, type PlanningSettings } from "./planning-settings";
import { buildStatements, type StatementOptions } from "./statements";

/**
 * The planning assistant's derivation: from the engagement's adjusted, mapped balances, the answers given so far and the firm's settings, the figures, a
 * suggested benchmark and materiality, the significant areas, the indicators and the area risk suggestions, each with its source and a plain reason.
 * Pure, and it saves nothing: a person confirms every suggestion through the existing forms. All wording here is an unreviewed draft and cites a standard by
 * number only.
 */

/** What a person has answered so far. Every field is optional: no answer is the default. */
export interface PlanningAnswers {
  /** The kind of entity, which can change the benchmark. Not set means an ordinary trading entity. */
  entityType?: "trading" | "not_for_profit" | "asset_holding" | "holding";
  /** The statements are relied on by a bank. */
  reliedOnByBank?: boolean;
  /** The first audit of this entity. */
  firstYear?: boolean;
  /** Misstatements were found in the prior year. */
  priorMisstatements?: boolean;
  /** Prior-year adjustments or misstatements exceeded the trivial threshold. */
  priorAdjustmentsAboveTrivial?: boolean;
  /** There are concerns about the entity's controls. */
  controlConcerns?: boolean;
}

export interface PlanningAccount {
  code: string;
  name: string;
  /** Adjusted closing balance in minor units, debit positive. */
  closingMinor: number;
  priorMinor: number | null;
  groupCode: string | null;
}

export interface DerivationInput {
  accounts: PlanningAccount[];
  answers?: PlanningAnswers;
  settings?: PlanningSettings;
  statementOptions?: StatementOptions;
}

export interface Figure {
  key: "revenue" | "pbt" | "expenses" | "assets" | "equity";
  label: string;
  /** Presentation sign: profit, assets and equity positive when normal. */
  current: number;
  prior: number;
  /** The lead sheets (group codes) the figure comes from. */
  leadSheets: string[];
  source: string;
}

export interface BenchmarkSuggestion {
  benchmark: Benchmark;
  amountMinor: number;
  reason: string;
  /** What each benchmark's figure is, so a person can see what was not chosen. */
  figures: Record<Benchmark, number>;
}

export interface PercentageSuggestion {
  bp: number;
  minBp: number;
  maxBp: number;
  position: "middle" | "low end";
  reasons: string[];
}

export interface PerformanceSuggestion {
  pct: number;
  reduced: boolean;
  reasons: string[];
}

export type Verdict = "significant" | "not_significant" | "judgement";
export interface SignificantArea {
  groupCode: string;
  name: string;
  current: number;
  prior: number;
  verdict: Verdict;
  reason: string;
}

export interface Indicator {
  key: string;
  label: string;
  hit: boolean;
  /** What was found (or, when not hit, what was checked). */
  detail: string;
  /** The question a hit opens, for the questionnaire. */
  question: string;
  leadSheets: string[];
}

export interface AreaSuggestion {
  areaCode: string;
  assertion: string;
  level: "moderate";
  reason: string;
}

export interface Derivation {
  figures: Figure[];
  /** True when there are no figures to plan from (no trial balance, or nothing mapped). */
  empty: boolean;
  benchmark: BenchmarkSuggestion | null;
  percentage: PercentageSuggestion | null;
  performance: PerformanceSuggestion;
  suggested: { overallMinor: number; performanceMinor: number; trivialMinor: number; trivialPct: number } | null;
  significant: SignificantArea[];
  indicators: Indicator[];
  goingConcern: { required: boolean; hits: string[] };
  presumedRisks: { areaCode: string; text: string; source: string }[];
  areaSuggestions: AreaSuggestion[];
  notes: string[];
}

const SOURCE = "Worked out from the adjusted trial balance";
const SCI_GROUPS = ["REVENUE", "COS", "OTHERINC", "STAFF", "DEPN", "ADMIN", "FINCOST", "TAXEXP"];
const ASSET_GROUPS = ["PPE", "INTANG", "INVEST", "INVENT", "TRADEREC", "RPREC", "CASH"];
const EQUITY_GROUPS = ["CAPITAL", "RESERVES", "RETAINED", "OWNERCA"];
const SUSPENSE = /suspense|clearing|unallocated|unidentified|unreconciled/i;
const OVERDRAFT = /overdraft/i;

const pct = (n: number) => `${Math.round(n * 10) / 10}%`;
const money = (minor: number) => formatAmount(Math.abs(minor));

/** The one entry point. */
export function derivePlanning(input: DerivationInput): Derivation {
  const settings = input.settings ?? DEFAULT_PLANNING_SETTINGS;
  const answers = input.answers ?? {};
  const t = settings.thresholds;
  const notes: string[] = [];

  const mapped = input.accounts.filter((a) => a.groupCode !== null);
  const sheets = buildLeadSheets(input.accounts.map((a) => ({ code: a.code, name: a.name, closingMinor: a.closingMinor, priorMinor: a.priorMinor, groupCode: a.groupCode })));
  const sheetOf = (code: string) => sheets.sheets.find((s) => s.groupCode === code);
  const bal = (code: string) => sheetOf(code)?.closingMinor ?? 0;
  const prior = (code: string) => sheetOf(code)?.priorMinor ?? 0;
  const statements = buildStatements(input.accounts.map((a) => ({ groupCode: a.groupCode, closingMinor: a.closingMinor, priorMinor: a.priorMinor, approved: true })), input.statementOptions);
  const line = (key: string) => statements.comprehensiveIncome.find((l) => l.key === key);
  const sfpLine = (key: string) => statements.financialPosition.flatMap((s) => s.lines).find((l) => l.key === key);
  const cur = (l?: { current: number }) => l?.current ?? 0;
  const pri = (l?: { prior: number }) => l?.prior ?? 0;

  // --- Item 2: the figures ---------------------------------------------------------------------------------------------------------
  const expensesCur = EXPENSE_BENCHMARK_GROUPS.reduce((n, g) => n + bal(g), 0);
  const expensesPrior = EXPENSE_BENCHMARK_GROUPS.reduce((n, g) => n + prior(g), 0);
  const figures: Figure[] = [
    { key: "revenue", label: "Revenue", current: cur(line("REVENUE")), prior: pri(line("REVENUE")), leadSheets: ["REVENUE"], source: `${SOURCE}: the revenue lead sheet.` },
    { key: "pbt", label: "Profit before tax", current: cur(line("PBT")), prior: pri(line("PBT")), leadSheets: SCI_GROUPS.filter((g) => g !== "TAXEXP"), source: `${SOURCE}: income less expenses before tax.` },
    { key: "expenses", label: "Total expenses", current: expensesCur, prior: expensesPrior, leadSheets: EXPENSE_BENCHMARK_GROUPS, source: `${SOURCE}: cost of sales, staff, depreciation, administrative and finance costs.` },
    { key: "assets", label: "Total assets", current: cur(sfpLine("TOTAL_ASSETS")), prior: pri(sfpLine("TOTAL_ASSETS")), leadSheets: ASSET_GROUPS, source: `${SOURCE}: the asset lead sheets.` },
    { key: "equity", label: "Total equity", current: cur(sfpLine("TOTAL_EQUITY")), prior: pri(sfpLine("TOTAL_EQUITY")), leadSheets: EQUITY_GROUPS, source: `${SOURCE}: the equity lead sheets.` },
  ];
  const fig = (key: Figure["key"]) => figures.find((f) => f.key === key)!;
  const revenue = fig("revenue");
  const pbt = fig("pbt");
  const empty = mapped.length === 0;
  const hasPrior = input.accounts.some((a) => (a.priorMinor ?? 0) !== 0);

  const absFigures: Record<Benchmark, number> = {
    pbt: Math.abs(pbt.current),
    revenue: Math.abs(revenue.current),
    expenses: Math.abs(fig("expenses").current),
    assets: Math.abs(fig("assets").current),
    equity: Math.abs(fig("equity").current),
  };

  // --- Item 3: the benchmark -------------------------------------------------------------------------------------------------------
  let benchmark: BenchmarkSuggestion | null = null;
  if (!empty) {
    const choose = (b: Benchmark, reason: string): BenchmarkSuggestion => ({ benchmark: b, amountMinor: absFigures[b], reason, figures: absFigures });
    let chosen: BenchmarkSuggestion;
    const entity = answers.entityType ?? "trading";
    if (entity === "not_for_profit") chosen = choose("expenses", "Total expenses, because you said the entity is a not-for-profit or runs as a cost centre: profit is not what its users look at (ISA 320).");
    else if (entity === "asset_holding") chosen = choose("assets", "Total assets, because you said the entity mainly holds assets (ISA 320).");
    else if (entity === "holding") chosen = choose("equity", "Total equity, because you said the entity is a holding entity (ISA 320).");
    else {
      const nearBreakEven = revenue.current > 0 && Math.abs(pbt.current) < (revenue.current * t.nearBreakEvenPct) / 100;
      const moved = hasPrior && pri(line("PBT")) !== 0 ? Math.abs((pbt.current - pbt.prior) / Math.abs(pbt.prior)) * 100 > t.pbtMovementPct : hasPrior && pbt.prior === 0 && pbt.current !== 0;
      if (pbt.current < 0) chosen = choose("revenue", `Revenue, because the entity made a loss before tax of ${money(pbt.current)}, so profit is not a steady measure (ISA 320).`);
      else if (nearBreakEven) chosen = choose("revenue", `Revenue, because profit before tax of ${money(pbt.current)} is less than ${t.nearBreakEvenPct}% of revenue, close to break-even (ISA 320).`);
      else if (moved) chosen = choose("revenue", `Revenue, because profit before tax moved by more than ${t.pbtMovementPct}% on the prior year (${money(pbt.prior)} to ${money(pbt.current)}), so it is not stable (ISA 320).`);
      else chosen = choose("pbt", `Profit before tax, because the entity is profitable${hasPrior ? " and its profit is stable on the prior year" : " (there is no prior year to compare it with)"} (ISA 320).`);
    }
    // A benchmark with nothing in it cannot be used: say so and fall back, in order, to one that has a figure.
    if (chosen.amountMinor <= 0) {
      const fallback = (["revenue", "expenses", "assets", "equity", "pbt"] as Benchmark[]).find((b) => absFigures[b] > 0);
      if (fallback) {
        notes.push(`${BENCHMARKS[chosen.benchmark].label} is nil, so it cannot be the benchmark.`);
        chosen = choose(fallback, `${BENCHMARKS[fallback].label}, because ${BENCHMARKS[chosen.benchmark].label.toLowerCase()} is nil and cannot be used.`);
      }
    }
    benchmark = chosen;
  }

  // --- Item 4: the percentage ------------------------------------------------------------------------------------------------------
  let percentage: PercentageSuggestion | null = null;
  const lowReasons: string[] = [];
  if (answers.reliedOnByBank) lowReasons.push("a bank relies on the statements");
  if (answers.firstYear) lowReasons.push("it is a first-year audit");
  if (answers.priorMisstatements) lowReasons.push("misstatements were found in the prior year");
  if (benchmark) {
    const range = settings.percentages[benchmark.benchmark];
    const low = lowReasons.length > 0;
    percentage = {
      bp: low ? range.minBp : Math.round((range.minBp + range.maxBp) / 2),
      minBp: range.minBp,
      maxBp: range.maxBp,
      position: low ? "low end" : "middle",
      reasons: low ? [`The low end of the firm's range (${range.minBp / 100}% to ${range.maxBp / 100}%), because ${lowReasons.join(", ")}.`] : [`The middle of the firm's range (${range.minBp / 100}% to ${range.maxBp / 100}%): no risk answer moves it down.`],
    };
  }

  // --- Item 5: performance materiality ---------------------------------------------------------------------------------------------
  const reducedReasons: string[] = [];
  if (answers.firstYear) reducedReasons.push("it is a first-year audit");
  if (answers.priorAdjustmentsAboveTrivial) reducedReasons.push("prior-year adjustments or misstatements were above trivial");
  if (answers.controlConcerns) reducedReasons.push("there are concerns about controls");
  const reduced = reducedReasons.length > 0;
  const performance: PerformanceSuggestion = reduced
    ? { pct: Math.round((settings.performance.reducedMinPct + settings.performance.reducedMaxPct) / 2), reduced, reasons: [`The middle of the reduced range (${settings.performance.reducedMinPct}% to ${settings.performance.reducedMaxPct}%), because ${reducedReasons.join(", ")}.`] }
    : { pct: settings.performance.defaultPct, reduced, reasons: [`The firm's default of ${settings.performance.defaultPct}%: nothing in the answers calls for less.`] };

  let suggested: Derivation["suggested"] = null;
  if (benchmark && percentage) {
    const overallMinor = Math.round((benchmark.amountMinor * percentage.bp) / 10000);
    suggested = { overallMinor, performanceMinor: Math.round((overallMinor * performance.pct) / 100), trivialMinor: Math.round((overallMinor * settings.trivial.pct) / 100), trivialPct: settings.trivial.pct };
  }

  // --- Item 6: significant areas ---------------------------------------------------------------------------------------------------
  const significant: SignificantArea[] = [];
  if (suggested) {
    const pm = suggested.performanceMinor;
    const trivial = suggested.trivialMinor;
    for (const s of sheets.sheets) {
      const movement = s.closingMinor - s.priorMinor;
      const above = Math.abs(s.closingMinor) >= pm || Math.abs(s.priorMinor) >= pm || Math.abs(movement) >= pm;
      const below = Math.abs(s.closingMinor) < trivial && Math.abs(s.priorMinor) < trivial;
      const verdict: Verdict = above ? "significant" : below ? "not_significant" : "judgement";
      const reason =
        verdict === "significant"
          ? `A balance or movement of ${money(Math.max(Math.abs(s.closingMinor), Math.abs(s.priorMinor), Math.abs(movement)))} is at or above performance materiality of ${money(pm)}.`
          : verdict === "not_significant"
            ? `Below the clearly trivial threshold of ${money(trivial)} in both years.`
            : "Between the trivial and performance materiality figures: a judgement for the team.";
      significant.push({ groupCode: s.groupCode, name: s.groupName, current: s.closingMinor, prior: s.priorMinor, verdict, reason });
    }
  }

  // --- Item 7: the indicators ------------------------------------------------------------------------------------------------------
  const pm = suggested?.performanceMinor ?? 0;
  const indicators: Indicator[] = [];
  const add = (key: string, label: string, hit: boolean, detail: string, question: string, leadSheets: string[] = []) => indicators.push({ key, label, hit, detail, question, leadSheets });

  add("loss", "A loss", pbt.current < 0 && !empty, pbt.current < 0 ? `Profit before tax is a loss of ${money(pbt.current)}.` : "Profit before tax is not a loss.", "What caused the loss, and how does management expect to return to profit?", SCI_GROUPS);
  const equity = fig("equity");
  add("negative_equity", "Negative equity", equity.current < 0, equity.current < 0 ? `Total equity is negative: ${money(equity.current)}.` : "Total equity is not negative.", "How is the entity financed while its liabilities exceed its assets, and who has agreed to support it?", EQUITY_GROUPS);
  const netCurrent = cur(statements.financialPosition.flatMap((s) => s.lines).find((l) => l.key === "T:Current assets")) - cur(statements.financialPosition.flatMap((s) => s.lines).find((l) => l.key === "T:Current liabilities"));
  add("net_current_liabilities", "Net current liabilities", !empty && netCurrent < 0, netCurrent < 0 ? `Current liabilities are ${money(netCurrent)} more than current assets.` : "Current assets are at least current liabilities.", "How will the liabilities due within a year be met?", ["CASH", "TRADEREC", "TRADEPAY", "BORROW"]);
  const overdrafts = input.accounts.filter((a) => OVERDRAFT.test(a.name) || (a.groupCode === "CASH" && a.closingMinor < 0)).filter((a) => a.closingMinor !== 0);
  add("overdraft", "A bank overdraft", overdrafts.length > 0, overdrafts.length > 0 ? `Overdrawn: ${overdrafts.map((a) => `${a.code} ${a.name}`).slice(0, 3).join("; ")}.` : "No overdrawn bank account found.", "Is the overdraft facility agreed, and for how long?", ["CASH", "BORROW"]);
  const borrowings = Math.abs(bal("BORROW"));
  const cash = Math.max(0, bal("CASH"));
  add("borrowings_against_cash", "Borrowings against cash", borrowings > 0 && borrowings > cash, borrowings > cash && borrowings > 0 ? `Borrowings of ${money(borrowings)} are more than cash and bank balances of ${money(cash)}.` : "Borrowings are covered by cash and bank balances, or there are none.", "How and when will the borrowings be repaid or refinanced?", ["BORROW", "CASH"]);
  const related = Math.max(Math.abs(bal("RPREC")), Math.abs(prior("RPREC")), Math.abs(bal("RPPAY")), Math.abs(prior("RPPAY")));
  add("related_parties", "Related-party balances above performance materiality", !!suggested && related >= pm, suggested ? (related >= pm ? `The largest related-party balance is ${money(related)}, at or above performance materiality of ${money(pm)}.` : "Related-party balances are below performance materiality.") : "Performance materiality is not known yet.", "Who are the related parties, and are the balances supported and disclosed?", ["RPREC", "RPPAY"]);
  const suspense = input.accounts.filter((a) => SUSPENSE.test(a.name) && a.closingMinor !== 0);
  const unmapped = input.accounts.filter((a) => a.groupCode === null);
  const difference = input.accounts.reduce((n, a) => n + a.closingMinor, 0);
  const odd: string[] = [];
  if (suspense.length > 0) odd.push(`${suspense.length} suspense or clearing balance(s)`);
  if (unmapped.length > 0) odd.push(`${unmapped.length} account(s) not mapped`);
  if (difference !== 0 && input.accounts.length > 0) odd.push(`the trial balance is out by ${money(difference)}`);
  add("suspense_unmapped", "Suspense, unmapped or unbalanced items", odd.length > 0, odd.length > 0 ? `Found: ${odd.join("; ")}.` : "No suspense balances, every account is mapped and the trial balance balances.", "What are these items, and why are they not in their proper place?");
  const movers = suggested ? sheets.sheets.filter((s) => { const pctMove = variancePct(s.closingMinor, s.priorMinor); return pctMove !== null && Math.abs(pctMove) > t.movementPct && Math.abs(s.closingMinor - s.priorMinor) > pm; }) : [];
  add("large_movement", `A line moving more than ${t.movementPct}% and more than performance materiality`, movers.length > 0, movers.length > 0 ? `${movers.map((s) => `${s.groupName} (${pct(variancePct(s.closingMinor, s.priorMinor)!)})`).slice(0, 4).join("; ")}.` : suggested ? "No lead sheet moved by that much." : "Performance materiality is not known yet.", "What explains each large movement?", movers.map((s) => s.groupCode));
  const revenueMove = revenue.prior > 0 ? ((revenue.current - revenue.prior) / revenue.prior) * 100 : null;
  add("revenue_down", `Revenue down more than ${t.revenueDropPct}%`, revenueMove !== null && revenueMove < -t.revenueDropPct, revenueMove === null ? "There is no prior-year revenue to compare with." : `Revenue moved ${pct(revenueMove)} on the prior year.`, "Why has revenue fallen, and is the fall expected to continue?", ["REVENUE"]);
  const margin = (r: number, g: number) => (r > 0 ? (g / r) * 100 : null);
  const gmCur = margin(revenue.current, cur(line("GROSS")));
  const gmPri = margin(revenue.prior, pri(line("GROSS")));
  const swing = gmCur !== null && gmPri !== null ? gmCur - gmPri : null;
  add("margin_swing", `A gross margin swing of more than ${t.marginSwingPoints} points`, swing !== null && Math.abs(swing) > t.marginSwingPoints, swing === null ? "There is no gross margin in one of the years to compare." : `Gross margin moved from ${pct(gmPri!)} to ${pct(gmCur!)} (${Math.round(swing * 10) / 10} points).`, "What changed in selling prices or costs to move the margin?", ["REVENUE", "COS"]);

  // --- Item 8: going concern -------------------------------------------------------------------------------------------------------
  const hits = indicators.filter((i) => i.hit).map((i) => i.label);
  const goingConcern = { required: hits.length > 0, hits };

  // --- Item 9: the presumed risks --------------------------------------------------------------------------------------------------
  const presumedRisks = [
    { areaCode: "C13", text: "Revenue recognition is presumed to be a significant risk (occurrence and cut-off). Only a partner may rebut it, and only with a recorded reason (ISA 240).", source: "Presumption in the methodology, not derived from the figures." },
    { areaCode: "C16", text: "Management override of controls is always a significant risk (ISA 240). Its rating is fixed.", source: "Fixed in the methodology." },
  ];

  // --- Item 12: area risk suggestions ----------------------------------------------------------------------------------------------
  const areaSuggestions: AreaSuggestion[] = [];
  const suggest = (areaCode: string, assertions: string[], reason: string) => {
    const area = AREA_BY_CODE.get(areaCode);
    if (!area) return;
    const has = new Set<string>(assertionsOf(area));
    for (const a of assertions) if (has.has(a)) areaSuggestions.push({ areaCode, assertion: a, level: "moderate", reason });
  };
  if (suggested && (Math.abs(bal("INVENT")) >= pm || Math.abs(prior("INVENT")) >= pm) && pm > 0) suggest("C4", ["E", "V"], `Inventories of ${money(Math.max(Math.abs(bal("INVENT")), Math.abs(prior("INVENT"))))} are at or above performance materiality: existence and valuation are suggested at moderate.`);
  if (suggested && related >= pm && pm > 0) suggest("C7", ["C", "P"], `Related-party balances of ${money(related)} are at or above performance materiality: completeness and presentation are suggested at moderate.`);
  if (goingConcern.required && borrowings > 0) suggest("C9", ["V"], "There is a going-concern indicator and the entity has borrowings: the valuation of borrowings is suggested at moderate.");

  if (empty) notes.push("There is no mapped trial balance yet, so nothing can be worked out.");
  else if (!hasPrior) notes.push("There are no prior-year balances, so movements and comparisons are not available.");

  return { figures, empty, benchmark, percentage, performance, suggested, significant, indicators, goingConcern, presumedRisks, areaSuggestions, notes };
}
