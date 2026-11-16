import { describe, expect, it } from "vitest";
import { approvalView, checklistPill, highestRisk, mayDo, planningSentence, planningSteps, programmeProgress, riskSummary, stepTone, waitingFor, type PlanningInput } from "../src/ui/audit-view";

describe("risk summary", () => {
  it("says not assessed until every assertion is rated", () => {
    expect(riskSummary({ assessed: false, risks: { E: "low" } })).toEqual({ kind: "not_assessed", tone: "neutral", label: "Not assessed", highest: null });
  });
  it("shows the highest rating once assessed", () => {
    expect(riskSummary({ assessed: true, risks: { E: "low", C: "moderate", A: "low" } })).toMatchObject({ kind: "assessed", label: "Assessed: highest moderate", tone: "success", highest: "moderate" });
    expect(riskSummary({ assessed: true, risks: { E: "low", C: "high" } })).toMatchObject({ label: "Assessed: highest high", tone: "warning" });
    expect(riskSummary({ assessed: true, risks: { E: "significant", C: "low" } })).toMatchObject({ label: "Assessed: highest significant risk", highest: "significant" });
  });
  it("treats a fixed-risk area as significant on every audit", () => {
    expect(riskSummary({ assessed: true, fixedRisk: "significant", risks: {} })).toMatchObject({ kind: "fixed", label: "Significant risk on every audit" });
    expect(riskSummary({ assessed: false, fixedRisk: "significant", risks: {} }).kind).toBe("fixed");
  });
  it("finds the highest of several", () => {
    expect(highestRisk({})).toBeNull();
    expect(highestRisk({ E: "low", C: "low" })).toBe("low");
    expect(highestRisk({ E: "high", C: "moderate", A: "significant" })).toBe("significant");
  });
});

describe("programme progress", () => {
  it("counts completed of procedures, and what is waiting", () => {
    expect(programmeProgress({ procedures: 7, completed: 3, unreviewed: 1, schedules: 2, schedulesToFinish: 1 })).toEqual({
      loaded: true,
      done: 3,
      total: 7,
      label: "3 of 7 procedures completed",
      toReview: "1 to review",
      toFinish: "1 schedule to finish",
    });
  });
  it("says the programme is not loaded when there are no procedures, and uses the singular", () => {
    expect(programmeProgress({ procedures: 0, completed: 0, unreviewed: 0, schedules: 0, schedulesToFinish: 0 })).toMatchObject({ loaded: false, label: "Programme not loaded", toReview: null, toFinish: null });
    expect(programmeProgress({ procedures: 1, completed: 1, unreviewed: 0, schedules: 3, schedulesToFinish: 3 })).toMatchObject({ label: "1 of 1 procedure completed", toFinish: "3 schedules to finish" });
  });
});

const base: PlanningInput = { role: "reviewer", open: true, materialitySet: false, materialityStale: false, areasAssessed: 0, areasTotal: 14, approval: "none", approvalNotReady: "Set materiality first." };
const step = (i: PlanningInput, key: string) => planningSteps(i).find((s) => s.key === key)!;

describe("planning steps", () => {
  it("shows materiality as not set, set, or needing revision", () => {
    expect(step(base, "materiality")).toMatchObject({ state: "todo", label: "Not set" });
    expect(step({ ...base, materialitySet: true }, "materiality")).toMatchObject({ state: "done", label: "Set" });
    expect(step({ ...base, materialitySet: true, materialityStale: true }, "materiality")).toMatchObject({ state: "needs_attention", label: "Needs revising" });
  });
  it("counts the areas assessed", () => {
    expect(step({ ...base, areasAssessed: 2 }, "risk")).toMatchObject({ state: "todo", label: "2 of 14 areas" });
    expect(step({ ...base, areasAssessed: 14 }, "risk")).toMatchObject({ state: "done" });
    expect(step({ ...base, areasAssessed: 0, areasTotal: 0 }, "risk").state).toBe("todo");
  });
  it("shows approval as approved, lapsed, not approved or not ready, with the reason", () => {
    expect(step({ ...base, approval: "current", approvalNotReady: null }, "approval")).toMatchObject({ state: "done", label: "Approved", detail: null });
    expect(step({ ...base, approval: "lapsed", approvalNotReady: null }, "approval")).toMatchObject({ state: "needs_attention", label: "Needs approving again" });
    expect(step({ ...base, approvalNotReady: null }, "approval")).toMatchObject({ label: "Not approved" });
    expect(step(base, "approval")).toMatchObject({ label: "Not ready", detail: "Set materiality first." });
  });
  it("tells a preparer who each step is waiting on, instead of explaining what they cannot do", () => {
    const p = { ...base, role: "preparer" as const, approvalNotReady: null };
    expect(step(p, "materiality").waiting).toBe("Waiting for a reviewer");
    expect(step(p, "risk").waiting).toBe("Waiting for a reviewer");
    expect(step(p, "approval").waiting).toBe("Waiting for a partner");
    expect(waitingFor("partner")).toBe("Waiting for a partner");
  });
  it("tells a reviewer that approval is a partner's, and a partner nothing is waiting", () => {
    const r = { ...base, approvalNotReady: null };
    expect(step(r, "materiality").waiting).toBeNull();
    expect(step(r, "approval").waiting).toBe("Waiting for a partner");
    const pt = { ...r, role: "partner" as const };
    expect(planningSteps(pt).map((s) => s.waiting)).toEqual([null, null, null]);
  });
  it("shows no waiting once a step is done, when approval is not ready, or when the engagement is locked", () => {
    expect(step({ ...base, role: "preparer", materialitySet: true }, "materiality").waiting).toBeNull();
    expect(step({ ...base, role: "preparer" }, "approval").waiting).toBeNull();
    expect(planningSteps({ ...base, role: "preparer", open: false, approvalNotReady: null }).map((s) => s.waiting)).toEqual([null, null, null]);
  });
  it("chooses a tone for each step", () => {
    expect(stepTone(step({ ...base, materialitySet: true }, "materiality"))).toBe("success");
    expect(stepTone(step({ ...base, materialitySet: true, materialityStale: true }, "materiality"))).toBe("warning");
    expect(stepTone(step(base, "materiality"))).toBe("neutral");
    expect(stepTone(step({ ...base, role: "preparer" }, "materiality"))).toBe("warning");
  });
  it("links each step to its section", () => {
    expect(planningSteps(base).map((s) => s.anchor)).toEqual(["#materiality", "#areas", "#approval"]);
  });
  it("knows who may do what", () => {
    expect(mayDo("preparer", "reviewer")).toBe(false);
    expect(mayDo("reviewer", "reviewer")).toBe(true);
    expect(mayDo("reviewer", "partner")).toBe(false);
    expect(mayDo("admin", "partner")).toBe(true);
  });
});

describe("planning sentence", () => {
  const s = { enabled: true, materialitySet: true, materialityStale: false, areasAssessed: 2, areasTotal: 14, approval: "none" as const };
  it("says where planning stands", () => {
    expect(planningSentence(s)).toBe("Materiality set. Risk assessed in 2 of 14 areas. Not yet approved by a partner.");
    expect(planningSentence({ ...s, materialitySet: false })).toBe("Materiality not set. Risk assessed in 2 of 14 areas. Not yet approved by a partner.");
    expect(planningSentence({ ...s, approval: "current" })).toContain("Approved by a partner.");
    expect(planningSentence({ ...s, approval: "lapsed" })).toContain("Approval needs renewing.");
  });
  it("says the audit is off", () => {
    expect(planningSentence({ ...s, enabled: false })).toBe("The audit is off for this engagement.");
  });
});

describe("approval", () => {
  it("lets a partner approve once it is ready, and tells others to wait", () => {
    expect(approvalView({ state: "none", notReady: null, open: true, role: "partner" })).toMatchObject({ label: "Not approved", action: "approve" });
    expect(approvalView({ state: "lapsed", notReady: null, open: true, role: "partner" })).toMatchObject({ label: "Needs approving again", tone: "warning", action: "approve" });
    expect(approvalView({ state: "none", notReady: null, open: true, role: "reviewer" })).toMatchObject({ action: "waiting" });
    expect(approvalView({ state: "none", notReady: null, open: true, role: "preparer" })).toMatchObject({ action: "waiting" });
  });
  it("offers nothing when approved, locked, or not ready", () => {
    expect(approvalView({ state: "current", notReady: null, open: true, role: "partner" })).toMatchObject({ label: "Approved", tone: "success", action: "none" });
    expect(approvalView({ state: "none", notReady: null, open: false, role: "partner" }).action).toBe("none");
    expect(approvalView({ state: "none", notReady: "Assess every area first.", open: true, role: "partner" })).toMatchObject({ label: "Not ready", action: "none", note: "Assess every area first." });
  });
});

describe("checklists", () => {
  it("shows done, to review, or nothing", () => {
    expect(checklistPill({ steps: 5, completed: 5, unreviewed: 0 })).toEqual({ tone: "success", label: "Done" });
    expect(checklistPill({ steps: 5, completed: 5, unreviewed: 2 })).toEqual({ tone: "warning", label: "2 to review" });
    expect(checklistPill({ steps: 5, completed: 2, unreviewed: 0 })).toBeNull();
    expect(checklistPill({ steps: 0, completed: 0, unreviewed: 0 })).toBeNull();
  });
});
