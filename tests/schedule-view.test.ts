import { describe, expect, it } from "vitest";
import { keyItemsSentence, readOnlyReason, reviewBadge, scheduleSentence, signOffControls, unsavedLabel, type ScheduleFacts } from "../src/ui/schedule-view";

const base: ScheduleFacts = { lineCount: 5, totalMinor: 96220025, testedPct: 87.31, differenceMinor: 125000, explained: true, reviewedByName: null, selfReviewed: false };

describe("scheduleSentence", () => {
  it("says there are no lines yet", () => {
    expect(scheduleSentence({ ...base, lineCount: 0, totalMinor: 0, testedPct: null, differenceMinor: null })).toBe("No lines yet. Not yet reviewed.");
  });
  it("words a difference that is explained", () => {
    expect(scheduleSentence(base)).toBe("5 lines totalling 962,200.25; 87.3% tested. Differs from the balance by 1,250.00 (explained). Not yet reviewed.");
  });
  it("words a difference that is not explained", () => {
    expect(scheduleSentence({ ...base, explained: false })).toContain("(not explained)");
  });
  it("says it agrees, with one line in the singular", () => {
    expect(scheduleSentence({ ...base, lineCount: 1, differenceMinor: 0 })).toBe("1 line totalling 962,200.25; 87.3% tested. Agrees to the balance. Not yet reviewed.");
  });
  it("leaves out the balance when there is none, and the percentage when there is no total", () => {
    expect(scheduleSentence({ ...base, differenceMinor: null, testedPct: null })).toBe("5 lines totalling 962,200.25. Not yet reviewed.");
  });
  it("says reviewed or self-reviewed", () => {
    expect(scheduleSentence({ ...base, reviewedByName: "Sam", differenceMinor: 0 }).endsWith("Reviewed.")).toBe(true);
    expect(scheduleSentence({ ...base, reviewedByName: "Sam", selfReviewed: true, differenceMinor: 0 }).endsWith("Self-reviewed.")).toBe(true);
  });
});

describe("reviewBadge", () => {
  it("is neutral when not reviewed", () => {
    expect(reviewBadge({ reviewedByName: null, reviewedAt: null, selfReviewed: false })).toEqual({ tone: "neutral", label: "Not yet reviewed" });
  });
  it("is success when reviewed", () => {
    expect(reviewBadge({ reviewedByName: "Sam Rivera", reviewedAt: "2025-03-01", selfReviewed: false })).toEqual({ tone: "success", label: "Reviewed by Sam Rivera on 2025-03-01" });
  });
  it("is warning, in its own words, when self-reviewed", () => {
    expect(reviewBadge({ reviewedByName: "Sam Rivera", reviewedAt: "2025-03-01", selfReviewed: true })).toEqual({ tone: "warning", label: "Self-reviewed by Sam Rivera on 2025-03-01" });
  });
});

describe("readOnlyReason", () => {
  it("gives one reason, locked first", () => {
    expect(readOnlyReason({ open: false, auditOn: false, reviewed: true })).toContain("locked");
    expect(readOnlyReason({ open: true, auditOn: false, reviewed: true })).toContain("audit is off");
    expect(readOnlyReason({ open: true, auditOn: true, reviewed: true })).toContain("has been reviewed");
    expect(readOnlyReason({ open: true, auditOn: true, reviewed: false })).toBeNull();
  });
});

describe("signOffControls", () => {
  const open = { open: true, auditOn: true };
  it("lets a reviewer or partner review, and withdraw a review", () => {
    for (const role of ["reviewer", "partner", "admin"] as const) {
      expect(signOffControls({ role, ...open, reviewed: false, hasConclusion: true }).review).toBe("review");
      expect(signOffControls({ role, ...open, reviewed: true, hasConclusion: true }).review).toBe("withdraw");
    }
  });
  it("never lets a preparer review", () => {
    expect(signOffControls({ role: "preparer", ...open, reviewed: false, hasConclusion: false }).review).toBeNull();
    expect(signOffControls({ role: "preparer", ...open, reviewed: true, hasConclusion: true }).review).toBeNull();
  });
  it("lets a reviewer delete an unreviewed schedule whatever its conclusion", () => {
    expect(signOffControls({ role: "reviewer", ...open, reviewed: false, hasConclusion: true }).delete).toBe(true);
    expect(signOffControls({ role: "reviewer", ...open, reviewed: false, hasConclusion: false }).delete).toBe(true);
  });
  it("lets a preparer delete only before a conclusion is recorded", () => {
    expect(signOffControls({ role: "preparer", ...open, reviewed: false, hasConclusion: false }).delete).toBe(true);
    expect(signOffControls({ role: "preparer", ...open, reviewed: false, hasConclusion: true }).delete).toBe(false);
  });
  it("never offers delete on a reviewed schedule", () => {
    expect(signOffControls({ role: "partner", ...open, reviewed: true, hasConclusion: true }).delete).toBe(false);
  });
  it("shows nothing when locked or the audit is off", () => {
    expect(signOffControls({ role: "partner", open: false, auditOn: true, reviewed: false, hasConclusion: false })).toEqual({ review: null, delete: false });
    expect(signOffControls({ role: "partner", open: true, auditOn: false, reviewed: false, hasConclusion: false })).toEqual({ review: null, delete: false });
  });
});

describe("small wording", () => {
  it("counts unsaved changes", () => {
    expect(unsavedLabel(1)).toBe("1 unsaved change");
    expect(unsavedLabel(3)).toBe("3 unsaved changes");
  });
  it("words the key items note with plain plurals", () => {
    expect(keyItemsSentence(2, 500000)).toBe("2 key items not tested: lines at or above 5,000.00 that are not marked tested. This does not stop the schedule being reviewed, so the reviewer should look at them.");
    expect(keyItemsSentence(1, 500000)).toContain("1 key item not tested");
    expect(keyItemsSentence(1, 500000)).toContain("look at it.");
  });
});

describe("signOffControls when the viewer worked on the schedule", () => {
  const base = { open: true, auditOn: true, reviewed: false, hasConclusion: true };
  it("offers a reviewer who did not work on it the review, as before", () => {
    expect(signOffControls({ ...base, role: "reviewer", viewerWorkedOnIt: false, selfReviewAllowed: false })).toEqual({ review: "review", delete: true });
    expect(signOffControls({ ...base, role: "partner" })).toEqual({ review: "review", delete: true });
  });
  it("withholds the review from one who worked on it where the firm has another reviewer, and marks it as waiting", () => {
    for (const role of ["reviewer", "partner", "admin"] as const) {
      expect(signOffControls({ ...base, role, viewerWorkedOnIt: true, selfReviewAllowed: false })).toEqual({ review: null, workedOnIt: "waiting", delete: true });
    }
  });
  it("keeps the button, marked as a self-review, where the firm may self-review", () => {
    expect(signOffControls({ ...base, role: "reviewer", viewerWorkedOnIt: true, selfReviewAllowed: true })).toEqual({ review: "review", workedOnIt: "self", delete: true });
  });
  it("leaves withdrawing a review, a preparer, and a locked or reviewed schedule alone", () => {
    expect(signOffControls({ ...base, reviewed: true, role: "reviewer", viewerWorkedOnIt: true, selfReviewAllowed: false })).toEqual({ review: "withdraw", delete: false });
    expect(signOffControls({ ...base, role: "preparer", viewerWorkedOnIt: true, selfReviewAllowed: false })).toEqual({ review: null, delete: false });
    expect(signOffControls({ ...base, open: false, role: "reviewer", viewerWorkedOnIt: true, selfReviewAllowed: false })).toEqual({ review: null, delete: false });
  });
});
