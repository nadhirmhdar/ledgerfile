import { describe, expect, it } from "vitest";
import {
  coverage,
  difference,
  differenceUnexplained,
  isCreditGroup,
  isKeyItem,
  needsFinishing,
  presentationBalance,
  scheduleBlockers,
  scheduleTotal,
  thresholdAmount,
  thresholdAmounts,
  type ScheduleState,
} from "../src/domain/test-schedule";
import { gridFromText, parseListing } from "../src/domain/listing-parse";
import { normaliseTickmarks, TICKMARKS } from "../src/domain/tickmarks";

describe("totals, balance and difference", () => {
  it("adds the lines and compares them with the balance", () => {
    expect(scheduleTotal([{ amountMinor: 100_00 }, { amountMinor: 250_50 }, { amountMinor: -50_00 }])).toBe(300_50);
    expect(scheduleTotal([])).toBe(0);
    expect(difference(300_50, 300_50)).toBe(0);
    expect(difference(300_50, 400_00)).toBe(-99_50);
  });

  it("states the balance on the side it normally falls, so a payables listing agrees with positive amounts", () => {
    const accounts = [
      { groupCode: "TRADEPAY", closingMinor: -30_000_00 },
      { groupCode: "TRADEPAY", closingMinor: -5_000_00 },
      { groupCode: "TRADEREC", closingMinor: 9_000_00 },
      { groupCode: null, closingMinor: 99 },
    ];
    expect(isCreditGroup("TRADEPAY")).toBe(true);
    expect(isCreditGroup("TRADEREC")).toBe(false);
    expect(isCreditGroup("REVENUE")).toBe(true);
    expect(isCreditGroup("ADMIN")).toBe(false);
    expect(presentationBalance(accounts, "TRADEPAY")).toBe(35_000_00);
    expect(presentationBalance(accounts, "TRADEREC")).toBe(9_000_00);
    // A group with nothing in it is zero, never negative zero.
    expect(Object.is(presentationBalance(accounts, "REVENUE"), 0)).toBe(true);
    // A debit balance on a credit group (an overdrawn supplier) shows as negative.
    expect(presentationBalance([{ groupCode: "TRADEPAY", closingMinor: 2_00 }], "TRADEPAY")).toBe(-2_00);
  });
});

describe("thresholds and key items", () => {
  const m = { overallMinor: 1_000_00, performanceMinor: 750_00 };
  it("offers overall, performance, and half and a quarter of performance materiality", () => {
    expect(thresholdAmounts(m)).toEqual({ overall: 1_000_00, performance: 750_00, half_performance: 375_00, quarter_performance: 187_50 });
    expect(thresholdAmounts({ overallMinor: 1, performanceMinor: 3 }).half_performance).toBe(2);
    expect(thresholdAmount(m, "half_performance")).toBe(375_00);
    expect(thresholdAmount(null, "performance")).toBe(0);
  });
  it("marks a line at or above the threshold, in either direction, and nothing without a threshold", () => {
    expect(isKeyItem(375_00, 375_00)).toBe(true);
    expect(isKeyItem(374_99, 375_00)).toBe(false);
    expect(isKeyItem(-375_00, 375_00)).toBe(true);
    expect(isKeyItem(-374_99, 375_00)).toBe(false);
    expect(isKeyItem(1_000_000_00, 0)).toBe(false);
  });
});

describe("coverage", () => {
  it("is the value and share of the listing marked tested, with key items", () => {
    const lines = [
      { amountMinor: 500_00, tested: true },
      { amountMinor: 300_00, tested: false },
      { amountMinor: 200_00, tested: true },
    ];
    expect(coverage(lines, 300_00)).toEqual({ testedMinor: 700_00, totalMinor: 1_000_00, pct: 70, keyItems: 2, keyItemsTested: 1, allKeyItemsTested: false });
    expect(coverage(lines, 500_00)).toMatchObject({ keyItems: 1, keyItemsTested: 1, allKeyItemsTested: true });
    expect(coverage(lines, 0)).toMatchObject({ keyItems: 0, allKeyItemsTested: true });
  });
  it("uses absolute values so debits and credits do not cancel, and has no percentage for a zero total", () => {
    expect(coverage([{ amountMinor: 100_00, tested: true }, { amountMinor: -100_00, tested: false }], 0)).toMatchObject({ totalMinor: 200_00, testedMinor: 100_00, pct: 50 });
    expect(coverage([], 100_00)).toEqual({ testedMinor: 0, totalMinor: 0, pct: null, keyItems: 0, keyItemsTested: 0, allKeyItemsTested: true });
    expect(coverage([{ amountMinor: 0, tested: true }], 100_00).pct).toBeNull();
  });
});

describe("what holds up the lock", () => {
  const ok: ScheduleState = { reference: "C5-1", hasConclusion: true, reviewed: true, balanceMinor: 100_00, totalMinor: 100_00, explanation: null };
  it("is nothing when there are no schedules, or when they are finished", () => {
    expect(scheduleBlockers([])).toEqual([]);
    expect(scheduleBlockers([ok])).toEqual([]);
    expect(needsFinishing(ok)).toBe(false);
  });
  it("counts schedules with no conclusion, not reviewed, or a difference nobody explained", () => {
    const blockers = scheduleBlockers([
      { ...ok, hasConclusion: false },
      { ...ok, reviewed: false },
      { ...ok, totalMinor: 90_00 },
      { ...ok, totalMinor: 90_00, explanation: "Timing: invoice received after year end." },
      ok,
    ]);
    expect(blockers).toEqual([
      "Audit: 1 test schedule(s) have no conclusion.",
      "Audit: 1 test schedule(s) have not been reviewed.",
      "Audit: 1 test schedule(s) do not agree to the balance, and the difference is not explained.",
    ]);
  });
  it("has no difference to explain when there is no balance, and ignores a blank explanation", () => {
    expect(differenceUnexplained({ ...ok, balanceMinor: null, totalMinor: 5 })).toBe(false);
    expect(differenceUnexplained({ ...ok, totalMinor: 1, explanation: "   " })).toBe(true);
    expect(needsFinishing({ ...ok, totalMinor: 1 })).toBe(true);
  });
});

describe("parseListing", () => {
  const grid = [
    ["Fixed asset additions - invented client", null, null],
    ["Ref", "Description", "Amount"],
    ["INV-001", "Laptop computers", "12,500.00"],
    ["INV-002", "Office chairs", 3400.5],
    [null, "Additions heading", null],
    ["INV-003", "Delivery van", "(8,000.00)"],
    [null, "Total", "7,900.50"],
    [null, null, null],
  ];
  it("finds the columns, reads the amounts, skips total rows, and reports rows it could not read", () => {
    const r = parseListing(grid);
    expect(r.errors).toEqual([]);
    expect(r.layout).toMatchObject({ docRef: 0, description: 1, amount: 2 });
    expect(r.lines).toEqual([
      { description: "Laptop computers", docRef: "INV-001", amountMinor: 12_500_00 },
      { description: "Office chairs", docRef: "INV-002", amountMinor: 3_400_50 },
      { description: "Delivery van", docRef: "INV-003", amountMinor: -8_000_00 },
    ]);
    expect(r.totalMinor).toBe(7_900_50);
    expect(r.rejected).toEqual([{ row: 5, reason: "has no amount" }]);
  });
  it("reports rows with a bad amount or no description, and still imports the rest", () => {
    const r = parseListing([["Name", "Balance"], ["Supplier A", "1,000"], ["Supplier B", "abc"], [null, "55"], ["Supplier C", "2,000"]]);
    expect(r.lines.map((l) => l.description)).toEqual(["Supplier A", "Supplier C"]);
    expect(r.rejected).toEqual([
      { row: 3, reason: "amount is not a number" },
      { row: 4, reason: "has an amount but no description" },
    ]);
  });
  it("refuses a listing with no amount column, and one over the cap", () => {
    expect(parseListing([["Description", "Notes"], ["x", "y"]]).errors[0]).toMatch(/Could not find the columns/);
    expect(parseListing([["Nothing useful here"]]).lines).toEqual([]);
    const many = [["Description", "Amount"], ...Array.from({ length: 4 }, (_, i) => [`Item ${i}`, i + 1])];
    const r = parseListing(many, 3);
    expect(r.errors[0]).toMatch(/at most 3/);
    expect(r.lines).toEqual([]);
  });
});

describe("gridFromText", () => {
  it("reads a tab-separated paste without splitting amounts at the thousands comma", () => {
    const grid = gridFromText("Description\tAmount\r\nPrepaid insurance\t1,234.56\r\nPrepaid rent\t800.00");
    const r = parseListing(grid);
    expect(r.lines).toEqual([
      { description: "Prepaid insurance", docRef: null, amountMinor: 1_234_56 },
      { description: "Prepaid rent", docRef: null, amountMinor: 800_00 },
    ]);
  });
  it("reads comma-separated text when there are no tabs", () => {
    expect(parseListing(gridFromText('Description,Amount\n"Rent, Q1",500.00')).lines).toEqual([{ description: "Rent, Q1", docRef: null, amountMinor: 500_00 }]);
  });
});

describe("tickmarks", () => {
  it("has a unique code and symbol for each standard meaning, and keeps only known codes once, in order", () => {
    expect(new Set(TICKMARKS.map((t) => t.code)).size).toBe(TICKMARKS.length);
    expect(new Set(TICKMARKS.map((t) => t.symbol)).size).toBe(TICKMARKS.length);
    expect(TICKMARKS.map((t) => t.code)).toEqual(expect.arrayContaining(["doc", "gl", "py", "recalc", "conf", "subs", "na", "nm", "ms"]));
    expect(normaliseTickmarks(["gl", "bogus", "doc", "gl", 5])).toEqual(["doc", "gl"]);
    expect(normaliseTickmarks("doc")).toEqual([]);
  });
});
