// Loads the synthetic Falcon Trading sample into the local development database,
// through the same code the upload screen uses. Stop the dev server before running it.
import path from "node:path";
import { createFirm, DEV_FIRM_ID, DEV_USER_ID, openDatabase } from "../src/server/db";
import { setPassword } from "../src/server/auth";
import { isHosted, PUBLIC_DEMO_PASSWORD } from "../src/server/config";
import { loadSampleClient } from "./seed-common";

// The demo users share a published default password, so this must never run against a hosted database or a production build.
// Hosted means DATABASE_URL, LEDGERFILE_HOSTED=1 or VERCEL is set. For a hosted demo use `npm run seed:sample-hosted`.
if (process.env.NODE_ENV === "production" || isHosted()) {
  console.error("Refusing to seed demo users: this looks like a hosted or production environment. Use `npm run seed:sample-hosted` for a hosted demo.");
  process.exit(1);
}

const db = await openDatabase(path.join(process.cwd(), ".data", "pg"));
// Demo sign-in for local development only. Override the password with DEMO_PASSWORD; see .env.example.
const DEMO_EMAIL = "demo@ledgerfile.test";
await createFirm(db, { id: DEV_FIRM_ID, name: "Demo Audit Firm" }, { id: DEV_USER_ID, email: DEMO_EMAIL, name: "Demo Admin" });
const demoPassword = process.env.DEMO_PASSWORD ?? PUBLIC_DEMO_PASSWORD;
await setPassword(db, DEV_USER_ID, demoPassword);

// One test user for each of the other roles, so sign-off between different people can be tried.
const TEST_USERS = [
  { id: "00000000-0000-4000-8000-000000000003", email: "partner@ledgerfile.test", name: "Test Partner", role: "partner" },
  { id: "00000000-0000-4000-8000-000000000004", email: "reviewer@ledgerfile.test", name: "Test Reviewer", role: "reviewer" },
  { id: "00000000-0000-4000-8000-000000000005", email: "preparer@ledgerfile.test", name: "Test Preparer", role: "preparer" },
];
for (const u of TEST_USERS) {
  await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5) on conflict (id) do nothing", [u.id, DEV_FIRM_ID, u.email, u.name, u.role]);
  await setPassword(db, u.id, demoPassword);
}
console.log(`Demo sign-ins: ${[DEMO_EMAIL, ...TEST_USERS.map((u) => u.email)].join(", ")}`);
console.log("All four use the same password: DEMO_PASSWORD, or the default in .env.example");

await loadSampleClient(db);
await db.close();
