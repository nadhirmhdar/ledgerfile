import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as review from "../src/server/review";
import { buildStatementPack, CASH_FLOW_CHECK_LABEL, EQUITY_CHECK_LABEL } from "../src/domain/statement-pack";

// Invented firm and people.
const FIRM = "eeeeeeee-8181-4000-8000-000000000001";
const user = (n: number, role: review.Actor["role"]): review.Actor => ({ firmId: FIRM, userId: `eeeeeeee-8181-4000-8000-00000000001${n}`, role });
const prep = user(1, "preparer");
const rev = user(2, "reviewer");
const partner = user(3, "partner");

/** Balanced in both years: the cash flow and the equity statement agree. */
const BALANCED = [
  { code: "1000", name: "Bank - current account", closingMinor: 700000, priorMinor: 500000 },
  { code: "1100", name: "Trade receivables", closingMinor: 300000, priorMinor: 200000 },
  { code: "3000", name: "Share capital", closingMinor: -500000, priorMinor: -500000 },
  { code: "3200", name: "Retained earnings", closingMinor: -200000, priorMinor: -100000 },
  { code: "4000", name: "Sales", closingMinor: -900000, priorMinor: -600000 },
  { code: "5000", name: "Cost of sales", closingMinor: 600000, priorMinor: 500000 },
];
/** Last year's column does not add to zero, so the cash flow and equity statements cannot agree. */
const PRIOR_OUT = BALANCED.map((a) => (a.code === "1100" ? { ...a, priorMinor: 0 } : a));

let db: Db;
const as = <T,>(actor: review.Actor, fn: (tx: Parameters<Parameters<typeof withFirm>[2]>[0]) => Promise<T>) => withFirm(db, FIRM, fn);

async function engagementWith(name: string, tb: typeof BALANCED): Promise<string> {
  return as(prep, async (tx) => {
    const client = await repo.createClient(tx, partner, name);
    const id = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
    await repo.importTrialBalance(tx, prep, id, "tb.xlsx", tb);
    await repo.approveAllMappings(tx, prep, id);
    return id;
  });
}
async function signEverything(id: string) {
  const sheets = (await as(prep, (tx) => review.getOverview(tx, id)))!.leadSheets;
  for (const s of sheets) {
    await as(prep, (tx) => review.signOff(tx, prep, id, s.groupCode, "preparer"));
    await as(rev, (tx) => review.signOff(tx, rev, id, s.groupCode, "reviewer"));
  }
}

beforeAll(async () => {
  db = await openDatabase();
  await db.query("insert into firms (id, name) values ($1, 'Lock Firm')", [FIRM]);
  for (const u of [prep, rev, partner]) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, FIRM, `${u.userId}@x.test`, `${u.role} user`, u.role]);
});
afterAll(async () => {
  await db.close();
});

describe("the cash flow and equity checks stop a lock", () => {
  it("a normal pack passes both, and the file locks", async () => {
    const id = await engagementWith("Lock Normal Co", BALANCED);
    const accounts = (await as(prep, (tx) => repo.listAccounts(tx, id))).map((a) => ({ ...a, closingMinor: a.closingMinor + a.adjustmentMinor }));
    const pack = buildStatementPack(accounts);
    expect(pack.checks.find((c) => c.label === CASH_FLOW_CHECK_LABEL)?.passed).toBe(true);
    expect(pack.checks.find((c) => c.label === EQUITY_CHECK_LABEL)?.passed).toBe(true);
    await signEverything(id);
    // The placeholder warning is open on the generated notes, and does not stop the lock.
    expect(pack.checks.some((c) => !c.passed && c.severity === "warning")).toBe(true);
    expect((await as(prep, (tx) => review.getOverview(tx, id)))!.readiness).toEqual({ ready: true, blockers: [] });
    await as(partner, (tx) => review.lockEngagement(tx, partner, id));
    expect((await as(prep, (tx) => review.getOverview(tx, id)))!.status).toBe("locked");
  });

  it("a file whose cash flow does not agree cannot be locked, and the blocker names the check (the equity check is covered with a forced failure in statement-checks.test.ts)", async () => {
    const id = await engagementWith("Lock Forced Co", PRIOR_OUT);
    const accounts = (await as(prep, (tx) => repo.listAccounts(tx, id))).map((a) => ({ ...a, closingMinor: a.closingMinor + a.adjustmentMinor }));
    const failed = buildStatementPack(accounts).checks.filter((c) => !c.passed && c.severity === undefined).map((c) => c.label);
    expect(failed).toContain(CASH_FLOW_CHECK_LABEL);
    await signEverything(id);
    const readiness = (await as(prep, (tx) => review.getOverview(tx, id)))!.readiness;
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toContain(`Statement check failed: ${CASH_FLOW_CHECK_LABEL}.`);
    await expect(as(partner, (tx) => review.lockEngagement(tx, partner, id))).rejects.toThrow(/not ready to lock/);
  });
});
