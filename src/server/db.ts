import { PGlite, type Transaction } from "@electric-sql/pglite";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { GROUPS } from "../domain/groups";

export type Tx = Transaction;

/** Fixed identifiers for the demo firm and user that the seed script creates. */
export const DEV_FIRM_ID = "00000000-0000-4000-8000-000000000001";
export const DEV_USER_ID = "00000000-0000-4000-8000-000000000002";

/**
 * Open a database, apply any migrations not yet applied, and load the standard groups.
 * With no directory the database is in memory, which the tests use.
 */
export async function openDatabase(dataDir?: string): Promise<PGlite> {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const db = new PGlite(dataDir);
  await db.exec("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");

  const dir = path.join(process.cwd(), "db", "migrations");
  const applied = new Set((await db.query<{ name: string }>("select name from schema_migrations")).rows.map((r) => r.name));
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (applied.has(file)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(readFileSync(path.join(dir, file), "utf8"));
      await tx.query("insert into schema_migrations (name) values ($1)", [file]);
    });
  }

  // The grouping structure is system content, kept in step with the code on every start.
  for (const g of GROUPS) {
    await db.query(
      `insert into groups (code, name, statement, section, sort) values ($1, $2, $3, $4, $5)
       on conflict (code) do update set name = excluded.name, statement = excluded.statement, section = excluded.section, sort = excluded.sort`,
      [g.code, g.name, g.statement, g.section, g.sort],
    );
  }
  return db;
}

/** Create a firm with one admin user. Runs as the table owner: firm creation is not a tenant action. */
export async function createFirm(db: PGlite, firm: { id: string; name: string }, user: { id: string; email: string; name: string }) {
  await db.query("insert into firms (id, name) values ($1, $2) on conflict (id) do nothing", [firm.id, firm.name]);
  await db.query(
    "insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, 'admin') on conflict (id) do nothing",
    [user.id, firm.id, user.email, user.name],
  );
}

/**
 * Run work as one firm. The transaction switches to the non-owner application role
 * and sets the firm, so row-level security confines every statement to that firm's rows.
 */
export async function withFirm<T>(db: PGlite, firmId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role app_user");
    await tx.query("select set_config('app.firm_id', $1, true)", [firmId]);
    return fn(tx);
  });
}

// One database per server process; the global survives hot reloads in development.
const holder = globalThis as unknown as { __ledgerfileDb?: Promise<PGlite> };

export function getDb(): Promise<PGlite> {
  if (!holder.__ledgerfileDb) {
    holder.__ledgerfileDb = openDatabase(path.join(process.cwd(), ".data", "pg"));
    // A failed open must not be cached, or every later request would fail until restart.
    holder.__ledgerfileDb.catch(() => {
      holder.__ledgerfileDb = undefined;
    });
  }
  return holder.__ledgerfileDb;
}
