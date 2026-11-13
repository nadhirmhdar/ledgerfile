import { describe, expect, it } from "vitest";
import { comparativeTotals, isKeyMovement, matchListing, movement } from "../src/domain/rollforward";

const imp = (description: string, docRef: string | null, amountMinor = 100) => ({ description, docRef, amountMinor });

describe("movement and comparatives", () => {
  it("is this year less last year, and has none without a comparative", () => {
    expect(movement(150_00, 100_00)).toBe(50_00);
    expect(movement(0, 100_00)).toBe(-100_00);
    expect(movement(5_00, null)).toBeNull();
    expect(movement(0, 0)).toBe(0);
  });
  it("highlights a movement at or above the threshold, in either direction, and never one without a comparative", () => {
    expect(isKeyMovement(1_300_00, 1_000_00, 300_00)).toBe(true);
    expect(isKeyMovement(1_299_99, 1_000_00, 300_00)).toBe(false);
    expect(isKeyMovement(700_00, 1_000_00, 300_00)).toBe(true);
    expect(isKeyMovement(1_000_000_00, null, 300_00)).toBe(false);
    expect(isKeyMovement(1_000_00, 0, 0)).toBe(false);
  });
  it("totals the comparatives, counting a line without one as nothing", () => {
    expect(
      comparativeTotals([
        { amountMinor: 120_00, priorAmountMinor: 100_00 },
        { amountMinor: 0, priorAmountMinor: 50_00 },
        { amountMinor: 30_00, priorAmountMinor: null },
      ]),
    ).toEqual({ currentMinor: 150_00, priorMinor: 150_00, movementMinor: 0, withComparative: 2 });
    expect(comparativeTotals([])).toEqual({ currentMinor: 0, priorMinor: 0, movementMinor: 0, withComparative: 0 });
  });
});

describe("matchListing", () => {
  const existing = [
    { id: "a", docRef: "S-1", description: "Supplier One" },
    { id: "b", docRef: "S-2", description: "Supplier Two" },
    { id: "c", docRef: null, description: "Supplier Three" },
    { id: "d", docRef: "S-4", description: "Supplier Four" },
  ];

  it("matches by reference first, then by exact description, and reports what is left", () => {
    const r = matchListing(existing, [imp("Renamed supplier one", "s-1"), imp("supplier   three", null), imp("Supplier Nine", "S-9"), imp("Supplier Four", null)]);
    expect(r.matches).toEqual([
      { existingId: "a", importedIndex: 0, by: "reference" },
      { existingId: "c", importedIndex: 1, by: "description" },
      { existingId: "d", importedIndex: 3, by: "description" },
    ]);
    expect(r.byReference).toBe(1);
    expect(r.byDescription).toBe(2);
    expect(r.unmatchedImported).toEqual([2]);
    expect(r.unmatchedExisting).toEqual(["b"]);
  });

  it("prefers a reference match over a description match, so the comparative stays on the right line", () => {
    // The description "Supplier Two" belongs to line b, but the reference S-1 says this is line a.
    const r = matchListing(existing, [imp("Supplier Two", "S-1")]);
    expect(r.matches).toEqual([{ existingId: "a", importedIndex: 0, by: "reference" }]);
    expect(r.unmatchedExisting).toEqual(["b", "c", "d"]);
  });

  it("uses each existing line once, in order, when several share a reference or description", () => {
    const dup = [
      { id: "x1", docRef: "R", description: "Same" },
      { id: "x2", docRef: "R", description: "Same" },
    ];
    const r = matchListing(dup, [imp("Same", "R"), imp("Same", "R"), imp("Same", "R")]);
    expect(r.matches.map((m) => m.existingId)).toEqual(["x1", "x2"]);
    expect(r.unmatchedImported).toEqual([2]);
  });

  it("does not match on blank references, and handles empty inputs", () => {
    expect(matchListing([{ id: "a", docRef: "", description: "A" }], [imp("B", "")]).matches).toEqual([]);
    expect(matchListing([], [imp("A", "1")])).toMatchObject({ matches: [], unmatchedImported: [0], unmatchedExisting: [] });
    expect(matchListing(existing, [])).toMatchObject({ matches: [], unmatchedImported: [], unmatchedExisting: ["a", "b", "c", "d"] });
  });
});
