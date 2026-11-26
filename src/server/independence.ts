import type { Tx } from "./db";
import { audit, type Session } from "./repo";
import { canLock, type Role } from "../domain/signoff";
import {
  confirmationKey,
  MAX_TEXT,
  NOTE_NEEDED,
  NOT_ON_TEAM,
  ONLY_PARTNER,
  ONLY_YOURSELF,
  STAGES,
  TEXT_TOO_LONG,
  THREATS_NEEDED,
  type Conclusion,
  type Confirmation,
  type Independence,
  type Member,
  type Outcome,
  type Stage,
  type StageConclusion,
} from "../domain/independence";

/**
 * Independence confirmations and the partner's conclusions (migration 0042): append-only rows, the latest being current. The team is the engagement's
 * own preparer, reviewer and partner and every area preparer or reviewer who is set; only active users count. Every rule is checked here.
 */

const LOCKED = "This engagement is locked.";

const TEAM = `
  with places as (
    select preparer_id as user_id, 'Preparer' as place, 1 as o from engagements where id = $1
    union select reviewer_id, 'Reviewer', 2 from engagements where id = $1
    union select partner_id, 'Partner', 3 from engagements where id = $1
    union select preparer_id, 'Area preparer', 4 from engagement_area_assignments where engagement_id = $1
    union select reviewer_id, 'Area reviewer', 5 from engagement_area_assignments where engagement_id = $1
  )
  select u.id, u.name, array_agg(p.place order by p.o) as places
  from places p join users u on u.id = p.user_id
  where u.active
  group by u.id, u.name
  order by min(p.o), u.name, u.id`;

export async function listTeam(tx: Tx, engagementId: string): Promise<Member[]> {
  return (await tx.query<Member>(TEAM, [engagementId])).rows;
}

export async function getIndependence(tx: Tx, engagementId: string): Promise<Independence> {
  const members = await listTeam(tx, engagementId);
  const partner = await tx.query<{ partnerId: string | null }>('select partner_id as "partnerId" from engagements where id = $1', [engagementId]);
  const confirmations = await tx.query<{ userId: string; stage: Stage; outcome: Outcome; threats: string; safeguards: string; at: string }>(
    `select distinct on (user_id, stage) user_id as "userId", stage, outcome, threats, safeguards, to_char(recorded_at at time zone 'UTC', 'YYYY-MM-DD') as at
     from independence_confirmations where engagement_id = $1 order by user_id, stage, id desc`,
    [engagementId],
  );
  const concluded = await tx.query<{ stage: Stage; conclusion: Conclusion; note: string; by: string; at: string }>(
    `select distinct on (c.stage) c.stage, c.conclusion, c.note, u.name as by, to_char(c.recorded_at at time zone 'UTC', 'YYYY-MM-DD') as at
     from independence_conclusions c join users u on u.id = c.recorded_by where c.engagement_id = $1 order by c.stage, c.id desc`,
    [engagementId],
  );
  const latest = new Map<string, Confirmation>(confirmations.rows.map((r) => [confirmationKey(r.userId, r.stage), { outcome: r.outcome, threats: r.threats, safeguards: r.safeguards, at: r.at }]));
  const conclusions: Partial<Record<Stage, StageConclusion>> = {};
  for (const r of concluded.rows) conclusions[r.stage] = { conclusion: r.conclusion, note: r.note, by: r.by, at: r.at };
  return { members, partnerId: partner.rows[0]?.partnerId ?? null, latest, conclusions };
}

async function openEngagement(tx: Tx, s: Session, engagementId: string): Promise<{ partnerId: string | null; role: Role }> {
  // The role and whether the person is still active are read from the database, whatever the session says.
  const who = await tx.query<{ role: Role; active: boolean }>("select role, active from users where id = $1 and firm_id = $2", [s.userId, s.firmId]);
  const e = await tx.query<{ status: string; partnerId: string | null }>('select status, partner_id as "partnerId" from engagements where id = $1 and firm_id = $2', [engagementId, s.firmId]);
  if (e.rows.length === 0) throw new Error("Engagement not found.");
  if (!who.rows[0]?.active) throw new Error(NOT_ON_TEAM);
  // A locked file is read-only, and an archived one is locked.
  if (e.rows[0].status !== "open") throw new Error(LOCKED);
  return { partnerId: e.rows[0].partnerId, role: who.rows[0].role };
}

const isStage = (v: string): v is Stage => (STAGES as string[]).includes(v);

export interface ConfirmationInput {
  stage: string;
  outcome: string;
  threats: string;
  safeguards: string;
  /** Never set by the application; a request that names somebody else is refused. */
  forUserId?: string;
}

/** Record the signed-in person's own confirmation for a stage, as the next row. */
export async function recordConfirmation(tx: Tx, s: Session, engagementId: string, input: ConfirmationInput): Promise<void> {
  if (input.forUserId !== undefined && input.forUserId !== s.userId) throw new Error(ONLY_YOURSELF);
  await openEngagement(tx, s, engagementId);
  if (!(await listTeam(tx, engagementId)).some((m) => m.id === s.userId)) throw new Error(NOT_ON_TEAM);
  if (!isStage(input.stage)) throw new Error("Choose planning or completion.");
  if (input.outcome !== "confirmed" && input.outcome !== "threats_noted") throw new Error("Choose whether you confirm or note threats.");
  const noted = input.outcome === "threats_noted";
  const threats = noted ? input.threats.trim() : "";
  const safeguards = noted ? input.safeguards.trim() : "";
  if (threats.length > MAX_TEXT || safeguards.length > MAX_TEXT) throw new Error(TEXT_TOO_LONG);
  if (noted && (threats === "" || safeguards === "")) throw new Error(THREATS_NEEDED);
  await tx.query("insert into independence_confirmations (firm_id, engagement_id, user_id, stage, outcome, threats, safeguards) values ($1, $2, $3, $4, $5, $6, $7)", [
    s.firmId,
    engagementId,
    s.userId,
    input.stage,
    input.outcome,
    threats,
    safeguards,
  ]);
  await audit(tx, s, "independence_confirm", "engagement", engagementId, { stage: input.stage, outcome: input.outcome, ...(noted ? { threats, safeguards } : {}) });
}

export interface ConclusionInput {
  stage: string;
  conclusion: string;
  note: string;
}

/** The engagement partner's conclusion for a stage. Only that person may record it, and they must still hold partner rights. */
export async function recordConclusion(tx: Tx, s: Session, engagementId: string, input: ConclusionInput): Promise<void> {
  const { partnerId, role } = await openEngagement(tx, s, engagementId);
  if (partnerId !== s.userId || !canLock(role)) throw new Error(ONLY_PARTNER);
  if (!isStage(input.stage)) throw new Error("Choose planning or completion.");
  if (input.conclusion !== "met" && input.conclusion !== "not_met") throw new Error("Choose a conclusion.");
  const note = input.note.trim();
  if (note.length > MAX_TEXT) throw new Error(TEXT_TOO_LONG);
  if (note === "") throw new Error(NOTE_NEEDED);
  await tx.query("insert into independence_conclusions (firm_id, engagement_id, stage, conclusion, note, recorded_by) values ($1, $2, $3, $4, $5, $6)", [s.firmId, engagementId, input.stage, input.conclusion, note, s.userId]);
  await audit(tx, s, "independence_conclude", "engagement", engagementId, { stage: input.stage, conclusion: input.conclusion, note });
}
