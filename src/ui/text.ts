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
