import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv, parseTrialBalance, type TbAccount } from "../src/domain/tb-parse";
import { preferRecognition, recogniseWorkbook, type Confidence, type Recognition } from "../src/domain/tb-recognise";

// One invented fixture per export shape, in tests/fixtures/tb-shapes. Each starts with a line saying how its shape was established. Every figure and name
// is invented, and the same ledger (cash 5,000, sales 20,000 and so on) is written in each shape, so a reading that took the period's movement, or an
// opening balance, instead of the closing balance shows up as a wrong figure.

const dir = path.join(__dirname, "fixtures", "tb-shapes");
const load = (name: string) => parseCsv(fs.readFileSync(path.join(dir, `${name}.csv`), "utf8"));

/** What the upload does with a sheet, in the order it does it (see uploadTrialBalanceAction): plain detection, unless the recogniser reads other closing balances; then the recogniser. */
function read(grid: string[][]): { via: "plain" | "recogniser" | "ask"; accounts: TbAccount[]; balanced: boolean; recognition: Recognition | null } {
  const plain = parseTrialBalance(grid);
  const recognition = recogniseWorkbook([{ name: "Sheet1", rows: grid }]);
  if (plain.errors.length === 0 && plain.balanced && !preferRecognition(plain.accounts, recognition)) return { via: "plain", accounts: plain.accounts, balanced: true, recognition };
  if (recognition && recognition.confidence.level !== "low") return { via: "recogniser", accounts: recognition.accounts, balanced: recognition.balanced, recognition };
  return { via: "ask", accounts: [], balanced: false, recognition };
}

interface Shape {
  system: string;
  file: string;
  via: "plain" | "recogniser";
  level: Confidence;
  /** Rows left out, with the sheet's row number (1-based, counting the source line) and why. */
  skipped?: number;
  roles?: Record<number, string>;
  ignored?: number[];
}
const SHAPES: Shape[] = [
  { system: "Tally Prime", file: "tally-prime", via: "recogniser", level: "medium", skipped: 6, roles: { 0: "name", 1: "debit", 2: "credit" } },
  { system: "Tally ERP 9", file: "tally-erp9", via: "plain", level: "high", skipped: 1 },
  { system: "Zoho Books", file: "zoho-books", via: "plain", level: "high", skipped: 6 },
  { system: "QuickBooks Online", file: "quickbooks-online", via: "recogniser", level: "medium", skipped: 1, roles: { 0: "name", 1: "debit", 2: "credit" } },
  { system: "QuickBooks Desktop", file: "quickbooks-desktop", via: "recogniser", level: "medium", skipped: 1, roles: { 0: "codename", 1: "debit", 2: "credit" } },
  { system: "Xero", file: "xero", via: "recogniser", level: "medium", skipped: 1, roles: { 0: "codename", 3: "debit", 4: "credit" }, ignored: [1, 2] },
  { system: "Sage 50 (UK)", file: "sage-50-uk", via: "plain", level: "high", skipped: 1 },
  { system: "Sage 300", file: "sage-300", via: "recogniser", level: "high", roles: { 0: "code", 1: "name", 5: "balance" }, ignored: [2, 3, 4] },
  { system: "SAP Business One", file: "sap-business-one", via: "recogniser", level: "high", roles: { 0: "code", 1: "name", 7: "balance" }, ignored: [2, 3, 4, 5, 6] },
  { system: "Odoo", file: "odoo", via: "recogniser", level: "medium", skipped: 1, roles: { 0: "codename", 4: "balance" }, ignored: [1, 2, 3] },
  { system: "Dynamics 365 Business Central", file: "business-central", via: "recogniser", level: "medium", roles: { 0: "code", 1: "name", 4: "debit", 5: "credit" }, ignored: [2, 3] },
  { system: "Dynamics NAV", file: "dynamics-nav", via: "recogniser", level: "high", roles: { 0: "code", 1: "name", 4: "debit", 5: "credit" }, ignored: [2, 3] },
  { system: "Dynamics GP", file: "dynamics-gp", via: "recogniser", level: "high", roles: { 0: "code", 1: "name", 6: "balance" }, ignored: [2, 3, 4, 5] },
  { system: "Dynamics AX / Finance and Operations", file: "dynamics-ax-fo", via: "recogniser", level: "high", roles: { 0: "code", 1: "name", 5: "balance" }, ignored: [2, 3, 4] },
  { system: "NetSuite", file: "netsuite", via: "plain", level: "medium", skipped: 3 },
  { system: "Focus", file: "focus", via: "plain", level: "high", skipped: 1 },
  { system: "MYOB", file: "myob", via: "recogniser", level: "high", skipped: 1, roles: { 0: "code", 1: "name", 2: "debit", 3: "credit" } },
  { system: "Wave", file: "wave", via: "recogniser", level: "high", skipped: 6, roles: { 0: "name", 1: "debit", 2: "credit" } },
  { system: "FreshBooks", file: "freshbooks", via: "plain", level: "high", skipped: 1 },
  { system: "Busy", file: "busy", via: "recogniser", level: "medium", skipped: 1, roles: { 0: "name", 4: "balance" }, ignored: [1, 2, 3] },
  { system: "Peachtree", file: "peachtree", via: "recogniser", level: "high", skipped: 1, roles: { 0: "code", 1: "name", 2: "debit", 3: "credit" } },
  { system: "ERPNext", file: "erpnext", via: "recogniser", level: "medium", skipped: 1, roles: { 0: "codename", 5: "debit", 6: "credit" }, ignored: [1, 2, 3, 4] },
  { system: "Generic layout", file: "generic", via: "plain", level: "high", skipped: 0 },
];

describe("each system's export shape", () => {
  it("has a fixture that says how its shape was established, and every fixture is covered here", () => {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".csv")).map((f) => f.replace(/\.csv$/, "")).sort();
    expect([...SHAPES.map((s) => s.file), "sage-intacct"].sort()).toEqual(files);
    for (const f of files) {
      const first = load(f)[0][0];
      expect(first, f).toMatch(/^Shape source: (from vendor documentation|from memory, UNVERIFIED|from third-party descriptions|a plain code)/);
    }
  });

  for (const shape of SHAPES) {
    it(`${shape.system}: reads the closing balances, balances, and says ${shape.via === "plain" ? "plain detection" : "the recogniser"} read it`, () => {
      const result = read(load(shape.file));
      expect(result.via).toBe(shape.via);
      expect(result.balanced).toBe(true);
      expect(result.accounts).toHaveLength(7);
      const find = (re: RegExp) => result.accounts.find((a) => re.test(a.name));
      expect(find(/cash|bank|checking|cheque/i)!.closingMinor).toBe(500000);
      expect(find(/sales/i)!.closingMinor).toBe(-2000000);
      expect(result.accounts.reduce((s, a) => s + a.closingMinor, 0)).toBe(0);
      // No opening balance, movement or adjustment is read as the prior year.
      expect(result.accounts.every((a) => a.priorMinor === null)).toBe(true);
      const rec = result.recognition!;
      expect(rec.confidence.level).toBe(shape.level);
      if (shape.skipped !== undefined) expect(rec.skipped).toHaveLength(shape.skipped);
      if (shape.roles) expect(rec.roles).toEqual(shape.roles);
      if (shape.ignored) expect(rec.ignoredColumns.map((c) => c.column)).toEqual(shape.ignored);
    });
  }

  it("Sage Intacct (adjusting columns beside the balances): does not guess which balance is wanted, so it asks and imports nothing", () => {
    const result = read(load("sage-intacct"));
    expect(result.via).toBe("ask");
    expect(result.accounts).toEqual([]);
    const rec = result.recognition!;
    expect(rec.confidence.level).toBe("low");
    expect(rec.confidence.reasons.join(" ")).toContain("adjusting columns");
    expect(rec.ignoredColumns.map((c) => c.column)).toEqual([4, 5]);
    // The chooser is filled in with what was found.
    expect(rec.prefill).toEqual({ headerRow: 3, columns: { code: 0, name: 1, debit: 2, credit: 3 } });
  });
});

describe("what the shapes showed about the recogniser", () => {
  it("does not take a title or company line above the heading for the top row of a two-row heading", () => {
    const rec = recogniseWorkbook([{ name: "s", rows: [["Invented Co"], ["Code", "Name", "Debit", "Credit"], ["1", "Cash", "5.00", ""], ["2", "Capital", "", "5.00"]] }])!;
    expect(rec.header).toEqual({ start: 1, end: 1 });
    expect(rec.confidence).toEqual({ level: "high", reasons: [] });
  });

  it("reads a heading with no word over the account column", () => {
    const rec = recogniseWorkbook([{ name: "s", rows: [["", "Debit", "Credit"], ["Cash", "5.00", ""], ["Capital", "", "5.00"]] }])!;
    expect(rec.roles).toEqual({ 0: "name", 1: "debit", 2: "credit" });
    expect(rec.confidence.reasons).toContain("The account column has no heading, so it was found from its cells.");
  });

  it("takes the year-to-date pair as the closing balance, with the plain Debit and Credit as the period's movement", () => {
    const rec = recogniseWorkbook([{ name: "s", rows: [["Account", "Debit", "Credit", "Debit - YTD", "Credit - YTD"], ["Cash", "1.00", "", "5.00", ""], ["Capital", "", "1.00", "", "5.00"]] }])!;
    expect(rec.roles).toEqual({ 0: "name", 3: "debit", 4: "credit" });
    expect(rec.ignoredColumns.map((c) => c.reason)).toEqual(["Movement for the period", "Movement for the period"]);
  });

  it("takes the Balance beside an opening balance and a Debit and Credit pair, and the Debit and Credit as movement", () => {
    const rec = recogniseWorkbook([{ name: "s", rows: [["Code", "Name", "Opening balance", "Debit", "Credit", "Balance"], ["1", "Cash", "4.00", "3.00", "2.00", "5.00"], ["2", "Capital", "-4.00", "2.00", "3.00", "-5.00"]] }])!;
    expect(rec.roles).toEqual({ 0: "code", 1: "name", 5: "balance" });
    expect(rec.accounts.map((a) => a.closingMinor)).toEqual([500, -500]);
  });

  it("reads Balance Debit and Balance Credit beside Net Change Debit and Net Change Credit", () => {
    const rec = recogniseWorkbook([{ name: "s", rows: [["No.", "Name", "Net Change Debit", "Net Change Credit", "Balance Debit", "Balance Credit"], ["1", "Cash", "1.00", "", "5.00", ""], ["2", "Capital", "", "1.00", "", "5.00"]] }])!;
    expect(rec.roles).toEqual({ 0: "code", 1: "name", 4: "debit", 5: "credit" });
  });

  it("splits an account code and name joined by a middle dot", () => {
    const rec = recogniseWorkbook([{ name: "s", rows: [["Account", "Debit", "Credit"], ["1000 · Checking", "5.00", ""], ["3000 · Capital", "", "5.00"]] }])!;
    expect(rec.accounts.map((a) => [a.code, a.name])).toEqual([["1000", "Checking"], ["3000", "Capital"]]);
  });

  it("reads the headings these systems use for the account number and the amounts (N/C, Account ID, Main account, Debit Amt, Name of Account)", () => {
    for (const [heading, roles] of [
      [["N/C", "Name", "Debit", "Credit"], { 0: "code", 1: "name", 2: "debit", 3: "credit" }],
      [["Account ID", "Account Description", "Debit Amt", "Credit Amt"], { 0: "code", 1: "name", 2: "debit", 3: "credit" }],
      [["Main account", "Name", "Debit", "Credit"], { 0: "code", 1: "name", 2: "debit", 3: "credit" }],
      [["Name of Account", "Debit", "Credit"], { 0: "name", 1: "debit", 2: "credit" }],
    ] as const) {
      const body = heading.length === 4 ? [["1", "Cash", "5.00", ""], ["2", "Capital", "", "5.00"]] : [["Cash", "5.00", ""], ["Capital", "", "5.00"]];
      expect(recogniseWorkbook([{ name: "s", rows: [[...heading], ...body] }])!.roles, heading.join("|")).toEqual(roles);
    }
  });

  it("prefers the recogniser only when it reads different closing balances and is not unsure", () => {
    const plain: TbAccount[] = [{ code: "1", name: "Cash", closingMinor: 100, priorMinor: null }, { code: "2", name: "Capital", closingMinor: -100, priorMinor: null }];
    const same = recogniseWorkbook([{ name: "s", rows: [["Code", "Name", "Debit", "Credit"], ["1", "Cash", "1.00", ""], ["2", "Capital", "", "1.00"]] }]);
    expect(preferRecognition(plain, same)).toBe(false);
    const other = recogniseWorkbook([{ name: "s", rows: [["Code", "Name", "Debit", "Credit"], ["1", "Cash", "5.00", ""], ["2", "Capital", "", "5.00"]] }]);
    expect(preferRecognition(plain, other)).toBe(true);
    expect(preferRecognition(plain, null)).toBe(false);
    const unsure = recogniseWorkbook([{ name: "s", rows: [["Code", "Name", "Debit", "Credit"], ["1", "Cash", "5.00", ""], ["2", "Capital", "", "4.00"]] }]);
    expect(unsure!.confidence.level).toBe("low");
    expect(preferRecognition(plain, unsure)).toBe(false);
  });
});
