import { isRequestStatus, type RequestStatus } from "../domain/client-requests";
import { count } from "./text";
import type { Tone } from "./status";

/**
 * How the client requests list is read: which requests a status, an area and a search leave, the counts on the chips, the
 * sentence under the title, and what each row offers. Pure, from the requests the page has already loaded.
 */

export type StatusFilter = "" | "open" | "overdue" | RequestStatus;

export interface RequestLike {
  reference: string;
  description: string;
  status: RequestStatus;
  overdue: boolean;
  areaCode: string | null;
}

/** The ?status= value: one of the known statuses or "overdue", else all. */
export function parseStatus(v: string | string[] | undefined): StatusFilter {
  const one = (Array.isArray(v) ? v[0] : v) ?? "";
  return one === "overdue" || isRequestStatus(one) ? one : "";
}

/** The ?area= value, as given: an area code, "general", or empty for all. */
export const parseAreaFilter = (v: string | string[] | undefined): string => ((Array.isArray(v) ? v[0] : v) ?? "").trim();

/** The ?q= value, trimmed and capped. */
export const parseSearch = (v: string | string[] | undefined): string => ((Array.isArray(v) ? v[0] : v) ?? "").trim().slice(0, 100);

const inArea = (r: RequestLike, area: string) => (area === "" ? true : area === "general" ? r.areaCode === null : r.areaCode === area);
const matchesStatus = (r: RequestLike, s: StatusFilter) => (s === "" ? true : s === "overdue" ? r.overdue : r.status === s);
const matchesSearch = (r: RequestLike, q: string) => q === "" || r.reference.toLowerCase().includes(q.toLowerCase()) || r.description.toLowerCase().includes(q.toLowerCase());

export interface StatusCounts {
  all: number;
  open: number;
  overdue: number;
  received: number;
  notApplicable: number;
}

/** Counts by status for the chosen area and search, whatever status is chosen, so the chips show what each would leave. */
export function statusCounts<T extends RequestLike>(rows: T[], opts: { area?: string; q?: string } = {}): StatusCounts {
  const c: StatusCounts = { all: 0, open: 0, overdue: 0, received: 0, notApplicable: 0 };
  for (const r of rows) {
    if (!inArea(r, opts.area ?? "") || !matchesSearch(r, opts.q ?? "")) continue;
    c.all++;
    if (r.status === "open") c.open++;
    if (r.overdue) c.overdue++;
    if (r.status === "received") c.received++;
    if (r.status === "not_applicable") c.notApplicable++;
  }
  return c;
}

/** The requests a status, an area and a search leave, in the order they were given (reference order). */
export function filterRequests<T extends RequestLike>(rows: T[], opts: { status?: StatusFilter; area?: string; q?: string } = {}): { rows: T[]; shown: number; total: number } {
  const kept = rows.filter((r) => matchesStatus(r, opts.status ?? "") && inArea(r, opts.area ?? "") && matchesSearch(r, opts.q ?? ""));
  return { rows: kept, shown: kept.length, total: rows.length };
}

export const requestResults = (shown: number, total: number): string => `Showing ${shown} of ${count(total, "request")}.`;

/** "46 open, 3 overdue, 1 received." */
export function requestsSentence(c: { total: number; open: number; overdue: number; received: number; notApplicable: number }): string {
  if (c.total === 0) return "No requests yet.";
  const parts = [`${c.open} open`, c.overdue > 0 && `${c.overdue} overdue`, c.received > 0 && `${c.received} received`, c.notApplicable > 0 && `${c.notApplicable} not applicable`].filter(Boolean);
  return `${parts.join(", ")}.`;
}

export const STATUS_PILL: Record<RequestStatus, { tone: Tone; label: string }> = {
  open: { tone: "neutral", label: "Open" },
  received: { tone: "success", label: "Received" },
  not_applicable: { tone: "muted", label: "Not applicable" },
};

/** The muted second line of a row. */
export function requestMeta(r: { requestedByName: string; requestedOn: string; dueOn: string | null; receivedOn: string | null; files: number }): string {
  return [`Asked by ${r.requestedByName} on ${r.requestedOn}`, r.dueOn ? `due ${r.dueOn}` : "no due date", r.receivedOn ? `received ${r.receivedOn}` : null, r.files > 0 ? count(r.files, "file") : null].filter(Boolean).join(", ");
}

export interface RowControls {
  /** The date and button on the row itself: the one common action. */
  inlineReceived: boolean;
  /** Everything below is inside the "More" panel. */
  notApplicable: boolean;
  reopen: boolean;
  link: boolean;
  unlink: boolean;
  edit: boolean;
  /** Only an open request with no files can be deleted. */
  delete: boolean;
}

export function rowControls(r: { status: RequestStatus; files: number; unlinkedAvailable: number }, locked: boolean): RowControls {
  if (locked) return { inlineReceived: false, notApplicable: false, reopen: false, link: false, unlink: false, edit: false, delete: false };
  const isOpen = r.status === "open";
  return {
    inlineReceived: isOpen,
    notApplicable: isOpen,
    reopen: !isOpen,
    link: r.unlinkedAvailable > 0,
    unlink: r.files > 0,
    edit: true,
    delete: isOpen && r.files === 0,
  };
}

/**
 * The sentence under the title and the line that says what the tiles and chips count. The sentence is always the whole list;
 * when an area or a search is applied, it says so and the second line names the scope, so the two counts are never confused.
 */
export function requestsHeading(i: {
  overall: { total: number; open: number; overdue: number; received: number; notApplicable: number };
  area: string;
  areaTitle: string | null;
  q: string;
}): { subtitle: string; scope: string | null } {
  const whole = requestsSentence(i.overall);
  // With no requests at all there is nothing for a filter to be a part of.
  if (i.overall.total === 0) return { subtitle: whole, scope: null };
  const parts = [i.area ? (i.area === "general" ? "general requests" : (i.areaTitle ?? i.area)) : null, i.q ? `the search “${i.q}”` : null].filter(Boolean) as string[];
  if (parts.length === 0) return { subtitle: whole, scope: null };
  return { subtitle: `Whole list: ${whole}`, scope: `The tiles and filters below count ${parts.join(" and ")}.` };
}
