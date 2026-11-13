import type { Tx } from "./db";
import { audit as log, canSelfReviewAudit, getEngagement, listAccounts, type Session } from "./repo";
import { canLock, canReview } from "../domain/signoff";
import { buildStatements } from "../domain/statements";
import { compareYears, unexplainedMovements, type ExplanationRecord } from "../domain/analytics";
import {
  AREA_BY_CODE,
  CHECKLIST_BY_CODE,
  CHECKLISTS,
  needsPartner,
  RISK_APPROVAL_STEP,
  assessmentSnapshot,
  areasInScope,
  assertionsOf,
  BENCHMARKS,
  computeMateriality,
  isAssessed,
  RISK_LEVELS,
  selectProcedures,
  type Area,
  type AreaRisks,
  type Assertion,
  type Benchmark,
  type RiskLevel,
} from "../domain/audit";

export interface MaterialityRow {
  benchmark: Benchmark;
  benchmarkAmountMinor: number;
  percentageBp: number;
  performancePct: number;
  trivialPct: number;
  overallMinor: number;
  performanceMinor: number;
  trivialMinor: number;
  rationale: string;
  setBy: string;
  setAt: string;
}

export interface AreaStatus {
  code: string;
  title: string;
  objective: string;
  assertions: Assertion[];
  risks: AreaRisks;
  fixedRisk?: RiskLevel;
  assessed: boolean;
  procedures: number;
  completed: number;
  /** Completed or not-applicable procedures that no reviewer has signed off yet. */
  unreviewed: number;
}

export interface ChecklistStatus {
  code: string;
  title: string;
  stage: string;
  optional: boolean;
  steps: number;
  completed: number;
  unreviewed: number;
}

export interface MisstatementRow {
  id: string;
  description: string;
  kind: "factual" | "judgemental" | "projected";
  /** Effect on profit before tax: positive when profit is overstated. */
  amountMinor: number;
  corrected: boolean;
  recordedBy: string;
  recordedAt: string;
}

export interface MisstatementSummary {
  items: MisstatementRow[];
  /** Net effect on profit of the uncorrected items. */
  uncorrectedNetMinor: number;
  /** Sum of the uncorrected items ignoring direction, to show how much offsetting there is. */
  uncorrectedGrossMinor: number;
  /** True when the net uncorrected effect, or any single uncorrected item, reaches overall materiality. */
  exceedsMateriality: boolean;
}

export interface AuditOverview {
  /** Figures the materiality calculator can use as a benchmark, from the adjusted trial balance. */
  benchmarks: Record<Benchmark, number>;
  materiality: MaterialityRow | null;
  revisions: number;
  areas: AreaStatus[];
  /** Acceptance, planning, completion and reporting checklists, loaded when the audit is turned on. */
  checklists: ChecklistStatus[];
  misstatements: MisstatementSummary;
  /** True when the engagement is being audited. Audit work only applies, and only blocks the lock, when it is. */
  enabled: boolean;
  /** True when the benchmark figure has changed since materiality was set. */
  materialityStale: boolean;
  /** Procedures marked not applicable, for the partner's attention at lock. */
  notApplicable: number;
  /** Procedures and checklist steps reviewed by the person who did them: work that had no second person. */
  selfReviewed: number;
  /** The partner's approval of the risk assessment. */
  approval: RiskApproval;
  /** What the audit work still needs before the engagement can be locked. Empty when the audit is off. */
  blockers: string[];
}

export interface RiskApproval {
  /** None given; current; or lapsed, because materiality, a rating or the areas in scope changed after it was given. */
  state: "none" | "current" | "lapsed";
  approvedBy: string | null;
  approvedAt: string | null;
  /** Why the assessment cannot be approved yet; null when it can be. */
  notReady: string | null;
}

export interface ProcedureRow {
  id: string;
  templateId: string;
  tier: string;
  assertions: string;
  body: string;
  evidence: string;
  reference: string;
  status: "open" | "done" | "na";
  workDone: string | null;
  conclusion: string | null;
  performedByName: string | null;
  performedAt: string | null;
  /** The reviewer's sign-off on the work as recorded; null while it is unreviewed. */
  reviewedByName: string | null;
  reviewedAt: string | null;
  /** The reviewer is the person who did the work: possible only where the firm has no other reviewer. */
  selfReviewed: boolean;
  /** The partner's own sign-off step: it needs no further review. */
  partnerStep: boolean;
}

/**
 * Steps whose evidence is the partner's own sign-off (the same test as needsPartner, for SQL). The partner's sign-off is
 * itself the top-level review, so these are never reviewed again and never counted as waiting for review.
 */
const PARTNER_STEP = "'^Partner sign-off'";

async function requireOpen(tx: Tx, engagementId: string) {
  const engagement = await getEngagement(tx, engagementId);
  if (!engagement) throw new Error("Engagement not found.");
  if (engagement.status !== "open") throw new Error("This engagement is locked.");
}

async function isEnabled(tx: Tx, engagementId: string): Promise<boolean> {
  const { rows } = await tx.query<{ on: boolean }>('select audit_enabled as "on" from engagements where id = $1', [engagementId]);
  return rows[0]?.on ?? false;
}

/** Audit work can be recorded only on an open engagement that is being audited. */
export async function requireAudit(tx: Tx, engagementId: string) {
  await requireOpen(tx, engagementId);
  if (!(await isEnabled(tx, engagementId))) throw new Error("Turn the audit on for this engagement first.");
}

/**
 * Turn the audit on or off for an engagement. It can be turned off only while no work has been
 * recorded on any procedure, so audit evidence is never orphaned.
 */
export async function setAuditEnabled(tx: Tx, s: Session, engagementId: string, on: boolean): Promise<void> {
  await requireOpen(tx, engagementId);
  if (!canReview(s.role)) throw new Error("Only a reviewer or partner can turn the audit on or off.");
  if (!on) {
    const worked = await tx.query("select 1 from audit_procedures where engagement_id = $1 and (status <> 'open' or work_done is not null or conclusion is not null) limit 1", [engagementId]);
    const found = await tx.query("select 1 from misstatements where engagement_id = $1 limit 1", [engagementId]);
    const evidence = await tx.query("select 1 from working_papers where engagement_id = $1 and target_kind = 'procedure' limit 1", [engagementId]);
    const journalTests = await tx.query("select 1 from journal_tests where engagement_id = $1 limit 1", [engagementId]);
    const approved = await tx.query("select 1 from risk_approvals where engagement_id = $1 limit 1", [engagementId]);
    if (worked.rows.length > 0 || found.rows.length > 0 || evidence.rows.length > 0 || journalTests.rows.length > 0 || approved.rows.length > 0) throw new Error("Work has been recorded on this audit, so it cannot be turned off.");
  }
  await tx.query("update engagements set audit_enabled = $2 where id = $1", [engagementId, on]);
  if (on) await ensureChecklists(tx, s, engagementId);
  await log(tx, s, on ? "audit_on" : "audit_off", "engagement", engagementId);
}

async function scope(tx: Tx, engagementId: string) {
  const accounts = (await listAccounts(tx, engagementId)).map((a) => ({ ...a, closingMinor: a.closingMinor + a.adjustmentMinor }));
  const used = new Set(accounts.filter((a) => a.groupCode && (a.closingMinor !== 0 || (a.priorMinor ?? 0) !== 0)).map((a) => a.groupCode as string));
  return { accounts, areas: accounts.length === 0 ? [] : areasInScope(used) };
}

async function risksByArea(tx: Tx, engagementId: string): Promise<Map<string, AreaRisks>> {
  const { rows } = await tx.query<{ areaCode: string; assertion: Assertion; level: RiskLevel }>(
    'select area_code as "areaCode", assertion, level from risk_assessments where engagement_id = $1',
    [engagementId],
  );
  const map = new Map<string, AreaRisks>();
  for (const r of rows) map.set(r.areaCode, { ...(map.get(r.areaCode) ?? {}), [r.assertion]: r.level });
  return map;
}

export async function getAuditOverview(tx: Tx, engagementId: string): Promise<AuditOverview | null> {
  if (!(await getEngagement(tx, engagementId))) return null;
  const { accounts, areas } = await scope(tx, engagementId);
  const statements = buildStatements(accounts);
  const sci = (key: string) => statements.comprehensiveIncome.find((l) => l.key === key)?.current ?? 0;
  const sfp = (key: string) => statements.financialPosition.flatMap((s) => s.lines).find((l) => l.key === key)?.current ?? 0;

  const mat = await tx.query<MaterialityRow & { n: number }>(
    `select m.benchmark, m.benchmark_amount_minor::float8 as "benchmarkAmountMinor", m.percentage_bp as "percentageBp",
            m.performance_pct as "performancePct", m.trivial_pct as "trivialPct", m.overall_minor::float8 as "overallMinor",
            m.performance_minor::float8 as "performanceMinor", m.trivial_minor::float8 as "trivialMinor", m.rationale,
            u.name as "setBy", to_char(m.created_at, 'YYYY-MM-DD') as "setAt",
            (select count(*)::int from materiality where engagement_id = $1) as n
     from materiality m join users u on u.id = m.created_by
     where m.engagement_id = $1 order by m.created_at desc, m.id desc limit 1`,
    [engagementId],
  );
  const risks = await risksByArea(tx, engagementId);
  const counts = await tx.query<{ areaCode: string; total: number; completed: number; na: number; unreviewed: number; selfReviewed: number }>(
    `select area_code as "areaCode", count(*)::int as total, count(*) filter (where status <> 'open')::int as completed,
            count(*) filter (where status = 'na')::int as na,
            count(*) filter (where status <> 'open' and reviewed_by is null and evidence !~* ${PARTNER_STEP})::int as unreviewed,
            count(*) filter (where reviewed_by is not null and reviewed_by = performed_by)::int as "selfReviewed"
     from audit_procedures where engagement_id = $1 group by area_code`,
    [engagementId],
  );
  const countOf = new Map(counts.rows.map((c) => [c.areaCode, c]));

  const areaStatus: AreaStatus[] = areas.map((a) => ({
    code: a.code,
    title: a.title,
    objective: a.objective,
    assertions: assertionsOf(a),
    risks: risks.get(a.code) ?? {},
    fixedRisk: a.fixedRisk,
    assessed: isAssessed(a, risks.get(a.code) ?? {}),
    procedures: countOf.get(a.code)?.total ?? 0,
    completed: countOf.get(a.code)?.completed ?? 0,
    unreviewed: countOf.get(a.code)?.unreviewed ?? 0,
  }));

  const materiality: MaterialityRow | null = mat.rows[0] ?? null;
  const checklists: ChecklistStatus[] = CHECKLISTS.map((c) => ({
    code: c.code,
    title: c.title,
    stage: c.stage,
    optional: c.optional,
    steps: countOf.get(c.code)?.total ?? 0,
    completed: countOf.get(c.code)?.completed ?? 0,
    unreviewed: countOf.get(c.code)?.unreviewed ?? 0,
  }));

  const mis = await tx.query<MisstatementRow>(
    `select m.id, m.description, m.kind, m.amount_minor::float8 as "amountMinor", m.corrected, u.name as "recordedBy", to_char(m.created_at, 'YYYY-MM-DD') as "recordedAt"
     from misstatements m join users u on u.id = m.created_by where m.engagement_id = $1 order by m.created_at, m.id`,
    [engagementId],
  );
  const uncorrected = mis.rows.filter((r) => !r.corrected);
  const uncorrectedNetMinor = uncorrected.reduce((s, r) => s + r.amountMinor, 0);
  const misstatements: MisstatementSummary = {
    items: mis.rows,
    uncorrectedNetMinor,
    uncorrectedGrossMinor: uncorrected.reduce((s, r) => s + Math.abs(r.amountMinor), 0),
    // Offsetting items must not hide a material one, so each item is tested as well as the net.
    exceedsMateriality:
      materiality !== null &&
      (Math.abs(uncorrectedNetMinor) >= materiality.overallMinor || uncorrected.some((r) => Math.abs(r.amountMinor) >= materiality.overallMinor)),
  };

  const enabled = await isEnabled(tx, engagementId);
  const benchmarks: Record<Benchmark, number> = { pbt: Math.abs(sci("PBT")), revenue: Math.abs(sci("REVENUE")), assets: sfp("TOTAL_ASSETS"), equity: Math.abs(sfp("TOTAL_EQUITY")) };
  const materialityStale = materiality !== null && benchmarks[materiality.benchmark] !== materiality.benchmarkAmountMinor;
  const last = await tx.query<{ snapshot: string; approvedBy: string; approvedAt: string }>(
    `select a.snapshot, u.name as "approvedBy", to_char(a.created_at, 'YYYY-MM-DD') as "approvedAt"
     from risk_approvals a join users u on u.id = a.approved_by where a.engagement_id = $1 order by a.created_at desc, a.id desc limit 1`,
    [engagementId],
  );
  const unrated = areaStatus.filter((a) => !a.assessed).length;
  const approval: RiskApproval = {
    state: last.rows.length === 0 ? "none" : last.rows[0].snapshot === assessmentSnapshot({ materiality, areas: areaStatus }) ? "current" : "lapsed",
    approvedBy: last.rows[0]?.approvedBy ?? null,
    approvedAt: last.rows[0]?.approvedAt ?? null,
    notReady: !materiality
      ? "Set materiality first."
      : materialityStale
        ? "Revise or re-confirm materiality first: its benchmark figure has changed."
        : unrated > 0
          ? `Assess risk for the remaining ${unrated} area(s) first.`
          : null,
  };
  const blockers: string[] = [];
  if (enabled) {
    if (!materiality) blockers.push("Audit: materiality has not been set.");
    if (materialityStale) blockers.push("Audit: the benchmark figure has changed since materiality was set. Revise or re-confirm materiality.");
    const unassessed = areaStatus.filter((a) => !a.assessed).length;
    if (unassessed > 0) blockers.push(`Audit: risk has not been assessed for ${unassessed} area(s).`);
    const notLoaded = areaStatus.filter((a) => a.assessed && a.procedures === 0).length;
    if (notLoaded > 0) blockers.push(`Audit: the programme has not been loaded for ${notLoaded} area(s).`);
    if (approval.state === "none") blockers.push("Audit: the partner has not approved the risk assessment.");
    if (approval.state === "lapsed") blockers.push("Audit: the risk assessment has changed since the partner approved it. It needs approving again.");
    const open = counts.rows.reduce((n, c) => n + (c.total - c.completed), 0);
    if (open > 0) blockers.push(`Audit: ${open} procedure(s) and checklist step(s) are not yet completed.`);
    const unreviewed = counts.rows.reduce((n, c) => n + c.unreviewed, 0);
    if (unreviewed > 0) blockers.push(`Audit: ${unreviewed} completed procedure(s) and checklist step(s) have not been reviewed.`);
    const untested = await tx.query<{ n: number }>("select count(*)::int as n from journal_tests where engagement_id = $1 and tested_at is null", [engagementId]);
    if (untested.rows[0].n > 0) blockers.push(`Audit: ${untested.rows[0].n} journal entry(ies) selected for testing have no conclusion.`);
    const explained = await tx.query<ExplanationRecord>('select line_key as "lineKey", current_minor::float8 as "currentMinor", prior_minor::float8 as "priorMinor" from analytical_explanations where engagement_id = $1', [engagementId]);
    const unexplained = unexplainedMovements(compareYears(statements, materiality), explained.rows).length;
    if (unexplained > 0) blockers.push(`Audit: ${unexplained} significant movement(s) in the analytical review have no explanation.`);
    if (misstatements.exceedsMateriality) blockers.push("Audit: uncorrected misstatements reach overall materiality. Have them corrected; modified opinions are not yet supported.");
  }

  return {
    benchmarks,
    materiality,
    revisions: mat.rows[0]?.n ?? 0,
    areas: areaStatus,
    checklists,
    misstatements,
    enabled,
    materialityStale,
    notApplicable: counts.rows.reduce((n, c) => n + c.na, 0),
    selfReviewed: counts.rows.reduce((n, c) => n + c.selfReviewed, 0),
    approval,
    blockers,
  };
}

/** Set or revise materiality. The benchmark figure is taken from the engagement, never from the form. */
export async function setMateriality(
  tx: Tx,
  s: Session,
  engagementId: string,
  input: { benchmark: string; percentageBp: number; performancePct: number; trivialPct: number; rationale: string },
): Promise<string[]> {
  await requireAudit(tx, engagementId);
  if (!canReview(s.role)) throw new Error("Only a reviewer or partner can set materiality.");
  if (!(input.benchmark in BENCHMARKS)) throw new Error("Choose a benchmark.");
  const benchmark = input.benchmark as Benchmark;
  const overview = (await getAuditOverview(tx, engagementId))!;
  const rationale = input.rationale.trim();
  const result = computeMateriality({ ...input, benchmark, benchmarkAmountMinor: overview.benchmarks[benchmark] });
  if (result.errors.length > 0) throw new Error(result.errors.join(" "));
  if (rationale.length < 10) throw new Error("Record why this benchmark and these percentages are appropriate.");
  if (rationale.length > 2000) throw new Error("The rationale is too long.");
  await tx.query(
    `insert into materiality (firm_id, engagement_id, benchmark, benchmark_amount_minor, percentage_bp, performance_pct, trivial_pct,
                              overall_minor, performance_minor, trivial_minor, rationale, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [s.firmId, engagementId, benchmark, overview.benchmarks[benchmark], input.percentageBp, input.performancePct, input.trivialPct, result.overallMinor, result.performanceMinor, result.trivialMinor, rationale, s.userId],
  );
  await log(tx, s, "set_materiality", "engagement", engagementId, { benchmark, ...result, warnings: result.warnings });
  // Choices outside the guide ranges are allowed, but the user is told so they can cover them in the rationale.
  return result.warnings;
}

function areaInScope(areas: Area[], areaCode: string): Area {
  const area = areas.find((a) => a.code === areaCode);
  if (!area) throw new Error(AREA_BY_CODE.has(areaCode) ? "That area is not in scope for this engagement." : "Unknown audit area.");
  return area;
}

/**
 * Bring an area's programme in line with its assessed risks: load procedures that now apply,
 * and remove ones that no longer apply unless work has already been recorded on them.
 */
async function syncProgramme(tx: Tx, s: Session, engagementId: string, area: Area, risks: AreaRisks): Promise<{ added: number; removed: number }> {
  const wanted = selectProcedures(area, risks);
  const existing = await tx.query<{ id: string; templateId: string; untouched: boolean }>(
    `select p.id, p.template_id as "templateId",
            (p.status = 'open' and p.work_done is null and p.conclusion is null
             and not exists (select 1 from working_papers w where w.target_kind = 'procedure' and w.target = p.id::text)) as untouched
     from audit_procedures p where p.engagement_id = $1 and p.area_code = $2`,
    [engagementId, area.code],
  );
  const have = new Set(existing.rows.map((r) => r.templateId));
  const want = new Set(wanted.map((p) => p.id));
  let added = 0;
  for (const p of wanted) {
    if (have.has(p.id)) continue;
    await tx.query(
      "insert into audit_procedures (firm_id, engagement_id, area_code, template_id, tier, assertions, body, evidence, reference) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [s.firmId, engagementId, area.code, p.id, p.tier, p.assertions.join(", "), p.text, p.evidence, p.reference],
    );
    added++;
  }
  let removed = 0;
  for (const r of existing.rows) {
    if (want.has(r.templateId) || !r.untouched) continue;
    await tx.query("delete from audit_procedures where id = $1", [r.id]);
    removed++;
  }
  return { added, removed };
}

/** Load every checklist step that is not on the engagement yet. Steps already there are left as they are. */
async function ensureChecklists(tx: Tx, s: Session, engagementId: string): Promise<void> {
  const existing = await tx.query<{ t: string }>('select template_id as t from audit_procedures where engagement_id = $1', [engagementId]);
  const have = new Set(existing.rows.map((r) => r.t));
  for (const list of CHECKLISTS) {
    for (const item of list.items) {
      if (have.has(item.id)) continue;
      await tx.query(
        "insert into audit_procedures (firm_id, engagement_id, area_code, template_id, tier, assertions, body, evidence, reference) values ($1, $2, $3, $4, 'core', '', $5, $6, $7)",
        [s.firmId, engagementId, list.code, item.id, item.text, item.evidence, item.reference],
      );
    }
  }
}

const KINDS = ["factual", "judgemental", "projected"];

/** Record a misstatement found during the audit. amountMinor is its effect on profit: positive when profit is overstated. */
export async function addMisstatement(tx: Tx, s: Session, engagementId: string, input: { description: string; kind: string; amountMinor: number }): Promise<string> {
  await requireAudit(tx, engagementId);
  const description = input.description.trim();
  if (description.length < 5) throw new Error("Describe the misstatement.");
  if (description.length > 1000) throw new Error("The description is too long.");
  if (!KINDS.includes(input.kind)) throw new Error("Choose whether the misstatement is factual, judgemental or projected.");
  if (!Number.isInteger(input.amountMinor) || input.amountMinor === 0) throw new Error("Enter the amount of the misstatement.");
  const { rows } = await tx.query<{ id: string }>(
    "insert into misstatements (firm_id, engagement_id, description, kind, amount_minor, created_by) values ($1, $2, $3, $4, $5, $6) returning id",
    [s.firmId, engagementId, description, input.kind, input.amountMinor, s.userId],
  );
  await log(tx, s, "add", "misstatement", rows[0].id, { engagementId, kind: input.kind, amountMinor: input.amountMinor });
  return rows[0].id;
}

/** Mark a misstatement as corrected by the client, or as still uncorrected. */
export async function setMisstatementCorrected(tx: Tx, s: Session, misstatementId: string, corrected: boolean): Promise<string> {
  const { rows } = await tx.query<{ engagementId: string }>('select engagement_id as "engagementId" from misstatements where id = $1', [misstatementId]);
  if (rows.length === 0) throw new Error("Misstatement not found.");
  await requireAudit(tx, rows[0].engagementId);
  // Whether the client has really corrected an item decides whether the lock is held up, so a reviewer confirms it.
  if (!canReview(s.role)) throw new Error("Only a reviewer or partner can mark a misstatement as corrected.");
  await tx.query("update misstatements set corrected = $2 where id = $1", [misstatementId, corrected]);
  await log(tx, s, corrected ? "corrected" : "uncorrected", "misstatement", misstatementId, { engagementId: rows[0].engagementId });
  return rows[0].engagementId;
}

/** Record the risk assessment for one area and load its programme. */
export async function setAreaRisks(tx: Tx, s: Session, engagementId: string, areaCode: string, levels: Record<string, string>): Promise<{ added: number; removed: number }> {
  await requireAudit(tx, engagementId);
  if (!canReview(s.role)) throw new Error("Only a reviewer or partner can assess risk.");
  const { areas } = await scope(tx, engagementId);
  const area = areaInScope(areas, areaCode);

  const risks: AreaRisks = {};
  if (!area.fixedRisk) {
    const valid = new Set(RISK_LEVELS.map((l) => l.code as string));
    for (const assertion of assertionsOf(area)) {
      const level = levels[assertion];
      if (!level || !valid.has(level)) throw new Error("Rate every assertion before saving.");
      risks[assertion] = level as RiskLevel;
      await tx.query(
        `insert into risk_assessments (firm_id, engagement_id, area_code, assertion, level, updated_by) values ($1, $2, $3, $4, $5, $6)
         on conflict (engagement_id, area_code, assertion) do update set level = excluded.level, updated_by = excluded.updated_by, updated_at = now()`,
        [s.firmId, engagementId, area.code, assertion, level, s.userId],
      );
    }
  }
  const change = await syncProgramme(tx, s, engagementId, area, risks);
  await log(tx, s, "assess_risk", "audit_area", engagementId, { area: area.code, risks: area.fixedRisk ? { all: area.fixedRisk } : risks, ...change });
  return change;
}

/**
 * The partner approves the risk assessment: materiality and the rating of every area in scope, as they stand.
 * The approval lapses by itself if any of them later changes.
 */
export async function approveRiskAssessment(tx: Tx, s: Session, engagementId: string): Promise<void> {
  await requireAudit(tx, engagementId);
  if (!canLock(s.role)) throw new Error("Only a partner can approve the risk assessment.");
  const overview = (await getAuditOverview(tx, engagementId))!;
  if (overview.areas.length === 0) throw new Error("Import a trial balance and map its accounts first.");
  if (overview.approval.notReady) throw new Error(overview.approval.notReady);
  if (overview.approval.state === "current") throw new Error("The risk assessment is already approved as it stands.");
  const snapshot = assessmentSnapshot({ materiality: overview.materiality, areas: overview.areas });
  await tx.query("insert into risk_approvals (firm_id, engagement_id, snapshot, approved_by) values ($1, $2, $3, $4)", [s.firmId, engagementId, snapshot, s.userId]);
  await log(tx, s, "approve_risk_assessment", "engagement", engagementId, { reapproval: overview.approval.state === "lapsed" });
}

export async function listProcedures(tx: Tx, engagementId: string, areaCode: string): Promise<ProcedureRow[]> {
  const { rows } = await tx.query<ProcedureRow>(
    `select p.id, p.template_id as "templateId", p.tier, p.assertions, p.body, p.evidence, p.reference, p.status,
            p.work_done as "workDone", p.conclusion, u.name as "performedByName", to_char(p.performed_at, 'YYYY-MM-DD') as "performedAt",
            r.name as "reviewedByName", to_char(p.reviewed_at, 'YYYY-MM-DD') as "reviewedAt", p.reviewed_by is not null and p.reviewed_by = p.performed_by as "selfReviewed", p.evidence ~* ${PARTNER_STEP} as "partnerStep"
     from audit_procedures p left join users u on u.id = p.performed_by left join users r on r.id = p.reviewed_by
     where p.engagement_id = $1 and p.area_code = $2`,
    [engagementId, areaCode],
  );
  // C5.2 sorts before C5.10.
  return rows.sort((a, b) => a.templateId.localeCompare(b.templateId, undefined, { numeric: true }));
}

/** Record the work on a procedure: completed, not applicable (with the reason), or reopened. */
export async function updateProcedure(
  tx: Tx,
  s: Session,
  procedureId: string,
  input: { status: string; workDone: string; conclusion: string },
): Promise<string> {
  const { rows } = await tx.query<{ engagementId: string; templateId: string; tier: string; areaCode: string; evidence: string; reviewed: boolean }>(
    'select engagement_id as "engagementId", template_id as "templateId", tier, area_code as "areaCode", evidence, reviewed_by is not null as reviewed from audit_procedures where id = $1',
    [procedureId],
  );
  if (rows.length === 0) throw new Error("Procedure not found.");
  await requireAudit(tx, rows[0].engagementId);
  // A review vouches for the work as it stood. Changing the work under it would leave a sign-off on something
  // the reviewer never saw, so the reviewer withdraws the review first.
  if (rows[0].reviewed) throw new Error("This procedure has been reviewed. Ask the reviewer to withdraw the review before changing the work.");
  const workDone = input.workDone.trim();
  const conclusion = input.conclusion.trim();
  if (workDone.length > 5000 || conclusion.length > 5000) throw new Error("The text is too long.");

  if (input.status === "done") {
    if (workDone.length < 3) throw new Error("Describe the work done before marking the procedure completed.");
    if (conclusion.length < 3) throw new Error("Record the conclusion before marking the procedure completed.");
    if (needsPartner(rows[0].evidence) && !canLock(s.role)) throw new Error("This step is the partner's sign-off, so only a partner can complete it.");
    if (rows[0].templateId === RISK_APPROVAL_STEP && (await getAuditOverview(tx, rows[0].engagementId))!.approval.state !== "current") {
      throw new Error("Approve the risk assessment on the audit page first. This step records that approval.");
    }
  } else if (input.status === "na") {
    if (workDone.length < 10) throw new Error("Explain under work done why the procedure does not apply.");
    // Setting aside a response to a significant risk is a judgement for a reviewer, not the preparer.
    const significant = rows[0].tier === "significant" || AREA_BY_CODE.get(rows[0].areaCode)?.fixedRisk === "significant";
    if (significant && !canReview(s.role)) throw new Error("Only a reviewer or partner can mark a significant-risk procedure as not applicable.");
    // Checklist steps apply to every audit. Only the optional checklists may be set aside by anyone.
    const checklist = CHECKLIST_BY_CODE.get(rows[0].areaCode);
    if (checklist && !checklist.optional && !canReview(s.role)) throw new Error("Only a reviewer or partner can mark a required checklist step as not applicable.");
  } else if (input.status !== "open") {
    throw new Error("Unknown status.");
  }
  const finished = input.status !== "open";
  await tx.query(
    `update audit_procedures set status = $2, work_done = $3, conclusion = $4,
            performed_by = case when $5 then $6::uuid else null end, performed_at = case when $5 then now() else null end
     where id = $1`,
    [procedureId, input.status, workDone || null, conclusion || null, finished, s.userId],
  );
  await log(tx, s, "procedure_" + input.status, "audit_procedure", procedureId, { engagementId: rows[0].engagementId, templateId: rows[0].templateId });
  return rows[0].engagementId;
}

/** Sign off a procedure whose work is finished. A different person from the one who did the work, except for a sole practitioner. */
export async function reviewProcedure(tx: Tx, s: Session, procedureId: string): Promise<string> {
  const { rows } = await tx.query<{ engagementId: string; templateId: string; status: string; evidence: string; performedBy: string | null; reviewed: boolean }>(
    'select engagement_id as "engagementId", template_id as "templateId", status, evidence, performed_by as "performedBy", reviewed_by is not null as reviewed from audit_procedures where id = $1',
    [procedureId],
  );
  if (rows.length === 0) throw new Error("Procedure not found.");
  const p = rows[0];
  await requireAudit(tx, p.engagementId);
  if (!canReview(s.role)) throw new Error("Only a reviewer or partner can review audit work.");
  if (p.status === "open") throw new Error("Only completed work can be reviewed.");
  if (needsPartner(p.evidence)) throw new Error("This is the partner's own sign-off, so it needs no further review.");
  if (p.reviewed) throw new Error("This procedure has already been reviewed.");
  const selfReview = p.performedBy === s.userId;
  if (selfReview && !(await canSelfReviewAudit(tx))) throw new Error("The reviewer must be a different person from the one who did the work.");
  await tx.query("update audit_procedures set reviewed_by = $2, reviewed_at = now() where id = $1", [procedureId, s.userId]);
  await log(tx, s, "procedure_review", "audit_procedure", procedureId, { engagementId: p.engagementId, templateId: p.templateId, selfReview });
  return p.engagementId;
}

/** Withdraw a review so the work can be changed. Any reviewer or partner may, not only the one who gave it. */
export async function unreviewProcedure(tx: Tx, s: Session, procedureId: string): Promise<string> {
  const { rows } = await tx.query<{ engagementId: string; templateId: string; reviewedBy: string | null }>(
    'select engagement_id as "engagementId", template_id as "templateId", reviewed_by as "reviewedBy" from audit_procedures where id = $1',
    [procedureId],
  );
  if (rows.length === 0) throw new Error("Procedure not found.");
  await requireAudit(tx, rows[0].engagementId);
  if (!canReview(s.role)) throw new Error("Only a reviewer or partner can withdraw a review.");
  if (!rows[0].reviewedBy) throw new Error("This procedure has not been reviewed.");
  await tx.query("update audit_procedures set reviewed_by = null, reviewed_at = null where id = $1", [procedureId]);
  await log(tx, s, "procedure_unreview", "audit_procedure", procedureId, { engagementId: rows[0].engagementId, templateId: rows[0].templateId, reviewedBy: rows[0].reviewedBy });
  return rows[0].engagementId;
}

/**
 * Review everything finished and not yet reviewed in one area or checklist. The reviewer's own work is skipped and
 * counted, so they can see what is left for someone else, except where the firm has no other reviewer: then it is
 * reviewed too, and counted as self-reviewed.
 */
export async function reviewArea(tx: Tx, s: Session, engagementId: string, areaCode: string): Promise<{ reviewed: number; skipped: number; selfReviewed: number }> {
  await requireAudit(tx, engagementId);
  if (!canReview(s.role)) throw new Error("Only a reviewer or partner can review audit work.");
  const own = (await canSelfReviewAudit(tx)) ? "false" : "performed_by is not distinct from $3::uuid";
  const done = await tx.query<{ templateId: string; performedBy: string | null }>(
    `update audit_procedures set reviewed_by = $3, reviewed_at = now()
     where engagement_id = $1 and area_code = $2 and status <> 'open' and reviewed_by is null and evidence !~* ${PARTNER_STEP} and not (${own}) returning template_id as "templateId", performed_by as "performedBy"`,
    [engagementId, areaCode, s.userId],
  );
  const left = await tx.query<{ n: number }>(
    `select count(*)::int as n from audit_procedures where engagement_id = $1 and area_code = $2 and status <> 'open' and reviewed_by is null and evidence !~* ${PARTNER_STEP}`,
    [engagementId, areaCode],
  );
  const result = { reviewed: done.rows.length, skipped: left.rows[0].n, selfReviewed: done.rows.filter((r) => r.performedBy === s.userId).length };
  if (result.reviewed + result.skipped === 0) throw new Error("There is no completed work waiting for review here.");
  await log(tx, s, "procedure_review_area", "audit_area", engagementId, { area: areaCode, ...result, reviewedSteps: done.rows.map((r) => r.templateId) });
  return result;
}
