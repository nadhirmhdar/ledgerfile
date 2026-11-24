import { BENCHMARKS, type AreaRisks } from "./audit";
import { formatAmount } from "./money";
import type { Derivation, Indicator, PlanningAccount, PlanningAnswers } from "./planning";

/**
 * The planning questionnaire: its sections and questions, the answers the app fills in for a person to confirm, the rule for which questions are
 * mandatory, the materiality rationale built from the answers, and the revenue presumption. Pure. All of the wording is an unreviewed draft, written in
 * our own words, and cites a standard by number only.
 */

export const QUESTIONNAIRE_DRAFT_TITLE = "Planning questionnaire: an unreviewed draft";
export const QUESTIONNAIRE_DRAFT =
  "The questions, the rules that fill in answers and the wording are an unreviewed draft: check them against the standards and your firm's policy before you rely on them. Nothing is final until a person confirms it. An answer the app filled in shows where it came from, and changing it needs a reason. Nothing here holds up the lock.";

export type QuestionType = "yesno" | "choice" | "text";
export type SectionNo = 1 | 8 | 9 | 10 | 11;

export interface QuestionDef {
  key: string;
  section: SectionNo;
  label: string;
  help?: string;
  type: QuestionType;
  choices?: { value: string; label: string }[];
}

export const SECTIONS: { n: SectionNo; title: string; standards: string; blurb: string }[] = [
  { n: 1, title: "Profile", standards: "ISA 300, 315, 320", blurb: "Who relies on the statements and what is different this year. These answers move the suggested materiality." },
  { n: 8, title: "Going concern", standards: "ISA 570", blurb: "Mandatory when an indicator on the firm's going-concern list is found on the trial balance. Management's assessment should cover at least twelve months from the report date." },
  { n: 9, title: "Fraud", standards: "ISA 240", blurb: "Revenue recognition is presumed to be a significant risk. Management override is always one." },
  { n: 10, title: "Understanding the entity", standards: "ISA 315, 330", blurb: "The business, its systems and whether the audit relies on controls. Other indicators found on the trial balance open their question here." },
  { n: 11, title: "Laws and regulations, and related parties", standards: "ISA 250, 550", blurb: "What could breach the law or regulation, and who the related parties are." },
];

export const STATIC_QUESTIONS: QuestionDef[] = [
  {
    key: "entity_type",
    section: 1,
    label: "What kind of entity is it?",
    help: "It decides the benchmark: total expenses for a not-for-profit or cost-centre entity, total assets for an entity that mainly holds assets, equity for a holding entity.",
    type: "choice",
    choices: [
      { value: "trading", label: "An ordinary trading entity" },
      { value: "not_for_profit", label: "A not-for-profit, or a cost centre" },
      { value: "asset_holding", label: "An entity that mainly holds assets" },
      { value: "holding", label: "A holding entity" },
    ],
  },
  { key: "reliance_bank", section: 1, label: "Does a bank rely on the statements?", help: "A yes moves the suggested percentage to the low end of the firm's range.", type: "yesno" },
  { key: "reliance_other", section: 1, label: "Who else relies on the statements: the owners, a regulator, others?", type: "text" },
  { key: "owner_managed", section: 1, label: "Is the entity owner-managed?", type: "yesno" },
  { key: "first_year", section: 1, label: "Is this the first audit of the entity?", help: "A yes lowers the suggested percentage and performance materiality, and the opening-balances checklist (ISA 510) applies.", type: "yesno" },
  { key: "prior_modified", section: 1, label: "Was the prior-year opinion modified?", type: "yesno" },
  { key: "prior_misstatements", section: 1, label: "Were misstatements found in the prior year?", help: "A yes moves the suggested percentage to the low end of the firm's range.", type: "yesno" },
  { key: "prior_adjustments", section: 1, label: "Did prior-year adjustments or misstatements exceed the clearly trivial threshold?", help: "A yes lowers performance materiality to the middle of the firm's reduced range.", type: "yesno" },
  { key: "control_concerns", section: 1, label: "Are there concerns about the entity's controls?", help: "A yes lowers performance materiality to the middle of the firm's reduced range.", type: "yesno" },
  { key: "business_change", section: 1, label: "Has the business changed in the year (new activities, ownership, systems)?", type: "yesno" },

  { key: "gc_assessment", section: 8, label: "What assessment has management made of the entity's ability to carry on, and what does it say?", type: "text" },
  { key: "gc_period", section: 8, label: "Does management's assessment cover at least twelve months from the report date?", type: "yesno" },
  { key: "gc_support", section: 8, label: "What support does the entity rely on to carry on (a facility, a shareholder, a plan), and is it in writing?", type: "text" },

  { key: "fraud_discussion", section: 9, label: "Has the team discussed where the statements could be misstated by fraud?", type: "yesno" },

  { key: "industry", section: 10, label: "What does the entity do, in what industry, and which regulation applies to it?", type: "text" },
  { key: "accounting_system", section: 10, label: "Which accounting system does the entity use, and who can post and change entries?", type: "text" },
  { key: "it_environment", section: 10, label: "Which IT applications matter to financial reporting, and who controls access and backups?", type: "text" },
  { key: "controls_reliance", section: 10, label: "Will the audit rely on the entity's controls?", help: "No means a substantive approach (ISA 330). Answer yes only if you plan to test the controls.", type: "yesno" },
  { key: "known_related_parties", section: 10, label: "Which related parties does management know of?", type: "text" },

  { key: "laws_regulations", section: 11, label: "Which laws and regulations have a direct effect on the statements, and does management know of any breach?", type: "text" },
  { key: "rp_balances", section: 11, label: "Are the related-party balances supported and disclosed? Say what you found.", type: "text" },
];

/** The key of a question that a found indicator opens. */
export const indicatorKey = (key: string): string => `ind_${key}`;
export const REVENUE_PRESUMPTION_KEY = "revenue_presumption";

/** The question a found indicator opens: in the going-concern section when the indicator triggers it, otherwise in the understanding section. */
export function indicatorQuestion(i: Indicator): QuestionDef {
  return { key: indicatorKey(i.key), section: i.triggersGoingConcern ? 8 : 10, label: `${i.label}: ${i.question}`, help: i.detail, type: "text" };
}

export interface AutoAnswer {
  value: string;
  /** Where the value came from, in words. */
  source: string;
}

const money = (minor: number) => formatAmount(Math.abs(minor));

/** The answers the app can fill in for a person to confirm. Not saved: a person confirms or overrides each one. */
export function autoAnswers(accounts: PlanningAccount[]): Record<string, AutoAnswer> {
  const out: Record<string, AutoAnswer> = {};
  const mapped = accounts.filter((a) => a.groupCode !== null);
  if (mapped.length > 0 && !accounts.some((a) => (a.priorMinor ?? 0) !== 0)) out.first_year = { value: "yes", source: "The trial balance has no prior-year balances, which usually means a first year." };
  out.controls_reliance = { value: "no", source: "The default: a substantive approach, with no reliance on controls (ISA 330)." };
  const related = (code: string) => accounts.filter((a) => a.groupCode === code).reduce((n, a) => n + a.closingMinor, 0);
  const due = related("RPREC");
  const owed = related("RPPAY");
  if (due !== 0 || owed !== 0) {
    const parts = [due !== 0 ? `${money(due)} due from related parties` : null, owed !== 0 ? `${money(owed)} due to related parties` : null].filter(Boolean);
    out.rp_balances = { value: `The trial balance shows ${parts.join(" and ")}.`, source: "Worked out from the related-party lead sheets." };
  }
  return out;
}

/** The materiality inputs and risk answers that a person's answers give the derivation. An answer not given is left out. */
export function planningAnswersOf(values: Record<string, string>): PlanningAnswers {
  const yes = (k: string) => (values[k] === undefined ? undefined : values[k] === "yes");
  const out: PlanningAnswers = {};
  if (values.entity_type === "trading" || values.entity_type === "not_for_profit" || values.entity_type === "asset_holding" || values.entity_type === "holding") out.entityType = values.entity_type;
  const set = <K extends keyof PlanningAnswers>(k: K, v: PlanningAnswers[K]) => {
    if (v !== undefined) out[k] = v;
  };
  set("reliedOnByBank", yes("reliance_bank"));
  set("firstYear", yes("first_year"));
  set("priorMisstatements", yes("prior_misstatements"));
  set("priorAdjustmentsAboveTrivial", yes("prior_adjustments"));
  set("controlConcerns", yes("control_concerns"));
  return out;
}

export type AnswerState = "unanswered" | "suggested" | "confirmed" | "answered" | "overridden";
export const STATE_LABEL: Record<AnswerState, string> = {
  unanswered: "Not answered",
  suggested: "Suggested, not confirmed",
  confirmed: "Confirmed",
  answered: "Answered",
  overridden: "Overridden",
};

export interface StoredAnswerView {
  key: string;
  value: string;
  source: "auto" | "person";
  reason: string | null;
  by: string;
  at: string;
}

export interface QuestionView extends QuestionDef {
  state: AnswerState;
  /** The value now in force: the person's, else the suggested one. */
  value: string | null;
  auto: AutoAnswer | null;
  stored: StoredAnswerView | null;
  mandatory: boolean;
  /** Every earlier answer, newest first, including the one in force. */
  history: StoredAnswerView[];
}

export interface SectionView {
  n: SectionNo;
  title: string;
  standards: string;
  blurb: string;
  questions: QuestionView[];
}

/** The state of one answer. A suggested value is not an answer until a person confirms it. */
export function answerState(stored: StoredAnswerView | null, auto: AutoAnswer | null): AnswerState {
  if (stored) {
    if (stored.source === "auto") return "confirmed";
    return auto && stored.value !== auto.value ? "overridden" : "answered";
  }
  return auto ? "suggested" : "unanswered";
}

/** The values in force: a stored answer, else the app's suggested value. This is what the derivation reads. */
export function valuesInForce(stored: Map<string, StoredAnswerView>, auto: Record<string, AutoAnswer>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, a] of Object.entries(auto)) out[k] = a.value;
  for (const [k, a] of stored) out[k] = a.value;
  return out;
}

/**
 * The sections with their questions, from the derivation (which says which indicators are found), the answers stored and the suggested values.
 * A question is mandatory when it is a going-concern question and the firm's list of triggers has a hit, or when it is the question of a found indicator
 * that is on that list. Section 8 appears when it is mandatory or already has an answer; the question of an indicator appears when it is found or already
 * has an answer.
 */
export function buildSections(d: Derivation, stored: Map<string, StoredAnswerView>, history: StoredAnswerView[], auto: Record<string, AutoAnswer>): SectionView[] {
  const gc = d.goingConcern.required;
  const defs: { def: QuestionDef; mandatory: boolean }[] = [];
  for (const q of STATIC_QUESTIONS) {
    if (q.section === 8 && !gc && !stored.has(q.key)) continue;
    defs.push({ def: q, mandatory: q.section === 8 && gc });
  }
  for (const i of d.indicators) {
    const q = indicatorQuestion(i);
    if (!i.hit && !stored.has(q.key)) continue;
    defs.push({ def: q, mandatory: i.hit && i.triggersGoingConcern });
  }
  return SECTIONS.map((s) => ({
    n: s.n,
    title: s.title,
    standards: s.standards,
    blurb: s.blurb,
    questions: defs
      .filter((x) => x.def.section === s.n)
      .map(({ def, mandatory }) => {
        const st = stored.get(def.key) ?? null;
        const au = auto[def.key] ?? null;
        return { ...def, state: answerState(st, au), value: st?.value ?? au?.value ?? null, auto: au, stored: st, mandatory, history: history.filter((h) => h.key === def.key) };
      }),
  }));
}

/** A mandatory question is answered once a person has confirmed, answered or overridden it. */
export const mandatoryOpen = (sections: SectionView[]): QuestionView[] => sections.flatMap((s) => s.questions).filter((q) => q.mandatory && (q.state === "unanswered" || q.state === "suggested"));

/** Whether a value is acceptable for a question. A message in plain words when it is not. */
export function checkValue(def: QuestionDef, raw: string): { ok: true; value: string } | { ok: false; message: string } {
  const value = raw.trim();
  if (value === "") return { ok: false, message: "Enter an answer." };
  if (value.length > 2000) return { ok: false, message: "The answer is too long." };
  if (def.type === "yesno" && value !== "yes" && value !== "no") return { ok: false, message: "Answer yes or no." };
  if (def.type === "choice" && !def.choices?.some((c) => c.value === value)) return { ok: false, message: "Choose one of the answers offered." };
  return { ok: true, value };
}

/** How an answer reads in the rationale and the history. */
export function answerText(def: QuestionDef, value: string): string {
  if (def.type === "yesno") return value === "yes" ? "yes" : "no";
  if (def.type === "choice") return def.choices?.find((c) => c.value === value)?.label ?? value;
  return value;
}

/** The materiality rationale the questionnaire proposes, from the derivation and the answers in force. The person can change it before saving. */
export function buildRationale(d: Derivation, values: Record<string, string>): string {
  if (!d.benchmark || !d.percentage || !d.suggested) return "";
  const b = d.benchmark;
  const parts = [
    `Benchmark: ${BENCHMARKS[b.benchmark].label.toLowerCase()} of ${money(b.amountMinor)}. ${b.reason}`,
    `Percentage: ${d.percentage.bp / 100}%. ${d.percentage.reasons.join(" ")}`,
    `Performance materiality: ${d.performance.pct}% of overall. ${d.performance.reasons.join(" ")}`,
    `Clearly trivial: ${d.suggested.trivialPct}% of overall.`,
  ];
  const given = STATIC_QUESTIONS.filter((q) => q.section === 1 && q.type !== "text" && values[q.key] !== undefined).map((q) => `${q.label.replace(/\?$/, "")}: ${answerText(q, values[q.key])}`);
  if (given.length > 0) parts.push(`Answers in the planning questionnaire: ${given.join("; ")}.`);
  parts.push("Proposed by the planning questionnaire, whose rules are an unreviewed draft.");
  return parts.join(" ").slice(0, 2000);
}

// --- The revenue presumption ---------------------------------------------------------------------------------------------------------------

export interface RevenuePresumption {
  rebutted: boolean;
  reason: string | null;
  by: string | null;
  at: string | null;
}

/**
 * When the revenue presumption stands, a rating of C13 below significant for occurrence or cut-off is flagged in the area form. It is a flag, not a block:
 * the person may keep the rating, and should say why. Returns the assertions rated below significant, or none.
 */
export function revenueRatingFlag(areaCode: string, risks: AreaRisks, rebutted: boolean): string[] {
  if (areaCode !== "C13" || rebutted) return [];
  const flagged: string[] = [];
  if (risks.E && risks.E !== "significant") flagged.push("existence and occurrence");
  if (risks.CO && risks.CO !== "significant") flagged.push("cut-off");
  return flagged;
}

export const REVENUE_FLAG_TEXT = (assertions: string[]): string =>
  `Revenue recognition is presumed to be a significant risk (ISA 240), and no partner has rebutted that. The rating for ${assertions.join(" and ")} is below significant. You can keep it, but record why in the rationale, or ask a partner to rebut the presumption with a reason in the planning questionnaire.`;

// --- Checklist steps the questionnaire covers -----------------------------------------------------------------------------------------------

/** Checklist steps whose question is in the questionnaire. The questionnaire never completes a step: it only points to where the answer is. */
const COVERED: Record<string, SectionNo | "materiality"> = {
  "B1.04": 10,
  "B1.07": 10,
  "B1.10": 10,
  "B2.01": "materiality",
  "B2.02": "materiality",
  "B2.03": "materiality",
  "B2.04": "materiality",
  "B4.05": 9,
  "B4.06": 9,
  "B5.01": 11,
  "B5.02": 11,
  "B6.01": 11,
  "B7.01": 8,
  "B7.02": 8,
};

/** For a checklist step, where in the planning questionnaire its question is answered, or null. */
export function coveredInQuestionnaire(stepId: string): { label: string; anchor: string } | null {
  const c = COVERED[stepId];
  if (c === undefined) return null;
  return c === "materiality" ? { label: "the materiality confirmation of the planning questionnaire", anchor: "confirm-materiality" } : { label: `the planning questionnaire, section ${c}`, anchor: `section-${c}` };
}
