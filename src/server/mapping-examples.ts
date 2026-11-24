import type { Tx } from "./db";
import type { LearnedExample } from "../domain/mapping-assistant";

/**
 * The firm's approved mappings, on any engagement, any client, any year: what the mapping assistant learns from. Read through the signed-in firm's
 * row-level security (and filtered to the firm again), in a fixed order so the same data always gives the same suggestions.
 */
export async function learnedExamples(tx: Tx, firmId: string): Promise<LearnedExample[]> {
  const { rows } = await tx.query<{ code: string; name: string; closing: string; groupCode: string }>(
    `select a.code, a.name, a.closing_minor::text as closing, m.group_code as "groupCode"
     from mappings m join accounts a on a.id = m.account_id
     where m.approved and m.firm_id = $1 order by a.code, a.name, m.group_code`,
    [firmId],
  );
  return rows.map((r) => ({ code: r.code, name: r.name, closingMinor: Number(r.closing), groupCode: r.groupCode }));
}
