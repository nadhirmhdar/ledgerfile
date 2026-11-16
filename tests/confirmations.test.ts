import { describe, expect, it } from "vitest";
import {
  checkAmount,
  checkReminder,
  checkReply,
  checkSent,
  cleanParty,
  compareAreas,
  confirmationBlockers,
  confirmationState,
  defaultAreaFor,
  differenceMinor,
  prepareBlocker,
  resolveArea,
  summarise,
  type ConfirmationState,
} from "../src/domain/confirmations";

const TODAY = "2025-06-15";

describe("confirmation state", () => {
  it("moves from not sent to awaiting reply to to prepare to prepared to reviewed", () => {
    const base = { sentOn: null as string | null, reply: null as "agreed" | null, prepared: false, reviewed: false };
    expect(confirmationState(base)).toBe("not_sent");
    expect(confirmationState({ ...base, sentOn: "2025-06-01" })).toBe("awaiting_reply");
    expect(confirmationState({ ...base, sentOn: "2025-06-01", reply: "agreed" })).toBe("to_prepare");
    expect(confirmationState({ ...base, sentOn: "2025-06-01", reply: "agreed", prepared: true })).toBe("prepared");
    expect(confirmationState({ ...base, sentOn: "2025-06-01", reply: "agreed", prepared: true, reviewed: true })).toBe("reviewed");
  });
});

describe("lock blockers", () => {
  const s = (...n: ConfirmationState[]) => n;
  it("says nothing when there are none or all are reviewed", () => {
    expect(confirmationBlockers([])).toEqual([]);
    expect(confirmationBlockers(s("reviewed", "reviewed"))).toEqual([]);
  });
  it("counts each kind of unfinished confirmation, for one and for several", () => {
    expect(confirmationBlockers(s("not_sent"))).toEqual([
      "Audit: 1 confirmation(s) have not been sent. Send them, or delete those that will not be sent.",
      "Audit: 1 confirmation(s) have not been reviewed.",
    ]);
    expect(confirmationBlockers(s("awaiting_reply", "awaiting_reply", "to_prepare", "prepared", "reviewed"))).toEqual([
      "Audit: 2 confirmation(s) are awaiting a reply.",
      "Audit: 1 confirmation(s) have a reply but are not prepared.",
      "Audit: 4 confirmation(s) have not been reviewed.",
    ]);
  });
});

describe("reply rules", () => {
  const ctx = { bookMinor: 500_000, sentOn: "2025-06-01", today: TODAY };
  it("takes the book balance for agreed, and the date defaults to today", () => {
    expect(checkReply({ reply: "agreed" }, ctx)).toEqual({ reply: "agreed", repliedOn: TODAY, confirmedMinor: 500_000 });
    expect(checkReply({ reply: "agreed", repliedOn: "2025-06-10", confirmedMinor: 1 }, ctx).confirmedMinor).toBe(500_000);
  });
  it("needs a confirmed amount that differs from the books for differs", () => {
    expect(checkReply({ reply: "differs", confirmedMinor: 450_000 }, ctx)).toEqual({ reply: "differs", repliedOn: TODAY, confirmedMinor: 450_000 });
    expect(() => checkReply({ reply: "differs" }, ctx)).toThrow(/Enter the amount/);
    expect(() => checkReply({ reply: "differs", confirmedMinor: 500_000 }, ctx)).toThrow(/Record the reply as agreed/);
    expect(checkReply({ reply: "differs", confirmedMinor: 0 }, { ...ctx, bookMinor: 0 + 1 }).confirmedMinor).toBe(0);
  });
  it("has no date or amount for no reply", () => {
    expect(checkReply({ reply: "no_reply", repliedOn: "2025-06-10", confirmedMinor: 5 }, ctx)).toEqual({ reply: "no_reply", repliedOn: null, confirmedMinor: null });
  });
  it("refuses a reply before it was sent, in the future, or with an unknown kind", () => {
    expect(() => checkReply({ reply: "agreed" }, { ...ctx, sentOn: null })).toThrow(/sent before/);
    expect(() => checkReply({ reply: "agreed", repliedOn: "2025-05-31" }, ctx)).toThrow(/before the date sent/);
    expect(() => checkReply({ reply: "agreed", repliedOn: "2025-06-16" }, ctx)).toThrow(/future/);
    expect(() => checkReply({ reply: "agreed", repliedOn: "2025-02-30" }, ctx)).toThrow(/not a valid date/);
    expect(() => checkReply({ reply: "maybe" }, ctx)).toThrow(/Choose/);
  });
  it("accepts a negative book balance", () => {
    expect(checkReply({ reply: "differs", confirmedMinor: -100 }, { ...ctx, bookMinor: -200 }).confirmedMinor).toBe(-100);
    expect(checkReply({ reply: "agreed" }, { ...ctx, bookMinor: -200 }).confirmedMinor).toBe(-200);
  });
});

describe("date rules", () => {
  it("dates sent default to today, not the future, not after a reply or reminder", () => {
    expect(checkSent(null, TODAY, { repliedOn: null, reminders: [] })).toBe(TODAY);
    expect(() => checkSent("2025-06-16", TODAY, { repliedOn: null, reminders: [] })).toThrow(/future/);
    expect(() => checkSent("2025-06-10", TODAY, { repliedOn: "2025-06-09", reminders: [] })).toThrow(/reply is dated/);
    expect(() => checkSent("2025-06-10", TODAY, { repliedOn: null, reminders: ["2025-06-05"] })).toThrow(/reminder is dated/);
    expect(checkSent("2025-06-05", TODAY, { repliedOn: "2025-06-05", reminders: ["2025-06-05"] })).toBe("2025-06-05");
  });
  it("reminders follow sending, are not future or repeated, and stop at five", () => {
    expect(() => checkReminder(null, TODAY, null, [])).toThrow(/sent before/);
    expect(checkReminder(null, TODAY, "2025-06-01", [])).toBe(TODAY);
    expect(() => checkReminder("2025-05-31", TODAY, "2025-06-01", [])).toThrow(/before the date sent/);
    expect(() => checkReminder("2025-06-16", TODAY, "2025-06-01", [])).toThrow(/future/);
    expect(() => checkReminder("2025-06-10", TODAY, "2025-06-01", ["2025-06-10"])).toThrow(/already a reminder/);
    expect(() => checkReminder("2025-06-12", TODAY, "2025-06-01", ["2025-06-02", "2025-06-03", "2025-06-04", "2025-06-05", "2025-06-06"])).toThrow(/at most 5/);
  });
});

describe("fields and areas", () => {
  it("defaults the area from the kind, and asks for one for other", () => {
    expect(defaultAreaFor("bank")).toBe("C6");
    expect(defaultAreaFor("receivable")).toBe("C5");
    expect(defaultAreaFor("payable")).toBe("C8");
    expect(defaultAreaFor("related_party")).toBe("C7");
    expect(defaultAreaFor("legal")).toBe("C10");
    expect(defaultAreaFor("other")).toBeNull();
    expect(resolveArea("bank", "")).toBe("C6");
    expect(resolveArea("bank", "C9")).toBe("C9");
    expect(() => resolveArea("other", "")).toThrow(/Choose the audit area/);
    expect(() => resolveArea("bank", "C99")).toThrow(/Choose one of/);
  });
  it("cleans names and amounts", () => {
    expect(cleanParty("  First Bank  ")).toBe("First Bank");
    expect(() => cleanParty("  ")).toThrow(/Enter who/);
    expect(() => cleanParty("x".repeat(201))).toThrow(/too long/);
    expect(checkAmount(-5, "x")).toBe(-5);
    expect(() => checkAmount(1.5, "The amount")).toThrow(/not a valid/);
  });
  it("says what is needed before preparing", () => {
    const ok = { sentOn: "2025-06-01", reply: "agreed" as const, reconciliation: null, alternativeProcedures: null };
    expect(prepareBlocker(ok)).toBeNull();
    expect(prepareBlocker({ ...ok, sentOn: null })).toMatch(/sent/);
    expect(prepareBlocker({ ...ok, reply: null as never })).toMatch(/reply/);
    expect(prepareBlocker({ ...ok, reply: "differs" })).toMatch(/reconciled/);
    expect(prepareBlocker({ ...ok, reply: "differs", reconciliation: "Cheque in transit." })).toBeNull();
    expect(prepareBlocker({ ...ok, reply: "no_reply" })).toMatch(/alternative/);
    expect(prepareBlocker({ ...ok, reply: "no_reply", alternativeProcedures: "Agreed to receipts." })).toBeNull();
  });
});

describe("summary", () => {
  const rows = [
    { areaCode: "C6", bookMinor: 1_000, confirmedMinor: 1_000, reply: "agreed" as const, state: "reviewed" as const },
    { areaCode: "C6", bookMinor: 2_000, confirmedMinor: 1_500, reply: "differs" as const, state: "prepared" as const },
    { areaCode: "C5", bookMinor: 3_000, confirmedMinor: null, reply: "no_reply" as const, state: "to_prepare" as const },
    { areaCode: "C5", bookMinor: -400, confirmedMinor: null, reply: null, state: "awaiting_reply" as const },
    { areaCode: "C5", bookMinor: 0, confirmedMinor: null, reply: null, state: "not_sent" as const },
  ];
  it("counts by state and reply, totals the books and confirmed amounts, and signs the difference as book less confirmed", () => {
    const { overall, byArea } = summarise(rows);
    expect(overall).toEqual({ count: 5, notSent: 1, awaitingReply: 1, agreed: 1, differs: 1, noReply: 1, prepared: 1, reviewed: 1, bookMinor: 5_600, confirmedMinor: 2_500, differenceMinor: 500 });
    expect(byArea.get("C6")).toMatchObject({ count: 2, bookMinor: 3_000, confirmedMinor: 2_500, differenceMinor: 500, agreed: 1, differs: 1 });
    expect(byArea.get("C5")).toMatchObject({ count: 3, notSent: 1, awaitingReply: 1, noReply: 1, confirmedMinor: 0, differenceMinor: 0 });
    expect(differenceMinor(2_000, 1_500)).toBe(500);
    expect(differenceMinor(1_000, 1_500)).toBe(-500);
    expect(differenceMinor(1_000, null)).toBeNull();
  });
  it("orders areas numerically", () => {
    expect(["C10", "C2", "C6"].sort(compareAreas)).toEqual(["C2", "C6", "C10"]);
  });
});
