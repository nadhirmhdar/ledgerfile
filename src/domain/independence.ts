import type { Check } from "./statements";

/**
 * Independence confirmations (migration 0042). Each person on the engagement team confirms for themselves at planning and again at completion, and the
 * engagement partner records a conclusion for each stage. Pure: it reads nothing and changes nothing.
 *
 * Everything here is a record and a WARNING. Whether an unconfirmed team member should block the lock is an owner decision that has not been taken.
 */

export type Stage = "planning" | "completion";
export const STAGES: Stage[] = ["planning", "completion"];
export const STAGE_LABEL: Record<Stage, string> = { planning: "Planning", completion: "Completion" };

export type Outcome = "confirmed" | "threats_noted";
export type Conclusion = "met" | "not_met";
export const CONCLUSION_LABEL: Record<Conclusion, string> = {
  met: "Independence requirements are met for this engagement",
  not_met: "Not met",
};

/** Draft wording of our own: it states what the person says about themselves and no rule. It is labelled as unreviewed wherever it is shown. */
export const DECLARATION =
  "As far as I know, I have no interest in or relationship with this client that would affect my objectivity on this engagement, other than any I have noted here. I will tell the engagement partner if that changes.";

export const CHECK_LABEL = "Every team member has confirmed independence and the partner has concluded";
export const NOT_CONFIRMED = "Not confirmed";

export const NOT_ON_TEAM = "Only a person on this engagement's team can confirm independence for it.";
export const ONLY_YOURSELF = "Each person confirms for themselves. Nobody can record for another person.";
export const ONLY_PARTNER = "Only the engagement partner can record this conclusion.";
export const THREATS_NEEDED = "Say what the threats are and what safeguards apply, in up to 2,000 characters each.";
export const NOTE_NEEDED = "Add a note of up to 2,000 characters with the conclusion.";
export const TEXT_TOO_LONG = "The text is too long: the most is 2,000 characters.";
export const MAX_TEXT = 2000;

export interface Confirmation {
  outcome: Outcome;
  threats: string;
  safeguards: string;
  /** YYYY-MM-DD, UTC. */
  at: string;
}

export interface StageConclusion {
  conclusion: Conclusion;
  note: string;
  by: string;
  at: string;
}

export interface Member {
  id: string;
  name: string;
  /** Where they sit on the team, in words: "Preparer", "Reviewer", "Partner", "Area preparer". */
  places: string[];
}

export interface Independence {
  members: Member[];
  /** The engagement partner's user id, or null when none is assigned. */
  partnerId: string | null;
  /** Latest confirmation by `${userId}:${stage}`. */
  latest: Map<string, Confirmation>;
  /** Latest conclusion for each stage. */
  conclusions: Partial<Record<Stage, StageConclusion>>;
}

export const confirmationKey = (userId: string, stage: Stage): string => `${userId}:${stage}`;

/** "Confirmed 2026-01-05", "Threats noted 2026-01-05" or "Not confirmed". */
export function statusWords(c: Confirmation | undefined): string {
  if (!c) return NOT_CONFIRMED;
  return c.outcome === "threats_noted" ? `Threats noted ${c.at}` : `Confirmed ${c.at}`;
}

/**
 * The lock warning: who is missing at each stage, and whether the partner has concluded. A "Not met" conclusion is listed too, so the check never reads
 * as passed while the partner says the requirements are not met. It never blocks the lock.
 */
export function independenceCheck(i: Independence): Check {
  const items: string[] = [];
  if (i.members.length === 0) items.push("No one is on the engagement team.");
  if (i.partnerId === null) items.push("No engagement partner is assigned.");
  for (const stage of STAGES) {
    const missing = i.members.filter((m) => !i.latest.has(confirmationKey(m.id, stage))).map((m) => m.name);
    if (missing.length > 0) items.push(`${STAGE_LABEL[stage]}: not confirmed by ${missing.join(", ")}`);
    const c = i.conclusions[stage];
    if (!c) items.push(`${STAGE_LABEL[stage]}: the partner has not concluded`);
    else if (c.conclusion === "not_met") items.push(`${STAGE_LABEL[stage]}: the partner concluded that the requirements are not met`);
  }
  return { label: CHECK_LABEL, passed: items.length === 0, items: items.length === 0 ? undefined : items, severity: "warning" };
}
