import { describe, expect, it } from "vitest";
import { countMappings, isBalanced, mappingControls, mappingSentence, mappingState, orderMappings, parseQuery, parseShow, resultsText, viewMappings, type MappingAccount } from "../src/ui/mapping-view";

const acc = (code: string, name: string, groupCode: string | null, approved: boolean): MappingAccount => ({ code, name, groupCode, approved });
const rows = [
  acc("2000", "Trade payables", "TRADEPAY", true),
  acc("1010", "Petty cash", null, false),
  acc("1000", "Emirates Bank current account", "CASH", true),
  acc("1200", "Trade receivables", "TRADEREC", false),
  acc("1100", "Customer deposits", null, false),
  acc("1050", "Savings account", "CASH", false),
  acc("10000", "Opening reserve", "RESERVES", true),
];

describe("mapping state", () => {
  it("is to map without a group, to check until accepted, then mapped", () => {
    expect(mappingState(rows[1])).toBe("to_map");
    expect(mappingState(rows[3])).toBe("to_check");
    expect(mappingState(rows[0])).toBe("mapped");
    expect(mappingState({ groupCode: "", approved: true })).toBe("to_map");
  });
  it("counts each state", () => {
    expect(countMappings(rows)).toEqual({ all: 7, toMap: 2, toCheck: 2, mapped: 3 });
    expect(countMappings([])).toEqual({ all: 0, toMap: 0, toCheck: 0, mapped: 0 });
  });
});

describe("ordering", () => {
  it("puts accounts to map first, then to check, then the rest, each in code order", () => {
    expect(orderMappings(rows).map((r) => r.code)).toEqual(["1010", "1100", "1050", "1200", "1000", "2000", "10000"]);
  });
  it("sorts numbers as numbers, and does not change its input", () => {
    const copy = rows.slice();
    orderMappings(rows);
    expect(rows).toEqual(copy);
    expect(orderMappings([acc("200", "b", "X", true), acc("30", "a", "X", true)]).map((r) => r.code)).toEqual(["30", "200"]);
  });
});

describe("filters", () => {
  it("shows all, to map, to check or mapped", () => {
    expect(viewMappings(rows).rows).toHaveLength(7);
    expect(viewMappings(rows, { show: "unmapped" }).rows.map((r) => r.code)).toEqual(["1010", "1100"]);
    expect(viewMappings(rows, { show: "review" }).rows.map((r) => r.code)).toEqual(["1050", "1200"]);
    expect(viewMappings(rows, { show: "mapped" }).rows.map((r) => r.code)).toEqual(["1000", "2000", "10000"]);
  });
  it("counts are of every account, whatever is shown", () => {
    const v = viewMappings(rows, { show: "unmapped", q: "petty" });
    expect(v.counts.all).toBe(7);
    expect(v.shown).toBe(1);
    expect(v.total).toBe(7);
  });
  it("searches code or name, in any case", () => {
    expect(viewMappings(rows, { q: "TRADE" }).rows.map((r) => r.code)).toEqual(["1200", "2000"]);
    expect(viewMappings(rows, { q: "105" }).rows.map((r) => r.code)).toEqual(["1050"]);
    expect(viewMappings(rows, { q: "  bank " }).rows.map((r) => r.code)).toEqual(["1000"]);
  });
  it("combines a search with a filter", () => {
    expect(viewMappings(rows, { show: "review", q: "trade" }).rows.map((r) => r.code)).toEqual(["1200"]);
    expect(viewMappings(rows, { show: "mapped", q: "savings" }).rows).toEqual([]);
  });
  it("returns nothing, not an error, when nothing matches or there are no accounts", () => {
    expect(viewMappings(rows, { q: "zzz" })).toMatchObject({ rows: [], shown: 0, total: 7 });
    expect(viewMappings([], {})).toMatchObject({ rows: [], shown: 0, total: 0 });
  });
});

describe("reading the address", () => {
  it("accepts the three filters and treats anything else as all", () => {
    expect(parseShow("unmapped")).toBe("unmapped");
    expect(parseShow("review")).toBe("review");
    expect(parseShow("mapped")).toBe("mapped");
    expect(parseShow("nonsense")).toBe("all");
    expect(parseShow(undefined)).toBe("all");
    expect(parseShow(["review", "mapped"])).toBe("review");
  });
  it("trims and caps the search", () => {
    expect(parseQuery("  cash ")).toBe("cash");
    expect(parseQuery(undefined)).toBe("");
    expect(parseQuery(["a", "b"])).toBe("a");
    expect(parseQuery("x".repeat(500))).toHaveLength(100);
  });
});

describe("wording", () => {
  it("counts the results", () => {
    expect(resultsText(4, 30)).toBe("Showing 4 of 30 accounts.");
    expect(resultsText(1, 1)).toBe("Showing 1 of 1 account.");
  });
  it("says what is left, with the right plurals", () => {
    expect(mappingSentence({ all: 0, toMap: 0, toCheck: 0, mapped: 0 })).toBe("No trial balance yet.");
    expect(mappingSentence({ all: 30, toMap: 4, toCheck: 2, mapped: 24 })).toBe("4 accounts to map and 2 suggested mappings to check.");
    expect(mappingSentence({ all: 30, toMap: 1, toCheck: 0, mapped: 29 })).toBe("1 account to map.");
    expect(mappingSentence({ all: 30, toMap: 0, toCheck: 1, mapped: 29 })).toBe("1 suggested mapping to check.");
    expect(mappingSentence({ all: 30, toMap: 0, toCheck: 0, mapped: 30 })).toBe("All 30 accounts are mapped and checked.");
    expect(mappingSentence({ all: 1, toMap: 0, toCheck: 0, mapped: 1 })).toBe("The account is mapped and checked.");
  });
  it("balances only at zero", () => {
    expect(isBalanced(0)).toBe(true);
    expect(isBalanced(-100)).toBe(false);
  });
});

describe("controls", () => {
  it("leads with the import when there is no trial balance, and offers a replacement once there is one", () => {
    expect(mappingControls({ locked: false, accounts: 0, toCheck: 0 })).toEqual({ importFirst: true, replace: false, accept: false, selects: true });
    expect(mappingControls({ locked: false, accounts: 5, toCheck: 2 })).toEqual({ importFirst: false, replace: true, accept: true, selects: true });
    expect(mappingControls({ locked: false, accounts: 5, toCheck: 0 }).accept).toBe(false);
  });
  it("offers nothing to change on a locked engagement", () => {
    for (const accounts of [0, 5]) expect(mappingControls({ locked: true, accounts, toCheck: 3 })).toEqual({ importFirst: false, replace: false, accept: false, selects: false });
  });
});
