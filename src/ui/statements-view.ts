import type { Check } from "../domain/statements";
import { count, plainCount } from "./text";

/** How the financial statements page reads the checks and the notes. Pure: it only rearranges and words what the domain produced. */

/** "All 7 checks pass." or "Draft: 2 of 7 checks outstanding." */
export function checksSentence(checks: Pick<Check, "passed">[]): string {
  const failed = checks.filter((c) => !c.passed).length;
  if (checks.length === 0) return "No checks to run.";
  if (failed === 0) return checks.length === 1 ? "The one check passes." : `All ${checks.length} checks pass.`;
  return `Draft: ${failed} of ${count(checks.length, "check")} outstanding.`;
}

/** Failed checks first, then passed ones, each group in the order the domain gave them. */
export function orderChecks<T extends Pick<Check, "passed">>(checks: T[]): T[] {
  return [...checks.filter((c) => !c.passed), ...checks.filter((c) => c.passed)];
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
    default:
      return null;
  }
}

/** A piece of text: plain, or a [bracketed placeholder] the preparer has to fill in. */
export interface TextPiece {
  text: string;
  placeholder: boolean;
}

/**
 * Splits text on [square brackets], so the placeholders can be highlighted. The text is kept exactly: joining the pieces gives the
 * original back. A bracket that is never closed is left as plain text.
 */
export function splitBrackets(text: string): TextPiece[] {
  const pieces: TextPiece[] = [];
  const re = /\[[^\][]*\]/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) pieces.push({ text: text.slice(last, at), placeholder: false });
    pieces.push({ text: m[0], placeholder: true });
    last = at + m[0].length;
  }
  if (last < text.length) pieces.push({ text: text.slice(last), placeholder: false });
  return pieces;
}

/** How many placeholders a note still has. */
export const placeholderCount = (texts: string[]): number => texts.reduce((n, t) => n + splitBrackets(t).filter((p) => p.placeholder).length, 0);
