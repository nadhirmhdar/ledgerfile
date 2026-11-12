import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as journals from "../src/server/journals";
import * as review from "../src/server/review";
import { lockReadiness, signOffBlocker } from "../src/domain/signoff";

const FIRM = "aaaaaaaa-2222-4000-8000-000000000001";
const OTHER_FIRM = "bbbbbbbb-2222-4000-8000-000000000001";
const user = (n: number, role: review.Actor["role"], firmId = FIRM): review.Actor => ({ firmId, userId: `${firmId.slice(0, 8)}-2222-4000-8000-00000000001${n}`, role });
const prep = user(1, "preparer");
const prep2 = user(2, "preparer");
const rev = user(3, "reviewer");
const partner = user(4, "partner");
const admin = user(5, "admin");
const outsider = user(6, "partner", OTHER_FIRM);

const TB = [
  { code: "1000", name: "Bank - current account", closingMinor: 100000, priorMinor: null },
  { code: "1100", name: "Trade receivables", closingMinor: 50000, priorMinor: null },
  { code: "3000", name: "Share capital", closingMinor: -150000, priorMinor: null },
];

let db: PGlite;
let engagement: string;
const as = <T,>(actor: review.Actor, fn: (tx: Parameters<Parameters<typeof withFirm>[2]>[0]) => Promise<T>) => withFirm(db, actor.firmId, fn);
const overview = async () => (await as(prep, (tx) => review.getOverview(tx, engagement)))!;
const sheet = async (code: string) => (await overview()).leadSheets.find((l) => l.groupCode === code)!;

beforeAll(async () => {
  db = await openDatabase();
  for (const firm of [FIRM, OTHER_FIRM]) await db.query("insert into firms (id, name) values ($1, $2)", [firm, `Firm ${firm.slice(0, 1)}`]);
  for (const u of [prep, prep2, rev, partner, admin, outsider]) {
    await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-1)}`, u.role]);
  }
  await as(prep, async (tx) => {
    const client = await repo.createClient(tx, partner, "Review Co");
    engagement = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
    await repo.importTrialBalance(tx, prep, engagement, "tb.xlsx", TB);
    await repo.approveAllMappings(tx, prep, engagement);
  });
});

describe("sign-off rules (pure)", () => {
  const state = { preparerId: "p", reviewerId: null, openPoints: 0 };
  it("applies order, role, segregation and open-point rules", () => {
    expect(signOffBlocker("preparer", { id: "x", role: "preparer" }, { preparerId: null, reviewerId: null, openPoints: 3 })).toBeNull();
    expect(signOffBlocker("preparer", { id: "x", role: "preparer" }, state)).toContain("already signed");
    expect(signOffBlocker("reviewer", { id: "r", role: "preparer" }, state)).toContain("Only a reviewer");
    expect(signOffBlocker("reviewer", { id: "r", role: "reviewer" }, { ...state, preparerId: null })).toContain("before it is reviewed");
    expect(signOffBlocker("reviewer", { id: "p", role: "partner" }, state)).toContain("different person");
    expect(signOffBlocker("reviewer", { id: "p", role: "partner" }, { ...state, solePractitioner: true })).toBeNull();
    expect(signOffBlocker("reviewer", { id: "p", role: "preparer" }, { ...state, solePractitioner: true })).toContain("Only a reviewer");
    expect(signOffBlocker("reviewer", { id: "r", role: "reviewer" }, { ...state, openPoints: 2 })).toContain("2 open review point");
    expect(signOffBlocker("reviewer", { id: "r", role: "reviewer" }, state)).toBeNull();
  });
  it("lists everything blocking a lock", () => {
    const r = lockReadiness({ statementsClean: false, failedChecks: ["Every mapping has been reviewed"], leadSheets: [{ name: "Cash", prepared: true, reviewed: false }], openPoints: 1 });
    expect(r.ready).toBe(false);
    expect(r.blockers).toHaveLength(3);
    expect(lockReadiness({ statementsClean: true, failedChecks: [], leadSheets: [{ name: "Cash", prepared: true, reviewed: true }], openPoints: 0 }).ready).toBe(true);
    expect(lockReadiness({ statementsClean: true, failedChecks: [], leadSheets: [], openPoints: 0 }).ready).toBe(false);
  });
});

describe("sign-off in the database", () => {
  it("records preparer then reviewer sign-off with names", async () => {
    await as(prep, (tx) => review.signOff(tx, prep, engagement, "CASH", "preparer"));
    await as(rev, (tx) => review.signOff(tx, rev, engagement, "CASH", "reviewer"));
    const cash = await sheet("CASH");
    expect(cash.preparer?.name).toBe("preparer 1");
    expect(cash.reviewer?.name).toBe("reviewer 3");
  });

  it("enforces the rules server-side", async () => {
    await expect(as(prep2, (tx) => review.signOff(tx, prep2, engagement, "CASH", "preparer"))).rejects.toThrow(/already signed/);
    await expect(as(prep2, (tx) => review.signOff(tx, prep2, engagement, "TRADEREC", "reviewer"))).rejects.toThrow(/Only a reviewer/);
    await expect(as(rev, (tx) => review.signOff(tx, rev, engagement, "TRADEREC", "reviewer"))).rejects.toThrow(/before it is reviewed/);
    await as(rev, (tx) => review.signOff(tx, rev, engagement, "TRADEREC", "preparer"));
    await expect(as(rev, (tx) => review.signOff(tx, rev, engagement, "TRADEREC", "reviewer"))).rejects.toThrow(/different person/);
    await expect(as(prep, (tx) => review.signOff(tx, prep, engagement, "INVENT", "preparer"))).rejects.toThrow(/does not exist/);
  });

  it("lets a user withdraw only their own sign-off; withdrawing the preparer's removes the review", async () => {
    await expect(as(prep2, (tx) => review.withdrawSignOff(tx, prep2, engagement, "CASH", "preparer"))).rejects.toThrow(/your own/);
    await as(prep, (tx) => review.withdrawSignOff(tx, prep, engagement, "CASH", "preparer"));
    const cash = await sheet("CASH");
    expect(cash.preparer).toBeNull();
    expect(cash.reviewer).toBeNull();
  });
});

describe("review points", () => {
  let pointId: string;
  it("only reviewers raise them, and a new point removes the lead sheet's review", async () => {
    await as(prep, (tx) => review.signOff(tx, prep, engagement, "CASH", "preparer"));
    await as(rev, (tx) => review.signOff(tx, rev, engagement, "CASH", "reviewer"));
    await expect(as(prep, (tx) => review.addReviewPoint(tx, prep, engagement, "CASH", "Why?"))).rejects.toThrow(/Only a reviewer/);
    await expect(as(rev, (tx) => review.addReviewPoint(tx, rev, engagement, "NOPE", "Bad target"))).rejects.toThrow(/relates to/);
    pointId = await as(rev, (tx) => review.addReviewPoint(tx, rev, engagement, "CASH", "Agree the bank balance to the confirmation."));
    const cash = await sheet("CASH");
    expect(cash.openPoints).toBe(1);
    expect(cash.reviewer).toBeNull();
    expect(cash.preparer).not.toBeNull();
  });

  it("blocks review until the point is cleared, and only a reviewer can clear it", async () => {
    await expect(as(partner, (tx) => review.signOff(tx, partner, engagement, "CASH", "reviewer"))).rejects.toThrow(/open review point/);
    await as(prep, (tx) => review.respondToReviewPoint(tx, prep, pointId, "Agreed to confirmation dated 5 January; see WP C6.1."));
    await expect(as(prep, (tx) => review.clearReviewPoint(tx, prep, pointId))).rejects.toThrow(/Only a reviewer/);
    await as(rev, (tx) => review.clearReviewPoint(tx, rev, pointId));
    await expect(as(rev, (tx) => review.clearReviewPoint(tx, rev, pointId))).rejects.toThrow(/already cleared/);
    const o = await overview();
    expect(o.points[0]).toMatchObject({ status: "cleared", response: expect.stringContaining("Agreed"), responderName: "preparer 1", clearedByName: "reviewer 3", targetName: "Cash and bank balances" });
    await as(partner, (tx) => review.signOff(tx, partner, engagement, "CASH", "reviewer"));
  });
});

describe("changes after sign-off", () => {
  it("a journal clears sign-offs on the lead sheets it touches, and only those", async () => {
    await as(prep, (tx) => review.signOff(tx, prep, engagement, "CAPITAL", "preparer"));
    const ids = Object.fromEntries((await as(prep, (tx) => repo.listAccounts(tx, engagement))).map((a) => [a.code, a.id]));
    await as(prep, (tx) =>
      journals.createJournal(tx, prep, engagement, {
        type: "reclassification",
        description: "Move deposit to receivables",
        lines: [{ accountId: ids["1100"], amountMinor: 1000 }, { accountId: ids["1000"], amountMinor: -1000 }],
      }),
    );
    expect((await sheet("CASH")).preparer).toBeNull();
    expect((await sheet("CASH")).reviewer).toBeNull();
    expect((await sheet("TRADEREC")).preparer).toBeNull();
    expect((await sheet("CAPITAL")).preparer).not.toBeNull();
  });

  it("a mapping change clears sign-offs on both lead sheets; an unchanged mapping does not", async () => {
    const accounts = await as(prep, (tx) => repo.listAccounts(tx, engagement));
    const capital = accounts.find((a) => a.code === "3000")!;
    await as(prep, (tx) => repo.setMapping(tx, prep, capital.id, "CAPITAL"));
    expect((await sheet("CAPITAL")).preparer).not.toBeNull();
    await as(prep, (tx) => repo.setMapping(tx, prep, capital.id, "RETAINED"));
    expect((await overview()).leadSheets.find((l) => l.groupCode === "CAPITAL")).toBeUndefined();
    await as(prep, (tx) => repo.setMapping(tx, prep, capital.id, "CAPITAL"));
    expect((await sheet("CAPITAL")).preparer).toBeNull();
  });
});

describe("lock", () => {
  it("is refused until everything is signed, and only a partner-level user can lock", async () => {
    await expect(as(partner, (tx) => review.lockEngagement(tx, partner, engagement))).rejects.toThrow(/not ready to lock.*not signed as prepared/);
    for (const code of ["CASH", "TRADEREC", "CAPITAL"]) {
      await as(prep, (tx) => review.signOff(tx, prep, engagement, code, "preparer"));
      await as(rev, (tx) => review.signOff(tx, rev, engagement, code, "reviewer"));
    }
    const general = await as(rev, (tx) => review.addReviewPoint(tx, rev, engagement, review.GENERAL, "Confirm the representation letter is signed."));
    await expect(as(partner, (tx) => review.lockEngagement(tx, partner, engagement))).rejects.toThrow(/review point\(s\) are still open/);
    await as(rev, (tx) => review.clearReviewPoint(tx, rev, general));

    expect((await overview()).readiness).toEqual({ ready: true, blockers: [] });
    await expect(as(rev, (tx) => review.lockEngagement(tx, rev, engagement))).rejects.toThrow(/Only a partner/);
    await as(admin, (tx) => review.lockEngagement(tx, admin, engagement));
    const o = await overview();
    expect(o.status).toBe("locked");
    expect(o.lockedByName).toBe("admin 5");
  });

  it("freezes the file once locked", async () => {
    const accounts = await as(prep, (tx) => repo.listAccounts(tx, engagement));
    await expect(as(prep, (tx) => review.withdrawSignOff(tx, prep, engagement, "CASH", "preparer"))).rejects.toThrow(/locked/);
    await expect(as(rev, (tx) => review.addReviewPoint(tx, rev, engagement, "CASH", "Late point"))).rejects.toThrow(/locked/);
    await expect(as(prep, (tx) => repo.setMapping(tx, prep, accounts[0].id, "INVEST"))).rejects.toThrow(/locked/);
    await expect(as(prep, (tx) => repo.importTrialBalance(tx, prep, engagement, "x.xlsx", TB))).rejects.toThrow(/locked/);
  });

  it("unlocks only for a partner with a reason, keeping the sign-offs", async () => {
    await expect(as(rev, (tx) => review.unlockEngagement(tx, rev, engagement, "Need to fix a typo"))).rejects.toThrow(/Only a partner/);
    await expect(as(partner, (tx) => review.unlockEngagement(tx, partner, engagement, " "))).rejects.toThrow(/reason/);
    await as(partner, (tx) => review.unlockEngagement(tx, partner, engagement, "Late adjustment from the client"));
    const o = await overview();
    expect(o.status).toBe("open");
    expect(o.leadSheets.every((l) => l.preparer && l.reviewer)).toBe(true);
    const log = await db.query<{ detail: { reason: string } }>("select detail from audit_log where action = 'unlock'");
    expect(log.rows[0].detail.reason).toBe("Late adjustment from the client");
  });
});

describe("other changes that invalidate sign-offs", () => {
  it("deleting a journal clears the lead sheets it touched; replacing the trial balance clears them all", async () => {
    expect((await overview()).leadSheets.every((l) => l.preparer && l.reviewer)).toBe(true);
    const [journal] = await as(prep, (tx) => journals.listJournals(tx, engagement));
    await as(prep, (tx) => journals.deleteJournal(tx, prep, journal.id));
    expect((await sheet("CASH")).preparer).toBeNull();
    expect((await sheet("TRADEREC")).reviewer).toBeNull();
    expect((await sheet("CAPITAL")).reviewer).not.toBeNull();

    await as(prep, (tx) => repo.importTrialBalance(tx, prep, engagement, "tb-v2.xlsx", TB));
    const after = await overview();
    expect(after.leadSheets.some((l) => l.preparer || l.reviewer)).toBe(false);
    const cleared = await db.query<{ detail: { reason: string } }>("select detail from audit_log where action = 'sign_offs_cleared' order by id desc limit 1");
    expect(cleared.rows[0].detail.reason).toBe("trial balance replaced");
  });

  it("keeps the text of every response in the audit log", async () => {
    const log = await db.query<{ detail: { response: string } }>("select detail from audit_log where action = 'respond'");
    expect(log.rows[0].detail.response).toContain("Agreed to confirmation");
  });
});

describe("role restrictions", () => {
  it("only a partner-level user adds clients; only a reviewer or above opens engagements", async () => {
    await expect(as(prep, (tx) => repo.createClient(tx, prep, "Nope Ltd"))).rejects.toThrow(/Only a partner can add a client/);
    await expect(as(rev, (tx) => repo.createClient(tx, rev, "Nope Ltd"))).rejects.toThrow(/Only a partner/);
    const client = await as(admin, (tx) => repo.createClient(tx, admin, "Allowed Ltd"));
    await expect(as(prep, (tx) => repo.createEngagement(tx, prep, client, "2025-01-01", "2025-12-31"))).rejects.toThrow(/Only a reviewer or partner/);
    expect(await as(rev, (tx) => repo.createEngagement(tx, rev, client, "2025-01-01", "2025-12-31"))).toBeTruthy();
  });

  it("a journal is deleted by its author or a reviewer, not by another preparer", async () => {
    const ids = Object.fromEntries((await as(prep, (tx) => repo.listAccounts(tx, engagement))).map((a) => [a.code, a.id]));
    const post = () =>
      as(prep, (tx) =>
        journals.createJournal(tx, prep, engagement, {
          type: "adjusting",
          description: "Permission test entry",
          lines: [{ accountId: ids["1100"], amountMinor: 100 }, { accountId: ids["1000"], amountMinor: -100 }],
        }),
      );
    const first = await post();
    expect((await as(prep, (tx) => journals.listJournals(tx, engagement))).find((j) => j.id === first)?.createdBy).toBe(prep.userId);
    await expect(as(prep2, (tx) => journals.deleteJournal(tx, prep2, first))).rejects.toThrow(/Only the person who posted/);
    await as(prep, (tx) => journals.deleteJournal(tx, prep, first));
    const second = await post();
    await as(rev, (tx) => journals.deleteJournal(tx, rev, second));
    expect(await as(prep, (tx) => journals.listJournals(tx, engagement))).toHaveLength(0);
  });
});

describe("sole practitioner", () => {
  it("a firm with one user can prepare, review and lock alone, and the self-review is logged", async () => {
    const solo = outsider;
    const own = await as(solo, async (tx) => {
      const client = await repo.createClient(tx, solo, "Solo Client");
      const id = await repo.createEngagement(tx, solo, client, "2025-01-01", "2025-12-31");
      await repo.importTrialBalance(tx, solo, id, "tb.xlsx", TB);
      await repo.approveAllMappings(tx, solo, id);
      return id;
    });
    expect((await as(solo, (tx) => review.getOverview(tx, own)))!.solePractitioner).toBe(true);
    for (const code of ["CASH", "TRADEREC", "CAPITAL"]) {
      await as(solo, (tx) => review.signOff(tx, solo, own, code, "preparer"));
      await as(solo, (tx) => review.signOff(tx, solo, own, code, "reviewer"));
    }
    await as(solo, (tx) => review.lockEngagement(tx, solo, own));
    expect((await as(solo, (tx) => review.getOverview(tx, own)))!.status).toBe("locked");
    const log = await db.query("select 1 from audit_log where firm_id = $1 and action = 'sign_off' and detail->>'selfReview' = 'true'", [OTHER_FIRM]);
    expect(log.rows).toHaveLength(3);
  });

  it("the exception ends as soon as the firm has a second user", async () => {
    expect((await overview()).solePractitioner).toBe(false);
    await as(prep, (tx) => review.signOff(tx, rev, engagement, "CASH", "preparer"));
    await expect(as(rev, (tx) => review.signOff(tx, rev, engagement, "CASH", "reviewer"))).rejects.toThrow(/different person/);
  });
});

describe("tenant isolation", () => {
  it("another firm sees nothing and cannot sign, raise points or lock", async () => {
    expect(await as(outsider, (tx) => review.getOverview(tx, engagement))).toBeNull();
    await expect(as(outsider, (tx) => review.signOff(tx, outsider, engagement, "CASH", "preparer"))).rejects.toThrow(/not found/);
    await expect(as(outsider, (tx) => review.addReviewPoint(tx, outsider, engagement, "CASH", "Intrusion"))).rejects.toThrow(/not found/);
    await expect(as(outsider, (tx) => review.lockEngagement(tx, outsider, engagement))).rejects.toThrow(/not found/);
    const seen = await as(outsider, async (tx) => (await tx.query("select id from sign_offs where engagement_id = $1", [engagement])).rows.length +
      (await tx.query("select id from review_points where engagement_id = $1", [engagement])).rows.length,
    );
    expect(seen).toBe(0);
  });
});
