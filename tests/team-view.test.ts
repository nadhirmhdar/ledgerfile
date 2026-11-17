import { describe, expect, it } from "vitest";
import { ROLE_ORDER, roleLabel, roleSummary, teamControls, teamSentence } from "../src/ui/team-view";

const m = (active: boolean) => ({ active });

describe("teamSentence", () => {
  it("says just you for one person", () => {
    expect(teamSentence([m(true)])).toBe("Just you so far.");
  });
  it("says all active when nobody is deactivated", () => {
    expect(teamSentence([m(true), m(true)])).toBe("2 people, all active.");
    expect(teamSentence([m(true), m(true), m(true)])).toBe("3 people, all active.");
  });
  it("counts active and deactivated", () => {
    expect(teamSentence([m(true), m(true), m(true), m(true), m(false)])).toBe("5 people: 4 active, 1 deactivated.");
    expect(teamSentence([m(true), m(false), m(false)])).toBe("3 people: 1 active, 2 deactivated.");
  });
});

describe("roles in plain words", () => {
  it("labels all four", () => {
    expect(roleLabel("admin")).toBe("Admin");
    expect(roleLabel("partner")).toBe("Partner");
    expect(roleLabel("reviewer")).toBe("Reviewer");
    expect(roleLabel("preparer")).toBe("Preparer");
  });
  it("summarises all four, one sentence each", () => {
    expect(roleSummary("preparer")).toBe("Does the day-to-day work and signs as preparer.");
    expect(roleSummary("reviewer")).toBe("Reviews work and can open engagements.");
    expect(roleSummary("partner")).toBe("Signs off, locks engagements and takes on clients.");
    expect(roleSummary("admin")).toBe("Partner level, and manages the team.");
    for (const r of ROLE_ORDER) expect(roleSummary(r).endsWith(".")).toBe(true);
  });
  it("lists every role once", () => {
    expect([...ROLE_ORDER].sort()).toEqual(["admin", "partner", "preparer", "reviewer"]);
  });
  it("leaves an unknown role as it is", () => {
    expect(roleLabel("owner")).toBe("owner");
    expect(roleSummary("owner")).toBe("");
  });
});

describe("teamControls", () => {
  it("gives an admin everything on another active person's row", () => {
    expect(teamControls("admin", false, true)).toEqual({ manage: true, roleForm: true, resetForm: true, useAccountPage: false, deactivate: true, reactivate: false });
  });
  it("gives an admin the role form and the Account page pointer on their own row, and no deactivate", () => {
    expect(teamControls("admin", true, true)).toEqual({ manage: true, roleForm: true, resetForm: false, useAccountPage: true, deactivate: false, reactivate: false });
  });
  it("offers reactivate, not deactivate, on a deactivated row", () => {
    const c = teamControls("admin", false, false);
    expect(c.deactivate).toBe(false);
    expect(c.reactivate).toBe(true);
    expect(c.resetForm).toBe(true);
  });
  it("gives no control to any role but admin", () => {
    for (const role of ["partner", "reviewer", "preparer"]) {
      for (const self of [true, false]) {
        for (const active of [true, false]) {
          expect(teamControls(role, self, active)).toEqual({ manage: false, roleForm: false, resetForm: false, useAccountPage: false, deactivate: false, reactivate: false });
        }
      }
    }
  });
});
