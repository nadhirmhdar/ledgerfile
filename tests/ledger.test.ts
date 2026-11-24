import { describe, expect, it } from "vitest";
import { parseDate, parseLedger } from "../src/domain/ledger-parse";
import { flagEntries, reconcileLedger } from "../src/domain/journal-risk";
import { parseCsv } from "../src/domain/tb-parse";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { readGrid } from "../src/server/excel";
import { parseTrialBalance } from "../src/domain/tb-parse";
import { proposeMappings } from "./rule-mapping";

const HEADER = ["Date", "Journal No", "Account Code", "Account Name", "Description", "Debit", "Credit", "Posted By"];

describe("dates", () => {
  it("reads common formats day-first and rejects impossible dates", () => {
    expect(parseDate("2025-12-31")).toBe("2025-12-31");
    expect(parseDate("31/12/2025")).toBe("2025-12-31");
    expect(parseDate("1.2.2025")).toBe("2025-02-01");
    expect(parseDate("05-Jan-2025")).toBe("2025-01-05");
    expect(parseDate("5 January 2025")).toBe("2025-01-05");
    expect(parseDate("31/02/2025")).toBeNull();
    expect(parseDate("12/31/2025")).toBeNull();
    expect(parseDate("")).toBeNull();
    expect(parseDate("yesterday")).toBeNull();
  });
});

describe("journal listing parsing", () => {
  it("reads lines with debit and credit columns, skipping titles, totals and zero lines", () => {
    const r = parseLedger([
      ["Falcon Trading LLC"],
      ["General journal 2025"],
      HEADER,
      ["15/03/2025", "JV-001", "1100", "Trade receivables", "March sales", "1,050.00", "", "sara"],
      ["15/03/2025", "JV-001", "4000", "Sales", "March sales", "", "1,000.00", "sara"],
      ["15/03/2025", "JV-001", "2150", "VAT payable", "March sales", "", "50.00", "sara"],
      ["15/03/2025", "JV-001", "9999", "Memo", "", "", "", "sara"],
      ["Total", "", "", "", "", "1,050.00", "1,050.00", ""],
    ]);
    expect(r.errors).toEqual([]);
    expect(r.lines).toHaveLength(3);
    expect(r.lines[0]).toEqual({ entryNo: "JV-001", date: "2025-03-15", postedBy: "sara", description: "March sales", accountCode: "1100", accountName: "Trade receivables", amountMinor: 105000 });
    expect(r.lines[1].amountMinor).toBe(-100000);
  });

  it("reads a single signed amount column and does without optional columns", () => {
    const r = parseLedger([
      ["Posting Date", "Voucher", "GL Code", "Amount"],
      ["2025-06-30", "88", "6100", "500"],
      ["2025-06-30", "88", "1000", "(500)"],
    ]);
    expect(r.errors).toEqual([]);
    expect(r.lines.map((l) => [l.accountCode, l.amountMinor, l.postedBy, l.description])).toEqual([["6100", 50000, null, null], ["1000", -50000, null, null]]);
  });

  it("rejects a listing with an entry that does not balance", () => {
    const r = parseLedger([
      HEADER,
      ["01/01/2025", "A", "1000", "", "", "100", "", ""],
      ["01/01/2025", "A", "3000", "", "", "", "90", ""],
      ["02/01/2025", "B", "1000", "", "", "10", "", ""],
      ["02/01/2025", "B", "3000", "", "", "", "10", ""],
    ]);
    expect(r.errors).toEqual(["Entry A does not balance: debits and credits differ by 10.00."]);
  });

  it("reports bad rows with their row numbers, and a missing header", () => {
    const r = parseLedger([
      HEADER,
      ["not a date", "A", "1000", "", "", "100", "", ""],
      ["01/01/2025", "", "1000", "", "", "100", "", ""],
      ["01/01/2025", "A", "", "", "", "100", "", ""],
      ["01/01/2025", "A", "1000", "", "", "abc", "", ""],
    ]);
    expect(r.errors[0]).toContain('Row 2: the date "not a date"');
    expect(r.errors[1]).toContain("Row 3: no journal or entry number");
    expect(r.errors[2]).toContain("Row 4: no account code");
    expect(r.errors[3]).toContain("Row 5: amount is not a number");
    expect(parseLedger([["a", "b"], ["1", "2"]]).errors[0]).toContain("header row");
  });
});

describe("risk flags", () => {
  const line = (entryNo: string, date: string, accountCode: string, amountMinor: number, description: string | null = "x", postedBy: string | null = "sara") => ({
    entryNo,
    date,
    postedBy,
    description,
    accountCode,
    accountName: null,
    amountMinor,
  });
  const ctx = {
    periodStart: "2025-01-01",
    periodEnd: "2025-12-31",
    groupByAccount: new Map<string, string | null>([["1000", "CASH"], ["1100", "TRADEREC"], ["2000", "TRADEPAY"], ["4000", "REVENUE"], ["6100", "ADMIN"], ["6200", "ADMIN"], ["7000", null]]),
  };
  // Routine entries so that the common accounts are not "seldom used".
  const routine = ["R1", "R2", "R3"].flatMap((n) => [line(n, "2025-03-12", "1100", 123456), line(n, "2025-03-12", "4000", -123456), line(n + "b", "2025-03-13", "6100", 5555), line(n + "b", "2025-03-13", "1000", -5555)]);
  const flagsOf = (extra: ReturnType<typeof line>[], entryNo: string) => flagEntries([...routine, ...extra], ctx).find((e) => e.entryNo === entryNo)!.flags;

  it("leaves a routine entry unflagged", () => {
    const entries = flagEntries(routine, ctx);
    expect(entries.find((e) => e.entryNo === "R1")).toMatchObject({ date: "2025-03-12", totalMinor: 123456, lineCount: 2, flags: [], postedBy: "sara" });
  });

  it("flags period end, outside the period, and weekends", () => {
    expect(flagsOf([line("P", "2025-12-29", "1100", 777), line("P", "2025-12-29", "4000", -777)], "P")).toEqual(["period_end"]);
    expect(flagsOf([line("P", "2025-12-26", "1100", 777), line("P", "2025-12-26", "4000", -777)], "P")).toEqual([]);
    expect(flagsOf([line("O", "2026-01-02", "1100", 777), line("O", "2026-01-02", "4000", -777)], "O")).toEqual(["outside_period"]);
    // 15 March 2025 is a Saturday.
    expect(flagsOf([line("W", "2025-03-15", "1100", 777), line("W", "2025-03-15", "4000", -777)], "W")).toEqual(["weekend"]);
  });

  it("flags round amounts and missing descriptions", () => {
    expect(flagsOf([line("N", "2025-03-12", "1100", 5000000), line("N", "2025-03-12", "4000", -5000000)], "N")).toEqual(["round"]);
    expect(flagsOf([line("N", "2025-03-12", "1100", 50000), line("N", "2025-03-12", "4000", -50000)], "N")).toEqual([]);
    expect(flagsOf([line("D", "2025-03-12", "1100", 777, null), line("D", "2025-03-12", "4000", -777, "")], "D")).toEqual(["no_description"]);
  });

  it("flags revenue posted against an expense, a seldom-used account and an unknown account", () => {
    expect(flagsOf([line("V", "2025-03-12", "6100", 777), line("V", "2025-03-12", "4000", -777)], "V")).toEqual(["revenue_pair"]);
    expect(flagsOf([line("S", "2025-03-12", "6200", 777), line("S", "2025-03-12", "1000", -777)], "S")).toEqual(["seldom_used"]);
    expect(flagsOf([line("U", "2025-03-12", "8888", 777), line("U", "2025-03-12", "1000", -777)], "U")).toEqual(["seldom_used", "unknown_account"]);
    // An unmapped trial balance account paired with revenue is unusual, but it is not unknown.
    expect(flagsOf([line("M", "2025-03-12", "7000", 777), line("M", "2025-03-12", "4000", -777)], "M")).toEqual(["revenue_pair", "seldom_used"]);
  });
});

describe("completeness reconciliation", () => {
  const l = (accountCode: string, amountMinor: number) => ({ entryNo: "1", date: "2025-06-30", postedBy: null, description: null, accountCode, accountName: null, amountMinor });
  const period = { start: "2025-01-01", end: "2025-12-31" };
  const accounts = [
    { code: "1000", name: "Bank", closingMinor: 150000, priorMinor: 100000, groupCode: "CASH" },
    { code: "4000", name: "Sales", closingMinor: -90000, priorMinor: -70000, groupCode: "REVENUE" },
    { code: "6100", name: "Rent", closingMinor: 40000, priorMinor: 30000, groupCode: "ADMIN" },
    { code: "1500", name: "New asset", closingMinor: 5000, priorMinor: null, groupCode: "PPE" },
    { code: "7000", name: "Unmapped", closingMinor: 100, priorMinor: 0, groupCode: null },
  ];

  it("agrees accounts whose movement matches, opening income accounts at zero", () => {
    const r = reconcileLedger([l("1000", 50000), l("4000", -90000), l("6100", 40000)], accounts, period);
    expect(r).toEqual({ agreed: 3, differences: [], unchecked: 2 });
  });

  it("ignores entries dated outside the period, so a reversal after the year end cannot hide an entry", () => {
    const after = { ...l("4000", 20000), date: "2026-01-03" };
    const afterBank = { ...l("1000", -20000), date: "2026-01-03" };
    // In the period: sales of 110,000 against bank. After it: 20,000 reversed. The period's movement is what counts.
    const r = reconcileLedger([l("1000", 70000), l("4000", -110000), l("6100", 40000), after, afterBank], accounts, period);
    expect(r.differences.map((d) => [d.code, d.differenceMinor])).toEqual([["1000", 20000], ["4000", -20000]]);
  });

  it("lists differences, largest first", () => {
    const r = reconcileLedger([l("1000", 49000), l("4000", -90000)], accounts, period);
    expect(r.agreed).toBe(1);
    expect(r.differences).toEqual([
      { code: "6100", name: "Rent", expectedMinor: 40000, ledgerMinor: 0, differenceMinor: -40000 },
      { code: "1000", name: "Bank", expectedMinor: 50000, ledgerMinor: 49000, differenceMinor: -1000 },
    ]);
  });
});

describe("the sample journal listing", () => {
  it("parses cleanly, every entry balances, and it shows the planted characteristics", () => {
    const parsed = parseLedger(parseCsv(readFileSync("samples/falcon-journals-2025.csv", "utf8")));
    expect(parsed.errors).toEqual([]);
    expect(new Set(parsed.lines.map((l) => l.entryNo)).size).toBe(16);
    const entries = flagEntries(parsed.lines, { periodStart: "2025-01-01", periodEnd: "2025-12-31", groupByAccount: new Map(parsed.lines.map((l) => [l.accountCode, "ADMIN"])) });
    const flags = (no: string) => entries.find((e) => e.entryNo === no)!.flags;
    expect(flags("JV-9001")).toEqual(["period_end", "round", "no_description"]);
    expect(flags("JV-9002")).toContain("outside_period");
    expect(flags("JV-9003")).toContain("weekend");
  });

  it("reconciles to the sample trial balance, apart from retained earnings", async () => {
    const buf = readFileSync("samples/falcon-tb-2025.xlsx");
    const tb = parseTrialBalance(await readGrid("tb.xlsx", buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer));
    const group = new Map(proposeMappings(tb.accounts, new Map()).suggestions.map((s) => [s.accountCode, s.groupCode]));
    const parsed = parseLedger(parseCsv(readFileSync("samples/falcon-journals-2025.csv", "utf8")));
    const r = reconcileLedger(
      parsed.lines,
      tb.accounts.map((a) => ({ ...a, groupCode: group.get(a.code) ?? null })),
      { start: "2025-01-01", end: "2025-12-31" },
    );
    expect(r.differences.map((d) => d.code)).toEqual(["3200"]);
    expect(r.unchecked).toBe(0);
    expect(r.agreed).toBe(tb.accounts.length - 1);
  });

  it("reads an Excel listing whose dates are real date cells", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Journals");
    ws.addRow(["Date", "Journal No", "Account Code", "Description", "Debit", "Credit"]);
    ws.addRow([new Date(Date.UTC(2025, 11, 31)), "JV-1", 1100, "Year-end sale", 2500.5, null]);
    ws.addRow([new Date(Date.UTC(2025, 11, 31)), "JV-1", 4000, "Year-end sale", null, 2500.5]);
    const data = await wb.xlsx.writeBuffer();
    const parsed = parseLedger(await readGrid("journals.xlsx", data as ArrayBuffer));
    expect(parsed.errors).toEqual([]);
    expect(parsed.lines).toEqual([
      { entryNo: "JV-1", date: "2025-12-31", postedBy: null, description: "Year-end sale", accountCode: "1100", accountName: null, amountMinor: 250050 },
      { entryNo: "JV-1", date: "2025-12-31", postedBy: null, description: "Year-end sale", accountCode: "4000", accountName: null, amountMinor: -250050 },
    ]);
  });

  it("handles a year's journals in reasonable time, including one very large entry", () => {
    const big = Array.from({ length: 50000 }, (_, i) => ({ entryNo: "BATCH", date: "2025-06-30", postedBy: null, description: "x", accountCode: String(1000 + (i % 50)), accountName: null, amountMinor: i % 2 === 0 ? 100 : -100 }));
    const many = Array.from({ length: 50000 }, (_, i) => ({ entryNo: "E" + Math.floor(i / 2), date: "2025-06-30", postedBy: null, description: "x", accountCode: String(1000 + (i % 50)), accountName: null, amountMinor: i % 2 === 0 ? 100 : -100 }));
    const ctx = { periodStart: "2025-01-01", periodEnd: "2025-12-31", groupByAccount: new Map<string, string | null>() };
    const start = Date.now();
    expect(flagEntries(big, ctx)).toHaveLength(1);
    expect(flagEntries(many, ctx)).toHaveLength(25000);
    expect(Date.now() - start).toBeLessThan(5000);
  });
});
