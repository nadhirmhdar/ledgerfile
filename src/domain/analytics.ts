import type { StatementLine, Statements } from "./statements";

/**
 * Analytical review: the year-on-year movement of every statement line, which movements need an explanation,
 * and the usual financial ratios. Everything is worked out from the statements already built from the adjusted
 * trial balance, so the figures here are the ones in the statements. Amounts are in minor units, in presentation
 * sign (assets, liabilities, equity, income and expenses are positive when they have their normal balance).
 */

/** A movement of at least this percentage of the prior-year balance needs an explanation, unless it is clearly trivial. */
export const FLAG_PERCENT = 10;
/** The rule in words, shown beside the table. */
export const FLAG_RULE_TEXT = `A movement needs an explanation when it is at least performance materiality, or at least ${FLAG_PERCENT}% and above the clearly-trivial amount.`;
/** Days in the year used for receivable, payable and inventory days. The period's own length is not used. */
export const DAYS_IN_YEAR = 365;

export interface Thresholds {
  performanceMinor: number;
  trivialMinor: number;
}

export interface Flag {
  basis: "materiality" | "percentage";
  /** Why the line is flagged, in words a reviewer can check. */
  reason: string;
}

export type PercentNote = "no prior balance" | "sign change";

export interface PercentChange {
  /** Change as a percentage of the size of the prior balance; null when that would be meaningless. */
  pct: number | null;
  note: PercentNote | null;
}

/**
 * Percentage change, without dividing by zero or reporting a misleading figure. A balance that appears from nothing,
 * or that changes sign, has no meaningful percentage; both are reported as a note instead.
 */
export function percentChange(current: number, prior: number): PercentChange {
  if (current === prior) return { pct: 0, note: null };
  if (prior === 0) return { pct: null, note: "no prior balance" };
  if (current !== 0 && Math.sign(current) !== Math.sign(prior)) return { pct: null, note: "sign change" };
  return { pct: ((current - prior) / Math.abs(prior)) * 100, note: null };
}

export interface MovementRow {
  key: string;
  label: string;
  /** Lead sheet group behind the line, when there is one. */
  groupCode?: string;
  section: "Statement of comprehensive income" | "Statement of financial position";
  kind: StatementLine["kind"];
  current: number;
  prior: number;
  change: number;
  pct: number | null;
  pctNote: PercentNote | null;
  flag: Flag | null;
}

const fmt = (minor: number) => (Math.abs(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Whether a movement needs an explanation. A balance with no meaningful percentage (new, or changed sign) counts as
 * passing the percentage test, so it is flagged once it is above the clearly-trivial amount.
 */
export function flagFor(current: number, prior: number, t: Thresholds): Flag | null {
  const change = current - prior;
  if (change === 0) return null;
  const size = Math.abs(change);
  if (size >= t.performanceMinor) {
    return { basis: "materiality", reason: `The change of ${fmt(size)} is at least performance materiality (${fmt(t.performanceMinor)}).` };
  }
  const { pct, note } = percentChange(current, prior);
  const percentTest = pct === null ? note !== null : Math.abs(pct) >= FLAG_PERCENT;
  if (percentTest && size > t.trivialMinor) {
    const how = pct === null ? `has ${note}` : `is ${Math.abs(pct).toFixed(1)}%`;
    return { basis: "percentage", reason: `The change of ${fmt(size)} ${how}, which is at least ${FLAG_PERCENT}% and above the clearly-trivial amount (${fmt(t.trivialMinor)}).` };
  }
  return null;
}

/**
 * Every statement line with a balance in either year, with its movement. The year's result appears once, in the
 * income statement, not again within equity. Only plain lines are flagged: subtotals and totals follow from them.
 * Nothing is flagged without materiality or without a prior year to compare with.
 */
export function compareYears(statements: Statements, thresholds: Thresholds | null): MovementRow[] {
  const rows: MovementRow[] = [];
  const add = (section: MovementRow["section"], l: StatementLine) => {
    if (l.current === 0 && l.prior === 0) return;
    const change = l.current - l.prior;
    const { pct, note } = percentChange(l.current, l.prior);
    rows.push({
      key: l.key,
      label: l.label,
      groupCode: l.groupCode,
      section,
      kind: l.kind,
      current: l.current,
      prior: l.prior,
      change,
      pct,
      pctNote: note,
      flag: l.kind === "line" && thresholds && statements.hasComparatives ? flagFor(l.current, l.prior, thresholds) : null,
    });
  };
  for (const l of statements.comprehensiveIncome) add("Statement of comprehensive income", l);
  for (const s of statements.financialPosition) for (const l of s.lines) if (l.key !== "RESULT") add("Statement of financial position", l);
  return rows;
}

/** What an explanation was written against, to tell whether it still stands. */
export interface ExplanationRecord {
  lineKey: string;
  currentMinor: number;
  priorMinor: number;
}

/** An explanation stands only while both years' figures are what it was written against. */
export const explanationStands = (e: ExplanationRecord, row: Pick<MovementRow, "current" | "prior">) => e.currentMinor === row.current && e.priorMinor === row.prior;

/** Flagged movements with no explanation that still stands. */
export function unexplainedMovements(rows: MovementRow[], explanations: ExplanationRecord[]): MovementRow[] {
  return rows.filter((r) => {
    if (!r.flag) return false;
    const e = explanations.find((x) => x.lineKey === r.key);
    return !e || !explanationStands(e, r);
  });
}

// --- Ratios ---------------------------------------------------------------

export type RatioUnit = "times" | "percent" | "days" | "amount";

export interface RatioRow {
  key: string;
  label: string;
  /** The formula, for a reviewer to check against the statements. */
  formula: string;
  unit: RatioUnit;
  current: number | null;
  prior: number | null;
  /** Current less prior; null when either year has no ratio. */
  change: number | null;
}

interface Balances {
  currentAssets: number;
  currentLiabilities: number;
  inventories: number;
  receivables: number;
  payables: number;
  borrowings: number;
  equity: number;
  revenue: number;
  costOfSales: number;
  grossProfit: number;
  profit: number;
  /** True when the year has any balances at all. */
  exists: boolean;
}

function balances(statements: Statements, year: "current" | "prior"): Balances {
  const all = new Map<string, StatementLine>();
  for (const l of statements.comprehensiveIncome) all.set(l.key, l);
  for (const s of statements.financialPosition) for (const l of s.lines) all.set(l.key, l);
  const get = (key: string) => all.get(key)?.[year] ?? 0;
  const b: Balances = {
    currentAssets: get("T:Current assets"),
    currentLiabilities: get("T:Current liabilities"),
    inventories: get("INVENT"),
    receivables: get("TRADEREC"),
    payables: get("TRADEPAY"),
    // Total borrowings, whichever way the statements split them between current and non-current.
    borrowings: get("BORROW") + get("BORROW_CUR"),
    equity: get("TOTAL_EQUITY"),
    revenue: get("REVENUE"),
    costOfSales: get("COS"),
    grossProfit: get("GROSS"),
    profit: get("PROFIT"),
    exists: false,
  };
  b.exists = [...all.values()].some((l) => l[year] !== 0);
  return b;
}

/** A ratio whose denominator must be above zero: with none, or a negative one, the ratio says nothing useful. */
const over = (numerator: number, denominator: number): number | null => (denominator > 0 ? numerator / denominator : null);

const DEFINITIONS: { key: string; label: string; formula: string; unit: RatioUnit; of: (b: Balances) => number | null }[] = [
  { key: "CURRENT", label: "Current ratio", formula: "Current assets ÷ current liabilities", unit: "times", of: (b) => over(b.currentAssets, b.currentLiabilities) },
  { key: "QUICK", label: "Quick ratio", formula: "(Current assets − inventories) ÷ current liabilities", unit: "times", of: (b) => over(b.currentAssets - b.inventories, b.currentLiabilities) },
  { key: "WORKCAP", label: "Working capital", formula: "Current assets − current liabilities", unit: "amount", of: (b) => (b.currentAssets === 0 && b.currentLiabilities === 0 ? null : b.currentAssets - b.currentLiabilities) },
  { key: "GROSSM", label: "Gross margin", formula: "Gross profit ÷ revenue × 100", unit: "percent", of: (b) => { const r = over(b.grossProfit, b.revenue); return r === null ? null : r * 100; } },
  { key: "NETM", label: "Net margin", formula: "Profit for the year ÷ revenue × 100", unit: "percent", of: (b) => { const r = over(b.profit, b.revenue); return r === null ? null : r * 100; } },
  { key: "RECDAYS", label: "Receivable days", formula: `Trade and other receivables ÷ revenue × ${DAYS_IN_YEAR}`, unit: "days", of: (b) => { const r = over(b.receivables, b.revenue); return r === null ? null : r * DAYS_IN_YEAR; } },
  { key: "PAYDAYS", label: "Payable days", formula: `Trade and other payables ÷ cost of sales × ${DAYS_IN_YEAR}`, unit: "days", of: (b) => { const r = over(b.payables, b.costOfSales); return r === null ? null : r * DAYS_IN_YEAR; } },
  { key: "INVDAYS", label: "Inventory days", formula: `Inventories ÷ cost of sales × ${DAYS_IN_YEAR}`, unit: "days", of: (b) => { const r = over(b.inventories, b.costOfSales); return r === null ? null : r * DAYS_IN_YEAR; } },
  { key: "DEBTEQ", label: "Debt to equity", formula: "Borrowings ÷ total equity", unit: "times", of: (b) => over(b.borrowings, b.equity) },
  { key: "ROE", label: "Return on equity", formula: "Profit for the year ÷ total equity × 100", unit: "percent", of: (b) => { const r = over(b.profit, b.equity); return r === null ? null : r * 100; } },
];

/**
 * The ratios for both years. All use balances at the period end, not averages, and a year of 365 days. A year with no
 * balances at all (no prior year imported) has no ratios.
 */
export function computeRatios(statements: Statements): RatioRow[] {
  const cur = balances(statements, "current");
  const pri = balances(statements, "prior");
  return DEFINITIONS.map((d) => {
    const current = cur.exists ? d.of(cur) : null;
    const prior = statements.hasComparatives && pri.exists ? d.of(pri) : null;
    return { key: d.key, label: d.label, formula: d.formula, unit: d.unit, current, prior, change: current !== null && prior !== null ? current - prior : null };
  });
}
