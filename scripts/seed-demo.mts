// Loads the synthetic Falcon Trading sample into the local development database,
// through the same code the upload screen uses. Stop the dev server before running it.
import { readFileSync } from "node:fs";
import path from "node:path";
import { createFirm, DEV_FIRM_ID, DEV_USER_ID, openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import { readGrid } from "../src/server/excel";
import { parseTrialBalance } from "../src/domain/tb-parse";
import { setPassword } from "../src/server/auth";

// The demo administrator has a published default password, so this must never run against a real deployment.
if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed demo data when NODE_ENV is production.");
  process.exit(1);
}

const session = { firmId: DEV_FIRM_ID, userId: DEV_USER_ID, role: "admin" as const };

async function load(file: string) {
  const buf = readFileSync(path.join("samples", file));
  const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const parsed = parseTrialBalance(await readGrid(file, data));
  if (!parsed.balanced) throw new Error(`${file} did not parse cleanly: ${parsed.errors.join("; ")}`);
  return parsed.accounts;
}

const db = await openDatabase(path.join(process.cwd(), ".data", "pg"));
// Demo sign-in for local development only. Override the password with DEMO_PASSWORD; see .env.example.
const DEMO_EMAIL = "demo@ledgerfile.test";
await createFirm(db, { id: DEV_FIRM_ID, name: "Demo Audit Firm" }, { id: DEV_USER_ID, email: DEMO_EMAIL, name: "Demo Admin" });
const demoPassword = process.env.DEMO_PASSWORD ?? "ledgerfile-demo-only";
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

await withFirm(db, DEV_FIRM_ID, async (tx) => {
  if ((await repo.listClients(tx)).some((c) => c.name === "Falcon Trading LLC (sample)")) {
    console.log("Sample client already present; nothing to do.");
    return;
  }
  const client = await repo.createClient(tx, session, "Falcon Trading LLC (sample)");
  const e2024 = await repo.createEngagement(tx, session, client, "2024-01-01", "2024-12-31");
  console.log("2024:", await repo.importTrialBalance(tx, session, e2024, "falcon-tb-2024.xlsx", await load("falcon-tb-2024.xlsx")));
  await repo.approveAllMappings(tx, session, e2024);
  const e2025 = await repo.createEngagement(tx, session, client, "2025-01-01", "2025-12-31");
  console.log("2025:", await repo.importTrialBalance(tx, session, e2025, "falcon-tb-2025.xlsx", await load("falcon-tb-2025.xlsx")));
});
await db.close();
