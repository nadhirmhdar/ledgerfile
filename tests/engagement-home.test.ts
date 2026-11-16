import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { confirmationBlockers } from "../src/domain/confirmations";
import { lockReadiness, type Role } from "../src/domain/signoff";
import { scheduleBlockers } from "../src/domain/test-schedule";
import { buildHomeModel, explainBlocker, MAX_TODO, nextStepFor, seeAllLabel, stagesFor, type HomeInput } from "../src/ui/engagement-home";

const ID = "11111111-1111-4111-8111-111111111111";
const BASE = `/engagements/${ID}`;

const area = (o: Partial<HomeInput["audit"]["areas"][number]> = {}) => ({ assessed: true, procedures: 0, completed: 0, unreviewed: 0, schedules: 0, schedulesToFinish: 0, ...o });

/** An engagement with a trial balance, audit off, nothing signed. Each test changes only what it is about. */
function input(role: Role, o: Partial<HomeInput> = {}): HomeInput {
  return {
    engagementId: ID,
    role,
    status: "open",
    lockedByName: null,
    lockedAt: null,
    accounts: { total: 40, unmapped: 0, toAccept: 0 },
    audit: { enabled: false, materialitySet: false, materialityStale: false, areas: [], approval: "none", approvalNotReady: "Set materiality first." },
    review: { leadSheets: [{ prepared: false, reviewed: false }, { prepared: false, reviewed: false }], openPoints: 0, ready: false, blockers: ["2 lead sheet(s) are not signed as prepared.", "2 lead sheet(s) are not signed as reviewed."] },
    papers: { total: 6, reviewed: 0 },
    requests: { total: 0, open: 0, overdue: 0, received: 0, notApplicable: 0 },
    confirmations: { total: 0, notSent: 0, awaitingReply: 0, agreed: 0, differs: 0, noReply: 0, prepared: 0, reviewed: 0 },
    ...o,
  };
}
const audited = (o: Partial<HomeInput["audit"]> = {}): HomeInput["audit"] => ({
  enabled: true,
  materialitySet: true,
  materialityStale: false,
  areas: [area({ procedures: 10, completed: 10 })],
  approval: "current",
  approvalNotReady: null,
  ...o,
});
const stage = (i: HomeInput, key: string) => stagesFor(i).find((s) => s.key === key)!;

describe("an empty engagement", () => {
  const i = input("preparer", {
    accounts: { total: 0, unmapped: 0, toAccept: 0 },
    review: { leadSheets: [], openPoints: 0, ready: false, blockers: ["No trial balance has been imported."] },
    papers: { total: 0, reviewed: 0 },
  });
  const m = buildHomeModel(i);
  it("offers one action, to import the trial balance, to anyone", () => {
    expect(m.empty).toBe(true);
    expect(m.summary).toBe("Start by importing the trial balance.");
    for (const role of ["preparer", "reviewer", "partner", "admin"] as const) {
      expect(nextStepFor({ ...i, role })).toMatchObject({ kind: "action", href: `${BASE}/trial-balance`, label: "Import the trial balance", waitingOn: null });
    }
  });
  it("shows set up as not started and the rest as nothing yet", () => {
    expect(m.stages.map((s) => [s.key, s.status])).toEqual([
      ["setup", "not_started"],
      ["plan", "not_applicable"],
      ["fieldwork", "not_applicable"],
      ["review", "not_started"],
      ["finish", "not_started"],
    ]);
    expect(m.toDo).toEqual([{ text: "Import the trial balance", href: `${BASE}/trial-balance`, owner: null }]);
  });
});

describe("stages", () => {
  it("set up counts imported, mapped and checked", () => {
    expect(stage(input("preparer", { accounts: { total: 40, unmapped: 5, toAccept: 0 } }), "setup")).toMatchObject({ status: "in_progress", done: 1, total: 3, summary: "5 not mapped." });
    expect(stage(input("preparer", { accounts: { total: 40, unmapped: 0, toAccept: 1 } }), "setup")).toMatchObject({ status: "in_progress", done: 2, summary: "1 suggested mapping to check." });
    expect(stage(input("preparer"), "setup")).toMatchObject({ status: "done", done: 3, total: 3 });
  });
  it("plan is muted with no blocker when the audit is off", () => {
    const s = stage(input("preparer"), "plan");
    expect(s).toMatchObject({ status: "not_applicable", statusLabel: "Not being audited", done: 0, total: 0 });
    expect(buildHomeModel(input("preparer")).toDo.map((t) => t.text).join(" ")).not.toMatch(/materiality|risk/i);
  });
  it("plan counts audit on, materiality, risk assessed in every area, and approval", () => {
    expect(stage(input("partner", { audit: audited({ materialitySet: false, areas: [area({ assessed: false }), area()], approval: "none", approvalNotReady: "x" }) }), "plan")).toMatchObject({
      status: "in_progress",
      done: 1,
      total: 4,
      summary: "Materiality not set, risk assessed in 1 of 2 areas, not approved by a partner.",
    });
    expect(stage(input("partner", { audit: audited({ materialityStale: true }) }), "plan").summary).toBe("Materiality needs revising.");
    expect(stage(input("partner", { audit: audited() }), "plan")).toMatchObject({ status: "done", done: 4, total: 4 });
    expect(stage(input("partner", { audit: audited({ approval: "lapsed" }) }), "plan").summary).toBe("Approval needs renewing.");
  });
  it("fieldwork adds procedures, schedules, confirmations and client requests", () => {
    const i = input("preparer", {
      audit: audited({ areas: [area({ procedures: 10, completed: 4, schedules: 2, schedulesToFinish: 1 }), area({ procedures: 6, completed: 6 })] }),
      confirmations: { total: 4, notSent: 1, awaitingReply: 1, agreed: 1, differs: 1, noReply: 0, prepared: 0, reviewed: 0 },
      requests: { total: 10, open: 7, overdue: 2, received: 2, notApplicable: 1 },
    });
    expect(stage(i, "fieldwork")).toMatchObject({ status: "in_progress", done: 10 + 1 + 2 + 3, total: 16 + 2 + 4 + 10 });
    expect(stage(i, "fieldwork").summary).toBe("10 of 16 procedures done, 2 of 4 confirmations answered, 3 of 10 client requests received.");
  });
  it("fieldwork is done when everything is, and not started when nothing is recorded", () => {
    expect(stage(input("preparer", { audit: audited(), requests: { total: 2, open: 0, overdue: 0, received: 1, notApplicable: 1 } }), "fieldwork")).toMatchObject({ status: "done" });
    expect(stage(input("preparer", { audit: audited({ areas: [] }) }), "fieldwork")).toMatchObject({ status: "not_started", total: 0 });
  });
  it("fieldwork with the audit off is only the client requests", () => {
    expect(stage(input("preparer"), "fieldwork")).toMatchObject({ status: "not_applicable", total: 0 });
    expect(stage(input("preparer", { requests: { total: 4, open: 4, overdue: 0, received: 0, notApplicable: 0 } }), "fieldwork")).toMatchObject({ status: "not_started", done: 0, total: 4, summary: "0 of 4 client requests received." });
  });
  it("review moves from not started, to in progress, to needs review, to done", () => {
    const sheets = (p: number, r: number, n = 4) => Array.from({ length: n }, (_, k) => ({ prepared: k < p, reviewed: k < r }));
    const r = (leadSheets: { prepared: boolean; reviewed: boolean }[], openPoints = 0) => stage(input("reviewer", { review: { leadSheets, openPoints, ready: false, blockers: [] } }), "review");
    expect(r(sheets(0, 0)).status).toBe("not_started");
    expect(r(sheets(2, 0)).status).toBe("in_progress");
    expect(r(sheets(4, 1))).toMatchObject({ status: "needs_review", done: 5, total: 8 });
    expect(r(sheets(4, 4))).toMatchObject({ status: "done", done: 8, total: 8 });
    expect(r(sheets(4, 4), 2)).toMatchObject({ status: "needs_review" });
    expect(r(sheets(4, 4), 2).summary).toBe("4 of 4 lead sheets prepared, 4 reviewed, 2 review points open.");
    expect(r([]).summary).toBe("Lead sheets appear here once the trial balance is mapped.");
  });
  it("review includes completed procedures that still need a reviewer", () => {
    const i = input("reviewer", { audit: audited({ areas: [area({ procedures: 10, completed: 10, unreviewed: 4 })] }), review: { leadSheets: [{ prepared: true, reviewed: true }], openPoints: 0, ready: false, blockers: [] } });
    expect(stage(i, "review")).toMatchObject({ done: 2 + 6, total: 2 + 10, status: "needs_review" });
  });
  it("finish is not started, ready to lock, or locked", () => {
    expect(stage(input("partner"), "finish")).toMatchObject({ status: "not_started", summary: "2 things to do before this file can be locked." });
    expect(stage(input("partner", { review: { leadSheets: [], openPoints: 0, ready: true, blockers: [] } }), "finish")).toMatchObject({ status: "done", statusLabel: "Ready to lock" });
    expect(stage(input("partner", { status: "locked", lockedAt: "2026-11-02 09:15 UTC", lockedByName: "Dana Partner" }), "finish")).toMatchObject({
      status: "locked",
      summary: "Locked on 2026-11-02 09:15 UTC by Dana Partner.",
    });
    expect(stage(input("partner", { review: { leadSheets: [], openPoints: 0, ready: false, blockers: ["1 review point(s) are still open."] } }), "finish").summary).toBe("1 thing to do before this file can be locked.");
  });
  it("links each stage to where its work is done", () => {
    const hrefs = stagesFor(input("preparer", { audit: audited() })).map((s) => s.href);
    expect(hrefs).toEqual([`${BASE}/trial-balance`, `${BASE}/audit`, `${BASE}/audit`, `${BASE}/review`, `${BASE}/review`]);
  });
});

describe("the next step respects the role", () => {
  const planning = (role: Role, o: Partial<HomeInput> = {}) =>
    input(role, {
      audit: audited({ materialitySet: false, areas: [area({ assessed: false, procedures: 5 })], approval: "none", approvalNotReady: "Set materiality first." }),
      ...o,
    });

  it("tells a preparer who the planning is waiting on, and gives them their own next step", () => {
    const step = nextStepFor(planning("preparer"))!;
    expect(step.waitingOn).toBe("Waiting for a reviewer to set materiality.");
    expect(step).toMatchObject({ kind: "action", title: "Complete 5 audit procedures", href: `${BASE}/audit` });
  });
  it("sends a reviewer to set materiality", () => {
    expect(nextStepFor(planning("reviewer"))).toMatchObject({ kind: "action", title: "Set materiality", waitingOn: null });
  });
  it("never offers a preparer anything reviewer-only or partner-only", () => {
    const reviewerOnly = [/materiality/i, /assess risk/i, /^review /i, /^clear /i, /approve/i, /lock the engagement/i];
    const cases: HomeInput[] = [
      planning("preparer"),
      planning("preparer", { audit: audited({ approval: "none", areas: [area({ procedures: 3, completed: 3, unreviewed: 3 })] }) }),
      input("preparer", { review: { leadSheets: [{ prepared: true, reviewed: false }], openPoints: 2, ready: false, blockers: [] } }),
      input("preparer", { review: { leadSheets: [{ prepared: true, reviewed: true }], openPoints: 0, ready: true, blockers: [] } }),
      input("preparer", { audit: audited({ areas: [area({ procedures: 4, completed: 4, unreviewed: 2 })] }), confirmations: { total: 1, notSent: 0, awaitingReply: 0, agreed: 1, differs: 0, noReply: 0, prepared: 1, reviewed: 0 }, review: { leadSheets: [{ prepared: true, reviewed: true }], openPoints: 0, ready: false, blockers: [] } }),
    ];
    for (const c of cases) {
      const step = nextStepFor(c)!;
      for (const re of reviewerOnly) expect(step.kind === "action" ? step.title : "").not.toMatch(re);
    }
  });
  it("says nothing is waiting for a preparer when everything left is a reviewer's or a partner's", () => {
    const i = input("preparer", { review: { leadSheets: [{ prepared: true, reviewed: false }], openPoints: 0, ready: false, blockers: [] } });
    expect(nextStepFor(i)).toMatchObject({ kind: "waiting", title: "Nothing is waiting for you", description: "Waiting for a reviewer to review 1 lead sheet.", href: `${BASE}/review` });
    const ready = input("reviewer", { review: { leadSheets: [{ prepared: true, reviewed: true }], openPoints: 0, ready: true, blockers: [] } });
    expect(nextStepFor(ready)).toMatchObject({ kind: "waiting", description: "Waiting for a partner to lock the engagement." });
    expect(nextStepFor({ ...ready, role: "partner" })).toMatchObject({ kind: "action", title: "Lock the engagement" });
    expect(nextStepFor({ ...ready, role: "admin" })).toMatchObject({ kind: "action", title: "Lock the engagement" });
  });
  it("lets only a partner approve the risk assessment", () => {
    const i = input("reviewer", { audit: audited({ approval: "none" }), review: { leadSheets: [{ prepared: true, reviewed: true }], openPoints: 0, ready: false, blockers: [] } });
    expect(nextStepFor(i)).toMatchObject({ kind: "waiting", description: "Waiting for a partner to approve the risk assessment." });
    expect(nextStepFor({ ...i, role: "partner" })).toMatchObject({ kind: "action", title: "Approve the risk assessment" });
    expect(nextStepFor({ ...i, role: "partner", audit: audited({ approval: "lapsed" }) })).toMatchObject({ title: "Approve the risk assessment again" });
  });
  it("does not ask for an approval that is not ready to give", () => {
    const i = input("partner", { audit: audited({ approval: "none", approvalNotReady: "Assess risk in every area first." }) });
    expect(nextStepFor(i)?.title ?? "").not.toMatch(/approve/i);
  });
  it("follows the work order: trial balance, mapping, planning, fieldwork, review, lock", () => {
    const title = (o: Partial<HomeInput>, role: Role = "partner") => nextStepFor(input(role, o))?.title;
    expect(title({ accounts: { total: 9, unmapped: 3, toAccept: 2 } })).toBe("Map 3 accounts");
    expect(title({ accounts: { total: 9, unmapped: 0, toAccept: 1 } })).toBe("Check 1 suggested mapping");
    expect(title({ audit: audited({ materialitySet: false }) })).toBe("Set materiality");
    expect(title({ audit: audited({ areas: [area({ procedures: 3, completed: 1, schedules: 2, schedulesToFinish: 2 })] }) })).toBe("Complete 2 audit procedures");
    expect(title({ requests: { total: 3, open: 2, overdue: 1, received: 1, notApplicable: 0 } })).toBe("Follow up 2 open client requests");
    expect(title({})).toBe("Sign 2 lead sheets as prepared");
  });
  it("names confirmations to send and to prepare in the singular and plural", () => {
    const conf = (o: Partial<HomeInput["confirmations"]>) => ({ total: 3, notSent: 0, awaitingReply: 0, agreed: 0, differs: 0, noReply: 0, prepared: 0, reviewed: 0, ...o });
    expect(nextStepFor(input("preparer", { audit: audited(), confirmations: conf({ notSent: 1 }) }))?.title).toBe("Send 1 confirmation");
    expect(nextStepFor(input("preparer", { audit: audited(), confirmations: conf({ agreed: 3 }) }))?.title).toBe("Prepare 3 confirmations that have a reply");
    expect(nextStepFor(input("preparer", { audit: audited(), confirmations: conf({ agreed: 1 }) }))?.title).toBe("Prepare 1 confirmation that has a reply");
  });
});

describe("a locked engagement", () => {
  const m = buildHomeModel(input("partner", { status: "locked", lockedAt: "2026-11-02 09:15 UTC", lockedByName: "Dana Partner" }));
  it("shows who locked it and when, with no next step and nothing to do", () => {
    expect(m.locked).toBe(true);
    expect(m.nextStep).toBeNull();
    expect(m.toDo).toEqual([]);
    expect(m.toDoTotal).toBe(0);
    expect(m.summary).toBe("Locked on 2026-11-02 09:15 UTC by Dana Partner. Nothing can be changed until a partner unlocks it.");
  });
});

describe("to do", () => {
  it("shows at most five, in plain words with the right plurals, and the total", () => {
    const blockers = [
      "1 lead sheet(s) are not signed as prepared.",
      "3 lead sheet(s) are not signed as reviewed.",
      "1 review point(s) are still open.",
      "Audit: materiality has not been set.",
      "Audit: risk has not been assessed for 2 area(s).",
      "Audit: 147 procedure(s) and checklist step(s) are not yet completed.",
      "Audit: 1 journal entry(ies) selected for testing have no conclusion.",
    ];
    const m = buildHomeModel(input("preparer", { review: { leadSheets: [], openPoints: 1, ready: false, blockers } }));
    expect(m.toDo).toHaveLength(MAX_TODO);
    expect(m.toDoTotal).toBe(7);
    expect(m.toDo.map((t) => t.text)).toEqual([
      "1 lead sheet to sign as prepared",
      "3 lead sheets to review",
      "1 review point to clear",
      "Set materiality",
      "Assess risk in 2 areas",
    ]);
    expect(seeAllLabel(m.toDoTotal)).toBe("See all 7");
    expect(seeAllLabel(5)).toBeNull();
    expect(seeAllLabel(0)).toBeNull();
  });
  it("links each item to the page where it is dealt with, and marks who it is for", () => {
    const at = (b: string) => explainBlocker(b, ID);
    expect(at("2 lead sheet(s) are not signed as prepared.")).toEqual({ text: "2 lead sheets to sign as prepared", href: `${BASE}/review`, owner: null });
    expect(at("No trial balance has been imported.").href).toBe(`${BASE}/trial-balance`);
    expect(at("Statement check failed: Balance sheet balances.").href).toBe(`${BASE}/statements`);
    expect(at("Audit: materiality has not been set.")).toEqual({ text: "Set materiality", href: `${BASE}/audit`, owner: "reviewer" });
    expect(at("Audit: the partner has not approved the risk assessment.").owner).toBe("partner");
    expect(at("Audit: 2 journal entry(ies) selected for testing have no conclusion.")).toMatchObject({ text: "2 journal entries to conclude on", href: `${BASE}/audit/journals` });
    expect(at("Audit: 2 significant movement(s) in the analytical review have no explanation.").href).toBe(`${BASE}/audit/analytics`);
    expect(at("Audit: 3 confirmation(s) are awaiting a reply.")).toMatchObject({ text: "3 confirmations waiting for a reply", href: `${BASE}/audit/confirmations` });
  });
  it("uses the singular for one", () => {
    const at = (b: string) => explainBlocker(b, ID).text;
    expect(at("Audit: 1 procedure(s) and checklist step(s) are not yet completed.")).toBe("1 audit procedure or checklist step to complete");
    expect(at("Audit: 4 procedure(s) and checklist step(s) are not yet completed.")).toBe("4 audit procedures or checklist steps to complete");
    expect(at("Audit: 1 confirmation(s) have not been sent. Send them, or delete those that will not be sent.")).toBe("1 confirmation to send");
    expect(at("Audit: 1 significant movement(s) in the analytical review have no explanation.")).toBe("1 movement to explain in the analytical review");
    expect(at("Audit: risk has not been assessed for 1 area(s).")).toBe("Assess risk in 1 area");
  });
  it("tidies a blocker it does not know and sends it to Review and sign-off", () => {
    expect(explainBlocker("Audit: 3 thing(s) are odd.", ID)).toEqual({ text: "3 things are odd.", href: `${BASE}/review`, owner: null });
  });
  it("recognises every blocker the domain writes, so a reworded blocker cannot silently fall back", () => {
    const real = [
      ...confirmationBlockers(["not_sent", "awaiting_reply", "to_prepare", "prepared"]),
      ...scheduleBlockers([{ hasConclusion: false, reviewed: false, balanceMinor: 100, totalMinor: 90, explanation: null } as never]),
      ...lockReadiness({ statementsClean: false, failedChecks: ["Totals agree"], leadSheets: [], openPoints: 2 }).blockers,
      ...lockReadiness({ statementsClean: true, failedChecks: [], leadSheets: [{ name: "A", prepared: false, reviewed: false }], openPoints: 1 }).blockers,
    ];
    expect(real.length).toBeGreaterThanOrEqual(10);
    for (const b of real) {
      const t = explainBlocker(b, ID);
      expect(t.text, b).not.toMatch(/\(s\)|\(ies\)|^Audit:/);
      expect(t.text, b).not.toBe(b);
    }
  });
  it("recognises every blocker the audit overview writes", () => {
    const src = readFileSync("src/server/audit.ts", "utf8");
    const pushed = [...src.matchAll(/blockers\.push\((["`])(Audit: [^"`]*)\1\)/g)].map((m) => m[2].replace(/\$\{[^}]*\}/g, "3"));
    expect(pushed.length).toBeGreaterThanOrEqual(8);
    for (const b of pushed) {
      const t = explainBlocker(b, ID);
      expect(t.text, b).not.toMatch(/\(s\)|\(ies\)|^Audit:/);
      expect(t.text, b).not.toBe(b);
    }
  });
});

describe("counts", () => {
  it("shows papers reviewed, open requests, confirmations awaiting a reply and open review points", () => {
    const m = buildHomeModel(
      input("reviewer", {
        audit: audited(),
        papers: { total: 40, reviewed: 12 },
        requests: { total: 9, open: 7, overdue: 2, received: 2, notApplicable: 0 },
        confirmations: { total: 5, notSent: 1, awaitingReply: 3, agreed: 1, differs: 0, noReply: 0, prepared: 0, reviewed: 0 },
        review: { leadSheets: [], openPoints: 4, ready: false, blockers: [] },
      }),
    );
    expect(m.tiles.map((t) => [t.key, t.value, t.hint])).toEqual([
      ["papers", "12 of 40", null],
      ["requests", "7", "2 overdue"],
      ["confirmations", "3", "1 not sent yet"],
      ["points", "4", null],
    ]);
    expect(m.tiles.every((t) => t.href.startsWith(BASE))).toBe(true);
  });
  it("leaves the confirmations tile out when the audit is off and there are none", () => {
    expect(buildHomeModel(input("reviewer")).tiles.map((t) => t.key)).toEqual(["papers", "requests", "points"]);
    expect(buildHomeModel(input("reviewer", { confirmations: { total: 1, notSent: 0, awaitingReply: 1, agreed: 0, differs: 0, noReply: 0, prepared: 0, reviewed: 0 } })).tiles.map((t) => t.key)).toContain("confirmations");
  });
});

describe("summary sentence", () => {
  it("counts the things to do, ready, or empty", () => {
    expect(buildHomeModel(input("partner")).summary).toBe("2 things to do before this file can be locked.");
    expect(buildHomeModel(input("partner", { review: { leadSheets: [], openPoints: 0, ready: false, blockers: ["1 review point(s) are still open."] } })).summary).toBe("1 thing to do before this file can be locked.");
    expect(buildHomeModel(input("partner", { review: { leadSheets: [], openPoints: 0, ready: true, blockers: [] } })).summary).toBe("Ready to lock.");
  });
});
