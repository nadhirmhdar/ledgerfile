import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import { assertionsOf, AREA_BY_CODE } from "../src/domain/audit";
import * as review from "../src/server/review";
import { assignTeam } from "../src/server/engagement-team";
import { approve, getApprovals, withdrawApproval } from "../src/server/partner-approvals";
import { getMyWork } from "../src/server/my-work";
import { approvalsBlocker, approvalWords, ASSIGN_PARTNER_FIRST, LOCK_CHECK_LABEL, NOT_YET, ONLY_ENGAGEMENT_PARTNER, type Approvals } from "../src/domain/partner-approvals";
import { explainBlocker } from "../src/ui/engagement-home";
import { PartnerApprovalsSection } from "../src/ui/partner-approvals-section";

// Invented firms and people.
const A = "aaaaaaaa-9191-4000-8000-000000000001";
const B = "bbbbbbbb-9191-4000-8000-000000000001";
const user = (firm: string, n: number, role: repo.Session["role"]): repo.Session => ({ firmId: firm, userId: `${firm.slice(0, 8)}-9191-4000-8000-00000000008${n}`, role });
const prep = user(A, 1, "preparer");
const rev = user(A, 2, "reviewer");
const partner = user(A, 3, "partner");
const partner2 = user(A, 4, "partner");
const admin = user(A, 5, "admin");
const outsider = user(B, 1, "partner");
const TODAY = "2026-03-01";
const TB = [
  { code: "1000", name: "Bank - current account", closingMinor: 15000000, priorMinor: 10000000 },
  { code: "3000", name: "Share capital", closingMinor: -5000000, priorMinor: -5000000 },
  { code: "4000", name: "Sales", closingMinor: -10000000, priorMinor: -5000000 },
];

let db: Db;
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
let n = 0;
const ok = (s: repo.Session, id: string, kind: string) => as(s, (tx) => approve(tx, s, id, kind));
const undo = (s: repo.Session, id: string, kind: string) => as(s, (tx) => withdrawApproval(tx, s, id, kind));
const state = (id: string) => as(partner, (tx) => getApprovals(tx, id));
const blockers = async (id: string) => (await as(partner, (tx) => review.getOverview(tx, id)))!.readiness.blockers;
const lines = async (s: repo.Session, id: string) => ((await as(s, (tx) => getMyWork(tx, s, TODAY))).find((g) => g.engagementId === id)?.lines ?? []).filter((l) => l.key.includes(":approve-")).map((l) => l.label);
const audits = async (action: string, id: string) => (await db.query<{ detail: Record<string, unknown>; user_id: string }>("select detail, user_id from audit_log where action = $1 and entity_id = $2 order by id", [action, id])).rows;
const materiality = (id: string, percentageBp = 100) =>
  as(rev, (tx) => audit.setMateriality(tx, rev, id, { benchmark: "revenue", percentageBp, performancePct: 75, trivialPct: 5, rationale: "Invented rationale for the approval tests." }));

async function engagement(opts: { audited?: boolean; partner?: repo.Session | null } = {}): Promise<string> {
  const id = await as(partner, async (tx) => {
    const client = await repo.createClient(tx, partner, `Approval Trading ${++n} LLC`);
    const e = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
    await repo.importTrialBalance(tx, partner, e, "tb.xlsx", TB);
    await repo.approveAllMappings(tx, partner, e);
    if (opts.audited !== false) await audit.setAuditEnabled(tx, partner, e, true);
    return e;
  });
  const p = opts.partner === undefined ? partner : opts.partner;
  await as(partner, (tx) => assignTeam(tx, partner, id, { preparerId: prep.userId, reviewerId: rev.userId, partnerId: p?.userId ?? null, reportDueOn: null }));
  return id;
}

beforeAll(async () => {
  db = await openDatabase();
  for (const f of [A, B]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [f]);
  for (const u of [prep, rev, partner, partner2, admin, outsider]) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, u === partner ? "Pia Partner" : `${u.role} ${u.userId.slice(-1)}`, u.role]);
});
afterAll(async () => {
  await db.close();
});

describe("the migration", () => {
  it("is 0043: nullable columns on engagements, with no backfill, and the purge functions untouched", async () => {
    expect((await db.query("select 1 from schema_migrations where name = $1", ["0043_partner_approvals.sql"])).rows).toHaveLength(1);
    const cols = (await db.query<{ c: string; n: string }>("select column_name as c, is_nullable as n from information_schema.columns where table_name = 'engagements' and column_name like any (array['acceptance\\_%', 'planning\\_%']) order by 1")).rows;
    expect(cols.map((c) => c.c)).toEqual(["acceptance_approved_at", "acceptance_approved_by", "planning_approved_at", "planning_approved_by", "planning_approved_materiality_id", "planning_approved_risk_digest"]);
    expect(cols.every((c) => c.n === "YES")).toBe(true);
    const id = await engagement();
    expect(await state(id)).toEqual({ acceptance: null, planning: null });
  });
});

describe("approving and withdrawing", () => {
  it("is for the engagement partner only, and records the date and name, with an audit entry for each", async () => {
    const id = await engagement();
    for (const who of [partner2, rev, prep, admin]) await expect(ok(who, id, "acceptance")).rejects.toThrow(ONLY_ENGAGEMENT_PARTNER);
    await expect(ok(outsider, id, "acceptance")).rejects.toThrow(/Engagement not found/);
    await ok(partner, id, "acceptance");
    const a = (await state(id)).acceptance!;
    expect(a).toMatchObject({ by: "Pia Partner", stale: null });
    expect(approvalWords(a)).toMatch(/^Approved by Pia Partner on \d{4}-\d{2}-\d{2}$/);
    await expect(ok(partner, id, "acceptance")).rejects.toThrow(/already approved/);
    await expect(undo(partner2, id, "acceptance")).rejects.toThrow(ONLY_ENGAGEMENT_PARTNER);
    await undo(partner, id, "acceptance");
    expect((await state(id)).acceptance).toBeNull();
    await expect(undo(partner, id, "acceptance")).rejects.toThrow(/not approved/);
    await expect(ok(partner, id, "fieldwork")).rejects.toThrow(/acceptance or planning/);
    expect((await audits("partner_approve", id)).map((l) => l.detail.approval)).toEqual(["acceptance"]);
    expect((await audits("partner_withdraw", id)).map((l) => l.user_id)).toEqual([partner.userId]);
  });

  it("needs an assigned partner, an audited and open file, and a partner who still holds partner rights", async () => {
    const none = await engagement({ partner: null });
    await expect(ok(partner, none, "acceptance")).rejects.toThrow(ASSIGN_PARTNER_FIRST);
    const off = await engagement({ audited: false });
    await expect(ok(partner, off, "acceptance")).rejects.toThrow(/Turn the audit on/);
    const id = await engagement();
    await db.query("update users set role = 'reviewer' where id = $1", [partner.userId]);
    await expect(ok(partner, id, "acceptance")).rejects.toThrow(ONLY_ENGAGEMENT_PARTNER);
    await db.query("update users set role = 'partner' where id = $1", [partner.userId]);
    await db.query("update engagements set status = 'locked' where id = $1", [id]);
    await expect(ok(partner, id, "acceptance")).rejects.toThrow(/This engagement is locked/);
    expect(await audits("partner_approve", id)).toHaveLength(0);
  });
});

describe("a planning approval goes stale", () => {
  it("when materiality is revised, and approving again clears it", async () => {
    const id = await engagement();
    await materiality(id);
    await ok(partner, id, "planning");
    expect((await state(id)).planning).toMatchObject({ stale: null });
    await materiality(id, 150);
    const stale = (await state(id)).planning!;
    expect(stale.stale).toBe("materiality");
    expect(approvalWords(stale)).toBe(`Materiality revised since planning was approved on ${stale.at}`);
    await ok(partner, id, "planning");
    expect((await state(id)).planning).toMatchObject({ stale: null });
    expect((await audits("partner_approve", id)).map((l) => l.detail.again)).toEqual([false, true]);
  });

  it("when a risk rating changes, but not when the same ratings are saved again", async () => {
    const id = await engagement();
    await materiality(id);
    const area = (await as(rev, (tx) => audit.getAuditOverview(tx, id)))!.areas.find((a) => !a.fixedRisk)!;
    const assertions = (level: string) => Object.fromEntries(assertionsOf(AREA_BY_CODE.get(area.code)!).map((k) => [k, level]));
    const rate = (level: string) => as(rev, (tx) => audit.setAreaRisks(tx, rev, id, area.code, assertions(level)));
    await rate("low");
    await ok(partner, id, "planning");
    await rate("low");
    expect((await state(id)).planning).toMatchObject({ stale: null });
    await rate("high");
    const stale = (await state(id)).planning!;
    expect(stale.stale).toBe("risk");
    expect(approvalWords(stale)).toBe(`A risk rating changed since planning was approved on ${stale.at}`);
  });
});

describe("the lock", () => {
  it("is refused while an approval is missing or stale, in words, and allowed once both are approved; fieldwork sign-off is never blocked", async () => {
    const id = await engagement();
    await materiality(id);
    // Every lead sheet can be signed with no approval at all (decision B1).
    const sheets = (await as(prep, (tx) => review.getOverview(tx, id)))!.leadSheets;
    for (const s of sheets) {
      await as(prep, (tx) => review.signOff(tx, prep, id, s.groupCode, "preparer"));
      await as(rev, (tx) => review.signOff(tx, rev, id, s.groupCode, "reviewer"));
    }
    const blocker = (await blockers(id)).find((b) => b.startsWith(LOCK_CHECK_LABEL))!;
    expect(blocker).toBe(`${LOCK_CHECK_LABEL}: acceptance is not approved; planning is not approved.`);
    await expect(as(partner, (tx) => review.lockEngagement(tx, partner, id))).rejects.toThrow(LOCK_CHECK_LABEL);
    await ok(partner, id, "acceptance");
    await ok(partner, id, "planning");
    expect((await blockers(id)).some((b) => b.startsWith(LOCK_CHECK_LABEL))).toBe(false);
    await materiality(id, 150);
    expect((await blockers(id)).find((b) => b.startsWith(LOCK_CHECK_LABEL))).toContain("Materiality revised since planning was approved on");
    expect(explainBlocker((await blockers(id)).find((b) => b.startsWith(LOCK_CHECK_LABEL))!, id)).toMatchObject({ href: expect.stringContaining(`/engagements/${id}/audit`), owner: "partner" });
  });

  it("is unaffected on an engagement with the audit off", async () => {
    const id = await engagement({ audited: false });
    const sheets = (await as(prep, (tx) => review.getOverview(tx, id)))!.leadSheets;
    for (const s of sheets) {
      await as(prep, (tx) => review.signOff(tx, prep, id, s.groupCode, "preparer"));
      await as(rev, (tx) => review.signOff(tx, rev, id, s.groupCode, "reviewer"));
    }
    expect(await blockers(id)).toEqual([]);
    await as(partner, (tx) => review.lockEngagement(tx, partner, id));
    expect((await as(partner, (tx) => review.getOverview(tx, id)))!.status).toBe("locked");
  });

  it("the pure rule names each missing approval", () => {
    const none: Approvals = { acceptance: null, planning: null };
    expect(approvalsBlocker(none)).toContain("acceptance is not approved; planning is not approved");
    const given = { by: "P", at: "2026-01-01", stale: null };
    expect(approvalsBlocker({ acceptance: given, planning: given })).toBeNull();
    expect(approvalsBlocker({ acceptance: given, planning: null })).toContain("planning is not approved");
  });
});

describe("My work", () => {
  it("shows the engagement partner a line for each missing approval, on audited open engagements only", async () => {
    const id = await engagement();
    await materiality(id);
    expect(await lines(partner, id)).toEqual(["Acceptance not approved", "Planning not approved"]);
    expect(await lines(rev, id)).toEqual([]);
    await ok(partner, id, "acceptance");
    expect(await lines(partner, id)).toEqual(["Planning not approved"]);
    await ok(partner, id, "planning");
    expect(await lines(partner, id)).toEqual([]);
    await materiality(id, 150);
    expect(await lines(partner, id)).toEqual(["Planning not approved"]);
    const off = await engagement({ audited: false });
    expect(await lines(partner, off)).toEqual([]);
  });
});

describe("the section", () => {
  const given = { by: "Pia Partner", at: "2026-01-05", stale: null };
  const render = (approvals: Approvals, opts: { partnerAssigned?: boolean; isPartner?: boolean; open?: boolean } = {}) =>
    renderToStaticMarkup(<PartnerApprovalsSection engagementId="e" approvals={approvals} partnerAssigned={opts.partnerAssigned ?? true} isPartner={opts.isPartner ?? false} open={opts.open ?? true} />);

  it("shows one given and one missing, in words, with buttons for the partner only", () => {
    const html = render({ acceptance: given, planning: null }, { isPartner: true });
    expect(html).toContain("Approved by Pia Partner on 2026-01-05");
    expect(html).toContain(NOT_YET);
    expect(html).toContain("Approve planning");
    expect(html).toContain("Withdraw");
    expect(html).not.toContain("·");
    const other = render({ acceptance: given, planning: null });
    expect(other).not.toContain("<form");
    expect(render({ acceptance: null, planning: null }, { partnerAssigned: false })).toContain(ASSIGN_PARTNER_FIRST);
    expect(render({ acceptance: given, planning: null }, { isPartner: true, open: false })).not.toContain("<form");
  });
});

describe("roll-forward", () => {
  it("carries nothing: next year starts unapproved", async () => {
    const id = await engagement();
    await materiality(id);
    await ok(partner, id, "acceptance");
    await ok(partner, id, "planning");
    const clientId = (await db.query<{ client_id: string }>("select client_id from engagements where id = $1", [id])).rows[0].client_id;
    const next = await as(partner, (tx) => repo.createEngagement(tx, partner, clientId, "2026-01-01", "2026-12-31"));
    expect(await state(next)).toEqual({ acceptance: null, planning: null });
  });
});
