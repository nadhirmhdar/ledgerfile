import { describe, expect, it } from "vitest";
import { countProcedures, filterProcedures, isWaiting, parseProcedureShow, procedureControls, procedureResults, reviewPill, workPill, type ProcedureLike } from "../src/ui/procedure-view";

const p = (o: Partial<ProcedureLike> = {}): ProcedureLike => ({ status: "open", reviewedAt: null, reviewedByName: null, selfReviewed: false, partnerStep: false, ...o });
const reviewed = (o: Partial<ProcedureLike> = {}) => p({ status: "done", reviewedAt: "2026-02-01", reviewedByName: "Rae Reviewer", ...o });
const rows = [
  { id: "1", ...p() },
  { id: "2", ...p({ status: "done" }) },
  { id: "3", ...p({ status: "na" }) },
  { id: "4", ...reviewed() },
  { id: "5", ...p({ status: "done", partnerStep: true }) },
  { id: "6", ...p() },
];

describe("filters", () => {
  it("counts open, waiting for review and done", () => {
    expect(countProcedures(rows)).toEqual({ all: 6, open: 2, waiting: 2, done: 2 });
    expect(countProcedures([])).toEqual({ all: 0, open: 0, waiting: 0, done: 0 });
  });
  it("shows each filter, in the programme's own order", () => {
    const ids = (s: Parameters<typeof filterProcedures>[1]) => filterProcedures(rows, s).rows.map((r) => r.id);
    expect(ids("all")).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(ids("open")).toEqual(["1", "6"]);
    expect(ids("waiting")).toEqual(["2", "3"]);
    expect(ids("done")).toEqual(["4", "5"]);
  });
  it("reports how many are shown, and counts every procedure whatever is shown", () => {
    const v = filterProcedures(rows, "open");
    expect(v).toMatchObject({ shown: 2, total: 6 });
    expect(v.counts.all).toBe(6);
    expect(procedureResults(2, 6, "procedures")).toBe("Showing 2 of 6 procedures.");
  });
  it("gives nothing, not an error, when no procedure fits", () => {
    expect(filterProcedures([], "waiting")).toMatchObject({ rows: [], shown: 0, total: 0 });
    expect(filterProcedures([{ ...p() }], "done").rows).toEqual([]);
  });
  it("reads the address, treating anything unknown as all", () => {
    expect(parseProcedureShow("open")).toBe("open");
    expect(parseProcedureShow("waiting")).toBe("waiting");
    expect(parseProcedureShow("done")).toBe("done");
    expect(parseProcedureShow("x")).toBe("all");
    expect(parseProcedureShow(undefined)).toBe("all");
    expect(parseProcedureShow(["done", "open"])).toBe("done");
  });
  it("does not count a partner's own sign-off as waiting", () => {
    expect(isWaiting(p({ status: "done", partnerStep: true }))).toBe(false);
    expect(isWaiting(p({ status: "na" }))).toBe(true);
    expect(isWaiting(p())).toBe(false);
  });
});

describe("pills", () => {
  it("shows the work as open, completed or not applicable", () => {
    expect(workPill(p())).toEqual({ tone: "neutral", label: "Open" });
    expect(workPill(p({ status: "done" }))).toEqual({ tone: "success", label: "Completed" });
    expect(workPill(p({ status: "na" }))).toEqual({ tone: "muted", label: "Not applicable" });
  });
  it("shows the review: none while open, then waiting, reviewed, self-reviewed or a partner's sign-off", () => {
    expect(reviewPill(p())).toBeNull();
    expect(reviewPill(p({ status: "done" }))).toEqual({ tone: "warning", label: "Waiting for review" });
    expect(reviewPill(reviewed())).toEqual({ tone: "success", label: "Reviewed by Rae Reviewer on 2026-02-01" });
    expect(reviewPill(reviewed({ selfReviewed: true }))).toEqual({ tone: "warning", label: "Self-reviewed by Rae Reviewer on 2026-02-01" });
    expect(reviewPill(p({ status: "done", partnerStep: true }))).toEqual({ tone: "neutral", label: "Partner sign-off" });
  });
});

describe("controls", () => {
  const ctx = (role: "preparer" | "reviewer" | "partner", o: { open?: boolean; auditOn?: boolean } = {}) => ({ open: true, auditOn: true, role, userId: "u1", ...o });

  it("offers editing on an open procedure, and review controls only to a reviewer once it is completed", () => {
    expect(procedureControls(p(), ctx("preparer"))).toMatchObject({ edit: true, review: null, attach: true, lockedByReview: false });
    expect(procedureControls(p(), ctx("reviewer")).review).toBeNull();
    expect(procedureControls(p({ status: "done" }), ctx("preparer")).review).toBeNull();
    expect(procedureControls(p({ status: "done" }), ctx("reviewer")).review).toBe("review");
    expect(procedureControls(p({ status: "done" }), ctx("partner")).review).toBe("review");
  });
  it("offers withdrawing a review to a reviewer, and locks the work for everyone", () => {
    expect(procedureControls(reviewed(), ctx("reviewer"))).toMatchObject({ review: "withdraw", edit: false, lockedByReview: true });
    expect(procedureControls(reviewed(), ctx("preparer"))).toMatchObject({ review: null, edit: false, lockedByReview: true });
  });
  it("offers no review of a partner's own sign-off", () => {
    expect(procedureControls(p({ status: "done", partnerStep: true }), ctx("partner")).review).toBeNull();
  });
  it("lets the uploader or a reviewer remove evidence", () => {
    expect(procedureControls(p(), ctx("preparer")).canRemove("u1")).toBe(true);
    expect(procedureControls(p(), ctx("preparer")).canRemove("u2")).toBe(false);
    expect(procedureControls(p(), ctx("reviewer")).canRemove("u2")).toBe(true);
  });
  it("is read-only when the audit is off or the engagement is locked", () => {
    for (const o of [{ auditOn: false }, { open: false }]) {
      const c = procedureControls(p({ status: "done" }), ctx("partner", o));
      expect(c).toMatchObject({ edit: false, review: null, attach: false, lockedByReview: false });
      expect(c.canRemove("u1")).toBe(false);
    }
  });
});

describe("controls when the viewer did the work", () => {
  const ctx = (role: "preparer" | "reviewer" | "partner", selfReviewAllowed?: boolean) => ({ open: true, auditOn: true, role, userId: "u1", selfReviewAllowed });
  const mine = p({ status: "done", viewerWorkedOnIt: true });
  it("offers review as before when the viewer did not do the work", () => {
    expect(procedureControls(p({ status: "done", viewerWorkedOnIt: false }), ctx("reviewer"))).toMatchObject({ review: "review" });
    expect(procedureControls(p({ status: "done" }), ctx("reviewer")).workedOnIt).toBeUndefined();
  });
  it("withholds review from a reviewer who did the work where the firm has another reviewer", () => {
    for (const role of ["reviewer", "partner"] as const) expect(procedureControls(mine, ctx(role, false))).toMatchObject({ review: null, workedOnIt: "waiting" });
  });
  it("keeps review, marked as a self-review, where the firm may self-review", () => {
    expect(procedureControls(mine, ctx("reviewer", true))).toMatchObject({ review: "review", workedOnIt: "self" });
  });
  it("leaves withdrawing a review, a preparer, an open procedure and a partner's step alone", () => {
    expect(procedureControls(reviewed({ viewerWorkedOnIt: true }), ctx("reviewer", false))).toMatchObject({ review: "withdraw" });
    expect(procedureControls(mine, ctx("preparer", false)).workedOnIt).toBeUndefined();
    expect(procedureControls(p({ viewerWorkedOnIt: true }), ctx("reviewer", false))).toMatchObject({ review: null });
    expect(procedureControls(p({ status: "done", partnerStep: true, viewerWorkedOnIt: true }), ctx("partner", false)).workedOnIt).toBeUndefined();
  });
});
