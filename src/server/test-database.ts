import { randomBytes } from "node:crypto";
import { applyMigrations, upsertGroups } from "./migrations";
import { createPostgresDb } from "./pg-adapter";
import type { Db } from "./db";

/**
 * For the test suite only: when TEST_DATABASE_URL is set, an in-memory openDatabase() gives each test file its own freshly migrated
 * database on that Postgres server instead of a PGlite one, so the same tests run against the real adapter. The URL must be a role
 * that can create databases (and, like Supabase's postgres role, owns what it creates). Never read by the app itself.
 */
export async function openTestPostgres(adminUrl: string): Promise<Db> {
  const name = `lf_test_${randomBytes(6).toString("hex")}`;
  const admin = createPostgresDb(adminUrl, { max: 1 });
  try {
    await admin.exec(`create database ${name}`);
  } finally {
    await admin.close();
  }
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const db = createPostgresDb(url.toString(), { max: 4 });
  await applyMigrations(db, undefined, { lock: true });
  await upsertGroups(db);
  return db;
}
