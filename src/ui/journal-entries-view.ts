import type { Tone } from "./status";
import { count } from "./text";

/** How the journal entries page words its status, names an entry, and shows whether the entry being typed balances. Pure. */

export type EntryType = "adjusting" | "reclassification";

/** "2 entries posted: 1 adjusting, 1 reclassification." or the empty sentence. A type with none is left out. */
export function entriesSentence(entries: { type: string }[]): string {
  if (entries.length === 0) return "No entries posted yet. Lead sheets and statements show the trial balance as imported.";
  const adjusting = entries.filter((e) => e.type === "adjusting").length;
  const reclass = entries.length - adjusting;
  const parts = [adjusting > 0 ? `${adjusting} adjusting` : "", reclass > 0 ? `${count(reclass, "reclassification")}` : ""].filter(Boolean);
  return `${count(entries.length, "entry", "entries")} posted: ${parts.join(", ")}.`;
}

/** "AJE 1" or "RJE 3". */
export const entryReference = (type: string, number: number): string => `${type === "adjusting" ? "AJE" : "RJE"} ${number}`;

/** Debit and credit totals of an entry's lines, in minor units: a positive line is a debit, a negative one a credit. */
export function entryTotals(lines: { amountMinor: number }[]): { debitMinor: number; creditMinor: number } {
  return {
    debitMinor: lines.reduce((s, l) => s + (l.amountMinor > 0 ? l.amountMinor : 0), 0),
    creditMinor: lines.reduce((s, l) => s + (l.amountMinor < 0 ? -l.amountMinor : 0), 0),
  };
}

const money = (n: number): string => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type BalanceState = "empty" | "balanced" | "out";

export interface BalancePill {
  state: BalanceState;
  label: string;
  tone: Tone;
  /** The sentence beside the Post button saying why it is disabled; null when the entry can be posted. */
  blocked: string | null;
}

/**
 * Whether the entry being typed balances, from its debit and credit totals in currency units (the form's own running totals). The
 * words carry the state: "Enter amounts", "Out by 120.00", "Balanced". The totals are compared to the cent, as the form always did.
 */
export function balancePill(debits: number, credits: number): BalancePill {
  const difference = Math.round((debits - credits) * 100) / 100;
  if (debits === 0 && credits === 0) return { state: "empty", label: "Enter amounts", tone: "neutral", blocked: "Enter the lines; debits must equal credits." };
  if (difference !== 0) return { state: "out", label: `Out by ${money(Math.abs(difference))}`, tone: "danger", blocked: `Out of balance by ${money(Math.abs(difference))}.` };
  // Posting also needs a non-zero debit, as it always did: an entry of nothing but credits of zero cannot balance here.
  return { state: "balanced", label: "Balanced", tone: "success", blocked: debits === 0 ? "Enter the lines; debits must equal credits." : null };
}

export { money as formatEntryAmount };
