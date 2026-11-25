import type { Check, StatementLine, Statements } from "./statements";

/**
 * Checks of this year's statements against last year's file. Pure, and separate from `buildStatements` on purpose: that function is called from
 * many places that know nothing of a prior engagement, and these checks are WARNINGS. They never change `clean` and never block locking, because a
 * restatement is a legitimate reason for a difference and the app has no way yet to record one.
 *
 * A: this year's comparative column agrees, line by line, with last year's current column.
 * B: this year's opening retained earnings equal last year's closing retained earnings.
 */

export interface PriorYearAccount {
  groupCode: string | null;
  name: string;
  /** Adjusted closing balance in ledger sign (debit positive). */
  closingMinor: number;
}

export interface PriorYearInput {
  /** This year's statements, built the way the statements page builds them. */
  current: Statements;
  /** Last year's engagement's statements, built the same way its own page builds them. */
  prior: Statements;
  /** This year's accounts, for the opening retained earnings. */
  currentAccounts: PriorYearAccount[];
  /** Last year's file is locked or archived, so its figures are signed. */
  priorSigned: boolean;
}

/** An account inside retained earnings that is a dividend or drawings account: its movement is this year's, not part of the opening balance. */
export const isDividendAccount = (name: string): boolean => /dividend|drawing/i.test(name);

/** The words that say how firm last year's figures are. */
export const priorBasis = (signed: boolean): string => (signed ? "last year's signed figures" : "last year's figures (that file is not yet locked)");

export const NOT_LINKED = "Not linked to last year's file, so the prior-year checks do not run.";
export const MAX_LISTED = 5;

const fmt = (minor: number): string => (Math.abs(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (minor: number): string => `${minor < 0 ? "minus " : ""}${fmt(minor)}`;

const flatten = (s: Statements): StatementLine[] => [...s.financialPosition.flatMap((x) => x.lines), ...s.comprehensiveIncome];

const RETAINED = "RETAINED";
const RESULT = "RESULT";

/** Last year's closing retained earnings: its retained earnings line as its statements show it, plus its result for the year. */
export function priorClosingRetained(prior: Statements): { retained: number; result: number; total: number } {
  const lines = flatten(prior);
  const retained = lines.find((l) => l.key === RETAINED)?.current ?? 0;
  const result = lines.find((l) => l.key === RESULT)?.current ?? 0;
  return { retained, result, total: retained + result };
}

/**
 * This year's opening retained earnings, in presentation sign: the retained earnings accounts in the trial balance, which is taken before closing
 * entries so they still hold the opening balance, with each dividend or drawings account left out (added back). Whatever else moved the balance
 * during the year is not visible here.
 */
export function openingRetained(accounts: PriorYearAccount[]): { opening: number; addedBack: number; addedBackAccounts: number } {
  const inGroup = accounts.filter((a) => a.groupCode === RETAINED);
  const dividends = inGroup.filter((a) => isDividendAccount(a.name));
  const rest = inGroup.filter((a) => !isDividendAccount(a.name));
  return { opening: -rest.reduce((s, a) => s + a.closingMinor, 0), addedBack: dividends.reduce((s, a) => s + a.closingMinor, 0), addedBackAccounts: dividends.length };
}

export function priorYearChecks(input: PriorYearInput): Check[] {
  const basis = priorBasis(input.priorSigned);

  // --- A: the comparatives ---
  const mine = new Map(flatten(input.current).map((l) => [l.key, l]));
  const theirs = new Map(flatten(input.prior).map((l) => [l.key, l]));
  const differing = [...new Set([...mine.keys(), ...theirs.keys()])]
    .map((key) => {
      const a = mine.get(key);
      const b = theirs.get(key);
      const comparative = a?.prior ?? 0;
      const lastYear = b?.current ?? 0;
      return { key, label: (a ?? b)!.label, kind: (a ?? b)!.kind, comparative, lastYear, difference: comparative - lastYear };
    })
    .filter((d) => d.difference !== 0)
    // Lines first, then the subtotals and totals they add up to.
    .sort((x, y) => Number(x.kind !== "line") - Number(y.kind !== "line"));
  const listed = differing
    .slice(0, MAX_LISTED)
    .map((d) => `${d.label}: this year's comparative ${signed(d.comparative)}, last year ${signed(d.lastYear)}, difference ${signed(d.difference)}`);
  const more = differing.length - listed.length;
  const a: Check = {
    label: `Comparative figures agree to ${basis}`,
    passed: differing.length === 0,
    detail: differing.length === 0 ? undefined : `${listed.join("; ")}${more > 0 ? `; and ${more} more` : ""}.`,
    severity: "warning",
  };

  // --- B: opening retained earnings ---
  const { opening, addedBack, addedBackAccounts } = openingRetained(input.currentAccounts);
  const closing = priorClosingRetained(input.prior);
  const difference = opening - closing.total;
  const b: Check = {
    label: `Opening retained earnings equal last year's closing, per ${basis}`,
    passed: difference === 0,
    detail:
      difference === 0
        ? undefined
        : `Opening retained earnings in this trial balance are ${signed(opening)}${addedBackAccounts > 0 ? ` (after adding back ${addedBackAccounts} dividend or drawings account(s) of ${signed(addedBack)})` : ""}. ` +
          `Last year's closing retained earnings are ${signed(closing.total)} (retained earnings ${signed(closing.retained)} plus profit for the year ${signed(closing.result)}). Difference ${signed(difference)}.`,
    severity: "warning",
  };
  return [a, b];
}
