import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as review from "../src/server/review";
import { getSignedPrior, saveSignedPrior } from "../src/server/signed-prior";
import { buildStatements } from "../src/domain/statements";
import { HAS_PRIOR_REFUSAL, LINE_REFUSAL, NO_COMPARATIVES_REFUSAL, NOTHING_ENTERED, signedPriorCheck, signedPriorLines } from "../src/domain/signed-prior";
import { packBlockers } from "../src/domain/statement-pack";
import { SignedPriorSection } from "../src/ui/signed-prior-section";

// Invented firms and people.
const A = "aaaaaaaa-8888-4000-8000-000000000001";
const B = "bbbbbbbb-8888-4000-8000-000000000001";
const user = (firm: string, n: number, role: repo.Session["role"]): repo.Session => ({ firmId: firm, userId: `${firm.slice(0, 8)}-8888-4000-8000-00000000005${n}`, role });
const prep = user(A, 1, "preparer");
const rev = user(A, 2, "reviewer");
const partner = user(A, 3, "partner");
const gone = user(A, 4, "preparer");
const outsider = user(B, 1, "partner");

const TB = [
  { code: "1000", name: "Bank - current account", closingMinor: 1500000, priorMinor: 1200000 },
  { code: "3000", name: "Share capital", closingMinor: -500000, priorMinor: -500000 },
  { code: "4000", name: "Sales", closingMinor: -1000000, priorMinor: -700000 },
];

let db: Db;
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
let n = 0;
const audits = async (id: string) => (await db.query<{ detail: { lines: { lineKey: string; label: string; before: number | null; after: number | null }[] }; user_id: string }>("select detail, user_id from audit_log where action = 'signed_prior_figures_save' and entity_id = $1 order by id", [id])).rows;
const save = (s: repo.Session, id: string, amounts: Record<string, string>) => as(s, (tx) => saveSignedPrior(tx, s, id, { amounts }));

/** A client's first engagement, with a trial balance that has prior-year figures (or none). */
async function firstYear(withPrior = true): Promise<string> {
  return as(partner, async (tx) => {
    const client = await repo.createClient(tx, partner, `Signed Trading ${++n} LLC`);
    const e = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
    await repo.importTrialBalance(tx, partner, e, "tb.xlsx", withPrior ? TB : TB.map((a) => ({ ...a, priorMinor: null })));
    await repo.approveAllMappings(tx, partner, e);
    return e;
  });
}
const lineKeys = async (id: string) => signedPriorLines(buildStatements((await as(partner, (tx) => repo.listAccounts(tx, id))).map((a) => ({ ...a, closingMinor: a.closingMinor + a.adjustmentMinor }))));

beforeAll(async () => {
  db = await openDatabase();
  for (const f of [A, B]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [f]);
  for (const u of [prep, rev, partner, gone, outsider]) await db.query("insert into users (id, firm_id, email, name, role, active) values ($1, $2, $3, $4, $5, $6)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-2)}`, u.role, u !== gone]);
});
afterAll(async () => {
  await db.close();
});

describe("the migration", () => {
  it("is migration 0041, append-only for the application role, and another firm sees none", async () => {
    expect((await db.query("select 1 from schema_migrations where name = $1", ["0041_signed_prior_figures.sql"])).rows).toHaveLength(1);
    const id = await firstYear();
    const [bank] = await lineKeys(id);
    await save(partner, id, { [bank.key]: "100.00" });
    const app = (s: repo.Session, sql: string, params: unknown[] = []) =>
      db.transaction(async (tx) => {
        await tx.exec("set local role app_user");
        await tx.query("select set_config('app.firm_id', $1, true)", [s.firmId]);
        return tx.query(sql, params);
      });
    await expect(app(partner, "update signed_prior_figures set amount = 1")).rejects.toThrow(/permission denied/);
    await expect(app(partner, "delete from signed_prior_figures")).rejects.toThrow(/permission denied/);
    expect((await app(partner, "select 1 from signed_prior_figures where engagement_id = $1", [id])).rows).toHaveLength(1);
    expect((await app(outsider, "select 1 from signed_prior_figures")).rows).toHaveLength(0);
  });
});

describe("entering the signed figures", () => {
  it("saves, changes and clears figures as new rows, the latest being current, with an audit entry for each save", async () => {
    const id = await firstYear();
    const lines = await lineKeys(id);
    const [a, b] = lines;
    expect((await save(prep, id, { [a.key]: "1,200.00", [b.key]: "-5000.50" })).changed.sort()).toEqual([a.key, b.key].sort());
    expect((await as(prep, (tx) => getSignedPrior(tx, id))).get(a.key)?.amountMinor).toBe(120000);
    expect((await as(prep, (tx) => getSignedPrior(tx, id))).get(b.key)?.amountMinor).toBe(-500050);
    // The same figures again change nothing and log nothing.
    expect((await save(rev, id, { [a.key]: "1200", [b.key]: "-5000.5" })).changed).toEqual([]);
    // A change adds a row; the latest is current; clearing is a row with a null amount.
    await save(rev, id, { [a.key]: "1300.00" });
    await save(partner, id, { [b.key]: "" });
    const now = await as(partner, (tx) => getSignedPrior(tx, id));
    expect(now.get(a.key)?.amountMinor).toBe(130000);
    expect(now.get(b.key)?.amountMinor).toBeNull();
    expect((await db.query("select 1 from signed_prior_figures where engagement_id = $1", [id])).rows).toHaveLength(4);
    // Clearing a line that has no figure writes nothing.
    expect((await save(partner, id, { [b.key]: "" })).changed).toEqual([]);

    const log = await audits(id);
    expect(log).toHaveLength(3);
    expect(log[0].detail.lines).toEqual([
      { lineKey: a.key, label: a.label, before: null, after: 120000 },
      { lineKey: b.key, label: b.label, before: null, after: -500050 },
    ]);
    expect(log[1].detail.lines).toEqual([{ lineKey: a.key, label: a.label, before: 120000, after: 130000 }]);
    expect(log[2].detail.lines).toEqual([{ lineKey: b.key, label: b.label, before: -500050, after: null }]);
    expect(log.map((l) => l.user_id)).toEqual([prep.userId, rev.userId, partner.userId]);
  });

  it("refuses a locked engagement, another firm's, an inactive person, an unknown line and a bad amount, and writes nothing", async () => {
    const id = await firstYear();
    const [a] = await lineKeys(id);
    await expect(save(outsider, id, { [a.key]: "1" })).rejects.toThrow(/Engagement not found/);
    await expect(save(gone, id, { [a.key]: "1" })).rejects.toThrow(/cannot enter/);
    await expect(save({ ...prep, userId: "00000000-0000-4000-8000-0000000000ff" }, id, { [a.key]: "1" })).rejects.toThrow(/cannot enter/);
    await expect(save(partner, id, { NOT_A_LINE: "1" })).rejects.toThrow(LINE_REFUSAL);
    await expect(save(partner, id, { [a.key]: "12.345" })).rejects.toThrow(/number/);
    expect((await db.query("select 1 from signed_prior_figures where engagement_id = $1", [id])).rows).toHaveLength(0);
    await db.query("update engagements set status = 'locked' where id = $1", [id]);
    await expect(save(partner, id, { [a.key]: "1" })).rejects.toThrow(/This engagement is locked/);
    expect((await db.query("select 1 from signed_prior_figures where engagement_id = $1", [id])).rows).toHaveLength(0);
    expect(await audits(id)).toHaveLength(0);
  });

  it("is refused when the engagement has a prior engagement, and nothing is carried to the next year", async () => {
    const first = await firstYear();
    const [a] = await lineKeys(first);
    await save(partner, first, { [a.key]: "1200.00" });
    const clientId = (await db.query<{ client_id: string }>("select client_id from engagements where id = $1", [first])).rows[0].client_id;
    const next = await as(partner, async (tx) => {
      const e = await repo.createEngagement(tx, partner, clientId, "2026-01-01", "2026-12-31");
      await repo.importTrialBalance(tx, partner, e, "tb2.xlsx", TB);
      await repo.approveAllMappings(tx, partner, e);
      return e;
    });
    await expect(save(partner, next, { [a.key]: "1200.00" })).rejects.toThrow(HAS_PRIOR_REFUSAL);
    expect((await as(partner, (tx) => getSignedPrior(tx, next))).size).toBe(0);
  });

  it("is refused when the trial balance has no prior-year figures", async () => {
    const id = await firstYear(false);
    await expect(save(partner, id, { CASH: "1" })).rejects.toThrow(NO_COMPARATIVES_REFUSAL);
  });
});

describe("the check and the lock", () => {
  it("never blocks locking: a differing signed figure only warns", async () => {
    const id = await firstYear();
    const lines = await lineKeys(id);
    await save(partner, id, Object.fromEntries(lines.map((l) => [l.key, ((l.comparative + 12345) / 100).toFixed(2)])));
    const base = buildStatements((await as(partner, (tx) => repo.listAccounts(tx, id))).map((a) => ({ ...a, closingMinor: a.closingMinor + a.adjustmentMinor })));
    const entered = new Map([...(await as(partner, (tx) => getSignedPrior(tx, id)))].map(([k, v]) => [k, v.amountMinor]));
    const check = signedPriorCheck(base, entered, 1);
    expect(check).toMatchObject({ passed: false, severity: "warning" });
    expect(packBlockers([check])).toEqual([]);
    // Every lead sheet signed, then the partner locks with the warning still showing.
    const sheets = (await as(prep, (tx) => review.getOverview(tx, id)))!.leadSheets;
    for (const s of sheets) {
      await as(prep, (tx) => review.signOff(tx, prep, id, s.groupCode, "preparer"));
      await as(rev, (tx) => review.signOff(tx, rev, id, s.groupCode, "reviewer"));
    }
    await as(partner, (tx) => review.lockEngagement(tx, partner, id));
    expect((await as(partner, (tx) => review.getOverview(tx, id)))!.status).toBe("locked");
  });
});

describe("the section", () => {
  const rows = [
    { key: "CASH", label: "Cash and cash equivalents", comparative: "12,000.00", saved: "12,100.00" },
    { key: "REVENUE", label: "Revenue", comparative: "7,000.00", saved: "" },
  ];

  it("shows the check, the lines and the form for a person who may enter figures, and plain text for everyone else", () => {
    const failing = signedPriorCheck(buildStatements([]), new Map(), 1);
    expect(failing.detail).toBe(NOTHING_ENTERED);
    const editable = renderToStaticMarkup(<SignedPriorSection engagementId="e" check={failing} rows={rows} canEnter />);
    expect(editable).toContain("Signed prior-year figures");
    expect(editable).toContain("Comparative figures agree to the signed prior-year statements");
    expect(editable).toContain("No signed prior-year figures entered");
    expect(editable).toContain("Needs attention");
    expect(editable).toContain('name="amount:CASH"');
    expect(editable).toContain("Save the signed figures");
    expect(editable).not.toContain("·");
    const readOnly = renderToStaticMarkup(<SignedPriorSection engagementId="e" check={failing} rows={rows} canEnter={false} />);
    expect(readOnly).not.toContain("<form");
    expect(readOnly).toContain("Signed: ");
    expect(readOnly).toContain("Not entered");
  });
});
