import { describe, expect, it } from "vitest";
import { STATUS_LABEL, isStatus, statusTone, type Status } from "../src/ui/status";
import { capitalise, count, fraction, hasHave, isAre, joinList, plainCount, word } from "../src/ui/text";

describe("plural helpers", () => {
  it("uses the singular for one and the plural for everything else, including none", () => {
    expect(word(1, "lead sheet")).toBe("lead sheet");
    expect(word(0, "lead sheet")).toBe("lead sheets");
    expect(word(2, "lead sheet")).toBe("lead sheets");
    expect(count(1, "lead sheet")).toBe("1 lead sheet");
    expect(count(3, "lead sheet")).toBe("3 lead sheets");
    expect(count(0, "review point")).toBe("0 review points");
  });
  it("takes an irregular plural", () => {
    expect(count(1, "journal entry", "journal entries")).toBe("1 journal entry");
    expect(count(4, "journal entry", "journal entries")).toBe("4 journal entries");
  });
  it("agrees the verb with the count", () => {
    expect(isAre(1)).toBe("is");
    expect(isAre(2)).toBe("are");
    expect(isAre(0)).toBe("are");
    expect(hasHave(1)).toBe("has");
    expect(hasHave(5)).toBe("have");
  });
  it("lists in words", () => {
    expect(joinList([])).toBe("");
    expect(joinList(["a"])).toBe("a");
    expect(joinList(["a", "b"])).toBe("a and b");
    expect(joinList(["a", "b", "c"])).toBe("a, b and c");
  });
  it("capitalises the first letter only, and writes fractions", () => {
    expect(capitalise("materiality not set")).toBe("Materiality not set");
    expect(capitalise("")).toBe("");
    expect(fraction(2, 5)).toBe("2 of 5");
  });
});

describe("status vocabulary", () => {
  it("gives every status one tone from the fixed set", () => {
    const expected: Record<Status, string> = {
      not_started: "neutral",
      in_progress: "info",
      needs_review: "warning",
      waiting: "warning",
      done: "success",
      reviewed: "success",
      problem: "danger",
      blocked: "danger",
      not_applicable: "muted",
      locked: "slate",
    };
    for (const [status, tone] of Object.entries(expected)) expect(statusTone(status as Status)).toBe(tone);
    expect(Object.keys(STATUS_LABEL).sort()).toEqual(Object.keys(expected).sort());
  });
  it("has a word for every status, so colour is never the only sign", () => {
    for (const label of Object.values(STATUS_LABEL)) expect(label.length).toBeGreaterThan(2);
    expect(STATUS_LABEL.not_applicable).toBe("Not applicable");
  });
  it("recognises its own names only", () => {
    expect(isStatus("done")).toBe(true);
    expect(isStatus("toString")).toBe(false);
    expect(isStatus("finished")).toBe(false);
  });
});

describe("plainCount", () => {
  it("rewrites a counted (s) plural by its count", () => {
    expect(plainCount("Assess risk for the remaining 12 area(s) first.")).toBe("Assess risk for the remaining 12 areas first.");
    expect(plainCount("Assess risk for the remaining 1 area(s) first.")).toBe("Assess risk for the remaining 1 area first.");
    expect(plainCount("0 area(s) left")).toBe("0 areas left");
  });
  it("rewrites (ies) plurals", () => {
    expect(plainCount("2 journal entry(ies) selected")).toBe("2 journal entries selected");
    expect(plainCount("1 journal entry(ies) selected")).toBe("1 journal entry selected");
  });
  it("rewrites every noun in a phrase joined by and, and agrees the verb after it for one", () => {
    expect(plainCount("Audit: 147 procedure(s) and checklist step(s) are not yet completed.")).toBe("Audit: 147 procedures and checklist steps are not yet completed.");
    expect(plainCount("Audit: 1 procedure(s) and checklist step(s) are not yet completed.")).toBe("Audit: 1 procedure and checklist step is not yet completed.");
  });
  it("changes are, have, do and were to is, has, does and was for a count of one only", () => {
    expect(plainCount("1 lead sheet(s) are not signed")).toBe("1 lead sheet is not signed");
    expect(plainCount("1 confirmation(s) have a reply")).toBe("1 confirmation has a reply");
    expect(plainCount("1 test schedule(s) do not agree")).toBe("1 test schedule does not agree");
    expect(plainCount("1 procedure(s) were marked")).toBe("1 procedure was marked");
    expect(plainCount("3 lead sheet(s) are not signed")).toBe("3 lead sheets are not signed");
    expect(plainCount("3 confirmation(s) have a reply")).toBe("3 confirmations have a reply");
  });
  it("handles two different counts in one sentence", () => {
    expect(plainCount("1 lead sheet(s) are open and 3 review point(s) are open")).toBe("1 lead sheet is open and 3 review points are open");
    expect(plainCount("Loaded 5 procedure(s), removed 1 step(s).")).toBe("Loaded 5 procedures, removed 1 step.");
  });
  it("reads a count with a thousands separator", () => {
    expect(plainCount("1,200 line(s) imported")).toBe("1,200 lines imported");
  });
  it("returns text with no counted plural unchanged", () => {
    for (const t of ["Nothing to do.", "3 areas are assessed.", "Mark entry(s) as you go", "", "Materiality has not been set."]) expect(plainCount(t)).toBe(t);
  });
});
