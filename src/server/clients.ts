import type { Tx } from "./db";
import { audit as log, lockClients, type Session } from "./repo";
import { canCreateClient, CLIENT_REFUSAL } from "../domain/permissions";
import { cleanName, MAX_NAME, MIN_NAME, nameKey } from "../domain/client-import";
import { checkDetails, DETAIL_LABEL, type ClientDetails, type DetailsInput } from "../domain/client-details";

/**
 * Clients: the list, one client's details, and editing them. Only someone who may add a client (canCreateClient), read again from the database, may edit;
 * everyone in the firm can read. A rename follows the same duplicate rule as Add client, under the same firm-wide lock. Every edit is logged with the
 * fields it changed, before and after. Row-level security keeps every query to the signed-in firm.
 */

export interface ClientListRow {
  id: string;
  name: string;
  licenceNumber: string | null;
  yearEnd: string | null;
  engagements: number;
}

export interface ClientRecord extends ClientDetails {
  id: string;
  name: string;
  framework: string;
  engagements: number;
}

const SELECT = `select c.id, c.name, c.framework, c.licence_number as "licenceNumber", c.licensing_authority as "licensingAuthority",
  c.tax_registration_number as "taxRegistrationNumber", c.year_end as "yearEnd", c.address, c.contact_name as "contactName", c.contact_email as "contactEmail",
  (select count(*)::int from engagements e where e.client_id = c.id) as engagements
  from clients c`;

/** The firm's clients, by name. A search matches part of the name or of the licence number, ignoring case. */
export async function listClientRows(tx: Tx, search = ""): Promise<ClientListRow[]> {
  const term = search.replace(/\s+/g, " ").trim().slice(0, 100);
  // A % or _ typed in the search is text, not a wildcard.
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { rows } = await tx.query<ClientListRow>(
    `select c.id, c.name, c.licence_number as "licenceNumber", c.year_end as "yearEnd", (select count(*)::int from engagements e where e.client_id = c.id) as engagements
     from clients c where $1 = '' or c.name ilike $2 or coalesce(c.licence_number, '') ilike $2 order by c.name`,
    [term, like],
  );
  return rows;
}

export async function getClientRecord(tx: Tx, id: string): Promise<ClientRecord | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (await tx.query<ClientRecord>(`${SELECT} where c.id = $1`, [id])).rows[0] ?? null;
}

async function requireMayEdit(tx: Tx, s: Session): Promise<void> {
  const { rows } = await tx.query<{ role: string }>("select role from users where id = $1", [s.userId]);
  if (!canCreateClient((rows[0]?.role ?? s.role) as Session["role"])) throw new Error(CLIENT_REFUSAL);
}

export type EditResult = { ok: true; changed: string[] } | { ok: false; message: string; errors?: Partial<Record<keyof ClientDetails | "name", string>> };

/**
 * Change a client's name and details. The name is cleaned and must not be another client's (any case or spacing); the details are checked field by field.
 * Saving what is already stored writes and logs nothing. The log keeps the changed fields as they were and as they are now.
 */
export async function updateClient(tx: Tx, s: Session, id: string, input: { name: unknown } & DetailsInput): Promise<EditResult> {
  await requireMayEdit(tx, s);
  const errors: Partial<Record<keyof ClientDetails | "name", string>> = {};
  const name = cleanName(input.name);
  if (name.length < MIN_NAME || name.length > MAX_NAME) errors.name = `The client's name needs ${MIN_NAME} to ${MAX_NAME} characters.`;
  const checked = checkDetails(input);
  if (!checked.ok) Object.assign(errors, checked.errors);
  if (Object.keys(errors).length > 0) return { ok: false, message: Object.values(errors)[0]!, errors };

  // The same lock as Add client and the import: a rename and an add cannot both take the same name.
  await lockClients(tx, s.firmId);
  const before = await getClientRecord(tx, id);
  if (!before) throw new Error("Client not found.");
  const clash = (await tx.query<{ id: string; name: string }>("select id, name from clients where id <> $1", [id])).rows.find((c) => nameKey(c.name) === nameKey(name));
  if (clash) return { ok: false, message: `${clash.name} is already a client.`, errors: { name: `${clash.name} is already a client.` } };

  const after = { name, ...(checked as { value: ClientDetails }).value };
  const fields = Object.keys(after) as (keyof typeof after)[];
  const changed = fields.filter((k) => (before[k] ?? null) !== after[k]);
  if (changed.length === 0) return { ok: true, changed: [] };
  await tx.query(
    `update clients set name = $2, licence_number = $3, licensing_authority = $4, tax_registration_number = $5, year_end = $6, address = $7, contact_name = $8, contact_email = $9 where id = $1`,
    [id, after.name, after.licenceNumber, after.licensingAuthority, after.taxRegistrationNumber, after.yearEnd, after.address, after.contactName, after.contactEmail],
  );
  await log(tx, s, "update", "client", id, {
    changed,
    before: Object.fromEntries(changed.map((k) => [k, before[k] ?? null])),
    after: Object.fromEntries(changed.map((k) => [k, after[k]])),
  });
  return { ok: true, changed: changed.map((k) => (k === "name" ? "Name" : DETAIL_LABEL[k])) };
}
