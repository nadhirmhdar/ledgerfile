/**
 * The firm's record of adopting the methodology library. Pure: it reads nothing and changes nothing, so the page, the audit overview and the tests use
 * the same words.
 *
 * Adopting is a partner's statement that the firm has reviewed the library, with its own changes to it, and uses it. It does not make the library
 * reviewed by anyone else, and the "unreviewed draft" label beside it does not change: the adoption is shown as one factual line next to it.
 */

/** The exact words a partner confirms; stored with the adoption. */
export const ADOPT_STATEMENT = "I have reviewed this methodology, with the firm's changes listed on this page, and adopt it for use on this firm's engagements.";

export const MAX_NOTE = 1000;
export const MAX_REASON = 1000;
export const MIN_REASON = 5;

export const NOT_CONFIRMED = "Tick the box to confirm the statement before recording the adoption.";
export const NOTHING_CHANGED = "Nothing has changed since this methodology was adopted, so there is nothing new to record.";
export const NOT_ADOPTED_SO_NO_WITHDRAW = "The methodology is not adopted, so there is nothing to withdraw.";

/** JSON with every object's keys in order, so the same content always gives the same text whatever order it was built in. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export interface AdoptionRecord {
  id: number;
  kind: "adopted" | "withdrawn";
  version: string;
  fingerprint: string;
  changeCount: number;
  statement: string | null;
  note: string | null;
  reason: string | null;
  by: string;
  /** Date, UTC. */
  at: string;
}

/** The methodology as it is now: the library's version, the fingerprint of the library with the firm's changes, and how many changes the firm has. */
export interface MethodologyNow {
  version: string;
  fingerprint: string;
  changeCount: number;
}

export type AdoptionState =
  | { kind: "none"; withdrawn: AdoptionRecord | null }
  | { kind: "current"; adoption: AdoptionRecord }
  | { kind: "changed"; adoption: AdoptionRecord; what: string[] };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What differs between an adoption and the methodology now, in words. Empty when nothing does. */
export function changedWhat(adoption: Pick<AdoptionRecord, "version" | "fingerprint" | "changeCount">, now: MethodologyNow): string[] {
  const what: string[] = [];
  if (adoption.version !== now.version) what.push(`the library changed from version ${adoption.version} to version ${now.version}`);
  if (adoption.fingerprint !== now.fingerprint) {
    if (now.changeCount !== adoption.changeCount) what.push(`the firm now has ${plural(now.changeCount, "change", "changes")} (it had ${adoption.changeCount} when adopted)`);
  }
  // The library or the firm's changes differ in some way the counts above do not name (a library update with the same version, say).
  if (what.length === 0 && adoption.fingerprint !== now.fingerprint) what.push("the library or the firm's changes differ from what was adopted");
  return what;
}

/** The state from the history (newest first) and the methodology now. */
export function stateFrom(historyNewestFirst: AdoptionRecord[], now: MethodologyNow): AdoptionState {
  const latest = historyNewestFirst[0];
  if (!latest || latest.kind === "withdrawn") return { kind: "none", withdrawn: latest ?? null };
  const what = changedWhat(latest, now);
  return what.length === 0 ? { kind: "current", adoption: latest } : { kind: "changed", adoption: latest, what };
}

/** The one factual line shown beside the unreviewed-draft label. It never says the content is reviewed by anyone outside the firm. */
export function adoptionLine(state: AdoptionState): string {
  if (state.kind === "none") return "Not adopted for this firm.";
  const base = `Adopted for this firm on ${state.adoption.at} (library v${state.adoption.version})`;
  return state.kind === "current" ? `${base}.` : `${base}; the methodology has changed since.`;
}

/** The full sentence in the Adoption section. */
export const adoptionSentence = (a: Pick<AdoptionRecord, "by" | "at" | "version">): string => `Adopted for this firm by ${a.by} on ${a.at}, library v${a.version}.`;

export const changedWarning = (a: Pick<AdoptionRecord, "at">, what: string[]): string =>
  `The methodology has changed since it was adopted on ${a.at}: ${what.join("; ")}. Record adoption again to cover the current version.`;

/** What the lock's audit detail records. */
export type LockAdoption = { id: number; version: string; changedSinceAdoption: boolean } | "none";

export function lockAdoption(state: AdoptionState): LockAdoption {
  if (state.kind === "none") return "none";
  return { id: state.adoption.id, version: state.adoption.version, changedSinceAdoption: state.kind === "changed" };
}
