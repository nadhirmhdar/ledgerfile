/**
 * The firm's audit log, as words. Pure: it reads nothing and changes nothing, so the page, the export and the tests apply the same labels,
 * the same filters and the same secret removal.
 */

export const PAGE_SIZE = 100;
/** The most rows one export holds. Above it the person is asked to narrow the dates. */
export const EXPORT_CAP = 50_000;
export const CAP_MESSAGE = (n: number, cap: number = EXPORT_CAP) =>
  `${n.toLocaleString("en-GB")} entries match, and an export holds at most ${cap.toLocaleString("en-GB")}. Narrow the dates and try again.`;

// --- Labels ---------------------------------------------------------------------------------------------------------------

/** What an action means in plain words. Keyed "entity:action" where the same code is used on several things, else by the action alone. */
const LABEL: Record<string, string> = {
  "client:create": "Added a client",
  "client:update": "Changed a client's details",
  "engagement:create": "Created an engagement",
  "journal_entry:create": "Posted a journal entry",
  "journal_entry:delete": "Deleted a journal entry",
  "test_schedule:create": "Created a test schedule",
  "test_schedule:update": "Updated a test schedule",
  "test_schedule:delete": "Deleted a test schedule",
  "test_schedule:rollforward": "Brought test schedules forward",
  "engagement:rollforward": "Brought test schedules forward",
  "clients:import": "Imported clients",
  "trial_balance:import": "Imported a trial balance",
  "journal_listing:import": "Imported a journal listing",
  "client_requests:export": "Exported client requests",
  "confirmations:export": "Exported confirmations",
  "lead_sheets:export": "Exported lead sheets",
  "test_schedule:export": "Exported test schedules",
  "financial_statements:export": "Exported the financial statements",
  "working_paper_index:export": "Exported the working paper index",
  "audit_log:export": "Exported the audit log",
  "working_paper:download": "Downloaded a working paper",
  "working_paper:file": "Filed a working paper",
  "working_paper:upload": "Uploaded a working paper",
  "working_paper:upload_version": "Uploaded a new version of a working paper",
  "working_paper:remove": "Removed a working paper",
  "misstatement:add": "Recorded a misstatement",
  "journal_test:select": "Selected a journal entry for testing",
  "journal_test:unselect": "Unselected a journal entry",
  "journal_test:test": "Marked a journal entry as tested",
  "mapping:suggest": "Asked for mapping suggestions",
  "mapping:accept": "Accepted a mapping suggestion",
  "mapping:accept_high": "Accepted the high-confidence mappings",
  "mapping:approve_all": "Approved all mappings",
  "account:map": "Mapped an account",
  "lead_sheet:sign_off": "Signed a lead sheet",
  "lead_sheet:withdraw_sign_off": "Withdrew a lead sheet sign-off",
  "review_point:raise": "Raised a review point",
  "review_point:respond": "Responded to a review point",
  "review_point:reply": "Replied on a review point",
  "review_point:clear": "Cleared a review point",
  "engagement:lock": "Locked the engagement",
  "engagement:unlock": "Unlocked the engagement",
  "engagement:archive": "Archived the file",
  "user:sign_in": "Signed in",
  "user:sign_in_failed": "A sign-in failed",
  "firm:sign_up": "Registered the firm",
};

const BY_ACTION: Record<string, string> = {
  analytical_explain: "Explained an analytical review movement",
  analytical_reconfirm: "Re-confirmed an analytical explanation",
  set_materiality: "Set materiality",
  assess_risk: "Assessed risk in an area",
  approve_risk_assessment: "Approved the risk assessment",
  procedure_done: "Completed an audit procedure",
  procedure_na: "Marked an audit procedure not applicable",
  procedure_open: "Reopened an audit procedure",
  procedure_review: "Reviewed an audit procedure",
  procedure_unreview: "Withdrew the review of an audit procedure",
  procedure_review_area: "Reviewed the procedures in an area",
  client_request_add: "Added a client request",
  client_request_edit: "Edited a client request",
  client_request_received: "Marked a client request received",
  client_request_not_applicable: "Marked a client request not applicable",
  client_request_reopen: "Reopened a client request",
  client_request_delete: "Deleted a client request",
  client_request_link: "Linked a file to a client request",
  client_request_unlink: "Unlinked a file from a client request",
  client_request_starter: "Added the starter client requests",
  client_request_rollforward: "Brought client requests forward",
  confirmation_add: "Added a confirmation",
  confirmation_edit: "Edited a confirmation",
  confirmation_sent: "Marked a confirmation sent",
  confirmation_unsent: "Withdrew a confirmation's sent date",
  confirmation_reminder: "Added a confirmation reminder",
  confirmation_reminder_removed: "Removed a confirmation reminder",
  confirmation_reply: "Recorded a confirmation reply",
  confirmation_reply_cleared: "Cleared a confirmation reply",
  confirmation_reconciliation: "Saved a confirmation reconciliation",
  confirmation_alternatives: "Saved alternative procedures for a confirmation",
  confirmation_link: "Linked a file to a confirmation",
  confirmation_unlink: "Unlinked a file from a confirmation",
  confirmation_prepare: "Signed a confirmation as prepared",
  confirmation_unprepare: "Withdrew a confirmation's preparation",
  confirmation_review: "Reviewed a confirmation",
  confirmation_unreview: "Withdrew the review of a confirmation",
  confirmation_delete: "Deleted a confirmation",
  confirmation_rollforward: "Brought confirmations forward",
  save_lines: "Saved the lines of a test schedule",
  import_lines: "Imported lines into a test schedule",
  schedule_review: "Reviewed a test schedule",
  schedule_unreview: "Withdrew the review of a test schedule",
  record_opinion: "Recorded the audit opinion",
  clear_opinion: "Cleared the audit opinion",
  answer_planning_question: "Answered a planning question",
  rebut_revenue_presumption: "Rebutted the revenue presumption",
  reinstate_revenue_presumption: "Reinstated the revenue presumption",
  confirm_planning_materiality: "Confirmed materiality in planning",
  update_planning_settings: "Changed the firm's planning settings",
  sign_offs_cleared: "Sign-offs cleared because the figures changed",
  set_borrowings_current: "Set the current part of borrowings",
  download_report: "Downloaded the auditor's report",
  save_tb_layout: "Saved a trial balance column layout",
  forget_tb_layout: "Forgot a trial balance column layout",
  add_user: "Added a person to the team",
  set_role: "Changed a person's role",
  reactivate: "Reactivated a person",
  deactivate: "Deactivated a person",
  reset_password: "Reset a person's password",
  change_password: "Changed their own password",
  update_branding: "Changed the firm's details",
  upload_logo: "Uploaded the firm's logo",
  remove_logo: "Removed the firm's logo",
  edit_procedure_wording: "Reworded a library procedure",
  hide_procedure_wording: "Hid a library procedure",
  show_procedure_wording: "Showed a library procedure again",
  reset_procedure_wording: "Reset a library procedure to the library's wording",
  add_own_procedure: "Added the firm's own procedure",
  edit_own_procedure: "Edited the firm's own procedure",
  assign_team: "Changed the engagement team",
  retire_own_procedure: "Retired the firm's own procedure",
  restore_own_procedure: "Restored the firm's own procedure",
};

const sentence = (code: string) => {
  const s = code.replace(/_/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : code;
};

/** The words for an entry. Unknown codes fall back to the code in sentence form, so a new action is never blank. */
export function describeAction(action: string, entity: string): string {
  if (/_letter$/.test(entity) && action === "export") return "Exported a letter";
  return LABEL[`${entity}:${action}`] ?? BY_ACTION[action] ?? sentence(action);
}

// --- Secrets --------------------------------------------------------------------------------------------------------------

/** A key whose value is never shown, in the page, the fold or the export. */
const SECRET_KEY = /pass(word|phrase)?|hash|token|secret|session|cookie|api[_-]?key|authori[sz]ation|credential|salt|private[_-]?key/i;
export const HIDDEN = "[hidden]";

/** The detail with every secret-looking key replaced by "[hidden]", at any depth. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEY.test(k) ? HIDDEN : redact(v)]));
  }
  return value;
}

const label = (key: string) => sentence(key.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase());

const cut = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}…` : s);
const plain = (v: unknown): v is string | number | boolean => typeof v === "string" || typeof v === "number" || typeof v === "boolean";

/** One value in words, never JSON: a name for a thing that has one, plain values joined by commas, else how many fields or items it has. */
const short = (v: unknown): string => {
  if (v === null || v === undefined) return "none";
  if (plain(v)) return cut(String(v));
  if (Array.isArray(v)) return v.every(plain) ? cut(v.map(String).join(", ")) : `${v.length} item${v.length === 1 ? "" : "s"}`;
  const o = v as Record<string, unknown>;
  for (const k of ["name", "label", "title"]) if (typeof o[k] === "string" && o[k]) return cut(o[k] as string);
  const keys = Object.keys(o);
  return keys.length === 0 ? "empty" : cut(`${keys.length} field${keys.length === 1 ? "" : "s"}: ${keys.join(", ")}`);
};

/**
 * A short readable summary of the detail: "Key: value" pairs, a before and after as "before → after", at most five items. Secrets are left out
 * (the fold and the export show them as "[hidden]"). The engagement id is left out: the Engagement column says it.
 */
export function summarise(detail: unknown): string {
  const d = redact(detail);
  if (!d || typeof d !== "object" || Array.isArray(d)) return d === null || d === undefined ? "" : short(d);
  const obj = d as Record<string, unknown>;
  const parts: string[] = [];
  const before = obj.before && typeof obj.before === "object" ? (obj.before as Record<string, unknown>) : null;
  const after = obj.after && typeof obj.after === "object" ? (obj.after as Record<string, unknown>) : null;
  if (before && after) {
    for (const k of Object.keys(after).filter((k) => !(k in before) || JSON.stringify(before[k]) !== JSON.stringify(after[k]))) parts.push(`${label(k)}: ${short(before[k])} → ${short(after[k])}`);
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === "engagementId" || k === "before" || k === "after" || v === HIDDEN) continue;
    if (v === undefined) continue;
    parts.push(`${label(k)}: ${short(v)}`);
  }
  const shown = parts.slice(0, 5);
  return shown.join("; ") + (parts.length > 5 ? `; and ${parts.length - 5} more` : "");
}

/** The detail as pretty JSON for the fold and the export, secrets hidden. Empty for no detail. */
export const detailJson = (detail: unknown, pretty = true): string => (detail === null || detail === undefined ? "" : JSON.stringify(redact(detail), null, pretty ? 2 : undefined));

// --- Filters --------------------------------------------------------------------------------------------------------------

export interface LogFilters {
  person: string | null;
  engagement: string | null;
  action: string | null;
  from: string | null;
  to: string | null;
}
export const NO_FILTERS: LogFilters = { person: null, engagement: null, action: null, from: null, to: null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID.test(v);
const ACTION = /^[a-z0-9_]{1,80}$/;

export function isRealDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || null;

/**
 * Read the filters from the address. A value that is not valid is ignored and explained in words, never an error: the list shows everything
 * the valid filters allow. Whether a person or engagement exists in this firm is checked by the server (`checkFilters`).
 */
export function parseFilters(raw: Raw): { filters: LogFilters; problems: string[] } {
  const problems: string[] = [];
  const f: LogFilters = { ...NO_FILTERS };
  const person = one(raw.person);
  if (person) {
    if (isUuid(person)) f.person = person;
    else problems.push("The person filter was not understood, so it was ignored.");
  }
  const engagement = one(raw.engagement);
  if (engagement) {
    if (isUuid(engagement)) f.engagement = engagement;
    else problems.push("The engagement filter was not understood, so it was ignored.");
  }
  const action = one(raw.action);
  if (action) {
    if (ACTION.test(action)) f.action = action;
    else problems.push("The action filter was not understood, so it was ignored.");
  }
  for (const key of ["from", "to"] as const) {
    const v = one(raw[key]);
    if (!v) continue;
    if (isRealDate(v)) f[key] = v;
    else problems.push(`The ${key === "from" ? "start" : "end"} date must be a real date written YYYY-MM-DD, so it was ignored.`);
  }
  if (f.from && f.to && f.from > f.to) {
    problems.push("The start date is after the end date, so both dates were ignored.");
    f.from = null;
    f.to = null;
  }
  return { filters: f, problems };
}

export const hasFilters = (f: LogFilters) => Object.values(f).some((v) => v !== null);

/** The filters as address parameters, for the paging, the clear link and the export links. */
export function filterParams(f: LogFilters): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  return p;
}

// --- Paging ---------------------------------------------------------------------------------------------------------------

/** A position in the log: the microsecond time as text and the id. Not a number of rows, so nothing repeats or is skipped. */
export interface Cursor {
  at: string;
  id: number;
}
export const encodeCursor = (c: Cursor): string => `${c.at}|${c.id}`;
export function decodeCursor(v: string | string[] | undefined): Cursor | null {
  const s = one(v);
  const m = s && /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)\|(\d{1,18})$/.exec(s);
  return m ? { at: m[1], id: Number(m[2]) } : null;
}

// --- Export cells ---------------------------------------------------------------------------------------------------------

/** A cell a spreadsheet could read as a formula: it starts with =, +, -, @, a tab or a carriage return. */
export const looksLikeFormula = (v: string) => /^[=+\-@\t\r]/.test(v);
/** A CSV cell made safe: a leading apostrophe on anything that could be a formula. */
export const guardCsv = (v: string) => (looksLikeFormula(v) ? `'${v}` : v);

const BOM = "﻿";
/** CSV as Excel opens it: UTF-8 with a byte order mark, every cell quoted, lines ended CRLF, formula-looking cells guarded. */
export function toCsv(rows: string[][]): string {
  return BOM + rows.map((r) => r.map((c) => `"${guardCsv(c).replace(/"/g, '""')}"`).join(",")).join("\r\n") + "\r\n";
}

export const EXPORT_COLUMNS = ["When (UTC)", "Who", "What", "Action", "Engagement", "Details", "Detail (JSON)"];
