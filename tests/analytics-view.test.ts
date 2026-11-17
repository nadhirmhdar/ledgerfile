import { describe, expect, it } from "vitest";
import { analyticsSentence, chips, explainLinkLabel, formMode, filterRows, groupBySection, parseShow, reviewCounts, rowState, showHref, statePill } from "../src/ui/analytics-view";

const IS = "Statement of comprehensive income";
const FP = "Statement of financial position";
const line = (section: string, flag: boolean, explanation: { stale: boolean } | null = null) => ({ section, flag: flag ? { reason: "x" } : null, explanation });

describe("rowState", () => {
  it("has no state for a line that is not flagged", () => {
    expect(rowState(line(IS, false))).toBe("none");
  });
  it("is to explain, explained or re-confirm for a flagged line", () => {
    expect(rowState(line(IS, true))).toBe("to_explain");
    expect(rowState(line(IS, true, { stale: false }))).toBe("explained");
    expect(rowState(line(IS, true, { stale: true }))).toBe("reconfirm");
  });
  it("pills carry words", () => {
    expect(statePill("to_explain")).toEqual({ label: "To explain", tone: "warning" });
    expect(statePill("explained")).toEqual({ label: "Explained", tone: "success" });
    expect(statePill("reconfirm")).toEqual({ label: "Re-confirm", tone: "warning" });
    expect(statePill("none")).toBeNull();
  });
});

describe("analyticsSentence", () => {
  const ok = { hasComparatives: true, hasThresholds: true };
  const c = (flagged: number, explained: number, reconfirm = 0) => ({ flagged, explained, toExplain: flagged - explained, reconfirm });
  it("counts flagged, explained and to explain", () => {
    expect(analyticsSentence({ ...ok, ...c(17, 2) })).toBe("17 movements flagged: 2 explained, 15 to explain.");
    expect(analyticsSentence({ ...ok, ...c(1, 0) })).toBe("1 movement flagged: 0 explained, 1 to explain.");
  });
  it("says every flagged movement is explained, or none is flagged", () => {
    expect(analyticsSentence({ ...ok, ...c(3, 3) })).toBe("Every flagged movement is explained.");
    expect(analyticsSentence({ ...ok, ...c(0, 0) })).toBe("No movement is flagged.");
  });
  it("says when no prior year or no materiality, before anything else", () => {
    expect(analyticsSentence({ hasComparatives: false, hasThresholds: false, ...c(0, 0) })).toBe("No prior year, so nothing is compared.");
    expect(analyticsSentence({ hasComparatives: true, hasThresholds: false, ...c(0, 0) })).toBe("Materiality is not set, so nothing is flagged yet.");
  });
  it("adds the explanations that need re-confirming, with plain plurals", () => {
    expect(analyticsSentence({ ...ok, ...c(5, 2, 1) })).toBe("5 movements flagged: 2 explained, 3 to explain. 1 explanation needs re-confirming.");
    expect(analyticsSentence({ ...ok, ...c(5, 1, 2) })).toBe("5 movements flagged: 1 explained, 4 to explain. 2 explanations need re-confirming.");
  });
});

describe("filtering", () => {
  const rows = [
    line(IS, false), // a plain line
    line(IS, true), // to explain
    line(IS, true, { stale: false }), // explained
    line(FP, true, { stale: true }), // re-confirm
    line(FP, false), // a total
  ];
  it("keeps every line, totals included, under All", () => {
    expect(filterRows(rows, "all")).toHaveLength(5);
  });
  it("keeps only flagged lines under Flagged", () => {
    expect(filterRows(rows, "flagged").map(rowState)).toEqual(["to_explain", "explained", "reconfirm"]);
  });
  it("keeps only lines still to explain, re-confirm included, under To explain", () => {
    expect(filterRows(rows, "unexplained").map(rowState)).toEqual(["to_explain", "reconfirm"]);
  });
  it("does not change the order or the input", () => {
    const before = [...rows];
    filterRows(rows, "flagged");
    expect(rows).toEqual(before);
  });
  it("groups by statement, and drops a heading with no line left", () => {
    expect(groupBySection(rows).map((g) => [g.section, g.rows.length])).toEqual([[IS, 3], [FP, 2]]);
    expect(groupBySection(filterRows([line(FP, true)], "flagged")).map((g) => g.section)).toEqual([FP]);
    expect(groupBySection(filterRows(rows, "unexplained")).map((g) => [g.section, g.rows.length])).toEqual([[IS, 1], [FP, 1]]);
    expect(groupBySection([])).toEqual([]);
  });
  it("counts the chips", () => {
    expect(chips(rows).map((x) => [x.label, x.count])).toEqual([["All lines", 5], ["Flagged", 3], ["To explain", 2]]);
    expect(reviewCounts(rows)).toEqual({ flagged: 3, explained: 1, toExplain: 2, reconfirm: 1 });
  });
  it("reads ?show= and builds its address", () => {
    expect(parseShow("flagged")).toBe("flagged");
    expect(parseShow(["unexplained", "x"])).toBe("unexplained");
    expect(parseShow("nonsense")).toBe("all");
    expect(parseShow(undefined)).toBe("all");
    expect(showHref("/a", "all")).toBe("/a");
    expect(showHref("/a", "unexplained")).toBe("/a?show=unexplained");
  });
});

describe("formMode", () => {
  it("opens the write form only under To explain", () => {
    expect(formMode("unexplained", "to_explain")).toBe("write-open");
    expect(formMode("all", "to_explain")).toBe("write-closed");
    expect(formMode("flagged", "to_explain")).toBe("write-closed");
  });
  it("offers a closed rewrite for a line that has an explanation, in every view", () => {
    for (const show of ["all", "flagged", "unexplained"] as const) {
      expect(formMode(show, "explained")).toBe("rewrite");
      expect(formMode(show, "reconfirm")).toBe("rewrite");
      expect(formMode(show, "none")).toBeNull();
    }
  });
  it("words the link to the To explain view", () => {
    expect(explainLinkLabel(15)).toBe("Explain the 15 movements");
    expect(explainLinkLabel(1)).toBe("Explain the movement");
  });
});
