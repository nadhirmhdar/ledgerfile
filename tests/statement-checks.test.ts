import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildStatementPack,
  consistencyChecks,
  CASH_FLOW_CHECK_LABEL,
  EQUITY_CHECK_LABEL,
  PACK_BLOCKING_CHECK_LABELS,
  packBlockers,
  NOTE_TOTALS_CHECK_LABEL,
  PLACEHOLDERS_CHECK_LABEL,
  PROFIT_CHECK_LABEL,
  placeholderCheck,
  type ConsistencyParts,
  type PackAccount,
} from "../src/domain/statement-pack";
import { placeholderCount } from "../src/domain/placeholders";
import { severityOf, type Check } from "../src/domain/statements";
import { lockReadiness } from "../src/domain/signoff";
import { BASIS_KEY, GENERAL_KEY, POLICIES_KEY } from "../src/domain/note-texts";
import { parseTrialBalance } from "../src/domain/tb-parse";
import { checkFix, checksSentence, orderChecks } from "../src/ui/statements-view";
import { proposeMappings } from "./rule-mapping";
import { readGrid } from "../src/server/excel";

let n = 0;
const acct = (groupCode: string | null, name: string, closingMinor: number, priorMinor: number | null): PackAccount => ({ code: String(1000 + n++), name, groupCode, closingMinor, priorMinor, approved: true });

/**
 * An invented company, in ledger sign (debits positive), with cents so that whole-unit rounding leaves a difference to place. Seven groups have two
 * accounts or more, so seven notes carry a table. Cash is the balancing figure, so both years add to zero.
 */
function books(comparatives = true): PackAccount[] {
  n = 0;
  const rows: [string, string, number, number][] = [
    // Two debit balances end in exactly 50 cents, so both round up and nothing rounds down to offset them: the rounded books are out by one unit.
    ["PPE", "Equipment", 4300050, 4000050],
    ["PPE", "Vehicles", 1250050, 1250050],
    ["INVENT", "Raw materials", 500000, 400000],
    ["INVENT", "Finished goods", 400000, 400000],
    ["TRADEREC", "Receivables", 1800000, 1500000],
    ["TRADEREC", "Prepayments", 200000, 200000],
    ["TRADEPAY", "Payables", -1200000, -1000000],
    ["TRADEPAY", "Accruals", -100000, -200000],
    ["BORROW", "Bank loan", -1600000, -2000000],
    ["BORROW", "Term loan", -400000, -400000],
    ["CAPITAL", "Share capital", -3000000, -3000000],
    ["RETAINED", "Retained earnings", -500000, -400000],
    ["REVENUE", "Sales", -10000000, -8000000],
    ["REVENUE", "Services", -500000, -300000],
    ["COS", "Cost of sales", 6000000, 5000000],
    ["DEPN", "Depreciation expense", 500000, 500000],
    ["ADMIN", "Rent", 1000000, 1000000],
    ["ADMIN", "Utilities", 300000, 300000],
    ["FINCOST", "Interest on loan", 200000, 200000],
    ["TAXEXP", "Corporate tax expense", 90000, 70000],
  ];
  const all = rows.map(([g, name, c, p]) => acct(g, name, c, comparatives ? p : null));
  const cash = acct("CASH", "Bank", -all.reduce((s, a) => s + a.closingMinor, 0), comparatives ? -all.reduce((s, a) => s + (a.priorMinor ?? 0), 0) : null);
  return [...all, cash];
}

const parts = (pack: ReturnType<typeof buildStatementPack>, unitMinor = 1): ConsistencyParts => ({ base: pack.base, equity: pack.equity, cashFlow: pack.cashFlow, notes: pack.notes, unitMinor });
const clone = <T,>(x: T): T => structuredClone(x);
const byLabel = (checks: Check[], label: string) => checks.find((c) => c.label === label)!;

describe("the two error checks and the warning pass on a normal pack", () => {
  for (const comparatives of [true, false]) {
    for (const unitMinor of [1, 100]) {
      it(`${comparatives ? "with" : "without"} comparatives, ${unitMinor === 1 ? "exact" : "whole units"}`, () => {
        const pack = buildStatementPack(books(comparatives), { unitMinor });
        expect(pack.notes.filter((x) => x.table)).toHaveLength(7);
        expect(byLabel(pack.checks, PROFIT_CHECK_LABEL)).toMatchObject({ passed: true });
        expect(byLabel(pack.checks, NOTE_TOTALS_CHECK_LABEL)).toMatchObject({ passed: true });
        expect(pack.checks.filter((c) => !c.passed && severityOf(c) === "error")).toEqual([]);
        expect(pack.equity !== null).toBe(comparatives);
        expect(pack.cashFlow !== null).toBe(comparatives);
        // The only open item is the warning: the generated notes still have [placeholders].
        expect(pack.checks.filter((c) => !c.passed).map((c) => c.label)).toEqual([PLACEHOLDERS_CHECK_LABEL]);
        expect(pack.clean).toBe(true);
      });
    }
  }
});

describe("why the checks hold under whole-unit rounding", () => {
  it("places a rounding difference through one account, and still every figure agrees", () => {
    const exact = buildStatementPack(books());
    const whole = buildStatementPack(books(), { unitMinor: 100 });
    // The books do not round evenly: the difference exists, and it is placed in one named account for each year.
    expect(whole.rounding.current).not.toBeNull();
    expect(whole.rounding.prior).not.toBeNull();
    expect(exact.rounding.current).toBeNull();
    // Every note total is a whole number of units and equals its face line; profit is the same in all three statements.
    for (const note of whole.notes.filter((x) => x.table)) {
      expect(note.table!.totalCurrent % 100, note.title).toBe(0);
      expect(note.table!.totalCurrent).toBe(note.table!.rows.reduce((s, r) => s + r.current, 0));
    }
    const profit = whole.base.comprehensiveIncome.find((l) => l.key === "PROFIT")!.current;
    expect(profit % 100).toBe(0);
    expect(whole.equity!.rows.find((r) => r.key === "profit")!.total).toBe(profit);
    expect(byLabel(whole.checks, PROFIT_CHECK_LABEL).passed).toBe(true);
    expect(byLabel(whole.checks, NOTE_TOTALS_CHECK_LABEL).passed).toBe(true);
  });

  it("keeps the split borrowings lines adding to the note, because the rounded split comes out of one line and into the other", () => {
    const whole = buildStatementPack(books(), { unitMinor: 100, borrowingsCurrent: { current: 333333, prior: 411111 } });
    const lines = [...whole.base.financialPosition.flatMap((s) => s.lines)].filter((l) => l.groupCode === "BORROW");
    expect(lines.map((l) => l.key).sort()).toEqual(["BORROW", "BORROW_CUR"]);
    expect(byLabel(whole.checks, NOTE_TOTALS_CHECK_LABEL).passed).toBe(true);
    expect(lines.reduce((s, l) => s + l.current, 0)).toBe(whole.notes.find((x) => x.groupCode === "BORROW")!.table!.totalCurrent);
  });

  it("does not hide a real difference: a figure forced off by one unit still fails after rounding", () => {
    const whole = buildStatementPack(books(), { unitMinor: 100 });
    const tampered = clone(parts(whole, 100));
    tampered.notes.find((x) => x.table)!.table!.totalCurrent += 100;
    expect(byLabel(consistencyChecks(tampered), NOTE_TOTALS_CHECK_LABEL).passed).toBe(false);
  });
});

describe("profit for the year agrees across the statements", () => {
  const pack = buildStatementPack(books());
  const profit = pack.base.comprehensiveIncome.find((l) => l.key === "PROFIT")!.current;

  it("fails and names the statement when the statement of changes in equity differs", () => {
    const t = clone(parts(pack));
    t.equity!.rows.find((r) => r.key === "profit")!.total += 500;
    const check = byLabel(consistencyChecks(t), PROFIT_CHECK_LABEL);
    expect(check.passed).toBe(false);
    expect(check.severity).toBeUndefined();
    expect(check.detail).toBe(`The income statement shows profit for the year of ${(profit / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}, but the statement of changes in equity shows ${((profit + 500) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}, 5.00 different.`);
  });

  it("fails and names the cash flow statement when it starts from the wrong profit", () => {
    const t = clone(parts(pack));
    t.cashFlow!.sections.flatMap((s) => s.lines).find((l) => l.key === "PBT")!.current -= 1250;
    const check = byLabel(consistencyChecks(t), PROFIT_CHECK_LABEL);
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("the cash flow statement starts from profit before tax of");
    expect(check.detail).toContain("-12.50 different");
    expect(check.detail).not.toContain("changes in equity");
  });

  it("names both when both differ", () => {
    const t = clone(parts(pack));
    t.equity!.rows.find((r) => r.key === "profit")!.total += 100;
    t.cashFlow!.sections.flatMap((s) => s.lines).find((l) => l.key === "PBT")!.current += 200;
    const detail = byLabel(consistencyChecks(t), PROFIT_CHECK_LABEL).detail!;
    expect(detail).toContain("the statement of changes in equity shows");
    expect(detail).toContain(", and the cash flow statement starts from");
  });

  it("checks only the statements that exist, and passes with none", () => {
    const t = { ...clone(parts(pack)), equity: null, cashFlow: null };
    expect(byLabel(consistencyChecks(t), PROFIT_CHECK_LABEL).passed).toBe(true);
  });
});

describe("every note total agrees to its line on the statements", () => {
  const pack = buildStatementPack(books());
  const withTable = pack.notes.filter((x) => x.table);

  it("names the note, both amounts and the difference, for the current year and the prior year", () => {
    const t = clone(parts(pack));
    const note = t.notes.find((x) => x.table)!;
    note.table!.totalCurrent += 250;
    note.table!.totalPrior -= 100;
    const check = byLabel(consistencyChecks(t), NOTE_TOTALS_CHECK_LABEL);
    expect(check.passed).toBe(false);
    expect(check.detail).toBe("1 note(s) do not agree to the statements.");
    expect(check.items).toHaveLength(1);
    expect(check.items![0]).toMatch(new RegExp(`^Note ${note.number}, ${note.title}: note total [\\d,.]+, statements [\\d,.]+, difference 2\\.50; prior year: note total [\\d,.]+, statements [\\d,.]+, difference -1\\.00$`));
  });

  it("lists up to five notes, then says how many more", () => {
    const six = clone(parts(pack));
    six.notes.filter((x) => x.table).slice(0, 6).forEach((x) => (x.table!.totalCurrent += 100));
    const sixItems = byLabel(consistencyChecks(six), NOTE_TOTALS_CHECK_LABEL).items!;
    expect(sixItems).toHaveLength(6);
    expect(sixItems[5]).toBe("and 1 more");

    const all = clone(parts(pack));
    all.notes.filter((x) => x.table).forEach((x) => (x.table!.totalCurrent += 100));
    const check = byLabel(consistencyChecks(all), NOTE_TOTALS_CHECK_LABEL);
    expect(withTable).toHaveLength(7);
    expect(check.detail).toBe("7 note(s) do not agree to the statements.");
    expect(check.items).toHaveLength(6);
    expect(check.items!.slice(0, 5).every((i) => i.startsWith("Note "))).toBe(true);
    expect(check.items![5]).toBe("and 2 more");
    // Exactly five notes: no "more" line.
    const five = clone(parts(pack));
    five.notes.filter((x) => x.table).slice(0, 5).forEach((x) => (x.table!.totalCurrent += 100));
    expect(byLabel(consistencyChecks(five), NOTE_TOTALS_CHECK_LABEL).items).toHaveLength(5);
  });

  it("ignores the prior year when there are no comparatives", () => {
    const noComp = buildStatementPack(books(false));
    const t = clone(parts(noComp));
    t.notes.find((x) => x.table)!.table!.totalPrior += 999;
    expect(byLabel(consistencyChecks(t), NOTE_TOTALS_CHECK_LABEL).passed).toBe(true);
  });
});

describe("no placeholders left in the notes", () => {
  it("is a warning with the page's own count and the notes that still have them", () => {
    const pack = buildStatementPack(books());
    const check = byLabel(pack.checks, PLACEHOLDERS_CHECK_LABEL);
    // The same expression the statements page uses for its total.
    const onPage = placeholderCount(pack.notes.flatMap((x) => [...x.paragraphs, ...(x.subsections ?? []).flatMap((s) => s.paragraphs)]));
    expect(onPage).toBeGreaterThan(0);
    expect(check.passed).toBe(false);
    expect(severityOf(check)).toBe("warning");
    expect(check.detail).toMatch(new RegExp(`^${onPage} placeholders? still to complete, in notes? [\\d, and]+\\.$`));
    expect(check.detail).toContain("1");
  });

  it("never changes clean, and passes once every placeholder has been written over", () => {
    const first = buildStatementPack(books());
    expect(first.clean).toBe(true);
    const policies = first.notes.find((x) => x.key === POLICIES_KEY)!;
    const noteTexts: Record<string, string[]> = { [GENERAL_KEY]: ["A trading company."], [BASIS_KEY]: ["Prepared under IFRS for SMEs."], [POLICIES_KEY]: ["Policies are set out below."] };
    for (const s of policies.subsections ?? []) noteTexts[s.key] = ["Reviewed wording."];
    const done = buildStatementPack(books(), { noteTexts });
    expect(byLabel(done.checks, PLACEHOLDERS_CHECK_LABEL)).toMatchObject({ passed: true });
    expect(done.checks.every((c) => c.passed)).toBe(true);
    expect(done.clean).toBe(true);
  });

  it("a placeholder in a policy passage counts, and is named by the note it is in", () => {
    const pack = buildStatementPack(books());
    const policies = pack.notes.find((x) => x.key === POLICIES_KEY)!;
    const t = clone(pack.notes);
    t.find((x) => x.key === POLICIES_KEY)!.subsections = (policies.subsections ?? []).map((s) => ({ ...s, paragraphs: ["Done."] }));
    t.find((x) => x.key === POLICIES_KEY)!.paragraphs = ["Done."];
    t.find((x) => x.number === 1)!.paragraphs = ["[One] and [two]."];
    t.find((x) => x.number === 2)!.paragraphs = ["Done."];
    expect(placeholderCheck(t).detail).toBe("2 placeholders still to complete, in note 1.");
  });

  it("is not one of the checks that stop a lock", () => {
    expect(PACK_BLOCKING_CHECK_LABELS).toEqual([CASH_FLOW_CHECK_LABEL, EQUITY_CHECK_LABEL, PROFIT_CHECK_LABEL, NOTE_TOTALS_CHECK_LABEL]);
    expect(packBlockers(buildStatementPack(books()).checks)).toEqual([]);
    for (const label of PACK_BLOCKING_CHECK_LABELS) {
      const checks = buildStatementPack(books()).checks.map((c) => (c.label === label ? { ...c, passed: false } : c));
      expect(packBlockers(checks), label).toEqual([label]);
    }
    const pack = buildStatementPack(books());
    const ready = lockReadiness({ statementsClean: pack.clean, failedChecks: [], leadSheets: [], openPoints: 0 });
    expect(ready.blockers.some((b) => b.includes("placeholder"))).toBe(false);
    // An error check that failed does stop it, worded as every statement check is.
    const blocked = lockReadiness({ statementsClean: false, failedChecks: [PROFIT_CHECK_LABEL], leadSheets: [], openPoints: 0 });
    expect(blocked.ready).toBe(false);
    expect(blocked.blockers).toContain(`Statement check failed: ${PROFIT_CHECK_LABEL}.`);
  });
});

describe("how the statements page reads them", () => {
  const pack = buildStatementPack(books());
  it("says the error checks pass and a warning needs attention, and is a draft only for an error", () => {
    expect(checksSentence(pack.checks)).toBe("Every error check passes; 1 warning needs attention.");
    expect(checksSentence([{ passed: false }, { passed: true }])).toBe("Draft: 1 of 2 checks outstanding.");
    expect(checksSentence([{ passed: false, severity: "warning" }, { passed: false }, { passed: true }])).toBe("Draft: 1 of 3 checks outstanding.");
  });
  it("lists failed errors, then warnings, then passed checks", () => {
    const ordered = orderChecks([{ label: "p", passed: true }, { label: "w", passed: false, severity: "warning" as const }, { label: "e", passed: false }]);
    expect(ordered.map((c) => c.label)).toEqual(["e", "w", "p"]);
  });
  it("links each to where it is put right", () => {
    expect(checkFix(PROFIT_CHECK_LABEL, "x")).toEqual({ href: "#sci", text: "Go to the income statement" });
    expect(checkFix(NOTE_TOTALS_CHECK_LABEL, "x")).toEqual({ href: "#notes", text: "Go to the notes" });
    expect(checkFix(PLACEHOLDERS_CHECK_LABEL, "x")).toEqual({ href: "#notes", text: "Go to the notes" });
  });
});

describe("the sample client's 2025 file", () => {
  it("passes both error checks, exact and in whole units", async () => {
    const buf = readFileSync("samples/falcon-tb-2025.xlsx");
    const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const parsed = parseTrialBalance(await readGrid("falcon-tb-2025.xlsx", data));
    const { suggestions } = proposeMappings(parsed.accounts, new Map());
    const group = new Map(suggestions.map((s) => [s.accountCode, s.groupCode]));
    const accounts: PackAccount[] = parsed.accounts.map((a) => ({ ...a, groupCode: group.get(a.code) ?? null, approved: true }));
    for (const unitMinor of [1, 100]) {
      const pack = buildStatementPack(accounts, { unitMinor });
      expect(byLabel(pack.checks, PROFIT_CHECK_LABEL).passed).toBe(true);
      expect(byLabel(pack.checks, NOTE_TOTALS_CHECK_LABEL).passed).toBe(true);
      expect(pack.notes.filter((x) => x.table).length).toBeGreaterThan(3);
    }
  });
});
