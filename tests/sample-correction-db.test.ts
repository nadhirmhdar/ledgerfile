import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/server/db";
import { createFirm, DEV_FIRM_ID, DEV_USER_ID, openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import { getPriorYearChecks } from "../src/server/prior-year-checks";
import { correctSampleRetainedEarnings, OLD_FIGURES, SAMPLE_CLIENT_NAME } from "../src/server/sample-correction";
import { loadSampleClient } from "../scripts/seed-common";

const OTHER = "dddddddd-7373-4000-8000-000000000001";
const OTHER_USER = "dddddddd-7373-4000-8000-000000000051";
const admin: repo.Session = { firmId: DEV_FIRM_ID, userId: DEV_USER_ID, role: "admin" };

let db: Db;
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(fn: (tx: T) => Promise<R>, firm = DEV_FIRM_ID) => withFirm(db, firm, fn);

/** The 2025 engagement of the sample client in the sample firm. */
const e2025 = () =>
  as(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      "select e.id from engagements e join clients c on c.id = e.client_id where c.name = $1 and e.period_start = '2025-01-01'",
      [SAMPLE_CLIENT_NAME],
    );
    return rows[0].id;
  });
const figures = (id: string) =>
  as((tx) => tx.query<{ code: string; closing: number; prior: number }>("select code, closing_minor::float8 as closing, prior_minor::float8 as prior from accounts where engagement_id = $1 and code in ('3100','3200','3300') order by code", [id]).then((r) => r.rows));
const auditCount = () => as((tx) => tx.query<{ n: number }>("select count(*)::int as n from audit_log where action = 'sample_correction'").then((r) => r.rows[0].n));

/** Put a sample 2025 engagement back to how the OLD seed left it: old figures, no Dividends paid account. */
async function makeOld(firm: string, engagementId: string) {
  await as(async (tx) => {
    for (const o of OLD_FIGURES) await tx.query("update accounts set closing_minor = $3, prior_minor = $4 where engagement_id = $1 and code = $2", [engagementId, o.code, o.closingMinor, o.priorMinor]);
    await tx.query("delete from mappings where account_id in (select id from accounts where engagement_id = $1 and code = '3300')", [engagementId]);
    await tx.query("delete from accounts where engagement_id = $1 and code = '3300'", [engagementId]);
  }, firm);
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  db = await openDatabase();
  await createFirm(db, { id: DEV_FIRM_ID, name: "Sample Audit Firm" }, { id: DEV_USER_ID, email: "demo@ledgerfile.test", name: "Demo Admin" });
  await loadSampleClient(db);
  const id = await e2025();
  await makeOld(DEV_FIRM_ID, id);
  // As the demo has it: a person has approved the 2025 mappings and signed the retained earnings lead sheet.
  await as(async (tx) => {
    await repo.approveAllMappings(tx, admin, id);
    await tx.query("insert into sign_offs (firm_id, engagement_id, target, level, user_id) values ($1, $2, 'RETAINED', 'preparer', $3)", [DEV_FIRM_ID, id, DEV_USER_ID]);
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.close();
});

const checks = async (id: string) => {
  const r = await as((tx) => getPriorYearChecks(tx, DEV_FIRM_ID, id));
  if (!r || !r.linked) throw new Error("expected a linked engagement");
  return r.checks.map((c) => c.passed);
};

describe("sample correction", () => {
  it("starts from the old seeded state, where the retained earnings check warns", async () => {
    expect((await checks(await e2025()))[1]).toBe(false);
  });

  it("corrects an untouched sample: figures, one audit entry, sign-off cleared, both prior-year checks pass", async () => {
    const id = await e2025();
    const r = await correctSampleRetainedEarnings(db);
    expect(r.changed).toBe(true);
    expect(await figures(id)).toEqual([
      { code: "3100", closing: -4500000, prior: -4500000 },
      { code: "3200", closing: -38383100, prior: 1151900 },
      { code: "3300", closing: 22958500, prior: 0 },
    ]);
    expect(await checks(id)).toEqual([true, true]);
    expect(await auditCount()).toBe(1);
    const entry = await as((tx) => tx.query<{ detail: { before: unknown[]; after: unknown[] } }>("select detail from audit_log where action = 'sample_correction'").then((x) => x.rows[0].detail));
    expect(entry.before).toHaveLength(2);
    expect(entry.after).toHaveLength(3);
    expect((await as((tx) => tx.query("select 1 from sign_offs where engagement_id = $1 and target = 'RETAINED'", [id]))).rows).toHaveLength(0);
    expect((await as((tx) => tx.query("select 1 from audit_log where action = 'sign_offs_cleared' and entity_id = $1", [id]))).rows).toHaveLength(1);
  });

  it("does nothing on a second run", async () => {
    await correctSampleRetainedEarnings(db);
    const id = await e2025();
    const before = await figures(id);
    const r = await correctSampleRetainedEarnings(db);
    expect(r).toMatchObject({ changed: false });
    expect(r.line).toContain("already corrected");
    expect(await figures(id)).toEqual(before);
    expect(await auditCount()).toBe(1);
  });

  it("changes nothing and says why when a user has edited one of the figures", async () => {
    const id = await e2025();
    await as((tx) => tx.query("update accounts set closing_minor = closing_minor - 100 where engagement_id = $1 and code = '3100'", [id]));
    const before = await figures(id);
    const r = await correctSampleRetainedEarnings(db);
    expect(r.changed).toBe(false);
    expect(r.line).toBe("Sample correction: nothing changed: account 3100 no longer has the seeded figures (a person has changed it)");
    expect(await figures(id)).toEqual(before);
    expect(await auditCount()).toBe(0);
    expect((await as((tx) => tx.query("select 1 from sign_offs where engagement_id = $1", [id]))).rows).toHaveLength(1);
  });

  it("changes nothing when the engagement is locked or archived", async () => {
    const id = await e2025();
    await db.query("update engagements set status = 'locked', locked_by = $2, locked_at = now() where id = $1", [id, DEV_USER_ID]);
    const before = await figures(id);
    const r = await correctSampleRetainedEarnings(db);
    expect(r).toMatchObject({ changed: false });
    expect(r.line).toContain("locked or archived");
    expect(await figures(id)).toEqual(before);
    expect(await auditCount()).toBe(0);
  });

  it("leaves another firm's client of the same name untouched", async () => {
    await createFirm(db, { id: OTHER, name: "Another firm" }, { id: OTHER_USER, email: "o@x.test", name: "Other admin" });
    const other: repo.Session = { firmId: OTHER, userId: OTHER_USER, role: "admin" };
    // The same sample, loaded into the other firm under the same client name, in the old state.
    const mine = await e2025();
    const accounts = await as((t) => t.query<{ code: string; name: string; closing: number; prior: number }>("select code, name, closing_minor::float8 as closing, prior_minor::float8 as prior from accounts where engagement_id = $1", [mine]));
    const otherId = await as(async (tx) => {
      const client = await repo.createClient(tx, other, SAMPLE_CLIENT_NAME);
      const id = await repo.createEngagement(tx, other, client, "2025-01-01", "2025-12-31");
      await repo.importTrialBalance(tx, other, id, "x.xlsx", accounts.rows.map((a) => ({ code: a.code, name: a.name, closingMinor: a.closing, priorMinor: a.prior })));
      return id;
    }, OTHER);
    const otherBefore = await as((tx) => tx.query("select code, closing_minor::float8 as c from accounts where engagement_id = $1 order by code", [otherId]).then((r) => r.rows), OTHER);
    await correctSampleRetainedEarnings(db);
    const otherAfter = await as((tx) => tx.query("select code, closing_minor::float8 as c from accounts where engagement_id = $1 order by code", [otherId]).then((r) => r.rows), OTHER);
    expect(otherAfter).toEqual(otherBefore);
    expect(otherAfter.some((a) => (a as { code: string }).code === "3300")).toBe(false);
    expect((await as((tx) => tx.query("select 1 from audit_log where action = 'sample_correction'"), OTHER)).rows).toHaveLength(0);
  });

  it("does nothing where there is no sample firm", async () => {
    const empty = await openDatabase();
    try {
      expect(await correctSampleRetainedEarnings(empty)).toEqual({ changed: false, line: "Sample correction: no sample client here; nothing to do" });
    } finally {
      await empty.close();
    }
  });
});
