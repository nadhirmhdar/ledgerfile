import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as review from "../src/server/review";
import { assignTeam } from "../src/server/engagement-team";
import { setAreaAssignment } from "../src/server/area-assignments";
import { getEqReview, setEqReview, signEqReview, withdrawEqReview } from "../src/server/eq-review";
import { approve } from "../src/server/partner-approvals";
import { LOCK_CHECK_LABEL } from "../src/domain/partner-approvals";
import * as audit from "../src/server/audit";
import { rollForward } from "../src/server/rollforward";
import { getMyWork } from "../src/server/my-work";
import { EQ_LOCK_LABEL, EQ_NOT_ON, EQ_NOT_REVIEWER, EQ_ONLY_NAMED, EQ_ON_TEAM, EQ_OTHER_CHECKS, EQ_SET_REFUSAL, eqSummary, NO_EQ_REVIEWER } from "../src/domain/eq-review";
import { PERSON_REFUSAL } from "../src/domain/my-work";
import { explainBlocker } from "../src/ui/engagement-home";
import { EqReviewSection } from "../src/ui/eq-review-section";

// Invented firms and people.
const A = "aaaaaaaa-9292-4000-8000-000000000001";
const B = "bbbbbbbb-9292-4000-8000-000000000001";
const user = (firm: string, n: number, role: repo.Session["role"]): repo.Session => ({ firmId: firm, userId: `${firm.slice(0, 8)}-9292-4000-8000-00000000009${n}`, role });
const prep = user(A, 1, "preparer");
const rev = user(A, 2, "reviewer");
const partner = user(A, 3, "partner");
const eqr = user(A, 4, "reviewer");
const eqr2 = user(A, 5, "partner");
const admin = user(A, 6, "admin");
const gone = user(A, 7, "reviewer");
const outsider = user(B, 1, "partner");
const NAMES: Record<string, string> = { [eqr.userId]: "Eli Reviewer", [eqr2.userId]: "Omar Second", [prep.userId]: "Pru Preparer" };
const TODAY = "2026-03-01";
const TB = [
  { code: "1000", name: "Bank - current account", closingMinor: 1500000, priorMinor: 1200000 },
  { code: "3000", name: "Share capital", closingMinor: -500000, priorMinor: -500000 },
  { code: "4000", name: "Sales", closingMinor: -1000000, priorMinor: -700000 },
];

let db: Db;
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
let n = 0;
const set = (s: repo.Session, id: string, required: boolean, reviewerId: string | null) => as(s, (tx) => setEqReview(tx, s, id, { required, reviewerId }));
const sign = (s: repo.Session, id: string, note = "") => as(s, (tx) => signEqReview(tx, s, id, note, () => review.otherLockBlockers(tx, id)));
const state = (id: string) => as(partner, (tx) => getEqReview(tx, id));
const blockers = async (id: string) => (await as(partner, (tx) => review.getOverview(tx, id)))!.readiness.blockers;
const eqLine = async (s: repo.Session, id: string) => (await as(s, (tx) => getMyWork(tx, s, TODAY))).find((g) => g.engagementId === id)?.lines.find((l) => l.key.endsWith(":eq"));
const audits = async (action: string, id: string) => (await db.query<{ detail: Record<string, unknown>; user_id: string }>("select detail, user_id from audit_log where action = $1 and entity_id = $2 order by id", [action, id])).rows;

async function engagement(start = "2025-01-01", end = "2025-12-31"): Promise<{ id: string; clientId: string }> {
  const made = await as(partner, async (tx) => {
    const clientId = await repo.createClient(tx, partner, `Quality Trading ${++n} LLC`);
    const id = await repo.createEngagement(tx, partner, clientId, start, end);
    await repo.importTrialBalance(tx, partner, id, "tb.xlsx", TB);
    await repo.approveAllMappings(tx, partner, id);
    return { id, clientId };
  });
  await as(partner, (tx) => assignTeam(tx, partner, made.id, { preparerId: prep.userId, reviewerId: rev.userId, partnerId: partner.userId, reportDueOn: null }));
  return made;
}
async function signSheets(id: string) {
  const sheets = (await as(prep, (tx) => review.getOverview(tx, id)))!.leadSheets;
  for (const s of sheets) {
    await as(prep, (tx) => review.signOff(tx, prep, id, s.groupCode, "preparer"));
    await as(rev, (tx) => review.signOff(tx, rev, id, s.groupCode, "reviewer"));
  }
}

beforeAll(async () => {
  db = await openDatabase();
  for (const f of [A, B]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [f]);
  for (const u of [prep, rev, partner, eqr, eqr2, admin, gone, outsider]) {
    await db.query("insert into users (id, firm_id, email, name, role, active) values ($1, $2, $3, $4, $5, $6)", [u.userId, u.firmId, `${u.userId}@x.test`, NAMES[u.userId] ?? `${u.role} ${u.userId.slice(-1)}`, u.role, u !== gone]);
  }
});
afterAll(async () => {
  await db.close();
});

describe("the migration", () => {
  it("is 0044: off by default on every existing engagement, and the note has a length limit", async () => {
    expect((await db.query("select 1 from schema_migrations where name = $1", ["0044_eq_review.sql"])).rows).toHaveLength(1);
    const { id } = await engagement();
    expect(await state(id)).toEqual({ required: false, reviewer: null, reviewerOnTeam: false, signed: null });
    await expect(db.query("update engagements set eq_note = $2 where id = $1", [id, "x".repeat(2001)])).rejects.toThrow(/violates check/);
  });
});

describe("setting it", () => {
  it("is for a partner or administrator; the reviewer must be an active reviewer-level person who is not on the team", async () => {
    const { id } = await engagement();
    await as(partner, (tx) => setAreaAssignment(tx, partner, id, { areaCode: "C5", preparerId: admin.userId, reviewerId: null }));
    for (const who of [prep, rev, eqr]) await expect(set(who, id, true, eqr.userId)).rejects.toThrow(EQ_SET_REFUSAL);
    await expect(set({ ...prep, role: "admin" }, id, true, eqr.userId)).rejects.toThrow(EQ_SET_REFUSAL);
    await expect(set(outsider, id, true, null)).rejects.toThrow(/Engagement not found/);
    await expect(set(partner, id, true, outsider.userId)).rejects.toThrow(PERSON_REFUSAL);
    await expect(set(partner, id, true, gone.userId)).rejects.toThrow(PERSON_REFUSAL);
    await expect(set(partner, id, true, "not-a-person")).rejects.toThrow(PERSON_REFUSAL);
    // Team members of any kind are refused: preparer, reviewer, partner and an area person.
    await expect(set(partner, id, true, prep.userId)).rejects.toThrow(EQ_NOT_REVIEWER);
    await expect(set(partner, id, true, rev.userId)).rejects.toThrow(EQ_ON_TEAM);
    await expect(set(partner, id, true, partner.userId)).rejects.toThrow(EQ_ON_TEAM);
    await expect(set(partner, id, true, admin.userId)).rejects.toThrow(EQ_ON_TEAM);
    await set(admin, id, true, eqr.userId);
    expect((await state(id)).reviewer).toMatchObject({ id: eqr.userId, name: "Eli Reviewer" });
    expect((await set(partner, id, true, eqr.userId)).changed).toBe(false);
    await set(partner, id, true, eqr2.userId);
    await set(partner, id, false, eqr2.userId);
    expect(await state(id)).toMatchObject({ required: false, reviewer: null, signed: null });
    const log = await audits("eq_review_set", id);
    expect(log).toHaveLength(3);
    expect(log[0].detail).toMatchObject({ before: { required: false, reviewer: null }, after: { required: true, reviewer: { id: eqr.userId } } });
    expect(log[2].detail).toMatchObject({ before: { required: true }, after: { required: false, reviewer: null } });
  });

  it("is refused on a locked or archived engagement", async () => {
    const { id } = await engagement();
    await db.query("update engagements set status = 'locked' where id = $1", [id]);
    await expect(set(partner, id, true, eqr.userId)).rejects.toThrow(/This engagement is locked/);
  });
});

describe("signing", () => {
  it("is for the named reviewer only, after every other lock check passes, and can be withdrawn", async () => {
    const { id } = await engagement();
    await expect(sign(eqr, id)).rejects.toThrow(EQ_NOT_ON);
    await set(partner, id, true, eqr.userId);
    for (const who of [partner, eqr2, rev]) await expect(sign(who, id)).rejects.toThrow(EQ_ONLY_NAMED);
    await expect(sign(outsider, id)).rejects.toThrow(/Engagement not found/);
    // The other checks (lead sheet sign-offs) have not passed yet.
    await expect(sign(eqr, id)).rejects.toThrow(EQ_OTHER_CHECKS);
    await signSheets(id);
    await expect(sign(eqr, id, "x".repeat(2001))).rejects.toThrow(/too long/);
    await sign(eqr, id, "  The judgements are supported.  ");
    expect((await state(id)).signed).toMatchObject({ by: "Eli Reviewer", note: "The judgements are supported." });
    await expect(sign(eqr, id)).rejects.toThrow(/already signed/);
    await expect(as(eqr2, (tx) => withdrawEqReview(tx, eqr2, id))).rejects.toThrow(EQ_ONLY_NAMED);
    await as(eqr, (tx) => withdrawEqReview(tx, eqr, id));
    expect((await state(id)).signed).toBeNull();
    await sign(eqr, id);
    expect(await audits("eq_review_sign", id)).toHaveLength(2);
    expect(await audits("eq_review_withdraw", id)).toHaveLength(1);
    // Choosing another reviewer clears the signature, which belongs to the person who gave it.
    await set(partner, id, true, eqr2.userId);
    expect((await state(id)).signed).toBeNull();
  });
});

describe("signing waits for the partner's approvals", () => {
  it("counts the partner-approval check among the other checks that must pass on an audited engagement", async () => {
    const { id } = await engagement();
    await as(partner, (tx) => audit.setAuditEnabled(tx, partner, id, true));
    await signSheets(id);
    await set(partner, id, true, eqr.userId);
    // Without the approvals the EQ reviewer is refused, and the refusal names the approval check.
    expect(await as(eqr, (tx) => review.otherLockBlockers(tx, id))).toContain(LOCK_CHECK_LABEL);
    await expect(sign(eqr, id)).rejects.toThrow(LOCK_CHECK_LABEL);
    expect((await state(id)).signed).toBeNull();
    // Both checks stand side by side in the lock list.
    const both = await blockers(id);
    expect(both.some((b) => b.startsWith(LOCK_CHECK_LABEL))).toBe(true);
    expect(both.some((b) => b.startsWith(EQ_LOCK_LABEL))).toBe(true);
    // Once the partner has approved, the approval check no longer stands in the way (other audit work still may).
    await as(partner, (tx) => approve(tx, partner, id, "acceptance"));
    await as(partner, (tx) => approve(tx, partner, id, "planning"));
    expect((await as(eqr, (tx) => review.otherLockBlockers(tx, id))) ?? "").not.toContain(LOCK_CHECK_LABEL);
  });
});

describe("the lock", () => {
  it("is refused while on and unsigned or without a reviewer, and when the reviewer has joined the team; allowed once signed", async () => {
    const { id } = await engagement();
    await signSheets(id);
    await set(partner, id, true, null);
    expect(await blockers(id)).toEqual([`${EQ_LOCK_LABEL}: ${NO_EQ_REVIEWER}.`]);
    await set(partner, id, true, eqr.userId);
    expect(await blockers(id)).toEqual([`${EQ_LOCK_LABEL}: Eli Reviewer has not signed.`]);
    expect(explainBlocker((await blockers(id))[0], id)).toMatchObject({ href: expect.stringContaining(`/engagements/${id}`) });
    await expect(as(partner, (tx) => review.lockEngagement(tx, partner, id))).rejects.toThrow(EQ_LOCK_LABEL);
    await sign(eqr, id);
    expect(await blockers(id)).toEqual([]);
    // The team changes so that the EQ reviewer is on it: the lock fails with that reason and nothing is cleared.
    await as(partner, (tx) => assignTeam(tx, partner, id, { preparerId: prep.userId, reviewerId: eqr.userId, partnerId: partner.userId, reportDueOn: null }));
    expect((await blockers(id)).some((b) => b.includes("Eli Reviewer is now on the engagement team"))).toBe(true);
    expect((await state(id)).signed).not.toBeNull();
    await expect(as(partner, (tx) => review.lockEngagement(tx, partner, id))).rejects.toThrow(/now on the engagement team/);
    await as(partner, (tx) => assignTeam(tx, partner, id, { preparerId: prep.userId, reviewerId: rev.userId, partnerId: partner.userId, reportDueOn: null }));
    // Changing the team can remove sign-offs elsewhere, so the check that matters here is the EQ one.
    expect((await blockers(id)).some((b) => b.startsWith(EQ_LOCK_LABEL))).toBe(false);
  });

  it("changes nothing while off", async () => {
    const { id } = await engagement();
    await signSheets(id);
    expect(await blockers(id)).toEqual([]);
    await as(partner, (tx) => review.lockEngagement(tx, partner, id));
    expect((await as(partner, (tx) => review.getOverview(tx, id)))!.status).toBe("locked");
  });
});

describe("My work", () => {
  it("gives the named reviewer a 'Quality review' line while it is on and unsigned, even though they are not on the team", async () => {
    const { id } = await engagement();
    expect(await eqLine(eqr, id)).toBeUndefined();
    await set(partner, id, true, eqr.userId);
    expect((await eqLine(eqr, id))?.label).toBe("Quality review");
    expect(await eqLine(eqr2, id)).toBeUndefined();
    await signSheets(id);
    await sign(eqr, id);
    expect(await eqLine(eqr, id)).toBeUndefined();
  });
});

describe("the next year", () => {
  it("carries on/off and the reviewer, never the sign-off, by both ways of creating it", async () => {
    for (const how of ["single", "bulk"] as const) {
      const { id, clientId } = await engagement("2024-01-01", "2024-12-31");
      await set(partner, id, true, eqr.userId);
      await signSheets(id);
      await sign(eqr, id, "Signed last year.");
      const next =
        how === "single"
          ? await as(partner, (tx) => repo.createEngagement(tx, partner, clientId, "2025-01-01", "2025-12-31"))
          : (await as(partner, (tx) => rollForward(tx, partner, [{ clientId, start: "2025-01-01", end: "2025-12-31" }], TODAY)))[0].engagementId;
      expect(await state(next)).toMatchObject({ required: true, reviewer: { id: eqr.userId }, signed: null });
    }
    const off = await engagement("2024-01-01", "2024-12-31");
    const next = await as(partner, (tx) => repo.createEngagement(tx, partner, off.clientId, "2025-01-01", "2025-12-31"));
    expect(await state(next)).toMatchObject({ required: false, reviewer: null });
  });
});

describe("the words and the section", () => {
  const people = [
    { id: eqr.userId, name: "Eli Reviewer", role: "reviewer" as const },
    { id: eqr2.userId, name: "Omar Second", role: "partner" as const },
    { id: prep.userId, name: "Pru Preparer", role: "preparer" as const },
  ];
  const off = { required: false, reviewer: null, reviewerOnTeam: false, signed: null };
  const waiting = { required: true, reviewer: { id: eqr.userId, name: "Eli Reviewer" }, reviewerOnTeam: false, signed: null };
  const render = (r: Parameters<typeof eqSummary>[0], opts: { userId?: string; canSet?: boolean; open?: boolean; teamIds?: string[] } = {}) =>
    renderToStaticMarkup(<EqReviewSection engagementId="e" review={r} userId={opts.userId ?? prep.userId} canSet={opts.canSet ?? false} open={opts.open ?? true} people={people} teamIds={opts.teamIds ?? []} />);

  it("says off, or on with the reviewer and whether signed", () => {
    expect(eqSummary(off)).toBe("Engagement quality review: off");
    expect(eqSummary(waiting)).toBe("Engagement quality review: on, reviewer Eli Reviewer, not yet signed");
    expect(eqSummary({ ...waiting, signed: { by: "Eli Reviewer", at: "2026-02-02", note: null } })).toBe("Engagement quality review: on, reviewer Eli Reviewer, signed 2026-02-02");
    expect(render(off)).toContain("Engagement quality review: off");
  });

  it("offers the setting to a partner or administrator without team members, and the sign form to the named reviewer only", () => {
    const setting = render(waiting, { canSet: true, teamIds: [eqr2.userId] });
    expect(setting).toContain("Save quality review");
    expect(setting).toContain("Eli Reviewer (Reviewer)");
    expect(setting).not.toContain("Omar Second (");
    expect(setting).not.toContain("Pru Preparer (Preparer)");
    expect(setting).not.toContain("Sign the quality review");
    expect(render(waiting, { userId: eqr.userId })).toContain("Sign the quality review");
    expect(render(waiting, { userId: eqr.userId, open: false })).not.toContain("Sign the quality review");
    expect(render(waiting)).not.toContain("<form");
    expect(render(waiting)).not.toContain("·");
  });
});
