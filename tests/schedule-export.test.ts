import { beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import * as schedules from "../src/server/test-schedules";
import { exportSchedules, safePart } from "../src/server/schedule-export";
import { TICKMARKS } from "../src/domain/tickmarks";

// Invented figures, in fils.
const TB = [
  { code: "1000", name: "Bank - current account", closingMinor: 50_000_000, priorMinor: null },
  { code: "1100", name: "Trade receivables", closingMinor: 20_000_000, priorMinor: null },
  { code: "3000", name: "Share capital", closingMinor: -10_000_000, priorMinor: null },
  { code: "2000", name: "Trade payables", closingMinor: -8_000_000, priorMinor: null },
  { code: "4000", name: "Sales", closingMinor: -100_000_000, priorMinor: null },
  { code: "6100", name: "Office rent", closingMinor: 48_000_000, priorMinor: null },
];
const materiality = { benchmark: "revenue", percentageBp: 100, performancePct: 75, trivialPct: 5, rationale: "Revenue is the measure the owners watch." };
type T = Parameters<Parameters<typeof withFirm>[2]>[0];

async function load(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}
/** Every cell of a sheet as [row, column, value], to find a label and the value beside it. */
function find(sheet: ExcelJS.Worksheet, label: string): ExcelJS.Row {
  let found: ExcelJS.Row | undefined;
  sheet.eachRow((row) => {
    if (!found && (row.getCell(1).value === label || row.getCell(2).value === label)) found = row;
  });
  if (!found) throw new Error(`No row labelled ${label}`);
  return found;
}

describe("exporting test schedules to Excel", () => {
  const FIRM = "aaaaaaaa-1616-4000-8000-000000000001";
  const OTHER = "bbbbbbbb-1616-4000-8000-000000000001";
  const user = (n: number, role: repo.Session["role"], firmId = FIRM): repo.Session => ({ firmId, userId: `${firmId.slice(0, 8)}-1616-4000-8000-00000000001${n}`, role });
  const prep = user(1, "preparer");
  const rev = user(2, "reviewer");
  const partner = user(3, "partner");
  const outsider = user(4, "partner", OTHER);
  let db: Db;
  let engagement: string;
  let draft: string;
  let reviewed: string;
  const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
  const exportOne = (id: string, s: repo.Session = prep) => as(s, (tx) => exportSchedules(tx, s, engagement, id));

  beforeAll(async () => {
    db = await openDatabase();
    for (const firm of [FIRM, OTHER]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [firm]);
    for (const u of [prep, rev, partner, outsider]) {
      await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-1)}`, u.role]);
    }
    engagement = await as(partner, async (tx) => {
      const client = await repo.createClient(tx, partner, "Export / Co. (invented)");
      const id = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
      await repo.importTrialBalance(tx, partner, id, "tb.xlsx", TB);
      await repo.approveAllMappings(tx, partner, id);
      await audit.setAuditEnabled(tx, partner, id, true);
      await audit.setMateriality(tx, partner, id, materiality);
      return id;
    });
    draft = await as(prep, (tx) => schedules.createSchedule(tx, prep, engagement, { areaCode: "C5", groupCode: "TRADEREC", title: "Receivables listing", objective: "Receivables exist.", fromTrialBalance: true }));
    const first = (await as(prep, (tx) => schedules.getSchedule(tx, draft)))!.lines[0];
    await as(prep, (tx) =>
      schedules.saveLines(tx, prep, draft, {
        rows: [
          { id: first.id, description: first.description, docRef: first.docRef, amountMinor: first.amountMinor, tested: true, tickmarks: ["doc", "recalc"], remarks: "Agreed to the ledger." },
          { id: null, description: '=HYPERLINK("http://invalid.example","click")', docRef: "+1", amountMinor: -1_234_56, remarks: "@SUM(A1:A9)" },
          { id: null, description: "-2+3", docRef: "=A1", amountMinor: 50_00, remarks: "Plain remark" },
        ],
      }),
    );
    await as(prep, (tx) => schedules.updateHeader(tx, prep, draft, { title: "Receivables listing", objective: "Receivables exist.", workDone: "Agreed the listing to the ledger.", conclusion: "Fairly stated, subject to the difference.", explanation: "Timing of two invoices.", threshold: "performance" }));

    reviewed = await as(prep, (tx) => schedules.createSchedule(tx, prep, engagement, { areaCode: "C8", groupCode: "TRADEPAY", title: "Payables listing", fromTrialBalance: true }));
    await as(prep, (tx) => schedules.updateHeader(tx, prep, reviewed, { title: "Payables listing", objective: "", workDone: "Done.", conclusion: "Fine.", explanation: "", threshold: "performance" }));
    await as(rev, (tx) => schedules.reviewSchedule(tx, rev, reviewed));
  });

  it("writes the header, the lines as real numbers, the totals, the difference, the coverage and the legend", async () => {
    const file = (await exportOne(draft))!;
    expect(file.fileName).toBe("Export-Co-invented-C5-1-2025-12-31.xlsx");
    const wb = await load(file.buffer);
    expect(wb.worksheets.map((s) => s.name)).toEqual(["C5-1"]);
    const sheet = wb.getWorksheet("C5-1")!;

    expect(sheet.getCell("A1").value).toBe("Draft: not reviewed");
    expect(find(sheet, "Client").getCell(2).value).toBe("Export / Co. (invented)");
    expect(find(sheet, "Period").getCell(2).value).toBe("2025-01-01 to 2025-12-31");
    expect(find(sheet, "Reference").getCell(2).value).toBe("C5-1");
    expect(find(sheet, "Title").getCell(2).value).toBe("Receivables listing");
    expect(find(sheet, "Prepared by").getCell(2).value).toMatch(/^preparer 1 on \d{4}-\d{2}-\d{2}$/);
    expect(find(sheet, "Reviewed by").getCell(2).value).toBe("Not yet");
    expect(find(sheet, "Objective").getCell(2).value).toBe("Receivables exist.");
    expect(find(sheet, "Work done").getCell(2).value).toBe("Agreed the listing to the ledger.");
    expect(find(sheet, "Conclusion").getCell(2).value).toBe("Fairly stated, subject to the difference.");
    expect(find(sheet, "Explanation of difference").getCell(2).value).toBe("Timing of two invoices.");
    // Materiality is numeric.
    expect(find(sheet, "Overall materiality").getCell(2).value).toBe(10_000);
    expect(find(sheet, "Performance materiality").getCell(2).value).toBe(7_500);
    expect(find(sheet, "Performance materiality").getCell(2).numFmt).toContain("#,##0.00");

    // Lines: amounts are numeric cells with a number format, not text.
    const head = find(sheet, "Description");
    expect(head.values).toEqual(expect.arrayContaining(["Reference", "Description", "Amount", "Prior year", "Movement", "Tested", "Tickmarks", "Evidence", "Remarks"]));
    const first = sheet.getRow(head.number + 1);
    expect(first.getCell(2).value).toBe("Trade receivables");
    expect(first.getCell(3).value).toBe(200_000);
    expect(typeof first.getCell(3).value).toBe("number");
    expect(first.getCell(3).numFmt).toContain("#,##0.00");
    expect(first.getCell(6).value).toBe("Yes");
    expect(first.getCell(7).value).toBe("✓ R");
    expect(sheet.getRow(head.number + 2).getCell(3).value).toBe(-1_234.56);
    expect(sheet.getRow(head.number + 3).getCell(3).value).toBe(50);

    // Totals, balance and difference.
    const total = find(sheet, "Total");
    expect(total.getCell(3).value).toBeCloseTo(200_000 - 1_234.56 + 50, 2);
    expect(find(sheet, "Balance agreed to (Trade and other receivables)").getCell(3).value).toBe(200_000);
    expect(find(sheet, "Difference").getCell(3).value).toBeCloseTo(-1_184.56, 2);
    // Coverage: numbers, with the share as a percentage format.
    expect(find(sheet, "Coverage: value marked tested").getCell(3).value).toBe(200_000);
    const share = find(sheet, "Coverage: share of the listing").getCell(3);
    expect(typeof share.value).toBe("number");
    expect(share.numFmt).toBe("0.0%");
    expect(find(sheet, "Key items tested").getCell(3).value).toBe(1);

    // The legend lists every tickmark with its meaning.
    const legendAt = find(sheet, "Tickmark legend").number;
    TICKMARKS.forEach((t, i) => {
      expect(sheet.getRow(legendAt + 1 + i).getCell(1).value).toBe(t.symbol);
      expect(sheet.getRow(legendAt + 1 + i).getCell(2).value).toBe(t.meaning);
    });
  });

  it("writes a client's text that begins with =, +, - or @ as text, never as a formula", async () => {
    const wb = await load((await exportOne(draft))!.buffer);
    const sheet = wb.getWorksheet("C5-1")!;
    const head = find(sheet, "Description").number;
    const cells = [sheet.getRow(head + 2).getCell(2), sheet.getRow(head + 2).getCell(1), sheet.getRow(head + 2).getCell(9), sheet.getRow(head + 3).getCell(2), sheet.getRow(head + 3).getCell(1)];
    expect(cells.map((c) => c.value)).toEqual(['=HYPERLINK("http://invalid.example","click")', "+1", "@SUM(A1:A9)", "-2+3", "=A1"]);
    for (const c of cells) {
      expect(c.type).toBe(ExcelJS.ValueType.String);
      expect(c.formula).toBeUndefined();
      expect(c.numFmt).toBe("@");
    }
    // No cell anywhere in the workbook is a formula.
    let formulas = 0;
    sheet.eachRow((r) => r.eachCell((c) => { if (c.type === ExcelJS.ValueType.Formula) formulas++; }));
    expect(formulas).toBe(0);
  });

  it("says a reviewed schedule is reviewed, and does not call it a draft", async () => {
    const sheet = (await load((await exportOne(reviewed))!.buffer)).getWorksheet("C8-1")!;
    expect(sheet.getCell("A1").value).toBe("Reviewed");
    expect(find(sheet, "Reviewed by").getCell(2).value).toMatch(/^reviewer 2 on \d{4}-\d{2}-\d{2}$/);
    expect(find(sheet, "Difference").getCell(3).value).toBe(0);
  });

  it("exports every schedule on the engagement as one workbook with a sheet for each", async () => {
    const file = (await as(prep, (tx) => exportSchedules(tx, prep, engagement)))!;
    expect(file.fileName).toBe("Export-Co-invented-test-schedules-2025-12-31.xlsx");
    const wb = await load(file.buffer);
    expect(wb.worksheets.map((s) => s.name)).toEqual(["C5-1", "C8-1"]);
    expect(wb.getWorksheet("C8-1")!.getCell("A1").value).toBe("Reviewed");
    expect(wb.getWorksheet("C5-1")!.getCell("A1").value).toBe("Draft: not reviewed");
  });

  it("is firm-scoped, tied to the schedule's own engagement, and logged", async () => {
    expect(await as(outsider, (tx) => exportSchedules(tx, outsider, engagement, draft))).toBeNull();
    expect(await as(outsider, (tx) => exportSchedules(tx, outsider, engagement))).toBeNull();
    const other = await as(partner, async (tx) => {
      const client = await repo.createClient(tx, partner, "Elsewhere Co");
      return repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
    });
    // A schedule asked for under the wrong engagement is not found.
    expect(await as(prep, (tx) => exportSchedules(tx, prep, other, draft))).toBeNull();
    const logged = await db.query("select detail from audit_log where entity_id = $1 and action = 'export'", [draft]);
    expect(logged.rows.length).toBeGreaterThanOrEqual(2);
    expect((logged.rows[0] as { detail: { reference: string } }).detail.reference).toBe("C5-1");
    // An engagement with no schedules exports a workbook saying so.
    const empty = (await load((await as(prep, (tx) => exportSchedules(tx, prep, other)))!.buffer));
    expect(empty.worksheets.map((s) => s.name)).toEqual(["No schedules"]);
  });

  it("includes last year's comparatives, the movement and last year's work done for a schedule brought forward", async () => {
    const next = await as(partner, async (tx) => {
      const id = await repo.createEngagement(tx, partner, ((await tx.query<{ id: string }>("select client_id as id from engagements where id = $1", [engagement])).rows[0].id), "2026-01-01", "2026-12-31");
      await repo.importTrialBalance(tx, partner, id, "tb.xlsx", TB);
      await repo.approveAllMappings(tx, partner, id);
      await audit.setAuditEnabled(tx, partner, id, true);
      await audit.setMateriality(tx, partner, id, materiality);
      return id;
    });
    await as(prep, (tx) => schedules.bringForwardSchedules(tx, prep, next));
    const ids = (await db.query("select id from test_schedules where engagement_id = $1 and area_code = 'C5'", [next])).rows as { id: string }[];
    await as(prep, (tx) => schedules.importLines(tx, prep, ids[0].id, [{ description: "Trade receivables", docRef: "1100", amountMinor: 21_000_000 }], "match"));
    const file = (await as(prep, (tx) => exportSchedules(tx, prep, next, ids[0].id)))!;
    const sheet = (await load(file.buffer)).getWorksheet("C5-1")!;
    expect(find(sheet, "Last year's work done").getCell(2).value).toBe("Agreed the listing to the ledger.");
    const first = sheet.getRow(find(sheet, "Description").number + 1);
    expect(first.getCell(3).value).toBe(210_000);
    expect(first.getCell(4).value).toBe(200_000);
    expect(first.getCell(5).value).toBe(10_000);
    // This year 210,000; last year 200,000 - 1,234.56 + 50 across the three lines brought forward.
    expect(find(sheet, "Total").getCell(4).value).toBeCloseTo(198_815.44, 2);
    expect(find(sheet, "Total").getCell(5).value).toBeCloseTo(11_184.56, 2);
  });

  it("keeps file names to plain characters", () => {
    expect(safePart('../../Evil "Co"; rm -rf', "x")).toBe("Evil-Co-rm-rf");
    expect(safePart("///", "fallback")).toBe("fallback");
  });
});
