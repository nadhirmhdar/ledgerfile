import type { Tx } from "./db";
import { audit as log, getEngagement, listAccounts, type Session } from "./repo";
import { canLock } from "../domain/signoff";
import { checkPlanningSettings, DEFAULT_PLANNING_SETTINGS, isDefault, type PlanningSettings } from "../domain/planning-settings";
import { derivePlanning, type Derivation, type PlanningAnswers } from "../domain/planning";

/**
 * The firm's planning settings, and the planning assistant's derivation for an engagement. A firm with no stored settings has the defaults, which are
 * today's materiality constants (and drafts for the rest), so nothing changes until a partner or the administrator edits them. The derivation reads and
 * saves nothing about the engagement: a person confirms through the existing forms.
 */

export const NOT_PARTNER = "Only a partner or the firm administrator can change the planning settings.";

export interface StoredSettings {
  settings: PlanningSettings;
  /** True when the firm has changed anything: false means the defaults. */
  customised: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** The signed-in firm's settings (row-level security), completed with the defaults. */
export async function getPlanningSettings(tx: Tx): Promise<StoredSettings> {
  const { rows } = await tx.query<{ settings: unknown; updatedBy: string; updatedAt: string }>(
    `select s.settings, u.name as "updatedBy", to_char(s.updated_at at time zone 'UTC', 'YYYY-MM-DD') as "updatedAt"
     from firm_planning_settings s join users u on u.id = s.updated_by`,
  );
  if (rows.length === 0) return { settings: DEFAULT_PLANNING_SETTINGS, customised: false, updatedBy: null, updatedAt: null };
  const checked = checkPlanningSettings(rows[0].settings);
  // A stored value that no longer passes (it should not happen) falls back to the defaults rather than breaking planning.
  const settings = checked.ok ? checked.value : DEFAULT_PLANNING_SETTINGS;
  return { settings, customised: !isDefault(settings), updatedBy: rows[0].updatedBy, updatedAt: rows[0].updatedAt };
}

/** Save the firm's settings. Partner-level only, the role read from the database. Every change is kept before and after, and logged. */
export async function updatePlanningSettings(tx: Tx, s: Session, input: unknown): Promise<PlanningSettings> {
  const { rows } = await tx.query<{ role: string }>("select role from users where id = $1", [s.userId]);
  if (!canLock((rows[0]?.role ?? s.role) as Session["role"])) throw new Error(NOT_PARTNER);
  const checked = checkPlanningSettings(input);
  if (!checked.ok) throw new Error(checked.message);
  const before = await getPlanningSettings(tx);
  if (JSON.stringify(before.settings) === JSON.stringify(checked.value)) return checked.value;
  await tx.query(
    `insert into firm_planning_settings (firm_id, settings, updated_by, updated_at) values ($1, $2, $3, clock_timestamp())
     on conflict (firm_id) do update set settings = excluded.settings, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    [s.firmId, JSON.stringify(checked.value), s.userId],
  );
  await tx.query("insert into firm_planning_settings_history (firm_id, before_values, after_values, changed_by) values ($1, $2, $3, $4)", [
    s.firmId,
    before.updatedAt !== null ? JSON.stringify(before.settings) : null,
    JSON.stringify(checked.value),
    s.userId,
  ]);
  await log(tx, s, "update_planning_settings", "firm", null, { before: before.updatedAt !== null ? before.settings : "defaults", after: checked.value });
  return checked.value;
}

/** Go back to the defaults. The row is kept (with the defaults) so the history stays whole. */
export async function resetPlanningSettings(tx: Tx, s: Session): Promise<void> {
  await updatePlanningSettings(tx, s, DEFAULT_PLANNING_SETTINGS);
}

/** The planning assistant for an engagement: figures, suggestions and indicators from the adjusted trial balance. Saves nothing. */
export async function getPlanningDerivation(tx: Tx, engagementId: string, answers: PlanningAnswers = {}): Promise<{ derivation: Derivation; settings: StoredSettings } | null> {
  const engagement = await getEngagement(tx, engagementId);
  if (!engagement) return null;
  const accounts = await listAccounts(tx, engagementId);
  const settings = await getPlanningSettings(tx);
  const derivation = derivePlanning({
    accounts: accounts.map((a) => ({ code: a.code, name: a.name, closingMinor: a.closingMinor + a.adjustmentMinor, priorMinor: a.priorMinor, groupCode: a.groupCode })),
    answers,
    settings: settings.settings,
    statementOptions: { borrowingsCurrent: { current: engagement.borrowingsCurrentMinor, prior: engagement.borrowingsCurrentPriorMinor } },
  });
  return { derivation, settings };
}
