import ExcelJS from "exceljs";
import type { Tx } from "./db";
import { audit as log, type Session } from "./repo";
import { AuthError, requireAdmin, type AuthSession } from "./auth";
import { setText } from "./schedule-xlsx";
import { safePart } from "./schedule-export";
import {
  CAP_MESSAGE,
  decodeCursor,
  describeAction,
  detailJson,
  encodeCursor,
  EXPORT_CAP,
  EXPORT_COLUMNS,
  hasFilters,
  isUuid,
  type Cursor,
  PAGE_SIZE,
  summarise,
  toCsv,
  type LogFilters,
} from "../domain/audit-log";

/**
 * The firm's audit log: read for administrators only, newest first, paged by position (never by offset), filtered, and exported.
 *
 * Which engagement an entry belongs to is worked out inside the one list query, not per row (see ENGAGEMENT_OF): the entry's own entity when
 * it is the engagement, else the engagementId its detail carries, else the engagement of an account, else the entity id of an entry whose
 * entity is something kept per engagement. Firm-level, client-level and sign-in entries have none. No column is added for it.
 */

/** Confirm from the database that the person is an active administrator. Everyone else gets "not found" from the page and the export. */
export async function isAdmin(tx: Tx, s: AuthSession): Promise<boolean> {
  try {
    await requireAdmin(tx, s);
    return true;
  } catch (e) {
    if (e instanceof AuthError) return false;
    throw e;
  }
}

const UUID_RE = "'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'";
/** Entities whose entity_id is the engagement's id (the entry records a change made to the engagement as a whole). */
const ENGAGEMENT_ID_ENTITIES = [
  "audit_area",
  "lead_sheet",
  "lead_sheets",
  "mapping",
  "trial_balance",
  "journal_listing",
  "journal_test",
  "confirmations",
  "client_requests",
  "financial_statements",
  "working_paper_index",
];

const WITH_ENGAGEMENT = `
  with l as (
    select a.id, a.at, a.user_id, a.action, a.entity, a.entity_id, a.detail,
           coalesce(
             case when a.entity = 'engagement' and a.entity_id ~* ${UUID_RE} then a.entity_id::uuid end,
             case when jsonb_typeof(a.detail) = 'object' and a.detail->>'engagementId' ~* ${UUID_RE} then (a.detail->>'engagementId')::uuid end,
             ac.engagement_id,
             case when (a.entity in (${ENGAGEMENT_ID_ENTITIES.map((e) => `'${e}'`).join(", ")}) or a.entity like '%\\_letter') and a.entity_id ~* ${UUID_RE} then a.entity_id::uuid end
           ) as engagement_id
    from audit_log a
    left join accounts ac on a.entity in ('account', 'mapping') and a.entity_id ~* ${UUID_RE} and ac.id = (case when a.entity_id ~* ${UUID_RE} then a.entity_id::uuid end)
    where a.firm_id = $1
  )`;

export interface LogEntry {
  id: number;
  at: string;
  who: string;
  what: string;
  action: string;
  entity: string;
  engagementId: string | null;
  engagement: string | null;
  summary: string;
  json: string;
}

interface Row {
  id: number;
  atKey: string;
  at: string;
  userId: string | null;
  who: string | null;
  action: string;
  entity: string;
  detail: unknown;
  engagementId: string | null;
  clientName: string | null;
  periodStart: string | null;
  periodEnd: string | null;
}

const toEntry = (r: Row): LogEntry => {
  const detail = typeof r.detail === "string" ? safeParse(r.detail) : r.detail;
  return {
    id: r.id,
    at: r.at,
    who: r.who ?? (r.userId ? "Deleted user" : "System"),
    what: describeAction(r.action, r.entity),
    action: r.action,
    entity: r.entity,
    engagementId: r.engagementId,
    engagement: r.clientName ? `${r.clientName}, ${r.periodStart} to ${r.periodEnd}` : null,
    summary: summarise(detail),
    json: detailJson(detail),
  };
};
const safeParse = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

const SELECT = `
  select l.id::float8 as id, to_char(l.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "atKey", to_char(l.at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') as at,
         l.user_id as "userId", u.name as who, l.action, l.entity, l.detail, e.id as "engagementId", c.name as "clientName",
         to_char(e.period_start, 'YYYY-MM-DD') as "periodStart", to_char(e.period_end, 'YYYY-MM-DD') as "periodEnd"
  from l left join users u on u.id = l.user_id left join engagements e on e.id = l.engagement_id left join clients c on c.id = e.client_id`;

/** The WHERE for the filters and an optional position. Parameters start after the firm ($1). */
function where(f: LogFilters, cursor: { c: Cursor; dir: "older" | "newer" } | null): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length + 1}`;
  };
  if (f.person) parts.push(`l.user_id = ${p(f.person)}::uuid`);
  if (f.engagement) parts.push(`l.engagement_id = ${p(f.engagement)}::uuid`);
  if (f.action) parts.push(`l.action = ${p(f.action)}`);
  // Whole days, inclusive, in UTC: the day the page and the export show.
  if (f.from) parts.push(`(l.at at time zone 'UTC')::date >= ${p(f.from)}::date`);
  if (f.to) parts.push(`(l.at at time zone 'UTC')::date <= ${p(f.to)}::date`);
  if (cursor) parts.push(`(l.at, l.id) ${cursor.dir === "older" ? "<" : ">"} (${p(cursor.c.at)}::timestamptz, ${p(cursor.c.id)}::bigint)`);
  return { sql: parts.length ? ` where ${parts.join(" and ")}` : "", params };
}

export interface LogPage {
  entries: LogEntry[];
  /** Where the next older page starts, or null on the last page. */
  older: string | null;
  /** Where the next newer page starts, or null on the first page. */
  newer: string | null;
}

/** One page of the log, newest first, `PAGE_SIZE` entries, from a position. No offset: a page never repeats or skips an entry. */
export async function getLogPage(tx: Tx, s: Session, f: LogFilters, cursor: { value: string | string[] | undefined; dir: "older" | "newer" } | null, size = PAGE_SIZE): Promise<LogPage> {
  const c = cursor ? decodeCursor(cursor.value) : null;
  const dir = c && cursor ? cursor.dir : null;
  const w = where(f, c && dir ? { c, dir } : null);
  const order = dir === "newer" ? "asc" : "desc";
  const { rows } = await tx.query<Row>(`${WITH_ENGAGEMENT} ${SELECT}${w.sql} order by l.at ${order}, l.id ${order} limit ${size + 1}`, [s.firmId, ...w.params]);
  const more = rows.length > size;
  let page = rows.slice(0, size);
  if (dir === "newer") page = page.reverse();
  const key = (r: Row): string => encodeCursor({ at: r.atKey, id: r.id });
  const first = page[0];
  const last = page[page.length - 1];
  return {
    entries: page.map(toEntry),
    // Coming from a position means the entries it came from still exist on the other side.
    older: last && (dir === "newer" ? true : more) ? key(last) : null,
    newer: first && (dir === "newer" ? more : dir === "older") ? key(first) : null,
  };
}

export async function countLog(tx: Tx, s: Session, f: LogFilters): Promise<number> {
  const w = where(f, null);
  const { rows } = await tx.query<{ n: number }>(`${WITH_ENGAGEMENT} select count(*)::int as n from l${w.sql}`, [s.firmId, ...w.params]);
  return rows[0].n;
}

export interface FilterChoices {
  people: { id: string; name: string }[];
  engagements: { id: string; label: string }[];
  actions: { action: string; label: string }[];
}

/** What the filter selects offer: the firm's people and engagements, and the actions that appear in its log. */
export async function filterChoices(tx: Tx, s: Session): Promise<FilterChoices> {
  const [people, engagements, actions] = await Promise.all([
    tx.query<{ id: string; name: string }>("select id, name from users order by name"),
    tx.query<{ id: string; label: string }>(
      `select e.id, c.name || ', ' || to_char(e.period_start, 'YYYY-MM-DD') || ' to ' || to_char(e.period_end, 'YYYY-MM-DD') as label
       from engagements e join clients c on c.id = e.client_id order by c.name, e.period_end desc`,
    ),
    tx.query<{ action: string; entity: string }>("select distinct action, entity from audit_log where firm_id = $1", [s.firmId]),
  ]);
  const seen = new Map<string, string>();
  for (const a of actions.rows) if (!seen.has(a.action)) seen.set(a.action, describeAction(a.action, a.entity));
  return { people: people.rows, engagements: engagements.rows, actions: [...seen].map(([action, label]) => ({ action, label })).sort((a, b) => a.label.localeCompare(b.label)) };
}

/** Drop a person or engagement that is not in this firm, with a sentence saying so. The rest of the filters stand. */
export async function checkFilters(tx: Tx, f: LogFilters): Promise<{ filters: LogFilters; problems: string[] }> {
  const filters = { ...f };
  const problems: string[] = [];
  if (filters.person && (!isUuid(filters.person) || (await tx.query("select 1 from users where id = $1", [filters.person])).rows.length === 0)) {
    problems.push("That person is not on this firm's team, so the person filter was ignored.");
    filters.person = null;
  }
  if (filters.engagement && (!isUuid(filters.engagement) || (await tx.query("select 1 from engagements where id = $1", [filters.engagement])).rows.length === 0)) {
    problems.push("That engagement is not one of this firm's, so the engagement filter was ignored.");
    filters.engagement = null;
  }
  return { filters, problems };
}

// --- Export ---------------------------------------------------------------------------------------------------------------

export type ExportResult = { ok: true; body: Buffer | string; fileName: string; contentType: string; rows: number } | { ok: false; message: string };
export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const CSV_TYPE = "text/csv; charset=utf-8";

/** A spreadsheet cell holds at most 32,767 characters. */
const fit = (v: string) => (v.length > 32_000 ? `${v.slice(0, 32_000)} … (cut: too long for one cell)` : v);
const cells = (e: LogEntry): string[] => [e.at, e.who, e.what, e.action, e.engagement ?? "", e.summary, fit(e.json)];

/**
 * Export the entries the filters select, not only a page. Refused above `cap` with a message asking for narrower dates. The export is itself
 * logged (action export, entity audit_log) with the filters and the number of rows, after the rows are read, so it is not in its own file.
 * Every Excel cell is written as text and every CSV cell that could be a formula gets a leading apostrophe.
 */
export async function exportLog(tx: Tx, s: Session, f: LogFilters, format: "xlsx" | "csv", cap: number = EXPORT_CAP): Promise<ExportResult> {
  const total = await countLog(tx, s, f);
  if (total > cap) return { ok: false, message: CAP_MESSAGE(total, cap) };
  const w = where(f, null);
  const { rows } = await tx.query<Row>(`${WITH_ENGAGEMENT} ${SELECT}${w.sql} order by l.at desc, l.id desc limit ${cap}`, [s.firmId, ...w.params]);
  const entries = rows.map(toEntry);
  const firm = (await tx.query<{ name: string }>("select name from firms")).rows[0]?.name ?? "firm";
  await log(tx, s, "export", "audit_log", null, { filters: Object.fromEntries(Object.entries(f).filter(([, v]) => v)), rows: entries.length, format });
  const fileName = `audit-log-${safePart(firm, "firm")}-${f.from ?? "first"}-${f.to ?? "latest"}.${format}`;
  if (format === "csv") return { ok: true, body: toCsv([EXPORT_COLUMNS, ...entries.map(cells)]), fileName, contentType: CSV_TYPE, rows: entries.length };

  const wb = new ExcelJS.Workbook();
  wb.creator = "LedgerFile";
  const sheet = wb.addWorksheet("Audit log");
  sheet.columns = [{ width: 20 }, { width: 22 }, { width: 40 }, { width: 28 }, { width: 38 }, { width: 60 }, { width: 70 }];
  EXPORT_COLUMNS.forEach((h, i) => {
    const c = sheet.getRow(1).getCell(i + 1);
    setText(c, h);
    c.font = { bold: true };
    c.border = { bottom: { style: "thin" } };
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  entries.forEach((e, r) => {
    const row = sheet.getRow(r + 2);
    cells(e).forEach((v, i) => setText(row.getCell(i + 1), v));
    row.getCell(7).alignment = { wrapText: true, vertical: "top" };
  });
  return { ok: true, body: Buffer.from(await wb.xlsx.writeBuffer()), fileName, contentType: XLSX_TYPE, rows: entries.length };
}

export { hasFilters };
