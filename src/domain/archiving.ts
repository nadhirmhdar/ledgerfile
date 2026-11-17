/**
 * Archiving: the file-assembly deadline, and when a locked file may be archived. Pure, so the server and the page apply the same words and
 * the same dates.
 *
 * The final audit file is to be assembled within 60 days of the date of the auditor's report (the period ISQM 1 and ISA 230 leave to the
 * firm's policy). The firm has confirmed 60 days. It is this one constant.
 */
export const ASSEMBLY_DAYS = 60;
/** The rule in words, for the page. Built from the constant, so it cannot differ from the deadline. */
export const ASSEMBLY_RULE = `The file is due to be assembled within ${ASSEMBLY_DAYS} days of the date of the auditor's report.`;

const DAY_MS = 86_400_000;
const parse = (iso: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error("Not a date.");
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) throw new Error("Not a date.");
  return t;
};
const format = (t: number): string => new Date(t).toISOString().slice(0, 10);

/** The date the file is due to be assembled: the report date and 60 days. Month ends and leap years follow the calendar. */
export const assemblyDeadline = (reportDate: string): string => format(parse(reportDate) + ASSEMBLY_DAYS * DAY_MS);

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from: string, to: string): number => Math.round((parse(to) - parse(from)) / DAY_MS);

export type DeadlineState =
  | { kind: "no_report_date" }
  | { kind: "due"; days: number; deadline: string }
  | { kind: "today"; deadline: string }
  | { kind: "overdue"; days: number; deadline: string }
  | { kind: "archived"; on: string; deadline: string | null };

/**
 * Where a file stands against its assembly deadline. An archived file is simply archived. Otherwise: no report date, due in N days, due
 * today, or overdue by N days. `today` and `archivedAt` are dates (2026-11-20).
 */
export function deadlineState(reportDate: string | null, today: string, archivedAt: string | null): DeadlineState {
  const deadline = reportDate ? assemblyDeadline(reportDate) : null;
  if (archivedAt) return { kind: "archived", on: archivedAt, deadline };
  if (!deadline) return { kind: "no_report_date" };
  const left = daysBetween(today, deadline);
  if (left > 0) return { kind: "due", days: left, deadline };
  if (left === 0) return { kind: "today", deadline };
  return { kind: "overdue", days: -left, deadline };
}

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** The state in words. */
export function deadlineWords(s: DeadlineState): string {
  switch (s.kind) {
    case "no_report_date":
      return "No report date is recorded, so there is no file assembly deadline yet.";
    case "due":
      return `The file is due to be assembled by ${s.deadline}, in ${days(s.days)}.`;
    case "today":
      return `The file is due to be assembled today (${s.deadline}).`;
    case "overdue":
      return `The file was due to be assembled by ${s.deadline}. It is overdue by ${days(s.days)}.`;
    case "archived":
      return `Archived on ${s.on}.`;
  }
}

/** True when what was typed is the client's name: the same letters, ignoring case and the space at either end. An empty name never matches. */
export function archiveConfirmationMatches(typed: string, clientName: string): boolean {
  const want = clientName.trim().toLowerCase();
  return want !== "" && typed.trim().toLowerCase() === want;
}

export interface ArchiveFacts {
  /** The engagement is locked. */
  locked: boolean;
  archived: boolean;
  /** The audit is on. */
  audited: boolean;
  /** An opinion is recorded. */
  hasOpinion: boolean;
  /** Its report date, if any. */
  reportDate: string | null;
  today: string;
}

/**
 * Why the file cannot be archived yet, in a plain sentence; null when every condition holds. The one place the conditions live: the server
 * refuses with this sentence and the page shows it.
 */
export function archiveBlocker(f: ArchiveFacts): string | null {
  if (f.archived) return "This file is already archived.";
  if (!f.locked) return "A file can be archived only after it has been locked.";
  if (!f.audited) return "Archiving is for audited files: the audit is not on for this engagement.";
  if (!f.hasOpinion) return "Record the audit opinion first: the file cannot be archived without it.";
  if (!f.reportDate) return "Record the date of the auditor's report first: the file cannot be archived without it.";
  if (f.today < f.reportDate) return `The auditor's report is dated ${f.reportDate}. The file cannot be archived before that date.`;
  return null;
}
