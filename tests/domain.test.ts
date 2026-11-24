import { describe, expect, it } from "vitest";
import { formatAmount, parseAmount } from "../src/domain/money";
import { parseCsv, parseTrialBalance } from "../src/domain/tb-parse";
import { proposeMappings, suggestByRule } from "./rule-mapping";
import { buildLeadSheets } from "../src/domain/leadsheet";
import { GROUPS } from "../src/domain/groups";

describe("money", () => {
  it("parses plain, comma-separated and bracketed amounts", () => {
    expect(parseAmount("1,234.56")).toBe(123456);
    expect(parseAmount("(1,234.56)")).toBe(-123456);
    expect(parseAmount("-500")).toBe(-50000);
    expect(parseAmount("AED 75.5")).toBe(7550);
    expect(parseAmount("100 Cr")).toBe(-10000);
    expect(parseAmount("100 Dr")).toBe(10000);
  });
  it("handles numeric cells without float drift", () => {
    expect(parseAmount(0.1 + 0.2)).toBe(30);
    expect(parseAmount(1234.56)).toBe(123456);
    expect(parseAmount("1234.565")).toBe(123457);
  });
  it("distinguishes blank from invalid", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount("-")).toBeNull();
    expect(parseAmount("abc")).toBeNaN();
  });
  it("formats with brackets for negatives", () => {
    expect(formatAmount(123456)).toBe("1,234.56");
    expect(formatAmount(-5)).toBe("(0.05)");
  });
});

describe("trial balance parsing", () => {
  const debitCredit = [
    ["Sample Trading LLC"],
    ["Trial balance at 31 December 2025"],
    [],
    ["Account Code", "Account Name", "Debit", "Credit", "Prior Year"],
    ["1000", "Cash at bank", "50,000.00", "", "40,000.00"],
    ["1100", "Trade receivables", 30000, null, 25000],
    ["Liabilities"],
    ["2000", "Trade payables", "", "20,000.00", "(18,000.00)"],
    ["3000", "Share capital", "", "60,000.00", "(47,000.00)"],
    ["Total", "", "80,000.00", "80,000.00"],
  ];

  it("reads debit and credit columns, skips headings and totals", () => {
    const r = parseTrialBalance(debitCredit);
    expect(r.errors).toEqual([]);
    expect(r.accounts).toHaveLength(4);
    expect(r.accounts[2]).toEqual({ code: "2000", name: "Trade payables", closingMinor: -2000000, priorMinor: -1800000 });
    expect(r.balanced).toBe(true);
    expect(r.differenceMinor).toBe(0);
  });

  it("reads a single signed balance column", () => {
    const r = parseTrialBalance([
      ["Code", "Description", "Balance"],
      ["1", "Bank", "100.00"],
      ["2", "Capital", "(100.00)"],
    ]);
    expect(r.balanced).toBe(true);
    expect(r.accounts[1].closingMinor).toBe(-10000);
    expect(r.accounts[0].priorMinor).toBeNull();
  });

  it("reports an out-of-balance trial balance with the difference", () => {
    const r = parseTrialBalance([
      ["Code", "Name", "Debit", "Credit"],
      ["1", "Bank", "100.00", ""],
      ["2", "Capital", "", "90.00"],
    ]);
    expect(r.balanced).toBe(false);
    expect(r.differenceMinor).toBe(1000);
  });

  it("rejects duplicate accounts and bad amounts with row numbers", () => {
    const r = parseTrialBalance([
      ["Code", "Name", "Balance"],
      ["1", "Bank", "100"],
      ["1", "Bank again", "50"],
      ["2", "Capital", "n/a"],
    ]);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]).toContain("Row 3");
    expect(r.errors[1]).toContain("Row 4");
    expect(r.balanced).toBe(false);
  });

  it("explains a missing header", () => {
    const r = parseTrialBalance([["foo", "bar"], ["1", "2"]]);
    expect(r.errors[0]).toContain("header row");
  });

  it("parses CSV with quoted commas", () => {
    const grid = parseCsv('Code,Name,Balance\r\n1,"Cash, petty","1,000.00"\r\n2,Capital,"(1,000.00)"\r\n');
    expect(grid[1]).toEqual(["1", "Cash, petty", "1,000.00"]);
    expect(parseTrialBalance(grid).balanced).toBe(true);
  });
});

describe("mapping", () => {
  it("has unique group codes", () => {
    expect(new Set(GROUPS.map((g) => g.code)).size).toBe(GROUPS.length);
  });

  it("suggests groups from account names", () => {
    const pick = (name: string) => suggestByRule({ code: "x", name, closingMinor: 0 })?.groupCode;
    expect(pick("Trade receivables")).toBe("TRADEREC");
    expect(pick("Provision for end of service benefits")).toBe("EOSB");
    expect(pick("Bank charges")).toBe("ADMIN");
    expect(pick("Emirates NBD current account - AED")).toBe("CASH");
    expect(pick("Accumulated depreciation - vehicles")).toBe("PPE");
    expect(pick("Depreciation expense")).toBe("DEPN");
    expect(pick("Interest on loan")).toBe("FINCOST");
    expect(pick("Zzz unknown")).toBeUndefined();
  });

  it("reuses last year's mapping ahead of any rule", () => {
    const accounts = [
      { code: "1000", name: "Bank", closingMinor: 1 },
      { code: "4000", name: "Sales", closingMinor: -1 },
      { code: "9999", name: "Qwerty", closingMinor: 0 },
    ];
    const { suggestions, unmapped } = proposeMappings(accounts, new Map([["1000", "INVEST"]]));
    expect(suggestions[0]).toEqual({ accountCode: "1000", groupCode: "INVEST", source: "prior_year", confidence: 1 });
    expect(suggestions[1].source).toBe("rule");
    expect(suggestions[1].groupCode).toBe("REVENUE");
    expect(unmapped).toEqual(["9999"]);
  });
});

describe("lead sheets", () => {
  const accounts = [
    { code: "1000", name: "Bank", closingMinor: 500000, priorMinor: 400000, groupCode: "CASH" },
    { code: "1010", name: "Petty cash", closingMinor: 10000, priorMinor: null, groupCode: "CASH" },
    { code: "3000", name: "Capital", closingMinor: -450000, priorMinor: -400000, groupCode: "CAPITAL" },
    { code: "9000", name: "Suspense", closingMinor: -60000, priorMinor: null, groupCode: null },
  ];

  it("totals each group and ties back to the trial balance", () => {
    const set = buildLeadSheets(accounts);
    expect(set.sheets.map((s) => s.groupCode)).toEqual(["CASH", "CAPITAL"]);
    const cash = set.sheets[0];
    expect(cash.closingMinor).toBe(510000);
    expect(cash.priorMinor).toBe(400000);
    expect(cash.varianceMinor).toBe(110000);
    expect(cash.variancePct).toBeCloseTo(27.5);
    expect(set.unmapped).toHaveLength(1);
    expect(set.totalMinor).toBe(0);
    expect(set.tiesToTrialBalance).toBe(true);
  });

  it("gives no percentage when there is no prior balance", () => {
    const set = buildLeadSheets([{ code: "1", name: "New", closingMinor: 100, priorMinor: null, groupCode: "CASH" }]);
    expect(set.sheets[0].variancePct).toBeNull();
  });

  it("treats an unknown group code as unmapped rather than dropping the account", () => {
    const set = buildLeadSheets([{ code: "1", name: "Odd", closingMinor: 100, priorMinor: null, groupCode: "NOPE" }]);
    expect(set.sheets).toHaveLength(0);
    expect(set.unmapped).toHaveLength(1);
    expect(set.tiesToTrialBalance).toBe(true);
  });
});

describe("prior-year column check", () => {
  it("warns when comparatives do not add to zero", () => {
    const r = parseTrialBalance([
      ["Code", "Name", "Balance", "Prior Year"],
      ["1", "Bank", "100", "80"],
      ["2", "Capital", "(100)", "80"],
    ]);
    expect(r.balanced).toBe(true);
    expect(r.warnings.join(" ")).toContain("Prior Year column does not add to zero");
  });
});

describe("review fixes", () => {
  it("suggests borrowings, not cash, for a bank loan", () => {
    expect(suggestByRule({ code: "x", name: "Bank loan", closingMinor: -1 })?.groupCode).toBe("BORROW");
  });
  it("keeps an account that has only a prior-year balance", () => {
    const r = parseTrialBalance([
      ["Code", "Name", "Debit", "Credit", "Prior Year"],
      ["Assets"],
      ["1", "Bank", "100", "", "50"],
      ["2", "Old deposit", "", "", "50"],
      ["3", "Capital", "", "100", "(100)"],
    ]);
    expect(r.accounts.map((a) => a.code)).toEqual(["1", "2", "3"]);
    expect(r.accounts[1]).toMatchObject({ closingMinor: 0, priorMinor: 5000 });
    expect(r.balanced).toBe(true);
    expect(r.warnings).toEqual([]);
  });
});
