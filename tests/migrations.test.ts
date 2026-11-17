import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/server/db";
import { assertSchemaCurrent, LATEST_MIGRATION } from "../src/server/migrations";

describe("migrations", () => {
  it("LATEST_MIGRATION names the newest file, so a hosted start compares against the right version", () => {
    const files = readdirSync(path.join(process.cwd(), "db", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(LATEST_MIGRATION).toBe(files[files.length - 1]);
  });

  it("a fully migrated database passes the start check", async () => {
    const db = await openDatabase();
    await expect(assertSchemaCurrent(db)).resolves.toBeUndefined();
    await db.close();
  });

  it("a database that is behind fails clearly and is not migrated", async () => {
    const db = await openDatabase();
    await db.query("delete from schema_migrations where name = $1", [LATEST_MIGRATION]);
    await expect(assertSchemaCurrent(db)).rejects.toThrow(/needs 0021_audit_opinions\.sql\. Run `npm run db:migrate`/);
    const { rows } = await db.query("select 1 from schema_migrations where name = $1", [LATEST_MIGRATION]);
    expect(rows).toHaveLength(0);
    await db.close();
  });

  it("an empty database says to run the migration", async () => {
    const db = await openDatabase();
    await db.exec("drop table schema_migrations");
    await expect(assertSchemaCurrent(db)).rejects.toThrow(/npm run db:migrate/);
    await db.close();
  });
});

describe("the application roles", () => {
  it("do not own tables, do not bypass row-level security, and cannot log in", async () => {
    const db = await openDatabase();
    const { rows } = await db.query<{ rolname: string; rolbypassrls: boolean; rolsuper: boolean; rolcanlogin: boolean }>(
      "select rolname, rolbypassrls, rolsuper, rolcanlogin from pg_roles where rolname in ('app_user', 'app_auth') order by rolname",
    );
    expect(rows.map((r) => r.rolname)).toEqual(["app_auth", "app_user"]);
    for (const r of rows) expect([r.rolbypassrls, r.rolsuper, r.rolcanlogin]).toEqual([false, false, false]);
    const owned = await db.query("select 1 from pg_tables where schemaname = 'public' and tableowner in ('app_user', 'app_auth')");
    expect(owned.rows).toHaveLength(0);
    await db.close();
  });

  it("app_user still cannot see sessions or password hashes", async () => {
    const db = await openDatabase();
    await expect(db.transaction(async (tx) => { await tx.exec("set local role app_user"); await tx.query("select * from sessions"); })).rejects.toThrow(/permission denied/);
    await expect(db.transaction(async (tx) => { await tx.exec("set local role app_user"); await tx.query("select password_hash from users"); })).rejects.toThrow(/permission denied/);
    await db.close();
  });

  it("app_auth reaches only the four authentication tables", async () => {
    const db = await openDatabase();
    await expect(db.transaction(async (tx) => { await tx.exec("set local role app_auth"); await tx.query("select * from clients"); })).rejects.toThrow(/permission denied/);
    await expect(db.transaction(async (tx) => { await tx.exec("set local role app_auth"); await tx.query("select * from audit_log"); })).rejects.toThrow(/permission denied/);
    await db.close();
  });
});
