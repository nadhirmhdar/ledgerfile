import { count } from "./text";
import type { Tone } from "./status";

/** How the journal entry testing page words its facts and shows an entry's state. Pure: it only rearranges what the ledger gave it. */

/** "16 entries imported: 3 selected, 1 tested." / "No journal listing yet." / "The audit is off for this engagement." */
export function journalSentence(s: { enabled: boolean; entryCount: number | null; selected: number; tested: number }): string {
  if (!s.enabled) return "The audit is off for this engagement.";
  if (s.entryCount === null) return "No journal listing yet.";
  return `${count(s.entryCount, "entry", "entries")} imported: ${s.selected} selected, ${s.tested} tested.`;
}

export type EntryState = "none" | "selected" | "tested";

export interface EntryPill {
  state: EntryState;
  /** The pill's words; null when the entry has no pill. */
  label: string | null;
  tone: Tone;
}

/** The state of an entry from its test record. A pill carries words, so the state is never colour alone. */
export function entryPill(test: { status: string } | null | undefined): EntryPill {
  if (!test) return { state: "none", label: null, tone: "neutral" };
  if (test.status === "tested") return { state: "tested", label: "Tested", tone: "success" };
  return { state: "selected", label: "Selected, to test", tone: "warning" };
}

/** The address of the page with a flag and a user filter, in the order the page has always used (flag, then user). */
export function journalHref(base: string, next: { flag?: string; user?: string }): string {
  const q = new URLSearchParams();
  if (next.flag) q.set("flag", next.flag);
  if (next.user) q.set("user", next.user);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

/** "12 entries match; showing the first 10, selected entries and those with most flags first." */
export function matchingSentence(matching: number, shown: number): string {
  if (matching === 0) return "No entries match.";
  const n = matching.toLocaleString("en-US");
  const head = matching === 1 ? "1 entry matches" : `${n} entries match`;
  const cap = matching > shown ? `; showing the first ${shown}, selected entries and those with most flags first` : "";
  return `${head}${cap}.`;
}

/** The completeness sentence: whether the listing's movement agrees to the trial balance, and how many accounts could not be checked. */
export function completenessSentence(r: { agreed: number; differences: number; unchecked: number }): string {
  const main =
    r.differences === 0
      ? `The listing's movement agrees to the trial balance for all ${count(r.agreed, "account")} checked.`
      : `The listing's movement agrees to the trial balance for ${count(r.agreed, "account")} and differs for ${r.differences}.`;
  return r.unchecked > 0 ? `${main} ${count(r.unchecked, "account")} could not be checked (unmapped, or no prior-year balance).` : main;
}
