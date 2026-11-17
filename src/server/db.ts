import { PGlite } from "@electric-sql/pglite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { databaseUrl, redact } from "./config";
import { applyMigrations, assertSchemaCurrent, upsertGroups } from "./migrations";
import { createPostgresDb } from "./pg-adapter";

/**
 * What the code uses of a database: run a statement, run several, or run work in a transaction. PGlite (local development and
 * the tests) and node-postgres (hosted) both fit it, so nothing above this file knows which one it has.
 */
export interface Queryable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows are typed at each call site, as with PGlite's own default
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
}
export type Tx = Queryable;
export interface Db extends Queryable {
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Fixed identifiers for the demo firm and user that the seed script creates. */
export const DEV_FIRM_ID = "00000000-0000-4000-8000-000000000001";
export const DEV_USER_ID = "00000000-0000-4000-8000-000000000002";

/**
 * Open a local PGlite database, apply any migrations not yet applied, and load the standard groups.
 * With no directory the database is in memory, which the tests use.
 */
export async function openDatabase(dataDir?: string): Promise<Db> {
  // Tests only: against a real Postgres server when one is offered (see test-database.ts). The app never sets this.
  if (!dataDir && process.env.TEST_DATABASE_URL) return (await import("./test-database")).openTestPostgres(process.env.TEST_DATABASE_URL);
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const db: Db = new PGlite(dataDir);
  await applyMigrations(db);
  // The grouping structure is system content, kept in step with the code on every local start.
  await upsertGroups(db);
  return db;
}

/** Create a firm with one admin user. Runs as the table owner: firm creation is not a tenant action. */
export async function createFirm(db: Queryable, firm: { id: string; name: string }, user: { id: string; email: string; name: string }) {
  await db.query("insert into firms (id, name) values ($1, $2) on conflict (id) do nothing", [firm.id, firm.name]);
  await db.query(
    "insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, 'admin') on conflict (id) do nothing",
    [user.id, firm.id, user.email, user.name],
  );
}

/**
 * Run work as one firm. The transaction switches to the non-owner application role
 * and sets the firm, so row-level security confines every statement to that firm's rows.
 * Both settings are local to the transaction (SET LOCAL, set_config(..., true)) and the transaction holds one connection from
 * start to end, so this is safe behind a transaction pooler: nothing is left on the connection for the next caller.
 */
export async function withFirm<T>(db: Db, firmId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role app_user");
    await tx.query("select set_config('app.firm_id', $1, true)", [firmId]);
    return fn(tx);
  });
}

/**
 * Run authentication work: sign-in, sessions, sign-up and user management. It happens before the firm is known, so it cannot use
 * withFirm. It runs as app_auth, a role that owns nothing and can reach only firms, users, sessions and the audit log's insert,
 * so these paths no longer depend on the connecting role owning every table.
 */
export async function withAuth<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role app_auth");
    return fn(tx);
  });
}

// One database per server process; the global survives hot reloads in development.
const holder = globalThis as unknown as { __ledgerfileDb?: Promise<Db> };

async function openForProcess(): Promise<Db> {
  const url = databaseUrl();
  if (!url) return openDatabase(path.join(process.cwd(), ".data", "pg"));
  // Hosted: the schema is migrated by `npm run db:migrate`, never at start. Refuse to run against a different version.
  const db = createPostgresDb(url);
  try {
    await assertSchemaCurrent(db);
  } catch (e) {
    await db.close().catch(() => undefined);
    throw e instanceof Error ? new Error(redact(e.message)) : e;
  }
  return db;
}

export function getDb(): Promise<Db> {
  if (!holder.__ledgerfileDb) {
    holder.__ledgerfileDb = openForProcess();
    // A failed open must not be cached, or every later request would fail until restart.
    holder.__ledgerfileDb.catch(() => {
      holder.__ledgerfileDb = undefined;
    });
  }
  return holder.__ledgerfileDb;
}
