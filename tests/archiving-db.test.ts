import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import * as review from "../src/server/review";
import * as journals from "../src/server/journals";
import * as papers from "../src/server/working-papers";
import * as confirmations from "../src/server/confirmations";
import * as requests from "../src/server/client-requests";
import * as schedules from "../src/server/test-schedules";
import * as analytics from "../src/server/analytics";
import * as ledger from "../src/server/ledger";
import { archiveEngagement } from "../src/server/archiving";
import { clearOpinion, recordOpinion, type OpinionInput } from "../src/server/opinion";
import { generateLetter } from "../src/server/letters";
import { generateReport } from "../src/server/report-download";
import { beginDirectUpload } from "../src/server/direct-upload";
import { applyMigrations } from "../src/server/migrations";
import type { FileStore } from "../src/server/file-store";

const FIRM = "aaaaaaaa-1010-4000-8000-000000000001";
const OTHER = "bbbbbbbb-1010-4000-8000-000000000001";
const user = (n: number, role: repo.Session["role"], firmId = FIRM): repo.Session => ({ firmId, userId: `${firmId.slice(0, 8)}-1010-4000-8000-00000000001${n}`, role });
const prep = user(1, "preparer");
const rev = user(2, "reviewer");
const partner = user(3, "partner");
const admin = user(4, "admin");
const outsider = user(5, "partner", OTHER);
const TB = [
  { code: "1000", name: "Bank - current account", closingMinor: 15000000, priorMinor: 10000000 },
  { code: "3000", name: "Share capital", closingMinor: -5000000, priorMinor: -5000000 },
  { code: "4000", name: "Sales", closingMinor: -10000000, priorMinor: 0 },
];
const REPORT_DATE = "2026-01-10";
const TODAY = "2026-02-01";
const opinion: OpinionInput = { opinion: "unmodified", basisForModification: "", goingConcern: false, goingConcernNote: "", emphasisOfMatter: "", otherMatter: "", reportDate: REPORT_DATE };
const NAME = "Archive Co LLC";

let db: Db;
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
const lock = (id: string) => db.query("update engagements set status = 'locked', locked_by = $2, locked_at = now() where id = $1", [id, partner.userId]);
const row = async (id: string) => (await db.query<{ status: string; archived_at: unknown; archived_by: string | null; locked_at: unknown }>("select status, archived_at, archived_by, locked_at from engagements where id = $1", [id])).rows[0];
const store: FileStore = { put: async () => undefined, get: async () => null, remove: async () => undefined };

/** A new audited engagement with an opinion dated REPORT_DATE; open until a test locks it. */
async function newEngagement(name = NAME, withOpinion = true): Promise<string> {
  return as(partner, async (tx) => {
    const client = await repo.createClient(tx, partner, name);
    const id = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
    await repo.importTrialBalance(tx, partner, id, "tb.xlsx", TB);
    await repo.approveAllMappings(tx, partner, id);
    await audit.setAuditEnabled(tx, partner, id, true);
    if (withOpinion) await recordOpinion(tx, partner, id, opinion);
    return id;
  });
}

beforeAll(async () => {
  db = await openDatabase();
  for (const f of [FIRM, OTHER]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [f]);
  for (const u of [prep, rev, partner, admin, outsider]) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} user`, u.role]);
});

afterAll(async () => {
  await db.close();
});

describe("the database guard", () => {
  it("refuses to archive a file that is not locked", async () => {
    const id = await newEngagement("Guard Open Co");
    await expect(db.query("update engagements set archived_at = now() where id = $1", [id])).rejects.toThrow(/only after it has been locked/);
    expect((await row(id)).archived_at).toBeNull();
  });

  it("refuses, once archived, to unlock, change the dates or the people, un-archive or delete, and allows nothing else to be mistaken for those", async () => {
    const id = await newEngagement("Guard Archived Co");
    await lock(id);
    await db.query("update engagements set archived_at = now(), archived_by = $2 where id = $1", [id, partner.userId]);
    const archived = /This file is archived/;
    await expect(db.query("update engagements set status = 'open' where id = $1", [id])).rejects.toThrow(archived);
    await expect(db.query("update engagements set status = 'open', locked_by = null, locked_at = null where id = $1", [id])).rejects.toThrow(archived);
    await expect(db.query("update engagements set locked_at = now() where id = $1", [id])).rejects.toThrow(archived);
    await expect(db.query("update engagements set locked_by = $2 where id = $1", [id, admin.userId])).rejects.toThrow(archived);
    await expect(db.query("update engagements set archived_at = null where id = $1", [id])).rejects.toThrow(archived);
    await expect(db.query("update engagements set archived_at = now() + interval '1 day' where id = $1", [id])).rejects.toThrow(archived);
    await expect(db.query("update engagements set archived_by = $2 where id = $1", [id, admin.userId])).rejects.toThrow(archived);
    await expect(db.query("delete from engagements where id = $1", [id])).rejects.toThrow(/cannot be deleted/);
    // The same through the tenant role: the guard does not depend on who asks.
    await expect(as(partner, (tx) => tx.query("update engagements set status = 'open' where id = $1", [id]))).rejects.toThrow(archived);
    await expect(as(partner, (tx) => tx.query("delete from engagements where id = $1", [id]))).rejects.toThrow(/cannot be deleted/);
    const after = await row(id);
    expect(after.status).toBe("locked");
    expect(after.archived_at).not.toBeNull();
  });

  it("leaves an unarchived locked file as it was: it can still be unlocked, and deleted rows are not blocked", async () => {
    const id = await newEngagement("Guard Plain Co");
    await lock(id);
    await db.query("update engagements set status = 'open', locked_by = null, locked_at = null where id = $1", [id]);
    expect((await row(id)).status).toBe("open");
  });
});

describe("the migration archives nothing", () => {
  it("leaves every existing engagement, locked ones included, unarchived", async () => {
    // Put the database back as it was before 0022, with locked engagements in it, then run the migration over that data.
    const a = await newEngagement("Before Locked Co");
    const b = await newEngagement("Before Open Co");
    await lock(a);
    await db.exec("drop trigger engagements_archive_guard on engagements; drop function engagements_archive_guard(); alter table engagements drop column archived_by, drop column archived_at;");
    await db.query("delete from schema_migrations where name = '0022_archiving.sql'");
    expect((await db.query("select 1 from information_schema.columns where table_name = 'engagements' and column_name = 'archived_at'")).rows).toHaveLength(0);

    const applied = await applyMigrations(db);
    expect(applied).toEqual(["0022_archiving.sql"]);
    const all = (await db.query<{ id: string; status: string; archived_at: unknown; archived_by: unknown }>("select id, status, archived_at, archived_by from engagements")).rows;
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.some((r) => r.status === "locked")).toBe(true);
    for (const r of all) {
      expect(r.archived_at, r.id).toBeNull();
      expect(r.archived_by, r.id).toBeNull();
    }
    expect((await row(a)).status).toBe("locked");
    expect((await row(b)).status).toBe("open");
  });
});

describe("archiving a file", () => {
  it("is refused for anyone but a partner or administrator", async () => {
    const id = await newEngagement("Role Co");
    await lock(id);
    for (const s of [prep, rev]) await expect(as(s, (tx) => archiveEngagement(tx, s, id, "Role Co", TODAY))).rejects.toThrow("Only a partner can archive a file.");
    await expect(as(outsider, (tx) => archiveEngagement(tx, outsider, id, "Role Co", TODAY))).rejects.toThrow(/Engagement not found/);
    expect((await row(id)).archived_at).toBeNull();
  });

  it("is refused for a file that is open, has no opinion, no report date, a report date in the future, or the audit off", async () => {
    const open = await newEngagement("Still Open Co");
    await expect(as(partner, (tx) => archiveEngagement(tx, partner, open, "Still Open Co", TODAY))).rejects.toThrow(/only after it has been locked/);

    const none = await newEngagement("No Opinion Co", false);
    await lock(none);
    await expect(as(partner, (tx) => archiveEngagement(tx, partner, none, "No Opinion Co", TODAY))).rejects.toThrow(/Record the audit opinion first/);

    const undated = await newEngagement("Undated Co");
    await db.query("update audit_opinions set report_date = null where engagement_id = $1", [undated]);
    await lock(undated);
    await expect(as(partner, (tx) => archiveEngagement(tx, partner, undated, "Undated Co", TODAY))).rejects.toThrow(/date of the auditor's report first/);

    const future = await newEngagement("Future Co");
    await lock(future);
    await expect(as(partner, (tx) => archiveEngagement(tx, partner, future, "Future Co", "2026-01-09"))).rejects.toThrow(/dated 2026-01-10\. The file cannot be archived before that date/);
    // On the report date itself it can.
    await as(partner, (tx) => archiveEngagement(tx, partner, future, "Future Co", REPORT_DATE));

    const plain = await as(partner, async (tx) => repo.createEngagement(tx, partner, await repo.createClient(tx, partner, "Not Audited Co"), "2025-01-01", "2025-12-31"));
    await lock(plain);
    await expect(as(partner, (tx) => archiveEngagement(tx, partner, plain, "Not Audited Co", TODAY))).rejects.toThrow(/audited files/);

    for (const id of [open, none, undated, plain]) expect((await row(id)).archived_at, id).toBeNull();
  });

  it("is refused without the client's name typed exactly, checked on the server", async () => {
    const id = await newEngagement("Confirm Co LLC");
    await lock(id);
    for (const typed of ["", "Confirm Co", "Confirm Co LLC.", "yes", "Confirm Co  LLC"]) {
      await expect(as(partner, (tx) => archiveEngagement(tx, partner, id, typed, TODAY))).rejects.toThrow(/does not match the client's name/);
    }
    expect((await row(id)).archived_at).toBeNull();
  });

  it("succeeds for a partner with the name typed in any case, sets who and when, and logs it with the deadline state", async () => {
    const id = await newEngagement("Success Co LLC");
    await lock(id);
    await as(partner, (tx) => archiveEngagement(tx, partner, id, "  success co llc ", "2026-03-12"));
    const r = await row(id);
    expect(r.status).toBe("locked");
    expect(r.archived_at).not.toBeNull();
    expect(r.archived_by).toBe(partner.userId);
    const e = await as(prep, (tx) => repo.getEngagement(tx, id));
    expect(e).toMatchObject({ status: "locked", archivedByName: "partner user" });
    expect(e!.archivedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const log = (await db.query<{ user_id: string; detail: Record<string, unknown> }>("select user_id, detail from audit_log where action = 'archive' and entity_id = $1", [id])).rows;
    // Report dated 2026-01-10: the deadline is 2026-03-11, so on 2026-03-12 the file is one day overdue.
    expect(log).toEqual([{ user_id: partner.userId, detail: { reportDate: REPORT_DATE, deadline: "2026-03-11", deadlineState: "overdue", days: 1 } }]);
    const overview = (await as(prep, (tx) => review.getOverview(tx, id)))!;
    expect(overview).toMatchObject({ archivedByName: "partner user", audited: true, hasOpinion: true, reportDate: REPORT_DATE });
  });

  it("succeeds for an administrator, and not twice", async () => {
    const id = await newEngagement("Admin Co LLC");
    await lock(id);
    await as(admin, (tx) => archiveEngagement(tx, admin, id, "Admin Co LLC", TODAY));
    await expect(as(partner, (tx) => archiveEngagement(tx, partner, id, "Admin Co LLC", TODAY))).rejects.toThrow("This file is already archived.");
    expect((await row(id)).archived_by).toBe(admin.userId);
  });
});

describe("after a file is archived", () => {
  let id: string;
  let accountId: string;
  beforeAll(async () => {
    id = await newEngagement("Frozen Co LLC");
    accountId = (await as(partner, (tx) => repo.listAccounts(tx, id)))[0].id;
    await lock(id);
    await as(partner, (tx) => archiveEngagement(tx, partner, id, "Frozen Co LLC", TODAY));
  });

  it("refuses to unlock it, with a plain sentence, whoever asks", async () => {
    for (const s of [partner, admin]) await expect(as(s, (tx) => review.unlockEngagement(tx, s, id, "We need to change it"))).rejects.toThrow("This file is archived. Archived files cannot be unlocked.");
    expect((await row(id)).status).toBe("locked");
  });

  it("refuses every write path, because an archived file is locked", async () => {
    const locked = /locked/;
    const calls: [string, () => Promise<unknown>][] = [
      ["import a trial balance", () => as(partner, (tx) => repo.importTrialBalance(tx, partner, id, "tb.xlsx", TB))],
      ["change a mapping", () => as(partner, (tx) => repo.setMapping(tx, partner, accountId, "CASH"))],
      ["approve mappings", () => as(partner, (tx) => repo.approveAllMappings(tx, partner, id))],
      ["set the borrowings split", () => as(partner, (tx) => repo.setBorrowingsCurrent(tx, partner, id, 1, 1))],
      ["post a journal", () => as(partner, (tx) => journals.createJournal(tx, partner, id, { type: "adjusting", description: "Accrual", lines: [] }))],
      ["turn the audit off", () => as(partner, (tx) => audit.setAuditEnabled(tx, partner, id, false))],
      ["set materiality", () => as(partner, (tx) => audit.setMateriality(tx, partner, id, { benchmark: "revenue", percentageBp: 100, performancePct: 75, trivialPct: 5, rationale: "Revenue is what the owners watch." }))],
      ["record a misstatement", () => as(partner, (tx) => audit.addMisstatement(tx, partner, id, { description: "Cut-off error", kind: "factual", amountMinor: 100 }))],
      ["assess risk", () => as(partner, (tx) => audit.setAreaRisks(tx, partner, id, "C5", {}))],
      ["approve the risk assessment", () => as(partner, (tx) => audit.approveRiskAssessment(tx, partner, id))],
      ["add a confirmation", () => as(partner, (tx) => confirmations.addConfirmation(tx, partner, id, { kind: "bank", partyName: "A Bank" }))],
      ["add a client request", () => as(partner, (tx) => requests.addRequest(tx, partner, id, { description: "Bank statements for December" }))],
      ["create a test schedule", () => as(partner, (tx) => schedules.createSchedule(tx, partner, id, { areaCode: "C5", title: "Receivables", groupCode: "TRADEREC" } as never))],
      ["explain a movement", () => as(partner, (tx) => analytics.saveExplanation(tx, partner, id, "sci:REVENUE", "Sales grew because of a new contract."))],
      ["import a journal listing", () => as(partner, (tx) => ledger.importLedger(tx, partner, id, "gl.xlsx", []))],
      ["select a journal for testing", () => as(partner, (tx) => ledger.selectForTesting(tx, partner, id, "J1"))],
      ["add a working paper", () => as(partner, (tx) => papers.addWorkingPaper(tx, partner, store, id, { targetKind: "engagement", target: null, fileName: "a.pdf", data: new Uint8Array([1]), description: "" }))],
      ["begin a direct upload", () => beginDirectUpload(db, partner, { inspect: async () => null, remove: async () => undefined }, { engagementId: id, targetKind: "engagement", target: null, fileName: "a.pdf", sizeBytes: 5, description: "" })],
      ["add a review point", () => as(partner, (tx) => review.addReviewPoint(tx, partner, id, review.GENERAL, "A question about the file"))],
      ["sign off a lead sheet", () => as(partner, (tx) => review.signOff(tx, partner, id, "CASH", "preparer"))],
      ["withdraw a sign-off", () => as(partner, (tx) => review.withdrawSignOff(tx, partner, id, "CASH", "preparer"))],
      ["lock it again", () => as(partner, (tx) => review.lockEngagement(tx, partner, id))],
      ["change the opinion", () => as(partner, (tx) => recordOpinion(tx, partner, id, { ...opinion, reportDate: "2026-01-11" }))],
      ["clear the opinion", () => as(partner, (tx) => clearOpinion(tx, partner, id))],
    ];
    for (const [what, call] of calls) await expect(call(), what).rejects.toThrow(locked);
    expect((await db.query("select 1 from audit_opinions where engagement_id = $1", [id])).rows).toHaveLength(1);
  });

  it("still lets the file be read, and its letters and report be downloaded, each logged", async () => {
    expect((await as(prep, (tx) => repo.getEngagement(tx, id)))?.archivedAt).not.toBeNull();
    const letter = await as(prep, (tx) => generateLetter(tx, prep, id, "engagement", {}));
    expect(letter?.blocks.length).toBeGreaterThan(5);
    const report = await as(prep, (tx) => generateReport(tx, prep, id, {}));
    expect(report.kind).toBe("ok");
    expect((await db.query("select 1 from audit_log where action = 'download_report' and entity_id = $1", [id])).rows).toHaveLength(1);
    expect((await db.query("select 1 from audit_log where action = 'export' and entity_id = $1", [id])).rows.length).toBeGreaterThan(0);
  });
});

describe("another firm", () => {
  it("cannot see or archive this firm's files", async () => {
    const id = await newEngagement("Private Co LLC");
    await lock(id);
    expect(await as(outsider, (tx) => repo.getEngagement(tx, id))).toBeNull();
    await expect(as(outsider, (tx) => archiveEngagement(tx, outsider, id, "Private Co LLC", TODAY))).rejects.toThrow(/Engagement not found/);
  });
});
