import type { Tx } from "./db";
import { audit as log, getEngagement, listAccounts, type Session } from "./repo";
import { getAuditOverview, requireAudit, setMateriality } from "./audit";
import { getPlanningDerivation } from "./planning";
import { canLock } from "../domain/signoff";
import { INDICATOR_KEYS } from "../domain/planning-settings";
import type { Derivation, PlanningAccount } from "../domain/planning";
import {
  autoAnswers,
  buildRationale,
  buildSections,
  checkValue,
  mandatoryOpen,
  planningAnswersOf,
  REVENUE_PRESUMPTION_KEY,
  STATIC_QUESTIONS,
  valuesInForce,
  type AutoAnswer,
  type QuestionDef,
  type RevenuePresumption,
  type SectionView,
  type StoredAnswerView,
} from "../domain/planning-questions";

/**
 * The planning questionnaire: answers kept per engagement and question, each with its source, an override reason, who and when. A change is a new row, so
 * the history is whole. A value the app suggests is not an answer until a person confirms it, and changing a suggested value needs a reason. Confirming
 * materiality writes one new materiality revision through the same function the planning page's form uses. Nothing here holds up the lock.
 */

export const NOT_PARTNER_REBUT = "Only a partner can rebut the revenue presumption.";
const REASON_SHORT = "Record why, in at least a few words.";

interface Row {
  key: string;
  value: string;
  source: "auto" | "person";
  reason: string | null;
  by: string;
  at: string;
}

async function loadAnswers(tx: Tx, engagementId: string): Promise<{ current: Map<string, StoredAnswerView>; history: StoredAnswerView[] }> {
  const { rows } = await tx.query<Row>(
    `select a.question_key as key, a.value, a.source, a.reason, u.name as by, to_char(a.answered_at at time zone 'UTC', 'YYYY-MM-DD') as at
     from planning_answers a join users u on u.id = a.answered_by
     where a.engagement_id = $1 order by a.seq desc`,
    [engagementId],
  );
  const current = new Map<string, StoredAnswerView>();
  for (const r of rows) if (!current.has(r.key)) current.set(r.key, r);
  return { current, history: rows };
}

const toAccounts = (accounts: Awaited<ReturnType<typeof listAccounts>>): PlanningAccount[] =>
  accounts.map((a) => ({ code: a.code, name: a.name, closingMinor: a.closingMinor + a.adjustmentMinor, priorMinor: a.priorMinor, groupCode: a.groupCode }));

const presumptionOf = (a: StoredAnswerView | undefined): RevenuePresumption => (a && a.value === "rebutted" ? { rebutted: true, reason: a.reason, by: a.by, at: a.at } : { rebutted: false, reason: null, by: a?.by ?? null, at: a?.at ?? null });

/** Whether a partner has rebutted the revenue presumption on C13, and the reason, who and when. */
export async function getRevenuePresumption(tx: Tx, engagementId: string): Promise<RevenuePresumption> {
  const { current } = await loadAnswers(tx, engagementId);
  return presumptionOf(current.get(REVENUE_PRESUMPTION_KEY));
}

export interface Questionnaire {
  derivation: Derivation;
  customised: boolean;
  sections: SectionView[];
  mandatoryOpen: number;
  revenue: RevenuePresumption;
  /** The rationale the questionnaire proposes with the suggested materiality, or "" when nothing can be suggested. */
  rationale: string;
}

/**
 * The questionnaire for an engagement: its sections, each question with the answer in force and its source, the going-concern questions the firm's list
 * makes mandatory, and the suggested materiality from the answers. An engagement with materiality and ratings already on file shows them on the planning
 * page as before; reading this saves nothing.
 */
export async function getQuestionnaire(tx: Tx, engagementId: string): Promise<Questionnaire | null> {
  const engagement = await getEngagement(tx, engagementId);
  if (!engagement) return null;
  const accounts = toAccounts(await listAccounts(tx, engagementId));
  const auto = autoAnswers(accounts);
  const { current, history } = await loadAnswers(tx, engagementId);
  const values = valuesInForce(current, auto);
  const planned = (await getPlanningDerivation(tx, engagementId, planningAnswersOf(values)))!;
  const sections = buildSections(planned.derivation, current, history, auto);
  return {
    derivation: planned.derivation,
    customised: planned.settings.customised,
    sections,
    mandatoryOpen: mandatoryOpen(sections).length,
    revenue: presumptionOf(current.get(REVENUE_PRESUMPTION_KEY)),
    rationale: buildRationale(planned.derivation, values),
  };
}

function definitionOf(key: string): QuestionDef | null {
  const fixed = STATIC_QUESTIONS.find((q) => q.key === key);
  if (fixed) return fixed;
  if (key.startsWith("ind_") && (INDICATOR_KEYS as string[]).includes(key.slice(4))) return { key, section: 10, label: "", type: "text" };
  return null;
}

/**
 * Save one answer. A value the app suggested can be confirmed as it is; a different value is an override and needs a reason. An answer with no suggested
 * value needs none. Saving what is already in force writes nothing. Any signed-in role may answer; the engagement must be open with the audit on.
 */
export async function savePlanningAnswer(tx: Tx, s: Session, engagementId: string, key: string, rawValue: string, rawReason = ""): Promise<boolean> {
  await requireAudit(tx, engagementId);
  const def = definitionOf(key);
  if (!def) throw new Error("That question is not in the questionnaire.");
  const checked = checkValue(def, rawValue);
  if (!checked.ok) throw new Error(checked.message);
  const accounts = toAccounts(await listAccounts(tx, engagementId));
  const auto: AutoAnswer | undefined = autoAnswers(accounts)[key];
  const reason = rawReason.trim();
  let source: "auto" | "person" = "person";
  let kept: string | null = null;
  if (auto && checked.value === auto.value) source = "auto";
  else if (auto) {
    if (reason.length < 5) throw new Error(`The app suggested a different answer. ${REASON_SHORT}`);
    if (reason.length > 2000) throw new Error("The reason is too long.");
    kept = reason;
  }
  const { current } = await loadAnswers(tx, engagementId);
  const now = current.get(key);
  if (now && now.value === checked.value && now.source === source && (now.reason ?? null) === kept) return false;
  await tx.query("insert into planning_answers (firm_id, engagement_id, question_key, value, source, reason, answered_by) values ($1, $2, $3, $4, $5, $6, $7)", [s.firmId, engagementId, key, checked.value, source, kept, s.userId]);
  await log(tx, s, "answer_planning_question", "engagement", engagementId, { key, source, overridden: kept !== null });
  return true;
}

async function requirePartner(tx: Tx, s: Session): Promise<void> {
  const { rows } = await tx.query<{ role: string }>("select role from users where id = $1", [s.userId]);
  if (!canLock((rows[0]?.role ?? s.role) as Session["role"])) throw new Error(NOT_PARTNER_REBUT);
}

/** A partner rebuts the presumed revenue risk on C13, with a reason that is kept and shown on the review page. */
export async function rebutRevenuePresumption(tx: Tx, s: Session, engagementId: string, rawReason: string): Promise<void> {
  await requireAudit(tx, engagementId);
  await requirePartner(tx, s);
  const reason = rawReason.trim();
  if (reason.length < 10) throw new Error("Record the reason the presumption does not apply, in at least a sentence.");
  if (reason.length > 2000) throw new Error("The reason is too long.");
  if ((await getRevenuePresumption(tx, engagementId)).rebutted) throw new Error("The revenue presumption is already rebutted.");
  await tx.query("insert into planning_answers (firm_id, engagement_id, question_key, value, source, reason, answered_by) values ($1, $2, $3, 'rebutted', 'person', $4, $5)", [s.firmId, engagementId, REVENUE_PRESUMPTION_KEY, reason, s.userId]);
  await log(tx, s, "rebut_revenue_presumption", "engagement", engagementId, { reason });
}

/** A partner puts the presumption back. */
export async function reinstateRevenuePresumption(tx: Tx, s: Session, engagementId: string): Promise<void> {
  await requireAudit(tx, engagementId);
  await requirePartner(tx, s);
  if (!(await getRevenuePresumption(tx, engagementId)).rebutted) throw new Error("The revenue presumption has not been rebutted.");
  await tx.query("insert into planning_answers (firm_id, engagement_id, question_key, value, source, reason, answered_by) values ($1, $2, $3, 'standing', 'person', null, $4)", [s.firmId, engagementId, REVENUE_PRESUMPTION_KEY, s.userId]);
  await log(tx, s, "reinstate_revenue_presumption", "engagement", engagementId, {});
}

/**
 * Confirm the suggested materiality. The figures come from the questionnaire's derivation (never from the form); only the rationale is typed. It writes
 * one new materiality revision through setMateriality, so the same rules apply: a reviewer or partner, the guide warnings, and the partner's approval
 * of the risk assessment lapses as it does for any change. Returns the guide warnings.
 */
export async function confirmPlanningMateriality(tx: Tx, s: Session, engagementId: string, rationale: string): Promise<string[]> {
  await requireAudit(tx, engagementId);
  const q = await getQuestionnaire(tx, engagementId);
  const d = q?.derivation;
  if (!d || !d.benchmark || !d.percentage || !d.suggested) throw new Error("There is nothing to confirm yet: import a trial balance and map its accounts first.");
  const warnings = await setMateriality(tx, s, engagementId, {
    benchmark: d.benchmark.benchmark,
    percentageBp: d.percentage.bp,
    performancePct: d.performance.pct,
    trivialPct: d.suggested.trivialPct,
    rationale,
  });
  await log(tx, s, "confirm_planning_materiality", "engagement", engagementId, { benchmark: d.benchmark.benchmark, mandatoryOpen: q.mandatoryOpen });
  return warnings;
}

/** The materiality and the ratings on file, for the questionnaire page to show alongside (so an engagement already planned needs no re-entry). */
export async function getPlanningOnFile(tx: Tx, engagementId: string) {
  const overview = await getAuditOverview(tx, engagementId);
  if (!overview) return null;
  return { enabled: overview.enabled, materiality: overview.materiality, areas: overview.areas, approval: overview.approval };
}
