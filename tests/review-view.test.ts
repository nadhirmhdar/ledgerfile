import { describe, expect, it } from "vitest";
import { openPointsPill, pointControls, readinessView, signCell, signOffProgress } from "../src/ui/review-view";

const who = { userId: "u1", name: "Rae Reviewer", at: "2026-02-01" };

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
  const cell = (level: "preparer" | "reviewer", o: { signed?: typeof who | null; open?: boolean; role?: "preparer" | "reviewer" | "partner"; userId?: string } = {}) =>
    signCell({ level, signed: o.signed ?? null, open: o.open ?? true, role: o.role ?? "preparer", userId: o.userId ?? "u1" });

  it("shows who signed, and a withdraw button only for the signer on an open engagement", () => {
    expect(cell("preparer", { signed: who })).toEqual({ kind: "signed", name: "Rae Reviewer", at: "2026-02-01", canWithdraw: true });
    expect(cell("preparer", { signed: who, userId: "u2" })).toMatchObject({ kind: "signed", canWithdraw: false });
    expect(cell("reviewer", { signed: who, open: false })).toMatchObject({ kind: "signed", canWithdraw: false });
  });
  it("offers a preparer, or anyone, a button to sign as prepared", () => {
    expect(cell("preparer", { role: "preparer" })).toEqual({ kind: "sign", label: "Sign as prepared" });
    expect(cell("preparer", { role: "partner" })).toEqual({ kind: "sign", label: "Sign as prepared" });
  });
  it("offers only a reviewer or partner the button to sign as reviewed, and tells a preparer to wait", () => {
    expect(cell("reviewer", { role: "reviewer" })).toEqual({ kind: "sign", label: "Sign as reviewed" });
    expect(cell("reviewer", { role: "partner" })).toEqual({ kind: "sign", label: "Sign as reviewed" });
    expect(cell("reviewer", { role: "preparer" })).toEqual({ kind: "waiting", label: "Waiting for a reviewer" });
  });
  it("shows nothing to sign on a locked engagement", () => {
    expect(cell("preparer", { open: false })).toEqual({ kind: "none", label: "Not signed" });
    expect(cell("reviewer", { open: false, role: "partner" })).toEqual({ kind: "none", label: "Not signed" });
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
