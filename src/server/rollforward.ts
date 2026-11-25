import type { Tx } from "./db";
import { audit, lockEngagements, overlapRefusal, type Session } from "./repo";
import { setAuditEnabled } from "./audit";
import { applyFirmDefaults } from "./statement-defaults";
import { canCreateEngagement, ENGAGEMENT_REFUSAL } from "../domain/permissions";
import { todayIso } from "../domain/client-requests";
import { isRealDate, nextPeriod } from "../domain/client-details";
import type { Role } from "../domain/signoff";
import { MAX_ROLL_FORWARD, notEndedWords, ROLLED_FORWARD, type Created, type RollProblem, type RollRow } from "../domain/bulk-rollforward";

export { MAX_ROLL_FORWARD };

/**
 * Rolling many clients forward to their next year at once. One row per client with an engagement; the proposal is the year after the latest one;
 * creating is all or none, under the same lock the single path takes. Only a link to last year's file and whether the audit is on are carried: a
 * new engagement has no trial balance, requests, confirmations, schedules or materiality, and its mappings come when its trial balance is imported
 * (the importer prefers last year's approved mapping).
 */

interface EngRow {
  id: string;
  clientId: string;
  clientName: string;
  start: string;
  end: string;
  status: string;
  archived: boolean;
  auditEnabled: boolean;
}

const LOAD = `
  select e.id, e.client_id as "clientId", c.name as "clientName", to_char(e.period_start, 'YYYY-MM-DD') as start, to_char(e.period_end, 'YYYY-MM-DD') as "end",
         e.status, e.archived_at is not null as archived, e.audit_enabled as "auditEnabled"
  from engagements e join clients c on c.id = e.client_id where e.firm_id = $1`;

/**
 * What each client rolls forward from. "Last year's file" is the client's latest engagement whose period has ended (on or before today). The client
 * is already rolled forward when another engagement starts after it ends. A client with no ended engagement at all (its only engagement is the current
 * one) has not been rolled and has nothing to roll from yet: it is shown with its own words. Neither is offered, and neither is accepted.
 */
function basisPerClient(rows: EngRow[], today: string): Map<string, { last: EngRow; rolled: boolean; notEnded: boolean }> {
  const byClient = new Map<string, EngRow[]>();
  for (const r of rows) byClient.set(r.clientId, [...(byClient.get(r.clientId) ?? []), r]);
  const out = new Map<string, { last: EngRow; rolled: boolean; notEnded: boolean }>();
  for (const [clientId, list] of byClient) {
    const newestFirst = [...list].sort((a, b) => (a.end === b.end ? (a.start < b.start ? 1 : -1) : a.end < b.end ? 1 : -1));
    const last = newestFirst.find((e) => e.end <= today);
    out.set(clientId, last ? { last, rolled: list.some((x) => x.start > last.end), notEnded: false } : { last: newestFirst[0], rolled: false, notEnded: true });
  }
  return out;
}

/** Every client with an engagement, by name, with last year's engagement and the next period to propose. One query. */
export async function listRollForward(tx: Tx, firmId: string, today: string = todayIso()): Promise<RollRow[]> {
  const rows = (await tx.query<EngRow>(LOAD, [firmId])).rows;
  const out: RollRow[] = [];
  for (const { last: e, rolled, notEnded } of basisPerClient(rows, today).values()) {
    const proposed = nextPeriod(e.end);
    if (!proposed) continue;
    out.push({
      clientId: e.clientId,
      clientName: e.clientName,
      engagementId: e.id,
      periodStart: e.start,
      periodEnd: e.end,
      status: e.archived ? "Archived" : e.status === "open" ? "Open" : "Locked",
      auditEnabled: e.auditEnabled,
      proposed,
      rolledForward: rolled,
      notEnded,
    });
  }
  return out.sort((a, b) => a.clientName.localeCompare(b.clientName) || a.clientId.localeCompare(b.clientId));
}

/** Whether the person may create engagements, from the database and not from the session. */
export async function mayRollForward(tx: Tx, s: Session): Promise<boolean> {
  const who = await tx.query<{ role: Role; active: boolean }>("select role, active from users where id = $1 and firm_id = $2", [s.userId, s.firmId]);
  return !!who.rows[0]?.active && canCreateEngagement(who.rows[0].role);
}

export interface RollItem {
  clientId: string;
  start: string;
  end: string;
}
/** Nothing was created. Carries what was wrong, row by row, so the page can keep the selection and say which client and why. */
export class RollForwardError extends Error {
  constructor(
    message: string,
    readonly problems: RollProblem[],
  ) {
    super(message);
  }
}


const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Create the engagements, all or none. Every rule is checked here, on the server, whatever the page showed:
 * - the role is read again from the database, and must be allowed to create an engagement;
 * - at most 200, at least one, each client once;
 * - each client must be this firm's, have an engagement that has ended, and not be rolled forward already;
 * - both dates real, the end after the start, and no overlap with any existing engagement of the client.
 * All the rows are checked before any is written; the firm lock is held from the first check to the end of the transaction.
 */
export async function rollForward(tx: Tx, s: Session, items: RollItem[], today: string = todayIso()): Promise<Created[]> {
  const who = await tx.query<{ role: Role; active: boolean }>("select role, active from users where id = $1 and firm_id = $2", [s.userId, s.firmId]);
  if (!who.rows[0]?.active || !canCreateEngagement(who.rows[0].role)) throw new Error(ENGAGEMENT_REFUSAL);
  if (items.length === 0) throw new Error("Choose at least one client to roll forward.");
  if (items.length > MAX_ROLL_FORWARD) throw new Error(`Roll forward at most ${MAX_ROLL_FORWARD} clients at a time. You chose ${items.length}.`);

  await lockEngagements(tx, s.firmId);
  const all = (await tx.query<EngRow>(LOAD, [s.firmId])).rows;
  const basis = basisPerClient(all, today);
  const problems: RollProblem[] = [];
  const seen = new Set<string>();
  const ok: { item: RollItem; prior: EngRow }[] = [];

  for (const item of items) {
    const b = UUID.test(item.clientId) ? basis.get(item.clientId) : undefined;
    const prior = b?.last;
    const name = prior?.clientName ?? "Unknown client";
    const refuse = (message: string) => problems.push({ clientId: item.clientId, clientName: name, message });
    if (!prior) refuse("This is not one of the firm's clients with an engagement to roll forward.");
    else if (seen.has(item.clientId)) refuse("This client was chosen twice.");
    else if (b!.notEnded) refuse(`${notEndedWords(prior.end)}.`);
    else if (b!.rolled) refuse(`${ROLLED_FORWARD}: the client already has an engagement after ${prior.end}.`);
    else if (!isRealDate(item.start) || !isRealDate(item.end)) refuse("Enter both dates as real dates.");
    else if (item.end <= item.start) refuse("The period end must be after the period start.");
    else {
      const overlap = await overlapRefusal(tx, item.clientId, name, item.start, item.end);
      if (overlap) refuse(overlap);
      else ok.push({ item, prior });
    }
    seen.add(item.clientId);
  }
  if (problems.length > 0) {
    throw new RollForwardError(`Nothing was created. ${problems.length === 1 ? "One client" : `${problems.length} clients`} could not be rolled forward.`, problems);
  }

  const created: Created[] = [];
  for (const { item, prior } of ok) {
    // The link is to last year's file: the client's latest ended engagement. The new period starts after it ends and cannot overlap anything, so it is also
    // the most recent earlier one, which is what a single creation links to; the two paths cannot disagree.
    const { rows } = await tx.query<{ id: string }>(
      "insert into engagements (firm_id, client_id, period_start, period_end, prior_engagement_id) values ($1, $2, $3, $4, $5) returning id",
      [s.firmId, item.clientId, item.start, item.end, prior.id],
    );
    const id = rows[0].id;
    await audit(tx, s, "create", "engagement", id, { clientId: item.clientId, periodStart: item.start, periodEnd: item.end, priorEngagementId: prior.id, bulk: true });
    // The firm's statement defaults, as for any new engagement. Last year's edited notes are not copied.
    await applyFirmDefaults(tx, s, id);
    // The audit on: turned on the usual way, so its checklist steps are loaded. Nothing else of last year's audit is carried.
    if (prior.auditEnabled) await setAuditEnabled(tx, { ...s, role: who.rows[0].role }, id, true);
    created.push({ engagementId: id, clientId: item.clientId, clientName: prior.clientName, start: item.start, end: item.end });
  }
  await audit(tx, s, "bulk_rollforward", "firm", s.firmId, { count: created.length, clientIds: created.map((c) => c.clientId) });
  return created;
}
