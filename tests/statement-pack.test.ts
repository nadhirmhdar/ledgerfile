import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildStatementPack, roundAccounts, type PackAccount } from "../src/domain/statement-pack";
import { severityOf } from "../src/domain/statements";
import { parseTrialBalance } from "../src/domain/tb-parse";
import { proposeMappings } from "./rule-mapping";
import { readGrid } from "../src/server/excel";

let n = 0;
const acct = (groupCode: string | null, name: string, closingMinor: number, priorMinor: number | null): PackAccount => ({
  code: String(1000 + n++),
  name,
  groupCode,
  closingMinor,
  priorMinor,
  approved: true,
});

// Ledger sign. Year 1 (prior): profit 100. Year 2 (current): profit 200, dividend 50, loan repaid 40, capex 80.
// Prior: PPE 400, receivables 150, cash 110; payables 100, loan 200, capital 300, retained b/f (40) debit... kept simple below.
const BOOKS: PackAccount[] = [
  acct("PPE", "Equipment", 43000, 40000), // +80 additions, -50 depreciation
  acct("TRADEREC", "Trade receivables", 18000, 15000),
  acct("TRADEREC", "Prepayments", 2000, 2000),
  acct("CASH", "Bank", 16000, 11000),
  acct("TRADEPAY", "Trade payables", -12000, -10000),
  acct("TRADEPAY", "Accruals", -1000, -2000),
  acct("BORROW", "Bank loan", -16000, -20000),
  acct("CAPITAL", "Share capital", -30000, -30000),
  // Opening retained earnings for the current year = prior retained (4,000 debit... ) see below
  acct("RETAINED", "Retained earnings", -5000, 4000),
  acct("RETAINED", "Dividends paid", 5000, 0),
  acct("REVENUE", "Sales", -100000, -80000),
  acct("COS", "Cost of sales", 60000, 50000),
  acct("DEPN", "Depreciation expense", 5000, 5000),
  acct("ADMIN", "Rent", 10000, 10000),
  acct("ADMIN", "Utilities", 3000, 3000),
  acct("FINCOST", "Interest on loan", 2000, 2000),
];

describe("fixture", () => {
  it("balances in both years", () => {
    expect(BOOKS.reduce((s, a) => s + a.closingMinor, 0)).toBe(0);
    expect(BOOKS.reduce((s, a) => s + (a.priorMinor ?? 0), 0)).toBe(0);
  });
});

describe("statement of changes in equity", () => {
  const pack = buildStatementPack(BOOKS);
  const row = (key: string) => pack.equity!.rows.find((r) => r.key === key)!;

  it("moves from opening to closing equity through profit and other movements", () => {
    expect(pack.equity!.columns.map((c) => c.key)).toEqual(["CAPITAL", "RETAINED"]);
    // Opening retained: prior balance (4,000 debit) plus prior profit 10,000 = 6,000.
    expect(row("opening").values).toEqual([30000, 6000]);
    expect(row("profit").values).toEqual([0, 20000]);
    // Dividend of 5,000 and 1,000 other: closing retained 0 + 20,000 = 20,000; 20,000 - 6,000 - 20,000 = -6,000.
    expect(row("other").values).toEqual([0, -6000]);
    expect(row("closing").values).toEqual([30000, 20000]);
    expect(row("closing").total).toBe(50000);
  });

  it("agrees to total equity on the statement of financial position", () => {
    const totalEquity = pack.base.financialPosition.flatMap((s) => s.lines).find((l) => l.key === "TOTAL_EQUITY")!.current;
    expect(row("closing").total).toBe(totalEquity);
    expect(pack.checks.find((c) => c.label.includes("changes in equity"))?.passed).toBe(true);
  });
});

describe("statement of cash flows", () => {
  const pack = buildStatementPack(BOOKS);
  const cf = pack.cashFlow!;
  const line = (key: string) => cf.sections.flatMap((s) => s.lines).find((l) => l.key === key)?.current;

  it("derives each line from the movements", () => {
    expect(line("PBT")).toBe(20000);
    expect(line("CF_DEPN")).toBe(5000);
    expect(line("CF_FIN")).toBe(2000);
    expect(line("CF_REC")).toBe(-3000);
    expect(line("CF_PAY")).toBe(1000);
    expect(line("CF_OP")).toBe(25000);
    expect(line("CF_CAPEX")).toBe(-8000);
    expect(line("CF_BORROW")).toBe(-4000);
    expect(line("CF_INTEREST")).toBe(-2000);
    expect(line("CF_EQUITY")).toBe(-6000);
    // Lines with nothing in them are left out.
    expect(line("CF_INV")).toBeUndefined();
    expect(line("CF_TAX")).toBeUndefined();
  });

  it("explains the movement in cash exactly", () => {
    expect(cf.netChange).toBe(5000);
    expect(cf.closing - cf.opening).toBe(5000);
    expect(pack.checks.find((c) => c.label.includes("Cash flow"))?.passed).toBe(true);
    expect(pack.clean).toBe(true);
  });

  it("is not produced without comparatives", () => {
    const noPrior = buildStatementPack(BOOKS.map((a) => ({ ...a, priorMinor: null })));
    expect(noPrior.cashFlow).toBeNull();
    expect(noPrior.equity).toBeNull();
    expect(noPrior.clean).toBe(true);
  });
});

describe("cash flows with every group in use", () => {
  it("still explains the movement in cash exactly", () => {
    // One account in every group, with arbitrary different balances in each year.
    // Cash is the balancing figure, so both years add to zero.
    const debit = new Set(["PPE", "INTANG", "INVEST", "INVENT", "TRADEREC", "RPREC", "COS", "STAFF", "DEPN", "ADMIN", "FINCOST", "TAXEXP"]);
    const codes = ["PPE", "INTANG", "INVEST", "INVENT", "TRADEREC", "RPREC", "CAPITAL", "RESERVES", "RETAINED", "OWNERCA", "EOSB", "BORROW", "TRADEPAY", "RPPAY", "TAXLIAB", "REVENUE", "COS", "OTHERINC", "STAFF", "DEPN", "ADMIN", "FINCOST", "TAXEXP"];
    const all = codes.map((g, i) => {
      const sign = debit.has(g) ? 1 : -1;
      return acct(g, g.toLowerCase(), sign * (1000 + i * 137), sign * (900 + i * 101));
    });
    const cash = acct("CASH", "bank", -all.reduce((s, a) => s + a.closingMinor, 0), -all.reduce((s, a) => s + (a.priorMinor ?? 0), 0));
    const pack = buildStatementPack([...all, cash]);

    // The placeholder check is a warning, and the generated notes still carry placeholders; every error check passes.
    expect(pack.checks.filter((c) => !c.passed && severityOf(c) === "error")).toEqual([]);
    const keys = pack.cashFlow!.sections.flatMap((s) => s.lines).map((l) => l.key);
    for (const key of ["CF_INV", "CF_REC", "CF_PAY", "CF_EOSB", "CF_TAX", "CF_CAPEX", "CF_INVEST", "CF_BORROW", "CF_INTEREST", "CF_EQUITY"]) {
      expect(keys, key).toContain(key);
    }
    expect(pack.cashFlow!.netChange).toBe(pack.cashFlow!.closing - pack.cashFlow!.opening);
    expect(pack.equity!.columns.map((c) => c.key)).toEqual(["CAPITAL", "RESERVES", "RETAINED", "OWNERCA"]);

    const rounded = buildStatementPack([...[...all, cash].map((a): PackAccount => ({ ...a, closingMinor: a.closingMinor + 37, priorMinor: (a.priorMinor ?? 0) + 37 })), acct("CASH", "plug", -24 * 37, -24 * 37)], { unitMinor: 100 });
    expect(rounded.checks.filter((c) => !c.passed && severityOf(c) === "error")).toEqual([]);
  });
});

describe("notes", () => {
  const pack = buildStatementPack(BOOKS, { currency: "AED" });
  it("starts with the framework notes and adds a breakdown for each multi-account line", () => {
    expect(pack.notes.slice(0, 3).map((x) => x.title)).toEqual(["General information", "Basis of preparation", "Significant accounting policies"]);
    expect(pack.notes[1].paragraphs[0]).toContain("IFRS for SMEs");
    // Policies are included only for what the entity has: this one has no inventories, tax or intangibles.
    const policies = pack.notes[2].subsections!.map((p) => p.title);
    expect(policies).toEqual([
      "Revenue",
      "Property, plant and equipment",
      "Impairment of non-financial assets",
      "Trade and other receivables",
      "Cash and cash equivalents",
      "Trade and other payables",
      "Borrowings",
      "Provisions",
      "Foreign currencies",
      "Significant judgements and sources of estimation uncertainty",
    ]);
    expect(pack.notes[2].paragraphs[0]).toContain("Draft wording");
    expect(pack.notes[1].paragraphs[0]).toContain("AED");
    expect(pack.notes.slice(3).map((x) => [x.number, x.groupCode])).toEqual([[4, "TRADEREC"], [5, "RETAINED"], [6, "TRADEPAY"], [7, "ADMIN"]]);
    expect(pack.noteByGroup).toEqual({ TRADEREC: 4, RETAINED: 5, TRADEPAY: 6, ADMIN: 7 });
  });

  it("shows each note in the sign of its statement line and totals to that line", () => {
    const sfp = pack.base.financialPosition.flatMap((s) => s.lines);
    const payables = pack.notes.find((x) => x.groupCode === "TRADEPAY")!;
    expect(payables.table!.rows).toEqual([
      { label: "Trade payables", current: 12000, prior: 10000 },
      { label: "Accruals", current: 1000, prior: 2000 },
    ]);
    for (const note of pack.notes.filter((x) => x.groupCode)) {
      const face = sfp.find((l) => l.key === note.groupCode) ?? pack.base.comprehensiveIncome.find((l) => l.key === note.groupCode)!;
      expect(note.table!.totalCurrent).toBe(face.current);
      expect(note.table!.totalPrior).toBe(face.prior);
    }
  });
});

describe("rounding to whole units", () => {
  it("rounds half away from zero and leaves exact figures alone at unit 1", () => {
    const { accounts } = roundAccounts([acct("CASH", "a", 150, -150), acct("CAPITAL", "b", -150, 150)], 100);
    expect(accounts.map((a) => [a.closingMinor, a.priorMinor])).toEqual([[200, -200], [-200, 200]]);
    expect(roundAccounts(BOOKS, 1).accounts).toBe(BOOKS);
  });

  it("puts the rounding difference through one account so everything still balances", () => {
    const odd = [
      acct("CASH", "Bank", 10040, 10040),
      acct("TRADEREC", "Debtors", 5040, 5040),
      acct("ADMIN", "Rent", 2040, 2040),
      acct("ADMIN", "Small expense", 40, 40),
      acct("CAPITAL", "Capital", -17160, -17160),
    ];
    const pack = buildStatementPack(odd, { unitMinor: 100 });
    // 10,000 + 5,000 + 2,000 + 0 - 17,200 = -200: two units are put through the largest admin account.
    expect(pack.rounding.current).toEqual({ account: "Rent", amountMinor: 200 });
    expect(pack.rounding.prior).toEqual({ account: "Rent", amountMinor: 200 });
    expect(pack.clean).toBe(true);
    const all = [...pack.base.financialPosition.flatMap((s) => s.lines), ...pack.base.comprehensiveIncome];
    expect(all.every((l) => l.current % 100 === 0 && l.prior % 100 === 0)).toBe(true);
  });

  it("does not hide a trial balance that is genuinely out of balance", () => {
    const pack = buildStatementPack([acct("CASH", "Bank", 10040, null), acct("CAPITAL", "Capital", -9000, null)], { unitMinor: 100 });
    expect(pack.rounding.current).toBeNull();
    expect(pack.clean).toBe(false);
  });
});

describe("the sample client", () => {
  it("produces a clean pack in exact and rounded form", async () => {
    const buf = readFileSync("samples/falcon-tb-2025.xlsx");
    const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const parsed = parseTrialBalance(await readGrid("falcon-tb-2025.xlsx", data));
    const { suggestions } = proposeMappings(parsed.accounts, new Map());
    const group = new Map(suggestions.map((s) => [s.accountCode, s.groupCode]));
    const accounts: PackAccount[] = parsed.accounts.map((a) => ({ ...a, groupCode: group.get(a.code) ?? null, approved: true }));

    for (const unitMinor of [1, 100]) {
      const pack = buildStatementPack(accounts, { unitMinor });
      expect(pack.checks.filter((c) => !c.passed && severityOf(c) === "error")).toEqual([]);
      expect(pack.checks.filter((c) => !c.passed).map((c) => c.label)).toEqual(["No placeholders left in the notes"]);
      expect(pack.clean).toBe(true);
      expect(pack.cashFlow!.netChange).toBe(pack.cashFlow!.closing - pack.cashFlow!.opening);
      expect(pack.equity!.rows[3].total).toBeGreaterThan(0);
    }
  });
});
