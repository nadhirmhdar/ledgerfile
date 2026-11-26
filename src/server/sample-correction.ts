import { DEV_FIRM_ID, DEV_USER_ID, withFirm, type Db } from "./db";
import * as repo from "./repo";

/**
 * A one-off, idempotent correction for a hosted database that was seeded before the sample's retained earnings were fixed (owner decision: no wipe or
 * re-seed; correct untouched sample figures only). Run by `npm run db:setup-hosted` (scripts/setup-hosted.mts, step 3b).
 *
 * It changes the sample client's 2025 engagement in the sample firm, and only when it is open and every account it would change still has exactly the
 * old seeded figures. Anything else: nothing is changed and one line says why. It cannot reach another firm, another client or another year.
 */
export const SAMPLE_CLIENT_NAME = "Falcon Trading LLC (sample)";

type Figures = { code: string; name: string; closingMinor: number; priorMinor: number };

/** The 2025 figures as the old generator wrote them (minor units; credits negative). */
export const OLD_FIGURES: Figures[] = [
  { code: "3100", name: "Statutory reserve", closingMinor: -6000000, priorMinor: -4500000 },
  { code: "3200", name: "Retained earnings", closingMinor: -13924600, priorMinor: 1151900 },
];
/** The same accounts as the fixed generator writes them, plus the new Dividends paid account. */
export const NEW_FIGURES: Figures[] = [
  { code: "3100", name: "Statutory reserve", closingMinor: -4500000, priorMinor: -4500000 },
  { code: "3200", name: "Retained earnings", closingMinor: -38383100, priorMinor: 1151900 },
  { code: "3300", name: "Dividends paid", closingMinor: 22958500, priorMinor: 0 },
];

export type SampleCorrection = { changed: boolean; line: string };

const same = (a: Figures, b: Figures) => a.code === b.code && a.name === b.name && a.closingMinor === b.closingMinor && a.priorMinor === b.priorMinor;

export async function correctSampleRetainedEarnings(db: Db): Promise<SampleCorrection> {
  const prefix = "Sample correction:";
  const session: repo.Session = { firmId: DEV_FIRM_ID, userId: DEV_USER_ID, role: "admin" };
  return withFirm(db, DEV_FIRM_ID, async (tx): Promise<SampleCorrection> => {
    const stop = (why: string): SampleCorrection => ({ changed: false, line: `${prefix} nothing changed: ${why}` });
    const clients = await tx.query<{ id: string }>("select id from clients where name = $1", [SAMPLE_CLIENT_NAME]);
    if (clients.rows.length === 0) return { changed: false, line: `${prefix} no sample client here; nothing to do` };
    if (clients.rows.length > 1) return stop("more than one sample client");
    const engagements = await tx.query<{ id: string; status: string; archived: boolean }>(
      "select id, status, archived_at is not null as archived from engagements where client_id = $1 and period_start = '2025-01-01' and period_end = '2025-12-31'",
      [clients.rows[0].id],
    );
    if (engagements.rows.length !== 1) return stop("the sample client does not have exactly one 2025 engagement");
    const e = engagements.rows[0];
    // Take the lock the app takes on the engagement's figures: lock the row so nobody locks or edits it between the checks and the update.
    await tx.query("select id from engagements where id = $1 for update", [e.id]);
    if (e.status !== "open" || e.archived) return stop("the 2025 engagement is locked or archived");

    const rows = await tx.query<{ id: string; code: string; name: string; closingMinor: number; priorMinor: number; groupCode: string | null; approved: boolean | null; approvedBy: string | null; approvedAt: string | null; source: string | null; confidence: string | null }>(
      `select a.id, a.code, a.name, a.closing_minor::float8 as "closingMinor", a.prior_minor::float8 as "priorMinor",
              m.group_code as "groupCode", m.approved, m.approved_by as "approvedBy", m.approved_at as "approvedAt", m.source, m.confidence
       from accounts a left join mappings m on m.account_id = a.id where a.engagement_id = $1 and a.code in ('3100', '3200', '3300')`,
      [e.id],
    );
    const by = new Map(rows.rows.map((r) => [r.code, r]));
    const fig = (code: string): Figures | null => {
      const r = by.get(code);
      return r ? { code: r.code, name: r.name, closingMinor: r.closingMinor, priorMinor: r.priorMinor } : null;
    };
    const alreadyDone = NEW_FIGURES.every((n) => {
      const f = fig(n.code);
      return f !== null && same(f, n);
    });
    if (alreadyDone) return { changed: false, line: `${prefix} already corrected; nothing to do` };

    for (const old of OLD_FIGURES) {
      const f = fig(old.code);
      if (!f) return stop(`account ${old.code} is missing`);
      if (!same(f, old)) return stop(`account ${old.code} no longer has the seeded figures (a person has changed it)`);
    }
    if (by.has("3300")) return stop("account 3300 already exists and was not added by the seed");
    const retained = by.get("3200")!;
    if (retained.groupCode !== "RETAINED") return stop("retained earnings is no longer mapped to its seeded group");
    const reserveGroup = by.get("3100")!.groupCode;

    for (const n of NEW_FIGURES.filter((x) => by.has(x.code))) {
      await tx.query("update accounts set closing_minor = $2, prior_minor = $3 where id = $1", [by.get(n.code)!.id, n.closingMinor, n.priorMinor]);
    }
    const imp = await tx.query<{ id: string }>("select tb_import_id as id from accounts where id = $1", [retained.id]);
    const added = NEW_FIGURES.find((n) => n.code === "3300")!;
    const inserted = await tx.query<{ id: string }>(
      "insert into accounts (firm_id, engagement_id, tb_import_id, code, name, closing_minor, prior_minor) values ($1, $2, $3, $4, $5, $6, $7) returning id",
      [DEV_FIRM_ID, e.id, imp.rows[0].id, added.code, added.name, added.closingMinor, added.priorMinor],
    );
    // The new account is mapped as the retained earnings account is, with the same approval, so the checks see it the way they see that account.
    await tx.query(
      "insert into mappings (firm_id, account_id, group_code, source, confidence, approved, approved_by, approved_at) values ($1, $2, 'RETAINED', $3, $4, $5, $6, $7)",
      [DEV_FIRM_ID, inserted.rows[0].id, retained.source ?? "rule", retained.confidence ?? 1, retained.approved ?? false, retained.approvedBy, retained.approvedAt],
    );
    await repo.clearSignOffs(tx, session, e.id, [reserveGroup, "RETAINED"], "sample figures corrected");
    await repo.audit(tx, session, "sample_correction", "engagement", e.id, {
      before: OLD_FIGURES,
      after: NEW_FIGURES,
      reason: "Retained earnings roll forward from last year; owner decision: no wipe or re-seed, untouched sample figures only",
    });
    return { changed: true, line: `${prefix} corrected the 2025 retained earnings figures (3100, 3200 and a new 3300 Dividends paid)` };
  });
}
