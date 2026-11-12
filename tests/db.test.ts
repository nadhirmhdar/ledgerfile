import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createFirm, openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import { buildLeadSheets } from "../src/domain/leadsheet";

const FIRM_A = { firmId: "aaaaaaaa-0000-4000-8000-000000000001", userId: "aaaaaaaa-0000-4000-8000-000000000002" };
const FIRM_B = { firmId: "bbbbbbbb-0000-4000-8000-000000000001", userId: "bbbbbbbb-0000-4000-8000-000000000002" };

const TB_2024 = [
  { code: "1000", name: "Bank - current account", closingMinor: 4000000, priorMinor: null },
  { code: "1100", name: "Trade receivables", closingMinor: 2500000, priorMinor: null },
  { code: "2000", name: "Trade payables", closingMinor: -1800000, priorMinor: null },
  { code: "3000", name: "Share capital", closingMinor: -4700000, priorMinor: null },
];
const TB_2025 = [
  { code: "1000", name: "Bank - current account", closingMinor: 5000000, priorMinor: 4000000 },
  { code: "1100", name: "Trade receivables", closingMinor: 3000000, priorMinor: 2500000 },
  { code: "2000", name: "Trade payables", closingMinor: -2000000, priorMinor: -1800000 },
  { code: "3000", name: "Share capital", closingMinor: -4700000, priorMinor: -4700000 },
  { code: "3900", name: "Zzz new account", closingMinor: -1300000, priorMinor: null },
];

let db: PGlite;
let clientA: string;
let engagement2024: string;
let engagement2025: string;

beforeAll(async () => {
  db = await openDatabase();
  await createFirm(db, { id: FIRM_A.firmId, name: "Firm A" }, { id: FIRM_A.userId, email: "a@a.test", name: "A" });
  await createFirm(db, { id: FIRM_B.firmId, name: "Firm B" }, { id: FIRM_B.userId, email: "b@b.test", name: "B" });
  await withFirm(db, FIRM_A.firmId, async (tx) => {
    clientA = await repo.createClient(tx, FIRM_A, "Alpha Trading LLC");
    engagement2024 = await repo.createEngagement(tx, FIRM_A, clientA, "2024-01-01", "2024-12-31");
  });
});

describe("trial balance import and mapping", () => {
  it("imports, suggests by rule, and leaves suggestions unapproved", async () => {
    const result = await withFirm(db, FIRM_A.firmId, (tx) => repo.importTrialBalance(tx, FIRM_A, engagement2024, "tb2024.xlsx", TB_2024));
    expect(result).toEqual({ imported: 4, carriedForward: 0, suggested: 4, unmapped: 0 });
    const accounts = await withFirm(db, FIRM_A.firmId, (tx) => repo.listAccounts(tx, engagement2024));
    expect(accounts.map((a) => a.groupCode)).toEqual(["CASH", "TRADEREC", "TRADEPAY", "CAPITAL"]);
    expect(accounts.every((a) => a.source === "rule" && !a.approved)).toBe(true);
    expect(accounts[0].closingMinor).toBe(4000000);
  });

  it("records a manual change and approves the rest", async () => {
    await withFirm(db, FIRM_A.firmId, async (tx) => {
      const accounts = await repo.listAccounts(tx, engagement2024);
      await repo.setMapping(tx, FIRM_A, accounts[0].id, "INVEST");
      expect(await repo.approveAllMappings(tx, FIRM_A, engagement2024)).toBe(3);
    });
    const accounts = await withFirm(db, FIRM_A.firmId, (tx) => repo.listAccounts(tx, engagement2024));
    expect(accounts[0]).toMatchObject({ groupCode: "INVEST", source: "manual", approved: true });
  });

  it("carries last year's mapping into the next engagement", async () => {
    const result = await withFirm(db, FIRM_A.firmId, async (tx) => {
      engagement2025 = await repo.createEngagement(tx, FIRM_A, clientA, "2025-01-01", "2025-12-31");
      expect((await repo.getEngagement(tx, engagement2025))?.priorEngagementId).toBe(engagement2024);
      return repo.importTrialBalance(tx, FIRM_A, engagement2025, "tb2025.xlsx", TB_2025);
    });
    expect(result).toEqual({ imported: 5, carriedForward: 4, suggested: 0, unmapped: 1 });
    const accounts = await withFirm(db, FIRM_A.firmId, (tx) => repo.listAccounts(tx, engagement2025));
    // The bank account keeps the manual choice made last year, not the rule's suggestion.
    expect(accounts[0]).toMatchObject({ code: "1000", groupCode: "INVEST", source: "prior_year", approved: true });
    expect(accounts[4].groupCode).toBeNull();
  });

  it("keeps the preparer's mapping when a corrected file is re-imported", async () => {
    await withFirm(db, FIRM_A.firmId, async (tx) => {
      const accounts = await repo.listAccounts(tx, engagement2025);
      await repo.setMapping(tx, FIRM_A, accounts[4].id, "RETAINED");
    });
    const corrected = TB_2025.map((a) => (a.code === "1000" ? { ...a, closingMinor: 5000100 } : a.code === "3900" ? { ...a, closingMinor: -1300100 } : a));
    const result = await withFirm(db, FIRM_A.firmId, (tx) => repo.importTrialBalance(tx, FIRM_A, engagement2025, "tb2025-v2.xlsx", corrected));
    expect(result.unmapped).toBe(0);
    const accounts = await withFirm(db, FIRM_A.firmId, (tx) => repo.listAccounts(tx, engagement2025));
    expect(accounts[4]).toMatchObject({ groupCode: "RETAINED", source: "manual", closingMinor: -1300100 });
    const set = buildLeadSheets(accounts);
    expect(set.tiesToTrialBalance).toBe(true);
    expect(set.totalMinor).toBe(0);
  });
});

describe("tenant isolation", () => {
  it("runs application queries as a non-owner role", async () => {
    const who = await withFirm(db, FIRM_A.firmId, async (tx) => (await tx.query<{ u: string }>("select current_user as u")).rows[0].u);
    expect(who).toBe("app_user");
  });

  it("hides one firm's data from another", async () => {
    const seen = await withFirm(db, FIRM_B.firmId, async (tx) => ({
      clients: await repo.listClients(tx),
      engagements: await repo.listEngagements(tx),
      byId: await repo.getEngagement(tx, engagement2025),
      accounts: await repo.listAccounts(tx, engagement2025),
      firms: (await tx.query("select id from firms")).rows.length,
      log: (await tx.query("select id from audit_log")).rows.length,
    }));
    expect(seen).toEqual({ clients: [], engagements: [], byId: null, accounts: [], firms: 1, log: 0 });
  });

  it("blocks writing into another firm", async () => {
    await expect(
      withFirm(db, FIRM_B.firmId, (tx) => tx.query("insert into clients (firm_id, name) values ($1, 'Planted')", [FIRM_A.firmId])),
    ).rejects.toThrow(/row-level security/);
    await expect(
      withFirm(db, FIRM_B.firmId, (tx) => repo.importTrialBalance(tx, FIRM_B, engagement2025, "x.xlsx", TB_2024)),
    ).rejects.toThrow(/not found/);
  });

  it("cannot update or delete another firm's rows", async () => {
    const touched = await withFirm(db, FIRM_B.firmId, async (tx) => {
      const u = await tx.query("update clients set name = 'Hijacked' returning id");
      const d = await tx.query("delete from accounts returning id");
      return u.rows.length + d.rows.length;
    });
    expect(touched).toBe(0);
    const names = await withFirm(db, FIRM_A.firmId, async (tx) => (await repo.listClients(tx)).map((c) => c.name));
    expect(names).toEqual(["Alpha Trading LLC"]);
  });

  it("keeps the audit log append-only and the groups read-only", async () => {
    await expect(withFirm(db, FIRM_A.firmId, (tx) => tx.query("delete from audit_log"))).rejects.toThrow(/permission denied/);
    await expect(withFirm(db, FIRM_A.firmId, (tx) => tx.query("update groups set name = 'x'"))).rejects.toThrow(/permission denied/);
  });

  it("sees nothing when no firm is set", async () => {
    const count = await db.transaction(async (tx) => {
      await tx.exec("set local role app_user");
      return (await tx.query("select id from clients")).rows.length;
    });
    expect(count).toBe(0);
  });
});

describe("review safeguards", () => {
  it("does not carry forward a suggestion nobody approved", async () => {
    const accounts = await withFirm(db, FIRM_A.firmId, async (tx) => {
      const client = await repo.createClient(tx, FIRM_A, "Beta Services LLC");
      const first = await repo.createEngagement(tx, FIRM_A, client, "2030-01-01", "2030-12-31");
      await repo.importTrialBalance(tx, FIRM_A, first, "y1.xlsx", TB_2024);
      // Year 1: only the receivables mapping is reviewed; the other suggestions are left unapproved.
      const y1 = await repo.listAccounts(tx, first);
      await repo.setMapping(tx, FIRM_A, y1[1].id, "RPREC");
      const second = await repo.createEngagement(tx, FIRM_A, client, "2031-01-01", "2031-12-31");
      // Year 2 uses names the rules cannot match, so any mapping present came from year 1.
      const renamed = TB_2024.map((a) => ({ ...a, name: `Qwerty ${a.code}` }));
      const result = await repo.importTrialBalance(tx, FIRM_A, second, "y2.xlsx", renamed);
      expect(result).toEqual({ imported: 4, carriedForward: 1, suggested: 0, unmapped: 3 });
      return repo.listAccounts(tx, second);
    });
    expect(accounts.map((a) => a.groupCode)).toEqual([null, "RPREC", null, null]);
  });

  it("refuses to attach one firm's records to another firm's client or engagement", async () => {
    await expect(
      withFirm(db, FIRM_B.firmId, (tx) => repo.createEngagement(tx, FIRM_B, clientA, "2026-01-01", "2026-12-31")),
    ).rejects.toThrow(/Client not found/);
    // Even bypassing the application check, the database rejects the cross-firm reference.
    await expect(
      withFirm(db, FIRM_B.firmId, (tx) =>
        tx.query("insert into engagements (firm_id, client_id, period_start, period_end) values ($1, $2, '2026-01-01', '2026-12-31')", [
          FIRM_B.firmId,
          clientA,
        ]),
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(
      withFirm(db, FIRM_B.firmId, (tx) =>
        tx.query("insert into tb_imports (firm_id, engagement_id, file_name, row_count) values ($1, $2, 'x', 0)", [FIRM_B.firmId, engagement2025]),
      ),
    ).rejects.toThrow(/foreign key/);
  });
});

describe("locked engagements", () => {
  it("refuse mapping changes and approvals", async () => {
    await db.query("update engagements set status = 'locked' where id = $1", [engagement2024]);
    await expect(
      withFirm(db, FIRM_A.firmId, async (tx) => {
        const accounts = await repo.listAccounts(tx, engagement2024);
        await repo.setMapping(tx, FIRM_A, accounts[0].id, "CASH");
      }),
    ).rejects.toThrow(/locked/);
    await expect(withFirm(db, FIRM_A.firmId, (tx) => repo.approveAllMappings(tx, FIRM_A, engagement2024))).rejects.toThrow(/locked/);
  });
});

describe("borrowings split", () => {
  it("stores the current portion, rejects bad amounts, and is hidden from other firms", async () => {
    await withFirm(db, FIRM_A.firmId, (tx) => repo.setBorrowingsCurrent(tx, FIRM_A, engagement2025, 600000, 0));
    const e = await withFirm(db, FIRM_A.firmId, (tx) => repo.getEngagement(tx, engagement2025));
    expect(e).toMatchObject({ borrowingsCurrentMinor: 600000, borrowingsCurrentPriorMinor: 0 });
    await expect(withFirm(db, FIRM_A.firmId, (tx) => repo.setBorrowingsCurrent(tx, FIRM_A, engagement2025, -1, 0))).rejects.toThrow(/positive/);
    await expect(withFirm(db, FIRM_A.firmId, (tx) => repo.setBorrowingsCurrent(tx, FIRM_A, engagement2024, 1, 0))).rejects.toThrow(/locked/);
    await expect(withFirm(db, FIRM_B.firmId, (tx) => repo.setBorrowingsCurrent(tx, FIRM_B, engagement2025, 1, 0))).rejects.toThrow(/not found/);
  });
});
