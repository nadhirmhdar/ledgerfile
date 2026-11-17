import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import * as review from "../src/server/review";
import * as papers from "../src/server/working-papers";
import * as schedules from "../src/server/test-schedules";
import * as conf from "../src/server/confirmations";
import { buildWorkingPaperIndex } from "../src/server/wp-index";
import { exportIndex } from "../src/server/wp-index-export";
import { localFileStore } from "../src/server/file-store";
import { AREA_BY_CODE, assertionsOf } from "../src/domain/audit";
import { UNFILED, type IndexEntry } from "../src/domain/wp-index";

// Invented figures, in fils: receivables (C5), bank (C6) and share capital (C12).
const TB = [
  { code: "1000", name: "Bank - current account", closingMinor: 70_000_000, priorMinor: 60_000_000 },
  { code: "1100", name: "Trade receivables", closingMinor: 24_000_000, priorMinor: 20_000_000 },
  { code: "3000", name: "Share capital", closingMinor: -94_000_000, priorMinor: -80_000_000 },
];
type T = Parameters<Parameters<typeof withFirm>[2]>[0];

describe("the working paper index", () => {
  const FIRM = "aaaaaaaa-1818-4000-8000-000000000001";
  const OTHER = "bbbbbbbb-1818-4000-8000-000000000001";
  const user = (n: number, role: repo.Session["role"], firmId = FIRM): repo.Session => ({ firmId, userId: `${firmId.slice(0, 8)}-1818-4000-8000-00000000001${n}`, role });
  const prep = user(1, "preparer");
  const rev = user(2, "reviewer");
  const partner = user(3, "partner");
  const outsider = user(4, "partner", OTHER);
  let db: Db;
  let audited: string;
  let plain: string; // the audit never turned on
  let locked: string;
  const store = localFileStore(mkdtempSync(join(tmpdir(), "wp-index-")));
  const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
  const build = (engagement: string, s: repo.Session = prep) => as(s, (tx) => buildWorkingPaperIndex(tx, engagement));
  const flat = (index: NonNullable<Awaited<ReturnType<typeof build>>>): IndexEntry[] => index.sections.flatMap((s) => s.entries);
  const find = (index: NonNullable<Awaited<ReturnType<typeof build>>>, reference: string) => flat(index).find((e) => e.reference === reference);
  const makeEngagement = (name: string, auditOn: boolean) =>
    as(partner, async (tx) => {
      const client = await repo.createClient(tx, partner, name);
      const id = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
      await repo.importTrialBalance(tx, partner, id, "tb.xlsx", TB);
      await repo.approveAllMappings(tx, partner, id);
      if (auditOn) await audit.setAuditEnabled(tx, partner, id, true);
      return id;
    });
  const upload = (engagement: string, name: string, supports: { kind: string; target: string | null } = { kind: "engagement", target: null }) =>
    as(prep, (tx) => papers.addWorkingPaper(tx, prep, store, engagement, { targetKind: supports.kind, target: supports.target, fileName: name, data: new TextEncoder().encode(`%PDF ${name}`), description: "" }));
  const file = (id: string, reference: string, sectionCode = "", s: repo.Session = prep) => as(s, (tx) => papers.setFileFiling(tx, s, id, { reference, sectionCode }));

  beforeAll(async () => {
    db = await openDatabase();
    for (const firm of [FIRM, OTHER]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [firm]);
    for (const u of [prep, rev, partner, outsider]) {
      await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} person`, u.role]);
    }
    audited = await makeEngagement("Indexed Co. (invented)", true);
    plain = await makeEngagement("Compiled Co. (invented)", false);
    locked = await makeEngagement("Finished Co. (invented)", false);
  });

  it("lists, on an engagement with the audit off, only the papers that do not depend on it, in file order", async () => {
    const index = (await build(plain))!;
    expect(index.auditOn).toBe(false);
    // Lead sheets sit in their area, and C5 comes before C6 before C12 (numeric, not text, order).
    expect(index.sections.map((s) => s.code)).toEqual(["G", "C5", "C6", "C12"]);
    expect(flat(index).map((e) => e.reference)).toEqual(["G1", "G2", "G3", "G4", "G5", "C5.L1", "C6.L1", "C12.L1"]);
    expect(flat(index).some((e) => ["checklist", "procedures", "schedule", "risk", "materiality", "letter"].includes(e.kind))).toBe(false);
    expect(find(index, "G1")).toMatchObject({ status: "prepared", reviewable: false, preparedBy: null });
    expect(find(index, "G1")!.note).toMatch(/does not record who/);
    expect(find(index, "G2")).toMatchObject({ status: "not_applicable", note: "None recorded." });
    expect(find(index, "G4")).toMatchObject({ status: "not_started" });
    expect(find(index, "G5")).toMatchObject({ status: "not_started", reviewable: true });
    expect(find(index, "C5.L1")).toMatchObject({ title: "Lead sheet: Trade and other receivables", status: "not_started", reviewable: true });
  });

  it("follows a lead sheet from not started to prepared to reviewed, with who and when, and holds it in progress while a point is open", async () => {
    const sign = (s: repo.Session, group: string, level: "preparer" | "reviewer") => as(s, (tx) => review.signOff(tx, s, plain, group, level));
    await sign(prep, "TRADEREC", "preparer");
    let index = (await build(plain))!;
    expect(find(index, "C5.L1")).toMatchObject({ status: "prepared", preparedBy: "preparer person", reviewedBy: null });
    expect(find(index, "C5.L1")!.preparedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await as(rev, (tx) => review.addReviewPoint(tx, rev, plain, "TRADEREC", "Why did the debtors rise?"));
    index = (await build(plain))!;
    expect(find(index, "C5.L1")).toMatchObject({ status: "in_progress", note: "1 open review point(s)." });
    const pointId = (await as(rev, (tx) => tx.query<{ id: string }>("select id from review_points where engagement_id = $1", [plain]))).rows[0].id;
    await as(prep, (tx) => review.respondToReviewPoint(tx, prep, pointId, "New customer in March."));
    await as(rev, (tx) => review.clearReviewPoint(tx, rev, pointId));
    await sign(rev, "TRADEREC", "reviewer");
    index = (await build(plain))!;
    expect(find(index, "C5.L1")).toMatchObject({ status: "reviewed", preparedBy: "preparer person", reviewedBy: "reviewer person" });
    expect(index.overall.reviewed).toBe(1);
  });

  it("lists the audit papers when the audit is on, with checklists under their own codes and no reference repeated", async () => {
    const index = (await build(audited))!;
    expect(index.auditOn).toBe(true);
    const refs = flat(index).map((e) => e.reference).filter((r): r is string => r !== null);
    expect(new Set(refs).size).toBe(refs.length);
    for (const r of ["A1", "A3", "A3.L", "B2", "B2.M", "B3", "B3.A", "B8", "B8.R", "D1", "D1.M", "D5", "D5.L", "D8", "E1", "G5", "C16.J", "C7.P", "C16.P", "C5.P", "C6.P"]) expect(refs, r).toContain(r);
    // E4 is after the report and is not on the file; optional checklists are listed.
    expect(refs).not.toContain("E4");
    expect(refs).toContain("B9");
    // In file order: general, acceptance, planning, areas, completion, reporting.
    const codes = index.sections.map((s) => s.code);
    expect(codes.slice(0, 3)).toEqual(["G", "A", "B"]);
    expect(codes.indexOf("C5")).toBeLessThan(codes.indexOf("C10"));
    expect(codes.slice(-2)).toEqual(["D", "E"]);
    // Planning is in reference order, with each suffixed paper after its checklist.
    const b = index.sections.find((s) => s.code === "B")!.entries.map((e) => e.reference);
    expect(b.indexOf("B2")).toBeLessThan(b.indexOf("B2.M"));
    expect(b.indexOf("B2.M")).toBeLessThan(b.indexOf("B3"));
    expect(b.indexOf("B8.R")).toBeLessThan(b.indexOf("B9"));
    expect(b.indexOf("B9")).toBeLessThan(b.indexOf("B10"));
    // Nothing the product cannot know is made up.
    expect(find(index, "A3.L")).toMatchObject({ status: "not_started", reviewable: false, preparedBy: null });
    expect(find(index, "B2.M")).toMatchObject({ status: "not_started" });
    expect(find(index, "B8.R")).toMatchObject({ status: "not_started" });
    expect(find(index, "D1.M")).toMatchObject({ status: "not_applicable", note: "None recorded." });
  });

  it("follows materiality, the risk assessment, a procedure, a checklist step and a schedule through to reviewed", async () => {
    const rate = (code: string, level: string) => Object.fromEntries(assertionsOf(AREA_BY_CODE.get(code)!).map((a) => [a, level]));
    await as(rev, (tx) =>
      audit.setMateriality(tx, rev, audited, { benchmark: "assets", percentageBp: 100, performancePct: 75, trivialPct: 5, rationale: "Total assets is the measure the owners watch." }),
    );
    let index = (await build(audited))!;
    expect(find(index, "B2.M")).toMatchObject({ status: "prepared", preparedBy: "reviewer person", reviewable: false });
    expect(find(index, "B3.A")).toMatchObject({ status: "in_progress", reviewable: false }); // movements are flagged once materiality is set, and none is explained yet

    await as(rev, (tx) => audit.setAreaRisks(tx, rev, audited, "C5", rate("C5", "moderate")));
    index = (await build(audited))!;
    expect(find(index, "B8.R")).toMatchObject({ status: "in_progress", preparedBy: "reviewer person" }); // other areas are not yet rated
    expect(find(index, "C5.P")).toMatchObject({ status: "not_started", reviewable: true });

    // One procedure done by the preparer: the area is in progress, then every step done and reviewed is reviewed.
    const procs = await as(prep, (tx) => audit.listProcedures(tx, audited, "C5"));
    await as(prep, (tx) => audit.updateProcedure(tx, prep, procs[0].id, { status: "done", workDone: "Agreed the listing to the ledger.", conclusion: "No exceptions." }));
    index = (await build(audited))!;
    expect(find(index, "C5.P")).toMatchObject({ status: "in_progress", preparedBy: "preparer person" });
    expect(find(index, "C5.P")!.note).toMatch(/^1 of \d+ steps finished, 0 reviewed/);
    for (const p of procs.slice(1)) await as(prep, (tx) => audit.updateProcedure(tx, prep, p.id, { status: "done", workDone: "Performed as described.", conclusion: "Satisfactory." }));
    index = (await build(audited))!;
    expect(find(index, "C5.P")).toMatchObject({ status: "prepared", reviewedBy: null });
    await as(rev, (tx) => audit.reviewArea(tx, rev, audited, "C5"));
    index = (await build(audited))!;
    expect(find(index, "C5.P")).toMatchObject({ status: "reviewed", reviewedBy: "reviewer person", preparedBy: "preparer person" });
    expect(find(index, "C5.P")!.note).not.toMatch(/self-reviewed/);

    // A test schedule is C5-1 and follows its own review.
    const id = await as(prep, (tx) => schedules.createSchedule(tx, prep, audited, { areaCode: "C5", groupCode: "TRADEREC", title: "Receivables listing", fromTrialBalance: true }));
    index = (await build(audited))!;
    expect(find(index, "C5-1")).toMatchObject({ title: "Receivables listing", status: "in_progress", kind: "schedule", reviewable: true, preparedBy: null });
    await as(prep, (tx) =>
      schedules.updateHeader(tx, prep, id, { title: "Receivables listing", objective: "Existence", workDone: "Agreed to the ledger.", conclusion: "Agrees to the balance.", explanation: "", threshold: "performance" }),
    );
    index = (await build(audited))!;
    expect(find(index, "C5-1")).toMatchObject({ status: "prepared", preparedBy: "preparer person" });
    await as(rev, (tx) => schedules.reviewSchedule(tx, rev, id));
    index = (await build(audited))!;
    expect(find(index, "C5-1")).toMatchObject({ status: "reviewed", reviewedBy: "reviewer person" });
    expect(find(index, "C5-1")!.note).toBeNull();
    // The area's papers sit together: lead sheet, procedures, schedule.
    const c5 = index.sections.find((s) => s.code === "C5")!.entries.map((e) => e.reference);
    expect(c5).toEqual(["C5.L1", "C5.P", "C5-1"]);
  });

  it("files uploaded files by what they support, or where the preparer puts them, and lists every file once", async () => {
    const loose = await upload(audited, "bank-letter.pdf");
    const onSheet = await upload(audited, "ageing.pdf", { kind: "lead_sheet", target: "TRADEREC" });
    const filed = await upload(audited, "bank-confirmation.pdf");
    await file(filed, "C6-F1");
    const second = await upload(audited, "bank-rec.pdf");
    await file(second, "", "C6");
    const planning = await upload(audited, "strategy.pdf");
    await file(planning, "B8-F1");

    const index = (await build(audited))!;
    const titles = (code: string) => index.sections.find((s) => s.code === code)!.entries.filter((e) => e.kind === "file").map((e) => `${e.reference ?? "-"} ${e.title}`);
    expect(titles("C6")).toEqual(["C6-F1 bank-confirmation.pdf", "- bank-rec.pdf"]);
    expect(titles("C5")).toEqual(["- ageing.pdf"]); // follows its lead sheet
    expect(titles("B")).toEqual(["B8-F1 strategy.pdf"]);
    expect(index.sections.at(-1)).toMatchObject({ code: UNFILED });
    expect(titles(UNFILED)).toEqual(["- bank-letter.pdf"]);

    const all = await as(prep, (tx) => tx.query<{ n: number }>("select count(*)::int as n from working_papers where engagement_id = $1", [audited]));
    expect(flat(index).filter((e) => e.kind === "file")).toHaveLength(all.rows[0].n);
    expect(loose).toBeTruthy();
    expect(onSheet).toBeTruthy();
  });

  it("holds the file reference rules, in the application and in the database", async () => {
    const a = await upload(plain, "one.pdf");
    const b = await upload(plain, "two.pdf");
    const onSheet = await upload(plain, "support.pdf", { kind: "lead_sheet", target: "CASH" });
    await expect(file(a, "C5-1")).rejects.toThrow(/-F/); // a shape the application makes itself
    await expect(file(a, "C5.P")).rejects.toThrow(/-F/);
    await expect(file(a, "C99-F1")).rejects.toThrow(/not an area or checklist/);
    await expect(file(a, "C5-F1", "C6")).rejects.toThrow(/does not match where this file is filed/);
    await expect(file(a, "", "C99")).rejects.toThrow(/area or checklist/);

    await file(a, " c5-f1 "); // normalised; the section follows the reference
    const stored = await as(prep, (tx) => tx.query<{ reference: string; section: string }>('select reference, section_code as section from working_papers where id = $1', [a]));
    expect(stored.rows[0]).toEqual({ reference: "C5-F1", section: "C5" });
    await expect(file(b, "C5-F1")).rejects.toThrow(/Another file already has/);
    await file(b, "C5-F2");

    // A file that supports a lead sheet is filed with it: it takes no place of its own, and its reference must start with its area.
    await expect(file(onSheet, "", "C5")).rejects.toThrow(/filed where the lead sheet/);
    await expect(file(onSheet, "C5-F9")).rejects.toThrow(/does not match/);
    await file(onSheet, "C6-F1");

    // Saving the same values again changes nothing and logs nothing.
    const logged = async () => (await db.query("select count(*)::int as n from audit_log where entity_id = $1 and action = 'file'", [b])).rows[0] as { n: number };
    const before = (await logged()).n;
    await file(b, "C5-F2");
    expect((await logged()).n).toBe(before);
    await expect(file(b, "C5-F02")).rejects.toThrow(/-F/);

    // A file whose procedure has gone is unfiled and takes no reference.
    const orphan = await upload(plain, "orphan.pdf");
    await db.query("update working_papers set target_kind = 'procedure', target = '00000000-0000-4000-8000-000000000000' where id = $1", [orphan]);
    await expect(file(orphan, "C5-F5")).rejects.toThrow(/no longer on the file/);

    // Cleared again.
    await file(a, "");
    const cleared = await as(prep, (tx) => tx.query<{ reference: string | null; section: string | null }>('select reference, section_code as section from working_papers where id = $1', [a]));
    expect(cleared.rows[0]).toEqual({ reference: null, section: null });

    // The log records each change, with what it replaced.
    const log = await db.query<{ detail: { reference: string | null; previousReference: string | null } }>("select detail from audit_log where entity_id = $1 and action = 'file' order by id", [a]);
    expect(log.rows.map((r) => [r.detail.previousReference, r.detail.reference])).toEqual([[null, "C5-F1"], ["C5-F1", null]]);

    // The database has the last word: a bad shape, a clash, and a changed file name are refused even if the application is bypassed.
    await expect(as(prep, (tx) => tx.query("update working_papers set reference = 'C5-1' where id = $1", [b]))).rejects.toThrow();
    await expect(as(prep, (tx) => tx.query("update working_papers set reference = 'C5-F2' where id = $1", [a]))).rejects.toThrow();
    await expect(as(prep, (tx) => tx.query("update working_papers set section_code = 'C5' where id = $1", [onSheet]))).rejects.toThrow();
    await expect(as(prep, (tx) => tx.query("update working_papers set file_name = 'changed.pdf' where id = $1", [b]))).rejects.toThrow(/permission denied/);
    await expect(as(prep, (tx) => tx.query("update working_papers set sha256 = 'x' where id = $1", [b]))).rejects.toThrow(/permission denied/);
  });

  it("shows who asked for client requests, and marks a lead sheet reviewed by its own preparer as self-reviewed", async () => {
    await as(prep, (tx) => tx.query("insert into client_requests (firm_id, engagement_id, seq, reference, description, requested_by, requested_on) values ($1, $2, 1, 'R-1', 'Bank statements', $3, '2025-03-01')", [FIRM, plain, prep.userId]));
    let index = (await build(plain))!;
    expect(find(index, "G4")).toMatchObject({ preparedBy: "preparer person", preparedOn: "2025-03-01", status: "in_progress" });
    // The partner prepares and reviews the cash lead sheet alone (the lead sheet rule allows it only for a sole practitioner, so write the sign-offs directly).
    await db.query("insert into sign_offs (firm_id, engagement_id, target, level, user_id) values ($1, $2, 'CASH', 'preparer', $3), ($1, $2, 'CASH', 'reviewer', $3)", [FIRM, plain, partner.userId]);
    index = (await build(plain))!;
    expect(find(index, "C6.L1")).toMatchObject({ status: "reviewed", note: "Self-reviewed." });
  });

  it("keeps one firm's index and files out of another's", async () => {
    expect(await build(audited, outsider)).toBeNull();
    expect(await as(outsider, (tx) => exportIndex(tx, outsider, audited))).toBeNull();
    const own = await as(prep, (tx) => tx.query<{ id: string }>("select id from working_papers where engagement_id = $1 limit 1", [audited]));
    await expect(file(own.rows[0].id, "C5-F7", "", outsider)).rejects.toThrow(/not found/);
  });

  it("is a read-only view of a locked engagement, and refuses to change a file's reference there", async () => {
    const f = await upload(locked, "evidence.pdf");
    await file(f, "C6-F1");
    for (const group of ["CASH", "TRADEREC", "CAPITAL"]) {
      await as(prep, (tx) => review.signOff(tx, prep, locked, group, "preparer"));
      await as(rev, (tx) => review.signOff(tx, rev, locked, group, "reviewer"));
    }
    await as(partner, (tx) => review.lockEngagement(tx, partner, locked));
    const index = (await build(locked))!;
    expect(index.engagementStatus).toBe("locked");
    expect(find(index, "G5")).toMatchObject({ status: "reviewed", reviewedBy: "partner person" });
    expect(index.overall.reviewed).toBeGreaterThanOrEqual(4);
    expect(flat(index).filter((e) => e.kind === "lead_sheet").every((e) => e.status === "reviewed")).toBe(true);
    await expect(file(f, "C6-F2")).rejects.toThrow(/locked/);
    await expect(file(f, "")).rejects.toThrow(/locked/);
    const kept = await as(prep, (tx) => tx.query<{ reference: string }>("select reference from working_papers where id = $1", [f]));
    expect(kept.rows[0].reference).toBe("C6-F1");
  });

  it("uses the same number of queries however many papers there are", async () => {
    const counted = async (engagement: string) => {
      let n = 0;
      await as(prep, async (tx) => {
        const proxy = new Proxy(tx, {
          get(target, prop) {
            const v = Reflect.get(target, prop) as unknown;
            if (prop === "query") return (...args: unknown[]) => { n++; return (target.query as (...a: unknown[]) => unknown)(...args); };
            return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
          },
        }) as T;
        await buildWorkingPaperIndex(proxy, engagement);
      });
      return n;
    };
    const before = await counted(audited);
    for (let i = 0; i < 4; i++) {
      await as(prep, (tx) => schedules.createSchedule(tx, prep, audited, { areaCode: "C6", groupCode: "CASH", title: `Bank test ${i + 1}`, fromTrialBalance: true }));
      await upload(audited, `extra-${i}.pdf`);
    }
    const after = await counted(audited);
    expect(after).toBe(before);
    expect(before).toBeLessThan(60);
    const index = (await build(audited))!;
    expect(flat(index).filter((e) => e.kind === "schedule").map((e) => e.reference)).toEqual(["C5-1", "C6-1", "C6-2", "C6-3", "C6-4"]);
  });

  it("lists an area's confirmations as one paper after its schedules, with a status from the records, and never another firm's", async () => {
    const mk = (party: string, kind: string) => as(prep, (tx) => conf.addConfirmation(tx, prep, audited, { kind, partyName: party, bookMinor: 1_000 }));
    const sentOn = (id: string) => as(prep, (tx) => conf.markSent(tx, prep, id, "2025-06-01", "2025-06-15"));
    const entry = async (ref: string) => find((await build(audited))!, ref);
    expect(await entry("C6.CF")).toBeUndefined(); // none yet

    const a = await mk("Index Bank", "bank");
    const b = await mk("Index Bank Two", "bank");
    expect(await entry("C6.CF")).toMatchObject({ status: "not_started", reviewable: true, title: "External confirmations", kind: "confirmations", note: "2 confirmations: 2 not sent." });
    await sentOn(a);
    expect(await entry("C6.CF")).toMatchObject({ status: "in_progress", note: "2 confirmations: 1 awaiting reply, 1 not sent." });
    await sentOn(b);
    await as(prep, (tx) => conf.recordReply(tx, prep, a, { reply: "agreed", repliedOn: "2025-06-02" }, "2025-06-15"));
    await as(prep, (tx) => conf.recordReply(tx, prep, b, { reply: "differs", repliedOn: "2025-06-02", confirmedMinor: 900 }, "2025-06-15"));
    await as(prep, (tx) => conf.saveReconciliation(tx, prep, b, "Cheque in transit."));
    await as(prep, (tx) => conf.prepareConfirmation(tx, prep, a));
    // One is still to prepare, so the area is in progress.
    expect(await entry("C6.CF")).toMatchObject({ status: "in_progress", preparedBy: "preparer person", note: "2 confirmations: 1 agreed, 1 differs." });
    await as(prep, (tx) => conf.prepareConfirmation(tx, prep, b));
    expect(await entry("C6.CF")).toMatchObject({ status: "prepared", reviewedBy: null });
    await as(rev, (tx) => conf.reviewConfirmation(tx, rev, a));
    expect(await entry("C6.CF")).toMatchObject({ status: "prepared" }); // one reviewed, one not yet
    await as(rev, (tx) => conf.reviewConfirmation(tx, rev, b));
    expect(await entry("C6.CF")).toMatchObject({ status: "reviewed", reviewedBy: "reviewer person" });

    // One entry per area, placed in that area after its schedules and before its files.
    await mk("Index Customer", "receivable");
    const index = (await build(audited))!;
    expect(flat(index).filter((e) => e.kind === "confirmations").map((e) => e.reference)).toEqual(["C5.CF", "C6.CF"]);
    const c6 = index.sections.find((s) => s.code === "C6")!.entries.map((e) => e.reference);
    expect(c6.indexOf("C6.CF")).toBeGreaterThan(c6.indexOf("C6-4"));
    expect(c6.indexOf("C6.CF")).toBeLessThan(c6.indexOf("C6-F1"));
    expect(index.sections.find((s) => s.code === "C5")!.entries.filter((e) => e.kind !== "file").map((e) => e.reference).at(-1)).toBe("C5.CF");

    // The export has the row.
    const out = (await as(prep, (tx) => exportIndex(tx, prep, audited)))!;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out.buffer as unknown as ArrayBuffer);
    const sheet = wb.getWorksheet("Index")!;
    const rows: string[][] = [];
    for (let i = 1; i <= sheet.rowCount; i++) rows.push(Array.from({ length: 9 }, (_, c) => String(sheet.getRow(i).getCell(c + 1).value ?? "")));
    const row = rows.find((r) => r[0] === "C6.CF")!;
    expect([row[1], row[2], row[7], row[8]]).toEqual(["External confirmations", "External confirmations", "Reviewed", "2 confirmations: 1 agreed, 1 differs."]);

    // Another firm's confirmations never appear, and an engagement with the audit off shows none.
    const theirs = await as(outsider, async (tx) => {
      const client = await repo.createClient(tx, outsider, "Their Co. (invented)");
      const id = await repo.createEngagement(tx, outsider, client, "2025-01-01", "2025-12-31");
      await repo.importTrialBalance(tx, outsider, id, "tb.xlsx", TB);
      await repo.approveAllMappings(tx, outsider, id);
      await audit.setAuditEnabled(tx, outsider, id, true);
      await conf.addConfirmation(tx, outsider, id, { kind: "bank", partyName: "Their Bank" });
      await conf.addConfirmation(tx, outsider, id, { kind: "legal", partyName: "Their Lawyer" });
      return id;
    });
    expect(flat((await build(audited))!).some((e) => e.reference === "C10.CF")).toBe(false);
    expect(await build(theirs)).toBeNull(); // not visible to this firm at all
    expect(flat((await build(theirs, outsider))!).filter((e) => e.kind === "confirmations").map((e) => e.reference)).toEqual(["C6.CF", "C10.CF"]);
    expect(flat((await build(plain))!).some((e) => e.kind === "confirmations")).toBe(false);
  });

  it("exports the index as text, firm-scoped and logged", async () => {
    // A file name that would be a formula in a spreadsheet must come out as text.
    await upload(audited, "=SUM(A1).pdf");
    const out = (await as(prep, (tx) => exportIndex(tx, prep, audited)))!;
    expect(out.fileName).toBe("Indexed-Co-invented-working-paper-index-2025-12-31.xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out.buffer as unknown as ArrayBuffer);
    const sheet = wb.getWorksheet("Index")!;
    const rows: string[][] = [];
    for (let i = 1; i <= sheet.rowCount; i++) rows.push(Array.from({ length: 9 }, (_, c) => String(sheet.getRow(i).getCell(c + 1).value ?? "")));
    expect(rows[0][0]).toBe("Working paper index: Indexed Co. (invented)");
    expect(rows[2][0]).toMatch(/^\d+ papers: /);
    expect(rows[4].slice(0, 9)).toEqual(["Reference", "Paper", "Type", "Prepared by", "Prepared on", "Reviewed by", "Reviewed on", "Status", "Note"]);
    const body = rows.slice(5);
    expect(body.some((r) => r[0] === "C5-1" && r[1] === "Receivables listing" && r[7] === "Reviewed")).toBe(true);
    expect(body.some((r) => r[0] === "C5.P" && r[7] === "Reviewed" && r[5] === "reviewer person")).toBe(true);
    // Section bands carry the section titles, in order.
    const bands = body.filter((r) => r[1] === "" && r[0] !== "").map((r) => r[0]);
    expect(bands.slice(0, 3)).toEqual(["General", "Acceptance", "Planning"]);
    expect(bands.indexOf("C5 Trade and other receivables")).toBeLessThan(bands.indexOf("C6 Cash and bank"));
    expect(bands.at(-1)).toBe("Unfiled");
    const cell = sheet.getRow(6 + body.findIndex((r) => r[1] === "=SUM(A1).pdf")).getCell(2);
    expect(cell.value).toBe("=SUM(A1).pdf");
    expect(cell.type).toBe(ExcelJS.ValueType.String);
    expect(cell.numFmt).toBe("@");
    const log = await db.query("select detail from audit_log where entity = 'working_paper_index' and entity_id = $1", [audited]);
    expect(log.rows).toHaveLength(2); // the confirmations test above exported once too
  });
});
