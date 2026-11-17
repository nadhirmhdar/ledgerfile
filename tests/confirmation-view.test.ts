import { describe, expect, it } from "vitest";
import type { ConfirmationState, Reply } from "../src/domain/confirmations";
import {
  confirmationLine,
  confirmationResults,
  confirmationsSentence,
  filterConfirmations,
  nextAction,
  parseConfirmationShow,
  replyPill,
  showCounts,
  statePill,
  stepTracker,
  summaryTiles,
  type ConfirmationLike,
} from "../src/ui/confirmation-view";

const c = (reference: string, partyName: string, state: ConfirmationState, reply: Reply | null = null, accountRef: string | null = null): ConfirmationLike => ({ reference, partyName, accountRef, state, reply });
const rows = [
  c("CF-1", "First Gulf Bank", "reviewed", "agreed", "AED-001"),
  c("CF-2", "Orient Trading LLC", "awaiting_reply"),
  c("CF-3", "Harbour Supplies", "to_prepare", "differs", "SUP-17"),
  c("CF-4", "Desert Legal", "prepared", "agreed"),
  c("CF-5", "Falcon Customer Co", "not_sent"),
  c("CF-6", "Emirates Bank", "to_prepare", "no_reply", "AED-002"),
];
const refs = (x: { rows: ConfirmationLike[] }) => x.rows.map((r) => r.reference);

describe("filters", () => {
  it("shows each state, and the older show values still work", () => {
    expect(refs(filterConfirmations(rows))).toEqual(["CF-1", "CF-2", "CF-3", "CF-4", "CF-5", "CF-6"]);
    expect(refs(filterConfirmations(rows, { show: "notsent" }))).toEqual(["CF-5"]);
    expect(refs(filterConfirmations(rows, { show: "awaiting" }))).toEqual(["CF-2"]);
    expect(refs(filterConfirmations(rows, { show: "toprepare" }))).toEqual(["CF-3", "CF-6"]);
    expect(refs(filterConfirmations(rows, { show: "waiting" }))).toEqual(["CF-4"]);
    expect(refs(filterConfirmations(rows, { show: "reviewed" }))).toEqual(["CF-1"]);
    expect(refs(filterConfirmations(rows, { show: "differs" }))).toEqual(["CF-3"]);
    expect(refs(filterConfirmations(rows, { show: "unreviewed" }))).toEqual(["CF-2", "CF-3", "CF-4", "CF-5", "CF-6"]);
  });
  it("searches the party, the account reference or the reference, in any case", () => {
    expect(refs(filterConfirmations(rows, { q: "bank" }))).toEqual(["CF-1", "CF-6"]);
    expect(refs(filterConfirmations(rows, { q: "sup-17" }))).toEqual(["CF-3"]);
    expect(refs(filterConfirmations(rows, { q: "cf-4" }))).toEqual(["CF-4"]);
    expect(refs(filterConfirmations(rows, { q: "  " }))).toHaveLength(6);
  });
  it("combines a filter with a search, and gives nothing rather than failing", () => {
    expect(refs(filterConfirmations(rows, { show: "toprepare", q: "bank" }))).toEqual(["CF-6"]);
    expect(filterConfirmations(rows, { show: "reviewed", q: "legal" })).toMatchObject({ rows: [], shown: 0, total: 6 });
    expect(filterConfirmations([], {})).toMatchObject({ shown: 0, total: 0 });
  });
  it("counts the chips with the search applied", () => {
    expect(showCounts(rows)).toEqual({ all: 6, notsent: 1, awaiting: 1, toprepare: 2, waiting: 1, reviewed: 1, differs: 1 });
    expect(showCounts(rows, "bank")).toEqual({ all: 2, notsent: 0, awaiting: 0, toprepare: 1, waiting: 0, reviewed: 1, differs: 0 });
  });
  it("reads the address", () => {
    for (const v of ["notsent", "awaiting", "toprepare", "waiting", "reviewed", "differs", "unreviewed"]) expect(parseConfirmationShow(v)).toBe(v);
    expect(parseConfirmationShow("nonsense")).toBe("");
    expect(parseConfirmationShow(undefined)).toBe("");
    expect(parseConfirmationShow(["differs", "reviewed"])).toBe("differs");
  });
  it("says how many are shown", () => {
    expect(confirmationResults(2, 8)).toBe("Showing 2 of 8 confirmations.");
    expect(confirmationResults(1, 1)).toBe("Showing 1 of 1 confirmation.");
  });
});

describe("words", () => {
  const s = { count: 8, notSent: 1, awaitingReply: 2, agreed: 3, differs: 1, noReply: 1, prepared: 2, reviewed: 1 };
  it("writes the header sentence with plurals", () => {
    expect(confirmationsSentence(s)).toBe("8 confirmations: 3 agreed, 1 differs, 1 no reply, 2 awaiting a reply, 1 not sent.");
    expect(confirmationsSentence({ ...s, count: 1, notSent: 1, awaitingReply: 0, agreed: 0, differs: 0, noReply: 0, prepared: 0, reviewed: 0 })).toBe("1 confirmation: 1 not sent.");
    expect(confirmationsSentence({ ...s, count: 0 })).toBe("No confirmations yet.");
    expect(confirmationsSentence({ count: 2, notSent: 0, awaitingReply: 0, agreed: 0, differs: 0, noReply: 0, prepared: 0, reviewed: 2 })).toBe("2 confirmations.");
  });
  it("works out the tiles", () => {
    expect(summaryTiles(s)).toEqual({ notSent: 1, awaiting: 2, toPrepare: 2, waitingForReview: 2, reviewed: 1 });
  });
  it("has a pill for every state", () => {
    expect(statePill({ state: "not_sent", selfReviewed: false })).toEqual({ tone: "neutral", label: "Not sent" });
    expect(statePill({ state: "awaiting_reply", selfReviewed: false })).toEqual({ tone: "info", label: "Awaiting reply" });
    expect(statePill({ state: "to_prepare", selfReviewed: false })).toEqual({ tone: "warning", label: "To prepare" });
    expect(statePill({ state: "prepared", selfReviewed: false })).toEqual({ tone: "warning", label: "Prepared, waiting for review" });
    expect(statePill({ state: "reviewed", selfReviewed: false })).toEqual({ tone: "success", label: "Reviewed" });
    expect(statePill({ state: "reviewed", selfReviewed: true })).toEqual({ tone: "warning", label: "Self-reviewed" });
  });
  it("adds a pill for a difference or no reply, and none otherwise", () => {
    expect(replyPill("differs")).toEqual({ tone: "danger", label: "Differs" });
    expect(replyPill("no_reply")).toEqual({ tone: "warning", label: "No reply" });
    expect(replyPill("agreed")).toBeNull();
    expect(replyPill(null)).toBeNull();
  });
  it("writes the line of facts", () => {
    expect(confirmationLine({ bookMinor: 100_000, confirmedMinor: null, differenceMinor: null, sentOn: null, reminders: [], reply: null, repliedOn: null })).toBe("Book 1,000.00, not sent");
    expect(confirmationLine({ bookMinor: 100_000, confirmedMinor: 90_000, differenceMinor: 10_000, sentOn: "2026-01-05", reminders: ["2026-01-12", "2026-01-19"], reply: "differs", repliedOn: "2026-01-25" })).toBe(
      "Book 1,000.00, confirmed 900.00, difference 100.00, sent 2026-01-05, 2 reminders, differs from the books 2026-01-25".replace("differs from the books", "differs"),
    );
    expect(confirmationLine({ bookMinor: 5_000, confirmedMinor: 5_000, differenceMinor: 0, sentOn: "2026-01-05", reminders: ["2026-01-12"], reply: "agreed", repliedOn: "2026-01-14" })).toBe("Book 50.00, confirmed 50.00, sent 2026-01-05, 1 reminder, agreed 2026-01-14");
  });
});

describe("the step tracker", () => {
  const t = (o: Partial<Parameters<typeof stepTracker>[0]> = {}) => stepTracker({ sentOn: null, reply: null, preparedByName: null, reviewedByName: null, ...o });
  it("marks the first step not done as the next one, with words", () => {
    expect(t().map((s) => [s.label, s.state, s.text])).toEqual([["Sent", "current", "Next"], ["Reply", "todo", "Not yet"], ["Prepared", "todo", "Not yet"], ["Reviewed", "todo", "Not yet"]]);
    expect(t({ sentOn: "2026-01-01" }).map((s) => s.state)).toEqual(["done", "current", "todo", "todo"]);
    expect(t({ sentOn: "2026-01-01", reply: "agreed" }).map((s) => s.state)).toEqual(["done", "done", "current", "todo"]);
    expect(t({ sentOn: "2026-01-01", reply: "agreed", preparedByName: "P" }).map((s) => s.state)).toEqual(["done", "done", "done", "current"]);
    expect(t({ sentOn: "2026-01-01", reply: "no_reply", preparedByName: "P", reviewedByName: "R" }).map((s) => s.state)).toEqual(["done", "done", "done", "done"]);
  });
});

describe("the one next action", () => {
  const row = (o: Partial<Parameters<typeof nextAction>[0]> = {}) => ({ state: "not_sent" as ConfirmationState, sentOn: null as string | null, reply: null as Reply | null, reconciliation: null as string | null, alternativeProcedures: null as string | null, ...o });
  const roles = ["preparer", "reviewer", "partner"] as const;

  it("is to mark sent for a confirmation that has not gone out, for every role", () => {
    for (const role of roles) expect(nextAction(row(), role, false, true)).toEqual({ kind: "mark_sent" });
  });
  it("is to record the reply once sent", () => {
    for (const role of roles) expect(nextAction(row({ state: "awaiting_reply", sentOn: "2026-01-01" }), role, false, true)).toEqual({ kind: "record_reply" });
  });
  it("asks for the missing work before preparing, with the reason", () => {
    const differs = row({ state: "to_prepare", sentOn: "2026-01-01", reply: "differs" });
    expect(nextAction(differs, "preparer", false, true)).toMatchObject({ kind: "add_work", reason: expect.stringMatching(/reconciled/) });
    expect(nextAction(row({ state: "to_prepare", sentOn: "2026-01-01", reply: "no_reply" }), "reviewer", false, true)).toMatchObject({ kind: "add_work", reason: expect.stringMatching(/alternative/) });
  });
  it("is to mark prepared when nothing is missing", () => {
    for (const role of roles) {
      expect(nextAction(row({ state: "to_prepare", sentOn: "2026-01-01", reply: "agreed" }), role, false, true)).toEqual({ kind: "prepare" });
      expect(nextAction(row({ state: "to_prepare", sentOn: "2026-01-01", reply: "differs", reconciliation: "Cheque in transit." }), role, false, true)).toEqual({ kind: "prepare" });
    }
  });
  it("is to review for a reviewer or partner once prepared, and a waiting pill for a preparer", () => {
    const prepared = row({ state: "prepared", sentOn: "2026-01-01", reply: "agreed" });
    expect(nextAction(prepared, "preparer", false, true)).toEqual({ kind: "waiting_review" });
    expect(nextAction(prepared, "reviewer", false, true)).toEqual({ kind: "review" });
    expect(nextAction(prepared, "partner", false, true)).toEqual({ kind: "review" });
  });
  it("is nothing once reviewed", () => {
    for (const role of roles) expect(nextAction(row({ state: "reviewed", sentOn: "2026-01-01", reply: "agreed" }), role, false, true)).toEqual({ kind: "none" });
  });
  it("is nothing on a locked engagement or with the audit off, in every state", () => {
    const states: ConfirmationState[] = ["not_sent", "awaiting_reply", "to_prepare", "prepared", "reviewed"];
    for (const state of states) {
      for (const role of roles) {
        const r = row({ state, sentOn: state === "not_sent" ? null : "2026-01-01", reply: state === "not_sent" || state === "awaiting_reply" ? null : "agreed" });
        expect(nextAction(r, role, true, true)).toEqual({ kind: "none" });
        expect(nextAction(r, role, false, false)).toEqual({ kind: "none" });
      }
    }
  });
});

describe("nextAction when the viewer worked on it", () => {
  const prepared = { state: "prepared" as ConfirmationState, sentOn: "2026-01-01", reply: "agreed" as const, reconciliation: null, alternativeProcedures: null };
  it("offers a reviewer who did not work on it the button, as before", () => {
    expect(nextAction(prepared, "reviewer", false, true, { workedOnIt: false, selfReviewAllowed: false })).toEqual({ kind: "review" });
    expect(nextAction(prepared, "partner", false, true, { workedOnIt: false, selfReviewAllowed: true })).toEqual({ kind: "review" });
    expect(nextAction(prepared, "reviewer", false, true)).toEqual({ kind: "review" });
  });
  it("withholds the button from a reviewer who worked on it where the firm has another reviewer, and says why", () => {
    for (const role of ["reviewer", "partner"] as const) {
      expect(nextAction(prepared, role, false, true, { workedOnIt: true, selfReviewAllowed: false })).toEqual({ kind: "waiting_other_reviewer", reason: "You worked on this, so another reviewer signs it off." });
    }
  });
  it("keeps the button, marked as a self-review, where the firm may self-review", () => {
    expect(nextAction(prepared, "reviewer", false, true, { workedOnIt: true, selfReviewAllowed: true })).toEqual({ kind: "review", selfReview: true });
  });
  it("does not change what a preparer sees, or anything locked, off or already reviewed", () => {
    expect(nextAction(prepared, "preparer", false, true, { workedOnIt: true, selfReviewAllowed: false })).toEqual({ kind: "waiting_review" });
    expect(nextAction(prepared, "reviewer", true, true, { workedOnIt: true, selfReviewAllowed: false })).toEqual({ kind: "none" });
    expect(nextAction({ ...prepared, state: "reviewed" }, "reviewer", false, true, { workedOnIt: true, selfReviewAllowed: false })).toEqual({ kind: "none" });
  });
});
