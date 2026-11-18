import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as journals from "../src/server/journals";
import { buildLeadSheets, variancePct, type MappedAccount } from "../src/domain/leadsheet";
import { buildLeadSheetWorkbook, exportLeadSheets, leadSheetSheetName, type LeadSheetExportContext } from "../src/server/leadsheet-export";

const load = async (buffer: Buffer) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
};
/** A sheet's rows as plain arrays of cell values. */
const rowsOf = (sheet: ExcelJS.Worksheet) => {
  const out: unknown[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => out.push((row.values as unknown[]).slice(1)));
  return out;
};
const minor = (cell: unknown) => Math.round(Number(cell) * 100);

describe("worksheet names", () => {
  it("replaces the characters Excel refuses, and cuts to 31 characters", () => {
    const used = new Set<string>();
    expect(leadSheetSheetName("Cash/Bank: [main] ?*", used)).toBe("Cash-Bank- -main- --");
    expect(leadSheetSheetName("A very long lead sheet name that is longer than thirty-one characters", new Set()).length).toBe(31);
    expect(leadSheetSheetName("  'quoted'  ", new Set())).toBe("quoted");
    expect(leadSheetSheetName("", new Set())).toBe("Sheet");
    expect(leadSheetSheetName("///", new Set())).toBe("---");
  });
  it("keeps names unique whatever the case, even when they were cut to the same start, and never reuses Summary or Unmapped", () => {
    const used = new Set(["summary", "unmapped"]);
    const long = "Trade and other receivables from related parties";
    const a = leadSheetSheetName(long, used);
    const b = leadSheetSheetName(long, used);
    const c = leadSheetSheetName(long.toUpperCase(), used);
    expect(new Set([a, b, c].map((n) => n.toLowerCase())).size).toBe(3);
    for (const n of [a, b, c]) expect(n.length).toBeLessThanOrEqual(31);
    expect(b).toMatch(/\(2\)$/);
    expect(leadSheetSheetName("Summary", used)).toBe("Summary (2)");
    expect(leadSheetSheetName("unmapped", used)).toBe("unmapped (2)");
  });
});

describe("the workbook", () => {
  const acct = (code: string, name: string, groupCode: string | null, closingMinor: number, priorMinor: number | null, adjustmentMinor = 0): MappedAccount => ({ code, name, groupCode, closingMinor, priorMinor, adjustmentMinor });
  // Balances as the page passes them: closing already includes the adjustment.
  const accounts: MappedAccount[] = [
    acct("1000", "Bank - current account", "CASH", 15050012, 10000000, 50012),
    acct("1010", "=HYPERLINK(\"http://example.test\")", "CASH", 250000, null),
    acct("1200", "Trade receivables", "TRADEREC", 5000000, 0),
    acct("3000", "Share capital", "CAPITAL", -5000000, -5000000),
    acct("4000", "Sales", "REVENUE", -15300012, -10000000, -50012),
    acct("9999", "Suspense", null, 0, 0),
    acct("9998", "+Unmapped item", null, 1200, null),
  ];
  const ctx: LeadSheetExportContext = {
    firmName: "Demo Audit Firm",
    clientName: "=Falcon Trading LLC",
    periodStart: "2025-01-01",
    periodEnd: "2025-12-31",
    hasAdjustments: true,
    signOffs: new Map([
      ["CASH", { preparer: { name: "Pia Preparer", at: "2026-02-01" }, reviewer: { name: "Rae Reviewer", at: "2026-02-03" }, openPoints: 2 }],
      ["TRADEREC", { preparer: { name: "Pia Preparer", at: "2026-02-01" }, reviewer: null, openPoints: 0 }],
    ]),
  };
  const set = buildLeadSheets(accounts);

  it("has the Summary first, one sheet for each lead sheet in statement order, and Unmapped last", async () => {
    const wb = await load(await buildLeadSheetWorkbook(set, ctx));
    const names = wb.worksheets.map((w) => w.name);
    expect(names[0]).toBe("Summary");
    expect(names.at(-1)).toBe("Unmapped");
    expect(names.slice(1, -1)).toEqual(set.sheets.map((s) => s.groupName));
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    for (const n of names) {
      expect(n.length).toBeLessThanOrEqual(31);
      expect(n).not.toMatch(/[\\/?*[\]:]/);
    }
  });

  it("puts the Summary figures, sign-offs and words where the page has them", async () => {
    const sheet = (await load(await buildLeadSheetWorkbook(set, ctx))).getWorksheet("Summary")!;
    const rows = rowsOf(sheet);
    expect(rows[0][0]).toBe("Lead sheets: =Falcon Trading LLC");
    expect(rows[1][0]).toBe("Demo Audit Firm");
    expect(String(rows[2][0])).toContain("period 2025-01-01 to 2025-12-31");
    expect(String(rows[2][0])).toContain("Balances include journal adjustments");
    const head = rows.find((r) => r[0] === "Lead sheet")!;
    expect(head).toContain("Adjusted");
    expect(head).toContain("Open review points");
    // The statement is in words, never the code, on the Summary and under each sheet's title.
    for (const sh of set.sheets) {
      const r = rows.find((x) => x[0] === sh.groupName)!;
      expect(r[1]).toBe(sh.statement === "SFP" ? "Statement of financial position" : "Statement of comprehensive income");
    }
    expect(JSON.stringify(rows)).not.toMatch(/"SFP"|"SCI"/);
    const cash = rows.find((r) => r[0] === set.sheets.find((s) => s.groupCode === "CASH")!.groupName)!;
    const cashSheet = set.sheets.find((s) => s.groupCode === "CASH")!;
    expect(minor(cash[3])).toBe(cashSheet.closingMinor);
    expect(minor(cash[4])).toBe(cashSheet.priorMinor);
    expect(minor(cash[5])).toBe(cashSheet.varianceMinor);
    expect(Number(cash[6]) * 100).toBeCloseTo(cashSheet.variancePct!, 6);
    expect(cash.slice(7, 12)).toEqual(["Pia Preparer", "2026-02-01", "Rae Reviewer", "2026-02-03", 2]);
    const rec = rows.find((r) => r[0] === set.sheets.find((s) => s.groupCode === "TRADEREC")!.groupName)!;
    expect(rec.slice(7, 12)).toEqual(["Pia Preparer", "2026-02-01", "", "", 0]);
    // A nil prior year has no percentage.
    expect(rec[6]).toBeUndefined();
    const unmapped = rows.find((r) => r[0] === "Accounts not on any lead sheet")!;
    expect(minor(unmapped[3])).toBe(1200);
    const total = rows.find((r) => r[0] === "Total")!;
    expect(minor(total[3])).toBe(set.totalMinor);
    expect(minor(total[4])).toBe(accounts.reduce((n, a) => n + (a.priorMinor ?? 0), 0));
    expect(rows.at(-1)![0]).toBe(set.tiesToTrialBalance ? "The lead sheet totals agree to the trial balance." : expect.stringContaining("do not agree"));
    expect(set.tiesToTrialBalance).toBe(true);
  });

  it("gives each lead sheet its accounts, adjustments and totals as numbers, equal to buildLeadSheets", async () => {
    const wb = await load(await buildLeadSheetWorkbook(set, ctx));
    for (const s of set.sheets) {
      const sheet = wb.getWorksheet(s.groupName)!;
      const rows = rowsOf(sheet);
      expect(String(rows[1][0])).toMatch(/^Statement of (financial position|comprehensive income), /);
      const head = rows.findIndex((r) => r[0] === "Code");
      expect(rows[head]).toEqual(["Code", "Account", "Per trial balance", "Adjustments", "Adjusted", "Prior year", "Movement", "Movement %"]);
      const body = rows.slice(head + 1, -1);
      expect(body.map((r) => r[0])).toEqual(s.accounts.map((a) => a.code));
      s.accounts.forEach((a, i) => {
        expect(minor(body[i][2]), a.code).toBe(a.closingMinor - (a.adjustmentMinor ?? 0));
        expect(body[i][3] === undefined ? 0 : minor(body[i][3])).toBe(a.adjustmentMinor ?? 0);
        expect(minor(body[i][4])).toBe(a.closingMinor);
        expect(a.priorMinor === null ? body[i][5] === undefined : minor(body[i][5]) === a.priorMinor).toBe(true);
        expect(minor(body[i][6])).toBe(a.closingMinor - (a.priorMinor ?? 0));
        const p = variancePct(a.closingMinor, a.priorMinor ?? 0);
        if (p === null) expect(body[i][7]).toBeUndefined();
        else expect(Number(body[i][7]) * 100).toBeCloseTo(p, 6);
      });
      // The total row is a plain number, the lead sheet's own total, never a formula.
      const total = rows.at(-1)!;
      expect(total[0]).toBe("Total");
      // Every amount column adds up: per trial balance plus adjustments is the adjusted total, on the total row as on every account row.
      expect(minor(total[2]) + minor(total[3])).toBe(minor(total[4]));
      expect(minor(total[2])).toBe(s.accounts.reduce((n, x) => n + x.closingMinor - (x.adjustmentMinor ?? 0), 0));
      expect(minor(total[3])).toBe(s.accounts.reduce((n, x) => n + (x.adjustmentMinor ?? 0), 0));
      expect(minor(total[4])).toBe(s.closingMinor);
      expect(minor(total[5])).toBe(s.priorMinor);
      expect(minor(total[6])).toBe(s.varianceMinor);
      const totalCell = sheet.getRow(rows.length).getCell(5);
      expect(typeof totalCell.value).toBe("number");
      expect(totalCell.formula).toBeUndefined();
    }
  });

  it("stores a name that starts with = (or +) as text, never a formula", async () => {
    const wb = await load(await buildLeadSheetWorkbook(set, ctx));
    const cash = wb.getWorksheet(set.sheets.find((s) => s.groupCode === "CASH")!.groupName)!;
    let found = false;
    cash.eachRow((row) => {
      const c = row.getCell(2);
      if (typeof c.value === "string" && c.value.startsWith("=HYPERLINK")) {
        found = true;
        expect(c.type).toBe(ExcelJS.ValueType.String);
        expect(c.formula).toBeUndefined();
        expect(c.numFmt).toBe("@");
      }
    });
    expect(found).toBe(true);
    const summary = wb.getWorksheet("Summary")!;
    expect(summary.getCell("A1").value).toBe("Lead sheets: =Falcon Trading LLC");
    expect(summary.getCell("A1").formula).toBeUndefined();
    const un = wb.getWorksheet("Unmapped")!;
    let plus = false;
    un.eachRow((row) => {
      if (row.getCell(2).value === "+Unmapped item") {
        plus = true;
        expect(row.getCell(2).numFmt).toBe("@");
      }
    });
    expect(plus).toBe(true);
  });

  it("freezes the heading row, sets widths and fits the page to its width", async () => {
    const wb = await load(await buildLeadSheetWorkbook(set, ctx));
    for (const sheet of wb.worksheets) {
      expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 5 });
      expect(sheet.pageSetup).toMatchObject({ orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 });
      expect(sheet.getColumn(2).width).toBeGreaterThan(20);
    }
  });

  it("says the unmapped accounts are not on any lead sheet, and has no Unmapped sheet when there are none", async () => {
    const un = (await load(await buildLeadSheetWorkbook(set, ctx))).getWorksheet("Unmapped")!;
    expect(rowsOf(un).map((r) => String(r[0])).some((t) => t.includes("not on any lead sheet"))).toBe(true);
    const clean = buildLeadSheets(accounts.filter((a) => a.groupCode));
    const wb = await load(await buildLeadSheetWorkbook(clean, ctx));
    expect(wb.getWorksheet("Unmapped")).toBeUndefined();
    expect(wb.worksheets.length).toBe(1 + clean.sheets.length);
  });

  it("leaves out the adjustment columns, and the note, when there are no adjustments", async () => {
    const plain = buildLeadSheets(accounts.map((a) => ({ ...a, adjustmentMinor: 0 })));
    const wb = await load(await buildLeadSheetWorkbook(plain, { ...ctx, hasAdjustments: false }));
    const sheet = wb.getWorksheet(plain.sheets[0].groupName)!;
    expect(rowsOf(sheet).find((r) => r[0] === "Code")).toEqual(["Code", "Account", "Closing", "Prior year", "Movement", "Movement %"]);
    expect(String(rowsOf(wb.getWorksheet("Summary")!)[2][0])).not.toContain("journal adjustments");
    expect(rowsOf(wb.getWorksheet("Summary")!).find((r) => r[0] === "Lead sheet")).toContain("Closing");
  });

  it("says when the totals do not agree to the trial balance", async () => {
    const broken = { ...set, tiesToTrialBalance: false };
    const rows = rowsOf((await load(await buildLeadSheetWorkbook(broken, ctx))).getWorksheet("Summary")!);
    expect(String(rows.at(-1)![0])).toContain("do not agree to the trial balance");
  });
});

// --- Database and route --------------------------------------------------------------------------------------------------------------
let db: Db;
let current: repo.Session | null;
vi.mock("../src/server/session", () => ({
  getSession: async () => {
    if (!current) throw new Error("not signed in");
    return current;
  },
  getOptionalSession: async () => current,
}));
vi.mock("../src/server/db", async (original) => {
  const real = await original<typeof import("../src/server/db")>();
  return { ...real, getDb: async () => db };
});

const FIRM = "aaaaaaaa-6060-4000-8000-000000000001";
const OTHER = "bbbbbbbb-6060-4000-8000-000000000001";
const user = (n: number, role: repo.Session["role"], firmId = FIRM): repo.Session => ({ firmId, userId: `${firmId.slice(0, 8)}-6060-4000-8000-00000000001${n}`, role });
const prep = user(1, "preparer");
const partner = user(3, "partner");
const outsider = user(5, "partner", OTHER);
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
const TB = [
  { code: "1000", name: "Bank - current account", closingMinor: 15000012, priorMinor: 10000000 },
  { code: "1200", name: "Trade receivables", closingMinor: 5000000, priorMinor: null as unknown as number },
  { code: "3000", name: "Share capital", closingMinor: -5000000, priorMinor: -5000000 },
  { code: "4000", name: "Sales", closingMinor: -15000012, priorMinor: -5000000 },
];
let engagement: string;
let empty: string;

describe("exporting an engagement's lead sheets", () => {
  beforeAll(async () => {
    db = await openDatabase();
    await db.query("insert into firms (id, name) values ($1, 'Demo Audit Firm'), ($2, 'Other Firm')", [FIRM, OTHER]);
    for (const u of [prep, partner, outsider]) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} user`, u.role]);
    await as(partner, async (tx) => {
      const client = await repo.createClient(tx, partner, "Falcon Trading LLC");
      engagement = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
      await repo.importTrialBalance(tx, partner, engagement, "tb.xlsx", TB);
      await repo.approveAllMappings(tx, partner, engagement);
      empty = await repo.createEngagement(tx, partner, await repo.createClient(tx, partner, "No TB Co"), "2025-01-01", "2025-12-31");
    });
  });
  afterAll(async () => {
    await db.close();
  });

  it("holds the same figures as the lead sheets page computes, including a journal adjustment, and names the file plainly", async () => {
    await as(partner, async (tx) => {
      const accounts = await repo.listAccounts(tx, engagement);
      const bank = accounts.find((a) => a.code === "1000")!;
      const sales = accounts.find((a) => a.code === "4000")!;
      await journals.createJournal(tx, partner, engagement, {
        type: "adjusting",
        description: "Accrued income",
        lines: [
          { accountId: bank.id, amountMinor: 50000 },
          { accountId: sales.id, amountMinor: -50000 },
        ],
      });
    });
    const file = (await as(prep, (tx) => exportLeadSheets(tx, prep, engagement)))!;
    expect(file.fileName).toBe("Lead sheets - Falcon-Trading-LLC - 2025-12-31.xlsx");
    // What the page does: balances plus journal adjustments, through buildLeadSheets.
    const accounts = await as(prep, (tx) => repo.listAccounts(tx, engagement));
    expect(accounts.some((a) => a.adjustmentMinor !== 0)).toBe(true);
    const page = buildLeadSheets(accounts.map((a) => ({ ...a, closingMinor: a.closingMinor + a.adjustmentMinor })));
    const wb = await load(file.buffer);
    const summary = rowsOf(wb.getWorksheet("Summary")!);
    for (const s of page.sheets) {
      const row = summary.find((r) => r[0] === s.groupName)!;
      expect([minor(row[3]), minor(row[4]), minor(row[5])], s.groupName).toEqual([s.closingMinor, s.priorMinor, s.varianceMinor]);
      const sheet = rowsOf(wb.getWorksheet(s.groupName)!);
      expect(minor(sheet.at(-1)![4])).toBe(s.closingMinor);
    }
    expect(String(summary[2][0])).toContain("Balances include journal adjustments");
    expect(summary.at(-1)![0]).toBe("The lead sheet totals agree to the trial balance.");
  });

  it("records the export", async () => {
    const entries = (await db.query<{ user_id: string; detail: { sheets: number } }>("select user_id, detail from audit_log where action = 'export' and entity = 'lead_sheets' and entity_id = $1", [engagement])).rows;
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].user_id).toBe(prep.userId);
    expect(entries[0].detail.sheets).toBeGreaterThan(0);
  });

  it("gives another firm's user nothing, and an engagement with no trial balance nothing", async () => {
    expect(await as(outsider, (tx) => exportLeadSheets(tx, outsider, engagement))).toBeNull();
    expect(await as(partner, (tx) => exportLeadSheets(tx, partner, empty))).toBeNull();
    expect(await as(partner, (tx) => exportLeadSheets(tx, partner, "dddddddd-6060-4000-8000-000000000001"))).toBeNull();
  });

  it("is a download for a signed-in user of the firm, and not found for another firm's user, a signed-out request, a bad id or no trial balance", async () => {
    const { GET } = await import("../src/app/(app)/engagements/[id]/lead-sheets/export/route");
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
    current = prep;
    const ok = await GET(new Request("http://localhost/x"), ctx(engagement));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("spreadsheetml.sheet");
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(ok.headers.get("content-disposition")).toBe('attachment; filename="Lead sheets - Falcon-Trading-LLC - 2025-12-31.xlsx"');
    expect(Buffer.from(await ok.arrayBuffer()).subarray(0, 2).toString()).toBe("PK");
    current = outsider;
    expect((await GET(new Request("http://localhost/x"), ctx(engagement))).status).toBe(404);
    current = null;
    expect((await GET(new Request("http://localhost/x"), ctx(engagement))).status).toBe(404);
    current = partner;
    expect((await GET(new Request("http://localhost/x"), ctx("not-an-id"))).status).toBe(404);
    expect((await GET(new Request("http://localhost/x"), ctx(empty))).status).toBe(404);
  });
});
