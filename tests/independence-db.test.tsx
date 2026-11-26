import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as review from "../src/server/review";
import { assignTeam } from "../src/server/engagement-team";
import { setAreaAssignment } from "../src/server/area-assignments";
import { getIndependence, recordConclusion, recordConfirmation } from "../src/server/independence";
import { getMyWork } from "../src/server/my-work";
import { CHECK_LABEL, confirmationKey, DECLARATION, independenceCheck, NOT_ON_TEAM, ONLY_PARTNER, ONLY_YOURSELF, statusWords, THREATS_NEEDED, type Independence } from "../src/domain/independence";
import { IndependenceSection } from "../src/ui/independence-section";
import { IndependenceWarning } from "../src/ui/independence-warning";
import type { WorkGroup } from "../src/domain/my-work";

// Invented firms and people.
const A = "aaaaaaaa-9090-4000-8000-000000000001";
const B = "bbbbbbbb-9090-4000-8000-000000000001";
const user = (firm: string, n: number, role: repo.Session["role"]): repo.Session => ({ firmId: firm, userId: `${firm.slice(0, 8)}-9090-4000-8000-00000000007${n}`, role });
const prep = user(A, 1, "preparer");
const rev = user(A, 2, "reviewer");
const partner = user(A, 3, "partner");
const partner2 = user(A, 4, "partner");
const areaPrep = user(A, 5, "preparer");
const bystander = user(A, 6, "preparer");
const outsider = user(B, 1, "partner");
const TODAY = "2026-03-01";
const TB = [
  { code: "1000", name: "Bank - current account", closingMinor: 1500000, priorMinor: 1200000 },
  { code: "3000", name: "Share capital", closingMinor: -500000, priorMinor: -500000 },
  { code: "4000", name: "Sales", closingMinor: -1000000, priorMinor: -700000 },
];
const NAMES: Record<string, string> = { [prep.userId]: "Pru Preparer", [rev.userId]: "Ravi Reviewer", [partner.userId]: "Pia Partner", [partner2.userId]: "Omar Partner", [areaPrep.userId]: "Ari Area", [bystander.userId]: "Bo Bystander" };

let db: Db;
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
let n = 0;
const confirm = (s: repo.Session, id: string, stage: "planning" | "completion", extra: Partial<Parameters<typeof recordConfirmation>[3]> = {}) =>
  as(s, (tx) => recordConfirmation(tx, s, id, { stage, outcome: "confirmed", threats: "", safeguards: "", ...extra }));
const conclude = (s: repo.Session, id: string, stage: "planning" | "completion", conclusion = "met", note = "Invented note.") => as(s, (tx) => recordConclusion(tx, s, id, { stage, conclusion, note }));
const state = (id: string) => as(partner, (tx) => getIndependence(tx, id));
const lineOf = async (s: repo.Session, id: string) => (await as(s, (tx) => getMyWork(tx, s, TODAY))).find((g: WorkGroup) => g.engagementId === id)?.lines.find((l) => l.key.endsWith(":independence"));
const audits = async (action: string, id: string) => (await db.query<{ detail: Record<string, unknown>; user_id: string }>("select detail, user_id from audit_log where action = $1 and entity_id = $2 order by id", [action, id])).rows;

/** A first engagement with a trial balance, a team of three, and an area preparer on C5. */
async function engagement(): Promise<string> {
  const id = await as(partner, async (tx) => {
    const client = await repo.createClient(tx, partner, `Independence Trading ${++n} LLC`);
    const e = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
    await repo.importTrialBalance(tx, partner, e, "tb.xlsx", TB);
    await repo.approveAllMappings(tx, partner, e);
    return e;
  });
  await as(partner, (tx) => assignTeam(tx, partner, id, { preparerId: prep.userId, reviewerId: rev.userId, partnerId: partner.userId, reportDueOn: null }));
  await as(partner, (tx) => setAreaAssignment(tx, partner, id, { areaCode: "C5", preparerId: areaPrep.userId, reviewerId: null }));
  return id;
}

beforeAll(async () => {
  db = await openDatabase();
  for (const f of [A, B]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [f]);
  for (const u of [prep, rev, partner, partner2, areaPrep, bystander, outsider]) {
    await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, NAMES[u.userId] ?? "Other Partner", u.role]);
  }
});
afterAll(async () => {
  await db.close();
});

describe("the migration", () => {
  it("is 0042, append-only for the application role, and another firm sees none", async () => {
    expect((await db.query("select 1 from schema_migrations where name = $1", ["0042_independence_confirmations.sql"])).rows).toHaveLength(1);
    const id = await engagement();
    await confirm(prep, id, "planning");
    await conclude(partner, id, "planning");
    const app = (s: repo.Session, sql: string, params: unknown[] = []) =>
      db.transaction(async (tx) => {
        await tx.exec("set local role app_user");
        await tx.query("select set_config('app.firm_id', $1, true)", [s.firmId]);
        return tx.query(sql, params);
      });
    for (const t of ["independence_confirmations", "independence_conclusions"]) {
      await expect(app(partner, `update ${t} set recorded_at = now()`)).rejects.toThrow(/permission denied/);
      await expect(app(partner, `delete from ${t}`)).rejects.toThrow(/permission denied/);
      expect((await app(outsider, `select 1 from ${t}`)).rows).toHaveLength(0);
    }
  });
});

describe("who confirms", () => {
  it("is the preparer, reviewer, partner and every area person who is set, active users only", async () => {
    const id = await engagement();
    const i = await state(id);
    expect(i.members.map((m) => m.id).sort()).toEqual([prep.userId, rev.userId, partner.userId, areaPrep.userId].sort());
    expect(i.members.find((m) => m.id === areaPrep.userId)!.places).toEqual(["Area preparer"]);
    expect(i.partnerId).toBe(partner.userId);
    await db.query("update users set active = false where id = $1", [areaPrep.userId]);
    expect((await state(id)).members.map((m) => m.id)).not.toContain(areaPrep.userId);
    await db.query("update users set active = true where id = $1", [areaPrep.userId]);
  });

  it("each records only for themselves; the latest row is current; each record is audit-logged", async () => {
    const id = await engagement();
    await confirm(areaPrep, id, "planning");
    expect(statusWords((await state(id)).latest.get(confirmationKey(areaPrep.userId, "planning")))).toMatch(/^Confirmed \d{4}-\d{2}-\d{2}$/);
    await confirm(areaPrep, id, "planning", { outcome: "threats_noted", threats: "A relative works there.", safeguards: "Another person reviews the area." });
    const now = (await state(id)).latest.get(confirmationKey(areaPrep.userId, "planning"))!;
    expect(statusWords(now)).toMatch(/^Threats noted \d{4}-\d{2}-\d{2}$/);
    expect(now).toMatchObject({ threats: "A relative works there.", safeguards: "Another person reviews the area." });
    expect((await db.query("select 1 from independence_confirmations where engagement_id = $1", [id])).rows).toHaveLength(2);
    const log = await audits("independence_confirm", id);
    expect(log.map((l) => l.user_id)).toEqual([areaPrep.userId, areaPrep.userId]);
    expect(log[1].detail).toMatchObject({ stage: "planning", outcome: "threats_noted", threats: "A relative works there." });
    expect(statusWords(undefined)).toBe("Not confirmed");
  });

  it("refuses a person not on the team, recording for another person, threats without text, a long text, a locked file and another firm", async () => {
    const id = await engagement();
    await expect(confirm(bystander, id, "planning")).rejects.toThrow(NOT_ON_TEAM);
    await expect(confirm(prep, id, "planning", { forUserId: rev.userId })).rejects.toThrow(ONLY_YOURSELF);
    await expect(confirm(partner, id, "planning", { forUserId: prep.userId })).rejects.toThrow(ONLY_YOURSELF);
    for (const bad of [{ threats: "", safeguards: "" }, { threats: "Something.", safeguards: "  " }, { threats: " ", safeguards: "Something." }]) {
      await expect(confirm(prep, id, "planning", { outcome: "threats_noted", ...bad })).rejects.toThrow(THREATS_NEEDED);
    }
    await expect(confirm(prep, id, "planning", { outcome: "threats_noted", threats: "x".repeat(2001), safeguards: "y" })).rejects.toThrow(/too long/);
    await expect(confirm(prep, id, "interim" as "planning")).rejects.toThrow(/planning or completion/);
    await expect(confirm(outsider, id, "planning")).rejects.toThrow(/Engagement not found/);
    expect((await db.query("select 1 from independence_confirmations where engagement_id = $1", [id])).rows).toHaveLength(0);
    await db.query("update engagements set status = 'locked' where id = $1", [id]);
    await expect(confirm(prep, id, "planning")).rejects.toThrow(/This engagement is locked/);
    expect(await audits("independence_confirm", id)).toHaveLength(0);
  });
});

describe("the partner's conclusion", () => {
  it("may be recorded only by the engagement partner, who must still hold partner rights, with a note", async () => {
    const id = await engagement();
    for (const who of [prep, rev, partner2, bystander]) await expect(conclude(who, id, "planning")).rejects.toThrow(ONLY_PARTNER);
    await expect(conclude(outsider, id, "planning")).rejects.toThrow(/Engagement not found/);
    await expect(conclude(partner, id, "planning", "met", "  ")).rejects.toThrow(/Add a note/);
    await expect(conclude(partner, id, "planning", "maybe")).rejects.toThrow(/Choose a conclusion/);
    await db.query("update users set role = 'reviewer' where id = $1", [partner.userId]);
    await expect(conclude(partner, id, "planning")).rejects.toThrow(ONLY_PARTNER);
    await db.query("update users set role = 'partner' where id = $1", [partner.userId]);
    await conclude(partner, id, "planning", "not_met", "A conflict is being resolved.");
    await conclude(partner, id, "planning", "met", "Resolved.");
    const i = await state(id);
    expect(i.conclusions.planning).toMatchObject({ conclusion: "met", note: "Resolved.", by: "Pia Partner" });
    expect(i.conclusions.completion).toBeUndefined();
    expect(await audits("independence_conclude", id)).toHaveLength(2);
    await db.query("update engagements set status = 'locked' where id = $1", [id]);
    await expect(conclude(partner, id, "completion")).rejects.toThrow(/This engagement is locked/);
  });
});

describe("My work", () => {
  it("shows one line until the person has confirmed both stages, for each team member including area people, and never for others", async () => {
    const id = await engagement();
    for (const who of [prep, rev, partner, areaPrep]) expect((await lineOf(who, id))?.label).toBe("Independence not confirmed");
    expect(await lineOf(bystander, id)).toBeUndefined();
    await confirm(prep, id, "planning");
    expect(await lineOf(prep, id)).toBeDefined();
    await confirm(prep, id, "completion");
    expect(await lineOf(prep, id)).toBeUndefined();
    expect(await lineOf(rev, id)).toBeDefined();
    await db.query("update engagements set status = 'locked' where id = $1", [id]);
    expect(await lineOf(rev, id)).toBeUndefined();
  });
});

describe("the lock check", () => {
  it("lists who is missing at each stage and whether the partner concluded, and never blocks the lock", async () => {
    const id = await engagement();
    const before = independenceCheck(await state(id));
    expect(before).toMatchObject({ label: CHECK_LABEL, passed: false, severity: "warning" });
    expect(before.items!.join("\n")).toContain("Planning: not confirmed by");
    expect(before.items!.join("\n")).toContain("Completion: not confirmed by");
    expect(before.items!.join("\n")).toContain("Planning: the partner has not concluded");
    for (const who of [prep, rev, partner, areaPrep]) for (const stage of ["planning", "completion"] as const) await confirm(who, id, stage);
    await conclude(partner, id, "planning");
    const part = independenceCheck(await state(id));
    expect(part.items).toEqual(["Completion: the partner has not concluded"]);
    await conclude(partner, id, "completion", "not_met", "Not yet.");
    expect(independenceCheck(await state(id)).items).toEqual(["Completion: the partner concluded that the requirements are not met"]);
    await conclude(partner, id, "completion", "met", "Now met.");
    expect(independenceCheck(await state(id))).toMatchObject({ passed: true });

    // Someone missing never blocks the lock.
    const missing = await engagement();
    const sheets = (await as(prep, (tx) => review.getOverview(tx, missing)))!.leadSheets;
    for (const s of sheets) {
      await as(prep, (tx) => review.signOff(tx, prep, missing, s.groupCode, "preparer"));
      await as(rev, (tx) => review.signOff(tx, rev, missing, s.groupCode, "reviewer"));
    }
    expect(independenceCheck(await state(missing)).passed).toBe(false);
    expect((await as(partner, (tx) => review.getOverview(tx, missing)))!.readiness).toMatchObject({ ready: true, blockers: [] });
    await as(partner, (tx) => review.lockEngagement(tx, partner, missing));
    expect((await as(partner, (tx) => review.getOverview(tx, missing)))!.status).toBe("locked");
  });

  it("says when no one, or no partner, is on the team", () => {
    const empty: Independence = { members: [], partnerId: null, latest: new Map(), conclusions: {} };
    expect(independenceCheck(empty).items).toEqual(expect.arrayContaining(["No one is on the engagement team.", "No engagement partner is assigned."]));
  });

  it("shows the warning with what is missing, saying 'Needs attention' once, and a quiet passed line when all is recorded", () => {
    const html = renderToStaticMarkup(<IndependenceWarning check={{ label: CHECK_LABEL, passed: false, severity: "warning", items: ["Planning: not confirmed by Pru Preparer"] }} />);
    expect(html.split("Needs attention")).toHaveLength(2);
    expect(html).toContain("Planning: not confirmed by Pru Preparer");
    expect(html).toContain("does not stop the file being locked");
    const passed = renderToStaticMarkup(<IndependenceWarning check={{ label: CHECK_LABEL, passed: true, severity: "warning" }} />);
    expect(passed).toContain("Passed");
    expect(passed).not.toContain("Needs attention");
  });
});

describe("the section", () => {
  it("shows each member's status, the draft declaration above the button, and the forms only to the right people", async () => {
    const id = await engagement();
    await confirm(prep, id, "planning", { outcome: "threats_noted", threats: "Invented threat.", safeguards: "Invented safeguard." });
    await conclude(partner, id, "planning", "met", "Invented conclusion note.");
    const data = await state(id);
    const render = (userId: string, open = true) => renderToStaticMarkup(<IndependenceSection engagementId={id} data={data} userId={userId} open={open} />);
    const mine = render(prep.userId);
    expect(mine).toContain("Independence");
    expect(mine).toContain("Pru Preparer");
    expect(mine).toContain("Ari Area");
    expect(mine).toContain("Threats noted");
    expect(mine).toContain("Invented threat.");
    expect(mine).toContain("Invented safeguard.");
    expect(mine).toContain("Not confirmed");
    expect(mine).toContain("Independence requirements are met for this engagement");
    expect(mine).toContain("Unreviewed draft wording");
    expect(mine).toContain(DECLARATION.replace(/'/g, "&#x27;"));
    expect(mine.indexOf("Unreviewed draft wording")).toBeLessThan(mine.indexOf("Record my confirmation"));
    expect(mine).not.toContain("Record the partner");
    expect(mine).not.toContain("·");
    expect(render(partner.userId)).toContain("Record the partner");
    expect(render(bystander.userId)).not.toContain("Record my confirmation");
    const locked = render(prep.userId, false);
    expect(locked).not.toContain("Record my confirmation");
    expect(locked).toContain("Invented threat.");
  });
});

describe("roll-forward", () => {
  it("carries nothing: each year is confirmed again", async () => {
    const id = await engagement();
    await confirm(prep, id, "planning");
    await conclude(partner, id, "planning");
    const clientId = (await db.query<{ client_id: string }>("select client_id from engagements where id = $1", [id])).rows[0].client_id;
    const next = await as(partner, (tx) => repo.createEngagement(tx, partner, clientId, "2026-01-01", "2026-12-31"));
    const i = await state(next);
    expect(i.latest.size).toBe(0);
    expect(i.conclusions).toEqual({});
    expect((await db.query("select 1 from independence_confirmations where engagement_id = $1", [next])).rows).toHaveLength(0);
  });
});
