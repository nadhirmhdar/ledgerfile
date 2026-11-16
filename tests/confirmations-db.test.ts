import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import type { PGlite } from "@electric-sql/pglite";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import * as review from "../src/server/review";
import * as papers from "../src/server/working-papers";
import * as conf from "../src/server/confirmations";
import { exportConfirmations } from "../src/server/confirmation-export";
import { localFileStore } from "../src/server/file-store";

// Invented figures, in fils.
const TB = [
  { code: "1000", name: "Bank - current account", closingMinor: 70_000_000, priorMinor: 60_000_000 },
  { code: "1100", name: "Trade receivables", closingMinor: 24_000_000, priorMinor: 20_000_000 },
  { code: "3000", name: "Share capital", closingMinor: -94_000_000, priorMinor: -80_000_000 },
];
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const TODAY = "2025-06-15";

describe("external confirmations", () => {
  const FIRM = "aaaaaaaa-1919-4000-8000-000000000001";
  const OTHER = "bbbbbbbb-1919-4000-8000-000000000001";
  const user = (n: number, role: repo.Session["role"], firmId = FIRM): repo.Session => ({ firmId, userId: `${firmId.slice(0, 8)}-1919-4000-8000-00000000001${n}`, role });
  const prep = user(1, "preparer");
  const prep2 = user(5, "preparer");
  const rev = user(2, "reviewer");
  const partner = user(3, "partner");
  const outsider = user(4, "partner", OTHER);
  let db: PGlite;
  let e2024: string;
  let e2025: string;
  let plain: string; // audit never turned on
  let frozen: string; // audited, then locked directly
  let stranger: string; // another client's engagement
  const store = localFileStore(mkdtempSync(join(tmpdir(), "confirmations-")));
  const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
  const makeEngagement = (clientName: string, start: string, end: string, auditOn: boolean, clientId?: string) =>
    as(partner, async (tx) => {
      const client = clientId ?? (await repo.createClient(tx, partner, clientName));
      const id = await repo.createEngagement(tx, partner, client, start, end);
      await repo.importTrialBalance(tx, partner, id, "tb.xlsx", TB);
      await repo.approveAllMappings(tx, partner, id);
      if (auditOn) await audit.setAuditEnabled(tx, partner, id, true);
      return id;
    });
  const add = (engagement: string, party: string, extra: { kind?: string; areaCode?: string; bookMinor?: number; accountRef?: string } = {}, s: repo.Session = prep) =>
    as(s, (tx) => conf.addConfirmation(tx, s, engagement, { kind: extra.kind ?? "bank", areaCode: extra.areaCode, partyName: party, accountRef: extra.accountRef, bookMinor: extra.bookMinor ?? 0 }));
  const list = (engagement: string, s: repo.Session = prep) => as(s, (tx) => conf.listConfirmations(tx, engagement));
  const get = async (engagement: string, id: string) => (await list(engagement)).find((c) => c.id === id)!;
  const sent = (id: string, on = "2025-06-01", s: repo.Session = prep) => as(s, (tx) => conf.markSent(tx, s, id, on, TODAY));
  const reply = (id: string, input: Parameters<typeof conf.recordReply>[3], s: repo.Session = prep) => as(s, (tx) => conf.recordReply(tx, s, id, input, TODAY));
  const upload = (engagement: string, name: string) =>
    as(prep, (tx) => papers.addWorkingPaper(tx, prep, store, engagement, { targetKind: "engagement", target: null, fileName: name, data: new TextEncoder().encode(`%PDF ${name}`), description: "" }));
  const raw = (engagement: string, columns: string, values: unknown[]) =>
    as(prep, (tx) =>
      tx.query(
        `insert into confirmations (firm_id, engagement_id, seq, reference, kind, area_code, party_name, created_by, ${columns.split(",")[0]}${columns.includes(",") ? "," + columns.split(",").slice(1).join(",") : ""})
         values ($1, $2, $3, $4, 'bank', 'C6', 'Direct Bank', $5, ${values.map((_, i) => `$${i + 6}`).join(", ")})`,
        [FIRM, engagement, 900 + Math.floor(Math.random() * 90000), `X-${Math.random()}`, prep.userId, ...values],
      ),
    );

  beforeAll(async () => {
    db = await openDatabase();
    for (const firm of [FIRM, OTHER]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [firm]);
    for (const u of [prep, prep2, rev, partner, outsider]) {
      await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-1)}`, u.role]);
    }
    const confirmedCo = await as(partner, (tx) => repo.createClient(tx, partner, "Confirmed Co. (invented)"));
    e2024 = await makeEngagement("", "2024-01-01", "2024-12-31", true, confirmedCo);
    e2025 = await makeEngagement("", "2025-01-01", "2025-12-31", true, confirmedCo);
    plain = await makeEngagement("Compiled Co. (invented)", "2025-01-01", "2025-12-31", false);
    frozen = await makeEngagement("Frozen Co. (invented)", "2025-01-01", "2025-12-31", true);
    stranger = await makeEngagement("Another Co. (invented)", "2025-01-01", "2025-12-31", true);
  });

  it("adds confirmations with running references and the usual area for the kind, for any role", async () => {
    const a = await add(e2024, "First Bank", { accountRef: "AC-1", bookMinor: 70_000_000 });
    const b = await add(e2024, "Acme Customer", { kind: "receivable", bookMinor: 5_000_000 }, rev);
    const c = await add(e2024, "Gulf Supplies", { kind: "payable" });
    const d = await add(e2024, "Sister Ltd", { kind: "related_party" });
    const e = await add(e2024, "Counsel LLP", { kind: "legal" });
    const f = await add(e2024, "Stock Check Agent", { kind: "other", areaCode: "C4" });
    await expect(add(e2024, "No Area", { kind: "other" })).rejects.toThrow(/Choose the audit area/);
    await expect(add(e2024, "Bad Area", { areaCode: "C99" })).rejects.toThrow(/Choose one of/);
    await expect(add(e2024, "  ")).rejects.toThrow(/Enter who/);
    await expect(add(e2024, "Bad Kind", { kind: "friend" })).rejects.toThrow(/kind/);
    const rows = await list(e2024);
    expect(rows.map((r) => [r.reference, r.areaCode])).toEqual([["CF-6", "C4"], ["CF-2", "C5"], ["CF-1", "C6"], ["CF-4", "C7"], ["CF-3", "C8"], ["CF-5", "C10"]]); // area order, then reference
    expect(rows.find((r) => r.id === a)).toMatchObject({ partyName: "First Bank", accountRef: "AC-1", bookMinor: 70_000_000, state: "not_sent", differenceMinor: null, files: [] });
    expect([b, c, d, e, f].every(Boolean)).toBe(true);
    const log = await db.query("select action from audit_log where entity_id = $1", [a]);
    expect(log.rows.map((r) => (r as { action: string }).action)).toContain("confirmation_add");
  });

  it("is refused by the database when the reply fields do not fit together, even if the application is bypassed", async () => {
    const e = e2025;
    await expect(raw(e, "replied_on", ["2025-06-02"])).rejects.toThrow(); // a reply date with no reply
    await expect(raw(e, "confirmed_balance_minor", [5])).rejects.toThrow(); // an amount with no reply
    await expect(raw(e, "reply_note", ["something"])).rejects.toThrow(); // a note with no reply
    await expect(raw(e, "reply", ["agreed"])).rejects.toThrow(); // a reply that was never sent
    await expect(raw(e, "sent_on, reply", ["2025-06-01", "agreed"])).rejects.toThrow(); // agreed without a date or amount
    await expect(raw(e, "sent_on, reply, replied_on, confirmed_balance_minor, book_balance_minor", ["2025-06-01", "agreed", "2025-06-02", 5, 6])).rejects.toThrow(); // agreed but unequal
    await expect(raw(e, "sent_on, reply, replied_on, confirmed_balance_minor, book_balance_minor", ["2025-06-01", "differs", "2025-06-02", 5, 5])).rejects.toThrow(); // differs but equal
    await expect(raw(e, "sent_on, reply, confirmed_balance_minor", ["2025-06-01", "no_reply", 5])).rejects.toThrow(); // no reply with an amount
    await expect(raw(e, "sent_on, replied_on, reply", ["2025-06-05", "2025-06-01", "agreed"])).rejects.toThrow(); // replied before sent
    await expect(raw(e, "prepared_by, prepared_at", [prep.userId, "2025-06-01"])).rejects.toThrow(); // prepared with no reply
    await expect(raw(e, "reviewed_by, reviewed_at", [rev.userId, "2025-06-01"])).rejects.toThrow(); // reviewed but never prepared
    await expect(raw(e, "prepared_by", [prep.userId])).rejects.toThrow(); // half a pair
    // The same shapes done correctly are accepted.
    await raw(e, "sent_on, reply, replied_on, confirmed_balance_minor, book_balance_minor", ["2025-06-01", "agreed", "2025-06-02", 5, 5]);
    await raw(e, "sent_on, reply, replied_on, confirmed_balance_minor, book_balance_minor", ["2025-06-01", "differs", "2025-06-02", 4, 5]);
    await raw(e, "sent_on, reply", ["2025-06-01", "no_reply"]);
    await as(prep, (tx) => tx.query("delete from confirmations where engagement_id = $1", [e]));
  });

  it("holds the sent date and reminder rules", async () => {
    const id = await add(e2025, "Rules Bank", { bookMinor: 1_000 });
    await expect(as(prep, (tx) => conf.addReminder(tx, prep, id, "2025-06-02", TODAY))).rejects.toThrow(/sent before/);
    await expect(reply(id, { reply: "agreed" })).rejects.toThrow(/sent before/);
    await expect(sent(id, "2025-06-16")).rejects.toThrow(/future/);
    await sent(id, "2025-06-01");
    await as(prep, (tx) => conf.addReminder(tx, prep, id, "2025-06-05", TODAY));
    await expect(as(prep, (tx) => conf.addReminder(tx, prep, id, "2025-05-30", TODAY))).rejects.toThrow(/before the date sent/);
    await expect(as(prep, (tx) => conf.addReminder(tx, prep, id, "2025-06-05", TODAY))).rejects.toThrow(/already a reminder/);
    await expect(sent(id, "2025-06-10")).rejects.toThrow(/reminder is dated/);
    await expect(as(prep, (tx) => conf.clearSent(tx, prep, id))).rejects.toThrow(/Remove the reminders/);
    await as(prep, (tx) => conf.removeReminder(tx, prep, id, "2025-06-05"));
    for (const d of ["2025-06-02", "2025-06-03", "2025-06-04", "2025-06-05", "2025-06-06"]) await as(prep, (tx) => conf.addReminder(tx, prep, id, d, TODAY));
    await expect(as(prep, (tx) => conf.addReminder(tx, prep, id, "2025-06-07", TODAY))).rejects.toThrow(/at most 5/);
    expect((await get(e2025, id)).reminders).toEqual(["2025-06-02", "2025-06-03", "2025-06-04", "2025-06-05", "2025-06-06"]);
    for (const d of ["2025-06-02", "2025-06-03", "2025-06-04", "2025-06-05", "2025-06-06"]) await as(prep, (tx) => conf.removeReminder(tx, prep, id, d));
    await reply(id, { reply: "agreed", repliedOn: "2025-06-03" });
    await expect(sent(id, "2025-06-04")).rejects.toThrow(/reply is dated/);
    await expect(as(prep, (tx) => conf.clearSent(tx, prep, id))).rejects.toThrow(/Clear the reply/);
    await as(prep, (tx) => conf.clearReply(tx, prep, id));
    await as(prep, (tx) => conf.clearSent(tx, prep, id));
    expect((await get(e2025, id)).sentOn).toBeNull();
    await as(prep, (tx) => conf.deleteConfirmation(tx, prep, id));
  });

  it("records agreed, differs and no reply, and keeps a reply and the book balance consistent", async () => {
    const id = await add(e2025, "Reply Bank", { bookMinor: 10_000 });
    await sent(id);
    await reply(id, { reply: "agreed", repliedOn: "2025-06-03", replyNote: "Charge over the deposit noted." });
    expect(await get(e2025, id)).toMatchObject({ reply: "agreed", repliedOn: "2025-06-03", confirmedMinor: 10_000, differenceMinor: 0, replyNote: "Charge over the deposit noted.", state: "to_prepare" });
    // An agreed reply can never misreport a changed balance.
    await expect(as(prep, (tx) => conf.editConfirmation(tx, prep, id, { kind: "bank", partyName: "Reply Bank", bookMinor: 20_000 }))).rejects.toThrow(/Clear the reply first/);
    await as(prep, (tx) => conf.editConfirmation(tx, prep, id, { kind: "bank", partyName: "Reply Bank Ltd", bookMinor: 10_000 })); // other fields still change
    await expect(reply(id, { reply: "differs", confirmedMinor: 10_000 })).rejects.toThrow(/Record the reply as agreed/);
    await expect(reply(id, { reply: "differs" })).rejects.toThrow(/Enter the amount/);
    await expect(reply(id, { reply: "agreed", repliedOn: "2025-05-01" })).rejects.toThrow(/before the date sent/);
    await reply(id, { reply: "differs", repliedOn: "2025-06-04", confirmedMinor: 9_000 });
    expect(await get(e2025, id)).toMatchObject({ reply: "differs", confirmedMinor: 9_000, differenceMinor: 1_000 });
    await expect(as(prep, (tx) => conf.saveAlternativeProcedures(tx, prep, id, "x"))).rejects.toThrow(/no reply came/);
    await as(prep, (tx) => conf.saveReconciliation(tx, prep, id, "Receipt of 1,000 in transit at year end."));
    await reply(id, { reply: "no_reply" });
    expect(await get(e2025, id)).toMatchObject({ reply: "no_reply", repliedOn: null, confirmedMinor: null, reconciliation: null, replyNote: null });
    await expect(as(prep, (tx) => conf.saveReconciliation(tx, prep, id, "x"))).rejects.toThrow(/differs/);
    await as(prep, (tx) => conf.saveAlternativeProcedures(tx, prep, id, "Agreed the balance to the bank statements."));
    await as(prep, (tx) => conf.clearReply(tx, prep, id));
    // Clear first, then the book balance may change.
    await as(prep, (tx) => conf.editConfirmation(tx, prep, id, { kind: "bank", partyName: "Reply Bank Ltd", bookMinor: 20_000 }));
    expect((await get(e2025, id)).bookMinor).toBe(20_000);
    await expect(as(prep, (tx) => conf.clearReply(tx, prep, id))).rejects.toThrow(/No reply/);
  });

  it("prepares, clears the preparation when the substance changes, and keeps contributors from reviewing", async () => {
    const id = await add(e2025, "Prep Bank", { bookMinor: 5_000 });
    await expect(as(prep, (tx) => conf.prepareConfirmation(tx, prep, id))).rejects.toThrow(/sent first/);
    await sent(id);
    await expect(as(prep, (tx) => conf.prepareConfirmation(tx, prep, id))).rejects.toThrow(/reply first/);
    await reply(id, { reply: "differs", confirmedMinor: 4_000, repliedOn: "2025-06-02" });
    await expect(as(prep, (tx) => conf.prepareConfirmation(tx, prep, id))).rejects.toThrow(/reconciled/);
    await as(prep2, (tx) => conf.saveReconciliation(tx, prep2, id, "Cheque of 1,000 not yet presented."));
    await as(prep, (tx) => conf.prepareConfirmation(tx, prep, id));
    expect(await get(e2025, id)).toMatchObject({ state: "prepared", preparedByName: "preparer 1" });
    await expect(as(prep, (tx) => conf.prepareConfirmation(tx, prep, id))).rejects.toThrow(/already prepared/);

    // A change after preparation clears it, and the changer becomes a contributor.
    await as(prep2, (tx) => conf.addReminder(tx, prep2, id, "2025-06-10", TODAY));
    expect(await get(e2025, id)).toMatchObject({ state: "to_prepare", preparedByName: null });
    const contributors = await db.query<{ contributors: string[] }>("select contributors from confirmations where id = $1", [id]);
    expect(contributors.rows[0].contributors.sort()).toEqual([prep.userId, prep2.userId].sort());
    await as(prep, (tx) => conf.prepareConfirmation(tx, prep, id));

    // A contributor or preparer cannot review when another reviewer exists; a preparer-role user cannot review at all.
    await expect(as(prep, (tx) => conf.reviewConfirmation(tx, prep, id))).rejects.toThrow(/Only a reviewer or partner/);
    await db.query("update users set role = 'reviewer' where id = $1", [prep2.userId]);
    await expect(as({ ...prep2, role: "reviewer" }, (tx) => conf.reviewConfirmation(tx, { ...prep2, role: "reviewer" }, id))).rejects.toThrow(/different person/);
    await db.query("update users set role = 'preparer' where id = $1", [prep2.userId]);
    await as(rev, (tx) => conf.reviewConfirmation(tx, rev, id));
    expect(await get(e2025, id)).toMatchObject({ state: "reviewed", reviewedByName: "reviewer 2", selfReviewed: false });
    await expect(as(rev, (tx) => conf.reviewConfirmation(tx, rev, id))).rejects.toThrow(/already been reviewed/);

    // Reviewed work refuses every change until the review is withdrawn, and only a reviewer or partner withdraws it.
    const refuse = /has been reviewed/;
    await expect(sent(id, "2025-05-30")).rejects.toThrow(refuse);
    await expect(as(prep, (tx) => conf.addReminder(tx, prep, id, "2025-06-11", TODAY))).rejects.toThrow(refuse);
    await expect(reply(id, { reply: "agreed" })).rejects.toThrow(refuse);
    await expect(as(prep, (tx) => conf.saveReconciliation(tx, prep, id, "changed"))).rejects.toThrow(refuse);
    await expect(as(prep, (tx) => conf.editConfirmation(tx, prep, id, { kind: "bank", partyName: "Other", bookMinor: 5_000 }))).rejects.toThrow(refuse);
    await expect(as(prep, (tx) => conf.deleteConfirmation(tx, prep, id))).rejects.toThrow(refuse);
    await expect(as(prep, (tx) => conf.unprepareConfirmation(tx, prep, id))).rejects.toThrow(refuse);
    await expect(as(prep, (tx) => conf.unreviewConfirmation(tx, prep, id))).rejects.toThrow(/Only a reviewer or partner/);
    await as(partner, (tx) => conf.unreviewConfirmation(tx, partner, id));
    await expect(as(partner, (tx) => conf.unreviewConfirmation(tx, partner, id))).rejects.toThrow(/not been reviewed/);
    expect((await get(e2025, id)).state).toBe("prepared");
    await as(prep, (tx) => conf.unprepareConfirmation(tx, prep, id));
    await expect(as(rev, (tx) => conf.reviewConfirmation(tx, rev, id))).rejects.toThrow(/must be prepared/);
  });

  it("deletes only what is not reviewed and has no files, and only a reviewer once a reply is in", async () => {
    const a = await add(e2025, "Delete Bank");
    const b = await add(e2025, "Replied Bank");
    await sent(b);
    await reply(b, { reply: "no_reply" });
    await expect(as(prep, (tx) => conf.deleteConfirmation(tx, prep, b))).rejects.toThrow(/Only a reviewer or partner can delete/);
    const file = await upload(e2025, "reply.pdf");
    await as(prep, (tx) => conf.linkFile(tx, prep, a, file));
    await expect(as(prep, (tx) => conf.deleteConfirmation(tx, prep, a))).rejects.toThrow(/files linked/);
    await expect(as(prep, (tx) => papers.removeWorkingPaper(tx, prep, file))).rejects.toThrow(/linked to a confirmation/);
    await expect(as(prep, (tx) => conf.linkFile(tx, prep, a, file))).rejects.toThrow(/already linked/);
    await as(prep, (tx) => conf.unlinkFile(tx, prep, a, file));
    await expect(as(prep, (tx) => conf.unlinkFile(tx, prep, a, file))).rejects.toThrow(/not linked/);
    await as(prep, (tx) => conf.deleteConfirmation(tx, prep, a));
    await as(rev, (tx) => conf.deleteConfirmation(tx, rev, b));
    const gone = await list(e2025);
    expect(gone.some((c) => c.id === a || c.id === b)).toBe(false);
    const log = await db.query<{ detail: { partyName: string; reference: string } }>("select detail from audit_log where entity_id = $1 and action = 'confirmation_delete'", [b]);
    expect(log.rows[0].detail).toMatchObject({ partyName: "Replied Bank" });
    await as(prep, (tx) => papers.removeWorkingPaper(tx, prep, file)); // unlinked, so it can go now
  });

  it("links only files from the same engagement, in the application and in the database", async () => {
    const id = await add(e2025, "Link Bank");
    const mine = await upload(e2025, "mine.pdf");
    const theirs = await upload(e2024, "theirs.pdf");
    await expect(as(prep, (tx) => conf.linkFile(tx, prep, id, theirs))).rejects.toThrow(/not on this engagement/);
    // The application check bypassed: the composite key still refuses another engagement's paper.
    await expect(as(prep, (tx) => tx.query("insert into confirmation_files (firm_id, engagement_id, confirmation_id, working_paper_id, linked_by) values ($1, $2, $3, $4, $5)", [FIRM, e2025, id, theirs, prep.userId]))).rejects.toThrow();
    await as(prep, (tx) => tx.query("insert into confirmation_files (firm_id, engagement_id, confirmation_id, working_paper_id, linked_by) values ($1, $2, $3, $4, $5)", [FIRM, e2025, id, mine, prep.userId]));
    expect((await get(e2025, id)).files.map((f) => f.fileName)).toEqual(["mine.pdf"]);
  });

  it("keeps one firm's confirmations out of reach of another", async () => {
    const id = await add(e2024, "Private Bank");
    expect(await list(e2024, outsider)).toEqual([]);
    expect((await as(outsider, (tx) => conf.confirmationSummary(tx, e2024))).overall.count).toBe(0);
    const msg = /not found/;
    await expect(as(outsider, (tx) => conf.editConfirmation(tx, outsider, id, { kind: "bank", partyName: "x", bookMinor: 0 }))).rejects.toThrow(msg);
    await expect(as(outsider, (tx) => conf.markSent(tx, outsider, id, "2025-06-01", TODAY))).rejects.toThrow(msg);
    await expect(as(outsider, (tx) => conf.linkFile(tx, outsider, id, id))).rejects.toThrow(msg);
    await expect(as(outsider, (tx) => conf.deleteConfirmation(tx, outsider, id))).rejects.toThrow(msg);
    await expect(as(outsider, (tx) => conf.reviewConfirmation(tx, outsider, id))).rejects.toThrow(msg);
    await expect(as(outsider, (tx) => conf.addConfirmation(tx, outsider, e2024, { kind: "bank", partyName: "Intruder" }))).rejects.toThrow(/Engagement not found/);
    expect(await as(outsider, (tx) => exportConfirmations(tx, outsider, e2024))).toBeNull();
    await expect(as(outsider, (tx) => conf.bringForwardConfirmations(tx, outsider, e2025))).rejects.toThrow(/Engagement not found|not linked/);
  });

  it("refuses every write when the audit is off or the engagement is locked, and does not let the audit be turned off once there are confirmations", async () => {
    await expect(add(plain, "Compiled Bank")).rejects.toThrow(/Turn the audit on/);
    const id = await add(frozen, "Frozen Bank", { bookMinor: 100 });
    const other = await add(frozen, "Frozen Bank Two");
    await sent(other);
    await reply(other, { reply: "no_reply" });
    await as(prep, (tx) => conf.saveAlternativeProcedures(tx, prep, other, "Agreed to statements."));
    await as(prep, (tx) => conf.prepareConfirmation(tx, prep, other));
    await as(rev, (tx) => conf.reviewConfirmation(tx, rev, other));
    await expect(as(rev, (tx) => audit.setAuditEnabled(tx, rev, frozen, false))).rejects.toThrow(/Work has been recorded/);
    // Locked directly, as the lock itself needs everything on the file finished.
    await db.query("update engagements set status = 'locked' where id = $1", [frozen]);
    const locked = /locked/;
    await expect(add(frozen, "Late Bank")).rejects.toThrow(locked);
    await expect(sent(id)).rejects.toThrow(locked);
    await expect(reply(id, { reply: "agreed" })).rejects.toThrow(locked);
    await expect(as(prep, (tx) => conf.editConfirmation(tx, prep, id, { kind: "bank", partyName: "x", bookMinor: 0 }))).rejects.toThrow(locked);
    await expect(as(prep, (tx) => conf.deleteConfirmation(tx, prep, id))).rejects.toThrow(locked);
    await expect(as(prep, (tx) => conf.linkFile(tx, prep, id, id))).rejects.toThrow(locked);
    await expect(as(prep, (tx) => conf.prepareConfirmation(tx, prep, id))).rejects.toThrow(locked);
    await expect(as(rev, (tx) => conf.reviewConfirmation(tx, rev, other))).rejects.toThrow(locked);
    await expect(as(rev, (tx) => conf.unreviewConfirmation(tx, rev, other))).rejects.toThrow(locked);
    await expect(as(prep, (tx) => conf.bringForwardConfirmations(tx, prep, frozen))).rejects.toThrow(locked);
    expect(await list(frozen)).toHaveLength(2); // still readable
    expect(await as(prep, (tx) => exportConfirmations(tx, prep, frozen, TODAY))).not.toBeNull();
    expect(await as(prep, (tx) => exportConfirmations(tx, prep, plain, TODAY))).toBeNull(); // the audit is off
  });

  it("holds up the lock until every confirmation is sent, answered, prepared and reviewed", async () => {
    const blockers = async () => (await as(prep, (tx) => audit.getAuditOverview(tx, stranger)))!.blockers.filter((b) => b.includes("confirmation"));
    expect(await blockers()).toEqual([]);
    const a = await add(stranger, "Blocker Bank");
    const b = await add(stranger, "Blocker Customer", { kind: "receivable" });
    expect(await blockers()).toEqual([
      "Audit: 2 confirmation(s) have not been sent. Send them, or delete those that will not be sent.",
      "Audit: 2 confirmation(s) have not been reviewed.",
    ]);
    await sent(a);
    await sent(b);
    expect((await blockers())[0]).toBe("Audit: 2 confirmation(s) are awaiting a reply.");
    await reply(a, { reply: "agreed" });
    await reply(b, { reply: "no_reply" });
    expect((await blockers())[0]).toBe("Audit: 2 confirmation(s) have a reply but are not prepared.");
    await as(prep, (tx) => conf.saveAlternativeProcedures(tx, prep, b, "Agreed to the cash receipts after year end."));
    await as(prep, (tx) => conf.prepareConfirmation(tx, prep, a));
    await as(prep, (tx) => conf.prepareConfirmation(tx, prep, b));
    expect(await blockers()).toEqual(["Audit: 2 confirmation(s) have not been reviewed."]);
    await as(rev, (tx) => conf.reviewConfirmation(tx, rev, a));
    expect(await blockers()).toEqual(["Audit: 1 confirmation(s) have not been reviewed."]);
    await expect(as(partner, (tx) => review.lockEngagement(tx, partner, stranger))).rejects.toThrow(/not ready to lock.*1 confirmation\(s\) have not been reviewed/);
    await as(rev, (tx) => conf.reviewConfirmation(tx, rev, b));
    expect(await blockers()).toEqual([]);
  });

  it("brings forward last year's confirmations once, only for the same client, with nothing but the party details", async () => {
    // e2024 has confirmations from the earlier tests; give one a full history.
    const prior = await list(e2024);
    const bank = prior.find((c) => c.partyName === "First Bank")!;
    await sent(bank.id);
    await reply(bank.id, { reply: "agreed", repliedOn: "2025-06-02" });
    await as(prep, (tx) => conf.addReminder(tx, prep, bank.id, "2025-06-03", TODAY));
    await as(prep, (tx) => conf.editConfirmation(tx, prep, bank.id, { kind: "bank", areaCode: "C6", partyName: "First Bank", contact: "treasury@firstbank.example", accountRef: "AC-1", bookMinor: 70_000_000 }));

    await add(e2025, "first bank ", { accountRef: "ac-1" }); // the same party and account is already here
    const result = await as(prep, (tx) => conf.bringForwardConfirmations(tx, prep, e2025));
    expect(result).toEqual({ created: prior.length - 1, skipped: 1 });
    const here = await list(e2025);
    const copy = here.find((c) => c.partyName === "Acme Customer")!;
    expect(copy).toMatchObject({ kind: "receivable", areaCode: "C5", bookMinor: 0, sentOn: null, reminders: [], reply: null, confirmedMinor: null, preparedByName: null, reviewedByName: null, state: "not_sent", files: [] });
    const source = await db.query<{ rolled: string; contact: string | null }>("select rolled_from_id as rolled, contact from confirmations where id = $1", [copy.id]);
    expect(source.rows[0].rolled).toBe(prior.find((c) => c.partyName === "Acme Customer")!.id);
    expect(here.filter((c) => c.partyName.toLowerCase().trim() === "first bank")).toHaveLength(1); // not duplicated
    // Idempotent.
    expect(await as(prep, (tx) => conf.bringForwardConfirmations(tx, prep, e2025))).toEqual({ created: 0, skipped: prior.length });
    // A prior engagement of another client is refused.
    await db.query("update engagements set prior_engagement_id = $2 where id = $1", [stranger, e2024]);
    await expect(as(prep, (tx) => conf.bringForwardConfirmations(tx, prep, stranger))).rejects.toThrow(/not for the same client/);
    await expect(as(prep, (tx) => conf.bringForwardConfirmations(tx, prep, e2024))).rejects.toThrow(/not linked to a prior year/);
  });

  it("exports every column as the workbook shows it, with text as text, and logs the export", async () => {
    const id = await add(e2025, "=SUM(A1) Bank", { bookMinor: 1_234_500 });
    await sent(id, "2025-06-01");
    await as(prep, (tx) => conf.addReminder(tx, prep, id, "2025-06-05", TODAY));
    await reply(id, { reply: "differs", repliedOn: "2025-06-08", confirmedMinor: 1_200_000, replyNote: "Guarantee of 50,000 noted." });
    await as(prep, (tx) => conf.saveReconciliation(tx, prep, id, "Deposit of 34,500 in transit."));
    const file = await upload(e2025, "bank-reply.pdf");
    await as(prep, (tx) => conf.linkFile(tx, prep, id, file));
    await as(prep, (tx) => conf.prepareConfirmation(tx, prep, id));

    const out = (await as(prep, (tx) => exportConfirmations(tx, prep, e2025, TODAY)))!;
    expect(out.fileName).toBe("Confirmed-Co-invented-confirmations-2025-12-31.xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out.buffer as unknown as ArrayBuffer);
    const sheet = wb.getWorksheet("Confirmations")!;
    expect(String(sheet.getRow(1).getCell(1).value)).toBe("External confirmations: Confirmed Co. (invented)");
    expect(String(sheet.getRow(2).getCell(1).value)).toContain("As at 2025-06-15");
    const head = Array.from({ length: 23 }, (_, i) => String(sheet.getRow(4).getCell(i + 1).value));
    expect(head.slice(0, 4)).toEqual(["Reference", "Area", "Kind", "Party"]);
    expect(head).toContain("Alternative procedures");
    let found: ExcelJS.Row | undefined;
    sheet.eachRow((row) => { if (row.getCell(4).value === "=SUM(A1) Bank") found = row; });
    const row = found!;
    expect(row.getCell(4).type).toBe(ExcelJS.ValueType.String);
    expect(row.getCell(4).numFmt).toBe("@");
    expect(row.getCell(7).value).toBe(12_345);
    expect(row.getCell(7).numFmt).toBe("#,##0.00;(#,##0.00);0.00");
    expect(row.getCell(9).value).toBe("2025-06-05");
    expect(row.getCell(10).value).toBe("Differs");
    expect(row.getCell(12).value).toBe(12_000);
    expect(row.getCell(13).value).toBe(345);
    expect(row.getCell(14).value).toBe("Guarantee of 50,000 noted.");
    expect(row.getCell(15).value).toBe("Deposit of 34,500 in transit.");
    expect(row.getCell(17).value).toBe("bank-reply.pdf");
    expect(row.getCell(18).value).toBe("Prepared");
    expect(row.getCell(19).value).toBe("preparer 1");
    const summary = wb.getWorksheet("Summary")!;
    const labels: string[] = [];
    summary.eachRow((r) => labels.push(String(r.getCell(1).value)));
    expect(labels.at(-1)).toBe("All areas");
    expect(labels.some((l) => l.startsWith("C6 "))).toBe(true);
    const log = await db.query("select detail from audit_log where entity = 'confirmations' and entity_id = $1", [e2025]);
    expect(log.rows).toHaveLength(1);
  });
});
