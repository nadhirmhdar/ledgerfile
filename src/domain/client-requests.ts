/**
 * The client request list: what the audit team has asked the client for, and where each request stands.
 * Dates are plain calendar dates in the form YYYY-MM-DD, so they compare as text.
 */
export type RequestStatus = "open" | "received" | "not_applicable";

export const REQUEST_STATUSES: { code: RequestStatus; label: string }[] = [
  { code: "open", label: "Open" },
  { code: "received", label: "Received" },
  { code: "not_applicable", label: "Not applicable" },
];
export const STATUS_LABEL: Record<RequestStatus, string> = { open: "Open", received: "Received", not_applicable: "Not applicable" };
export const isRequestStatus = (v: string): v is RequestStatus => v === "open" || v === "received" || v === "not_applicable";

export const MAX_DESCRIPTION = 500;
export const MAX_NOTE = 1000;

/**
 * The time zone the application reckons "today" in. One place, for now: it should become a setting of each firm. Without it the
 * date would be the UTC date, a day behind in the UAE between midnight and 04:00.
 */
export const APP_TIME_ZONE = "Asia/Dubai";

/** Today as a calendar date in the application time zone. The clock is a parameter so the rules can be tested on any day. */
export const todayIso = (now: Date = new Date()): string => new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/** True for a real calendar date written YYYY-MM-DD (2025-02-30 is not one). */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** A request is overdue when it is still open and its due date is before today. A request due today is not overdue yet. */
export const isOverdue = (r: { status: RequestStatus; dueOn: string | null }, today: string): boolean => r.status === "open" && r.dueOn !== null && r.dueOn < today;

/** What a request can move to from where it is. Received and not applicable both go back through open. */
export function nextStatuses(status: RequestStatus): RequestStatus[] {
  return status === "open" ? ["received", "not_applicable"] : ["open"];
}

/** A description reduced for comparison: case and spacing ignored, so the same wording is not added twice. */
export const descriptionKey = (text: string): string => text.trim().replace(/\s+/g, " ").toLowerCase();

export interface Counts {
  /** Every request, whatever its status. */
  total: number;
  /** Requests still open. Overdue ones are part of this count. */
  open: number;
  /** Open requests whose due date has passed. */
  overdue: number;
  received: number;
  notApplicable: number;
}

const empty = (): Counts => ({ total: 0, open: 0, overdue: 0, received: 0, notApplicable: 0 });

function add(c: Counts, r: { status: RequestStatus; dueOn: string | null }, today: string) {
  c.total++;
  if (r.status === "open") c.open++;
  else if (r.status === "received") c.received++;
  else c.notApplicable++;
  if (isOverdue(r, today)) c.overdue++;
}

/** The counts overall and for each area. General requests (no area) are under the key "general". */
export function summarise(requests: { status: RequestStatus; dueOn: string | null; areaCode: string | null }[], today: string): { overall: Counts; byArea: Map<string, Counts> } {
  const overall = empty();
  const byArea = new Map<string, Counts>();
  for (const r of requests) {
    add(overall, r, today);
    const key = r.areaCode ?? "general";
    if (!byArea.has(key)) byArea.set(key, empty());
    add(byArea.get(key)!, r, today);
  }
  return { overall, byArea };
}

/** Tidy the text of a request and check its length. Returns the cleaned text or throws a message for the user. */
export function cleanDescription(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) throw new Error("Describe what is being requested.");
  if (t.length > MAX_DESCRIPTION) throw new Error(`The description is too long (at most ${MAX_DESCRIPTION} characters).`);
  return t;
}

export function cleanNote(text: string | null | undefined): string | null {
  const t = (text ?? "").trim();
  if (t.length > MAX_NOTE) throw new Error(`The note is too long (at most ${MAX_NOTE} characters).`);
  return t || null;
}
