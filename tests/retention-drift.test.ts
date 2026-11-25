import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase } from "../src/server/db";
import { LATEST_MIGRATION } from "../src/server/migrations";

let db: Db;
beforeAll(async () => {
  db = await openDatabase();
});
afterAll(async () => {
  await db.close();
});

/** Tables that are about the deletion itself and are kept on purpose: they have an engagement_id but no foreign key to the engagement. */
const KEPT = new Set(["retention_deletions", "retention_purges", "retention_files", "retention_file_removals"]);

/**
 * The guard against drift. purge_engagement() deletes an engagement's rows table by table, so a table added later that holds engagement data must be
 * added to it. This asks the database for every such table (a column called engagement_id, or a foreign key to engagements, or to any table that has
 * one, however deep) and fails, naming the table, when the function does not delete from it. A later migration that adds such a table has to update
 * the function in the same change, or this test fails.
 */
describe("purge_engagement and the tables that hold engagement data", () => {
  async function tablesHoldingEngagementData(): Promise<string[]> {
    const byColumn = await db.query<{ t: string }>("select table_name as t from information_schema.columns where table_schema = 'public' and column_name = 'engagement_id'");
    const byForeignKey = await db.query<{ t: string }>(
      `with recursive r(rel) as (
         select conrelid from pg_constraint where contype = 'f' and confrelid = 'engagements'::regclass and conrelid <> 'engagements'::regclass
         union
         select c.conrelid from pg_constraint c join r on c.confrelid = r.rel where c.contype = 'f' and c.conrelid <> c.confrelid
       ) select distinct rel::regclass::text as t from r`,
    );
    return [...new Set([...byColumn.rows, ...byForeignKey.rows].map((r) => r.t))].filter((t) => !KEPT.has(t)).sort();
  }
  const functionText = async (name: string) => (await db.query<{ def: string }>("select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1", [name])).rows[0].def;

  it("is the latest migration's, so a later migration cannot add a table without meeting this test", () => {
    expect(LATEST_MIGRATION >= "0034_retention.sql").toBe(true);
  });

  it("deletes from every table that holds engagement data", async () => {
    const tables = await tablesHoldingEngagementData();
    // Sanity: the survey finds the tables it should, so an empty result cannot pass this test by accident.
    expect(tables.length).toBeGreaterThanOrEqual(27);
    for (const t of ["accounts", "mappings", "journal_lines", "test_schedule_lines", "working_papers", "pending_uploads", "review_points", "sign_offs", "planning_answers"]) expect(tables).toContain(t);
    const def = await functionText("purge_engagement");
    const missing = tables.filter((t) => !new RegExp(`delete from ${t}\\b`).test(def));
    expect(missing, `purge_engagement does not delete from: ${missing.join(", ")}. Add them (children first) in the same migration that adds the table.`).toEqual([]);
  });

  it("deletes the engagement itself, last, and clears links to it", async () => {
    const def = await functionText("purge_engagement");
    expect(def).toMatch(/delete from engagements where id = p_engagement/);
    expect(def.lastIndexOf("delete from engagements")).toBeGreaterThan(def.lastIndexOf("delete from sign_offs"));
    expect(def).toMatch(/update engagements set prior_engagement_id = null/);
  });

  it("counts every table that has an engagement_id column", async () => {
    const withColumn = (await db.query<{ t: string }>("select table_name as t from information_schema.columns where table_schema = 'public' and column_name = 'engagement_id'")).rows.map((r) => r.t).filter((t) => !KEPT.has(t));
    const def = await functionText("retention_counts");
    const missing = withColumn.filter((t) => !new RegExp(`from ${t}\\b`).test(def));
    expect(missing, `retention_counts does not count: ${missing.join(", ")}`).toEqual([]);
  });

  it("is security definer, with a fixed search path, and not callable by everyone", async () => {
    const rows = (await db.query<{ proname: string; secdef: boolean; config: string[] | null; public_exec: boolean; app_exec: boolean }>(
      `select proname, prosecdef as secdef, proconfig as config,
              has_function_privilege('public', p.oid, 'execute') as public_exec, has_function_privilege('app_user', p.oid, 'execute') as app_exec
       from pg_proc p where proname in ('purge_engagement', 'retention_counts')`,
    )).rows;
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.secdef, r.proname).toBe(true);
      expect(r.config, r.proname).toContain("search_path=public");
      expect(r.app_exec, r.proname).toBe(true);
    }
  });

  it("keeps the deletion's own tables append-only for the application role", async () => {
    const grants = async (t: string) => (await db.query<{ p: string }>("select privilege_type as p from information_schema.role_table_grants where grantee = 'app_user' and table_name = $1 order by 1", [t])).rows.map((r) => r.p);
    expect(await grants("retention_deletions")).toEqual(["INSERT", "SELECT"]);
    expect(await grants("retention_purges")).toEqual(["SELECT"]);
    expect(await grants("retention_files")).toEqual(["SELECT"]);
    expect(await grants("retention_file_removals")).toEqual(["INSERT", "SELECT"]);
    const can = async (role: string) => (await db.query<{ ok: boolean }>("select has_column_privilege($1, 'firms', 'retention_years', 'UPDATE') as ok", [role])).rows[0].ok;
    // Only the administrator's sign-in role can set the period; the tenant role reads it.
    expect(await can("app_auth")).toBe(true);
    expect(await can("app_user")).toBe(false);
  });

  it("changes nothing at migration time: no firm has a period and no table has a row", async () => {
    expect((await db.query("select 1 from firms where retention_years is not null")).rows).toHaveLength(0);
    for (const t of ["retention_deletions", "retention_purges", "retention_files", "retention_file_removals"]) expect((await db.query(`select 1 from ${t}`)).rows, t).toHaveLength(0);
    const def = (await db.query<{ def: string }>("select pg_get_functiondef('engagements_archive_guard'::regproc) as def")).rows[0].def;
    // Every refusal the guard had before is still there, word for word.
    for (const words of ["This file is archived. Archived files cannot be deleted.", "This file is archived. Archived files cannot be unlocked or changed.", "A file can be archived only after it has been locked."]) expect(def).toContain(words);
  });
});
