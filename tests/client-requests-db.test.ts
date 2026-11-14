import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import type { PGlite } from "@electric-sql/pglite";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import * as papers from "../src/server/working-papers";
import * as requests from "../src/server/client-requests";
import { exportRequests } from "../src/server/client-request-export";
import { localFileStore } from "../src/server/file-store";
import { AREA_REQUESTS, GENERAL_REQUESTS } from "../src/domain/client-request-defaults";

// Invented figures, in fils. The 2025 trial balance has receivables and cash but no inventories or borrowings.
const TB_2024 = [
  { code: "1000", name: "Bank - current account", closingMinor: 60_000_000, priorMinor: null },
  { code: "3000", name: "Share capital", closingMinor: -60_000_000, priorMinor: null },
];
const TB_2025 = [
  { code: "1000", name: "Bank - current account", closingMinor: 70_000_000, priorMinor: null },
  { code: "1100", name: "Trade receivables", closingMinor: 24_000_000, priorMinor: null },
  { code: "3000", name: "Share capital", closingMinor: -94_000_000, priorMinor: null },
];
type T = Parameters<Parameters<typeof withFirm>[2]>[0];

describe("the client request list", () => {
  const FIRM = "aaaaaaaa-1717-4000-8000-000000000001";
  const OTHER = "bbbbbbbb-1717-4000-8000-000000000001";
  const user = (n: number, role: repo.Session["role"], firmId = FIRM): repo.Session => ({ firmId, userId: `${firmId.slice(0, 8)}-1717-4000-8000-00000000001${n}`, role });
  const prep = user(1, "preparer");
  const rev = user(2, "reviewer");
  const partner = user(3, "partner");
  const outsider = user(4, "partner", OTHER);
  const TODAY = "2025-06-15";
  let db: PGlite;
  let client: string;
  let e2024: string;
  let e2025: string;
  let plain: string; // an engagement with the audit never turned on
  const store = localFileStore(mkdtempSync(join(tmpdir(), "requests-")));
  const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
  const list = (engagement: string, s: repo.Session = prep) => as(s, (tx) => requests.listRequests(tx, engagement, TODAY));
  const add = (engagement: string, description: string, extra: { areaCode?: string; dueOn?: string; requestedOn?: string } = {}, s: repo.Session = prep) =>
    as(s, (tx) => requests.addRequest(tx, s, engagement, { description, ...extra }, TODAY));
  const makeEngagement = (clientId: string, start: string, end: string, tb: typeof TB_2025, auditOn: boolean) =>
    as(partner, async (tx) => {
      const id = await repo.createEngagement(tx, partner, clientId, start, end);
      await repo.importTrialBalance(tx, partner, id, "tb.xlsx", tb);
      await repo.approveAllMappings(tx, partner, id);
      if (auditOn) await audit.setAuditEnabled(tx, partner, id, true);
      return id;
    });
  const upload = (engagement: string, name: string) =>
    as(prep, (tx) => papers.addWorkingPaper(tx, prep, store, engagement, { targetKind: "engagement", target: null, fileName: name, data: new TextEncoder().encode(`%PDF ${name}`), description: "" }));

  beforeAll(async () => {
    db = await openDatabase();
    for (const firm of [FIRM, OTHER]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [firm]);
    for (const u of [prep, rev, partner, outsider]) {
      await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-1)}`, u.role]);
    }
    client = await as(partner, (tx) => repo.createClient(tx, partner, "Requests Co. (invented)"));
    e2024 = await makeEngagement(client, "2024-01-01", "2024-12-31", TB_2024, true);
    e2025 = await makeEngagement(client, "2025-01-01", "2025-12-31", TB_2025, true);
    const other = await as(partner, (tx) => repo.createClient(tx, partner, "Compilation Co. (invented)"));
    plain = await makeEngagement(other, "2025-01-01", "2025-12-31", TB_2025, false);
  });

  it("adds requests with running references, any role, on an engagement with the audit off", async () => {
    const a = await add(plain, "Bank statements for the year", { areaCode: "C6", dueOn: "2025-06-30" });
    const b = await add(plain, "  Signed   prior year accounts ", {}, rev);
    const rows = await list(plain);
    expect(rows.map((r) => r.reference)).toEqual(["R-1", "R-2"]);
    expect(rows[0]).toMatchObject({ id: a, areaCode: "C6", areaTitle: expect.stringContaining("Cash and bank"), status: "open", requestedOn: TODAY, dueOn: "2025-06-30", overdue: false, files: [] });
    expect(rows[1]).toMatchObject({ id: b, areaCode: null, areaTitle: "General", description: "Signed prior year accounts", dueOn: null });
    const log = await db.query("select action from audit_log where entity_id = $1", [a]);
    expect(log.rows.map((r) => (r as { action: string }).action)).toContain("client_request_add");
  });

  it("refuses an empty or over-long description, an unknown area, and bad dates", async () => {
    await expect(add(plain, "   ")).rejects.toThrow(/Describe/);
    await expect(add(plain, "x".repeat(501))).rejects.toThrow(/too long/);
    await expect(add(plain, "Something", { areaCode: "C99" })).rejects.toThrow(/audit areas/);
    await expect(add(plain, "Something", { dueOn: "2025-02-30" })).rejects.toThrow(/not a valid date/);
    await expect(add(plain, "Something", { dueOn: "2025-06-01" })).rejects.toThrow(/before the date the request was made/);
    expect(await list(plain)).toHaveLength(2);
  });

  it("marks received (default today, never in the future), reopens, and edits", async () => {
    const [first] = await list(plain);
    await expect(as(prep, (tx) => requests.markReceived(tx, prep, first.id, "2025-06-16", TODAY))).rejects.toThrow(/future/);
    await as(prep, (tx) => requests.markReceived(tx, prep, first.id, null, TODAY));
    expect((await list(plain))[0]).toMatchObject({ status: "received", receivedOn: TODAY });
    await expect(as(prep, (tx) => requests.markReceived(tx, prep, first.id, null, TODAY))).rejects.toThrow(/Only an open request/);
    await as(prep, (tx) => requests.reopenRequest(tx, prep, first.id));
    expect((await list(plain))[0]).toMatchObject({ status: "open", receivedOn: null });
    await expect(as(prep, (tx) => requests.reopenRequest(tx, prep, first.id))).rejects.toThrow(/already open/);
    await as(prep, (tx) => requests.markReceived(tx, prep, first.id, "2025-06-10", TODAY));
    expect((await list(plain))[0]).toMatchObject({ receivedOn: "2025-06-10" });
    await as(prep, (tx) => requests.reopenRequest(tx, prep, first.id));

    await as(prep, (tx) => requests.editRequest(tx, prep, first.id, { description: "Bank statements, all accounts, for the year", areaCode: "C6", dueOn: "2025-07-15", note: "Chase the finance manager" }));
    expect((await list(plain))[0]).toMatchObject({ description: "Bank statements, all accounts, for the year", dueOn: "2025-07-15", note: "Chase the finance manager" });
    await expect(as(prep, (tx) => requests.editRequest(tx, prep, first.id, { description: "x", dueOn: "2025-06-01" }))).rejects.toThrow(/before the date/);
    const log = await db.query("select action from audit_log where entity_id = $1 order by id", [first.id]);
    expect(log.rows.map((r) => (r as { action: string }).action)).toEqual(expect.arrayContaining(["client_request_received", "client_request_reopen", "client_request_edit"]));
  });

  it("needs a reason to mark a request not applicable, and keeps it when the note is edited", async () => {
    const id = await add(plain, "Inventory count sheets");
    await expect(as(prep, (tx) => requests.markNotApplicable(tx, prep, id, "  "))).rejects.toThrow(/why/);
    await as(prep, (tx) => requests.markNotApplicable(tx, prep, id, "The client holds no stock."));
    expect((await list(plain)).find((r) => r.id === id)).toMatchObject({ status: "not_applicable", note: "The client holds no stock." });
    await expect(as(prep, (tx) => requests.editRequest(tx, prep, id, { description: "Inventory count sheets", note: "" }))).rejects.toThrow(/needs the reason/);
    // The database holds the rule as well as the application.
    await expect(db.query("update client_requests set note = null where id = $1", [id])).rejects.toThrow();
    await as(prep, (tx) => requests.reopenRequest(tx, prep, id));
    expect((await list(plain)).find((r) => r.id === id)).toMatchObject({ status: "open", receivedOn: null });
  });

  it("shows an open request past its due date as overdue, and counts it", async () => {
    const id = await add(plain, "Payroll summary for May", { dueOn: "2025-06-15" });
    expect((await list(plain)).find((r) => r.id === id)!.overdue).toBe(false);
    const later = await as(prep, (tx) => requests.listRequests(tx, plain, "2025-06-16"));
    expect(later.find((r) => r.id === id)!.overdue).toBe(true);
    const counts = await as(prep, (tx) => requests.requestCounts(tx, plain, "2025-06-16"));
    expect(counts.overall.overdue).toBeGreaterThanOrEqual(1);
    expect(counts.overall.open).toBeGreaterThanOrEqual(counts.overall.overdue);
    expect(counts.byArea.get("general")).toBeDefined();
  });

  it("links files from the engagement's working papers, and keeps them from being removed while linked", async () => {
    const id = await add(plain, "March bank statement", { areaCode: "C6" });
    const file = await upload(plain, "march-statement.pdf");
    const elsewhere = await upload(e2025, "other-engagement.pdf");
    await expect(as(prep, (tx) => requests.linkFile(tx, prep, id, elsewhere))).rejects.toThrow(/not on this engagement/);
    await as(prep, (tx) => requests.linkFile(tx, prep, id, file));
    await expect(as(prep, (tx) => requests.linkFile(tx, prep, id, file))).rejects.toThrow(/already linked/);
    expect((await list(plain)).find((r) => r.id === id)!.files).toEqual([expect.objectContaining({ id: file, fileName: "march-statement.pdf" })]);
    await expect(as(prep, (tx) => papers.removeWorkingPaper(tx, prep, file))).rejects.toThrow(/linked to a client request/);
    await as(prep, (tx) => requests.unlinkFile(tx, prep, id, file));
    await expect(as(prep, (tx) => requests.unlinkFile(tx, prep, id, file))).rejects.toThrow(/not linked/);
    await as(prep, (tx) => papers.removeWorkingPaper(tx, prep, file));
  });

  it("deletes a request only while it is open with no files linked", async () => {
    const withFile = await add(plain, "Lease agreement", { areaCode: "C9" });
    const file = await upload(plain, "lease.pdf");
    await as(prep, (tx) => requests.linkFile(tx, prep, withFile, file));
    await expect(as(prep, (tx) => requests.deleteRequest(tx, prep, withFile))).rejects.toThrow(/files linked/);
    await as(prep, (tx) => requests.markReceived(tx, prep, withFile, null, TODAY));
    await expect(as(prep, (tx) => requests.deleteRequest(tx, prep, withFile))).rejects.toThrow(/Only an open request/);
    await as(prep, (tx) => requests.reopenRequest(tx, prep, withFile));
    await as(prep, (tx) => requests.unlinkFile(tx, prep, withFile, file));
    await as(prep, (tx) => requests.deleteRequest(tx, prep, withFile));
    expect((await list(plain)).some((r) => r.id === withFile)).toBe(false);
    const log = await db.query("select detail from audit_log where entity_id = $1 and action = 'client_request_delete'", [withFile]);
    expect(log.rows).toHaveLength(1);
  });

  it("refuses every change while the engagement is locked, and allows them again once it is open", async () => {
    const id = await add(plain, "Insurance schedule");
    const file = await upload(plain, "insurance.pdf");
    await db.query("update engagements set status = 'locked' where id = $1", [plain]);
    const locked = /locked/;
    await expect(add(plain, "Another")).rejects.toThrow(locked);
    await expect(as(prep, (tx) => requests.editRequest(tx, prep, id, { description: "Edited" }))).rejects.toThrow(locked);
    await expect(as(prep, (tx) => requests.markReceived(tx, prep, id, null, TODAY))).rejects.toThrow(locked);
    await expect(as(prep, (tx) => requests.markNotApplicable(tx, prep, id, "no"))).rejects.toThrow(locked);
    await expect(as(prep, (tx) => requests.reopenRequest(tx, prep, id))).rejects.toThrow(locked);
    await expect(as(prep, (tx) => requests.deleteRequest(tx, prep, id))).rejects.toThrow(locked);
    await expect(as(prep, (tx) => requests.linkFile(tx, prep, id, file))).rejects.toThrow(locked);
    await expect(as(prep, (tx) => requests.addStandardRequests(tx, prep, plain, TODAY))).rejects.toThrow(locked);
    await expect(as(prep, (tx) => requests.bringForwardRequests(tx, prep, plain, TODAY))).rejects.toThrow(locked);
    // It can still be read and exported.
    expect((await list(plain)).some((r) => r.id === id)).toBe(true);
    expect(await as(prep, (tx) => exportRequests(tx, prep, plain, TODAY))).not.toBeNull();
    await db.query("update engagements set status = 'open' where id = $1", [plain]);
    await as(prep, (tx) => requests.editRequest(tx, prep, id, { description: "Insurance schedule, all policies" }));
  });

  it("keeps one firm's requests from another firm", async () => {
    const id = (await list(plain))[0].id;
    expect(await list(plain, outsider)).toEqual([]);
    await expect(as(outsider, (tx) => requests.addRequest(tx, outsider, plain, { description: "Sneaky" }, TODAY))).rejects.toThrow(/Engagement not found/);
    await expect(as(outsider, (tx) => requests.markReceived(tx, outsider, id, null, TODAY))).rejects.toThrow(/Request not found/);
    await expect(as(outsider, (tx) => requests.deleteRequest(tx, outsider, id))).rejects.toThrow(/Request not found/);
    expect(await as(outsider, (tx) => exportRequests(tx, outsider, plain, TODAY))).toBeNull();
    expect((await as(outsider, (tx) => requests.requestCounts(tx, plain, TODAY))).overall.total).toBe(0);
  });

  it("adds the standard requests for the areas in scope, once, and skips wording already there", async () => {
    // Someone already typed one of the standard requests, with different case and spacing.
    const typed = AREA_REQUESTS.find((r) => r.areaCode === "C6")!;
    await add(e2025, typed.description.toUpperCase().replace(/ /g, "  "), { areaCode: "C6" });
    const first = await as(prep, (tx) => requests.addStandardRequests(tx, prep, e2025, TODAY));
    const rows = await list(e2025);
    const areas = new Set(rows.map((r) => r.areaCode));
    // Receivables and cash are on the trial balance; inventories, borrowings and the rest are not.
    expect(areas.has("C5")).toBe(true);
    expect(areas.has("C6")).toBe(true);
    expect(areas.has("C4")).toBe(false);
    expect(areas.has("C9")).toBe(false);
    expect(areas.has(null)).toBe(true);
    for (const g of GENERAL_REQUESTS) expect(rows.some((r) => r.description === g.description)).toBe(true);
    expect(first.skipped).toBe(1);
    expect(first.added).toBe(rows.length - 1);
    expect(rows.filter((r) => r.areaCode === "C6" && r.description.toLowerCase().replace(/\s+/g, " ") === typed.description.toLowerCase())).toHaveLength(1);
    // Pressed again, it adds nothing.
    expect(await as(prep, (tx) => requests.addStandardRequests(tx, prep, e2025, TODAY))).toEqual({ added: 0, skipped: first.added + 1 });
    expect(await list(e2025)).toHaveLength(rows.length);
    // References stay unique and in step.
    expect(rows.map((r) => r.reference)).toEqual(rows.map((_, i) => `R-${i + 1}`));
  });

  it("adds the standard requests on an engagement with the audit off, by the balances on the trial balance", async () => {
    const result = await as(prep, (tx) => requests.addStandardRequests(tx, prep, plain, TODAY));
    expect(result.added).toBeGreaterThan(0);
    const rows = await list(plain);
    expect(rows.some((r) => r.areaCode === "C5")).toBe(true);
    expect(rows.some((r) => r.areaCode === "C4")).toBe(false);
  });

  it("brings forward last year's requests once, as open requests dated today, and skips what is already there", async () => {
    await add(e2024, "Bank statements for 2024", { areaCode: "C6", dueOn: "2025-07-31" });
    const second = await add(e2024, "Share register", { areaCode: "C12" });
    await as(prep, (tx) => requests.markReceived(tx, prep, second, "2025-01-20", "2025-02-01"));
    await add(e2024, "Trade licence, current and valid for the whole period"); // wording also in this year's standard list
    expect(await list(e2024)).toHaveLength(3);

    const result = await as(prep, (tx) => requests.bringForwardRequests(tx, prep, e2025, TODAY));
    // The trade licence wording is already on this year's list from the standard requests.
    expect(result).toEqual({ created: 2, skipped: 1 });
    const brought = (await list(e2025)).filter((r) => ["Bank statements for 2024", "Share register"].includes(r.description));
    expect(brought).toHaveLength(2);
    for (const r of brought) expect(r).toMatchObject({ status: "open", receivedOn: null, requestedOn: TODAY, dueOn: null, note: null, files: [] });
    expect(brought.find((r) => r.description === "Share register")!.areaCode).toBe("C12");
    // Again: nothing is brought twice, even if the copy is renamed.
    await as(prep, (tx) => requests.editRequest(tx, prep, brought[0].id, { description: "Renamed this year" }));
    expect(await as(prep, (tx) => requests.bringForwardRequests(tx, prep, e2025, TODAY))).toEqual({ created: 0, skipped: 3 });
    const log = await db.query("select detail from audit_log where entity_id = $1 and action = 'client_request_rollforward'", [e2025]);
    expect(log.rows).toHaveLength(2);
  });

  it("refuses to bring forward with no prior year, or a prior year for a different client", async () => {
    await expect(as(prep, (tx) => requests.bringForwardRequests(tx, prep, e2024, TODAY))).rejects.toThrow(/not linked to a prior year/);
    await db.query("update engagements set prior_engagement_id = $2 where id = $1", [e2025, plain]);
    await expect(as(prep, (tx) => requests.bringForwardRequests(tx, prep, e2025, TODAY))).rejects.toThrow(/not for the same client/);
    await db.query("update engagements set prior_engagement_id = $2 where id = $1", [e2025, e2024]);
  });

  it("exports the list for the client without internal notes, safely, and logs the download", async () => {
    const e = await as(partner, async (tx) => {
      const c = await repo.createClient(tx, partner, "Export / Requests (invented)");
      return repo.createEngagement(tx, partner, c, "2025-01-01", "2025-12-31");
    });
    const open = await add(e, '=HYPERLINK("http://invalid.example","click")', { areaCode: "C6", requestedOn: "2025-05-01", dueOn: "2025-06-01" });
    const done = await add(e, "+1 Signed accounts");
    await as(prep, (tx) => requests.editRequest(tx, prep, open, { description: '=HYPERLINK("http://invalid.example","click")', areaCode: "C6", dueOn: "2025-06-01", note: "INTERNAL: the owner is slow to reply" }));
    const file = await upload(e, "accounts-2024.pdf");
    await as(prep, (tx) => requests.linkFile(tx, prep, done, file));
    await as(prep, (tx) => requests.markReceived(tx, prep, done, "2025-06-10", TODAY));

    const out = (await as(prep, (tx) => exportRequests(tx, prep, e, TODAY)))!;
    expect(out.fileName).toBe("Export-Requests-invented-client-requests-2025-12-31.xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out.buffer as unknown as ArrayBuffer);
    const sheet = wb.getWorksheet("Requests")!;
    const text = (r: number, c: number) => String(sheet.getRow(r).getCell(c).value ?? "");
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((c) => text(4, c))).toEqual(["Reference", "Area", "Description", "Requested on", "Due", "Status", "Received on", "Files received"]);
    expect(text(1, 1)).toContain("Export / Requests (invented)");
    expect([text(5, 1), text(5, 2), text(5, 5), text(5, 6), text(5, 7), text(5, 8)]).toEqual(["R-1", "C6 Cash and bank", "2025-06-01", "Open (overdue)", "", ""]);
    expect([text(6, 1), text(6, 3), text(6, 4), text(6, 6), text(6, 7), text(6, 8)]).toEqual(["R-2", "+1 Signed accounts", TODAY, "Received", "2025-06-10", "accounts-2024.pdf"]);
    // Text that looks like a formula is stored as text, and the internal note is nowhere in the file.
    const cell = sheet.getRow(5).getCell(3);
    expect(cell.value).toBe('=HYPERLINK("http://invalid.example","click")');
    expect(cell.numFmt).toBe("@");
    expect(JSON.stringify(sheet.getRows(1, 10)?.map((r) => r.values))).not.toContain("INTERNAL");
    const log = await db.query("select detail from audit_log where entity = 'client_requests' and entity_id = $1 and action = 'export'", [e]);
    expect(log.rows).toHaveLength(1);
  });
});
