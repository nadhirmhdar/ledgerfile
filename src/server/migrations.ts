import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { GROUPS } from "../domain/groups";
import type { Db } from "./db";

/**
 * The newest migration in db/migrations. A hosted start compares the database against this and refuses to run if they differ,
 * instead of reading the folder (which a serverless build may not ship). tests/migrations.test.ts fails when this falls behind.
 */
export const LATEST_MIGRATION = "0036_review_point_replies.sql";

export const migrationsDir = () => path.join(process.cwd(), "db", "migrations");

/** Apply every migration not yet recorded, each in its own transaction. With `lock`, concurrent runs wait for each other. */
export async function applyMigrations(db: Db, dir = migrationsDir(), options: { lock?: boolean } = {}): Promise<string[]> {
  await db.exec("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const done: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.transaction(async (tx) => {
      // One migrator at a time: the second waits here, then finds the file already recorded and skips it.
      if (options.lock) await tx.query("select pg_advisory_xact_lock(7482011)");
      const applied = await tx.query("select 1 from schema_migrations where name = $1", [file]);
      if (applied.rows.length > 0) return;
      await tx.exec(readFileSync(path.join(dir, file), "utf8"));
      await tx.query("insert into schema_migrations (name) values ($1)", [file]);
      done.push(file);
    });
  }
  return done;
}

/** The grouping structure is system content, kept in step with the code. Run at every migrate and, locally, at every start. */
export async function upsertGroups(db: Db): Promise<void> {
  for (const g of GROUPS) {
    await db.query(
      `insert into groups (code, name, statement, section, sort) values ($1, $2, $3, $4, $5)
       on conflict (code) do update set name = excluded.name, statement = excluded.statement, section = excluded.section, sort = excluded.sort`,
      [g.code, g.name, g.statement, g.section, g.sort],
    );
  }
}

/** Throws a clear error when the database is not at the migration this code expects. It never migrates. */
export async function assertSchemaCurrent(db: Db, latest = LATEST_MIGRATION): Promise<void> {
  let name: string | undefined;
  try {
    name = (await db.query<{ name: string }>("select name from schema_migrations order by name desc limit 1")).rows[0]?.name;
  } catch {
    throw new Error("The database has not been set up. Run `npm run db:migrate` against it, then redeploy.");
  }
  if (name !== latest) {
    throw new Error(`The database is at migration ${name ?? "none"} but this version needs ${latest}. Run \`npm run db:migrate\` before starting it.`);
  }
}
