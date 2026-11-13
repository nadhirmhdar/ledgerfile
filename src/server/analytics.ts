import type { Tx } from "./db";
import { audit as log, getEngagement, listAccounts, type Session } from "./repo";
import { requireAudit } from "./audit";
import { buildStatements } from "../domain/statements";
import { compareYears, computeRatios, explanationStands, type MovementRow, type RatioRow, type Thresholds } from "../domain/analytics";

export interface ExplanationView {
  text: string;
  writtenByName: string;
  writtenAt: string;
  /** The figures have changed since it was written, so it must be re-confirmed or rewritten. */
  stale: boolean;
}

export interface AnalyticsRow extends MovementRow {
  explanation: ExplanationView | null;
}

export interface Analytics {
  /** The engagement is open and the audit is on: explanations can be written. */
  editable: boolean;
  auditOn: boolean;
  hasComparatives: boolean;
  /** Null until materiality is set: nothing is flagged without it. */
  thresholds: Thresholds | null;
  rows: AnalyticsRow[];
  ratios: RatioRow[];
  /** Flagged movements with no explanation that still stands. */
  unexplained: number;
}

interface StoredExplanation {
  lineKey: string;
  text: string;
  currentMinor: number;
  priorMinor: number;
  writtenByName: string;
  writtenAt: string;
}

async function load(tx: Tx, engagementId: string) {
  const accounts = (await listAccounts(tx, engagementId)).map((a) => ({ ...a, closingMinor: a.closingMinor + a.adjustmentMinor }));
  const statements = buildStatements(accounts);
  const mat = await tx.query<Thresholds>(
    `select performance_minor::float8 as "performanceMinor", trivial_minor::float8 as "trivialMinor" from materiality
     where engagement_id = $1 order by created_at desc, id desc limit 1`,
    [engagementId],
  );
  const thresholds = mat.rows[0] ?? null;
  const stored = await tx.query<StoredExplanation>(
    `select e.line_key as "lineKey", e.explanation as text, e.current_minor::float8 as "currentMinor", e.prior_minor::float8 as "priorMinor",
            u.name as "writtenByName", to_char(e.written_at, 'YYYY-MM-DD') as "writtenAt"
     from analytical_explanations e join users u on u.id = e.written_by where e.engagement_id = $1`,
    [engagementId],
  );
  return { statements, thresholds, rows: compareYears(statements, thresholds), stored: stored.rows };
}

export async function getAnalytics(tx: Tx, engagementId: string): Promise<Analytics | null> {
  const engagement = await getEngagement(tx, engagementId);
  if (!engagement) return null;
  const { statements, thresholds, rows, stored } = await load(tx, engagementId);
  const on = await tx.query<{ on: boolean }>('select audit_enabled as "on" from engagements where id = $1', [engagementId]);
  const auditOn = on.rows[0]?.on ?? false;

  const merged: AnalyticsRow[] = rows.map((r) => {
    const e = stored.find((x) => x.lineKey === r.key);
    return { ...r, explanation: e ? { text: e.text, writtenByName: e.writtenByName, writtenAt: e.writtenAt, stale: !explanationStands(e, r) } : null };
  });
  return {
    editable: engagement.status === "open" && auditOn,
    auditOn,
    hasComparatives: statements.hasComparatives,
    thresholds,
    rows: merged,
    ratios: computeRatios(statements),
    unexplained: merged.filter((r) => r.flag && (!r.explanation || r.explanation.stale)).length,
  };
}

async function flaggedRow(tx: Tx, engagementId: string, lineKey: string) {
  const { rows, stored } = await load(tx, engagementId);
  const row = rows.find((r) => r.key === lineKey);
  if (!row?.flag) throw new Error("That line does not need an explanation.");
  return { row, existing: stored.find((x) => x.lineKey === lineKey) };
}

/** Write or replace the explanation of a flagged movement, against the figures as they stand now. Any role may. */
export async function saveExplanation(tx: Tx, s: Session, engagementId: string, lineKey: string, text: string): Promise<void> {
  await requireAudit(tx, engagementId);
  const explanation = text.trim();
  if (explanation.length < 10) throw new Error("Explain the movement: what caused it, and what you did to confirm that.");
  if (explanation.length > 3000) throw new Error("The explanation is too long.");
  const { row } = await flaggedRow(tx, engagementId, lineKey);
  await tx.query(
    `insert into analytical_explanations (firm_id, engagement_id, line_key, explanation, current_minor, prior_minor, written_by)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (engagement_id, line_key) do update
       set explanation = excluded.explanation, current_minor = excluded.current_minor, prior_minor = excluded.prior_minor,
           written_by = excluded.written_by, written_at = clock_timestamp()`,
    [s.firmId, engagementId, lineKey, explanation, row.current, row.prior, s.userId],
  );
  await log(tx, s, "analytical_explain", "engagement", engagementId, { line: lineKey, currentMinor: row.current, priorMinor: row.prior });
}

/** Confirm that an explanation still holds after the figures changed, without rewriting it. */
export async function reconfirmExplanation(tx: Tx, s: Session, engagementId: string, lineKey: string): Promise<void> {
  await requireAudit(tx, engagementId);
  const { row, existing } = await flaggedRow(tx, engagementId, lineKey);
  if (!existing) throw new Error("There is no explanation to re-confirm.");
  if (explanationStands(existing, row)) throw new Error("This explanation already matches the current figures.");
  await tx.query(
    "update analytical_explanations set current_minor = $3, prior_minor = $4, written_by = $5, written_at = clock_timestamp() where engagement_id = $1 and line_key = $2",
    [engagementId, lineKey, row.current, row.prior, s.userId],
  );
  await log(tx, s, "analytical_reconfirm", "engagement", engagementId, { line: lineKey, currentMinor: row.current, priorMinor: row.prior, was: { currentMinor: existing.currentMinor, priorMinor: existing.priorMinor } });
}
