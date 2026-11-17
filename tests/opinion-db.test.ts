import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import * as review from "../src/server/review";
import { clearOpinion, getOpinion, getOpinionPage, opinionInputProblems, recordOpinion, type OpinionInput } from "../src/server/opinion";

const FIRM = "aaaaaaaa-7777-4000-8000-000000000001";
const OTHER = "bbbbbbbb-7777-4000-8000-000000000001";
const user = (n: number, role: repo.Session["role"], firmId = FIRM): repo.Session => ({ firmId, userId: `${firmId.slice(0, 8)}-7777-4000-8000-00000000001${n}`, role });
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

let db: Db;
let engagement: string;
let plain: string;
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
const unmodified: OpinionInput = { opinion: "unmodified", basisForModification: "", goingConcern: false, goingConcernNote: "", emphasisOfMatter: "", otherMatter: "", reportDate: "2026-03-15" };
const qualified: OpinionInput = { ...unmodified, opinion: "qualified", basisForModification: "  Stock of AED 12,000.00 was not counted.  " };
const record = (s: repo.Session, input: OpinionInput, id = engagement) => as(s, (tx) => recordOpinion(tx, s, id, input));
const blockers = async () => (await as(partner, (tx) => audit.getAuditOverview(tx, engagement)))!.blockers;
const NO_OPINION = "Audit: the partner has not recorded the audit opinion.";
const logEntries = async (action: string) => (await db.query<{ detail: Record<string, unknown>; user_id: string }>("select detail, user_id from audit_log where action = $1 and entity_id = $2 order by id", [action, engagement])).rows;

beforeAll(async () => {
  db = await openDatabase();
  for (const f of [FIRM, OTHER]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [f]);
  for (const u of [prep, rev, partner, admin, outsider]) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} user`, u.role]);
  await as(partner, async (tx) => {
    const client = await repo.createClient(tx, partner, "Opinion Co LLC");
    engagement = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
    await repo.importTrialBalance(tx, partner, engagement, "tb.xlsx", TB);
    await repo.approveAllMappings(tx, partner, engagement);
    await audit.setAuditEnabled(tx, partner, engagement, true);
    // Overall materiality is 1% of revenue, 1,000.00.
    await audit.setMateriality(tx, partner, engagement, { benchmark: "revenue", percentageBp: 100, performancePct: 75, trivialPct: 5, rationale: "Revenue is what the owners watch." });
    const c2 = await repo.createClient(tx, partner, "No Audit Co");
    plain = await repo.createEngagement(tx, partner, c2, "2025-01-01", "2025-12-31");
  });
});

afterAll(async () => {
  await db.close();
});

describe("the lock blocker for the opinion", () => {
  it("is there while no opinion is recorded, on the review overview as well", async () => {
    expect(await blockers()).toContain(NO_OPINION);
    expect((await as(partner, (tx) => review.getOverview(tx, engagement)))!.readiness.blockers).toContain(NO_OPINION);
    expect(await as(partner, (tx) => getOpinion(tx, engagement))).toBeNull();
  });

  it("is not raised for an engagement with the audit off", async () => {
    expect((await as(partner, (tx) => audit.getAuditOverview(tx, plain)))!.blockers).toEqual([]);
  });
});

describe("who may record or clear the opinion", () => {
  it("refuses a preparer and a reviewer, for both actions", async () => {
    for (const s of [prep, rev]) {
      await expect(record(s, unmodified)).rejects.toThrow("Only a partner can record the audit opinion.");
      await expect(as(s, (tx) => clearOpinion(tx, s, engagement))).rejects.toThrow("Only a partner can record the audit opinion.");
    }
    expect(await as(partner, (tx) => getOpinion(tx, engagement))).toBeNull();
  });

  it("refuses another firm's partner and an unknown engagement", async () => {
    await expect(record(outsider, unmodified)).rejects.toThrow(/Engagement not found/);
    await expect(record(partner, unmodified, "dddddddd-7777-4000-8000-000000000001")).rejects.toThrow(/Engagement not found/);
  });
});

describe("what a recorded opinion has to satisfy", () => {
  it("asks for the basis of a modified opinion, a note for a going-concern section, a real date, and refuses a disclaimer with extras", async () => {
    await expect(record(partner, { ...qualified, basisForModification: "  " })).rejects.toThrow(/basis for the modification/);
    await expect(record(partner, { ...unmodified, goingConcern: true, goingConcernNote: " " })).rejects.toThrow(/note where the going-concern uncertainty is disclosed/);
    await expect(record(partner, { ...unmodified, reportDate: "" })).rejects.toThrow(/date of the report/);
    await expect(record(partner, { ...unmodified, reportDate: "2026-02-30" })).rejects.toThrow(/real date/);
    await expect(record(partner, { ...qualified, opinion: "disclaimer", goingConcern: true, goingConcernNote: "7" })).rejects.toThrow(/reviewer decides/);
    await expect(record(partner, { ...qualified, opinion: "disclaimer", emphasisOfMatter: "Something" })).rejects.toThrow(/reviewer decides/);
    await expect(record(partner, { ...unmodified, opinion: "perhaps" })).rejects.toThrow(/Choose the kind of opinion/);
    await expect(record(partner, { ...unmodified, otherMatter: "x".repeat(4001) })).rejects.toThrow(/too long/);
    expect(await as(partner, (tx) => getOpinion(tx, engagement))).toBeNull();
  });

  it("has the same checks as pure sentences", () => {
    expect(opinionInputProblems(unmodified)).toEqual([]);
    expect(opinionInputProblems({ ...qualified, basisForModification: "" })).toHaveLength(1);
  });
});

describe("recording, changing and clearing", () => {
  it("lets a partner record an unmodified opinion, which clears the blocker, and logs it", async () => {
    await record(partner, { ...unmodified, otherMatter: "  The prior year was audited by another firm.  " });
    const o = (await as(prep, (tx) => getOpinion(tx, engagement)))!;
    expect(o).toMatchObject({ opinion: "unmodified", basisForModification: null, goingConcernNote: null, emphasisOfMatter: null, otherMatter: "The prior year was audited by another firm.", reportDate: "2026-03-15", decidedByName: "partner user" });
    expect(await blockers()).not.toContain(NO_OPINION);
    const log = await logEntries("record_opinion");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ user_id: partner.userId, detail: { opinion: "unmodified", previousOpinion: null, goingConcernSection: false, otherMatter: true, reportDate: "2026-03-15" } });
  });

  it("lets an administrator change it, keeping one row, and records what it replaced", async () => {
    await record(admin, { ...qualified, goingConcern: true, goingConcernNote: " 7 ", emphasisOfMatter: "Note 9 describes a claim." });
    const o = (await as(partner, (tx) => getOpinion(tx, engagement)))!;
    expect(o).toMatchObject({ opinion: "qualified", basisForModification: "Stock of AED 12,000.00 was not counted.", goingConcernNote: "7", emphasisOfMatter: "Note 9 describes a claim.", otherMatter: null, decidedByName: "admin user" });
    expect(Number((await db.query<{ n: string }>("select count(*) as n from audit_opinions where engagement_id = $1", [engagement])).rows[0].n)).toBe(1);
    const log = await logEntries("record_opinion");
    expect(log[1]).toMatchObject({ user_id: admin.userId, detail: { opinion: "qualified", previousOpinion: "unmodified", goingConcernSection: true, emphasisOfMatter: true } });
  });

  it("keeps a disclaimer free of a going-concern section and an emphasis of matter", async () => {
    await record(partner, { ...qualified, opinion: "disclaimer" });
    const o = (await as(partner, (tx) => getOpinion(tx, engagement)))!;
    expect(o).toMatchObject({ opinion: "disclaimer", goingConcernNote: null, emphasisOfMatter: null });
  });
});

describe("misstatements that reach materiality", () => {
  it("refuse an unmodified opinion, accept a modified one with its basis, and raise the blocker only against an unmodified or missing opinion", async () => {
    await record(partner, unmodified);
    expect((await blockers()).some((b) => b.includes("reach overall materiality"))).toBe(false);

    // Overall materiality is 1,000.00; 5,000.00 of uncorrected misstatement reaches it.
    await as(partner, (tx) => audit.addMisstatement(tx, partner, engagement, { description: "Unrecorded liability", kind: "factual", amountMinor: 500000 }));
    // The unmodified opinion already recorded now stands against the file.
    expect((await blockers()).some((b) => b.includes("reach overall materiality") && b.includes("record a modified opinion"))).toBe(true);
    await expect(record(partner, unmodified)).rejects.toThrow(/reach overall materiality of 1,000\.00, so an unmodified opinion cannot be recorded\. Correct them, or record a modified opinion with its basis\./);

    await record(partner, qualified);
    expect((await blockers()).some((b) => b.includes("reach overall materiality"))).toBe(false);
    expect((await as(partner, (tx) => getOpinionPage(tx, engagement)))).toMatchObject({ exceedsMateriality: true, uncorrectedCount: 1, uncorrectedNetMinor: 500000, overallMinor: 100000, blockers: [] });

    // With no opinion at all, both blockers show.
    await as(partner, (tx) => clearOpinion(tx, partner, engagement));
    const none = await blockers();
    expect(none).toContain(NO_OPINION);
    expect(none.some((b) => b.includes("reach overall materiality"))).toBe(true);
    expect((await as(partner, (tx) => getOpinionPage(tx, engagement)))!.blockers).toHaveLength(2);
  });
});

describe("clearing", () => {
  it("removes the decision, returns the blocker, and logs it; clearing nothing is refused", async () => {
    await record(partner, qualified);
    await as(partner, (tx) => clearOpinion(tx, partner, engagement));
    expect(await as(partner, (tx) => getOpinion(tx, engagement))).toBeNull();
    expect(await blockers()).toContain(NO_OPINION);
    const log = await logEntries("clear_opinion");
    expect(log).toHaveLength(2);
    expect(log[1]).toMatchObject({ user_id: partner.userId, detail: { opinion: "qualified" } });
    await expect(as(partner, (tx) => clearOpinion(tx, partner, engagement))).rejects.toThrow(/No opinion is recorded/);
  });
});

describe("row-level security and the table's own checks", () => {
  it("keeps one firm's opinion from another", async () => {
    await record(partner, qualified);
    expect(await as(outsider, async (tx) => (await tx.query("select 1 from audit_opinions")).rows)).toHaveLength(0);
    expect(await as(outsider, (tx) => getOpinion(tx, engagement))).toBeNull();
    await expect(as(outsider, (tx) => tx.query("insert into audit_opinions (engagement_id, firm_id, opinion, decided_by) values ($1, $2, 'unmodified', $3)", [engagement, FIRM, outsider.userId]))).rejects.toThrow();
    await expect(as(outsider, (tx) => tx.query("delete from audit_opinions"))).resolves.toBeDefined();
    expect(await as(partner, (tx) => getOpinion(tx, engagement))).not.toBeNull();
  });

  it("refuses at the table a modified opinion without a basis and a disclaimer with a going-concern note", async () => {
    await expect(db.query("update audit_opinions set basis_for_modification = null where engagement_id = $1", [engagement])).rejects.toThrow();
    await expect(db.query("update audit_opinions set opinion = 'disclaimer', going_concern_note = '7' where engagement_id = $1", [engagement])).rejects.toThrow();
    await expect(db.query("update audit_opinions set opinion = 'maybe' where engagement_id = $1", [engagement])).rejects.toThrow();
  });
});

describe("a locked engagement and one with the audit off", () => {
  it("refuses both actions on an engagement with the audit off", async () => {
    await expect(record(partner, unmodified, plain)).rejects.toThrow(/Turn the audit on/);
    await expect(as(partner, (tx) => clearOpinion(tx, partner, plain))).rejects.toThrow(/Turn the audit on/);
  });

  it("refuses both actions once the engagement is locked, and leaves the opinion as it was", async () => {
    await db.query("update engagements set status = 'locked' where id = $1", [engagement]);
    try {
      await expect(record(partner, unmodified)).rejects.toThrow(/locked/);
      await expect(as(partner, (tx) => clearOpinion(tx, partner, engagement))).rejects.toThrow(/locked/);
    } finally {
      await db.query("update engagements set status = 'open' where id = $1", [engagement]);
    }
    expect((await as(partner, (tx) => getOpinion(tx, engagement)))?.opinion).toBe("qualified");
  });
});
