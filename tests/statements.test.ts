import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createFirm, openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as journals from "../src/server/journals";
import { validateJournal } from "../src/domain/journal";
import { buildStatements, type StatementAccount } from "../src/domain/statements";

const acct = (groupCode: string | null, closingMinor: number, priorMinor: number | null = null, approved = true): StatementAccount => ({
  groupCode,
  closingMinor,
  priorMinor,
  approved,
});

// Debit positive, credit negative. Current-year profit: 1,000 - 600 - 150 - 50 = 200.
const BOOKS: StatementAccount[] = [
  acct("PPE", 50000, 40000),
  acct("CASH", 70000, 30000),
  acct("TRADEREC", 30000, 20000),
  acct("TRADEPAY", -40000, -30000),
  acct("BORROW", -20000, -20000),
  acct("CAPITAL", -50000, -50000),
  acct("RETAINED", -20000, 20000),
  acct("REVENUE", -100000, -80000),
  acct("COS", 60000, 50000),
  acct("STAFF", 15000, 15000),
  acct("TAXEXP", 5000, 5000),
];

describe("journal validation", () => {
  it("accepts a balanced entry", () => {
    expect(validateJournal("Accrue audit fee", [{ accountId: "a", amountMinor: 500 }, { accountId: "b", amountMinor: -500 }])).toEqual([]);
  });
  it("rejects unbalanced, single-line, zero and undescribed entries", () => {
    expect(validateJournal("Accrual", [{ accountId: "a", amountMinor: 500 }, { accountId: "b", amountMinor: -400 }]).join(" ")).toContain("differ by 1.00");
    expect(validateJournal("Accrual", [{ accountId: "a", amountMinor: 500 }]).join(" ")).toContain("at least two lines");
    expect(validateJournal("Accrual", [{ accountId: "a", amountMinor: 0 }, { accountId: "b", amountMinor: 0 }]).join(" ")).toContain("debit or a credit");
    expect(validateJournal(" ", [{ accountId: "a", amountMinor: 1 }, { accountId: "b", amountMinor: -1 }]).join(" ")).toContain("description");
  });
});

describe("financial statements", () => {
  const s = buildStatements(BOOKS);
  const sci = (key: string) => s.comprehensiveIncome.find((l) => l.key === key)!;
  const sfp = (key: string) => s.financialPosition.flatMap((sec) => sec.lines).find((l) => l.key === key)!;

  it("builds the income statement in presentation sign", () => {
    expect(sci("REVENUE").current).toBe(100000);
    expect(sci("COS").current).toBe(60000);
    expect(sci("GROSS").current).toBe(40000);
    expect(sci("PBT").current).toBe(25000);
    expect(sci("PROFIT").current).toBe(20000);
    expect(sci("PROFIT").prior).toBe(10000);
  });

  it("balances the statement of financial position, with the year's result in equity", () => {
    expect(sfp("TOTAL_ASSETS").current).toBe(150000);
    expect(sfp("RESULT").current).toBe(20000);
    expect(sfp("TOTAL_EQUITY").current).toBe(90000);
    expect(sfp("TOTAL_LIABILITIES").current).toBe(60000);
    expect(sfp("TOTAL_EL").current).toBe(150000);
    expect(sfp("TOTAL_ASSETS").prior).toBe(sfp("TOTAL_EL").prior);
    expect(s.clean).toBe(true);
    expect(s.hasComparatives).toBe(true);
  });

  it("shows the current portion of borrowings under current liabilities", () => {
    const split = buildStatements(BOOKS, { borrowingsCurrent: { current: 5000, prior: 20000 } });
    const lines = split.financialPosition.flatMap((sec) => sec.lines);
    const find = (key: string) => lines.find((l) => l.key === key)!;
    expect(find("BORROW_CUR")).toMatchObject({ current: 5000, prior: 20000, label: "Borrowings: current portion" });
    expect(find("BORROW")).toMatchObject({ current: 15000, prior: 0 });
    expect(find("T:Current liabilities").current).toBe(45000);
    expect(find("T:Non-current liabilities").current).toBe(15000);
    // Only the presentation moves: totals and the balance are unchanged.
    expect(find("TOTAL_LIABILITIES").current).toBe(60000);
    expect(find("TOTAL_EL").current).toBe(find("TOTAL_ASSETS").current);
    expect(split.clean).toBe(true);
    const sections = split.financialPosition.map((x) => x.title);
    expect(sections.indexOf("Current liabilities")).toBeGreaterThan(sections.indexOf("Non-current liabilities"));

    // When everything is current, the non-current line disappears.
    const allCurrent = buildStatements(BOOKS, { borrowingsCurrent: { current: 20000, prior: 20000 } });
    expect(allCurrent.financialPosition.flatMap((sec) => sec.lines).some((l) => l.key === "BORROW")).toBe(false);

    const tooMuch = buildStatements(BOOKS, { borrowingsCurrent: { current: 25000, prior: 0 } });
    expect(tooMuch.checks.find((c) => c.label.includes("Current portion"))?.passed).toBe(false);
    expect(tooMuch.clean).toBe(false);
    expect(s.checks.some((c) => c.label.includes("Current portion"))).toBe(false);
  });

  it("omits groups with no balance in either year", () => {
    expect(s.comprehensiveIncome.some((l) => l.key === "OTHERINC")).toBe(false);
    expect(s.financialPosition.flatMap((sec) => sec.lines).some((l) => l.key === "INVENT")).toBe(false);
  });

  it("leaves an empty section off the statement but keeps the totals", () => {
    const noNonCurrent = buildStatements(BOOKS.filter((a) => a.groupCode !== "PPE" && a.groupCode !== "BORROW").concat(acct("CASH", 30000, 20000)));
    const titles = noNonCurrent.financialPosition.map((x) => x.title);
    expect(titles).toEqual(["Current assets", "", "Equity", "Current liabilities", ""]);
    expect(noNonCurrent.clean).toBe(true);
  });

  it("fails its checks for unmapped accounts, unreviewed mappings and imbalance", () => {
    const withUnmapped = buildStatements([...BOOKS.slice(0, -1), acct(null, 5000, 5000)]);
    expect(withUnmapped.clean).toBe(false);
    expect(withUnmapped.checks.find((c) => c.label.includes("mapped to a group"))?.passed).toBe(false);
    expect(withUnmapped.checks.find((c) => c.label.includes("Total assets"))?.passed).toBe(false);

    const unreviewed = buildStatements(BOOKS.map((a, i) => (i === 0 ? { ...a, approved: false } : a)));
    expect(unreviewed.checks.find((c) => c.label.includes("reviewed"))?.passed).toBe(false);

    const lopsided = buildStatements([...BOOKS, acct("CASH", 100)]);
    expect(lopsided.checks.find((c) => c.label.includes("adds to zero"))?.passed).toBe(false);

    const badPrior = buildStatements(BOOKS.map((a, i) => (i === 0 ? { ...a, priorMinor: 1 } : a)));
    expect(badPrior.checks.find((c) => c.label.includes("Comparative"))?.passed).toBe(false);
  });
});

describe("journals in the database", () => {
  const A = { firmId: "aaaaaaaa-1111-4000-8000-000000000001", userId: "aaaaaaaa-1111-4000-8000-000000000002", role: "admin" as const };
  const B = { firmId: "bbbbbbbb-1111-4000-8000-000000000001", userId: "bbbbbbbb-1111-4000-8000-000000000002", role: "admin" as const };
  const TB = [
    { code: "1000", name: "Bank - current account", closingMinor: 100000, priorMinor: null },
    { code: "2100", name: "Accrued expenses", closingMinor: 0, priorMinor: -1000 },
    { code: "3000", name: "Share capital", closingMinor: -100000, priorMinor: null },
    { code: "6300", name: "Professional fees", closingMinor: 0, priorMinor: 1000 },
  ];
  const entry = (description: string, debit: string, credit: string, dr: number, cr: number = dr) => ({
    type: "adjusting" as const,
    description,
    lines: [
      { accountId: debit, amountMinor: dr },
      { accountId: credit, amountMinor: -cr },
    ],
  });
  let db: PGlite;
  let engagement: string;
  let ids: Record<string, string>;

  beforeAll(async () => {
    db = await openDatabase();
    await createFirm(db, { id: A.firmId, name: "A" }, { id: A.userId, email: "a@a.test", name: "A" });
    await createFirm(db, { id: B.firmId, name: "B" }, { id: B.userId, email: "b@b.test", name: "B" });
    await withFirm(db, A.firmId, async (tx) => {
      const client = await repo.createClient(tx, A, "Journal Co");
      engagement = await repo.createEngagement(tx, A, client, "2025-01-01", "2025-12-31");
      await repo.importTrialBalance(tx, A, engagement, "tb.xlsx", TB);
      await repo.approveAllMappings(tx, A, engagement);
      ids = Object.fromEntries((await repo.listAccounts(tx, engagement)).map((a) => [a.code, a.id]));
    });
  });

  it("posts an entry, numbers it, and adjusts the balances and statements", async () => {
    const { accounts, list } = await withFirm(db, A.firmId, async (tx) => {
      await journals.createJournal(tx, A, engagement, entry("Accrue audit fee", ids["6300"], ids["2100"], 5000));
      return { accounts: await repo.listAccounts(tx, engagement), list: await journals.listJournals(tx, engagement) };
    });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ number: 1, type: "adjusting", description: "Accrue audit fee" });
    expect(list[0].lines.map((l) => [l.accountCode, l.amountMinor])).toEqual([["6300", 5000], ["2100", -5000]]);
    expect(accounts.find((a) => a.code === "6300")?.adjustmentMinor).toBe(5000);
    expect(accounts.find((a) => a.code === "1000")?.adjustmentMinor).toBe(0);

    const s = buildStatements(accounts.map((a) => ({ ...a, closingMinor: a.closingMinor + a.adjustmentMinor })));
    expect(s.clean).toBe(true);
    expect(s.comprehensiveIncome.find((l) => l.key === "PROFIT")?.current).toBe(-5000);
    expect(s.financialPosition.flatMap((x) => x.lines).find((l) => l.key === "TRADEPAY")?.current).toBe(5000);
  });

  it("rejects an unbalanced entry and an account from elsewhere", async () => {
    await expect(
      withFirm(db, A.firmId, (tx) => journals.createJournal(tx, A, engagement, entry("Bad entry", ids["6300"], ids["2100"], 5000, 4000))),
    ).rejects.toThrow(/differ by 10.00/);
    await expect(
      withFirm(db, A.firmId, (tx) =>
        journals.createJournal(tx, A, engagement, entry("Foreign account", ids["6300"], "99999999-9999-4999-8999-999999999999", 1)),
      ),
    ).rejects.toThrow(/not in this engagement/);
  });

  it("will not replace the trial balance while journals exist", async () => {
    await expect(withFirm(db, A.firmId, (tx) => repo.importTrialBalance(tx, A, engagement, "tb2.xlsx", TB))).rejects.toThrow(/journal entries/);
  });

  it("hides journals from another firm and blocks cross-firm posting", async () => {
    const seen = await withFirm(db, B.firmId, async (tx) => ({
      list: await journals.listJournals(tx, engagement),
      lines: (await tx.query("select id from journal_lines")).rows.length,
    }));
    expect(seen).toEqual({ list: [], lines: 0 });
    await expect(
      withFirm(db, B.firmId, (tx) => journals.createJournal(tx, B, engagement, entry("Intrusion", ids["6300"], ids["2100"], 1))),
    ).rejects.toThrow(/not found/);
  });

  it("deletes an entry and restores the balances; a locked engagement refuses new entries", async () => {
    const after = await withFirm(db, A.firmId, async (tx) => {
      const [j] = await journals.listJournals(tx, engagement);
      await journals.deleteJournal(tx, A, j.id);
      return repo.listAccounts(tx, engagement);
    });
    expect(after.every((a) => a.adjustmentMinor === 0)).toBe(true);

    // The deleted entry was number 1; the next entry must not reuse it.
    const renumbered = await withFirm(db, A.firmId, async (tx) => {
      await journals.createJournal(tx, A, engagement, entry("Second entry", ids["6300"], ids["2100"], 100));
      return journals.listJournals(tx, engagement);
    });
    expect(renumbered.map((j) => j.number)).toEqual([2]);

    await db.query("update engagements set status = 'locked' where id = $1", [engagement]);
    await expect(
      withFirm(db, A.firmId, (tx) => journals.createJournal(tx, A, engagement, entry("After lock", ids["6300"], ids["2100"], 1))),
    ).rejects.toThrow(/locked/);
  });
});
