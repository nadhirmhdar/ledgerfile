import { formatAmount } from "../domain/money";
import { count } from "./text";

/** How the letters page words its status and the misstatement sentence. Pure: the amounts come from the letter context as it is. */

const net = (amountsMinor: number[]): number => amountsMinor.reduce((n, a) => n + a, 0);

/** "Two letters to download as Word documents." and, when there are uncorrected misstatements, what the representation letter will list. */
export function lettersSentence(uncorrectedMinor: number[]): string {
  const base = "Two letters to download as Word documents.";
  if (uncorrectedMinor.length === 0) return base;
  return `${base} The representation letter lists ${count(uncorrectedMinor.length, "uncorrected misstatement")}, net ${formatAmount(net(uncorrectedMinor))}.`;
}

/** The sentence under the representation letter's purpose. */
export function misstatementSentence(uncorrectedMinor: number[]): string {
  if (uncorrectedMinor.length === 0) return "No uncorrected misstatements are recorded, so the letter will say there are none.";
  return `${count(uncorrectedMinor.length, "uncorrected misstatement")}, net ${formatAmount(net(uncorrectedMinor))}, will be listed in a schedule attached to the letter.`;
}
