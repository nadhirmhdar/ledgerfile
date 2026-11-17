// The invented Falcon Trading sample, loaded through the same code the upload screen uses. Shared by the local demo seed and the hosted sample seed.
import { readFileSync } from "node:fs";
import path from "node:path";
import { DEV_FIRM_ID, DEV_USER_ID, withFirm, type Db } from "../src/server/db";
import * as repo from "../src/server/repo";
import { readGrid } from "../src/server/excel";
import { parseTrialBalance } from "../src/domain/tb-parse";

const session = { firmId: DEV_FIRM_ID, userId: DEV_USER_ID, role: "admin" as const };

async function load(file: string) {
  const buf = readFileSync(path.join("samples", file));
  const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const parsed = parseTrialBalance(await readGrid(file, data));
  if (!parsed.balanced) throw new Error(`${file} did not parse cleanly: ${parsed.errors.join("; ")}`);
  return parsed.accounts;
}

export async function loadSampleClient(db: Db): Promise<void> {
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
}
