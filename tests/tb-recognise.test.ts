import { describe, expect, it } from "vitest";
import { recogniseWorkbook, type Recognition } from "../src/domain/tb-recognise";
import { parseTrialBalance } from "../src/domain/tb-parse";

// Every sheet here is invented: made-up accounts and figures, written in the shape of an export. No vendor's file or text is copied.
const one = (rows: unknown[][], name = "Sheet1"): Recognition => recogniseWorkbook([{ name, rows }])!;
const summary = (r: Recognition) => r.accounts.map((a) => [a.code, a.name, a.closingMinor]);

describe("headings and layout around them", () => {
  it("skips title, company, date and blank rows above the heading, and is sure of a clean sheet", () => {
    const r = one([
      ["Invented Trading LLC"],
      ["Trial balance as at 31 December 2025"],
      [],
      ["Account Code", "Account Name", "Debit", "Credit"],
      ["1000", "Cash", "1,500.00", ""],
      ["3000", "Capital", "", "1,500.00"],
    ]);
    expect(r.header).toEqual({ start: 3, end: 3 });
    expect(summary(r)).toEqual([["1000", "Cash", 150000], ["3000", "Capital", -150000]]);
    expect(r.balanced).toBe(true);
    expect(r.confidence).toEqual({ level: "high", reasons: [] });
  });

  it("reads Arabic header words, and passes account names through as they are", () => {
    const r = one([["رقم الحساب", "اسم الحساب", "مدين", "دائن"], ["1000", "الصندوق", 500, ""], ["3000", "رأس المال", "", 500]]);
    expect(r.roles).toEqual({ 0: "code", 1: "name", 2: "debit", 3: "credit" });
    expect(summary(r)).toEqual([["1000", "الصندوق", 50000], ["3000", "رأس المال", -50000]]);
    const balance = one([["اسم الحساب", "الرصيد"], ["الصندوق", 500], ["رأس المال", -500]]);
    expect(balance.roles).toEqual({ 0: "name", 1: "balance" });
    expect(balance.confidence.level).toBe("high");
  });

  it("reads a heading that spans two rows ('Closing' above Debit and Credit), and says so", () => {
    const r = one([["", "", "Closing", ""], ["Code", "Name", "Debit", "Credit"], ["10", "Bank", 700, ""], ["30", "Capital", "", 700]]);
    expect(r.header).toEqual({ start: 0, end: 1 });
    expect(r.roles).toEqual({ 0: "code", 1: "name", 2: "debit", 3: "credit" });
    expect(r.confidence.level).toBe("medium");
    expect(r.confidence.reasons).toContain("The heading spans two rows.");
  });

  it("finds the heading words in their usual variants", () => {
    for (const heading of [["A/C No", "Description", "Dr", "Cr"], ["GL Code", "Account Title", "Debit Balance", "Credit Balance"], ["Ledger Code", "Particulars", "Debits", "Credits"], ["Number", "Ledger Name", "Debit (AED)", "Credit (AED)"]]) {
      const r = one([heading, ["1", "Bank", 10, ""], ["2", "Capital", "", 10]]);
      expect(r.roles, heading.join("|")).toEqual({ 0: "code", 1: "name", 2: "debit", 3: "credit" });
    }
  });

  it("returns nothing when no heading names an account column and an amount column", () => {
    expect(recogniseWorkbook([{ name: "x", rows: [["Alpha", "Beta"], ["1", "2"]] }])).toBeNull();
    expect(recogniseWorkbook([])).toBeNull();
  });
});

describe("accounts and amounts", () => {
  it("splits an account code and name kept in one column", () => {
    const dash = one([["Account", "Debit", "Credit"], ["1100 - Debtors", 900, ""], ["1200 - Bank", 100, ""], ["3000 - Capital", "", 1000]]);
    expect(dash.roles).toEqual({ 0: "codename", 1: "debit", 2: "credit" });
    expect(summary(dash)).toEqual([["1100", "Debtors", 90000], ["1200", "Bank", 10000], ["3000", "Capital", -100000]]);
    const brackets = one([["Account", "Balance"], ["Debtors (1100)", 900], ["Bank (1200)", 100], ["Capital (3000)", -1000]]);
    expect(summary(brackets)).toEqual([["1100", "Debtors", 90000], ["1200", "Bank", 10000], ["3000", "Capital", -100000]]);
    expect(brackets.confidence.level).toBe("medium");
  });

  it("keeps a plain Account column as the name when its cells are not code-and-name", () => {
    const r = one([["Account", "Debit", "Credit"], ["Bank", 5, ""], ["Capital", "", 5]]);
    expect(r.roles[0]).toBe("name");
    expect(r.confidence.level).toBe("high");
  });

  it("reads one signed balance, a Dr/Cr marker column, and Dr/Cr suffixes", () => {
    const marker = one([["Code", "Name", "Balance", "Dr/Cr"], ["1", "Bank", "1,250.00", "Dr"], ["2", "Capital", "1,250.00", "Cr"]]);
    expect(marker.roles).toEqual({ 0: "code", 1: "name", 2: "balance", 3: "drcr" });
    expect(summary(marker)).toEqual([["1", "Bank", 125000], ["2", "Capital", -125000]]);
    const suffix = one([["Code", "Name", "Balance"], ["1", "Bank", "1,250.00 Dr"], ["2", "Capital", "1,250.00 Cr"]]);
    expect(summary(suffix)).toEqual([["1", "Bank", 125000], ["2", "Capital", -125000]]);
    expect(suffix.confidence.level).toBe("medium");
  });

  it("reads negatives in brackets and with a trailing or leading minus, and currency marks and codes", () => {
    const r = one([["Name", "Balance"], ["A", "AED 1,000.00"], ["B", "(250.00)"], ["C", "250.00-"], ["D", "-500.00"], ["E", "$ 1,000.00"], ["F", "€(1,000.00)"]]);
    expect(r.accounts.map((a) => a.closingMinor)).toEqual([100000, -25000, -25000, -50000, 100000, -100000]);
    expect(r.balanced).toBe(true);
  });

  it("decides the separator convention once for the file: 1.234,56 is read as 1234.56 throughout", () => {
    const eu = one([["Name", "Debit", "Credit"], ["Bank", "1.234,56", ""], ["Debtors", "100,00", ""], ["Capital", "", "1.334,56"]]);
    expect(eu.separator).toBe("eu");
    expect(eu.accounts.map((a) => a.closingMinor)).toEqual([123456, 10000, -133456]);
    expect(eu.balanced).toBe(true);
    expect(eu.confidence.reasons).toContain("Amounts use a comma as the decimal point.");
    const us = one([["Name", "Debit", "Credit"], ["Bank", "1,234.56", ""], ["Capital", "", "1,234.56"]]);
    expect(us.separator).toBe("us");
    expect(us.confidence.level).toBe("high");
  });

  it("is not sure when the amounts use both conventions, or none shows the decimal point", () => {
    const mixed = one([["Name", "Debit", "Credit"], ["Bank", "1,234.56", ""], ["Debtors", "100,00", ""], ["Capital", "", "1,334.56"]]);
    expect(mixed.confidence.level).toBe("low");
    expect(mixed.confidence.reasons).toContain("Amounts use both separator conventions.");
    const unclear = one([["Name", "Debit", "Credit"], ["Bank", "1,234", ""], ["Capital", "", "1,234"]]);
    expect(unclear.confidence.level).toBe("low");
    expect(unclear.confidence.reasons[0]).toContain("which separator is the decimal point");
  });
});

describe("opening, movement and closing", () => {
  it("imports the closing columns, and does not treat opening as the prior year", () => {
    const r = one([
      ["Code", "Name", "Opening Debit", "Opening Credit", "Movement Debit", "Movement Credit", "Closing Debit", "Closing Credit"],
      ["1", "Bank", 100, "", 50, "", 150, ""],
      ["2", "Capital", "", 100, "", 50, "", 150],
    ]);
    expect(r.roles).toEqual({ 0: "code", 1: "name", 6: "debit", 7: "credit" });
    expect(r.ignoredColumns.map((c) => c.column)).toEqual([2, 3, 4, 5]);
    expect(r.ignoredColumns[0].reason).toContain("not used as the prior year");
    expect(r.accounts.map((a) => [a.closingMinor, a.priorMinor])).toEqual([[15000, null], [-15000, null]]);
  });
});

describe("rows that are not accounts", () => {
  it("skips total rows, group headings and blank rows, each with a reason", () => {
    const r = one([
      ["Code", "Name", "Debit", "Credit"],
      ["", "ASSETS", "", ""],
      ["1", "Bank", 400, ""],
      ["2", "Debtors", 600, ""],
      [],
      ["", "Equity", "", ""],
      ["3", "Capital", "", 1000],
      ["", "Total", 1000, 1000],
      ["", "Grand Total", 1000, 1000],
    ]);
    expect(r.accounts.map((a) => a.code)).toEqual(["1", "2", "3"]);
    expect(r.skipped).toEqual([
      { row: 2, reason: "A heading row with no amounts" },
      { row: 6, reason: "A heading row with no amounts" },
      { row: 8, reason: "A total row" },
      { row: 9, reason: "A total row" },
    ]);
    expect(r.balanced).toBe(true);
    expect(r.confidence.level).toBe("high");
  });

  it("skips a subtotal that equals the rows above it, so nothing is counted twice, and says so", () => {
    const r = one([
      ["Code", "Name", "Debit", "Credit"],
      ["1", "Bank", 400, ""],
      ["2", "Debtors", 600, ""],
      ["", "Current assets", 1000, ""],
      ["3", "Capital", "", 1000],
    ]);
    expect(r.accounts.map((a) => a.code)).toEqual(["1", "2", "3"]);
    expect(r.skipped).toEqual([{ row: 4, reason: "A subtotal (it equals the rows above it)" }]);
    expect(r.balanced).toBe(true);
    expect(r.confidence.level).toBe("medium");
  });

  it("skips a parent line that repeats the sub-accounts below it", () => {
    const r = one([
      ["Code", "Name", "Balance"],
      ["11", "Current assets", 1000],
      ["1101", "Bank", 400],
      ["1102", "Debtors", 600],
      ["3", "Capital", -1000],
    ]);
    expect(r.accounts.map((a) => a.code)).toEqual(["1101", "1102", "3"]);
    expect(r.skipped).toEqual([{ row: 2, reason: "A parent line (it equals the sub-accounts below it)" }]);
    expect(r.balanced).toBe(true);
  });

  it("does not drop an account just because its amount happens to match", () => {
    const r = one([["Code", "Name", "Balance"], ["1", "Bank", 500], ["2", "Cash", 500], ["3", "Loan", -1000], ["4", "Other", 0]]);
    expect(r.accounts).toHaveLength(4);
    expect(r.skipped).toEqual([]);
  });
});

describe("several sheets", () => {
  it("uses the sheet that looks like a trial balance, and says which", () => {
    const r = recogniseWorkbook([
      { name: "Cover", rows: [["Invented Co"], ["Prepared by someone"]] },
      { name: "Notes", rows: [["Item", "Text"], ["a", "b"]] },
      { name: "Trial Balance", rows: [["Code", "Name", "Debit", "Credit"], ["1", "Bank", 5, ""], ["2", "Capital", "", 5]] },
    ])!;
    expect(r.sheetIndex).toBe(2);
    expect(r.sheetName).toBe("Trial Balance");
    expect(r.sheetsSeen).toBe(3);
    expect(r.confidence.reasons).toContain('The sheet "Trial Balance" was used of 3.');
  });

  it("prefers the sheet that balances", () => {
    const r = recogniseWorkbook([
      { name: "Draft", rows: [["Code", "Name", "Debit", "Credit"], ["1", "Bank", 5, ""], ["2", "Capital", "", 4]] },
      { name: "Final", rows: [["Code", "Name", "Debit", "Credit"], ["1", "Bank", 5, ""], ["2", "Capital", "", 5]] },
    ])!;
    expect(r.sheetName).toBe("Final");
  });
});

describe("when it has to guess, it asks", () => {
  it("is low when the accounts do not balance, and still says what it found for the chooser", () => {
    const r = one([["Code", "Name", "Debit", "Credit"], ["1", "Bank", 500, ""], ["2", "Capital", "", 400]]);
    expect(r.confidence.level).toBe("low");
    expect(r.confidence.reasons[0]).toContain("do not balance");
    expect(r.prefill).toEqual({ headerRow: 0, columns: { code: 0, name: 1, debit: 2, credit: 3 } });
  });

  it("is low when two columns have the same heading, using the first and saying so", () => {
    const r = one([["Code", "Name", "Debit", "Credit", "Debit", "Credit"], ["1", "Bank", 5, "", 4, ""], ["2", "Capital", "", 5, "", 4]]);
    expect(r.confidence.level).toBe("low");
    expect(r.confidence.reasons).toContain("Two columns have the same heading, so the first was used.");
    expect(r.ignoredColumns.map((c) => c.column)).toEqual([4, 5]);
  });

  it("is low for a single account, or a repeated account", () => {
    expect(one([["Code", "Name", "Balance"], ["1", "Bank", 0]]).confidence.level).toBe("low");
    expect(one([["Code", "Name", "Balance"], ["1", "Bank", 5], ["1", "Bank", -5]]).confidence.reasons).toContain("The same account appears twice.");
  });

  it("is low for an amount that is not a number, and leaves that row out with its reason", () => {
    const r = one([["Code", "Name", "Debit", "Credit"], ["1", "Bank", 5, ""], ["2", "Capital", "", 5], ["3", "Odd", "n/a", ""]]);
    expect(r.skipped).toEqual([{ row: 4, reason: "An amount that is not a number" }]);
  });
});

describe("what plain detection already reads is not this engine's to change", () => {
  it("leaves parseTrialBalance exactly as it was for sheets it reads", () => {
    const grid = [["Our client"], [], ["Code", "Description", "Balance", "Prior Year"], ["1000", "Bank", 500, 400], ["3000", "Capital", -500, -400], ["Total", "", 0, 0]];
    expect(parseTrialBalance(grid)).toMatchObject({ errors: [], balanced: true, layout: { code: 0, name: 1, balance: 2, prior: 3 } });
    expect(parseTrialBalance(grid).accounts).toEqual([
      { code: "1000", name: "Bank", closingMinor: 50000, priorMinor: 40000 },
      { code: "3000", name: "Capital", closingMinor: -50000, priorMinor: -40000 },
    ]);
  });
});
