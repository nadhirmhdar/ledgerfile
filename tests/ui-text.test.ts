import { describe, expect, it } from "vitest";
import { STATUS_LABEL, isStatus, statusTone, type Status } from "../src/ui/status";
import { capitalise, count, fraction, hasHave, isAre, joinList, word } from "../src/ui/text";

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
