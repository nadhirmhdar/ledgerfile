import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import * as ledger from "../src/server/ledger";
import type { LedgerLine } from "../src/domain/ledger-parse";

describe("journal testing on an engagement", () => {
  const FIRM = "aaaaaaaa-5555-4000-8000-000000000001";
  const OTHER = "bbbbbbbb-5555-4000-8000-000000000001";
  const user = (n: number, role: repo.Session["role"], firmId = FIRM): repo.Session => ({ firmId, userId: `${firmId.slice(0, 8)}-5555-4000-8000-00000000001${n}`, role });
  const prep = user(1, "preparer");
  const rev = user(2, "reviewer");
  const partner = user(3, "partner");
  const outsider = user(4, "partner", OTHER);
  const TB = [
    { code: "1000", name: "Bank - current account", closingMinor: 15000000, priorMinor: 10000000 },
    { code: "3000", name: "Share capital", closingMinor: -10000000, priorMinor: -10000000 },
    { code: "4000", name: "Sales", closingMinor: -9000000, priorMinor: -7000000 },
    { code: "6100", name: "Office rent", closingMinor: 4000000, priorMinor: 3000000 },
  ];
  let db: PGlite;
  let engagement: string;
  type T = Parameters<Parameters<typeof withFirm>[2]>[0];
  const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);

  const entry = (entryNo: string, date: string, debit: string, credit: string, amountMinor: number, description: string | null = "Routine", postedBy = "sara"): LedgerLine[] => [
    { entryNo, date, postedBy, description, accountCode: debit, accountName: null, amountMinor },
    { entryNo, date, postedBy, description, accountCode: credit, accountName: null, amountMinor: -amountMinor },
  ];
  // Bank moves 100,000 to 150,000; sales 90,000; rent 40,000: three routine sales and rents, plus two suspicious entries.
  const LISTING: LedgerLine[] = [
    ...entry("S1", "2025-02-12", "1000", "4000", 3000100),
    ...entry("S2", "2025-05-14", "1000", "4000", 2999900),
    ...entry("S3", "2025-09-10", "1000", "4000", 2987700),
    ...entry("R1", "2025-03-12", "6100", "1000", 1333300),
    ...entry("R2", "2025-06-11", "6100", "1000", 1333300),
    ...entry("R3", "2025-10-15", "6100", "1000", 1321100),
    // Revenue against an expense, at the period end, round, with no description, posted by the owner.
    ...entry("X1", "2025-12-31", "6100", "4000", 1000000, null, "owner"),
    ...entry("X2", "2025-12-30", "4000", "6100", 987700, "Reverse", "owner"),
  ];

  beforeAll(async () => {
    db = await openDatabase();
    for (const firm of [FIRM, OTHER]) await db.query("insert into firms (id, name) values ($1, $2)", [firm, "Firm"]);
    for (const u of [prep, rev, partner, outsider]) {
      await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-1)}`, u.role]);
    }
    await as(partner, async (tx) => {
      const client = await repo.createClient(tx, partner, "Ledger Co");
      engagement = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
      await repo.importTrialBalance(tx, partner, engagement, "tb.xlsx", TB);
      await repo.approveAllMappings(tx, partner, engagement);
    });
  });

  it("needs the audit to be on", async () => {
    await expect(as(prep, (tx) => ledger.importLedger(tx, prep, engagement, "gl.csv", LISTING))).rejects.toThrow(/Turn the audit on/);
    await as(rev, (tx) => audit.setAuditEnabled(tx, rev, engagement, true));
  });

  it("imports the listing, flags entries and reconciles every account", async () => {
    const result = await as(prep, (tx) => ledger.importLedger(tx, prep, engagement, "gl.csv", LISTING));
    expect(result).toEqual({ lines: 16, entries: 8, flagged: 2 });
    const o = (await as(prep, (tx) => ledger.getLedgerOverview(tx, engagement)))!;
    expect(o.listing).toMatchObject({ fileName: "gl.csv", lineCount: 16, entryCount: 8, importedBy: "preparer 1", from: "2025-02-12", to: "2025-12-31" });
    expect(o.users).toEqual(["owner", "sara"]);
    expect(o.reconciliation).toEqual({ agreed: 4, differences: [], unchecked: 0 });
    expect(o.entries.map((e) => [e.entryNo, e.flags])).toEqual([
      ["X1", ["period_end", "round", "no_description", "revenue_pair"]],
      ["X2", ["period_end", "revenue_pair"]],
    ]);
    expect(o.flagCounts).toMatchObject({ period_end: 2, revenue_pair: 2, round: 1, no_description: 1, weekend: 0 });
    expect(o.entries[0]).toMatchObject({ totalMinor: 1000000, lineCount: 2, postedBy: "owner", test: null });
  });

  it("filters by flag and by user, ignoring values that are not real flags or users", async () => {
    const by = (filter: { flag?: string; user?: string }) => as(prep, async (tx) => (await ledger.getLedgerOverview(tx, engagement, filter))!);
    expect((await by({ flag: "round" })).entries.map((e) => e.entryNo)).toEqual(["X1"]);
    // Filtering by user shows all of that user's entries, flagged or not.
    expect((await by({ user: "sara" })).matching).toBe(6);
    expect((await by({ user: "owner" })).entries.map((e) => e.entryNo)).toEqual(["X1", "X2"]);
    expect((await by({ flag: "%", user: "nobody; drop table ledger_lines" })).entries.map((e) => e.entryNo)).toEqual(["X1", "X2"]);
  });

  it("shows an entry's lines, debits first", async () => {
    const lines = await as(prep, (tx) => ledger.getEntryLines(tx, engagement, "X1"));
    expect(lines.map((l) => [l.accountCode, l.amountMinor])).toEqual([["6100", 1000000], ["4000", -1000000]]);
  });

  it("selects entries, holds up the lock until they are concluded, and records the test", async () => {
    await expect(as(prep, (tx) => ledger.selectForTesting(tx, prep, engagement, "NOPE"))).rejects.toThrow(/not in the journal listing/);
    await as(prep, (tx) => ledger.selectForTesting(tx, prep, engagement, "X1"));
    await as(prep, (tx) => ledger.selectForTesting(tx, prep, engagement, "X2"));
    await as(prep, (tx) => ledger.selectForTesting(tx, prep, engagement, "S1"));
    let o = (await as(prep, (tx) => ledger.getLedgerOverview(tx, engagement)))!;
    expect(o).toMatchObject({ selected: 3, tested: 0 });
    // A selected entry is listed even though it shows no flag.
    expect(o.entries.map((e) => e.entryNo).sort()).toEqual(["S1", "X1", "X2"]);
    const blockers = async () => (await as(prep, (tx) => audit.getAuditOverview(tx, engagement)))!.blockers;
    expect((await blockers()).some((b) => b.includes("3 journal entry(ies) selected for testing have no conclusion"))).toBe(true);

    await as(prep, (tx) => ledger.unselect(tx, prep, engagement, "S1"));
    await expect(as(prep, (tx) => ledger.recordJournalTest(tx, prep, engagement, "X1", { workDone: "", conclusion: "Fine" }))).rejects.toThrow(/support inspected/);
    await expect(as(prep, (tx) => ledger.recordJournalTest(tx, prep, engagement, "S2", { workDone: "Invoice seen.", conclusion: "Valid." }))).rejects.toThrow(/Select the entry/);
    await as(prep, (tx) => ledger.recordJournalTest(tx, prep, engagement, "X1", { workDone: "No support provided by management.", conclusion: "Unsupported: raised as a misstatement." }));
    await expect(as(prep, (tx) => ledger.unselect(tx, prep, engagement, "X1"))).rejects.toThrow(/has been tested/);
    // A recorded conclusion is not replaced.
    await expect(as(rev, (tx) => ledger.recordJournalTest(tx, rev, engagement, "X1", { workDone: "Second look.", conclusion: "Fine after all." }))).rejects.toThrow(/already been recorded/);

    o = (await as(prep, (tx) => ledger.getLedgerOverview(tx, engagement)))!;
    expect(o).toMatchObject({ selected: 2, tested: 1 });
    expect(o.entries.find((e) => e.entryNo === "X1")!.test).toMatchObject({ status: "tested", testedBy: "preparer 1", conclusion: expect.stringContaining("Unsupported") });
    expect((await blockers()).some((b) => b.includes("1 journal entry(ies) selected"))).toBe(true);
  });

  it("cannot be replaced, nor the audit turned off, once an entry has been tested", async () => {
    await expect(as(prep, (tx) => ledger.importLedger(tx, prep, engagement, "gl2.csv", LISTING))).rejects.toThrow(/cannot be replaced/);
    await expect(as(partner, (tx) => audit.setAuditEnabled(tx, partner, engagement, false))).rejects.toThrow(/cannot be turned off/);
  });

  it("shows differences when the listing is incomplete, and can be replaced before any testing", async () => {
    const second = await as(partner, async (tx) => {
      const [client] = await repo.listClients(tx);
      const id = await repo.createEngagement(tx, partner, client.id, "2026-01-01", "2026-12-31");
      await repo.importTrialBalance(tx, partner, id, "tb.xlsx", TB);
      await audit.setAuditEnabled(tx, partner, id, true);
      await ledger.importLedger(tx, partner, id, "partial.csv", entry("S1", "2026-02-12", "1000", "4000", 9000000));
      return id;
    });
    const o = (await as(prep, (tx) => ledger.getLedgerOverview(tx, second)))!;
    expect(o.reconciliation!.agreed).toBe(2);
    expect(o.reconciliation!.differences.map((d) => [d.code, d.differenceMinor])).toEqual([
      ["1000", 4000000],
      ["6100", -4000000],
    ]);
    // Replacing is allowed while nothing has been tested, and clears selections made on the old listing.
    await as(prep, (tx) => ledger.selectForTesting(tx, prep, second, "S1"));
    await as(prep, (tx) => ledger.importLedger(tx, prep, second, "full.csv", entry("S9", "2026-03-12", "1000", "4000", 9000000)));
    expect(await as(prep, (tx) => ledger.getLedgerOverview(tx, second))).toMatchObject({ selected: 0, listing: { fileName: "full.csv", entryCount: 1 } });
  });

  it("is invisible and closed to another firm, and frozen once locked", async () => {
    expect(await as(outsider, (tx) => ledger.getLedgerOverview(tx, engagement))).toBeNull();
    expect(await as(outsider, (tx) => ledger.getEntryLines(tx, engagement, "X1"))).toEqual([]);
    await expect(as(outsider, (tx) => ledger.selectForTesting(tx, outsider, engagement, "X2"))).rejects.toThrow(/not found/);
    await expect(as(outsider, (tx) => ledger.importLedger(tx, outsider, engagement, "x.csv", LISTING))).rejects.toThrow(/not found/);
    const seen = await as(outsider, async (tx) => (await tx.query("select id from ledger_lines")).rows.length + (await tx.query("select id from journal_tests")).rows.length);
    expect(seen).toBe(0);

    await db.query("update engagements set status = $2 where id = $1", [engagement, "locked"]);
    await expect(as(prep, (tx) => ledger.recordJournalTest(tx, prep, engagement, "X2", { workDone: "Late work.", conclusion: "Late." }))).rejects.toThrow(/locked/);
    await expect(as(prep, (tx) => ledger.selectForTesting(tx, prep, engagement, "S2"))).rejects.toThrow(/locked/);
  });
});
