import { archiveBlocker, deadlineState, deadlineWords, type ArchiveFacts, type DeadlineState } from "../domain/archiving";
import { canLock, type Role } from "../domain/signoff";
import type { Tone } from "./status";

/** How the Review page words the file assembly deadline and the archive section. Pure; the server still enforces every rule. */

/** The deadline as a pill and a sentence. Overdue and due-today are amber; archived is neutral, shown with its word. */
export function deadlineView(reportDate: string | null, today: string, archivedAt: string | null): { state: DeadlineState; tone: Tone; label: string; words: string } {
  const state = deadlineState(reportDate, today, archivedAt);
  const words = deadlineWords(state);
  switch (state.kind) {
    case "overdue":
      return { state, tone: "warning", label: `Overdue by ${state.days} day${state.days === 1 ? "" : "s"}`, words };
    case "today":
      return { state, tone: "warning", label: "Due today", words };
    case "due":
      return { state, tone: "info", label: `Due in ${state.days} day${state.days === 1 ? "" : "s"}`, words };
    case "archived":
      return { state, tone: "slate", label: "Archived", words };
    case "no_report_date":
      return { state, tone: "neutral", label: "No report date", words };
  }
}

/** What archiving prevents and what stays possible, as plain lines. */
export const ARCHIVE_PREVENTS = [
  "The file can never be unlocked, by anyone, in the application or in the database.",
  "Nothing on the file can be changed, added or removed, ever: no working papers, no entries, no sign-offs, no opinion.",
] as const;
export const ARCHIVE_STAYS = "You can still open the file, and download and export anything on it. Each download and export is still recorded.";
export const ARCHIVE_IRREVERSIBLE = "This cannot be undone.";

export interface ArchiveSection {
  /** The danger section is shown: a partner or administrator, on a locked file that is not yet archived. */
  show: boolean;
  /** Why the file cannot be archived yet; null when it can. */
  blocker: string | null;
}

export function archiveSection(f: ArchiveFacts & { role: Role }): ArchiveSection {
  const show = canLock(f.role) && f.locked && !f.archived && f.audited;
  return { show, blocker: show ? archiveBlocker(f) : null };
}
