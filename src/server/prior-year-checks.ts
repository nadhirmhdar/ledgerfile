import type { Tx } from "./db";
import { listAccounts } from "./repo";
import { buildStatements, type Check } from "../domain/statements";
import { priorYearChecks } from "../domain/prior-year-checks";

/**
 * The prior-year checks for one engagement. Loads only what they need and is called by the pages that show them, so nothing else that builds
 * statements (analytics, audit, review, the index, planning, the pack) reads a second engagement, and none of them can be blocked by these warnings.
 */

export type PriorYearResult =
  | { linked: false }
  | {
      linked: true;
      /** Last year's file is locked or archived: the checks compare to its signed figures. */
      priorSigned: boolean;
      checks: Check[];
    };

interface Row {
  priorId: string | null;
  borrowingsCurrentMinor: number;
  borrowingsCurrentPriorMinor: number;
}
interface PriorRow {
  status: string;
  archived: boolean;
  borrowingsCurrentMinor: number;
  borrowingsCurrentPriorMinor: number;
}

const BORROWINGS = (r: { borrowingsCurrentMinor: number; borrowingsCurrentPriorMinor: number }) => ({ current: r.borrowingsCurrentMinor, prior: r.borrowingsCurrentPriorMinor });

export async function getPriorYearChecks(tx: Tx, firmId: string, engagementId: string): Promise<PriorYearResult | null> {
  const mine = await tx.query<Row>(
    `select prior_engagement_id as "priorId", borrowings_current_minor::float8 as "borrowingsCurrentMinor", borrowings_current_prior_minor::float8 as "borrowingsCurrentPriorMinor"
     from engagements where id = $1 and firm_id = $2`,
    [engagementId, firmId],
  );
  if (mine.rows.length === 0) return null;
  if (!mine.rows[0].priorId) return { linked: false };
  // The link is followed only inside the same firm: an engagement of another firm is never read, whatever the link says.
  const prior = await tx.query<PriorRow>(
    `select status, archived_at is not null as archived, borrowings_current_minor::float8 as "borrowingsCurrentMinor", borrowings_current_prior_minor::float8 as "borrowingsCurrentPriorMinor"
     from engagements where id = $1 and firm_id = $2`,
    [mine.rows[0].priorId, firmId],
  );
  if (prior.rows.length === 0) return { linked: false };

  // Both years' statements are built the way an engagement's own statements page builds them: adjusted balances, approved mappings, its borrowings split.
  const adjusted = async (id: string) => (await listAccounts(tx, id)).map((a) => ({ ...a, closingMinor: a.closingMinor + a.adjustmentMinor }));
  const [currentAccounts, priorAccounts] = await Promise.all([adjusted(engagementId), adjusted(mine.rows[0].priorId)]);
  const priorSigned = prior.rows[0].status === "locked" || prior.rows[0].archived;
  const checks = priorYearChecks({
    current: buildStatements(currentAccounts, { borrowingsCurrent: BORROWINGS(mine.rows[0]) }),
    prior: buildStatements(priorAccounts, { borrowingsCurrent: BORROWINGS(prior.rows[0]) }),
    currentAccounts: currentAccounts.map((a) => ({ groupCode: a.groupCode, name: a.name, closingMinor: a.closingMinor })),
    priorSigned,
  });
  return { linked: true, priorSigned, checks };
}
