import type { Tx } from "./db";
import { audit as log, insertClient, lockClients, type Session } from "./repo";
import { canCreateClient, CLIENT_REFUSAL } from "../domain/permissions";
import { classifyNames, entryFromItem, MAX_IMPORT_ROWS, previewFromGrid, type ImportCounts, type ImportPreview } from "../domain/client-import";
import { EMPTY_DETAILS } from "../domain/client-details";

/**
 * Importing a client list. Only someone who may add a client (canCreateClient, the same rule as the Add client form) may preview or import.
 * The preview reads the file against the firm's clients; importing never trusts the preview: it classifies the names again inside the
 * transaction, against the clients as they are at that moment, and adds only what is new. Running the same import twice adds nothing the second time.
 */

/** The role as the database has it now, not as the session said when it was made. */
async function requirePartner(tx: Tx, s: Session): Promise<void> {
  const { rows } = await tx.query<{ role: string }>("select role from users where id = $1", [s.userId]);
  const role = rows[0]?.role ?? s.role;
  if (!canCreateClient(role as Session["role"])) throw new Error(CLIENT_REFUSAL);
}

const existingNames = async (tx: Tx): Promise<string[]> => (await tx.query<{ name: string }>("select name from clients")).rows.map((r) => r.name);

/** Read a grid against this firm's clients, and say what would happen to each row. Nothing is saved. */
export async function previewClientImport(tx: Tx, s: Session, grid: unknown[][]): Promise<ImportPreview> {
  await requirePartner(tx, s);
  return previewFromGrid(grid, await existingNames(tx));
}

export interface ImportResult {
  added: number;
  counts: ImportCounts;
}

/**
 * Add the clients that are new. They come from the browser, so every name is cleaned, checked and compared with the database again, and every detail is
 * checked again (one that does not pass is dropped). An item is a bare name or a name with details.
 */
export async function importClients(tx: Tx, s: Session, items: unknown): Promise<ImportResult> {
  await requirePartner(tx, s);
  if (!Array.isArray(items)) throw new Error("There are no names to add.");
  const entries = items.map((item, i) => entryFromItem(item, i + 1));
  const names = entries.map((e) => e.name);
  if (names.some((x) => typeof x !== "string")) throw new Error("There are no names to add.");
  if (names.length > MAX_IMPORT_ROWS) throw new Error(`Add at most ${MAX_IMPORT_ROWS.toLocaleString("en-US")} clients at a time.`);
  // One import at a time for the firm: a second one waits here until the first has committed, then reads the clients it added and adds nothing twice.
  await lockClients(tx, s.firmId);
  const { rows, counts } = classifyNames(names.map((raw, i) => ({ line: i + 1, raw })), await existingNames(tx));
  for (const row of rows) {
    if (row.status === "add") await insertClient(tx, s, row.name, { ...EMPTY_DETAILS, ...entries[row.line - 1].details });
  }
  await log(tx, s, "import", "clients", null, { added: counts.add, alreadyClients: counts.existing, repeated: counts.repeated, tooLong: counts.tooLong, tooShort: counts.tooShort, blank: counts.blank });
  return { added: counts.add, counts };
}
