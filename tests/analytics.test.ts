import { describe, expect, it } from "vitest";
import { buildStatements, type StatementAccount } from "../src/domain/statements";
import { compareYears, computeRatios, explanationStands, flagFor, percentChange, unexplainedMovements, FLAG_PERCENT } from "../src/domain/analytics";

const acct = (groupCode: string, closing: number, prior: number | null): StatementAccount => ({ groupCode, closingMinor: closing, priorMinor: prior, approved: true });
const T = { performanceMinor: 100_000, trivialMinor: 5_000 };

describe("percentChange", () => {
  it("is the change over the size of the prior balance", () => {
    expect(percentChange(110, 100)).toEqual({ pct: 10, note: null });
    expect(percentChange(50, 100)).toEqual({ pct: -50, note: null });
    expect(percentChange(100, 100)).toEqual({ pct: 0, note: null });
  });
  it("never divides by zero", () => {
    expect(percentChange(500, 0)).toEqual({ pct: null, note: "no prior balance" });
    expect(percentChange(0, 0)).toEqual({ pct: 0, note: null });
  });
  it("gives no percentage across a sign change, but does for a balance that falls to zero", () => {
    expect(percentChange(-40, 100)).toEqual({ pct: null, note: "sign change" });
    expect(percentChange(40, -100)).toEqual({ pct: null, note: "sign change" });
    expect(percentChange(0, 100)).toEqual({ pct: -100, note: null });
    // The size of a negative prior balance is used, so a smaller overdraft is a fall of the right size.
    expect(percentChange(-50, -100)).toEqual({ pct: 50, note: null });
  });
});

describe("flagFor", () => {
  it("flags a change of at least performance materiality, at exactly the boundary", () => {
    expect(flagFor(500_000 + 99_999, 500_000, T)).toMatchObject({ basis: "percentage" });
    expect(flagFor(10_000_000 + 99_999, 10_000_000, T)).toBeNull();
    expect(flagFor(10_000_000 + 100_000, 10_000_000, T)).toMatchObject({ basis: "materiality" });
    expect(flagFor(10_000_000 - 100_000, 10_000_000, T)?.reason).toContain("performance materiality");
  });
  it("flags the percentage rule at its boundary, and only above the clearly-trivial amount", () => {
    expect(FLAG_PERCENT).toBe(10);
    // 10% of 50,000 is 5,000: at the percentage but not above trivial.
    expect(flagFor(55_000, 50_000, T)).toBeNull();
    // 10% of 50,100 is 5,010: above trivial.
    expect(flagFor(55_110, 50_100, T)).toMatchObject({ basis: "percentage" });
    // Just under 10%.
    expect(flagFor(100_000 + 9_999, 100_000, { performanceMinor: 1_000_000, trivialMinor: 0 })).toBeNull();
    expect(flagFor(100_000 + 10_000, 100_000, { performanceMinor: 1_000_000, trivialMinor: 0 })).toMatchObject({ basis: "percentage" });
  });
  it("flags a balance that appears or changes sign once it is above trivial", () => {
    expect(flagFor(6_000, 0, T)).toMatchObject({ basis: "percentage" });
    expect(flagFor(5_000, 0, T)).toBeNull();
    expect(flagFor(-6_000, 6_000, T)).toMatchObject({ basis: "percentage" });
  });
  it("does not flag no change, and says why when it does flag", () => {
    expect(flagFor(500, 500, T)).toBeNull();
    expect(flagFor(0, 0, T)).toBeNull();
    expect(flagFor(250_000, 100_000, T)!.reason).toMatch(/1,500\.00.*performance materiality \(1,000\.00\)/);
  });
});

describe("compareYears", () => {
  // Invented figures, in fils. Ledger sign: debit positive.
  const accounts = [
    acct("CASH", 30_000_00, 20_000_00),
    acct("TRADEREC", 25_000_00, 25_500_00),
    acct("INVENT", 0, 4_000_00),
    acct("CAPITAL", -10_000_00, -10_000_00),
    acct("REVENUE", -120_000_00, -100_000_00),
    acct("COS", 70_000_00, 60_000_00),
    acct("ADMIN", 15_000_00, 14_900_00),
    acct("TRADEPAY", -20_000_00, -12_400_00),
  ];
  const statements = buildStatements(accounts);

  it("lists every line with a balance in either year, with its movement", () => {
    const rows = compareYears(statements, T);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    expect(byKey.get("INVENT")).toMatchObject({ current: 0, prior: 4_000_00, change: -4_000_00, pct: -100 });
    expect(byKey.get("REVENUE")).toMatchObject({ current: 120_000_00, prior: 100_000_00, change: 20_000_00, pct: 20 });
    expect(byKey.has("OTHERINC")).toBe(false);
    expect(byKey.has("TAXEXP")).toBe(false);
    // The year's result is shown once, in the income statement.
    expect(rows.filter((r) => r.label === "Profit for the year")).toHaveLength(1);
    expect(byKey.get("GROSS")).toMatchObject({ kind: "subtotal", current: 50_000_00, prior: 40_000_00 });
  });

  it("flags plain lines only, by the rule, and not subtotals", () => {
    const flagged = compareYears(statements, T).filter((r) => r.flag).map((r) => r.key).sort();
    expect(flagged).toEqual(["CASH", "COS", "INVENT", "REVENUE", "TRADEPAY"]);
  });

  it("flags nothing without materiality or without a prior year", () => {
    expect(compareYears(statements, null).some((r) => r.flag)).toBe(false);
    const single = buildStatements(accounts.map((a) => ({ ...a, priorMinor: null })));
    expect(single.hasComparatives).toBe(false);
    expect(compareYears(single, T).some((r) => r.flag)).toBe(false);
  });

  it("copes with a prior balance of zero and with a sign change", () => {
    const s = buildStatements([acct("CASH", 9_000_00, 0), acct("TRADEPAY", -9_000_00, 0), acct("BORROW", -3_000_00, 3_000_00), acct("CAPITAL", -1, -1), acct("REVENUE", -1, -1)]);
    const rows = new Map(compareYears(s, T).map((r) => [r.key, r]));
    expect(rows.get("CASH")).toMatchObject({ pct: null, pctNote: "no prior balance" });
    expect(rows.get("BORROW")).toMatchObject({ current: 3_000_00, prior: -3_000_00, pct: null, pctNote: "sign change" });
  });
});

describe("explanations that stand", () => {
  const statements = buildStatements([acct("CASH", 30_000_00, 20_000_00), acct("CAPITAL", -30_000_00, -20_000_00)]);
  const rows = compareYears(statements, T);

  it("count as unexplained until one stands for both years' figures", () => {
    const cash = rows.find((r) => r.key === "CASH")!;
    expect(unexplainedMovements(rows, []).map((r) => r.key)).toEqual(expect.arrayContaining(["CASH"]));
    expect(unexplainedMovements(rows, [{ lineKey: "CASH", currentMinor: cash.current, priorMinor: cash.prior }]).map((r) => r.key)).not.toContain("CASH");
    expect(unexplainedMovements(rows, [{ lineKey: "CASH", currentMinor: cash.current + 1, priorMinor: cash.prior }]).map((r) => r.key)).toContain("CASH");
    expect(unexplainedMovements(rows, [{ lineKey: "CASH", currentMinor: cash.current, priorMinor: cash.prior - 1 }]).map((r) => r.key)).toContain("CASH");
    expect(explanationStands({ lineKey: "CASH", currentMinor: cash.current, priorMinor: cash.prior }, cash)).toBe(true);
  });
});

describe("computeRatios", () => {
  const ratios = (accounts: StatementAccount[]) => Object.fromEntries(computeRatios(buildStatements(accounts)).map((r) => [r.key, r]));

  const full = [
    acct("CASH", 30_000_00, 10_000_00),
    acct("TRADEREC", 40_000_00, 20_000_00),
    acct("INVENT", 30_000_00, 10_000_00),
    acct("CAPITAL", -50_000_00, -50_000_00),
    acct("BORROW", -25_000_00, -10_000_00),
    acct("TRADEPAY", -50_000_00, -10_000_00),
    acct("REVENUE", -365_000_00, -182_500_00),
    acct("COS", 219_000_00, 73_000_00),
    acct("ADMIN", 100_000_00, 60_000_00),
  ];
  // Profit: current 365,000 − 219,000 − 100,000 = 46,000; prior 182,500 − 73,000 − 60,000 = 49,500.
  // Equity: current 50,000 + 46,000 = 96,000; prior 50,000 + 49,500 = 99,500. (Not balanced; ratios do not need it.)

  it("works out each ratio for both years from period-end balances", () => {
    const r = ratios(full);
    expect(r.CURRENT.current).toBeCloseTo(100 / 50, 6);
    expect(r.CURRENT.prior).toBeCloseTo(40 / 10, 6);
    expect(r.CURRENT.change).toBeCloseTo(2 - 4, 6);
    expect(r.QUICK.current).toBeCloseTo(70 / 50, 6);
    expect(r.WORKCAP.current).toBe(50_000_00);
    expect(r.WORKCAP.prior).toBe(30_000_00);
    expect(r.GROSSM.current).toBeCloseTo(((365 - 219) / 365) * 100, 6);
    expect(r.NETM.current).toBeCloseTo((46 / 365) * 100, 6);
    expect(r.RECDAYS.current).toBeCloseTo(40, 6);
    expect(r.PAYDAYS.current).toBeCloseTo((50 / 219) * 365, 6);
    expect(r.INVDAYS.current).toBeCloseTo((30 / 219) * 365, 6);
    expect(r.DEBTEQ.current).toBeCloseTo(25 / 96, 6);
    expect(r.ROE.current).toBeCloseTo((46 / 96) * 100, 6);
    expect(r.ROE.prior).toBeCloseTo((49.5 / 99.5) * 100, 6);
    for (const x of Object.values(r)) expect(x.formula.length).toBeGreaterThan(5);
  });

  it("is n/a when a denominator is zero or an input is missing", () => {
    const r = ratios([acct("CASH", 10_000_00, 10_000_00), acct("CAPITAL", -10_000_00, -10_000_00)]);
    // No current liabilities, no revenue, no cost of sales.
    for (const k of ["CURRENT", "QUICK", "GROSSM", "NETM", "RECDAYS", "PAYDAYS", "INVDAYS"]) expect(r[k], k).toMatchObject({ current: null, prior: null, change: null });
    expect(r.WORKCAP.current).toBe(10_000_00);
    // Equity is there but there are no borrowings or profit: zero, which is a ratio, not n/a.
    expect(r.DEBTEQ.current).toBe(0);
    expect(r.ROE.current).toBe(0);
  });

  it("is n/a for return on equity and debt to equity when equity is zero or negative", () => {
    const zero = ratios([acct("CASH", 5_000_00, 5_000_00), acct("BORROW", -5_000_00, -5_000_00)]);
    expect(zero.DEBTEQ).toMatchObject({ current: null, prior: null });
    expect(zero.ROE).toMatchObject({ current: null, prior: null });
    const negative = ratios([acct("CASH", 5_000_00, 5_000_00), acct("CAPITAL", 2_000_00, 2_000_00), acct("BORROW", -7_000_00, -7_000_00)]);
    expect(negative.DEBTEQ.current).toBeNull();
  });

  it("is n/a for the prior year when there is none, and working capital is n/a when there are no current items", () => {
    const noPrior = ratios(full.map((a) => ({ ...a, priorMinor: null })));
    expect(noPrior.CURRENT.current).not.toBeNull();
    expect(noPrior.CURRENT.prior).toBeNull();
    expect(noPrior.CURRENT.change).toBeNull();
    const fixedOnly = ratios([acct("PPE", 9_000_00, 9_000_00), acct("CAPITAL", -9_000_00, -9_000_00)]);
    expect(fixedOnly.WORKCAP).toMatchObject({ current: null, prior: null });
  });

  it("is n/a for a year with no balances at all", () => {
    const r = ratios([acct("CASH", 9_000_00, 0), acct("CAPITAL", -9_000_00, 0), acct("TRADEPAY", -1, 0)]);
    expect(r.CURRENT.prior).toBeNull();
    expect(r.WORKCAP.prior).toBeNull();
  });
});
