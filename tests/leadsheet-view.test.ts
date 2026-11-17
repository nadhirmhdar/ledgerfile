import { describe, expect, it } from "vitest";
import { openPointsLabel, signBadge, signOffSentence } from "../src/ui/leadsheet-view";

const who = { name: "A" };

describe("signBadge", () => {
  it("is Not started with no sign-off", () => {
    expect(signBadge({ preparer: null, reviewer: null })).toEqual({ status: "not_started", label: "Not started" });
  });
  it("is Prepared once the preparer has signed, waiting for review", () => {
    expect(signBadge({ preparer: who, reviewer: null })).toEqual({ status: "needs_review", label: "Prepared" });
  });
  it("is Reviewed once a reviewer has signed", () => {
    expect(signBadge({ preparer: who, reviewer: who })).toEqual({ status: "reviewed", label: "Reviewed" });
  });
  it("shows a review that has no preparer on record as reviewed too", () => {
    expect(signBadge({ preparer: null, reviewer: who }).label).toBe("Reviewed");
  });
});

describe("openPointsLabel", () => {
  it("says nothing for none, and counts with plain plurals", () => {
    expect(openPointsLabel(0)).toBeNull();
    expect(openPointsLabel(1)).toBe("1 open point");
    expect(openPointsLabel(3)).toBe("3 open points");
  });
});

describe("signOffSentence", () => {
  const s = (preparer: boolean, reviewer: boolean, openPoints = 0) => ({ preparer: preparer ? who : null, reviewer: reviewer ? who : null, openPoints });
  it("is empty with no lead sheets", () => {
    expect(signOffSentence([])).toBe("");
  });
  it("counts reviewed, prepared and open points", () => {
    expect(signOffSentence([s(false, false)])).toBe("0 of 1 lead sheet reviewed.");
    expect(signOffSentence([s(true, true), s(true, false), s(false, false)])).toBe("1 of 3 lead sheets reviewed, 1 prepared and waiting for review.");
    expect(signOffSentence([s(true, true), s(true, true, 2), s(false, false, 1)])).toBe("2 of 3 lead sheets reviewed; 3 open points.");
    expect(signOffSentence([s(true, false, 1)])).toBe("0 of 1 lead sheet reviewed, 1 prepared and waiting for review; 1 open point.");
  });
});
