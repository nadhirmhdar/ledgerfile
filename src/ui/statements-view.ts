import { severityOf, type Check } from "../domain/statements";
import { NOTE_TOTALS_CHECK_LABEL, PLACEHOLDERS_CHECK_LABEL, PROFIT_CHECK_LABEL } from "../domain/statement-pack";
import { count, joinList, plainCount } from "./text";

/** How the financial statements page reads the checks and the notes. Pure: it only rearranges and words what the domain produced. */

/**
 * "All 7 checks pass.", "Draft: 2 of 7 checks outstanding." or, when only warnings are outstanding, "Every error check passes; 1 warning needs attention."
 * Only an error check makes the statements a draft; a warning never does.
 */
export function checksSentence(checks: Pick<Check, "passed" | "severity">[]): string {
  const failed = checks.filter((c) => !c.passed);
  const errors = failed.filter((c) => severityOf(c) === "error").length;
  const warnings = failed.length - errors;
  if (checks.length === 0) return "No checks to run.";
  if (errors > 0) return `Draft: ${errors} of ${count(checks.length, "check")} outstanding.`;
  if (warnings > 0) return `Every error check passes; ${warnings === 1 ? "1 warning needs" : `${warnings} warnings need`} attention.`;
  return checks.length === 1 ? "The one check passes." : `All ${checks.length} checks pass.`;
}

/** Failed error checks first, then failed warnings, then passed ones, each group in the order the domain gave them. */
export function orderChecks<T extends Pick<Check, "passed" | "severity">>(checks: T[]): T[] {
  const failed = checks.filter((c) => !c.passed);
  return [...failed.filter((c) => severityOf(c) === "error"), ...failed.filter((c) => severityOf(c) === "warning"), ...checks.filter((c) => c.passed)];
}

/** The detail of a check as a plain sentence, with "(s)" plurals worked out. */
export const checkDetail = (detail: string | undefined): string | undefined => (detail ? plainCount(detail) : undefined);

export const BORROWINGS_ANCHOR = "borrowings";

/** Where a failed check can be put right, keyed on the check's label. Checks with no obvious place get no link. */
export function checkFix(label: string, engagementId: string): { href: string; text: string } | null {
  const base = `/engagements/${engagementId}`;
  switch (label) {
    case "Adjusted trial balance adds to zero":
    case "Every account is mapped to a group":
    case "Every mapping has been reviewed":
      return { href: `${base}/trial-balance`, text: "Open trial balance and mapping" };
    case "Current portion of borrowings is within total borrowings":
      return { href: `#${BORROWINGS_ANCHOR}`, text: "Go to the borrowings amounts" };
    case PROFIT_CHECK_LABEL:
      return { href: "#sci", text: "Go to the income statement" };
    case NOTE_TOTALS_CHECK_LABEL:
    case PLACEHOLDERS_CHECK_LABEL:
      return { href: "#notes", text: "Go to the notes" };
    default:
      return null;
  }
}

// The placeholder counting lives in the domain, where the statement check uses it too; the page keeps importing it from here.
export { splitBrackets, placeholderCount, type TextPiece } from "../domain/placeholders";

/** The numbers of the notes that carry the policy review notice, in note order. Takes the notice text so it stays the domain's own. */
export function draftNoteNumbers(notes: { number: number; paragraphs: string[] }[], notice: string): number[] {
  return notes.filter((n) => n.paragraphs.includes(notice)).map((n) => n.number);
}

/** "The accounting policies in note 3 are draft wording and need review before issue." Null when no note carries the notice. */
export function draftNoteSentence(numbers: number[]): string | null {
  if (numbers.length === 0) return null;
  const list = numbers.length === 1 ? `note ${numbers[0]}` : `notes ${joinList(numbers.map(String))}`;
  return `The accounting policies in ${list} are draft wording and need review before issue.`;
}
