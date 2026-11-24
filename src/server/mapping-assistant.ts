import type { Tx } from "./db";
import { audit, clearSignOffs, getEngagement, listAccounts, type Session } from "./repo";
import { assist, HIGH, type Placement } from "../domain/mapping-assistant";
import { learnedExamples } from "./mapping-examples";

/**
 * The mapping assistant on an engagement. It runs entirely here: no outside model, service or network. It learns from the firm's own approved mappings
 * (any engagement, any client, any year) read through the signed-in firm's row-level security, so one firm's choices never reach another's suggestions.
 * It only suggests: a person accepts each suggestion (one at a time, or every high-confidence one), and the person and the time are recorded.
 */

async function open(tx: Tx, engagementId: string) {
  const engagement = await getEngagement(tx, engagementId);
  if (!engagement) throw new Error("Engagement not found.");
  if (engagement.status !== "open") throw new Error("This engagement is locked.");
  return engagement;
}

/** Place the accounts that are unmapped or not yet accepted. Approved mappings are not looked at again. */
async function place(tx: Tx, firmId: string, engagementId: string, priorEngagementId: string | null) {
  const accounts = (await listAccounts(tx, engagementId)).filter((a) => a.groupCode === null || !a.approved);
  const prior = priorEngagementId
    ? (await tx.query<{ code: string; groupCode: string }>(`select a.code, m.group_code as "groupCode" from mappings m join accounts a on a.id = m.account_id where a.engagement_id = $1 and m.approved`, [priorEngagementId])).rows
    : [];
  const placements = assist({
    accounts: accounts.map((a) => ({ code: a.code, name: a.name, closingMinor: a.closingMinor + a.adjustmentMinor })),
    priorYear: new Map(prior.map((p) => [p.code, p.groupCode])),
    examples: await learnedExamples(tx, firmId),
  });
  return accounts.map((a, i) => ({ account: a, placement: placements[i] as Placement }));
}

export interface CouldNotPlace {
  code: string;
  name: string;
  reason: string;
}

/** The accounts with no mapping that the assistant would not place, with why. Nothing is saved. */
export async function couldNotPlace(tx: Tx, s: Session, engagementId: string): Promise<CouldNotPlace[]> {
  const engagement = await getEngagement(tx, engagementId);
  if (!engagement) return [];
  return (await place(tx, s.firmId, engagementId, engagement.priorEngagementId))
    .filter(({ account, placement }) => account.groupCode === null && placement.kind === "decline")
    .map(({ account, placement }) => ({ code: account.code, name: account.name, reason: placement.reason }));
}

export interface SuggestResult {
  placed: number;
  high: number;
  medium: number;
  low: number;
  declined: number;
}

/**
 * Suggest a group for every account that is unmapped or not yet accepted. A suggestion replaces an earlier unaccepted one; an accepted mapping is never
 * changed. An account the assistant cannot place keeps whatever it had. Counts only go to the audit log.
 */
export async function suggestAgain(tx: Tx, s: Session, engagementId: string): Promise<SuggestResult> {
  const engagement = await open(tx, engagementId);
  const result: SuggestResult = { placed: 0, high: 0, medium: 0, low: 0, declined: 0 };
  const changed: (string | null)[] = [];
  for (const { account, placement } of await place(tx, s.firmId, engagementId, engagement.priorEngagementId)) {
    if (placement.kind === "decline") {
      result.declined++;
      continue;
    }
    result.placed++;
    result[placement.band]++;
    const saved = await tx.query(
      `insert into mappings (firm_id, account_id, group_code, source, confidence, approved, reason) values ($1, $2, $3, 'assistant', $4, false, $5)
       on conflict (account_id) do update set group_code = excluded.group_code, source = 'assistant', confidence = excluded.confidence, reason = excluded.reason
       where mappings.approved = false returning id`,
      [s.firmId, account.id, placement.groupCode, placement.score, placement.reason],
    );
    if (saved.rows.length > 0 && account.groupCode !== placement.groupCode) changed.push(account.groupCode, placement.groupCode);
  }
  // A changed group changes what a lead sheet holds, so its sign-offs no longer stand (as when a person changes a mapping).
  await clearSignOffs(tx, s, engagementId, changed, "account mapping changed");
  await audit(tx, s, "suggest", "mapping", engagementId, { ...result });
  return result;
}

/** Accept one suggestion, recording who and when. */
export async function acceptMapping(tx: Tx, s: Session, accountId: string): Promise<void> {
  const found = await tx.query<{ engagementId: string }>("select engagement_id as \"engagementId\" from accounts where id = $1", [accountId]);
  if (found.rows.length === 0) throw new Error("Account not found.");
  await open(tx, found.rows[0].engagementId);
  const done = await tx.query("update mappings set approved = true, approved_by = $2, approved_at = now() where account_id = $1 and approved = false returning id", [accountId, s.userId]);
  if (done.rows.length === 0) throw new Error("There is no suggestion to accept.");
  await audit(tx, s, "accept", "mapping", accountId);
}

/** Accept every unaccepted assistant suggestion in the high band, recording who and when. Medium and low ones are left for a person to look at. */
export async function acceptHighConfidence(tx: Tx, s: Session, engagementId: string): Promise<number> {
  await open(tx, engagementId);
  const { rows } = await tx.query(
    `update mappings set approved = true, approved_by = $2, approved_at = now()
     where approved = false and source = 'assistant' and confidence >= $3 and account_id in (select id from accounts where engagement_id = $1) returning id`,
    [engagementId, s.userId, HIGH],
  );
  await audit(tx, s, "accept_high", "mapping", engagementId, { count: rows.length });
  return rows.length;
}
