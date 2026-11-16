import { describe, expect, it } from "vitest";
import { buildIndex, type IndexEntry } from "../src/domain/wp-index";
import { chipCounts, indexResults, indexSentence, parseIndexSearch, sectionOpen, sectionSummary, searchSections, viewIndex } from "../src/ui/index-view";

const entry = (reference: string | null, title: string, section: string, status: IndexEntry["status"], reviewable = true): IndexEntry => ({
  reference,
  section,
  title,
  kind: "checklist",
  href: `/x/${reference ?? title}`,
  preparedBy: null,
  preparedOn: null,
  reviewedBy: null,
  reviewedOn: null,
  status,
  reviewable,
  note: null,
});

const index = buildIndex([
  entry("A1", "Client acceptance", "A", "reviewed"),
  entry("A2", "Independence", "A", "not_started"),
  entry("B2", "Materiality calculation", "B", "in_progress"),
  entry("B3", "Analytical review", "B", "not_started"),
  entry("C6.L1", "Cash lead sheet", "C6", "prepared"),
  entry("C6-1", "Bank reconciliation", "C6", "not_started"),
  entry("G1", "Trial balance and mapping", "G", "prepared", false),
]);
const codes = (x: { sections: { code: string; entries: IndexEntry[] }[] }) => x.sections.map((s) => `${s.code}:${s.entries.map((e) => e.reference).join(",")}`);

describe("search", () => {
  it("matches the reference or the title, in any case", () => {
    expect(codes(viewIndex(index, "all", "bank"))).toEqual(["C6:C6-1"]);
    expect(codes(viewIndex(index, "all", "b3"))).toEqual(["B:B3"]);
    expect(codes(viewIndex(index, "all", "LEAD"))).toEqual(["C6:C6.L1"]);
  });
  it("ignores an empty search, and gives nothing rather than failing when nothing matches", () => {
    expect(viewIndex(index, "all", "  ").shown).toBe(7);
    expect(viewIndex(index, "all", "zzz")).toMatchObject({ sections: [], shown: 0, total: 7 });
  });
  it("works out each section's counts again for what is left", () => {
    const s = searchSections(index.sections, "analytical")[0];
    expect(s.counts).toMatchObject({ total: 1, notStarted: 1 });
  });
  it("combines with each chip", () => {
    expect(codes(viewIndex(index, "unreviewed", "a"))).toEqual(["A:A2", "B:B2,B3", "C6:C6-1,C6.L1"]);
    expect(codes(viewIndex(index, "not_started", "b"))).toEqual(["B:B3", "C6:C6-1"]);
    expect(codes(viewIndex(index, "unreviewed", "cash"))).toEqual(["C6:C6.L1"]);
    expect(codes(viewIndex(index, "not_started", "cash"))).toEqual([]);
  });
});

describe("chips", () => {
  it("count what each would leave, with the search applied", () => {
    expect(chipCounts(index, "")).toEqual({ all: 7, unreviewed: 5, not_started: 3 });
    expect(chipCounts(index, "c6")).toEqual({ all: 2, unreviewed: 2, not_started: 1 });
  });
});

describe("which sections start open", () => {
  const c = (inProgress: number, prepared: number) => ({ inProgress, prepared });
  it("keeps a quiet section closed, and opens one with work in progress or waiting for review", () => {
    expect(sectionOpen(c(0, 0), { filter: "all", q: "" })).toBe(false);
    expect(sectionOpen(c(1, 0), { filter: "all", q: "" })).toBe(true);
    expect(sectionOpen(c(0, 2), { filter: "all", q: "" })).toBe(true);
  });
  it("opens every listed section when a chip other than All, or a search, is on", () => {
    expect(sectionOpen(c(0, 0), { filter: "unreviewed", q: "" })).toBe(true);
    expect(sectionOpen(c(0, 0), { filter: "not_started", q: "" })).toBe(true);
    expect(sectionOpen(c(0, 0), { filter: "all", q: "bank" })).toBe(true);
    expect(sectionOpen(c(0, 0), { filter: "all", q: "   " })).toBe(false);
  });
  it("applies to the real index: only sections with work in progress or prepared papers start open", () => {
    const open = index.sections.filter((s) => sectionOpen(s.counts, { filter: "all", q: "" })).map((s) => s.code);
    expect(open.sort()).toEqual(["B", "C6", "G"]);
  });
});

describe("words", () => {
  it("summarises a section, whole or narrowed", () => {
    expect(sectionSummary({ reviewed: 5, total: 12 }, false)).toBe("5 of 12 reviewed");
    expect(sectionSummary({ reviewed: 0, total: 3 }, true)).toBe("3 shown");
  });
  it("writes the header sentence with plurals, leaving out zero parts", () => {
    expect(indexSentence({ total: 73, reviewed: 1, prepared: 1, inProgress: 2, notStarted: 66, notApplicable: 3 })).toBe("73 papers: 1 reviewed, 1 prepared, 2 in progress, 66 not started, 3 not applicable.");
    expect(indexSentence({ total: 1, reviewed: 0, prepared: 0, inProgress: 0, notStarted: 1, notApplicable: 0 })).toBe("1 paper: 1 not started.");
    expect(indexSentence({ total: 0, reviewed: 0, prepared: 0, inProgress: 0, notStarted: 0, notApplicable: 0 })).toBe("No papers yet.");
  });
  it("says how many are shown, and reads the search", () => {
    expect(indexResults(2, 7)).toBe("Showing 2 of 7 papers.");
    expect(indexResults(1, 1)).toBe("Showing 1 of 1 paper.");
    expect(parseIndexSearch("  bank ")).toBe("bank");
    expect(parseIndexSearch(["a", "b"])).toBe("a");
    expect(parseIndexSearch(undefined)).toBe("");
    expect(parseIndexSearch("x".repeat(300))).toHaveLength(100);
  });
});
