/**
 * Which test files the CI `postgres` job runs, in one place. It runs the `check` job's suite only for the files that use a database, against a real
 * PostgreSQL server; everything else behaves the same there as on the embedded database and is not run twice. `tests/db-test-list.test.ts` fails when
 * a test file opens a database and is not covered here, so a new database test cannot be left out by mistake.
 *
 * Run as a script (`npx tsx tests/db-test-files.ts`) it prints the files, for the workflow.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Covered by their name. */
const BY_NAME = /-db\.test\.tsx?$/;

/** Covered by being listed: database, migration, retention and runtime-role tests whose names do not end in -db. */
export const ALSO = [
  "attention-badge.test.tsx",
  "audit.test.ts",
  "auth.test.ts",
  "branding-outputs.test.ts",
  "bulk-rollforward.test.tsx",
  "client-details.test.ts",
  "client-duplicate.test.ts",
  "client-import.test.ts",
  "config.test.ts",
  "db.test.ts",
  "dev-guard.test.ts",
  "firm-logo-route.test.ts",
  "hosted-safety.test.ts",
  "leadsheet-export.test.ts",
  "migrations.test.ts",
  "neon-diagnostics.test.ts",
  "neon-role.test.ts",
  "pdf-routes.test.ts",
  "pg-types.test.ts",
  "postgres-runtime.test.ts",
  "procedure-review.test.ts",
  "retention-drift.test.ts",
  "retention-page.test.tsx",
  "review.test.ts",
  "risk-approval.test.ts",
  "runtime-url.test.ts",
  "schedule-export.test.ts",
  "scram-and-role.test.ts",
  "self-review.test.ts",
  "signup-switch.test.ts",
  "statements.test.ts",
  "tb-preview.test.ts",
  "tb-template.test.ts",
  "working-papers.test.ts",
];

/** Mentions the words below only in its own examples: it opens nothing. */
const NOT_DATABASE = ["db-test-list.test.ts"];

/** What opening (or aiming at) a database looks like in a test. */
export const OPENS_DATABASE = /\b(openDatabase|openTestPostgres|createPostgresDb|createPool|PGlite|getDb)\b|TEST_(RUNTIME_)?DATABASE_URL|@electric-sql\/pglite/;

const isTest = (name: string) => /\.test\.tsx?$/.test(name);

/** The test files of a directory that the postgres job runs. */
export function postgresTestFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => isTest(f) && (BY_NAME.test(f) || ALSO.includes(f)))
    .sort();
}

/** Whether a test file opens a database itself, or through a helper beside it that does. */
export function opensDatabase(dir: string, file: string): boolean {
  const source = readFileSync(path.join(dir, file), "utf8");
  if (OPENS_DATABASE.test(source)) return true;
  for (const m of source.matchAll(/from\s+["']\.\/([^"']+)["']/g)) {
    for (const candidate of [`${m[1]}.ts`, `${m[1]}.tsx`]) {
      const helper = path.join(dir, candidate);
      if (!isTest(candidate) && candidate !== "db-test-files.ts" && existsSync(helper) && OPENS_DATABASE.test(readFileSync(helper, "utf8"))) return true;
    }
  }
  return false;
}

/** Test files that open a database but that the postgres job would not run. Must be empty. */
export function missingFromList(dir: string): string[] {
  const covered = new Set(postgresTestFiles(dir));
  return readdirSync(dir)
    .filter((f) => isTest(f) && !NOT_DATABASE.includes(f) && !covered.has(f) && opensDatabase(dir, f))
    .sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(postgresTestFiles(path.dirname(process.argv[1])).map((f) => `tests/${f}`).join(" "));
}
