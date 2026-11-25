import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import * as review from "../src/server/review";
import { assignTeam } from "../src/server/engagement-team";
import { getMyWork } from "../src/server/my-work";
import { PROCEDURE_AWAITING_REVIEW } from "../src/server/audit";
import type { WorkGroup, WorkLine } from "../src/domain/my-work";

const A = "aaaaaaaa-4141-4000-8000-000000000001";
const B = "bbbbbbbb-4141-4000-8000-000000000001";
const user = (firm: string, n: number, role: repo.Session["role"]): repo.Session => ({ firmId: firm, userId: `${firm.slice(0, 8)}-4141-4000-8000-00000000003${n}`, role });
const prep = user(A, 1, "preparer");
const prep2 = user(A, 2, "preparer");
const rev = user(A, 3, "reviewer");
const rev2 = user(A, 4, "reviewer");
const partner = user(A, 5, "partner");
const outsider = user(B, 1, "partner");

const TODAY = "2026-03-01";
const days = (n: number) => new Date(Date.UTC(2026, 2, 1) + n * 86_400_000).toISOString().slice(0, 10);
const TB = [
  { code: "1000", name: "Bank - current account", closingMinor: 15000000, priorMinor: 10000000 },
  { code: "3000", name: "Share capital", closingMinor: -5000000, priorMinor: -5000000 },
  { code: "4000", name: "Sales", closingMinor: -10000000, priorMinor: 0 },
];

let db: Db;
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
const work = (s: repo.Session) => as(s, (tx) => getMyWork(tx, s, TODAY));
const groupOf = (groups: WorkGroup[], id: string) => groups.find((g) => g.engagementId === id);
const kinds = (g: WorkGroup | undefined) => (g?.lines ?? []).map((l) => l.key.split(":")[1]);
const line = (g: WorkGroup | undefined, slug: string): WorkLine | undefined => g?.lines.find((l) => l.key.endsWith(`:${slug}`));
const scalar = async (sql: string, params: unknown[]) => (await db.query<{ n: number }>(sql, params)).rows[0].n;

/** An open engagement with a trial balance and the audit on, assigned as given. */
async function newEngagement(name: string, team: { preparer?: repo.Session; reviewer?: repo.Session; partner?: repo.Session; due?: string | null }, audited = true): Promise<string> {
  const id = await as(partner, async (tx) => {
    const client = await repo.createClient(tx, partner, name);
    const e = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
    await repo.importTrialBalance(tx, partner, e, "tb.xlsx", TB);
    await repo.approveAllMappings(tx, partner, e);
    if (audited) await audit.setAuditEnabled(tx, partner, e, true);
    return e;
  });
  await as(partner, (tx) => assignTeam(tx, partner, id, { preparerId: team.preparer?.userId ?? null, reviewerId: team.reviewer?.userId ?? null, partnerId: team.partner?.userId ?? null, reportDueOn: team.due ?? null }));
  return id;
}

async function schedule(id: string, ref: string, state: "unprepared" | "prepared" | "reviewed", area = "C5") {
  const prepared = state !== "unprepared";
  await db.query(
    `insert into test_schedules (firm_id, engagement_id, area_code, seq, reference, title, conclusion, prepared_by, prepared_at, reviewed_by, reviewed_at, created_by)
     select e.firm_id, e.id, $2, $3, $4, 'Invented listing', case when $5 then 'Agreed' end, case when $5 then $7::uuid end, case when $5 then now() end,
            case when $6 then $8::uuid end, case when $6 then now() end, $7::uuid from engagements e where e.id = $1`,
    [id, area, Number(ref.split("-")[1]), ref, prepared, state === "reviewed", prep.userId, rev.userId],
  );
}
async function confirmation(id: string, seq: number, state: "unprepared" | "prepared" | "reviewed") {
  await db.query(
    `insert into confirmations (firm_id, engagement_id, seq, reference, kind, area_code, party_name, sent_on, reply, prepared_by, prepared_at, reviewed_by, reviewed_at, created_by)
     select e.firm_id, e.id, $2, $3, 'bank', 'C1', 'Invented Bank', case when $4 then date '2026-01-05' end, case when $4 then 'no_reply' end, case when $4 then $6::uuid end, case when $4 then now() end, case when $5 then $7::uuid end, case when $5 then now() end, $6::uuid
     from engagements e where e.id = $1`,
    [id, seq, `CF-${seq}`, state !== "unprepared", state === "reviewed", prep.userId, rev.userId],
  );
}
const finishProcedures = (id: string, n: number) =>
  db.query(
    `update audit_procedures set status = 'done', performed_by = $3, performed_at = now() where id in
       (select id from audit_procedures where engagement_id = $1 and status = 'open' and evidence !~* '^Partner sign-off' order by template_id limit $2)`,
    [id, n, prep.userId],
  );

let busy: string; // prepared by Q, reviewed by R and P, with every kind of work waiting
let busyLock: string;
let busyArchive: string;
let overdue: string;
let soon30: string;
let beyond: string;
let noDate: string;
let notOnIt: string;
let theirs: string;

beforeAll(async () => {
  db = await openDatabase();
  for (const f of [A, B]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [f]);
  for (const u of [prep, prep2, rev, rev2, partner, outsider]) {
    await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-2)}`, u.role]);
  }

  busy = await newEngagement("Busy Trading LLC", { preparer: prep, reviewer: rev, partner, due: days(10) });
  await finishProcedures(busy, 3);
  await schedule(busy, "C5-1", "unprepared");
  await schedule(busy, "C5-2", "unprepared");
  await schedule(busy, "C5-3", "prepared");
  await schedule(busy, "C5-4", "reviewed");
  await confirmation(busy, 1, "unprepared");
  await confirmation(busy, 2, "prepared");
  await confirmation(busy, 3, "prepared");
  await confirmation(busy, 4, "reviewed");
  // Lead sheets: the first is prepared only (waiting for the reviewer), the second is prepared and reviewed (done), the third is untouched.
  const sheets = (await as(partner, (tx) => review.getOverview(tx, busy)))!.leadSheets.map((l) => l.groupCode);
  await as(prep, (tx) => review.signOff(tx, prep, busy, sheets[0], "preparer"));
  await as(prep, (tx) => review.signOff(tx, prep, busy, sheets[1], "preparer"));
  await as(rev, (tx) => review.signOff(tx, rev, busy, sheets[1], "reviewer"));
  // Review points: R raises two. One is answered by the preparer (waiting to be cleared), one is not (waiting for a response). R2 raises one answered point.
  const answered = await as(rev, (tx) => review.addReviewPoint(tx, rev, busy, "GENERAL", "Explain the opening balance."));
  await as(rev, (tx) => review.addReviewPoint(tx, rev, busy, "GENERAL", "Support the bank balance."));
  const fromR2 = await as(rev2, (tx) => review.addReviewPoint(tx, rev2, busy, "GENERAL", "Check the cut-off."));
  await as(prep, (tx) => review.respondToReviewPoint(tx, prep, answered, "Opening balance agrees to last year."));
  await as(prep, (tx) => review.respondToReviewPoint(tx, prep, fromR2, "Cut-off tested."));

  // Locked and archived engagements with the same people and work: nothing from them may appear.
  busyLock = await newEngagement("Locked Trading LLC", { preparer: prep, reviewer: rev, partner, due: days(5) });
  await schedule(busyLock, "C5-1", "unprepared");
  await finishProcedures(busyLock, 2);
  busyArchive = await newEngagement("Archived Trading LLC", { preparer: prep, reviewer: rev, partner, due: days(-5) });
  await schedule(busyArchive, "C5-1", "unprepared");
  for (const id of [busyLock, busyArchive]) await db.query("update engagements set status = 'locked', locked_by = $2, locked_at = now() where id = $1", [id, partner.userId]);
  await db.query("update engagements set archived_at = now(), archived_by = $2 where id = $1", [busyArchive, partner.userId]);

  // Report due: past, on the last day of the window, one day beyond it, and no date.
  overdue = await newEngagement("Overdue Foods LLC", { preparer: prep, due: days(-3) }, false);
  soon30 = await newEngagement("Thirty Days Foods LLC", { reviewer: rev, due: days(30) }, false);
  beyond = await newEngagement("Thirty One Days Foods LLC", { preparer: prep, reviewer: rev, partner, due: days(31) }, false);
  noDate = await newEngagement("No Date Foods LLC", { preparer: prep, reviewer: rev, partner }, false);

  // An engagement the preparer is not on, with open work in it.
  notOnIt = await newEngagement("Someone Elses Trading LLC", { preparer: prep2, due: days(2) });
  await schedule(notOnIt, "C5-1", "unprepared");

  theirs = await as(outsider, async (tx) => repo.createEngagement(tx, outsider, await repo.createClient(tx, outsider, "Other Firm Trading LLC"), "2025-01-01", "2025-12-31"));
});

afterAll(async () => {
  await db.close();
});

describe("My work for a preparer", () => {
  it("lists open procedures, schedules and confirmations not yet prepared, and review points waiting for a response", async () => {
    const g = groupOf(await work(prep), busy)!;
    const open = await scalar("select count(*)::int as n from audit_procedures where engagement_id = $1 and status = 'open'", [busy]);
    expect(open).toBeGreaterThan(0);
    expect(line(g, "prep-proc")?.count).toBe(open);
    expect(line(g, "prep-sched")).toMatchObject({ count: 2, kind: "prepare", href: `/engagements/${busy}/audit/C5` });
    expect(line(g, "prep-conf")).toMatchObject({ count: 1, href: `/engagements/${busy}/audit/confirmations` });
    expect(line(g, "prep-points")).toMatchObject({ count: 1, label: "1 review point waiting for your response", href: `/engagements/${busy}/review` });
    expect(g.roles).toEqual(["Preparer"]);
  });

  it("lists nothing from the review side, and nothing for a lead sheet", async () => {
    const g = groupOf(await work(prep), busy)!;
    expect(kinds(g).filter((k) => k.startsWith("rev-"))).toEqual([]);
    expect(g.lines.every((l) => l.kind === "prepare" || l.kind === "due")).toBe(true);
  });

  it("links one schedule to its own page and a procedure line to its area", async () => {
    const one = await newEngagement("One Schedule LLC", { preparer: prep });
    await schedule(one, "C5-1", "unprepared");
    const sid = (await db.query<{ id: string }>("select id from test_schedules where engagement_id = $1", [one])).rows[0].id;
    expect(line(groupOf(await work(prep), one), "prep-sched")?.href).toBe(`/engagements/${one}/audit/C5/schedules/${sid}`);
  });
});

describe("My work for a reviewer and a partner", () => {
  it("lists what is done and not yet reviewed, answered review points, and lead sheets signed as prepared only", async () => {
    for (const who of [rev, partner]) {
      const g = groupOf(await work(who), busy)!;
      const awaiting = await scalar(`select count(*)::int as n from audit_procedures where engagement_id = $1 and ${PROCEDURE_AWAITING_REVIEW}`, [busy]);
      expect(awaiting).toBe(3);
      expect(line(g, "rev-proc")?.count).toBe(awaiting);
      expect(line(g, "rev-sched")).toMatchObject({ count: 1, kind: "review" });
      expect(line(g, "rev-conf")).toMatchObject({ count: 2 });
      expect(line(g, "rev-points")).toMatchObject({ count: 2, label: "2 review points answered, waiting to be cleared" });
      expect(line(g, "rev-sheets")).toMatchObject({ count: 1, href: `/engagements/${busy}/review` });
      expect(kinds(g).filter((k) => k.startsWith("prep-"))).toEqual([]);
    }
    expect(groupOf(await work(rev), busy)!.roles).toEqual(["Reviewer"]);
    expect(groupOf(await work(partner), busy)!.roles).toEqual(["Partner"]);
  });

  it("does not list a review point twice for the reviewer who raised it", async () => {
    const g = groupOf(await work(rev), busy)!;
    expect(kinds(g)).not.toContain("yours");
  });

  it("uses the same definition of waiting for review as the audit overview", async () => {
    const overview = await as(partner, (tx) => audit.getAuditOverview(tx, busy));
    const unreviewed = [...overview!.areas, ...overview!.checklists].reduce((n, a) => n + a.unreviewed, 0);
    expect(line(groupOf(await work(rev), busy), "rev-proc")?.count).toBe(unreviewed);
  });
});

describe("review points you raised", () => {
  it("shows an answered, still open point to a reviewer who is not assigned, and nothing else on that engagement", async () => {
    const g = groupOf(await work(rev2), busy)!;
    expect(kinds(g)).toEqual(["yours"]);
    expect(line(g, "yours")).toMatchObject({ count: 1, label: "1 review point you raised has an answer", href: `/engagements/${busy}/review`, kind: "yours" });
    expect(g.roles).toEqual([]);
  });

  it("does not show a point that has no answer yet, or one that is cleared", async () => {
    const lonely = await newEngagement("Lonely Co", { preparer: prep });
    const p = await as(rev2, (tx) => review.addReviewPoint(tx, rev2, lonely, "GENERAL", "Please explain the loan."));
    expect(groupOf(await work(rev2), lonely)).toBeUndefined();
    await as(prep, (tx) => review.respondToReviewPoint(tx, prep, p, "Loan agreement attached."));
    expect(line(groupOf(await work(rev2), lonely), "yours")?.count).toBe(1);
    await as(rev2, (tx) => review.clearReviewPoint(tx, rev2, p));
    expect(groupOf(await work(rev2), lonely)).toBeUndefined();
  });
});

describe("what My work leaves out", () => {
  it("leaves out locked and archived engagements, even with open work and a date", async () => {
    for (const who of [prep, rev, partner]) {
      const groups = await work(who);
      expect(groupOf(groups, busyLock)).toBeUndefined();
      expect(groupOf(groups, busyArchive)).toBeUndefined();
    }
  });

  it("leaves out an engagement the person is not on", async () => {
    for (const who of [prep, rev, partner]) expect(groupOf(await work(who), notOnIt)).toBeUndefined();
    expect(groupOf(await work(prep2), notOnIt)).toBeDefined();
  });

  it("leaves out other firms: nothing leaks either way", async () => {
    expect(await work(outsider)).toEqual([]);
    for (const who of [prep, rev, partner, rev2]) expect((await work(who)).some((g) => g.engagementId === theirs)).toBe(false);
  });

  it("gives a person with no assignments an empty list", async () => {
    const stranger = user(A, 9, "preparer");
    await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, 'stranger@x.test', 'Stranger', 'preparer')", [stranger.userId, A]);
    expect(await work(stranger)).toEqual([]);
  });
});

describe("report due", () => {
  it("lists a report due inside 30 days, with its words, for everyone on the engagement", async () => {
    for (const who of [prep, rev, partner]) {
      const g = groupOf(await work(who), busy)!;
      expect(line(g, "due")).toMatchObject({ kind: "due", label: "Report due in 10 days", href: `/engagements/${busy}` });
      expect(g.due).toEqual({ kind: "soon", days: 10 });
    }
  });

  it("lists a past date as overdue, in words", async () => {
    const g = groupOf(await work(prep), overdue)!;
    expect(g.due).toEqual({ kind: "overdue", days: 3 });
    expect(line(g, "due")?.label).toBe("Report overdue by 3 days");
  });

  it("includes day 30 and leaves out day 31 and an engagement with no date", async () => {
    expect(line(groupOf(await work(rev), soon30), "due")?.label).toBe("Report due in 30 days");
    for (const who of [prep, rev, partner]) {
      expect(groupOf(await work(who), beyond)).toBeUndefined();
      expect(groupOf(await work(who), noDate)).toBeUndefined();
    }
  });

  it("does not show the date to someone who is not on the engagement", async () => {
    expect(groupOf(await work(prep), soon30)).toBeUndefined();
    expect(groupOf(await work(partner), soon30)).toBeUndefined();
  });

  it("sorts the earliest date first, past dates on top, and the engagements without a date last", async () => {
    const order = (await work(prep)).map((g) => g.clientName);
    expect(order.indexOf("Overdue Foods LLC")).toBe(0);
    expect(order.indexOf("Overdue Foods LLC")).toBeLessThan(order.indexOf("Busy Trading LLC"));
  });
});
