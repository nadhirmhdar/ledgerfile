import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import { assignTeam, getEngagementTeam, listAssignable, listEngagementTeams } from "../src/server/engagement-team";
import { ASSIGN_REFUSAL, DATE_REFUSAL, LOCKED_REFUSAL, PERSON_REFUSAL, SELF_REVIEW_REFUSAL } from "../src/domain/my-work";

// Invented firms and people. Firm A has several people who can review; C is one person; E has one reviewer and a preparer.
const A = "aaaaaaaa-3131-4000-8000-000000000001";
const B = "bbbbbbbb-3131-4000-8000-000000000001";
const C = "cccccccc-3131-4000-8000-000000000001";
const E = "eeeeeeee-3131-4000-8000-000000000001";
const user = (firm: string, n: number, role: repo.Session["role"]): repo.Session => ({ firmId: firm, userId: `${firm.slice(0, 8)}-3131-4000-8000-00000000002${n}`, role });
const prep = user(A, 1, "preparer");
const prep2 = user(A, 2, "preparer");
const rev = user(A, 3, "reviewer");
const partner = user(A, 4, "partner");
const admin = user(A, 5, "admin");
const gone = user(A, 6, "preparer");
const outsider = user(B, 1, "partner");
const solo = user(C, 1, "partner");
const eRev = user(E, 1, "partner");
const ePrep = user(E, 2, "preparer");

let db: Db;
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
const none = { preparerId: null, reviewerId: null, partnerId: null, reportDueOn: null };

async function newEngagement(by: repo.Session, name: string): Promise<string> {
  return as(by, async (tx) => repo.createEngagement(tx, by, await repo.createClient(tx, by, name), "2025-01-01", "2025-12-31"));
}
const logged = async (id: string) =>
  (await db.query<{ detail: unknown; user_id: string }>("select detail, user_id from audit_log where entity_id = $1 and action = 'assign_team' order by id", [id])).rows.map((r) => ({
    userId: r.user_id,
    detail: (typeof r.detail === "string" ? JSON.parse(r.detail) : r.detail) as { changed: string[]; before: Record<string, unknown>; after: Record<string, unknown> },
  }));

beforeAll(async () => {
  db = await openDatabase();
  for (const [id, n] of [[A, "Firm A"], [B, "Firm B"], [C, "Firm C"], [E, "Firm E"]]) await db.query("insert into firms (id, name) values ($1, $2)", [id, n]);
  for (const u of [prep, prep2, rev, partner, admin, gone, outsider, solo, eRev, ePrep]) {
    await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-2)}`, u.role]);
  }
  await db.query("update users set active = false where id = $1", [gone.userId]);
});

afterAll(async () => {
  await db.close();
});

describe("the migration", () => {
  it("adds four nullable columns, and a new engagement starts with all of them empty", async () => {
    const { rows } = await db.query<{ column_name: string; is_nullable: string; column_default: string | null }>(
      "select column_name, is_nullable, column_default from information_schema.columns where table_name = 'engagements' and column_name in ('preparer_id', 'reviewer_id', 'partner_id', 'report_due_on') order by column_name",
    );
    expect(rows.map((r) => r.column_name)).toEqual(["partner_id", "preparer_id", "report_due_on", "reviewer_id"]);
    expect(rows.every((r) => r.is_nullable === "YES" && r.column_default === null)).toBe(true);
    const id = await newEngagement(partner, "Empty Team Co");
    expect(await as(partner, (tx) => getEngagementTeam(tx, id))).toEqual({ preparer: null, reviewer: null, partner: null, reportDueOn: null });
  });
});

describe("who may assign", () => {
  it("lets a partner and an administrator assign, and shows the names", async () => {
    const id = await newEngagement(partner, "Assign Co");
    const r = await as(partner, (tx) => assignTeam(tx, partner, id, { preparerId: prep.userId, reviewerId: rev.userId, partnerId: partner.userId, reportDueOn: "2026-04-30" }));
    expect(r.changed).toEqual(["Preparer", "Reviewer", "Partner", "Report due"]);
    const team = await as(partner, (tx) => getEngagementTeam(tx, id));
    expect(team).toMatchObject({ preparer: { id: prep.userId, role: "preparer" }, reviewer: { id: rev.userId }, partner: { id: partner.userId }, reportDueOn: "2026-04-30" });
    // An administrator may change it, and may clear a place and the date.
    const again = await as(admin, (tx) => assignTeam(tx, admin, id, { preparerId: prep2.userId, reviewerId: rev.userId, partnerId: null, reportDueOn: null }));
    expect(again.changed).toEqual(["Preparer", "Partner", "Report due"]);
    expect(await as(admin, (tx) => getEngagementTeam(tx, id))).toMatchObject({ preparer: { id: prep2.userId }, partner: null, reportDueOn: null });
  });

  it("refuses a reviewer and a preparer, and changes nothing", async () => {
    const id = await newEngagement(partner, "Refuse Co");
    for (const who of [rev, prep]) {
      await expect(as(who, (tx) => assignTeam(tx, who, id, { ...none, preparerId: prep.userId }))).rejects.toThrow(ASSIGN_REFUSAL);
    }
    expect(await as(partner, (tx) => getEngagementTeam(tx, id))).toMatchObject({ preparer: null });
    expect(await logged(id)).toHaveLength(0);
  });

  it("reads the role from the database, not from the session it was handed", async () => {
    const id = await newEngagement(partner, "Role Co");
    const forged: repo.Session = { ...prep, role: "partner" };
    await expect(as(prep, (tx) => assignTeam(tx, forged, id, { ...none, preparerId: prep.userId }))).rejects.toThrow(ASSIGN_REFUSAL);
  });

  it("refuses a deactivated person acting", async () => {
    const id = await newEngagement(partner, "Gone Co");
    await db.query("update users set role = 'partner' where id = $1", [gone.userId]);
    await expect(as(gone, (tx) => assignTeam(tx, gone, id, none))).rejects.toThrow(ASSIGN_REFUSAL);
    await db.query("update users set role = 'preparer' where id = $1", [gone.userId]);
  });
});

describe("who can be assigned", () => {
  it("lists only the active people of the firm, with their role", async () => {
    const people = await as(partner, (tx) => listAssignable(tx));
    expect(people.map((p) => p.id).sort()).toEqual([prep, prep2, rev, partner, admin].map((u) => u.userId).sort());
    expect(people.find((p) => p.id === rev.userId)?.role).toBe("reviewer");
  });

  it("refuses a person of another firm, a deactivated person, a made-up id and a bad id", async () => {
    const id = await newEngagement(partner, "People Co");
    for (const bad of [outsider.userId, gone.userId, "00000000-0000-4000-8000-000000000999", "not-an-id"]) {
      await expect(as(partner, (tx) => assignTeam(tx, partner, id, { ...none, preparerId: bad }))).rejects.toThrow(PERSON_REFUSAL);
    }
    expect(await as(partner, (tx) => getEngagementTeam(tx, id))).toMatchObject({ preparer: null });
  });

  it("asks a reviewer to be able to review and a partner to be able to sign off", async () => {
    const id = await newEngagement(partner, "Places Co");
    await expect(as(partner, (tx) => assignTeam(tx, partner, id, { ...none, reviewerId: prep.userId }))).rejects.toThrow("must be a reviewer");
    await expect(as(partner, (tx) => assignTeam(tx, partner, id, { ...none, partnerId: rev.userId }))).rejects.toThrow("must be a partner");
    // The administrator counts as partner level.
    await expect(as(partner, (tx) => assignTeam(tx, partner, id, { ...none, partnerId: admin.userId }))).resolves.toEqual({ changed: ["Partner"] });
  });

  it("refuses a date that is not a real one", async () => {
    const id = await newEngagement(partner, "Date Co");
    for (const bad of ["2026-02-31", "31/12/2026", "tomorrow"]) {
      await expect(as(partner, (tx) => assignTeam(tx, partner, id, { ...none, reportDueOn: bad }))).rejects.toThrow(DATE_REFUSAL);
    }
  });
});

describe("a locked or archived engagement", () => {
  it("refuses with the locked-file wording, and the archive guard is not the only line of defence", async () => {
    const locked = await newEngagement(partner, "Locked Co");
    await db.query("update engagements set status = 'locked', locked_by = $2, locked_at = now() where id = $1", [locked, partner.userId]);
    await expect(as(partner, (tx) => assignTeam(tx, partner, locked, { ...none, preparerId: prep.userId }))).rejects.toThrow(LOCKED_REFUSAL);

    const archived = await newEngagement(partner, "Archived Co");
    await db.query("update engagements set status = 'locked', locked_by = $2, locked_at = now() where id = $1", [archived, partner.userId]);
    await db.query("update engagements set archived_at = now(), archived_by = $2 where id = $1", [archived, partner.userId]);
    await expect(as(partner, (tx) => assignTeam(tx, partner, archived, { ...none, preparerId: prep.userId }))).rejects.toThrow(LOCKED_REFUSAL);

    // The migration-0022 trigger does not list these columns, so only the application stands in the way: this is why the check exists.
    await expect(db.query("update engagements set preparer_id = $2 where id = $1", [archived, prep.userId])).resolves.toBeDefined();
    expect(await logged(locked)).toHaveLength(0);
    expect(await logged(archived)).toHaveLength(0);
  });

  it("refuses an engagement that is not the firm's", async () => {
    const id = await newEngagement(outsider, "Other Firm Co");
    await expect(as(partner, (tx) => assignTeam(tx, partner, id, none))).rejects.toThrow("Engagement not found.");
  });
});

describe("the audit log", () => {
  it("records who changed it, what changed, and the before and after, and nothing when nothing changed", async () => {
    const id = await newEngagement(partner, "Log Co");
    await as(partner, (tx) => assignTeam(tx, partner, id, { preparerId: prep.userId, reviewerId: null, partnerId: null, reportDueOn: "2026-05-01" }));
    await as(admin, (tx) => assignTeam(tx, admin, id, { preparerId: prep2.userId, reviewerId: rev.userId, partnerId: null, reportDueOn: "2026-05-01" }));
    // The same request again changes nothing and logs nothing.
    const same = await as(admin, (tx) => assignTeam(tx, admin, id, { preparerId: prep2.userId, reviewerId: rev.userId, partnerId: null, reportDueOn: "2026-05-01" }));
    expect(same.changed).toEqual([]);
    const entries = await logged(id);
    expect(entries).toHaveLength(2);
    expect(entries[0].userId).toBe(partner.userId);
    expect(entries[0].detail.changed).toEqual(["Preparer", "Report due"]);
    expect(entries[0].detail.before).toEqual({ preparer: null, reviewer: null, partner: null, reportDueOn: null });
    expect(entries[0].detail.after).toMatchObject({ preparer: { id: prep.userId }, reviewer: null, reportDueOn: "2026-05-01" });
    expect(entries[1].userId).toBe(admin.userId);
    expect(entries[1].detail.changed).toEqual(["Preparer", "Reviewer"]);
    expect(entries[1].detail.before).toMatchObject({ preparer: { id: prep.userId } });
    expect(entries[1].detail.after).toMatchObject({ preparer: { id: prep2.userId }, reviewer: { id: rev.userId } });
  });
});

describe("a preparer who is also the reviewer", () => {
  it("is refused with the app's own wording where the firm has other reviewers", async () => {
    const id = await newEngagement(partner, "Self Review Off Co");
    await expect(as(partner, (tx) => assignTeam(tx, partner, id, { ...none, preparerId: rev.userId, reviewerId: rev.userId }))).rejects.toThrow(SELF_REVIEW_REFUSAL);
    // A different preparer and reviewer is fine.
    await expect(as(partner, (tx) => assignTeam(tx, partner, id, { ...none, preparerId: prep.userId, reviewerId: rev.userId }))).resolves.toBeDefined();
  });

  it("is allowed for a sole practitioner", async () => {
    const id = await newEngagement(solo, "Solo Co");
    await expect(as(solo, (tx) => assignTeam(tx, solo, id, { ...none, preparerId: solo.userId, reviewerId: solo.userId, partnerId: solo.userId }))).resolves.toEqual({ changed: ["Preparer", "Reviewer", "Partner"] });
  });

  it("is allowed where the firm has only ever had one person who can review", async () => {
    const id = await newEngagement(eRev, "One Reviewer Co");
    // The firm has one person who can review (a partner) and one preparer.
    await expect(as(eRev, (tx) => assignTeam(tx, eRev, id, { ...none, preparerId: eRev.userId, reviewerId: eRev.userId }))).resolves.toEqual({ changed: ["Preparer", "Reviewer"] });
    // A second person who can review ends the allowance.
    await db.query("update users set role = 'reviewer' where id = $1", [ePrep.userId]);
    const again = await newEngagement(eRev, "Two Reviewers Co");
    await expect(as(eRev, (tx) => assignTeam(tx, eRev, again, { ...none, preparerId: eRev.userId, reviewerId: eRev.userId }))).rejects.toThrow(SELF_REVIEW_REFUSAL);
  });
});

describe("the list on the home page", () => {
  it("gives each engagement its team in one query, and engagements of other firms are not in it", async () => {
    const id = await newEngagement(partner, "List Co");
    await as(partner, (tx) => assignTeam(tx, partner, id, { ...none, preparerId: prep.userId }));
    const teams = await as(partner, (tx) => listEngagementTeams(tx));
    expect(teams.get(id)?.preparer?.name).toContain("preparer");
    const theirs = await newEngagement(outsider, "Theirs Co");
    expect(teams.has(theirs)).toBe(false);
  });
});
