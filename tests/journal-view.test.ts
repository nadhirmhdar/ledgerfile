import { describe, expect, it } from "vitest";
import { completenessSentence, entryPill, journalHref, journalSentence, matchingSentence } from "../src/ui/journal-view";

describe("journalSentence", () => {
  it("says the audit is off first", () => {
    expect(journalSentence({ enabled: false, entryCount: 16, selected: 3, tested: 1 })).toBe("The audit is off for this engagement.");
  });
  it("says there is no listing yet", () => {
    expect(journalSentence({ enabled: true, entryCount: null, selected: 0, tested: 0 })).toBe("No journal listing yet.");
  });
  it("counts the entries imported, with plain plurals", () => {
    expect(journalSentence({ enabled: true, entryCount: 16, selected: 3, tested: 1 })).toBe("16 entries imported: 3 selected, 1 tested.");
    expect(journalSentence({ enabled: true, entryCount: 1, selected: 0, tested: 0 })).toBe("1 entry imported: 0 selected, 0 tested.");
  });
});

describe("entryPill", () => {
  it("has no pill for an entry that is not selected", () => {
    expect(entryPill(null)).toMatchObject({ state: "none", label: null });
    expect(entryPill(undefined).state).toBe("none");
  });
  it("words a selected entry and a tested one", () => {
    expect(entryPill({ status: "selected" })).toEqual({ state: "selected", label: "Selected, to test", tone: "warning" });
    expect(entryPill({ status: "tested" })).toEqual({ state: "tested", label: "Tested", tone: "success" });
  });
});

describe("journalHref", () => {
  const base = "/engagements/x/audit/journals";
  it("gives the bare page with no filter", () => {
    expect(journalHref(base, {})).toBe(base);
    expect(journalHref(base, { flag: undefined, user: undefined })).toBe(base);
  });
  it("keeps one filter", () => {
    expect(journalHref(base, { flag: "weekend" })).toBe(`${base}?flag=weekend`);
    expect(journalHref(base, { user: "A Smith" })).toBe(`${base}?user=A+Smith`);
  });
  it("combines flag then user", () => {
    expect(journalHref(base, { flag: "round", user: "jo" })).toBe(`${base}?flag=round&user=jo`);
  });
});

describe("matchingSentence", () => {
  it("covers none, one and many", () => {
    expect(matchingSentence(0, 0)).toBe("No entries match.");
    expect(matchingSentence(1, 1)).toBe("1 entry matches.");
    expect(matchingSentence(16, 16)).toBe("16 entries match.");
  });
  it("says when the list is capped", () => {
    expect(matchingSentence(1200, 200)).toBe("1,200 entries match; showing the first 200, selected entries and those with most flags first.");
  });
});

describe("completenessSentence", () => {
  it("says all agree", () => {
    expect(completenessSentence({ agreed: 12, differences: 0, unchecked: 0 })).toBe("The listing's movement agrees to the trial balance for all 12 accounts checked.");
  });
  it("counts differences and unchecked accounts without (s)", () => {
    expect(completenessSentence({ agreed: 10, differences: 2, unchecked: 1 })).toBe(
      "The listing's movement agrees to the trial balance for 10 accounts and differs for 2. 1 account could not be checked (unmapped, or no prior-year balance).",
    );
    expect(completenessSentence({ agreed: 10, differences: 2, unchecked: 3 })).toContain("3 accounts could not be checked");
  });
});
