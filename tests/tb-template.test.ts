import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import { parseTemplate, recogniseTemplate, SAMPLE_ROWS, TEMPLATE_HEADINGS, TEMPLATE_URL } from "../src/domain/tb-template";
import { buildTrialBalanceTemplate } from "../src/server/tb-template";

let db: Db;
let current: (repo.Session & { name?: string }) | null;
vi.mock("../src/server/session", () => ({ getSession: async () => current, getOptionalSession: async () => current }));
vi.mock("../src/server/db", async (original) => {
  const real = await original<typeof import("../src/server/db")>();
  return { ...real, getDb: async () => db };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { uploadTrialBalanceAction } = await import("../src/app/actions");
const { GET } = await import("../src/app/(app)/trial-balance-template.xlsx/route");

const X = "aaaaaaaa-6060-4000-8000-000000000001";
const partner: repo.Session = { firmId: X, userId: "aaaaaaaa-6060-4000-8000-000000000011", role: "partner" };

const read = async (buf: Buffer | ArrayBuffer | Uint8Array) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  return wb;
};
const template = async () => read(await buildTrialBalanceTemplate());
const toBuffer = async (wb: ExcelJS.Workbook) => Buffer.from(await wb.xlsx.writeBuffer());

type Line = { code: string; name: string; debit?: number; credit?: number; pdebit?: number; pcredit?: number };
/** Fill the template: the example rows are cleared (unless kept) and the lines written from row 2, as a person would. */
async function filled(lines: Line[], opts: { keepSamples?: boolean; edit?: (ws: ExcelJS.Worksheet, wb: ExcelJS.Workbook) => void } = {}): Promise<Buffer> {
  const wb = await template();
  const ws = wb.getWorksheet("Trial balance")!;
  let r = 2;
  if (opts.keepSamples) r = 2 + SAMPLE_ROWS.length;
  else for (let i = 2; i < 2 + SAMPLE_ROWS.length; i++) for (let c = 1; c <= 6; c++) ws.getRow(i).getCell(c).value = null;
  for (const l of lines) {
    const row = ws.getRow(r++);
    row.getCell(1).value = l.code;
    row.getCell(2).value = l.name;
    if (l.debit !== undefined) row.getCell(3).value = l.debit;
    if (l.credit !== undefined) row.getCell(4).value = l.credit;
    if (l.pdebit !== undefined) row.getCell(5).value = l.pdebit;
    if (l.pcredit !== undefined) row.getCell(6).value = l.pcredit;
  }
  opts.edit?.(ws, wb);
  return toBuffer(wb);
}

// Invented accounts. Debits 1,500.00 and credits 1,500.00; prior year 1,200.00 each way.
const LINES: Line[] = [
  { code: "0101", name: "Cash at bank", debit: 1000, pdebit: 800 },
  { code: "1100", name: "Trade receivables", debit: 500.5, pdebit: 400 },
  { code: "3000", name: "Share capital", credit: 600, pcredit: 500 },
  { code: "4000", name: "Sales", credit: 900.5, pcredit: 700 },
];

let n = 0;
async function engagement(): Promise<string> {
  return withFirm(db, X, async (tx) => {
    const client = await repo.createClient(tx, partner, `Template Co ${++n}`);
    return repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
  });
}
const upload = async (id: string, data: Buffer | string, name = "tb.xlsx", extra: Record<string, string> = {}) => {
  current = partner;
  const form = new FormData();
  form.set("engagementId", id);
  form.set("file", new File([data as BlobPart], name));
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return uploadTrialBalanceAction({ ok: true, message: "" }, form);
};
const stored = async (id: string) => (await db.query<{ code: string; name: string; closing_minor: string; prior_minor: string | null }>("select code, name, closing_minor, prior_minor from accounts where engagement_id = $1 order by code", [id])).rows.map((r) => ({ ...r, closing_minor: Number(r.closing_minor), prior_minor: r.prior_minor === null ? null : Number(r.prior_minor) }));
const importSource = async (id: string) => (await db.query<{ layout: { source: string } | null }>("select layout from tb_imports where engagement_id = $1 order by imported_at desc limit 1", [id])).rows[0]?.layout?.source ?? null;

beforeAll(async () => {
  db = await openDatabase();
  await db.query("insert into firms (id, name) values ($1, 'Firm')", [X]);
  await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, 'p@x.test', 'Pat Partner', 'partner')", [partner.userId, X]);
});
afterAll(async () => {
  await db.close();
});

describe("the template file", () => {
  it("has the fixed headings, a frozen heading row, number and text formats, example rows, a totals row, instructions and a hidden marker", async () => {
    const wb = await template();
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Trial balance", "Instructions", "_ledgerfile"]);
    const ws = wb.getWorksheet("Trial balance")!;
    expect(TEMPLATE_HEADINGS.map((_, i) => ws.getRow(1).getCell(i + 1).value)).toEqual(["Account code", "Account name", "Debit", "Credit", "Prior year debit", "Prior year credit"]);
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    // Text for the code and name (so 0101 keeps its zero), numbers with two decimals for every amount.
    expect([1, 2].map((c) => ws.getRow(2).getCell(c).numFmt)).toEqual(["@", "@"]);
    expect([3, 4, 5, 6].map((c) => ws.getRow(2).getCell(c).numFmt)).toEqual(["#,##0.00", "#,##0.00", "#,##0.00", "#,##0.00"]);
    expect(ws.getRow(300).getCell(3).numFmt).toBe("#,##0.00");
    // Three example rows named (sample), and they balance.
    const samples = [2, 3, 4].map((r) => ({ code: ws.getRow(r).getCell(1).value, name: ws.getRow(r).getCell(2).value, dr: ws.getRow(r).getCell(3).value ?? 0, cr: ws.getRow(r).getCell(4).value ?? 0 }));
    expect(samples.map((s) => String(s.name))).toEqual(["Cash at bank (sample)", "Share capital (sample)", "Sales (sample)"]);
    expect(samples.reduce((a, s) => a + Number(s.dr) - Number(s.cr), 0)).toBe(0);
    expect(ws.getRow(2).getCell(3).value).toBe(1000);
    // The totals row: labelled Total, with SUM formulas.
    const total = ws.getRow(ws.rowCount);
    expect(total.getCell(2).value).toBe("Total");
    expect(String((total.getCell(3).value as { formula: string }).formula)).toMatch(/^SUM\(C2:C\d+\)$/);
    expect(String((total.getCell(6).value as { formula: string }).formula)).toMatch(/^SUM\(F2:F\d+\)$/);
    // The marker sheet is hidden and says which template and version.
    const marker = wb.getWorksheet("_ledgerfile")!;
    expect(marker.state).toBe("hidden");
    expect([marker.getRow(1).getCell(1).value, marker.getRow(1).getCell(2).value]).toEqual(["LedgerFile trial balance template", 1]);
  });

  it("has instructions in plain words, one thing to a line", async () => {
    const help = (await template()).getWorksheet("Instructions")!;
    const lines: string[] = [];
    help.eachRow((row) => lines.push(String(row.getCell(1).value)));
    const all = lines.join("\n");
    for (const phrase of ["one line for each account", "Debit or in Credit, not in both", "optional", "Leave the headings", "(sample)", "ignored", "Total line is optional", "must balance", ".xlsx"]) expect(all.toLowerCase()).toContain(phrase.toLowerCase());
    expect(lines.length).toBeGreaterThanOrEqual(8);
  });

  it("is served to a signed-in user, never cached, and a signed-out request is not found", async () => {
    current = partner;
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const wb = await read(await res.arrayBuffer());
    expect(wb.getWorksheet("Trial balance")).toBeDefined();
    current = null;
    const out = await GET();
    expect(out.status).toBe(404);
    expect(await out.text()).toBe("Not found");
    expect(TEMPLATE_URL).toBe("/trial-balance-template.xlsx");
  });
});

describe("a filled template", () => {
  it("imports with certainty, no chooser, and the accounts round-trip, with the code's leading zero kept", async () => {
    const id = await engagement();
    const state = await upload(id, await filled(LINES));
    expect(state.ok).toBe(true);
    expect(state.preview).toBeUndefined();
    expect(state.message).toContain("Imported 4 accounts");
    expect(state.message).toContain("Read as the LedgerFile template");
    expect(await importSource(id)).toBe("template");
    expect(await stored(id)).toEqual([
      { code: "0101", name: "Cash at bank", closing_minor: 100000, prior_minor: 80000 },
      { code: "1100", name: "Trade receivables", closing_minor: 50050, prior_minor: 40000 },
      { code: "3000", name: "Share capital", closing_minor: -60000, prior_minor: -50000 },
      { code: "4000", name: "Sales", closing_minor: -90050, prior_minor: -70000 },
    ]);
  });

  it("gives the prior year as debit minus credit, and none when the prior columns are empty", async () => {
    const id = await engagement();
    const lines: Line[] = [
      { code: "1000", name: "Cash at bank", debit: 100, pdebit: 90 },
      { code: "2000", name: "Loan", credit: 100, pcredit: 90 },
      { code: "5000", name: "Old account closed in the year", pdebit: 10 },
      { code: "5100", name: "Its offset", pcredit: 10 },
    ];
    const state = await upload(id, await filled(lines));
    expect(state.ok).toBe(true);
    const rows = await stored(id);
    expect(rows.find((r) => r.code === "1000")).toMatchObject({ closing_minor: 10000, prior_minor: 9000 });
    expect(rows.find((r) => r.code === "2000")).toMatchObject({ closing_minor: -10000, prior_minor: -9000 });
    expect(rows.find((r) => r.code === "5000")).toMatchObject({ closing_minor: 0, prior_minor: 1000 });
    const none = await engagement();
    await upload(none, await filled([{ code: "1", name: "Cash", debit: 5 }, { code: "2", name: "Capital", credit: 5 }]));
    expect((await stored(none)).map((r) => r.prior_minor)).toEqual([null, null]);
  });

  it("ignores the example rows left in, and lists them as left out", async () => {
    const id = await engagement();
    const state = await upload(id, await filled(LINES, { keepSamples: true }));
    expect(state.ok).toBe(true);
    expect(state.message).toContain("Imported 4 accounts");
    expect((await stored(id)).map((r) => r.code)).toEqual(["0101", "1100", "3000", "4000"]);
    expect(state.details).toEqual(expect.arrayContaining([expect.stringContaining("Row 2 was left out: an example row"), expect.stringContaining("Row 3 was left out"), expect.stringContaining("Row 4 was left out")]));
  });

  it("says so when only the example rows are there", async () => {
    const id = await engagement();
    const wb = await template();
    const state = await upload(id, await toBuffer(wb));
    expect(state.ok).toBe(false);
    expect(state.details?.join(" ")).toContain("Only the example rows (sample) were found");
    expect(await stored(id)).toEqual([]);
  });

  it("skips its own totals row, even with the formulas filled in", async () => {
    const id = await engagement();
    const buf = await filled(LINES, {
      edit: (ws) => {
        const total = ws.getRow(ws.rowCount);
        total.getCell(3).value = { formula: "SUM(C2:C501)", result: 1500.5 };
        total.getCell(4).value = { formula: "SUM(D2:D501)", result: 1500.5 };
      },
    });
    const state = await upload(id, buf);
    expect(state.ok).toBe(true);
    expect((await stored(id)).length).toBe(4);
  });

  it("still reads it with extra rows above the headings", async () => {
    const id = await engagement();
    const buf = await filled(LINES, { edit: (ws) => ws.spliceRows(1, 0, ["Client: Template Co"], ["Prepared on 31 December 2025"], []) });
    const state = await upload(id, buf);
    expect(state.ok).toBe(true);
    expect(state.preview).toBeUndefined();
    expect(await importSource(id)).toBe("template");
    expect((await stored(id)).length).toBe(4);
  });

  it("reads exact headings without the marker sheet, whatever the case, and in a .csv", async () => {
    const id = await engagement();
    const noMarker = await filled(LINES, { edit: (_ws, wb) => wb.removeWorksheet(wb.getWorksheet("_ledgerfile")!.id) });
    expect((await upload(id, noMarker)).ok).toBe(true);
    expect(await importSource(id)).toBe("template");
    const csv = await engagement();
    const state = await upload(csv, "ACCOUNT CODE,account  name,debit,credit,prior year debit,prior year credit\n0101,Cash,10,,9,\n0102,Capital,,10,,9\n", "tb.csv");
    expect(state.ok).toBe(true);
    expect(await importSource(csv)).toBe("template");
    expect((await stored(csv)).map((r) => r.code)).toEqual(["0101", "0102"]);
  });
});

describe("the checks, with the row named", () => {
  it("refuses a trial balance that does not balance, and imports nothing", async () => {
    const id = await engagement();
    const state = await upload(id, await filled([{ code: "1", name: "Cash", debit: 100 }, { code: "2", name: "Capital", credit: 90 }]));
    expect(state.ok).toBe(false);
    expect(state.message).toContain("does not balance");
    expect(state.message).toContain("10.00");
    expect(await stored(id)).toEqual([]);
  });

  it("names the row for a duplicate code, a blank name, an amount that is not a number, and debit and credit on one row", async () => {
    const id = await engagement();
    const buf = await filled(
      [
        { code: "1000", name: "Cash", debit: 100 },
        { code: "1000", name: "Cash again", debit: 5 }, // row 3: duplicate
        { code: "2000", name: "", credit: 100 }, // row 4: no name
        { code: "3000", name: "Capital", debit: 5, credit: 5 }, // row 5: both
        { code: "4000", name: "Sales", credit: 1 }, // row 6: not a number, set below
      ],
      { edit: (ws) => (ws.getRow(6).getCell(4).value = "twelve") },
    );
    const state = await upload(id, buf);
    expect(state.ok).toBe(false);
    const all = (state.details ?? []).join("\n");
    expect(all).toContain('Row 3: account "1000" also appears on row 2.');
    expect(all).toContain("Row 4: account 2000 has no name.");
    expect(all).toContain("Row 5: account 3000 has both a Debit and a Credit.");
    expect(all).toContain("Row 6: Credit is not a number.");
    expect(await stored(id)).toEqual([]);
  });

  it("names the row for a prior year debit and credit on one row", async () => {
    const id = await engagement();
    const state = await upload(id, await filled([{ code: "1", name: "Cash", debit: 1, pdebit: 1, pcredit: 1 }, { code: "2", name: "Capital", credit: 1 }]));
    expect(state.details?.join(" ")).toContain("Row 2: account 1 has both a Prior year debit and a Prior year credit.");
  });
});

describe("an edited template", () => {
  it("with a column deleted falls back to the usual reading and says which heading changed (here it ends in the chooser)", async () => {
    const id = await engagement();
    const buf = await filled(LINES, { edit: (ws) => ws.spliceColumns(4, 1) });
    const state = await upload(id, buf);
    expect(state.ok).toBe(false);
    expect(state.message).toContain("This looks like the LedgerFile template, but a heading was changed: Credit.");
    expect(state.preview).toBeDefined();
    expect(await stored(id)).toEqual([]);
  });

  it("with a heading reworded that the usual reading still understands, imports the usual way and says so", async () => {
    const id = await engagement();
    const buf = await filled(LINES, { edit: (ws) => (ws.getRow(1).getCell(2).value = "Description") });
    const state = await upload(id, buf);
    expect(state.ok).toBe(true);
    expect(state.details?.[0]).toBe("This looks like the LedgerFile template, but a heading was changed: Account name.");
    expect(await importSource(id)).not.toBe("template");
    expect((await stored(id)).length).toBe(4);
  });
});

describe("the template's recognition, pure", () => {
  const grid = (rows: unknown[][], name = "Trial balance") => ({ name, rows });
  const HEAD = ["Account code", "Account name", "Debit", "Credit", "Prior year debit", "Prior year credit"];
  it("recognises exact headings in any of the opening rows, and not further down", () => {
    expect(recogniseTemplate([grid([HEAD])])).toMatchObject({ kind: "template", headerRow: 0 });
    expect(recogniseTemplate([grid([["x"], ["y"], HEAD])])).toMatchObject({ kind: "template", headerRow: 2 });
    expect(recogniseTemplate([grid([...Array.from({ length: 25 }, () => ["x"]), HEAD])])).toBeNull();
  });
  it("is not the template without the marker when a heading is missing, and says which with the marker", () => {
    const missing = HEAD.filter((h) => h !== "Debit");
    expect(recogniseTemplate([grid([missing])])).toBeNull();
    const marker = { name: "_ledgerfile", rows: [["LedgerFile trial balance template", 1]] };
    expect(recogniseTemplate([grid([missing]), marker])).toEqual({ kind: "edited", sheetIndex: 0, changed: ["Debit"] });
  });
  it("parses by the row, with the example rows listed", () => {
    const rows = [HEAD, ["1", "Cash (sample)", 10, null, null, null], ["2", "Cash", 10, null, null, null], ["3", "Capital", null, 10, null, null]];
    const found = recogniseTemplate([grid(rows)]);
    if (found?.kind !== "template") throw new Error("expected the template");
    const parsed = parseTemplate(rows, found.headerRow, found.columns);
    expect(parsed.skipped).toEqual([{ row: 2, reason: expect.stringContaining("example row") }]);
    expect(parsed.accounts.map((a) => a.code)).toEqual(["2", "3"]);
    expect(parsed.balanced).toBe(true);
  });
});

describe("the links to the template", () => {
  it("a refused file (.xls, unreadable) offers it", async () => {
    const id = await engagement();
    const xls = await upload(id, "x", "old.xls");
    expect(xls.ok).toBe(false);
    expect(xls.message).toContain("Old-format .xls files are not supported");
    expect(xls.message).toContain("Download our template");
    const bad = await upload(id, "this is not a workbook", "tb.xlsx");
    expect(bad.message).toContain("Download our template");
  });

  it("is next to the upload, inside the column chooser and under every refusal", () => {
    const source = readFileSync("src/app/forms.tsx", "utf8");
    expect(source).toContain("TEMPLATE_URL");
    expect(source).toContain("Download our template".replace("Download our template", "TEMPLATE_LINK_TEXT"));
    expect((source.match(/<TemplateLink \/>/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(source).toMatch(/!state\.ok && state\.message[\s\S]{0,120}<TemplateLink \/>/);
  });
});
