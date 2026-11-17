import { describe, expect, it } from "vitest";
import { decisionSentence, formProblems, misstatementPill, OPINION_HINT, OPINION_KINDS, OPINION_LABEL, opinionBadge, opinionFields, opinionReadOnlyReason } from "../src/ui/opinion-view";
import { isOpinionBlocker } from "../src/server/opinion";

describe("which fields show", () => {
  it("asks for a basis only for a modified opinion", () => {
    expect(opinionFields("unmodified")).toEqual({ basis: false, goingConcern: true, emphasis: true });
    for (const k of ["qualified", "adverse"] as const) expect(opinionFields(k)).toEqual({ basis: true, goingConcern: true, emphasis: true });
  });
  it("offers a disclaimer neither a going-concern section nor an emphasis of matter", () => {
    expect(opinionFields("disclaimer")).toEqual({ basis: true, goingConcern: false, emphasis: false });
  });
  it("has a label and a hint for every kind", () => {
    for (const k of OPINION_KINDS) {
      expect(OPINION_LABEL[k]).toBeTruthy();
      expect(OPINION_HINT[k].length).toBeGreaterThan(20);
    }
  });
});

describe("the summary", () => {
  it("says who recorded it and the report date", () => {
    expect(decisionSentence({ opinion: "qualified", decidedByName: "Ada Partner", decidedAt: "2026-03-10", reportDate: "2026-03-15" })).toBe("Qualified opinion, recorded by Ada Partner on 2026-03-10. Report dated 2026-03-15.");
    expect(decisionSentence({ opinion: "unmodified", decidedByName: "Ada Partner", decidedAt: "2026-03-10", reportDate: null })).toBe("Unmodified opinion, recorded by Ada Partner on 2026-03-10. No report date yet.");
  });
  it("badges an unmodified opinion green, a qualified one amber and the others red, always with the words", () => {
    expect(opinionBadge("unmodified")).toEqual({ tone: "success", label: "Unmodified opinion" });
    expect(opinionBadge("qualified")).toEqual({ tone: "warning", label: "Qualified opinion" });
    expect(opinionBadge("adverse").tone).toBe("danger");
    expect(opinionBadge("disclaimer").tone).toBe("danger");
  });
});

describe("misstatements against materiality", () => {
  it("says when materiality is not set", () => {
    expect(misstatementPill({ overallMinor: null, uncorrectedNetMinor: 0, uncorrectedCount: 0, exceedsMateriality: false })).toMatchObject({ tone: "neutral", label: "Materiality not set" });
  });
  it("is green below materiality and red when it is reached, and says what follows", () => {
    const below = misstatementPill({ overallMinor: 150000, uncorrectedNetMinor: 40000, uncorrectedCount: 2, exceedsMateriality: false });
    expect(below).toEqual({ tone: "success", label: "Below materiality", sentence: "2 uncorrected misstatements, net 400.00, against overall materiality of 1,500.00." });
    const reached = misstatementPill({ overallMinor: 100000, uncorrectedNetMinor: 500000, uncorrectedCount: 1, exceedsMateriality: true });
    expect(reached.tone).toBe("danger");
    expect(reached.sentence).toContain("1 uncorrected misstatement, net 5,000.00");
    expect(reached.sentence).toContain("an unmodified opinion cannot be recorded");
  });
});

describe("who sees the form", () => {
  it("is offered to a partner or administrator on an open engagement", () => {
    expect(opinionReadOnlyReason({ role: "partner", open: true, auditOn: true })).toBeNull();
    expect(opinionReadOnlyReason({ role: "admin", open: true, auditOn: true })).toBeNull();
  });
  it("is read-only for everyone else, and for everyone once locked", () => {
    expect(opinionReadOnlyReason({ role: "reviewer", open: true, auditOn: true })).toBe("A partner records the opinion.");
    expect(opinionReadOnlyReason({ role: "preparer", open: true, auditOn: true })).toBe("A partner records the opinion.");
    expect(opinionReadOnlyReason({ role: "partner", open: false, auditOn: true })).toBe("This engagement is locked, so the opinion is read-only.");
  });
});

describe("what the form says before it is sent", () => {
  const v = { opinion: "unmodified" as const, basis: "", goingConcern: false, goingConcernNote: "", emphasis: "", reportDate: "2026-03-15" };
  it("has nothing to say about a complete unmodified opinion", () => {
    expect(formProblems(v)).toEqual([]);
  });
  it("asks for a choice first", () => {
    expect(formProblems({ ...v, opinion: "" })).toEqual(["Choose the kind of opinion."]);
  });
  it("asks for the basis, the going-concern note and the date", () => {
    expect(formProblems({ ...v, opinion: "adverse" })).toEqual(["An adverse opinion needs the basis for the modification: say what the matter is and what it affects."]);
    expect(formProblems({ ...v, goingConcern: true })).toEqual(["Give the note where the going-concern uncertainty is disclosed."]);
    expect(formProblems({ ...v, reportDate: "" })).toEqual(["Enter the date of the report."]);
  });
  it("does not ask for a going-concern note on a disclaimer, where the section is not offered", () => {
    expect(formProblems({ ...v, opinion: "disclaimer", basis: "No evidence.", goingConcern: true })).toEqual([]);
  });
});

describe("the lock blockers the page speaks to", () => {
  it("picks out the opinion and the misstatement blockers only", () => {
    expect(isOpinionBlocker("Audit: the partner has not recorded the audit opinion.")).toBe(true);
    expect(isOpinionBlocker("Audit: uncorrected misstatements reach overall materiality. Correct them, or have the partner record a modified opinion with its basis.")).toBe(true);
    expect(isOpinionBlocker("Record the date of the auditor's report on the Auditor's report page.")).toBe(true);
    expect(isOpinionBlocker("Audit: materiality has not been set.")).toBe(false);
    expect(isOpinionBlocker("Audit: the partner has not approved the risk assessment.")).toBe(false);
  });
});
