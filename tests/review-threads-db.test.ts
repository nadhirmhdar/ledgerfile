import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as review from "../src/server/review";
import { assignTeam } from "../src/server/engagement-team";
import { getMyWork } from "../src/server/my-work";
import { LATEST_MIGRATION } from "../src/server/migrations";
import type { WorkGroup } from "../src/domain/my-work";

// Invented firms and people.
const A = "aaaaaaaa-8282-4000-8000-000000000001";
const B = "bbbbbbbb-8282-4000-8000-000000000001";
const user = (firm: string, n: number, role: repo.Session["role"]): repo.Session => ({ firmId: firm, userId: `${firm.slice(0, 8)}-8282-4000-8000-00000000004${n}`, role });
const prep = user(A, 1, "preparer");
const rev = user(A, 2, "reviewer");
const partner = user(A, 3, "partner");
const outsider = user(B, 1, "partner");
const TODAY = "2026-03-01";
const TB = [
  { code: "1000", name: "Bank - current account", closingMinor: 15000000, priorMinor: 10000000 },
  { code: "3000", name: "Share capital", closingMinor: -5000000, priorMinor: -5000000 },
  { code: "4000", name: "Sales", closingMinor: -10000000, priorMinor: 0 },
];

let db: Db;
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
let n = 0;

async function engagement(): Promise<string> {
  const id = await as(partner, async (tx) => {
    const client = await repo.createClient(tx, partner, `Thread Trading ${++n} LLC`);
    const e = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
    await repo.importTrialBalance(tx, partner, e, "tb.xlsx", TB);
    await repo.approveAllMappings(tx, partner, e);
    return e;
  });
  await as(partner, (tx) => assignTeam(tx, partner, id, { preparerId: prep.userId, reviewerId: rev.userId, partnerId: null, reportDueOn: null }));
  return id;
}
const raise = (e: string, body = "Explain the opening balance.") => as(rev, (tx) => review.addReviewPoint(tx, rev, e, "GENERAL", body));
const reply = (who: repo.Session, point: string, text: string) => as(who, (tx) => review.replyToReviewPoint(tx, who, point, text));
const point = async (e: string, id: string) => (await as(prep, (tx) => review.getOverview(tx, e)))!.points.find((p) => p.id === id)!;
const line = (groups: WorkGroup[], e: string, slug: string) => groups.find((g) => g.engagementId === e)?.lines.find((l) => l.key.endsWith(`:${slug}`));
const myWork = (s: repo.Session) => as(s, (tx) => getMyWork(tx, s, TODAY));
const bodiesOf = async (e: string, id: string) => (await point(e, id)).thread.map((r) => r.body);

beforeAll(async () => {
  db = await openDatabase();
  for (const f of [A, B]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [f]);
  for (const u of [prep, rev, partner, outsider]) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} user`, u.role]);
});
afterAll(async () => {
  await db.close();
});

describe("the replies table", () => {
  it("is the latest migration, and the application role can only read and add replies", async () => {
    expect(LATEST_MIGRATION).toBe("0036_review_point_replies.sql");
    const e = await engagement();
    const p = await raise(e);
    await reply(prep, p, "Agreed to last year's file.");
    await expect(as(prep, (tx) => tx.query("update review_point_replies set body = 'Changed after the fact'"))).rejects.toThrow(/permission denied/);
    await expect(as(prep, (tx) => tx.query("delete from review_point_replies"))).rejects.toThrow(/permission denied/);
    expect((await as(prep, (tx) => tx.query("select 1 from review_point_replies"))).rows).toHaveLength(1);
  });

  it("rejects a reply that is too short or too long at the database too", async () => {
    const e = await engagement();
    const p = await raise(e);
    await expect(reply(prep, p, "x")).rejects.toThrow(/Write a reply/);
    await expect(reply(prep, p, "x".repeat(2001))).rejects.toThrow(/too long/);
    await expect(
      as(prep, (tx) => tx.query("insert into review_point_replies (firm_id, engagement_id, point_id, author_id, body) values ($1, $2, $3, $4, 'x')", [A, e, p, prep.userId])),
    ).rejects.toThrow();
  });
});

describe("answered means the same as before", () => {
  it("a reply by someone other than the author answers the point, and it shows in the reviewer's My work as waiting to be cleared", async () => {
    const e = await engagement();
    const p = await raise(e);
    expect(line((await myWork(prep)), e, "prep-points")).toMatchObject({ count: 1 });
    expect(line((await myWork(rev)), e, "rev-points")).toBeUndefined();
    await reply(prep, p, "The opening balance agrees to last year.");
    const after = await point(e, p);
    expect(after).toMatchObject({ response: "The opening balance agrees to last year.", responderName: "preparer user" });
    expect(line((await myWork(prep)), e, "prep-points")).toBeUndefined();
    expect(line((await myWork(rev)), e, "rev-points")).toMatchObject({ count: 1, label: "1 review point answered, waiting to be cleared" });
  });

  it("a reply back by the reviewer who raised it makes the point wait for a response again, and it shows in the preparer's My work", async () => {
    const e = await engagement();
    const p = await raise(e);
    await reply(prep, p, "Agreed to last year.");
    await reply(rev, p, "Which page of last year's file?");
    const after = await point(e, p);
    expect(after.response).toBeNull();
    expect(after.responderName).toBeNull();
    expect(line((await myWork(prep)), e, "prep-points")).toMatchObject({ count: 1, label: "1 review point waiting for your response" });
    expect(line((await myWork(rev)), e, "rev-points")).toBeUndefined();
    // And answered again by the preparer.
    await reply(prep, p, "Page 4 of the signed file.");
    expect((await point(e, p)).response).toBe("Page 4 of the signed file.");
    expect(line((await myWork(rev)), e, "rev-points")).toMatchObject({ count: 1 });
  });

  it("a reply by another reviewer or a partner, who is not the author, answers it", async () => {
    const e = await engagement();
    const p = await raise(e);
    await reply(partner, p, "I have looked at this; it agrees.");
    expect((await point(e, p)).response).toBe("I have looked at this; it agrees.");
  });
});

describe("the thread", () => {
  it("keeps several replies in order, with who and when", async () => {
    const e = await engagement();
    const p = await raise(e);
    await reply(prep, p, "First answer.");
    await reply(rev, p, "Second, from the reviewer.");
    await reply(prep, p, "Third answer.");
    const thread = (await point(e, p)).thread;
    expect(thread.map((r) => [r.authorName, r.body])).toEqual([
      ["preparer user", "First answer."],
      ["reviewer user", "Second, from the reviewer."],
      ["preparer user", "Third answer."],
    ]);
    expect(thread.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.writtenAt!) && !r.legacy)).toBe(true);
  });

  it("shows an older single response as the first reply, without a backfill, and keeps it when the point is replied to", async () => {
    const e = await engagement();
    const p = await raise(e);
    // How a point looked before threads: one response in the column and nothing in the new table.
    await db.query("update review_points set response = 'The older answer.', responded_by = $2 where id = $1", [p, prep.userId]);
    expect((await db.query("select 1 from review_point_replies where point_id = $1", [p])).rows).toHaveLength(0);
    const before = await point(e, p);
    expect(before.thread).toEqual([{ id: "legacy", authorName: "preparer user", body: "The older answer.", writtenAt: null, legacy: true }]);
    expect(before.response).toBe("The older answer.");
    // Reading it wrote nothing.
    expect((await db.query("select 1 from review_point_replies where point_id = $1", [p])).rows).toHaveLength(0);
    // The reviewer asks again: the older answer is kept as the first entry before the new reply, and the point waits for a response.
    await reply(rev, p, "Please give the page reference.");
    expect(await bodiesOf(e, p)).toEqual(["The older answer.", "Please give the page reference."]);
    expect((await point(e, p)).thread[0]).toMatchObject({ legacy: true, writtenAt: null });
    expect((await point(e, p)).response).toBeNull();
  });
});

describe("who and when a reply is allowed", () => {
  it("refuses a reply on a locked engagement and on a cleared point", async () => {
    const e = await engagement();
    const p = await raise(e);
    const cleared = await raise(e, "Another point to clear.");
    await reply(prep, cleared, "Done.");
    await as(rev, (tx) => review.clearReviewPoint(tx, rev, cleared));
    await expect(reply(prep, cleared, "One more thing.")).rejects.toThrow(/already cleared/);
    // The cleared point still shows its thread, read-only.
    expect(await bodiesOf(e, cleared)).toEqual(["Done."]);
    await db.query("update engagements set status = 'locked', locked_by = $2, locked_at = now() where id = $1", [e, partner.userId]);
    await expect(reply(prep, p, "Too late.")).rejects.toThrow(/locked/);
  });

  it("does not let another firm reply, or see the thread", async () => {
    const e = await engagement();
    const p = await raise(e);
    await reply(prep, p, "A private answer.");
    await expect(reply(outsider, p, "I should not be here.")).rejects.toThrow(/not found/i);
    expect((await as(outsider, (tx) => tx.query("select 1 from review_point_replies"))).rows).toHaveLength(0);
    expect(await as(outsider, (tx) => review.getOverview(tx, e))).toBeNull();
  });
});

describe("audit", () => {
  it("logs every reply, with the words, who wrote it and whether it answered the point", async () => {
    const e = await engagement();
    const p = await raise(e);
    await reply(prep, p, "The answer.");
    await reply(rev, p, "The question again.");
    const log = await db.query<{ detail: { reply: string; byAuthor: boolean; answered: boolean }; user_id: string }>(
      "select detail, user_id from audit_log where action = 'reply' and entity_id = $1 order by id",
      [p],
    );
    expect(log.rows.map((r) => [r.detail.reply, r.detail.byAuthor, r.detail.answered, r.user_id])).toEqual([
      ["The answer.", false, true, prep.userId],
      ["The question again.", true, false, rev.userId],
    ]);
  });
});
