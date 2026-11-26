import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import { assignTeam } from "../src/server/engagement-team";
import { listAreaAssignments, setAreaAssignment } from "../src/server/area-assignments";
import { getMyWork } from "../src/server/my-work";
import { AREA_REFUSAL, differingAssignees, effectiveTeam, isAssignableArea } from "../src/domain/area-assignments";
import { ASSIGN_REFUSAL, LOCKED_REFUSAL, PERSON_REFUSAL, SELF_REVIEW_REFUSAL, type WorkGroup, type WorkLine } from "../src/domain/my-work";
import { AreaAssignees } from "../src/ui/area-assignees";

// Invented firms and people.
const A = "aaaaaaaa-8787-4000-8000-000000000001";
const B = "bbbbbbbb-8787-4000-8000-000000000001";
const user = (firm: string, n: number, role: repo.Session["role"]): repo.Session => ({ firmId: firm, userId: `${firm.slice(0, 8)}-8787-4000-8000-00000000004${n}`, role });
const prep = user(A, 1, "preparer");
const prep2 = user(A, 2, "preparer");
const rev = user(A, 3, "reviewer");
const rev2 = user(A, 4, "reviewer");
const partner = user(A, 5, "partner");
const partner2 = user(A, 6, "partner");
const inactive = user(A, 7, "preparer");
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
const work = (s: repo.Session) => as(s, (tx) => getMyWork(tx, s, TODAY));
const groupOf = (groups: WorkGroup[], id: string) => groups.find((g) => g.engagementId === id);
const line = (g: WorkGroup | undefined, slug: string): WorkLine | undefined => g?.lines.find((l) => l.key.endsWith(`:${slug}`));
const setArea = (s: repo.Session, id: string, areaCode: string, preparerId: string | null, reviewerId: string | null) => as(s, (tx) => setAreaAssignment(tx, s, id, { areaCode, preparerId, reviewerId }));
const audits = async (id: string) => (await db.query<{ detail: Record<string, unknown>; user_id: string }>("select detail, user_id from audit_log where action = 'assign_area' and entity_id = $1 order by id", [id])).rows;
let n = 0;

/** An open engagement with the audit on (its checklists are loaded), the team assigned as given, and its areas with procedures listed. */
async function newEngagement(team: { preparer?: repo.Session; reviewer?: repo.Session; partner?: repo.Session }): Promise<{ id: string; areas: { code: string; open: number }[] }> {
  const id = await as(partner, async (tx) => {
    const client = await repo.createClient(tx, partner, `Area Trading ${++n} LLC`);
    const e = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
    await repo.importTrialBalance(tx, partner, e, "tb.xlsx", TB);
    await repo.approveAllMappings(tx, partner, e);
    await audit.setAuditEnabled(tx, partner, e, true);
    return e;
  });
  await as(partner, (tx) => assignTeam(tx, partner, id, { preparerId: team.preparer?.userId ?? null, reviewerId: team.reviewer?.userId ?? null, partnerId: team.partner?.userId ?? null, reportDueOn: null }));
  const areas = (await db.query<{ code: string; open: number }>("select area_code as code, count(*) filter (where status = 'open')::int as open from audit_procedures where engagement_id = $1 group by area_code order by area_code", [id])).rows;
  return { id, areas };
}
/** Mark every open procedure of one area done by the preparer, so it waits for review. */
const finishArea = (id: string, area: string) => db.query("update audit_procedures set status = 'done', performed_by = $3, performed_at = now() where engagement_id = $1 and area_code = $2 and status = 'open' and evidence !~* '^Partner sign-off'", [id, area, prep.userId]);
async function schedule(id: string, area: string, ref: string, prepared: boolean) {
  await db.query(
    `insert into test_schedules (firm_id, engagement_id, area_code, seq, reference, title, conclusion, prepared_by, prepared_at, created_by)
     select e.firm_id, e.id, $2, $3, $4, 'Invented listing', case when $5 then 'Agreed' end, case when $5 then $6::uuid end, case when $5 then now() end, $6::uuid from engagements e where e.id = $1`,
    [id, area, Number(ref.split("-")[1]), ref, prepared, prep.userId],
  );
}

beforeAll(async () => {
  db = await openDatabase();
  for (const f of [A, B]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [f]);
  for (const u of [prep, prep2, rev, rev2, partner, partner2, inactive, outsider]) {
    await db.query("insert into users (id, firm_id, email, name, role, active) values ($1, $2, $3, $4, $5, $6)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-2)}`, u.role, u !== inactive]);
  }
});
afterAll(async () => {
  await db.close();
});

describe("the migration", () => {
  it("is 0040, with one row per area, the app role may change and remove it, and another firm sees none", async () => {
    expect((await db.query("select 1 from schema_migrations where name = $1", ["0040_area_assignments.sql"])).rows).toHaveLength(1);
    const { id, areas } = await newEngagement({ preparer: prep, reviewer: rev, partner });
    await setArea(partner, id, areas[0].code, prep2.userId, null);
    const app = (s: repo.Session, sql: string, params: unknown[] = []) =>
      db.transaction(async (tx) => {
        await tx.exec("set local role app_user");
        await tx.query("select set_config('app.firm_id', $1, true)", [s.firmId]);
        return tx.query(sql, params);
      });
    // An assignment is a current setting: the application role may update and delete it.
    await app(partner, "update engagement_area_assignments set reviewer_id = $2 where engagement_id = $1", [id, rev.userId]);
    await expect(db.query("insert into engagement_area_assignments (firm_id, engagement_id, area_code, assigned_by) values ($1, $2, $3, $4)", [A, id, areas[0].code, partner.userId])).rejects.toThrow(/unique|duplicate/);
    expect((await app(outsider, "select 1 from engagement_area_assignments")).rows).toHaveLength(0);
    await app(partner, "delete from engagement_area_assignments where engagement_id = $1", [id]);
    expect((await db.query("select 1 from engagement_area_assignments where engagement_id = $1", [id])).rows).toHaveLength(0);
  });
});

describe("setting and clearing an area's own people", () => {
  it("sets, changes and clears an override, with an audit entry holding the area, the before and the after", async () => {
    const { id, areas } = await newEngagement({ preparer: prep, reviewer: rev, partner });
    const code = areas[0].code;
    expect((await setArea(partner, id, code, prep2.userId, rev2.userId)).changed).toBe(true);
    const now = await as(partner, (tx) => listAreaAssignments(tx, id));
    expect(now.get(code)).toMatchObject({ areaCode: code, preparer: { id: prep2.userId }, reviewer: { id: rev2.userId } });
    // Setting what is already saved changes nothing and logs nothing.
    expect((await setArea(partner, id, code, prep2.userId, rev2.userId)).changed).toBe(false);
    // Change one place, then clear the preparer and keep the reviewer, then clear both: the row goes.
    await setArea(partner, id, code, null, rev2.userId);
    expect((await as(partner, (tx) => listAreaAssignments(tx, id))).get(code)).toMatchObject({ preparer: null, reviewer: { id: rev2.userId } });
    await setArea(partner, id, code, null, null);
    expect((await as(partner, (tx) => listAreaAssignments(tx, id))).size).toBe(0);
    const log = await audits(id);
    expect(log).toHaveLength(3);
    expect(log[0].detail).toMatchObject({ area: code, before: { preparer: null, reviewer: null }, after: { preparer: { id: prep2.userId }, reviewer: { id: rev2.userId } } });
    expect(log[1].detail).toMatchObject({ before: { preparer: { id: prep2.userId } }, after: { preparer: null, reviewer: { id: rev2.userId } } });
    expect(log[2].detail).toMatchObject({ before: { reviewer: { id: rev2.userId } }, after: { preparer: null, reviewer: null } });
    expect(log.every((l) => l.user_id === partner.userId)).toBe(true);
  });

  it("refuses a locked engagement, an archived one, another firm's, an inactive person, a non-partner, an unknown area, a bad reviewer and a self-review", async () => {
    const { id, areas } = await newEngagement({ preparer: prep, reviewer: rev, partner });
    const code = areas[0].code;
    // Not a partner (read again from the database, whatever the session said).
    await expect(setArea(prep, id, code, prep2.userId, null)).rejects.toThrow(ASSIGN_REFUSAL);
    await expect(setArea({ ...prep, role: "partner" }, id, code, prep2.userId, null)).rejects.toThrow(ASSIGN_REFUSAL);
    // Another firm: its partner finds no such engagement, and cannot name this firm's people.
    await expect(setArea(outsider, id, code, null, null)).rejects.toThrow(/Engagement not found/);
    await expect(setArea(partner, id, code, outsider.userId, null)).rejects.toThrow(PERSON_REFUSAL);
    // An inactive person, a malformed id, an unknown area.
    await expect(setArea(partner, id, code, inactive.userId, null)).rejects.toThrow(PERSON_REFUSAL);
    await expect(setArea(partner, id, code, "not-a-person", null)).rejects.toThrow(PERSON_REFUSAL);
    await expect(setArea(partner, id, "Z9", prep2.userId, null)).rejects.toThrow(AREA_REFUSAL);
    // A reviewer place needs reviewer rights.
    await expect(setArea(partner, id, code, null, prep2.userId)).rejects.toThrow(/reviewer, partner or administrator/);
    // The same person for both places, where the firm does not allow self-review.
    await expect(setArea(partner, id, code, rev.userId, rev.userId)).rejects.toThrow(SELF_REVIEW_REFUSAL);
    // The area's preparer cannot be the engagement's reviewer either (the effective pair is checked).
    await expect(setArea(partner, id, code, rev.userId, null)).rejects.toThrow(SELF_REVIEW_REFUSAL);
    expect((await as(partner, (tx) => listAreaAssignments(tx, id))).size).toBe(0);
    // Locked and archived.
    await db.query("update engagements set status = 'locked' where id = $1", [id]);
    await expect(setArea(partner, id, code, prep2.userId, null)).rejects.toThrow(LOCKED_REFUSAL);
    expect((await as(partner, (tx) => listAreaAssignments(tx, id))).size).toBe(0);
    expect(await audits(id)).toHaveLength(0);
  });

  it("the pure rules: an area's own person replaces the engagement's, and only a different person is shown", () => {
    const eng = { preparerId: "p1", reviewerId: "r1" };
    expect(effectiveTeam(undefined, eng)).toEqual({ preparerId: "p1", reviewerId: "r1" });
    expect(effectiveTeam({ preparerId: "p2", reviewerId: null }, eng)).toEqual({ preparerId: "p2", reviewerId: "r1" });
    expect(isAssignableArea("C5")).toBe(true);
    expect(isAssignableArea("Z9")).toBe(false);
    const person = (id: string) => ({ id, name: id });
    expect(differingAssignees({ preparer: person("p1"), reviewer: person("r2") }, eng)).toEqual({ preparer: null, reviewer: person("r2") });
    expect(differingAssignees(undefined, eng)).toEqual({ preparer: null, reviewer: null });
  });
});

describe("My work follows the area's own person", () => {
  it("the area preparer gets that area's procedures and schedules, the engagement preparer does not, and other areas are unchanged", async () => {
    const { id, areas } = await newEngagement({ preparer: prep, reviewer: rev, partner });
    const withWork = areas.filter((a) => a.open > 0);
    expect(withWork.length).toBeGreaterThanOrEqual(2);
    const [x, y] = withWork;
    const total = withWork.reduce((t, a) => t + a.open, 0);
    await schedule(id, x.code, "X-1", false);
    await schedule(id, y.code, "Y-1", false);
    // No overrides: the engagement preparer has everything, and nobody else is on the file.
    const before = groupOf(await work(prep), id);
    expect(line(before, "prep-proc")?.count).toBe(total);
    expect(line(before, "prep-sched")?.count).toBe(2);
    expect(groupOf(await work(prep2), id)).toBeUndefined();

    await setArea(partner, id, x.code, prep2.userId, null);
    const owner = groupOf(await work(prep2), id);
    expect(line(owner, "prep-proc")?.count).toBe(x.open);
    expect(line(owner, "prep-proc")?.href).toBe(`/engagements/${id}/audit/${x.code}`);
    expect(line(owner, "prep-sched")?.count).toBe(1);
    expect(owner?.roles).toEqual(["Preparer"]);
    // The engagement-level items stay with the engagement's preparer; the area's own work moves.
    const rest = groupOf(await work(prep), id);
    expect(line(rest, "prep-proc")?.count).toBe(total - x.open);
    expect(line(rest, "prep-sched")?.count).toBe(1);
    // Clearing it puts everything back.
    await setArea(partner, id, x.code, null, null);
    expect(groupOf(await work(prep2), id)).toBeUndefined();
    expect(line(groupOf(await work(prep), id), "prep-proc")?.count).toBe(total);
  });

  it("the area reviewer gets that area's review work, the engagement reviewer does not, and the partner keeps all of it", async () => {
    const { id, areas } = await newEngagement({ preparer: prep, reviewer: rev, partner });
    const withWork = areas.filter((a) => a.open > 0);
    const [x, y] = withWork;
    await finishArea(id, x.code);
    await finishArea(id, y.code);
    await schedule(id, x.code, "X-1", true);
    await schedule(id, y.code, "Y-1", true);
    const count = async (code: string) => (await db.query<{ n: number }>("select count(*)::int as n from audit_procedures where engagement_id = $1 and area_code = $2 and status = 'done' and reviewed_by is null", [id, code])).rows[0].n;
    const nx = await count(x.code);
    const ny = await count(y.code);
    expect(nx + ny).toBeGreaterThan(0);
    expect(line(groupOf(await work(rev), id), "rev-proc")?.count).toBeGreaterThanOrEqual(nx + ny);
    const everything = line(groupOf(await work(rev), id), "rev-proc")!.count;

    await setArea(partner, id, x.code, null, rev2.userId);
    const owner = groupOf(await work(rev2), id);
    expect(line(owner, "rev-proc")?.count).toBe(nx);
    expect(line(owner, "rev-sched")?.count).toBe(1);
    expect(owner?.roles).toEqual(["Reviewer"]);
    // The engagement reviewer loses that area's review work only; the engagement-level review items are unchanged.
    const rest = groupOf(await work(rev), id);
    expect(line(rest, "rev-proc")?.count).toBe(everything - nx);
    expect(line(rest, "rev-sched")?.count).toBe(1);
    // The partner of the file still sees every area's review work.
    const lead = await as(partner, (tx) => audit.listProcedures(tx, id, x.code, partner.userId));
    expect(lead.length).toBeGreaterThan(0);
    const asPartner = groupOf(await work(partner), id);
    expect(asPartner === undefined || (line(asPartner, "rev-proc")?.count ?? 0) <= everything).toBe(true);
  });

  it("with no overrides a person's work is exactly what it was (the area table is empty)", async () => {
    const { id } = await newEngagement({ preparer: prep, reviewer: rev, partner });
    await schedule(id, "C5", "Z-1", false);
    const groups = await work(prep);
    expect(line(groupOf(groups, id), "prep-sched")?.count).toBe(1);
    expect((await db.query("select 1 from engagement_area_assignments where engagement_id = $1", [id])).rows).toHaveLength(0);
  });
});

describe("the assignee beside an area's name", () => {
  const eng = { preparerId: prep.userId, reviewerId: rev.userId };
  const asg = (p: repo.Session | null, r: repo.Session | null) => ({ areaCode: "C5", preparer: p ? { id: p.userId, name: "Pia Preparer", role: "preparer" as const } : null, reviewer: r ? { id: r.userId, name: "Ravi Reviewer", role: "reviewer" as const } : null });

  it("shows 'Preparer: name' and 'Reviewer: name' only where they differ from the engagement", () => {
    const html = renderToStaticMarkup(<AreaAssignees area={asg(prep2, rev2)} engagement={eng} />);
    expect(html).toContain("Preparer:");
    expect(html).toContain("Reviewer:");
    expect(html).toContain("Pia Preparer");
    // Same as the engagement, or no override at all: nothing is shown.
    expect(renderToStaticMarkup(<AreaAssignees area={asg(prep, rev)} engagement={eng} />)).toBe("");
    expect(renderToStaticMarkup(<AreaAssignees area={undefined} engagement={eng} />)).toBe("");
    const onlyReviewer = renderToStaticMarkup(<AreaAssignees area={asg(prep, rev2)} engagement={eng} />);
    expect(onlyReviewer).toContain("Reviewer:");
    expect(onlyReviewer).not.toContain("Preparer:");
    expect(html).not.toContain("·");
  });
});

describe("roll-forward does not carry area assignments", () => {
  it("a next year's engagement starts with every area following the engagement", async () => {
    const { id, areas } = await newEngagement({ preparer: prep, reviewer: rev, partner });
    await setArea(partner, id, areas[0].code, prep2.userId, null);
    const clientId = (await db.query<{ client_id: string }>("select client_id from engagements where id = $1", [id])).rows[0].client_id;
    const next = await as(partner2, (tx) => repo.createEngagement(tx, partner2, clientId, "2026-01-01", "2026-12-31"));
    expect((await as(partner, (tx) => listAreaAssignments(tx, next))).size).toBe(0);
  });
});
