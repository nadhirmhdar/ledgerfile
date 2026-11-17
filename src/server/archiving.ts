import type { Tx } from "./db";
import { audit as log, getEngagement } from "./repo";
import { isEnabled } from "./audit";
import type { Actor } from "./review";
import { canLock } from "../domain/signoff";
import { archiveBlocker, archiveConfirmationMatches, deadlineState } from "../domain/archiving";
import { todayIso } from "../domain/client-requests";

/**
 * Archiving: the permanent lock. A locked file, once assembled, is archived by a partner (or administrator) who types the client's name.
 * THIS CANNOT BE UNDONE through the application, and a database trigger (migration 0022) refuses to unlock, re-date or delete an archived
 * file whatever code tries. What stays possible: reading, downloading and exporting, each still logged.
 *
 * Nothing archives a file but this function. No migration, deploy or background job does.
 */

export const NOT_PARTNER = "Only a partner can archive a file.";

/** Archive an engagement. Every condition is checked here, on the server, whatever the page showed. */
export async function archiveEngagement(tx: Tx, actor: Actor, engagementId: string, confirmation: string, today: string = todayIso()): Promise<void> {
  const engagement = await getEngagement(tx, engagementId);
  if (!engagement) throw new Error("Engagement not found.");
  if (!canLock(actor.role)) throw new Error(NOT_PARTNER);

  const opinion = await tx.query<{ reportDate: string | null }>("select to_char(report_date, 'YYYY-MM-DD') as \"reportDate\" from audit_opinions where engagement_id = $1", [engagementId]);
  const reportDate = opinion.rows[0]?.reportDate ?? null;
  const blocker = archiveBlocker({
    locked: engagement.status === "locked",
    archived: engagement.archivedAt !== null,
    audited: await isEnabled(tx, engagementId),
    hasOpinion: opinion.rows.length > 0,
    reportDate,
    today,
  });
  if (blocker) throw new Error(blocker);
  if (!archiveConfirmationMatches(confirmation, engagement.clientName)) throw new Error("The name typed does not match the client's name. Type it exactly as it is shown to archive the file.");

  // Only a still-unarchived, locked row is updated; the trigger repeats the rule below the application.
  const done = await tx.query("update engagements set archived_at = now(), archived_by = $2 where id = $1 and archived_at is null and status = 'locked' returning id", [engagementId, actor.userId]);
  if (done.rows.length === 0) throw new Error("The file could not be archived. Reload the page and check its state.");
  const state = deadlineState(reportDate, today, null);
  await log(tx, actor, "archive", "engagement", engagementId, {
    reportDate,
    deadline: state.kind === "no_report_date" ? null : state.deadline,
    deadlineState: state.kind,
    days: state.kind === "due" || state.kind === "overdue" ? state.days : 0,
  });
}
