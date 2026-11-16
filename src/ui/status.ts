/**
 * One fixed status vocabulary for the whole app. A status is always shown as a soft pill with an icon and a word, never by colour alone.
 *   Not started: neutral       In progress: blue           Needs review / Waiting: amber
 *   Done / Reviewed: green     Problem / Blocked: red      Not applicable: muted         Locked: slate (with a lock icon)
 */
export type Status = "not_started" | "in_progress" | "needs_review" | "waiting" | "done" | "reviewed" | "problem" | "blocked" | "not_applicable" | "locked";

export type Tone = "neutral" | "info" | "warning" | "success" | "danger" | "muted" | "slate";

export const STATUS_LABEL: Record<Status, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  needs_review: "Needs review",
  waiting: "Waiting",
  done: "Done",
  reviewed: "Reviewed",
  problem: "Problem",
  blocked: "Blocked",
  not_applicable: "Not applicable",
  locked: "Locked",
};

const TONE: Record<Status, Tone> = {
  not_started: "neutral",
  in_progress: "info",
  needs_review: "warning",
  waiting: "warning",
  done: "success",
  reviewed: "success",
  problem: "danger",
  blocked: "danger",
  not_applicable: "muted",
  locked: "slate",
};

/** The colour family for a status. */
export const statusTone = (status: Status): Tone => TONE[status];

export const isStatus = (v: string): v is Status => Object.hasOwn(TONE, v);
