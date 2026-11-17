// Seeds the invented sample firm into a HOSTED database, for a demo. Needs DATABASE_URL_MIGRATIONS (or DATABASE_URL) to reach an
// owner-level role, because creating a firm is not a tenant action. Passwords come from the environment, never from the code:
//   SAMPLE_ADMIN_PASSWORD, SAMPLE_PARTNER_PASSWORD, SAMPLE_REVIEWER_PASSWORD, SAMPLE_PREPARER_PASSWORD
// It refuses to run if any is missing, short, the public demo password, or repeated. Nothing it prints contains a password or a URL.
import { createPostgresDb } from "../src/server/pg-adapter";
import { createFirm, DEV_FIRM_ID, DEV_USER_ID } from "../src/server/db";
import { setPassword } from "../src/server/auth";
import { redact } from "../src/server/config";
import { SAMPLE_USERS, samplePasswordProblems } from "../src/server/sample-seed";
import { loadSampleClient } from "./seed-common";

const url = process.env.DATABASE_URL_MIGRATIONS?.trim() || process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("Set DATABASE_URL_MIGRATIONS (or DATABASE_URL) to the database to seed.");
  process.exit(1);
}
const problems = samplePasswordProblems();
if (problems.length > 0) {
  console.error(["Refusing to seed the sample firm:", ...problems.map((p) => `  - ${p}`)].join("\n"));
  process.exit(1);
}

const db = createPostgresDb(url, { max: 1 });
try {
  const [admin, ...others] = SAMPLE_USERS;
  await createFirm(db, { id: DEV_FIRM_ID, name: "Sample Audit Firm" }, { id: DEV_USER_ID, email: admin.email, name: admin.name });
  await setPassword(db, admin.id, process.env[admin.env]!);
  for (const u of others) {
    await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5) on conflict (id) do nothing", [u.id, DEV_FIRM_ID, u.email, u.name, u.role]);
    await setPassword(db, u.id, process.env[u.env]!);
  }
  console.log(`Sample sign-ins: ${SAMPLE_USERS.map((u) => u.email).join(", ")} (passwords from the SAMPLE_*_PASSWORD variables)`);
  await loadSampleClient(db);
} catch (e) {
  console.error("Seeding failed:", e instanceof Error ? redact(e.message) : "unknown error");
  process.exitCode = 1;
} finally {
  await db.close();
}
