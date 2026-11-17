// One command to prepare a hosted database, with no psql: migrate, create or update the runtime role, optionally seed the sample firm.
//   npm run db:setup-hosted
// It reads Vercel's injected variables (or a file pulled with `vercel env pull .env.local`, which is git-ignored) and LEDGERFILE_APP_PASSWORD.
// Every step is safe to repeat. It prints step names and outcomes only: never a password, URL, host or token. Any failure exits non-zero.
import { createPostgresDb } from "../src/server/pg-adapter";
import { createFirm, DEV_FIRM_ID, DEV_USER_ID } from "../src/server/db";
import { setPassword } from "../src/server/auth";
import { appPasswordProblems, assertSecureUrl, databaseUrl, migrationUrl, redact } from "../src/server/config";
import { ensureAppRole, ensureSetupRoleCanSwitch, verifyRuntimeConnection } from "../src/server/hosted-setup";
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

  await ensureSetupRoleCanSwitch(db);
  console.log("1b. Setup role can switch to app_user and app_auth: ok");

  const secret = process.env.LEDGERFILE_APP_PASSWORD!;
  const { created, usedPlaintext } = await ensureAppRole(db, { verifier: scramVerifier(secret), plaintext: secret });
  console.log(`2. Runtime role: ${created ? "created" : "updated"}${usedPlaintext ? " (this database takes only a plaintext password, so it was sent as one)" : ""}`);

  // The runtime connection, as the app will make it: the pooled host, as ledgerfile_app. A new role can take a moment to be accepted by a pooler.
  const runtimeUrl = databaseUrl();
  if (runtimeUrl) {
    let last: unknown;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const runtime = createPostgresDb(runtimeUrl, { max: 1 });
      try {
        await verifyRuntimeConnection(runtime);
        last = undefined;
        break;
      } catch (e) {
        last = e;
        await new Promise((r) => setTimeout(r, 2000));
      } finally {
        await runtime.close().catch(() => undefined);
      }
    }
    if (last) throw last;
    console.log("2b. Runtime login through the runtime connection: ok");
  } else {
    console.log("2b. Runtime login: skipped (no runtime connection is configured)");
  }

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
  // Postgres adds a SQLSTATE code and, on permission errors, a DETAIL line (for example which option or attribute is missing). They name
  // roles and options, never secrets; they go through redact() all the same.
  const field = (k: string) => (e && typeof e === "object" && k in e && typeof (e as Record<string, unknown>)[k] === "string" ? redact((e as Record<string, string>)[k]) : "");
  const code = field("code");
  const detail = field("detail");
  const message = e instanceof Error ? redact(e.message) : "unknown error";
  // The code is not repeated when the message already carries it.
  console.error("Setup failed:", message, code && !message.includes(`[${code}]`) ? `[${code}]` : "", detail ? `(${detail})` : "");
  process.exitCode = 1;
} finally {
  await db.close();
}
