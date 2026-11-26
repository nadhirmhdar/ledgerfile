import type { Tx } from "./db";
import { audit, listAccounts, type Session } from "./repo";
import { canEditNotes } from "../domain/permissions";
import type { Role } from "../domain/signoff";
import { buildStatements } from "../domain/statements";
import { HAS_PRIOR_REFUSAL, LINE_REFUSAL, NO_COMPARATIVES_REFUSAL, parseSignedAmount, signedPriorLines } from "../domain/signed-prior";

/**
 * The signed figures of a client's first year (migration 0041), kept as an append-only list: the current figure of a line is its latest row, and a cleared
 * line is a row with a null amount. Every rule is checked here, on the server.
 */

export interface SignedFigure {
  lineKey: string;
  /** Minor units, presentation sign, or null where it was cleared. */
  amountMinor: number | null;
  by: string;
  at: string;
}

const toMinor = (amount: string | null): number | null => (amount === null ? null : Math.round(Number(amount) * 100));

/** The current figure of each line that has one (a cleared line comes back with a null amount). */
export async function getSignedPrior(tx: Tx, engagementId: string): Promise<Map<string, SignedFigure>> {
  const { rows } = await tx.query<{ lineKey: string; amount: string | null; by: string; at: string }>(
    `select distinct on (s.line_key) s.line_key as "lineKey", s.amount::text as amount, u.name as by, to_char(s.entered_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as at
     from signed_prior_figures s join users u on u.id = s.entered_by where s.engagement_id = $1 order by s.line_key, s.id desc`,
    [engagementId],
  );
  return new Map(rows.map((r) => [r.lineKey, { lineKey: r.lineKey, amountMinor: toMinor(r.amount), by: r.by, at: r.at }]));
}

export interface SignedPriorInput {
  /** The typed amount for each line key: empty clears the line. Only the lines present are looked at. */
  amounts: Record<string, string>;
}

export interface SignedPriorResult {
  /** The line keys whose figure changed. */
  changed: string[];
}

/**
 * Save the signed figures typed for some lines.
 * - whoever may edit the notes today may enter them (the role is read again from the database), on an engagement that is open;
 * - only for an engagement with no prior engagement in LedgerFile and a trial balance with prior-year figures;
 * - each line must be a line of the statements with a comparative, and each amount a number with at most two decimals (empty clears the line);
 * - a line whose figure is unchanged writes nothing; every change is a new row, and one audit entry lists the lines changed with the before and the after.
 */
export async function saveSignedPrior(tx: Tx, s: Session, engagementId: string, input: SignedPriorInput): Promise<SignedPriorResult> {
  const who = await tx.query<{ role: Role; active: boolean }>("select role, active from users where id = $1 and firm_id = $2", [s.userId, s.firmId]);
  if (!who.rows[0]?.active || !canEditNotes(who.rows[0].role)) throw new Error("You cannot enter the signed figures.");
  const e = await tx.query<{ status: string; priorId: string | null }>('select status, prior_engagement_id as "priorId" from engagements where id = $1 and firm_id = $2', [engagementId, s.firmId]);
  if (e.rows.length === 0) throw new Error("Engagement not found.");
  // A locked file is read-only, and an archived one is locked.
  if (e.rows[0].status !== "open") throw new Error("This engagement is locked.");
  if (e.rows[0].priorId) throw new Error(HAS_PRIOR_REFUSAL);

  const base = buildStatements((await listAccounts(tx, engagementId)).map((a) => ({ ...a, closingMinor: a.closingMinor + a.adjustmentMinor })));
  if (!base.hasComparatives) throw new Error(NO_COMPARATIVES_REFUSAL);
  const lines = new Map(signedPriorLines(base).map((l) => [l.key, l]));

  // One writer at a time per engagement, so two saves cannot interleave their reads and writes.
  await tx.query("select pg_advisory_xact_lock(hashtext($1))", [`signed_prior:${engagementId}`]);
  const now = await getSignedPrior(tx, engagementId);
  const changes: { lineKey: string; label: string; before: number | null; after: number | null }[] = [];
  for (const [lineKey, typed] of Object.entries(input.amounts)) {
    const line = lines.get(lineKey);
    if (!line) throw new Error(LINE_REFUSAL);
    const after = parseSignedAmount(typed);
    const before = now.get(lineKey)?.amountMinor ?? null;
    if (before === after) continue;
    changes.push({ lineKey, label: line.label, before, after });
  }
  for (const c of changes) {
    await tx.query("insert into signed_prior_figures (firm_id, engagement_id, line_key, amount, entered_by) values ($1, $2, $3, $4, $5)", [s.firmId, engagementId, c.lineKey, c.after === null ? null : (c.after / 100).toFixed(2), s.userId]);
  }
  if (changes.length > 0) await audit(tx, s, "signed_prior_figures_save", "engagement", engagementId, { lines: changes });
  return { changed: changes.map((c) => c.lineKey) };
}
