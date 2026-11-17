import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import * as papers from "../src/server/working-papers";
import { localFileStore } from "../src/server/file-store";
import { AREA_BY_CODE, assertionsOf } from "../src/domain/audit";

const TB = [
  { code: "1000", name: "Bank - current account", closingMinor: 50000000, priorMinor: null },
  { code: "1100", name: "Trade receivables", closingMinor: 20000000, priorMinor: null },
  { code: "1300", name: "Inventories", closingMinor: 0, priorMinor: null },
  { code: "3000", name: "Share capital", closingMinor: -10000000, priorMinor: null },
  { code: "4000", name: "Sales", closingMinor: -100000000, priorMinor: null },
  { code: "6100", name: "Office rent", closingMinor: 40000000, priorMinor: null },
];
const materiality = { benchmark: "revenue", percentageBp: 100, performancePct: 75, trivialPct: 5, rationale: "Revenue is the measure the owners watch." };
const rate = (code: string, level: string) => Object.fromEntries(assertionsOf(AREA_BY_CODE.get(code)!).map((a) => [a, level]));
const work = (text: string) => ({ status: "done", workDone: `${text} done.`, conclusion: "No exceptions." });

type T = Parameters<Parameters<typeof withFirm>[2]>[0];

async function setup(db: Db, firmId: string, setupUser: repo.Session) {
  return withFirm(db, firmId, async (tx: T) => {
    const client = await repo.createClient(tx, setupUser, "Review Co");
    const id = await repo.createEngagement(tx, setupUser, client, "2025-01-01", "2025-12-31");
    await repo.importTrialBalance(tx, setupUser, id, "tb.xlsx", TB);
    await repo.approveAllMappings(tx, setupUser, id);
    await audit.setAuditEnabled(tx, setupUser, id, true);
    await audit.setMateriality(tx, setupUser, id, materiality);
    return id;
  });
}

describe("reviewing audit procedures", () => {
  const FIRM = "aaaaaaaa-8888-4000-8000-000000000001";
  const OTHER = "bbbbbbbb-8888-4000-8000-000000000001";
  const user = (n: number, role: repo.Session["role"], firmId = FIRM): repo.Session => ({ firmId, userId: `${firmId.slice(0, 8)}-8888-4000-8000-00000000001${n}`, role });
  const prep = user(1, "preparer");
  const rev = user(2, "reviewer");
  const rev2 = user(3, "reviewer");
  const partner = user(4, "partner");
  const outsider = user(5, "partner", OTHER);
  let db: Db;
  let engagement: string;
  let area: string;
  const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
  const overview = async () => (await as(prep, (tx) => audit.getAuditOverview(tx, engagement)))!;
  const procs = () => as(prep, (tx) => audit.listProcedures(tx, engagement, area));
  const blocker = async () => (await overview()).blockers.find((b) => b.includes("have not been reviewed"));
  const complete = (s: repo.Session, id: string, text = "Tested") => as(s, (tx) => audit.updateProcedure(tx, s, id, work(text)));
  const review = (s: repo.Session, id: string) => as(s, (tx) => audit.reviewProcedure(tx, s, id));
  const withdraw = (s: repo.Session, id: string) => as(s, (tx) => audit.unreviewProcedure(tx, s, id));

  beforeAll(async () => {
    db = await openDatabase();
    for (const firm of [FIRM, OTHER]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [firm]);
    for (const u of [prep, rev, rev2, partner, outsider]) {
      await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-1)}`, u.role]);
    }
    engagement = await setup(db, FIRM, partner);
    // Rate every area low so each loads its core procedures only.
    for (const a of (await overview()).areas.filter((x) => !x.assessed)) await as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, a.code, rate(a.code, "low")));
    area = (await overview()).areas.find((a) => a.procedures >= 4)!.code;
  });

  it("holds up the lock for finished work nobody has reviewed", async () => {
    expect(await blocker()).toBeUndefined();
    const [a, b] = await procs();
    await complete(prep, a.id, "First");
    await as(prep, (tx) => audit.updateProcedure(tx, prep, b.id, { status: "na", workDone: "Not relevant to this client at all.", conclusion: "" }));
    const o = await overview();
    expect(o.areas.find((x) => x.code === area)!.unreviewed).toBeGreaterThanOrEqual(1);
    expect(await blocker()).toMatch(/Audit: \d+ completed procedure\(s\) and checklist step\(s\) have not been reviewed\./);
  });

  it("is for reviewers and partners, on their own firm's finished work", async () => {
    const procedures = await procs();
    const finished = procedures.find((p) => p.status === "done")!;
    const open = procedures.find((p) => p.status === "open")!;
    await expect(review(prep, finished.id)).rejects.toThrow(/Only a reviewer or partner/);
    await expect(review(outsider, finished.id)).rejects.toThrow(/not found/);
    await expect(withdraw(outsider, finished.id)).rejects.toThrow(/not found/);
    await expect(review(rev, open.id)).rejects.toThrow(/Only completed work/);
    await expect(withdraw(rev, finished.id)).rejects.toThrow(/has not been reviewed/);
    expect((await as(outsider, (tx) => audit.listProcedures(tx, engagement, area))).length).toBe(0);
  });

  it("must be by a different person from the one who did the work", async () => {
    const open = (await procs()).find((p) => p.status === "open")!;
    await complete(rev, open.id, "Reviewer's own");
    await expect(review(rev, open.id)).rejects.toThrow(/different person/);
    await review(rev2, open.id);
    const p = (await procs()).find((x) => x.id === open.id)!;
    expect(p).toMatchObject({ reviewedByName: "reviewer 3" });
    expect(p.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await expect(review(partner, open.id)).rejects.toThrow(/already been reviewed/);
  });

  it("can be given to finished work of any kind, including not applicable, and is logged", async () => {
    const [target] = (await procs()).filter((p) => p.status === "done" && !p.reviewedAt);
    await review(rev, target.id);
    const logged = await db.query("select action from audit_log where entity_id = $1 order by id", [target.id]);
    expect(logged.rows.map((r) => (r as { action: string }).action)).toContain("procedure_review");
  });

  it("freezes reviewed work until the review is withdrawn", async () => {
    const p = (await procs()).find((x) => x.reviewedAt)!;
    await expect(complete(prep, p.id, "Changed")).rejects.toThrow(/has been reviewed/);
    await expect(as(prep, (tx) => audit.updateProcedure(tx, prep, p.id, { status: "open", workDone: "", conclusion: "" }))).rejects.toThrow(/has been reviewed/);
    await expect(withdraw(prep, p.id)).rejects.toThrow(/Only a reviewer or partner/);
    // Any reviewer may withdraw, not only the one who gave the review.
    await withdraw(rev2, p.id);
    expect((await procs()).find((x) => x.id === p.id)!.reviewedAt).toBeNull();
    await complete(prep, p.id, "Changed after withdrawal");
    const logged = await db.query("select action from audit_log where entity_id = $1", [p.id]);
    expect(logged.rows.map((r) => (r as { action: string }).action)).toContain("procedure_unreview");
  });

  it("reviews a whole area at once and skips the reviewer's own work", async () => {
    const open = (await procs()).filter((p) => p.status === "open");
    await complete(prep, open[0].id, "Bulk one");
    await complete(rev, open[1].id, "Bulk two, by the reviewer");
    const result = await as(rev, (tx) => audit.reviewArea(tx, rev, engagement, area));
    expect(result.reviewed).toBeGreaterThanOrEqual(1);
    expect(result.skipped).toBe(1);
    const after = await procs();
    expect(after.find((p) => p.id === open[1].id)!.reviewedAt).toBeNull();
    expect(after.filter((p) => p.status !== "open").every((p) => p.reviewedAt || p.id === open[1].id)).toBe(true);
    // Open procedures are never reviewed by the bulk action.
    expect(after.filter((p) => p.status === "open").every((p) => !p.reviewedAt)).toBe(true);
    await expect(as(prep, (tx) => audit.reviewArea(tx, prep, engagement, area))).rejects.toThrow(/Only a reviewer or partner/);
    await expect(as(outsider, (tx) => audit.reviewArea(tx, outsider, engagement, area))).rejects.toThrow(/not found/);
    // A second reviewer clears what was skipped, and the blocker goes.
    const rest = await as(rev2, (tx) => audit.reviewArea(tx, rev2, engagement, area));
    expect(rest).toEqual({ reviewed: 1, skipped: 0, selfReviewed: 0 });
    expect((await overview()).areas.find((a) => a.code === area)!.unreviewed).toBe(0);
    expect(await blocker()).toBeUndefined();
    await expect(as(rev2, (tx) => audit.reviewArea(tx, rev2, engagement, area))).rejects.toThrow(/no completed work waiting/);
  });

  it("counts unreviewed checklist steps separately and clears the blocker when they are reviewed", async () => {
    const step = (await as(prep, (tx) => audit.listProcedures(tx, engagement, "A1")))[0];
    await complete(prep, step.id, "Acceptance step");
    const o = await overview();
    expect(o.checklists.find((c) => c.code === "A1")!.unreviewed).toBe(1);
    expect(await blocker()).toContain("1 completed procedure(s)");
    await review(rev, step.id);
    expect((await overview()).checklists.find((c) => c.code === "A1")!.unreviewed).toBe(0);
    expect(await blocker()).toBeUndefined();
  });

  it("keeps a review when risks are re-rated or the audit is turned off", async () => {
    const reviewed = (await procs()).find((p) => p.reviewedAt)!;
    await as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, area, rate(area, "high")));
    await as(rev, (tx) => audit.setAreaRisks(tx, rev, engagement, area, rate(area, "low")));
    const kept = (await procs()).find((p) => p.id === reviewed.id);
    expect(kept?.reviewedAt).toBeTruthy();
    await expect(as(partner, (tx) => audit.setAuditEnabled(tx, partner, engagement, false))).rejects.toThrow(/cannot be turned off/);
  });

  it("stops evidence being attached to reviewed work until the review is withdrawn", async () => {
    const store = localFileStore(mkdtempSync(join(tmpdir(), "procedure-review-")));
    const attach = (id: string) =>
      as(rev, (tx) => papers.addWorkingPaper(tx, rev, store, engagement, { targetKind: "procedure", target: id, fileName: "support.pdf", data: new TextEncoder().encode("%PDF sample"), description: "" }));
    const p = (await procs()).find((x) => x.reviewedAt)!;
    await expect(attach(p.id)).rejects.toThrow(/has been reviewed.*withdraw the review/);
    await withdraw(rev2, p.id);
    await attach(p.id);
    await review(rev2, p.id);
  });

  it("cannot be done once the audit is off for the engagement or the engagement is locked", async () => {
    const other = await as(partner, async (tx) => {
      const client = await repo.createClient(tx, partner, "No Audit Co");
      return repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
    });
    await expect(as(rev, (tx) => audit.reviewArea(tx, rev, other, area))).rejects.toThrow(/Turn the audit on/);

    const p = (await procs()).find((x) => x.reviewedAt)!;
    const fresh = (await procs()).find((x) => x.status === "open")!;
    await complete(prep, fresh.id, "Before lock");
    await db.query("update engagements set status = 'locked' where id = $1", [engagement]);
    await expect(review(rev2, fresh.id)).rejects.toThrow(/locked/);
    await expect(withdraw(rev2, p.id)).rejects.toThrow(/locked/);
    await expect(as(rev2, (tx) => audit.reviewArea(tx, rev2, engagement, area))).rejects.toThrow(/locked/);
    await db.query("update engagements set status = 'open' where id = $1", [engagement]);
  });
});

describe("reviewing audit procedures in a one-person firm", () => {
  const SOLO = "cccccccc-8888-4000-8000-000000000001";
  const me: repo.Session = { firmId: SOLO, userId: "cccccccc-8888-4000-8000-000000000011", role: "partner" };
  const you: repo.Session = { firmId: SOLO, userId: "cccccccc-8888-4000-8000-000000000012", role: "reviewer" };
  let db: Db;
  let engagement: string;
  let area: string;
  const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);

  beforeAll(async () => {
    db = await openDatabase();
    await db.query("insert into firms (id, name) values ($1, 'Solo')", [SOLO]);
    await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, 'me@x.test', 'Me', 'partner')", [me.userId, SOLO]);
    engagement = await setup(db, SOLO, me);
    const first = (await as(me, (tx) => audit.getAuditOverview(tx, engagement)))!.areas.find((a) => !a.assessed)!;
    await as(me, (tx) => audit.setAreaRisks(tx, me, engagement, first.code, rate(first.code, "low")));
    area = first.code;
  });

  it("lets a sole practitioner review their own work, and stops once the firm has a second user", async () => {
    const [a, b] = await as(me, (tx) => audit.listProcedures(tx, engagement, area));
    await as(me, (tx) => audit.updateProcedure(tx, me, a.id, work("Own work")));
    await as(me, (tx) => audit.updateProcedure(tx, me, b.id, work("More own work")));
    await as(me, (tx) => audit.reviewProcedure(tx, me, a.id));
    const bulk = await as(me, (tx) => audit.reviewArea(tx, me, engagement, area));
    expect(bulk).toEqual({ reviewed: 1, skipped: 0, selfReviewed: 1 });

    // A colleague joins: the sole-practitioner exception no longer applies to new work.
    await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, 'you@x.test', 'You', 'reviewer')", [you.userId, SOLO]);
    await as(me, (tx) => audit.unreviewProcedure(tx, me, a.id));
    await expect(as(me, (tx) => audit.reviewProcedure(tx, me, a.id))).rejects.toThrow(/different person/);
    await as(you, (tx) => audit.reviewProcedure(tx, you, a.id));
  });
});

describe("the partner's own sign-off", () => {
  const FIRM = "dddddddd-8888-4000-8000-000000000001";
  const partner: repo.Session = { firmId: FIRM, userId: "dddddddd-8888-4000-8000-000000000011", role: "partner" };
  const prep: repo.Session = { firmId: FIRM, userId: "dddddddd-8888-4000-8000-000000000012", role: "preparer" };
  let db: Db;
  let engagement: string;
  const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
  const overview = async () => (await as(prep, (tx) => audit.getAuditOverview(tx, engagement)))!;
  const steps = () => as(prep, (tx) => audit.listProcedures(tx, engagement, "B8"));

  beforeAll(async () => {
    db = await openDatabase();
    await db.query("insert into firms (id, name) values ($1, 'Partner and preparer')", [FIRM]);
    await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, 'p@x.test', 'Partner', 'partner'), ($3, $2, 'q@x.test', 'Preparer', 'preparer')", [partner.userId, FIRM, prep.userId]);
    engagement = await setup(db, FIRM, partner);
    for (const a of (await overview()).areas.filter((x) => !x.assessed)) await as(partner, (tx) => audit.setAreaRisks(tx, partner, engagement, a.code, rate(a.code, "low")));
    await as(partner, (tx) => audit.approveRiskAssessment(tx, partner, engagement));
  });

  it("needs no further review, so a partner and preparers alone can reach zero unreviewed", async () => {
    const b808 = (await steps()).find((p) => p.templateId === "B8.08")!;
    expect(b808.partnerStep).toBe(true);
    expect((await steps()).find((p) => p.templateId === "B8.01")!.partnerStep).toBe(false);
    await as(partner, (tx) => audit.updateProcedure(tx, partner, b808.id, work("Approved")));
    // Counted nowhere and not blocking.
    expect((await overview()).checklists.find((c) => c.code === "B8")!.unreviewed).toBe(0);
    expect((await overview()).blockers.some((b) => b.includes("have not been reviewed"))).toBe(false);
    await expect(as(partner, (tx) => audit.reviewProcedure(tx, partner, b808.id))).rejects.toThrow(/partner's own sign-off/);
    await expect(as(partner, (tx) => audit.reviewArea(tx, partner, engagement, "B8"))).rejects.toThrow(/no completed work waiting/);
    // It stays editable by a partner, as before.
    await as(partner, (tx) => audit.updateProcedure(tx, partner, b808.id, work("Approved again")));

    // The preparer's step is reviewed by the partner; the sign-off is neither reviewed nor reported as skipped.
    const b801 = (await steps()).find((p) => p.templateId === "B8.01")!;
    await as(prep, (tx) => audit.updateProcedure(tx, prep, b801.id, work("Overall risks")));
    expect((await overview()).checklists.find((c) => c.code === "B8")!.unreviewed).toBe(1);
    expect(await as(partner, (tx) => audit.reviewArea(tx, partner, engagement, "B8"))).toEqual({ reviewed: 1, skipped: 0, selfReviewed: 0 });
    expect((await overview()).checklists.find((c) => c.code === "B8")!.unreviewed).toBe(0);
    expect((await overview()).blockers.some((b) => b.includes("have not been reviewed"))).toBe(false);
    expect((await steps()).find((p) => p.templateId === "B8.08")!.reviewedAt).toBeNull();
  });
});
