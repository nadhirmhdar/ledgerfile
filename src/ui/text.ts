/** Small wording helpers, so counts read as plain sentences ("3 lead sheets", "1 lead sheet") and never as "sheet(s)". */

/** The noun in the right number: word(1, "lead sheet") is "lead sheet", word(2, "lead sheet") is "lead sheets". */
export const word = (n: number, singular: string, plural: string = `${singular}s`): string => (n === 1 ? singular : plural);

/** The count with its noun: count(3, "lead sheet") is "3 lead sheets". */
export const count = (n: number, singular: string, plural?: string): string => `${n} ${word(n, singular, plural)}`;

/** "is" or "are" for the count. */
export const isAre = (n: number): string => (n === 1 ? "is" : "are");

/** "has" or "have" for the count. */
export const hasHave = (n: number): string => (n === 1 ? "has" : "have");

/** A list in words: "a", "a and b", "a, b and c". */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The first letter in capitals, the rest as written. */
export const capitalise = (s: string): string => (s === "" ? s : s[0].toUpperCase() + s.slice(1));

/** "2 of 5" for a progress fraction. */
export const fraction = (done: number, total: number): string => `${done} of ${total}`;

// A counted noun phrase with "(s)" or "(ies)" plurals, optionally joined by "and", then optionally the verb that follows it.
const NOUN = String.raw`(?:[\w'’-]+ )*?[\w'’-]+(?:\(s\)|\(ies\))`;
const COUNTED = new RegExp(String.raw`\b(\d[\d,]*) (${NOUN}(?: and ${NOUN})*)(?: (are|have|do|were)\b)?`, "g");
const ONE_VERB: Record<string, string> = { are: "is", have: "has", do: "does", were: "was" };

/**
 * Rewrites counted "(s)" and "(ies)" plurals in a sentence written elsewhere, by their count: "12 area(s)" becomes "12 areas",
 * "1 area(s)" becomes "1 area", "2 journal entry(ies)" becomes "2 journal entries". Phrases joined by "and" are all rewritten,
 * and when the count is 1 the verb straight after them agrees ("1 procedure(s) and checklist step(s) are" becomes "1 procedure
 * and checklist step is"). Text with no counted plural is returned as it was.
 */
export function plainCount(text: string): string {
  return text.replace(COUNTED, (_m, num: string, phrase: string, verb: string | undefined) => {
    const one = Number(num.replace(/,/g, "")) === 1;
    const noun = phrase.replace(/y\(ies\)/g, one ? "y" : "ies").replace(/\(s\)/g, one ? "" : "s");
    return `${num} ${noun}${verb ? ` ${one ? ONE_VERB[verb] : verb}` : ""}`;
  });
}
