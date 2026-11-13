import { GROUP_BY_CODE } from "./groups";

/**
 * What a test schedule works out from its lines. Amounts are minor units in the schedule's own sign: positive on the side
 * the balance normally falls (see `presentationBalance`), the way a client's listing is usually presented.
 */

/** The most lines a schedule may hold, however they are entered. */
export const MAX_SCHEDULE_LINES = 2000;

export interface ScheduleLine {
  amountMinor: number;
  tested: boolean;
}

export const scheduleTotal = (lines: Pick<ScheduleLine, "amountMinor">[]): number => lines.reduce((s, l) => s + l.amountMinor, 0);

// --- The balance to agree to --------------------------------------------------

const CREDIT_SECTIONS = new Set(["Equity", "Non-current liabilities", "Current liabilities", "Income"]);

/** Whether the group's balance normally falls on the credit side: liabilities, equity and income. */
export const isCreditGroup = (groupCode: string): boolean => CREDIT_SECTIONS.has(GROUP_BY_CODE.get(groupCode)?.section ?? "");

/**
 * The group's adjusted balance in the schedule's sign: ledger sign (debit positive) for debit groups, reversed for
 * credit groups, so a payables listing of positive amounts is compared with a positive balance.
 */
export function presentationBalance(accounts: { groupCode: string | null; closingMinor: number }[], groupCode: string): number {
  const ledger = accounts.filter((a) => a.groupCode === groupCode).reduce((s, a) => s + a.closingMinor, 0);
  return (isCreditGroup(groupCode) ? -ledger : ledger) + 0;
}

/** Listing total less the balance; zero when they agree. */
export const difference = (total: number, balance: number): number => total - balance;

// --- Thresholds and key items --------------------------------------------------

export const THRESHOLDS = [
  { code: "overall", label: "Overall materiality" },
  { code: "performance", label: "Performance materiality" },
  { code: "half_performance", label: "Half of performance materiality" },
  { code: "quarter_performance", label: "A quarter of performance materiality" },
] as const;
export type ThresholdCode = (typeof THRESHOLDS)[number]["code"];
export const THRESHOLD_CODES = new Set<string>(THRESHOLDS.map((t) => t.code));

export interface MaterialityAmounts {
  overallMinor: number;
  performanceMinor: number;
}

/** The amounts a reviewer can choose between, rounded to a whole minor unit. */
export function thresholdAmounts(m: MaterialityAmounts) {
  return {
    overall: m.overallMinor,
    performance: m.performanceMinor,
    half_performance: Math.round(m.performanceMinor / 2),
    quarter_performance: Math.round(m.performanceMinor / 4),
  } satisfies Record<ThresholdCode, number>;
}

/** The amount for the chosen threshold; zero (nothing is a key item) when materiality has not been set. */
export function thresholdAmount(m: MaterialityAmounts | null, choice: ThresholdCode): number {
  return m ? thresholdAmounts(m)[choice] : 0;
}

/** A line is a key item when its size, in either direction, is at or above the threshold. No threshold means no key items. */
export const isKeyItem = (amountMinor: number, thresholdMinor: number): boolean => thresholdMinor > 0 && Math.abs(amountMinor) >= thresholdMinor;

// --- Coverage ------------------------------------------------------------------

export interface Coverage {
  /** Size of the lines marked tested, ignoring direction. */
  testedMinor: number;
  /** Size of all the lines, ignoring direction. */
  totalMinor: number;
  /** Tested as a percentage of the total; null when the total is zero. */
  pct: number | null;
  keyItems: number;
  keyItemsTested: number;
  /** True when there is no key item or every one is tested. */
  allKeyItemsTested: boolean;
}

/** Coverage is measured on absolute values, so debits and credits in one listing do not cancel each other out. */
export function coverage(lines: ScheduleLine[], thresholdMinor: number): Coverage {
  const totalMinor = lines.reduce((s, l) => s + Math.abs(l.amountMinor), 0);
  const testedMinor = lines.filter((l) => l.tested).reduce((s, l) => s + Math.abs(l.amountMinor), 0);
  const key = lines.filter((l) => isKeyItem(l.amountMinor, thresholdMinor));
  const keyItemsTested = key.filter((l) => l.tested).length;
  return { testedMinor, totalMinor, pct: totalMinor === 0 ? null : (testedMinor / totalMinor) * 100, keyItems: key.length, keyItemsTested, allKeyItemsTested: keyItemsTested === key.length };
}

// --- What holds up the lock ----------------------------------------------------

export interface ScheduleState {
  reference: string;
  hasConclusion: boolean;
  reviewed: boolean;
  /** The balance the listing should agree to, or null when the schedule has none. */
  balanceMinor: number | null;
  totalMinor: number;
  explanation: string | null;
}

export const disagrees = (s: Pick<ScheduleState, "balanceMinor" | "totalMinor">): boolean => s.balanceMinor !== null && difference(s.totalMinor, s.balanceMinor) !== 0;
export const differenceUnexplained = (s: ScheduleState): boolean => disagrees(s) && !(s.explanation && s.explanation.trim().length > 0);

/** Whether a schedule still has something to finish: a conclusion, a review, or an explanation of a difference. */
export const needsFinishing = (s: ScheduleState): boolean => !s.hasConclusion || !s.reviewed || differenceUnexplained(s);

/** The lock blockers for a set of schedules; none when there are none. */
export function scheduleBlockers(schedules: ScheduleState[]): string[] {
  const out: string[] = [];
  const noConclusion = schedules.filter((s) => !s.hasConclusion).length;
  if (noConclusion > 0) out.push(`Audit: ${noConclusion} test schedule(s) have no conclusion.`);
  const unreviewed = schedules.filter((s) => !s.reviewed).length;
  if (unreviewed > 0) out.push(`Audit: ${unreviewed} test schedule(s) have not been reviewed.`);
  const unexplained = schedules.filter(differenceUnexplained).length;
  if (unexplained > 0) out.push(`Audit: ${unexplained} test schedule(s) do not agree to the balance, and the difference is not explained.`);
  return out;
}
