import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import * as papers from "../src/server/working-papers";
import * as schedules from "../src/server/test-schedules";
import { localFileStore } from "../src/server/file-store";

// Invented figures, in fils.
const TB_2024 = [
  { code: "1000", name: "Bank - current account", closingMinor: 60_000_000, priorMinor: null },
  { code: "1100", name: "Trade receivables", closingMinor: 20_000_000, priorMinor: null },
  { code: "1300", name: "Inventories", closingMinor: 5_000_000, priorMinor: null },
  { code: "3000", name: "Share capital", closingMinor: -10_000_000, priorMinor: null },
  { code: "4000", name: "Sales", closingMinor: -100_000_000, priorMinor: null },
  { code: "6100", name: "Office rent", closingMinor: 25_000_000, priorMinor: null },
  { code: "2000", name: "Trade payables", closingMinor: -0, priorMinor: null },
];
const TB_2025 = [
  { code: "1000", name: "Bank - current account", closingMinor: 70_000_000, priorMinor: null },
  { code: "1100", name: "Trade receivables", closingMinor: 24_000_000, priorMinor: null },
  { code: "3000", name: "Share capital", closingMinor: -10_000_000, priorMinor: null },
  { code: "4000", name: "Sales", closingMinor: -110_000_000, priorMinor: null },
  { code: "6100", name: "Office rent", closingMinor: 26_000_000, priorMinor: null },
];
const materiality = { benchmark: "revenue", percentageBp: 100, performancePct: 75, trivialPct: 5, rationale: "Revenue is the measure the owners watch." };
type T = Parameters<Parameters<typeof withFirm>[2]>[0];

describe("rolling schedules forward", () => {
  const FIRM = "aaaaaaaa-1515-4000-8000-000000000001";
  const OTHER = "bbbbbbbb-1515-4000-8000-000000000001";
  const user = (n: number, role: repo.Session["role"], firmId = FIRM): repo.Session => ({ firmId, userId: `${firmId.slice(0, 8)}-1515-4000-8000-00000000001${n}`, role });
  const prep = user(1, "preparer");
  const rev = user(2, "reviewer");
  const rev2 = user(3, "reviewer");
  const partner = user(4, "partner");
  const outsider = user(5, "partner", OTHER);
  let db: PGlite;
  let e2024: string;
  let e2025: string;
  let client: string;
  let s24c5: string;
  let s24c4: string;
  const store = localFileStore(mkdtempSync(join(tmpdir(), "rollforward-")));
  const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
  const view = async (id: string, s: repo.Session = prep) => (await as(s, (tx) => schedules.getSchedule(tx, id)))!;
  const roll = (eng = e2025, s: repo.Session = prep) => as(s, (tx) => schedules.bringForwardSchedules(tx, s, eng));
  const listAll = (eng: string) => db.query("select id, area_code as area, reference from test_schedules where engagement_id = $1 order by reference", [eng]);

  beforeAll(async () => {
    db = await openDatabase();
    for (const firm of [FIRM, OTHER]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [firm]);
    for (const u of [prep, rev, rev2, partner, outsider]) {
      await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-1)}`, u.role]);
    }
    client = await as(partner, (tx) => repo.createClient(tx, partner, "Rollforward Co"));
    e2024 = await as(partner, async (tx) => {
      const id = await repo.createEngagement(tx, partner, client, "2024-01-01", "2024-12-31");
      await repo.importTrialBalance(tx, partner, id, "tb.xlsx", TB_2024);
      await repo.approveAllMappings(tx, partner, id);
      await audit.setAuditEnabled(tx, partner, id, true);
      await audit.setMateriality(tx, partner, id, materiality);
      return id;
    });
    // Last year's work: a receivables schedule with ticks, evidence, a conclusion and a review; an inventories one with a conclusion.
    s24c5 = await as(prep, (tx) => schedules.createSchedule(tx, prep, e2024, { areaCode: "C5", groupCode: "TRADEREC", title: "Receivables listing", objective: "Receivables exist.", fromTrialBalance: true }));
    const file = await as(prep, (tx) => papers.addWorkingPaper(tx, prep, store, e2024, { targetKind: "engagement", target: null, fileName: "confirmations.pdf", data: new TextEncoder().encode("%PDF x"), description: "" }));
    const first = (await view(s24c5)).lines[0];
    await as(prep, (tx) =>
      schedules.saveLines(tx, prep, s24c5, {
        rows: [
          { id: first.id, description: first.description, docRef: first.docRef, amountMinor: first.amountMinor, tested: true, tickmarks: ["doc", "gl"], workingPaperId: file, remarks: "Agreed." },
          { id: null, description: "Customer A (invented)", docRef: "C-1", amountMinor: 1_000_00, tested: true },
          { id: null, description: "Customer B (invented)", docRef: "C-2", amountMinor: 2_000_00 },
          { id: null, description: "Customer C (invented)", docRef: null, amountMinor: 3_000_00 },
        ],
      }),
    );
    await as(prep, (tx) => schedules.updateHeader(tx, prep, s24c5, { title: "Receivables listing", objective: "Receivables exist.", workDone: "Circularised the top customers (2024 work).", conclusion: "Fairly stated.", explanation: "", threshold: "half_performance" }));
    await as(rev2, (tx) => schedules.reviewSchedule(tx, rev2, s24c5));
    s24c4 = await as(prep, (tx) => schedules.createSchedule(tx, prep, e2024, { areaCode: "C4", groupCode: "INVENT", title: "Inventory count", fromTrialBalance: true }));

    e2025 = await as(partner, async (tx) => {
      const id = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
      await repo.importTrialBalance(tx, partner, id, "tb.xlsx", TB_2025);
      await repo.approveAllMappings(tx, partner, id);
      await audit.setAuditEnabled(tx, partner, id, true);
      await audit.setMateriality(tx, partner, id, materiality);
      return id;
    });
  });

  it("is linked to last year's engagement by the existing prior-year link", async () => {
    expect((await as(prep, (tx) => repo.getEngagement(tx, e2025)))!.priorEngagementId).toBe(e2024);
  });

  it("brings forward each schedule with last year's lines as comparatives, and none of last year's testing", async () => {
    expect(await roll()).toEqual({ created: 2, alreadyBrought: 0, lines: 5, outOfScope: 1 });
    const all = (await listAll(e2025)).rows as { id: string; area: string; reference: string }[];
    expect(all.map((r) => r.reference)).toEqual(["C4-1", "C5-1"]);
    const c5 = await view(all.find((r) => r.area === "C5")!.id);

    expect(c5).toMatchObject({
      areaCode: "C5",
      groupCode: "TRADEREC",
      title: "Receivables listing",
      objective: "Receivables exist.",
      threshold: "half_performance",
      reference: "C5-1",
      priorWorkDone: "Circularised the top customers (2024 work).",
      workDone: null,
      conclusion: null,
      explanation: null,
      preparedByName: null,
      reviewedByName: null,
      reviewed: false,
      selfReviewed: false,
      rolledFrom: { id: s24c5, reference: "C5-1", engagementId: e2024, periodEnd: "2024-12-31" },
      areaInScope: true,
      editable: true,
    });
    expect(c5.lines.map((l) => [l.description, l.docRef, l.amountMinor, l.priorAmountMinor])).toEqual([
      ["Trade receivables", "1100", 0, 20_000_000],
      ["Customer A (invented)", "C-1", 0, 1_000_00],
      ["Customer B (invented)", "C-2", 0, 2_000_00],
      ["Customer C (invented)", null, 0, 3_000_00],
    ]);
    // None of last year's testing is carried over.
    expect(c5.lines.every((l) => !l.tested && l.tickmarks.length === 0 && l.workingPaperId === null && l.remarks === null)).toBe(true);
    expect(c5.comparatives).toMatchObject({ currentMinor: 0, priorMinor: 20_000_000 + 6_000_00, movementMinor: -(20_000_000 + 6_000_00), withComparative: 4 });
    // Nothing is a reviewer's or a contributor's yet.
    const row = (await db.query("select prepared_by, reviewed_by, cardinality(contributors) as n from test_schedules where id = $1", [c5.id])).rows[0] as { prepared_by: string | null; reviewed_by: string | null; n: number };
    expect(row).toEqual({ prepared_by: null, reviewed_by: null, n: 0 });
    // Last year's schedule is untouched.
    expect(await view(s24c5)).toMatchObject({ reviewed: true, workDone: "Circularised the top customers (2024 work)." });
    expect((await view(s24c5)).lines[0]).toMatchObject({ tested: true, tickmarks: ["doc", "gl"] });
  });

  it("flags an area that is no longer in scope, but still brings it forward", async () => {
    const c4 = await view(((await listAll(e2025)).rows as { id: string; area: string }[]).find((r) => r.area === "C4")!.id);
    expect(c4).toMatchObject({ areaInScope: false, reference: "C4-1", rolledFrom: { reference: "C4-1" } });
  });

  it("can be run again without creating anything twice, and brings forward only what is missing", async () => {
    expect(await roll()).toEqual({ created: 0, alreadyBrought: 2, lines: 0, outOfScope: 0 });
    expect((await listAll(e2025)).rows).toHaveLength(2);
    const c4New = ((await listAll(e2025)).rows as { id: string; area: string }[]).find((r) => r.area === "C4")!.id;
    await as(prep, (tx) => schedules.deleteSchedule(tx, prep, c4New));
    expect(await roll()).toEqual({ created: 1, alreadyBrought: 1, lines: 1, outOfScope: 1 });
    expect((await listAll(e2025)).rows).toHaveLength(2);
    const log = await db.query("select detail from audit_log where entity_id = $1 and action = 'rollforward' order by id", [e2025]);
    expect(log.rows).toHaveLength(3);
    expect((log.rows[0] as { detail: { created: number; lines: number } }).detail).toMatchObject({ created: 2, lines: 5 });
  });

  it("matches an imported listing to last year's lines by reference, then description, and reports the counts", async () => {
    const c5 = ((await listAll(e2025)).rows as { id: string; area: string }[]).find((r) => r.area === "C5")!.id;
    const result = await as(prep, (tx) =>
      schedules.importLines(
        tx,
        prep,
        c5,
        [
          { description: "Customer A renamed", docRef: "c-1", amountMinor: 1_200_00 },
          { description: "customer  b (invented)", docRef: null, amountMinor: 1_800_00 },
          { description: "Customer D (invented)", docRef: "C-4", amountMinor: 900_00 },
        ],
        "match",
      ),
    );
    expect(result).toEqual({ imported: 3, replaced: 0, matched: 2, added: 1 });
    const v = await view(c5);
    expect(v.lines.map((l) => [l.description, l.amountMinor, l.priorAmountMinor])).toEqual([
      ["Trade receivables", 0, 20_000_000],
      ["Customer A (invented)", 1_200_00, 1_000_00],
      ["Customer B (invented)", 1_800_00, 2_000_00],
      ["Customer C (invented)", 0, 3_000_00],
      ["Customer D (invented)", 900_00, null],
    ]);
    expect(v.comparatives).toMatchObject({ currentMinor: 3_900_00, priorMinor: 20_000_000 + 6_000_00, movementMinor: 3_900_00 - 20_000_000 - 6_000_00, withComparative: 4 });
    const log = await db.query("select detail from audit_log where entity_id = $1 and action = 'import_lines' order by id desc limit 1", [c5]);
    expect((log.rows[0] as { detail: object }).detail).toMatchObject({ mode: "match", matchedByReference: 1, matchedByDescription: 1, added: 1, notMatched: 2 });
    // The comparatives cannot be edited through the line save.
    const a = v.lines[1];
    await as(prep, (tx) => schedules.saveLines(tx, prep, c5, { rows: [{ id: a.id, description: a.description, docRef: a.docRef, amountMinor: 1_250_00, tested: true }] }));
    expect((await view(c5)).lines[1]).toMatchObject({ amountMinor: 1_250_00, priorAmountMinor: 1_000_00, tested: true });
  });

  it("keeps a brought-forward schedule when last year's schedule is deleted, and brings nothing again", async () => {
    // Last year's inventory schedule has no conclusion, so anyone may delete it.
    await as(prep, (tx) => schedules.deleteSchedule(tx, prep, s24c4));
    const c4 = ((await listAll(e2025)).rows as { id: string; area: string }[]).find((r) => r.area === "C4")!.id;
    expect((await view(c4)).rolledFrom).toBeNull();
    expect(await roll()).toMatchObject({ created: 0 });
  });

  it("is refused for another firm, another client's engagement, an unlinked engagement, an audit that is off, and a locked engagement", async () => {
    await expect(roll(e2025, outsider)).rejects.toThrow(/not found/);

    const otherClient = await as(partner, (tx) => repo.createClient(tx, partner, "Another Co"));
    const crossed = await as(partner, async (tx) => {
      const id = await repo.createEngagement(tx, partner, otherClient, "2025-01-01", "2025-12-31");
      await audit.setAuditEnabled(tx, partner, id, true);
      return id;
    });
    await expect(roll(crossed)).rejects.toThrow(/not linked to a prior year/);
    // A prior-year link to another client's engagement is refused, not followed.
    await db.query("update engagements set prior_engagement_id = $2 where id = $1", [crossed, e2024]);
    await expect(roll(crossed)).rejects.toThrow(/not for the same client/);
    const theirs = await as(outsider, async (tx) => {
      const c = await repo.createClient(tx, outsider, "Theirs");
      return repo.createEngagement(tx, outsider, c, "2024-01-01", "2024-12-31");
    });
    // A prior-year link into another firm's engagement cannot even be made: the database has a composite key for it.
    await expect(db.query("update engagements set prior_engagement_id = $2 where id = $1", [crossed, theirs])).rejects.toThrow(/foreign key/);

    const off = await as(partner, async (tx) => {
      const id = await repo.createEngagement(tx, partner, client, "2026-01-01", "2026-12-31");
      return id;
    });
    await db.query("update engagements set prior_engagement_id = $2 where id = $1", [off, e2025]);
    await expect(roll(off)).rejects.toThrow(/Turn the audit on/);
    await as(partner, (tx) => audit.setAuditEnabled(tx, partner, off, true));
    await db.query("update engagements set status = 'locked' where id = $1", [off]);
    await expect(roll(off)).rejects.toThrow(/locked/);
    expect((await listAll(off)).rows).toHaveLength(0);
  });

  it("does not let a frozen, reviewed schedule be filled by matching", async () => {
    const c5 = ((await listAll(e2025)).rows as { id: string; area: string }[]).find((r) => r.area === "C5")!.id;
    await as(prep, (tx) => schedules.updateHeader(tx, prep, c5, { title: "Receivables listing", objective: "", workDone: "Done.", conclusion: "Fine.", explanation: "Listing agrees to last year plus movement.", threshold: "performance" }));
    await as(rev2, (tx) => schedules.reviewSchedule(tx, rev2, c5));
    await expect(as(prep, (tx) => schedules.importLines(tx, prep, c5, [{ description: "Customer A", docRef: "C-1", amountMinor: 1 }], "match"))).rejects.toThrow(/has been reviewed/);
    await as(rev, (tx) => schedules.unreviewSchedule(tx, rev, c5));
  });
});
