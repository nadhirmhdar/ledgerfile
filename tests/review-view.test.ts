import { describe, expect, it } from "vitest";
import { signOffBlocker } from "../src/domain/signoff";
import { openPointsPill, pointControls, readinessView, signCell, signOffProgress } from "../src/ui/review-view";


describe("readiness", () => {
  it("is locked, with who and when, and only a partner can unlock", () => {
    const base = { open: false, ready: false, blockers: 0, lockedByName: "Dana Partner", lockedAt: "2026-11-02 09:15 UTC" };
    expect(readinessView({ ...base, role: "partner" })).toEqual({ state: "locked", sentence: "Locked on 2026-11-02 09:15 UTC by Dana Partner.", lock: "none", canUnlock: true });
    expect(readinessView({ ...base, role: "admin" }).canUnlock).toBe(true);
    expect(readinessView({ ...base, role: "reviewer" }).canUnlock).toBe(false);
    expect(readinessView({ ...base, role: "preparer" }).canUnlock).toBe(false);
  });
  it("is ready: a partner gets the lock button and everyone else a waiting pill", () => {
    const base = { open: true, ready: true, blockers: 0 };
    expect(readinessView({ ...base, role: "partner" })).toEqual({ state: "ready", sentence: "Ready to lock.", lock: "lock", canUnlock: false });
    expect(readinessView({ ...base, role: "admin" }).lock).toBe("lock");
    expect(readinessView({ ...base, role: "reviewer" }).lock).toBe("waiting");
    expect(readinessView({ ...base, role: "preparer" }).lock).toBe("waiting");
  });
  it("is not ready, with the count in plain words and nothing to lock or unlock", () => {
    expect(readinessView({ open: true, ready: false, blockers: 3, role: "partner" })).toEqual({ state: "not_ready", sentence: "3 things still open before the file can be locked.", lock: "none", canUnlock: false });
    expect(readinessView({ open: true, ready: false, blockers: 1, role: "preparer" }).sentence).toBe("1 thing still open before the file can be locked.");
  });
});

describe("a lead sheet cell", () => {
  const rae = { userId: "u1", name: "Rae Reviewer", at: "2026-02-01" };
  const pat = { userId: "u2", name: "Pat Preparer", at: "2026-01-30" };
  type O = { preparer?: typeof rae | null; reviewer?: typeof rae | null; openPoints?: number; sole?: boolean; open?: boolean; role?: "preparer" | "reviewer" | "partner"; userId?: string };
  const cell = (level: "preparer" | "reviewer", o: O = {}) =>
    signCell({ level, preparer: o.preparer ?? null, reviewer: o.reviewer ?? null, openPoints: o.openPoints ?? 0, solePractitioner: o.sole ?? false, open: o.open ?? true, role: o.role ?? "preparer", userId: o.userId ?? "u1" });

  it("shows who signed, and a withdraw button only for the signer on an open engagement", () => {
    expect(cell("preparer", { preparer: rae })).toEqual({ kind: "signed", name: "Rae Reviewer", at: "2026-02-01", canWithdraw: true });
    expect(cell("preparer", { preparer: rae, userId: "u3" })).toMatchObject({ kind: "signed", canWithdraw: false });
    expect(cell("reviewer", { preparer: pat, reviewer: rae, open: false })).toMatchObject({ kind: "signed", canWithdraw: false });
  });
  it("offers anyone a button to sign as prepared", () => {
    expect(cell("preparer", { role: "preparer" })).toEqual({ kind: "sign", label: "Sign as prepared" });
    expect(cell("preparer", { role: "partner" })).toEqual({ kind: "sign", label: "Sign as prepared" });
  });
  it("offers a reviewer the button to sign as reviewed only when the rules would accept it", () => {
    expect(cell("reviewer", { role: "reviewer", preparer: pat })).toEqual({ kind: "sign", label: "Sign as reviewed" });
    expect(cell("reviewer", { role: "partner", preparer: pat })).toEqual({ kind: "sign", label: "Sign as reviewed" });
  });
  it("tells a preparer looking at the reviewer column to wait for a reviewer", () => {
    expect(cell("reviewer", { role: "preparer", preparer: pat })).toEqual({ kind: "waiting", label: "Waiting for a reviewer" });
    expect(cell("reviewer", { role: "preparer" })).toEqual({ kind: "waiting", label: "Waiting for a reviewer" });
  });
  it("shows a neutral pill, not a button, when nobody has prepared the lead sheet", () => {
    expect(cell("reviewer", { role: "reviewer" })).toEqual({ kind: "waiting", label: "Waiting for preparation" });
  });
  it("shows a neutral pill when the reviewer prepared it and the firm has someone else to review", () => {
    expect(cell("reviewer", { role: "reviewer", preparer: rae })).toEqual({ kind: "waiting", label: "Needs another reviewer" });
  });
  it("offers the button for a reviewer's own work in a sole practice", () => {
    expect(cell("reviewer", { role: "reviewer", preparer: rae, sole: true })).toEqual({ kind: "sign", label: "Sign as reviewed" });
  });
  it("shows a warning pill with the count while review points are open", () => {
    expect(cell("reviewer", { role: "reviewer", preparer: pat, openPoints: 1 })).toEqual({ kind: "blocked", label: "Clear 1 open point first" });
    expect(cell("reviewer", { role: "partner", preparer: pat, openPoints: 3 })).toEqual({ kind: "blocked", label: "Clear 3 open points first" });
  });
  it("never offers a button the domain rule would refuse", () => {
    for (const role of ["preparer", "reviewer", "partner"] as const) {
      for (const preparer of [null, pat, rae]) {
        for (const openPoints of [0, 2]) {
          for (const sole of [false, true]) {
            const c = cell("reviewer", { role, preparer, openPoints, sole });
            const refused = signOffBlocker("reviewer", { id: "u1", role }, { preparerId: preparer?.userId ?? null, reviewerId: null, openPoints, solePractitioner: sole }) !== null;
            if (refused) expect(c.kind).not.toBe("sign");
            else expect(c.kind).toBe("sign");
          }
        }
      }
    }
  });
  it("shows nothing to sign on a locked engagement", () => {
    expect(cell("preparer", { open: false })).toEqual({ kind: "none", label: "Not signed" });
    expect(cell("reviewer", { open: false, role: "partner", preparer: pat })).toEqual({ kind: "none", label: "Not signed" });
  });
});

describe("progress and points", () => {
  it("counts prepared and reviewed lead sheets", () => {
    expect(signOffProgress([{ preparer: 1, reviewer: 1 }, { preparer: 1, reviewer: null }, { preparer: null, reviewer: null }])).toEqual({ total: 3, prepared: 2, reviewed: 1, text: "2 of 3 prepared, 1 of 3 reviewed." });
    expect(signOffProgress([])).toMatchObject({ total: 0, prepared: 0, reviewed: 0 });
  });
  it("shows open points as a pill, never a bare number, and nothing when there are none", () => {
    expect(openPointsPill(2)).toEqual({ tone: "warning", label: "2 open" });
    expect(openPointsPill(0)).toBeNull();
  });
  it("lets anyone reply to a point, and only a reviewer or partner raise or clear one", () => {
    expect(pointControls({ open: true, role: "preparer" })).toEqual({ respond: true, clear: false, raise: false });
    expect(pointControls({ open: true, role: "reviewer" })).toEqual({ respond: true, clear: true, raise: true });
    expect(pointControls({ open: false, role: "partner" })).toEqual({ respond: false, clear: false, raise: false });
  });
});
