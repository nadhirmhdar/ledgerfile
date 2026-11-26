import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import { readGrid } from "../src/server/excel";
import { parseTrialBalance } from "../src/domain/tb-parse";
import { getPriorYearChecks } from "../src/server/prior-year-checks";
import { severityOf } from "../src/domain/statements";

// The sample firm's two trial balances (invented), brought in the way the app brings in a file: 2024 first, then 2025 linked to it.
const FIRM = "cccccccc-7272-4000-8000-000000000001";
const partner: repo.Session = { firmId: FIRM, userId: "cccccccc-7272-4000-8000-000000000051", role: "partner" };

const load = (name: string) => {
  const buf = readFileSync(`samples/${name}`);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
};
const read = async (name: string) => {
  const parsed = parseTrialBalance(await readGrid(name, load(name)));
  expect(parsed.errors).toEqual([]);
  expect(parsed.balanced).toBe(true);
  return parsed.accounts.map((a) => ({ code: a.code, name: a.name, closingMinor: a.closingMinor, priorMinor: a.priorMinor ?? 0 }));
};

let db: Db;
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(fn: (tx: T) => Promise<R>) => withFirm(db, FIRM, fn);

beforeAll(async () => {
  db = await openDatabase();
  await db.query("insert into firms (id, name) values ($1, 'Falcon sample firm')", [FIRM]);
  await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, 'p@x.test', 'Partner', 'partner')", [partner.userId, FIRM]);
});
afterAll(async () => {
  await db.close();
});

describe("the sample seed passes the prior-year checks", () => {
  it("2025 comparatives agree to 2024, and opening retained earnings equal 2024's closing", async () => {
    const y2024 = await read("falcon-tb-2024.xlsx");
    const y2025 = await read("falcon-tb-2025.xlsx");
    const current = await as(async (tx) => {
      const client = await repo.createClient(tx, partner, "Falcon Trading LLC (sample data)");
      const prior = await repo.createEngagement(tx, partner, client, "2024-01-01", "2024-12-31");
      await repo.importTrialBalance(tx, partner, prior, "falcon-tb-2024.xlsx", y2024);
      await repo.approveAllMappings(tx, partner, prior);
      const id = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
      await repo.importTrialBalance(tx, partner, id, "falcon-tb-2025.xlsx", y2025);
      await repo.approveAllMappings(tx, partner, id);
      return id;
    });
    const r = await as((tx) => getPriorYearChecks(tx, FIRM, current));
    if (!r || !r.linked) throw new Error("expected a linked engagement");
    expect(r.checks.map((c) => c.passed)).toEqual([true, true]);
    expect(r.checks.every((c) => severityOf(c) === "warning")).toBe(true);
  });

  it("opens 2025 at 2024's closing balance, with the reserve unchanged and the dividend as the only other equity movement", async () => {
    const y2024 = await read("falcon-tb-2024.xlsx");
    const y2025 = await read("falcon-tb-2025.xlsx");
    const by = (rows: typeof y2025, code: string) => rows.find((a) => a.code === code);
    // 2024: retained earnings 11,519 debit plus a profit of 395,350 gives a closing credit of 383,831 (all in minor units).
    expect(by(y2024, "3200")?.closingMinor).toBe(1151900);
    expect(by(y2025, "3200")?.closingMinor).toBe(-38383100);
    // The 2025 Prior Year column is 2024's figures, line by line, so the comparatives check has nothing to warn about.
    for (const a of y2025) expect(a.priorMinor, a.code).toBe(by(y2024, a.code)?.closingMinor ?? 0);
    expect(by(y2025, "3100")?.closingMinor).toBe(by(y2024, "3100")?.closingMinor);
    expect(by(y2025, "3300")).toMatchObject({ name: "Dividends paid", closingMinor: 22958500, priorMinor: 0 });
  });
});
