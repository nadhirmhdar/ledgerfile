import { describe, expect, it } from "vitest";
import { balancePill, entriesSentence, entryReference, entryTotals, postedText } from "../src/ui/journal-entries-view";

describe("entriesSentence", () => {
  it("says none are posted", () => {
    expect(entriesSentence([])).toBe("No entries posted yet. Lead sheets and statements show the trial balance as imported.");
  });
  it("counts one and several, with plain plurals", () => {
    expect(entriesSentence([{ type: "adjusting" }])).toBe("1 entry posted: 1 adjusting.");
    expect(entriesSentence([{ type: "reclassification" }])).toBe("1 entry posted: 1 reclassification.");
    expect(entriesSentence([{ type: "adjusting" }, { type: "adjusting" }, { type: "adjusting" }])).toBe("3 entries posted: 3 adjusting.");
  });
  it("lists both types when mixed", () => {
    expect(entriesSentence([{ type: "adjusting" }, { type: "reclassification" }])).toBe("2 entries posted: 1 adjusting, 1 reclassification.");
    expect(entriesSentence([{ type: "adjusting" }, { type: "reclassification" }, { type: "reclassification" }])).toBe("3 entries posted: 1 adjusting, 2 reclassifications.");
  });
});

describe("entryReference and entryTotals", () => {
  it("names the entry by its type and number", () => {
    expect(entryReference("adjusting", 1)).toBe("AJE 1");
    expect(entryReference("reclassification", 3)).toBe("RJE 3");
  });
  it("totals debits and credits separately", () => {
    expect(entryTotals([{ amountMinor: 12000 }, { amountMinor: -12000 }, { amountMinor: 500 }, { amountMinor: -500 }])).toEqual({ debitMinor: 12500, creditMinor: 12500 });
    expect(entryTotals([])).toEqual({ debitMinor: 0, creditMinor: 0 });
  });
});

describe("balancePill", () => {
  it("asks for amounts when both totals are zero", () => {
    expect(balancePill(0, 0)).toEqual({ state: "empty", label: "Enter amounts", tone: "neutral", blocked: "Enter the lines; debits must equal credits." });
  });
  it("is balanced, and can be posted, when debits equal credits", () => {
    expect(balancePill(1200, 1200)).toEqual({ state: "balanced", label: "Balanced", tone: "success", blocked: null });
    expect(balancePill(0.1 + 0.2, 0.3).state).toBe("balanced");
  });
  it("says by how much it is out, in either direction, and blocks posting", () => {
    expect(balancePill(1320, 1200)).toEqual({ state: "out", label: "Out by 120.00", tone: "danger", blocked: "Out of balance by 120.00." });
    expect(balancePill(1000, 1234.5)).toMatchObject({ label: "Out by 234.50", blocked: "Out of balance by 234.50." });
    expect(balancePill(0, 50).state).toBe("out");
  });
  it("never leaves the state to colour: every state has words", () => {
    for (const [d, c] of [[0, 0], [5, 5], [5, 4]] as const) expect(balancePill(d, c).label.length).toBeGreaterThan(5);
  });
});

describe("postedText", () => {
  it("names the poster when known", () => {
    expect(postedText("2025-03-01", "Ana Preparer")).toBe("Posted by Ana Preparer on 2025-03-01");
  });
  it("says only the date when the poster is not known", () => {
    expect(postedText("2025-03-01", null)).toBe("Posted 2025-03-01");
    expect(postedText("2025-03-01", "")).toBe("Posted 2025-03-01");
  });
});
