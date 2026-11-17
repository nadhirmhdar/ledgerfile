import { formatAmount } from "../domain/money";
import { OPINION_KINDS, OPINION_LABEL, type OpinionKind } from "../domain/report";
import { canLock, type Role } from "../domain/signoff";
import type { Tone } from "./status";
import { count } from "./text";

/** How the Auditor's report page words its facts and decides which fields and controls show. Pure; the server still enforces every rule. */

/** One muted line under each choice. */
export const OPINION_HINT: Record<OpinionKind, string> = {
  unmodified: "The statements present fairly, in all material respects, and there is nothing to modify.",
  qualified: "Except for one matter that is material but not pervasive, the statements present fairly.",
  adverse: "A material and pervasive misstatement means the statements do not present fairly.",
  disclaimer: "Evidence could not be obtained on a matter that is material and pervasive, so no opinion is given.",
};

export interface OpinionFields {
  /** The basis-for-modification text: shown and required for every modified opinion. */
  basis: boolean;
  /** The going-concern checkbox and its note reference. Not offered for a disclaimer in this draft. */
  goingConcern: boolean;
  /** Emphasis of matter. Not offered for a disclaimer in this draft. */
  emphasis: boolean;
}

export function opinionFields(kind: OpinionKind): OpinionFields {
  return { basis: kind !== "unmodified", goingConcern: kind !== "disclaimer", emphasis: kind !== "disclaimer" };
}

export { OPINION_KINDS, OPINION_LABEL };

/** The summary of the recorded decision. */
export function decisionSentence(d: { opinion: OpinionKind; decidedByName: string; decidedAt: string; reportDate: string | null }): string {
  const date = d.reportDate ? ` Report dated ${d.reportDate}.` : " No report date yet.";
  return `${OPINION_LABEL[d.opinion]}, recorded by ${d.decidedByName} on ${d.decidedAt}.${date}`;
}

/** The badge for the recorded opinion: an unmodified opinion is green, any modification is amber or red, a disclaimer is red. */
export function opinionBadge(kind: OpinionKind): { tone: Tone; label: string } {
  return { tone: kind === "unmodified" ? "success" : kind === "qualified" ? "warning" : "danger", label: OPINION_LABEL[kind] };
}

/** Net uncorrected misstatements against overall materiality, as a pill and a sentence. */
export function misstatementPill(f: { overallMinor: number | null; uncorrectedNetMinor: number; uncorrectedCount: number; exceedsMateriality: boolean }): { tone: Tone; label: string; sentence: string } {
  if (f.overallMinor === null) return { tone: "neutral", label: "Materiality not set", sentence: "Materiality has not been set, so uncorrected misstatements cannot be compared with it." };
  const amount = `${count(f.uncorrectedCount, "uncorrected misstatement")}, net ${formatAmount(f.uncorrectedNetMinor)}, against overall materiality of ${formatAmount(f.overallMinor)}`;
  return f.exceedsMateriality
    ? { tone: "danger", label: "Reach materiality", sentence: `${amount}. They reach materiality, so an unmodified opinion cannot be recorded.` }
    : { tone: "success", label: "Below materiality", sentence: `${amount}.` };
}

/** Why the form is not offered; null when the viewer may record the opinion. */
export function opinionReadOnlyReason(s: { role: Role; open: boolean; auditOn: boolean }): string | null {
  if (!s.auditOn) return null; // the page shows the audit-off notice instead
  if (!s.open) return "This engagement is locked, so the opinion is read-only.";
  if (!canLock(s.role)) return "A partner records the opinion.";
  return null;
}

export interface FormValues {
  opinion: OpinionKind | "";
  basis: string;
  goingConcern: boolean;
  goingConcernNote: string;
  emphasis: string;
  reportDate: string;
}

/** What the form can say before it is sent: the same plain sentences the server would give. */
export function formProblems(v: FormValues): string[] {
  const problems: string[] = [];
  if (!v.opinion) {
    problems.push("Choose the kind of opinion.");
    return problems;
  }
  const fields = opinionFields(v.opinion);
  if (fields.basis && v.basis.trim() === "") problems.push(`${/^[aeiou]/i.test(OPINION_LABEL[v.opinion]) ? "An" : "A"} ${OPINION_LABEL[v.opinion].toLowerCase()} needs the basis for the modification: say what the matter is and what it affects.`);
  if (fields.goingConcern && v.goingConcern && v.goingConcernNote.trim() === "") problems.push("Give the note where the going-concern uncertainty is disclosed.");
  if (v.reportDate.trim() === "") problems.push("Enter the date of the report.");
  return problems;
}
