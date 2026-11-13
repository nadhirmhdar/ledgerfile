import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import * as papers from "../src/server/working-papers";
import * as schedules from "../src/server/test-schedules";
import { localFileStore } from "../src/server/file-store";
import { MAX_SCHEDULE_LINES } from "../src/domain/test-schedule";

// Invented figures, in fils.
const TB = [
  { code: "1000", name: "Bank - current account", closingMinor: 50_000_000, priorMinor: null },
  { code: "1100", name: "Trade receivables", closingMinor: 20_000_000, priorMinor: null },
  { code: "3000", name: "Share capital", closingMinor: -10_000_000, priorMinor: null },
  { code: "2000", name: "Trade payables", closingMinor: -8_000_000, priorMinor: null },
  { code: "4000", name: "Sales", closingMinor: -100_000_000, priorMinor: null },
  { code: "6100", name: "Office rent", closingMinor: 48_000_000, priorMinor: null },
];
const materiality = { benchmark: "revenue", percentageBp: 100, performancePct: 75, trivialPct: 5, rationale: "Revenue is the measure the owners watch." };
type T = Parameters<Parameters<typeof withFirm>[2]>[0];

describe("test schedules", () => {
  const FIRM = "aaaaaaaa-1414-4000-8000-000000000001";
  const OTHER = "bbbbbbbb-1414-4000-8000-000000000001";
  const user = (n: number, role: repo.Session["role"], firmId = FIRM): repo.Session => ({ firmId, userId: `${firmId.slice(0, 8)}-1414-4000-8000-00000000001${n}`, role });
  const prep = user(1, "preparer");
  const rev = user(2, "reviewer");
  const rev2 = user(3, "reviewer");
  const partner = user(4, "partner");
  const outsider = user(5, "partner", OTHER);
  let db: PGlite;
  let engagement: string;
  let other: string;
  let store: ReturnType<typeof localFileStore>;
  const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
  const make = (s: repo.Session, tb: boolean, auditOn: boolean) =>
    as(partner, async (tx) => {
      const client = await repo.createClient(tx, partner, `Schedules Co ${Math.random().toString(36).slice(2, 7)}`);
      const id = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
      if (tb) {
        await repo.importTrialBalance(tx, partner, id, "tb.xlsx", TB);
        await repo.approveAllMappings(tx, partner, id);
      }
      if (auditOn) {
        await audit.setAuditEnabled(tx, partner, id, true);
        await audit.setMateriality(tx, partner, id, materiality);
      }
      return id;
    });
  const create = (s: repo.Session, input: Partial<Parameters<typeof schedules.createSchedule>[3]> = {}, eng = engagement) =>
    as(s, (tx) => schedules.createSchedule(tx, s, eng, { areaCode: "C5", groupCode: "TRADEREC", title: "Receivables listing", fromTrialBalance: true, ...input }));
  const view = async (id: string, s: repo.Session = prep) => (await as(s, (tx) => schedules.getSchedule(tx, id)))!;
  const overview = async (eng = engagement) => (await as(prep, (tx) => audit.getAuditOverview(tx, eng)))!;
  const scheduleBlockers = async (eng = engagement) => (await overview(eng)).blockers.filter((b) => b.includes("test schedule"));
  const header = (s: repo.Session, id: string, patch: Partial<Record<"title" | "objective" | "workDone" | "conclusion" | "explanation" | "threshold", string>> = {}) =>
    as(s, (tx) => schedules.updateHeader(tx, s, id, { title: "Receivables listing", objective: "", workDone: "Agreed the listing to the ledger.", conclusion: "", explanation: "", threshold: "performance", ...patch }));
  const conclude = (s: repo.Session, id: string) => header(s, id, { conclusion: "Receivables are fairly stated." });
  const lineRow = (description: string, amountMinor: number, extra: object = {}) => ({ id: null, description, amountMinor, ...extra });

  let c5: string;

  beforeAll(async () => {
    db = await openDatabase();
    for (const firm of [FIRM, OTHER]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [firm]);
    for (const u of [prep, rev, rev2, partner, outsider]) {
      await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-1)}`, u.role]);
    }
    store = localFileStore(mkdtempSync(join(tmpdir(), "schedules-")));
    engagement = await make(partner, true, true);
    other = await make(partner, true, true);
  });

  it("starts from the trial balance accounts of a lead sheet, in the area's own sign, with a running reference", async () => {
    expect(await scheduleBlockers()).toEqual([]);
    expect((await overview()).areas.every((a) => a.schedules === 0 && a.schedulesToFinish === 0)).toBe(true);
    c5 = await create(prep);
    const v = await view(c5);
    expect(v).toMatchObject({ reference: "C5-1", groupCode: "TRADEREC", totalMinor: 20_000_000, balanceMinor: 20_000_000, differenceMinor: 0, editable: true, preparedByName: null });
    expect(v.lines).toHaveLength(1);
    expect(v.lines[0]).toMatchObject({ description: "Trade receivables", docRef: "1100", amountMinor: 20_000_000, tested: false });
    // Payables are a credit balance but are listed as a positive amount, and agree.
    const c8 = await create(rev, { areaCode: "C8", groupCode: "TRADEPAY", title: "Payables listing" });
    expect(await view(c8)).toMatchObject({ reference: "C8-1", totalMinor: 8_000_000, balanceMinor: 8_000_000, differenceMinor: 0 });
    expect((await create(prep, { fromTrialBalance: false, groupCode: null, title: "Second receivables test" }))).toBeTruthy();
    expect((await as(prep, (tx) => schedules.listSchedules(tx, engagement, "C5"))).map((s) => s.reference)).toEqual(["C5-1", "C5-2"]);
  });

  it("refuses a bad start, and numbers a new schedule after the highest that exists", async () => {
    await expect(create(prep, { groupCode: "TRADEPAY" })).rejects.toThrow(/not part of this area/);
    await expect(create(prep, { groupCode: null })).rejects.toThrow(/Choose the lead sheet/);
    await expect(create(prep, { areaCode: "Z9" })).rejects.toThrow(/Choose an audit area/);
    await expect(create(prep, { areaCode: "A1", groupCode: null, fromTrialBalance: false })).rejects.toThrow(/Choose an audit area/);
    await expect(create(prep, { title: "x" })).rejects.toThrow(/Give the schedule a title/);
    const off = await make(partner, true, false);
    await expect(create(prep, {}, off)).rejects.toThrow(/Turn the audit on/);
    const third = await create(prep, { fromTrialBalance: false, groupCode: null, title: "Third receivables test" });
    expect((await view(third)).reference).toBe("C5-3");
    await as(prep, (tx) => schedules.deleteSchedule(tx, prep, third));
    // The number follows the highest schedule still on the file, so a deleted last one is numbered again.
    expect((await view(await create(prep, { fromTrialBalance: false, groupCode: null, title: "Fourth receivables test" }))).reference).toBe("C5-3");
  });

  it("saves lines in a batch: new, edited, ticked and removed, with tickmarks kept to the standard set", async () => {
    const first = (await view(c5)).lines[0];
    const saved = await as(prep, (tx) =>
      schedules.saveLines(tx, prep, c5, {
        rows: [
          { id: first.id, description: "Trade receivables", docRef: "1100", amountMinor: 20_000_000, tested: true, tickmarks: ["gl", "bogus", "doc", "gl"] },
          lineRow("Customer A (invented)", 1_500_00, { docRef: "INV-1", remarks: "Subsequent receipt seen." }),
          lineRow("Customer B (invented)", 900_00),
        ],
      }),
    );
    expect(saved).toEqual({ saved: 3, removed: 0 });
    let v = await view(c5);
    expect(v.lines.map((l) => l.description)).toEqual(["Trade receivables", "Customer A (invented)", "Customer B (invented)"]);
    expect(v.lines[0]).toMatchObject({ tested: true, tickmarks: ["doc", "gl"] });
    expect(v.lines[1]).toMatchObject({ docRef: "INV-1", remarks: "Subsequent receipt seen.", tested: false, tickmarks: [] });
    expect(v.totalMinor).toBe(20_000_000 + 1_500_00 + 900_00);
    expect(v.coverage.pct).toBeCloseTo((20_000_000 / v.totalMinor) * 100, 6);

    await as(prep, (tx) => schedules.saveLines(tx, prep, c5, { rows: [], removeIds: [v.lines[1].id, v.lines[2].id] }));
    v = await view(c5);
    expect(v.lines).toHaveLength(1);
    expect(v.differenceMinor).toBe(0);
  });

  it("checks every row first, so one bad row saves nothing", async () => {
    const before = (await view(c5)).lines.length;
    await expect(as(prep, (tx) => schedules.saveLines(tx, prep, c5, { rows: [lineRow("Fine", 100), lineRow("  ", 100)] }))).rejects.toThrow(/Line 2: enter a description/);
    await expect(as(prep, (tx) => schedules.saveLines(tx, prep, c5, { rows: [lineRow("Fine", 100), lineRow("Bad amount", Number.NaN)] }))).rejects.toThrow(/Line 2: the amount is not valid/);
    await expect(as(prep, (tx) => schedules.saveLines(tx, prep, c5, { rows: [{ id: "00000000-0000-4000-8000-000000000000", description: "Gone", amountMinor: 1 }] }))).rejects.toThrow(/no longer on this schedule/);
    expect((await view(c5)).lines.length).toBe(before);
  });

  it("imports a listing after the lines already there, or in place of them, up to the cap", async () => {
    const id = await create(prep, { fromTrialBalance: false, groupCode: null, title: "Imported listing" });
    expect(await as(prep, (tx) => schedules.importLines(tx, prep, id, [{ description: "Supplier X", docRef: "S-1", amountMinor: 100_00 }, { description: "Supplier Y", docRef: null, amountMinor: 200_00 }], "append"))).toEqual({ imported: 2, replaced: 0 });
    await as(prep, (tx) => schedules.importLines(tx, prep, id, [{ description: "Supplier Z", docRef: null, amountMinor: 50_00 }], "append"));
    expect((await view(id)).lines.map((l) => l.position)).toEqual([1, 2, 3]);
    expect(await as(prep, (tx) => schedules.importLines(tx, prep, id, [{ description: "Only one", docRef: null, amountMinor: 1_00 }], "replace"))).toEqual({ imported: 1, replaced: 3 });
    expect((await view(id)).lines.map((l) => l.description)).toEqual(["Only one"]);
    await expect(as(prep, (tx) => schedules.importLines(tx, prep, id, [], "append"))).rejects.toThrow(/no lines to import/);
    await expect(as(prep, (tx) => schedules.importLines(tx, prep, id, [{ description: "", docRef: null, amountMinor: 1 }], "append"))).rejects.toThrow(/enter a description/);
    const big = Array.from({ length: MAX_SCHEDULE_LINES }, (_, i) => ({ description: `Item ${i}`, docRef: null, amountMinor: 1 }));
    await expect(as(prep, (tx) => schedules.importLines(tx, prep, id, big, "append"))).rejects.toThrow(/at most 2,000 lines/);
    await expect(as(prep, (tx) => schedules.importLines(tx, prep, id, [...big, big[0]], "replace"))).rejects.toThrow(/at most 2,000 lines/);
    await as(prep, (tx) => schedules.importLines(tx, prep, id, big, "replace"));
    expect((await view(id)).lines).toHaveLength(MAX_SCHEDULE_LINES);
    await expect(as(prep, (tx) => schedules.saveLines(tx, prep, id, { rows: [lineRow("One more", 1)] }))).rejects.toThrow(/at most 2,000 lines/);
  });

  it("links evidence only from this engagement, and keeps a linked file from being removed", async () => {
    const own = await as(prep, (tx) => papers.addWorkingPaper(tx, prep, store, engagement, { targetKind: "engagement", target: null, fileName: "statement.pdf", data: new TextEncoder().encode("%PDF a"), description: "" }));
    const elsewhere = await as(prep, (tx) => papers.addWorkingPaper(tx, prep, store, other, { targetKind: "engagement", target: null, fileName: "other.pdf", data: new TextEncoder().encode("%PDF b"), description: "" }));
    const first = (await view(c5)).lines[0];
    const link = (workingPaperId: string | null, s: repo.Session = prep) =>
      as(s, (tx) => schedules.saveLines(tx, s, c5, { rows: [{ id: first.id, description: first.description, amountMinor: first.amountMinor, workingPaperId }] }));
    // A file on another engagement of the same firm, and a file that does not exist, are both refused.
    await expect(link(elsewhere)).rejects.toThrow(/uploaded to this engagement/);
    await expect(link("00000000-0000-4000-8000-000000000000")).rejects.toThrow(/uploaded to this engagement/);
    await link(own);
    expect((await view(c5)).lines[0].workingPaperId).toBe(own);
    expect((await view(c5)).files.map((f) => f.fileName)).toEqual(["statement.pdf"]);
    await expect(as(prep, (tx) => papers.removeWorkingPaper(tx, prep, own))).rejects.toThrow(/linked as evidence on a test schedule/);
    // Another firm cannot cite it either.
    const theirs = await as(outsider, async (tx) => {
      const client = await repo.createClient(tx, outsider, "Theirs");
      return repo.createEngagement(tx, outsider, client, "2025-01-01", "2025-12-31");
    });
    expect(theirs).toBeTruthy();
    await link(null);
    const gone = await as(prep, (tx) => papers.removeWorkingPaper(tx, prep, own));
    await store.remove(gone.storageKey);
  });

  it("holds up the lock until each schedule has a conclusion, a review, and an explained difference", async () => {
    const all = await scheduleBlockers();
    const total = (await overview()).areas.reduce((n, a) => n + a.schedules, 0);
    expect(total).toBeGreaterThanOrEqual(4);
    expect(all).toContain(`Audit: ${total} test schedule(s) have no conclusion.`);
    expect(all.some((b) => b.includes("have not been reviewed"))).toBe(true);
    const area = (await overview()).areas.find((a) => a.code === "C5")!;
    expect(area.schedules).toBeGreaterThanOrEqual(2);
    expect(area.schedulesToFinish).toBe(area.schedules);

    await conclude(rev, c5);
    expect((await view(c5)).preparedByName).toBe("reviewer 2");
    expect((await scheduleBlockers()).find((b) => b.includes("no conclusion"))).toContain(`${total - 1} test schedule`);
    await as(rev2, (tx) => schedules.reviewSchedule(tx, rev2, c5));
    const afterReview = await overview();
    expect(afterReview.areas.find((a) => a.code === "C5")!.schedulesToFinish).toBe(area.schedules - 1);

    // A journal changes the balance after the review: the difference is raised again, live.
    await db.query("update accounts set closing_minor = 21_000_000 where engagement_id = $1 and code = '1100'".replace("21_000_000", "21000000"), [engagement]);
    expect(await scheduleBlockers()).toContain("Audit: 1 test schedule(s) do not agree to the balance, and the difference is not explained.");
    expect((await view(c5)).differenceMinor).toBe(-1_000_000);
    // Explaining it needs the review withdrawn first; once explained, the blocker clears.
    await expect(header(rev, c5, { conclusion: "Receivables are fairly stated.", explanation: "Late credit note." })).rejects.toThrow(/has been reviewed/);
    await as(rev2, (tx) => schedules.unreviewSchedule(tx, rev2, c5));
    await header(rev, c5, { conclusion: "Receivables are fairly stated.", explanation: "Invoice posted after the listing was run; agreed to the ledger." });
    expect((await scheduleBlockers()).some((b) => b.includes("do not agree"))).toBe(false);
    // Saving the same conclusion again keeps who recorded it.
    expect((await view(c5)).preparedByName).toBe("reviewer 2");
    await db.query("update accounts set closing_minor = 20000000 where engagement_id = $1 and code = '1100'", [engagement]);
  });

  it("applies the procedure review rules: reviewer-level, a different person, a conclusion first, and labels a self-review", async () => {
    const id = await create(prep, { areaCode: "C8", groupCode: "TRADEPAY", title: "More payables" });
    await expect(as(rev, (tx) => schedules.reviewSchedule(tx, rev, id))).rejects.toThrow(/Record the conclusion/);
    await conclude(rev, id);
    await expect(as(prep, (tx) => schedules.reviewSchedule(tx, prep, id))).rejects.toThrow(/Only a reviewer or partner/);
    await expect(as(rev, (tx) => schedules.reviewSchedule(tx, rev, id))).rejects.toThrow(/different person/);
    await expect(as(prep, (tx) => schedules.unreviewSchedule(tx, prep, id))).rejects.toThrow(/Only a reviewer or partner/);
    await expect(as(rev2, (tx) => schedules.unreviewSchedule(tx, rev2, id))).rejects.toThrow(/has not been reviewed/);
    await as(rev2, (tx) => schedules.reviewSchedule(tx, rev2, id));
    expect(await view(id)).toMatchObject({ reviewed: true, selfReviewed: false, reviewedByName: "reviewer 3", editable: false });
    await expect(as(rev2, (tx) => schedules.reviewSchedule(tx, rev2, id))).rejects.toThrow(/already been reviewed/);
    const logged = await db.query("select detail from audit_log where entity_id = $1 and action = 'schedule_review'", [id]);
    expect((logged.rows[0] as { detail: { selfReview: boolean } }).detail.selfReview).toBe(false);

    // Reviewed work is frozen until the review is withdrawn: every kind of change is refused.
    const frozen = /has been reviewed/;
    await expect(header(rev, id)).rejects.toThrow(frozen);
    await expect(as(prep, (tx) => schedules.saveLines(tx, prep, id, { rows: [lineRow("New", 1)] }))).rejects.toThrow(frozen);
    await expect(as(prep, (tx) => schedules.importLines(tx, prep, id, [{ description: "New", docRef: null, amountMinor: 1 }], "append"))).rejects.toThrow(frozen);
    await expect(as(prep, (tx) => schedules.deleteSchedule(tx, prep, id))).rejects.toThrow(frozen);
    await as(rev, (tx) => schedules.unreviewSchedule(tx, rev, id));
    await as(prep, (tx) => schedules.saveLines(tx, prep, id, { rows: [lineRow("Now allowed", 1)] }));
  });

  it("lets the only reviewer-level user review their own schedule, visibly", async () => {
    const SOLO = "cccccccc-1414-4000-8000-000000000001";
    const me: repo.Session = { firmId: SOLO, userId: "cccccccc-1414-4000-8000-000000000011", role: "partner" };
    const helper: repo.Session = { firmId: SOLO, userId: "cccccccc-1414-4000-8000-000000000012", role: "preparer" };
    await db.query("insert into firms (id, name) values ($1, 'Solo')", [SOLO]);
    for (const u of [me, helper]) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, SOLO, `${u.userId}@x.test`, u.role, u.role]);
    const eng = await as(me, async (tx) => {
      const client = await repo.createClient(tx, me, "Solo Co");
      const id = await repo.createEngagement(tx, me, client, "2025-01-01", "2025-12-31");
      await repo.importTrialBalance(tx, me, id, "tb.xlsx", TB);
      await repo.approveAllMappings(tx, me, id);
      await audit.setAuditEnabled(tx, me, id, true);
      return id;
    });
    const id = await as(me, (tx) => schedules.createSchedule(tx, me, eng, { areaCode: "C5", groupCode: "TRADEREC", title: "Own schedule", fromTrialBalance: true }));
    await as(me, (tx) => schedules.updateHeader(tx, me, id, { title: "Own schedule", objective: "", workDone: "Done.", conclusion: "Fine.", explanation: "", threshold: "performance" }));
    await as(me, (tx) => schedules.reviewSchedule(tx, me, id));
    expect(await as(me, (tx) => schedules.getSchedule(tx, id))).toMatchObject({ reviewed: true, selfReviewed: true, reviewedByName: "partner" });
    const logged = await db.query("select detail from audit_log where entity_id = $1 and action = 'schedule_review'", [id]);
    expect((logged.rows[0] as { detail: { selfReview: boolean } }).detail.selfReview).toBe(true);
    // Material is not set in this firm, so nothing is a key item.
    expect((await as(me, (tx) => schedules.getSchedule(tx, id)))!.coverage.keyItems).toBe(0);
  });

  it("works out key items from materiality and the chosen threshold, which follows revisions", async () => {
    const id = await create(prep, { fromTrialBalance: false, groupCode: null, title: "Key items" });
    await as(prep, (tx) => schedules.saveLines(tx, prep, id, { rows: [lineRow("Big", 800_000), lineRow("Medium", 400_000), lineRow("Small", 100_000, { tested: true })] }));
    expect((await view(id)).thresholdMinor).toBe(750_000);
    expect((await view(id)).coverage).toMatchObject({ keyItems: 1, keyItemsTested: 0, allKeyItemsTested: false });
    await header(prep, id, { title: "Key items", threshold: "half_performance" });
    expect((await view(id)).thresholdMinor).toBe(375_000);
    expect((await view(id)).coverage.keyItems).toBe(2);
    await expect(header(prep, id, { title: "Key items", threshold: "bogus" })).rejects.toThrow(/Choose a threshold/);
  });

  it("cannot be seen or changed by another firm", async () => {
    expect(await as(outsider, (tx) => schedules.getSchedule(tx, c5))).toBeNull();
    expect(await as(outsider, (tx) => schedules.listSchedules(tx, engagement, "C5"))).toEqual([]);
    await expect(as(outsider, (tx) => schedules.reviewSchedule(tx, outsider, c5))).rejects.toThrow(/not found/);
    await expect(as(outsider, (tx) => schedules.updateHeader(tx, outsider, c5, { title: "Hijacked", objective: "", workDone: "", conclusion: "", explanation: "", threshold: "performance" }))).rejects.toThrow(/not found/);
    await expect(as(outsider, (tx) => schedules.saveLines(tx, outsider, c5, { rows: [lineRow("x", 1)] }))).rejects.toThrow(/not found/);
    await expect(as(outsider, (tx) => schedules.deleteSchedule(tx, outsider, c5))).rejects.toThrow(/not found/);
    await expect(as(outsider, (tx) => schedules.createSchedule(tx, outsider, engagement, { areaCode: "C5", groupCode: null, title: "Into another firm" }))).rejects.toThrow(/not found/);
  });

  it("counts as recorded work, so the audit cannot be turned off, and cannot be written on a locked engagement", async () => {
    await expect(as(partner, (tx) => audit.setAuditEnabled(tx, partner, engagement, false))).rejects.toThrow(/cannot be turned off/);
    const fresh = await make(partner, true, true);
    const id = await create(prep, {}, fresh);
    await db.query("update engagements set status = 'locked' where id = $1", [fresh]);
    const locked = /locked/;
    await expect(create(prep, {}, fresh)).rejects.toThrow(locked);
    await expect(header(rev, id)).rejects.toThrow(locked);
    await expect(as(prep, (tx) => schedules.saveLines(tx, prep, id, { rows: [lineRow("x", 1)] }))).rejects.toThrow(locked);
    await expect(as(prep, (tx) => schedules.importLines(tx, prep, id, [{ description: "x", docRef: null, amountMinor: 1 }], "append"))).rejects.toThrow(locked);
    await expect(as(rev, (tx) => schedules.reviewSchedule(tx, rev, id))).rejects.toThrow(locked);
    await expect(as(rev, (tx) => schedules.unreviewSchedule(tx, rev, id))).rejects.toThrow(locked);
    await expect(as(prep, (tx) => schedules.deleteSchedule(tx, prep, id))).rejects.toThrow(locked);
    // It can still be read.
    expect(await view(id)).toMatchObject({ editable: false, reference: "C5-1" });
  });
});
