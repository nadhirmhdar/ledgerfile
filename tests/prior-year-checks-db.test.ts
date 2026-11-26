import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as review from "../src/server/review";
import { getPriorYearChecks } from "../src/server/prior-year-checks";
import { buildStatements, severityOf } from "../src/domain/statements";
import { buildStatementPack } from "../src/domain/statement-pack";
import { NOT_LINKED, openingRetained } from "../src/domain/prior-year-checks";

// Invented firms and people.
const A = "aaaaaaaa-7171-4000-8000-000000000001";
const B = "bbbbbbbb-7171-4000-8000-000000000001";
const user = (firm: string, n: number, role: repo.Session["role"]): repo.Session => ({ firmId: firm, userId: `${firm.slice(0, 8)}-7171-4000-8000-00000000005${n}`, role });
const partner = user(A, 1, "partner");
const prep = user(A, 2, "preparer");
const rev = user(A, 3, "reviewer");
const outsider = user(B, 1, "partner");

type Acc = { code: string; name: string; closingMinor: number; priorMinor: number };
/** Last year (2024): result 700,000 (sales 1,000,000 less expenses 300,000), opening retained earnings 300,000, so closing retained earnings 1,000,000. */
const LAST_YEAR: Acc[] = [
  { code: "1000", name: "Bank - current account", closingMinor: 1500000, priorMinor: 0 },
  { code: "3000", name: "Share capital", closingMinor: -500000, priorMinor: 0 },
  { code: "3100", name: "Retained earnings", closingMinor: -300000, priorMinor: 0 },
  { code: "4000", name: "Sales", closingMinor: -1000000, priorMinor: 0 },
  { code: "6000", name: "General and administrative expenses", closingMinor: 300000, priorMinor: 0 },
];
/** This year (2025): comparatives are last year's figures; opening retained earnings 1,000,000 and a dividend of 200,000 paid in the year. */
const THIS_YEAR: Acc[] = [
  { code: "1000", name: "Bank - current account", closingMinor: 2400000, priorMinor: 1500000 },
  { code: "3000", name: "Share capital", closingMinor: -500000, priorMinor: -500000 },
  { code: "3100", name: "Retained earnings", closingMinor: -1000000, priorMinor: -300000 },
  { code: "3200", name: "Dividends paid", closingMinor: 200000, priorMinor: 0 },
  { code: "4000", name: "Sales", closingMinor: -1500000, priorMinor: -1000000 },
  { code: "6000", name: "General and administrative expenses", closingMinor: 400000, priorMinor: 300000 },
];

let db: Db;
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: { firmId: string }, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
let n = 0;

/** A client with last year's and this year's engagements, linked by createEngagement, both mapped and approved. */
async function pair(thisYear: Acc[] = THIS_YEAR, lastYear: Acc[] = LAST_YEAR): Promise<{ prior: string; current: string }> {
  const name = `Pair Trading ${++n} LLC`;
  return as(partner, async (tx) => {
    const client = await repo.createClient(tx, partner, name);
    const prior = await repo.createEngagement(tx, partner, client, "2024-01-01", "2024-12-31");
    await repo.importTrialBalance(tx, partner, prior, "ly.xlsx", lastYear);
    await repo.approveAllMappings(tx, partner, prior);
    const current = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
    await repo.importTrialBalance(tx, partner, current, "ty.xlsx", thisYear);
    await repo.approveAllMappings(tx, partner, current);
    return { prior, current };
  });
}
const checksOf = async (id: string) => {
  const r = await as(partner, (tx) => getPriorYearChecks(tx, partner.firmId, id));
  if (!r || !r.linked) throw new Error("expected a linked engagement");
  return r;
};
const withPrior = (changes: Record<string, number>): Acc[] => THIS_YEAR.map((a) => (a.code in changes ? { ...a, priorMinor: changes[a.code] } : a));

beforeAll(async () => {
  db = await openDatabase();
  for (const f of [A, B]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [f]);
  for (const u of [partner, prep, rev, outsider]) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} user`, u.role]);
});

afterAll(async () => {
  await db.close();
});

describe("the figures are mapped the way the checks expect", () => {
  it("puts the retained earnings and the dividend account in the retained earnings group", async () => {
    const { current } = await pair();
    const accounts = await as(partner, (tx) => repo.listAccounts(tx, current));
    expect(accounts.find((a) => a.code === "3100")?.groupCode).toBe("RETAINED");
    expect(accounts.find((a) => a.code === "3200")?.groupCode).toBe("RETAINED");
  });
});

describe("no prior link", () => {
  it("runs nothing, and the note says so in one line", async () => {
    const { prior } = await pair();
    expect(await as(partner, (tx) => getPriorYearChecks(tx, partner.firmId, prior))).toEqual({ linked: false });
    expect(NOT_LINKED).toBe("Not linked to last year's file, so the prior-year checks do not run.");
    expect(await as(partner, (tx) => getPriorYearChecks(tx, partner.firmId, "00000000-0000-4000-8000-000000000999"))).toBeNull();
  });
});

describe("everything agrees", () => {
  it("passes both checks, including a dividend paid this year inside retained earnings, and labels last year's open file", async () => {
    const { current } = await pair();
    const r = await checksOf(current);
    expect(r.checks.map((c) => c.passed)).toEqual([true, true]);
    expect(r.checks.every((c) => severityOf(c) === "warning")).toBe(true);
    expect(r.priorSigned).toBe(false);
    expect(r.checks[0].label).toBe("Comparative figures agree to last year's figures (that file is not yet locked)");
    expect(r.checks[1].label).toBe("Opening retained earnings equal last year's closing, per last year's figures (that file is not yet locked)");
  });

  it("says signed figures once last year's file is locked or archived", async () => {
    const { prior, current } = await pair();
    await db.query("update engagements set status = 'locked', locked_by = $2, locked_at = now() where id = $1", [prior, partner.userId]);
    const locked = await checksOf(current);
    expect(locked.priorSigned).toBe(true);
    expect(locked.checks[0].label).toBe("Comparative figures agree to last year's signed figures");
    expect(locked.checks[1].label).toBe("Opening retained earnings equal last year's closing, per last year's signed figures");
    await db.query("update engagements set archived_at = now(), archived_by = $2 where id = $1", [prior, partner.userId]);
    expect((await checksOf(current)).priorSigned).toBe(true);
  });

  it("would show a false difference if the dividend were not added back", () => {
    const accounts = THIS_YEAR.map((a) => ({ groupCode: ["3100", "3200"].includes(a.code) ? "RETAINED" : null, name: a.name, closingMinor: a.closingMinor }));
    expect(openingRetained(accounts)).toEqual({ opening: 1000000, addedBack: 200000, addedBackAccounts: 1 });
    expect(-accounts.filter((a) => a.groupCode).reduce((s, a) => s + a.closingMinor, 0)).toBe(800000);
  });
});

describe("check A: the comparatives", () => {
  it("warns with the line, both amounts and the difference when one comparative differs", async () => {
    // Revenue and the bank balance each differ by 100,000, so the comparatives still balance.
    const { current } = await pair(withPrior({ "1000": 1400000, "4000": -900000 }));
    const [a, b] = (await checksOf(current)).checks;
    expect(a.passed).toBe(false);
    expect(a.items!.join("\n")).toContain("this year's comparative 9,000.00, last year 10,000.00, difference minus 1,000.00");
    expect(a.severity).toBe("warning");
    expect(b.passed).toBe(true);
  });

  it("lists five lines and then says how many more", async () => {
    const { current } = await pair(withPrior({ "1000": 1600000, "3000": -600000, "3100": -400000, "4000": -1100000, "6000": 400000 }));
    const a = (await checksOf(current)).checks[0];
    expect(a.passed).toBe(false);
    expect(a.items!).toHaveLength(5 + 1);
    expect(a.items![5]).toMatch(/^and \d+ more$/);
  });
});

describe("check B: opening retained earnings", () => {
  it("warns with the difference when the opening balance is not last year's closing", async () => {
    const changed = THIS_YEAR.map((a) => (a.code === "3100" ? { ...a, closingMinor: -900000 } : a.code === "1000" ? { ...a, closingMinor: 2300000 } : a));
    const { current } = await pair(changed);
    const b = (await checksOf(current)).checks[1];
    expect(b.passed).toBe(false);
    expect(b.detail).toContain("Opening retained earnings in this trial balance are 9,000.00");
    expect(b.detail).toContain("after adding back 1 dividend or drawings account(s) of 2,000.00");
    expect(b.detail).toContain("Last year's closing retained earnings are 10,000.00 (retained earnings 3,000.00 plus profit for the year 7,000.00)");
    expect(b.detail).toContain("Difference minus 1,000.00");
  });
});

describe("another firm", () => {
  it("is never read: the database refuses a link across firms, and the query is firm-scoped as well", async () => {
    const { current } = await pair();
    const theirs = await as(outsider, async (tx) => repo.createEngagement(tx, outsider, await repo.createClient(tx, outsider, "Other Firm Client"), "2024-01-01", "2024-12-31"));
    await expect(db.query("update engagements set prior_engagement_id = $2 where id = $1", [current, theirs])).rejects.toThrow(/foreign key/);
    // Asked for with the wrong firm, an engagement is not found at all.
    expect(await as(outsider, (tx) => getPriorYearChecks(tx, outsider.firmId, current))).toBeNull();
    expect(await as(partner, (tx) => getPriorYearChecks(tx, partner.firmId, theirs))).toBeNull();
  });
});

describe("warnings are not errors", () => {
  it("leave every existing check an error, and clean unchanged", async () => {
    const { current } = await pair();
    const accounts = (await as(partner, (tx) => repo.listAccounts(tx, current))).map((a) => ({ ...a, closingMinor: a.closingMinor + a.adjustmentMinor }));
    const s = buildStatements(accounts);
    expect(s.checks.length).toBeGreaterThan(4);
    expect(s.checks.every((c) => severityOf(c) === "error")).toBe(true);
    // The one warning in the pack is the notes' placeholder check; every other check is an error.
    expect(buildStatementPack(accounts).checks.filter((c) => severityOf(c) === "warning").map((c) => c.label)).toEqual(["No placeholders left in the notes"]);
    // The statements are built without any knowledge of last year, so the warnings cannot change `clean`.
    expect(s.clean).toBe(true);
    expect(s.checks.some((c) => /last year/i.test(c.label))).toBe(false);
  });

  it("do not stop a partner locking: a file whose comparatives differ from last year still locks", async () => {
    const { current } = await pair(withPrior({ "1000": 1400000, "4000": -900000 }));
    expect((await checksOf(current)).checks[0].passed).toBe(false);
    const sheets = (await as(partner, (tx) => review.getOverview(tx, current)))!.leadSheets.map((l) => l.groupCode);
    for (const g of sheets) {
      await as(prep, (tx) => review.signOff(tx, prep, current, g, "preparer"));
      await as(rev, (tx) => review.signOff(tx, rev, current, g, "reviewer"));
    }
    const overview = await as(partner, (tx) => review.getOverview(tx, current));
    expect(overview!.readiness).toEqual({ ready: true, blockers: [] });
    await as(partner, (tx) => review.lockEngagement(tx, partner, current));
    expect((await db.query<{ status: string }>("select status from engagements where id = $1", [current])).rows[0].status).toBe("locked");
  });

  it("leave the existing checks blocking: a trial balance that does not balance is not ready to lock", async () => {
    const broken = THIS_YEAR.map((a) => (a.code === "1000" ? { ...a, closingMinor: a.closingMinor + 100 } : a));
    const { current } = await pair(broken);
    const overview = await as(partner, (tx) => review.getOverview(tx, current));
    expect(overview!.readiness.ready).toBe(false);
    expect(overview!.readiness.blockers.join(" ")).toMatch(/Statement check failed/);
  });
});
