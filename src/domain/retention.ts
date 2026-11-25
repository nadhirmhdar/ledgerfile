/**
 * Retention controls, as words and rules. Pure.
 *
 * The firm sets its own retention period; the application has no default and states no legal period. The clock runs from the day a file was ARCHIVED
 * (the assembled, signed record), never from the period end, and only archived files can ever be past it. Deleting is a two-person act, and the person
 * who asked can never be the one who approves.
 */

export const MIN_YEARS = 1;
export const MAX_YEARS = 30;
export const MIN_REASON = 5;
export const MAX_REASON = 1000;

export const NOT_PARTNER = "Only a partner can manage retention.";
export const NOT_SET = "The firm has not set a retention period, so no file is ever past it and nothing can be deleted.";
export const ONE_PARTNER = "Deleting a file needs two partner-level people: one to ask and a different one to approve. This firm has only one, so no file can be deleted.";
export const SAME_PERSON = "A deletion has to be approved by a different partner-level person from the one who asked.";
export const NAME_MISMATCH = "The name typed is not the client's name. Type it exactly as it is shown.";

/** The period as typed, checked: blank clears it. */
export function checkYears(input: string | number | null): { ok: true; years: number | null } | { ok: false; message: string } {
  if (input === null || String(input).trim() === "") return { ok: true, years: null };
  const text = String(input).trim();
  if (!/^\d{1,2}$/.test(text)) return { ok: false, message: `Enter a whole number of years from ${MIN_YEARS} to ${MAX_YEARS}, or leave it blank for none.` };
  const n = Number(text);
  if (n < MIN_YEARS || n > MAX_YEARS) return { ok: false, message: `The period must be from ${MIN_YEARS} to ${MAX_YEARS} years.` };
  return { ok: true, years: n };
}

/** The names a deletion's counts use, in words. A count of nothing is left out. */
const TABLE_WORDS: Record<string, string> = {
  accounts: "trial balance accounts",
  analytical_explanations: "analytical explanations",
  audit_opinions: "audit opinions",
  audit_procedures: "audit procedures",
  client_request_files: "client request file links",
  client_requests: "client requests",
  confirmation_files: "confirmation file links",
  confirmations: "confirmations",
  journal_entries: "journal entries",
  journal_lines: "journal lines",
  journal_tests: "journal tests",
  ledger_entries: "ledger entries",
  ledger_imports: "ledger imports",
  ledger_lines: "ledger lines",
  mappings: "account mappings",
  materiality: "materiality records",
  misstatements: "misstatements",
  note_texts: "versions of the notes wording",
  pending_uploads: "unfinished uploads",
  planning_answers: "planning answers",
  review_points: "review points",
  risk_approvals: "risk approvals",
  risk_assessments: "risk assessments",
  sign_offs: "sign-offs",
  tb_imports: "trial balance imports",
  test_schedule_lines: "test schedule lines",
  test_schedules: "test schedules",
  working_papers: "working papers (and their files)",
  engagements: "the engagement",
};

const one = (words: string): string => {
  const m = /^(.*?)( \(.*\))?$/.exec(words)!;
  const head = m[1].endsWith("ies") ? m[1].slice(0, -3) + "y" : m[1].endsWith("s") && !m[1].endsWith("ss") ? m[1].slice(0, -1) : m[1];
  return head + (m[2] ?? "");
};

export function countsSentence(counts: Record<string, number>): string {
  const parts = Object.entries(counts)
    .filter(([k, n]) => n > 0 && TABLE_WORDS[k])
    .map(([k, n]) => (k === "engagements" ? TABLE_WORDS[k] : `${n.toLocaleString("en-GB")} ${n === 1 ? one(TABLE_WORDS[k]) : TABLE_WORDS[k]}`));
  return parts.length === 0 ? "nothing but the engagement itself" : parts.join(", ");
}

export const TOTAL_ROWS = (counts: Record<string, number>): number => Object.entries(counts).reduce((s, [k, n]) => s + (TABLE_WORDS[k] ? n : 0), 0);

export type RequestState = "none" | "pending" | "cancelled";

/** What the page says about an engagement's deletion state. */
export function stateWords(s: { kind: RequestState; requester?: string; at?: string }): string {
  if (s.kind === "pending") return `Deletion requested by ${s.requester} on ${s.at}, waiting for a different partner to approve.`;
  if (s.kind === "cancelled") return `A deletion request was cancelled on ${s.at}.`;
  return "No deletion requested.";
}

export const pastRetentionLine = (since: string): string => `Past the firm's retention period since ${since}.`;

/** What is deleted and what is kept, in the words of the page and the confirmation. */
export const DELETED_WORDS = "Deleting removes the engagement and everything held for it: the trial balance and mappings, journals and ledger listings, the audit programme, schedules, confirmations, client requests, review points, sign-offs, notes and every uploaded file.";
export const KEPT_WORDS = "Kept: the audit log (the firm's record, including of the deletion, whose entries may still name the client) and a short record that the file was deleted, with the client's name, the period, the dates and how many rows of each kind were removed. The client stays on the client list.";
