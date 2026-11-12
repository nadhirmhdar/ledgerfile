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

const session = { firmId: DEV_FIRM_ID, userId: DEV_USER_ID };

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
await setPassword(db, DEV_USER_ID, process.env.DEMO_PASSWORD ?? "ledgerfile-demo-only");
console.log(`Demo sign-in: ${DEMO_EMAIL} (password: DEMO_PASSWORD, or the default in .env.example)`);

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
