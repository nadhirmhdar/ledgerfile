import type { Check, Statements } from "./statements";
import { formatPresentation } from "./money";

/**
 * Signed prior-year figures (migration 0041). For a client's FIRST year in LedgerFile there is no last-year engagement, so the comparatives come from the
 * prior-year column of the imported trial balance and nothing checks them against the statements that were actually signed. A person enters the signed
 * figure of each face line, and this check compares each with the pack's comparative for that line, after rounding.
 *
 * Pure: it reads nothing and changes nothing. It is a WARNING: it never blocks and never changes `clean`.
 */

export const SIGNED_PRIOR_LABEL = "Comparative figures agree to the signed prior-year statements";
export const NOTHING_ENTERED = "No signed prior-year figures entered";
export const MAX_SIGNED_LISTED = 5;
export const AMOUNT_REFUSAL = "Enter each signed figure as a number such as 1234567.89 or -500, with at most two decimals, or leave it empty.";
export const HAS_PRIOR_REFUSAL = "This engagement is linked to last year's file in LedgerFile, so its comparatives are checked against that file instead.";
export const NO_COMPARATIVES_REFUSAL = "This engagement's trial balance has no prior-year figures, so there is nothing to compare signed figures with.";
export const LINE_REFUSAL = "That is not a line of the statements with a comparative.";

/** A face line a signed figure can be entered for: a line (not a subtotal or total) that has a figure in either year. */
export interface SignedPriorLine {
  key: string;
  label: string;
  /** This file's comparative, in presentation sign, as the statements show it. */
  comparative: number;
}

/** The lines to enter, in the order the statements show them: the statement of financial position, then the income statement. */
export function signedPriorLines(base: Statements): SignedPriorLine[] {
  if (!base.hasComparatives) return [];
  const all = [...base.financialPosition.flatMap((s) => s.lines), ...base.comprehensiveIncome];
  const seen = new Set<string>();
  return all.flatMap((l) => {
    if (l.kind !== "line" || seen.has(l.key) || (l.current === 0 && l.prior === 0)) return [];
    seen.add(l.key);
    return [{ key: l.key, label: l.label, comparative: l.prior }];
  });
}

/** Whether the section and its check apply: the engagement has no prior engagement in LedgerFile, and the trial balance has prior-year figures. */
export const appliesToEngagement = (linkedToPriorEngagement: boolean, base: Statements): boolean => !linkedToPriorEngagement && base.hasComparatives;

/** A typed amount in major units ("1,234.50", "-500") as minor units (cents), or null for an empty one. Throws the refusal for anything else. */
export function parseSignedAmount(input: string): number | null {
  const text = input.trim().replace(/[,\s]/g, "");
  if (text === "") return null;
  if (!/^-?\d{1,15}(\.\d{1,2})?$/.test(text)) throw new Error(AMOUNT_REFUSAL);
  return Math.round(Number(text) * 100);
}

/** Round to the statements' unit, half away from zero, the way the pack rounds its own accounts. */
const roundTo = (value: number, unit: number): number => (unit <= 1 ? value : Math.sign(value) * Math.round(Math.abs(value) / unit) * unit);

/**
 * The check. `entered` maps a line key to the signed figure in minor units (presentation sign), or null where it was cleared. Lines with no entry are not
 * compared, and the detail says how many. With nothing entered the check fails as a warning and says so, so it never passes silently.
 */
export function signedPriorCheck(base: Statements, entered: Map<string, number | null>, unitMinor: number): Check {
  const lines = signedPriorLines(base);
  const has = lines.filter((l) => entered.get(l.key) != null);
  const empty = lines.length - has.length;
  if (has.length === 0) return { label: SIGNED_PRIOR_LABEL, passed: false, detail: NOTHING_ENTERED, severity: "warning" };

  // Worded the way the comparatives check against last year's file words it: "minus" for a negative, not brackets.
  const money = (minor: number) => `${minor < 0 ? "minus " : ""}${formatPresentation(Math.abs(minor), unitMinor)}`;
  const differing = has.flatMap((l) => {
    const signedFigure = roundTo(entered.get(l.key)!, unitMinor);
    const diff = l.comparative - signedFigure;
    return diff === 0 ? [] : [{ label: l.label, comparative: l.comparative, signedFigure, diff }];
  });
  const listed = differing.slice(0, MAX_SIGNED_LISTED).map((d) => `${d.label}: this file's comparative ${money(d.comparative)}, signed ${money(d.signedFigure)}, difference ${money(d.diff)}`);
  const more = differing.length - listed.length;
  const skipped = empty > 0 ? ` ${empty} ${empty === 1 ? "line was" : "lines were"} left empty and not compared.` : "";
  return {
    label: SIGNED_PRIOR_LABEL,
    passed: differing.length === 0,
    detail: differing.length === 0 ? (skipped.trim() === "" ? undefined : skipped.trim()) : `${differing.length} ${differing.length === 1 ? "figure differs" : "figures differ"}.${skipped}`,
    items: differing.length === 0 ? undefined : [...listed, ...(more > 0 ? [`and ${more} more`] : [])],
    severity: "warning",
  };
}
