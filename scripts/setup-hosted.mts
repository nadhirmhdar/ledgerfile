// One command to prepare a hosted database, with no psql: migrate, create or update the runtime role, optionally seed the sample firm.
//   npm run db:setup-hosted
// It reads Vercel's injected variables (or a file pulled with `vercel env pull .env.local`, which is git-ignored) and LEDGERFILE_APP_PASSWORD.
// Every step is safe to repeat. It prints step names and outcomes only: never a password, URL, host or token. Any failure exits non-zero.
import { createPostgresDb } from "../src/server/pg-adapter";
import { createFirm, DEV_FIRM_ID, DEV_USER_ID } from "../src/server/db";
import { setPassword } from "../src/server/auth";
import { appPasswordProblems, assertSecureUrl, migrationUrl, redact } from "../src/server/config";
import { ensureAppRole } from "../src/server/hosted-setup";
import { applyMigrations, upsertGroups } from "../src/server/migrations";
import { SAMPLE_USERS, samplePasswordProblems } from "../src/server/sample-seed";
import { scramVerifier } from "../src/server/scram";
import { loadSampleClient } from "./seed-common";

function stop(lines: string[]): never {
  console.error(lines.join("\n"));
  process.exit(1);
}

const url = migrationUrl();
if (!url) stop(["Set the direct owner connection: DATABASE_URL_UNPOOLED (injected by the Neon integration) or DATABASE_URL_MIGRATIONS."]);
try {
  assertSecureUrl(url, "The direct connection");
} catch (e) {
  stop([e instanceof Error ? e.message : "The direct connection is not usable."]);
}
const passwordProblems = appPasswordProblems();
if (passwordProblems.length > 0) stop(["Refusing to set up the runtime role:", ...passwordProblems.map((p) => `  - ${p}`)]);

const sampleSet = SAMPLE_USERS.every((u) => !!process.env[u.env]);
const db = createPostgresDb(url, { max: 1 });
try {
  const done = await applyMigrations(db, undefined, { lock: true });
  await upsertGroups(db);
  console.log(`1. Migrations: ${done.length === 0 ? "up to date" : `applied ${done.length}`}`);

  const { created } = await ensureAppRole(db, scramVerifier(process.env.LEDGERFILE_APP_PASSWORD!));
  console.log(`2. Runtime role: ${created ? "created" : "updated"}`);

  if (!sampleSet) {
    console.log("3. Sample firm: skipped (the four SAMPLE_*_PASSWORD variables are not all set)");
  } else {
    const problems = samplePasswordProblems();
    if (problems.length > 0) stop(["3. Sample firm: refused", ...problems.map((p) => `  - ${p}`)]);
    const [admin, ...others] = SAMPLE_USERS;
    await createFirm(db, { id: DEV_FIRM_ID, name: "Sample Audit Firm" }, { id: DEV_USER_ID, email: admin.email, name: admin.name });
    await setPassword(db, admin.id, process.env[admin.env]!);
    for (const u of others) {
      await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5) on conflict (id) do nothing", [u.id, DEV_FIRM_ID, u.email, u.name, u.role]);
      await setPassword(db, u.id, process.env[u.env]!);
    }
    await loadSampleClient(db);
    console.log("3. Sample firm: seeded");
  }
} catch (e) {
  console.error("Setup failed:", e instanceof Error ? redact(e.message) : "unknown error");
  process.exitCode = 1;
} finally {
  await db.close();
}
