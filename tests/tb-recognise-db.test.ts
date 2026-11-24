import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";

let db: Db;
let current: repo.Session;
vi.mock("../src/server/session", () => ({ getSession: async () => current, getOptionalSession: async () => current }));
vi.mock("../src/server/db", async (original) => {
  const real = await original<typeof import("../src/server/db")>();
  return { ...real, getDb: async () => db };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { uploadTrialBalanceAction } = await import("../src/app/actions");

const X = "aaaaaaaa-3939-4000-8000-000000000001";
const partner: repo.Session = { firmId: X, userId: `${X.slice(0, 8)}-3939-4000-8000-000000000011`, role: "partner" };

// Invented sheets, written in the shape of exports. Plain detection cannot read these; the recogniser can.
const ARABIC = "اسم الحساب,مدين,دائن\nالصندوق,500.00,\nرأس المال,,500.00\n";
const DR_CR = "Code,Name,Balance,Dr/Cr\n1,Bank,\"1,250.00\",Dr\n2,Capital,\"1,250.00\",Cr\n";
const COMBINED = "Ledger account,Debit,Credit\n1100 - Debtors,900.00,\n1200 - Bank,100.00,\n3000 - Capital,,1000.00\n";
const UNBALANCED = "Code,Name,Closing Debit,Closing Credit\n1,Bank,500.00,\n2,Capital,,400.00\n";
const STANDARD = "Account Code,Account Name,Debit,Credit\n1000,Bank,500.00,\n3000,Capital,,500.00\n";
const NOTHING = "Alpha,Beta\n1,2\n";

const file = (name: string, content: string | ArrayBuffer) => new File([content], name);
const upload = (engagementId: string, f: File, extra: Record<string, string> = {}) => {
  current = partner;
  const form = new FormData();
  form.set("engagementId", engagementId);
  form.set("file", f);
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return uploadTrialBalanceAction({ ok: true, message: "" }, form);
};
async function engagementFor(client: string, period: [string, string]): Promise<string> {
  return withFirm(db, X, (tx) => repo.createEngagement(tx, partner, client, period[0], period[1]));
}
let n = 0;
async function engagement(): Promise<{ id: string; client: string }> {
  n++;
  return withFirm(db, X, async (tx) => {
    const client = await repo.createClient(tx, partner, `Client ${n}`);
    return { id: await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31"), client };
  });
}
const accounts = async (id: string) => (await db.query<{ code: string; name: string; closing_minor: string }>("select code, name, closing_minor::text from accounts where engagement_id = $1 order by code", [id])).rows;
const importLayout = async (id: string) => (await db.query<{ layout: { source: string; confidence?: string } | null }>("select layout from tb_imports where engagement_id = $1 order by imported_at desc, id desc limit 1", [id])).rows[0]?.layout ?? null;
const remembered = async (client: string) => (await db.query<{ tb_layout: unknown }>("select tb_layout from clients where id = $1", [client])).rows[0].tb_layout;

async function workbook(sheets: { name: string; rows: unknown[][] }[]): Promise<File> {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    for (const row of s.rows) ws.addRow(row);
  }
  const buffer = await wb.xlsx.writeBuffer();
  return file("tb.xlsx", buffer as ArrayBuffer);
}

beforeAll(async () => {
  db = await openDatabase();
  await db.query("insert into firms (id, name) values ($1, 'Firm')", [X]);
  await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, 'p@x.test', 'Pat Partner', 'partner')", [partner.userId, X]);
});

afterAll(async () => {
  await db.close();
});

describe("a sheet that plain detection cannot read, but its shape can be recognised", () => {
  it("imports Arabic headings, a Dr/Cr marker column and a combined code and name, and says how the columns were found", async () => {
    for (const [csv, expected] of [
      [ARABIC, [["الصندوق", "50000"], ["رأس المال", "-50000"]]],
      [DR_CR, [["1", "125000"], ["2", "-125000"]]],
      [COMBINED, [["1100", "90000"], ["1200", "10000"], ["3000", "-100000"]]],
    ] as const) {
      const e = await engagement();
      const state = await upload(e.id, file("tb.csv", csv));
      expect(state.ok, csv).toBe(true);
      expect(state.message).toContain("Columns recognised from the layout of the sheet");
      expect((await accounts(e.id)).map((a) => [a.code, a.closing_minor]), csv).toEqual(expected);
      expect(await importLayout(e.id)).toMatchObject({ source: "recognised" });
      // A recognised layout is not saved for the client: only plain detection and a person's choice are.
      expect(await remembered(e.client)).toBeNull();
    }
  });

  it("says what was left out and why, when it imports", async () => {
    const e = await engagement();
    const state = await upload(e.id, file("tb.csv", "رقم الحساب,اسم الحساب,مدين,دائن\n,الأصول,,\n1,الصندوق,500.00,\n2,رأس المال,,500.00\n,المجموع,500.00,500.00\n"));
    expect(state.ok).toBe(true);
    expect(state.details).toEqual(expect.arrayContaining(["Row 2 was left out: a heading row with no amounts.", "Row 5 was left out: a total row."]));
  });

  it("uses the sheet that looks like a trial balance in a workbook with several", async () => {
    const e = await engagement();
    const f = await workbook([
      { name: "Cover", rows: [["Invented Co"], ["Prepared for the owner"]] },
      { name: "Trial Balance", rows: [["رقم الحساب", "اسم الحساب", "مدين", "دائن"], ["1", "الصندوق", 5, null], ["2", "رأس المال", null, 5]] },
    ]);
    const state = await upload(e.id, f);
    expect(state.ok).toBe(true);
    expect(await accounts(e.id)).toHaveLength(2);
    expect(await importLayout(e.id)).toMatchObject({ source: "recognised" });
  });
});

describe("when it is not sure, it asks and imports nothing", () => {
  it("opens the chooser with what it found filled in, when the accounts do not balance", async () => {
    const e = await engagement();
    const state = await upload(e.id, file("tb.csv", UNBALANCED.replace("Closing Debit", "Closing Dr").replace("Closing Credit", "Closing Cr")));
    // Plain detection reads this one (and refuses it as unbalanced), so it is not the recogniser's case: nothing changed.
    expect(state.ok).toBe(false);
    expect(state.message).toContain("does not balance");
    expect(await accounts(e.id)).toHaveLength(0);

    const odd = await upload(e.id, file("tb.csv", "رقم الحساب,اسم الحساب,مدين,دائن\n1,الصندوق,500.00,\n2,رأس المال,,400.00\n"));
    expect(odd.ok).toBe(false);
    expect(odd.message).toContain("could not be read with confidence");
    expect(odd.message).toContain("do not balance");
    expect(odd.preview).toMatchObject({ headerRow: 0, sheet: 0, selected: { 0: "code", 1: "name", 2: "debit", 3: "credit" } });
    expect(await accounts(e.id)).toHaveLength(0);
  });

  it("keeps the sheet it found in the chooser, and imports from that sheet once the person confirms", async () => {
    const e = await engagement();
    const f = await workbook([
      { name: "Cover", rows: [["Invented Co"]] },
      { name: "Data", rows: [["رقم الحساب", "اسم الحساب", "مدين", "دائن"], ["1", "الصندوق", 500, null], ["2", "رأس المال", null, 400]] },
    ]);
    const asked = await upload(e.id, f);
    expect(asked.preview).toMatchObject({ sheet: 1, selected: { 0: "code", 1: "name", 2: "debit", 3: "credit" } });
    // The person corrects the figures' side by choosing Balance in place of Credit's pairing: here simply Debit and Credit again, on a balanced sheet.
    const fixed = await workbook([
      { name: "Cover", rows: [["Invented Co"]] },
      { name: "Data", rows: [["رقم الحساب", "اسم الحساب", "مدين", "دائن"], ["1", "الصندوق", 500, null], ["2", "رأس المال", null, 500]] },
    ]);
    const done = await upload(e.id, fixed, { headerRow: "0", sheet: "1", role_0: "code", role_1: "name", role_2: "debit", role_3: "credit" });
    expect(done.ok).toBe(true);
    expect(done.message).toContain("Columns you chose");
    expect(await accounts(e.id)).toHaveLength(2);
  });

  it("opens the plain chooser when nothing in any sheet looks like a trial balance", async () => {
    const e = await engagement();
    const state = await upload(e.id, file("tb.csv", NOTHING));
    expect(state.ok).toBe(false);
    expect(state.preview).toBeDefined();
    expect(await accounts(e.id)).toHaveLength(0);
  });

  it("opens the chooser when asked, without trying to recognise", async () => {
    const e = await engagement();
    const state = await upload(e.id, file("tb.csv", ARABIC), { chooseColumns: "1" });
    expect(state.ok).toBe(false);
    expect(state.preview).toBeDefined();
    expect(await accounts(e.id)).toHaveLength(0);
  });
});

describe("what was already read is read as before", () => {
  it("imports a file plain detection reads, as detected, and remembers its columns", async () => {
    const e = await engagement();
    const state = await upload(e.id, file("tb.csv", STANDARD));
    expect(state.ok).toBe(true);
    expect(state.message).toContain("Columns detected.");
    expect(await importLayout(e.id)).toMatchObject({ source: "detected" });
    expect(await remembered(e.client)).not.toBeNull();
  });

  it("still refuses an old .xls file with the plain message", async () => {
    const e = await engagement();
    const state = await upload(e.id, file("tb.xls", "x"));
    expect(state).toMatchObject({ ok: false, message: "Old-format .xls files are not supported. Save the file as .xlsx or .csv and upload it again." });
  });
});

describe("indentation kept as an Excel indent", () => {
  it("tells a group line from the accounts indented below it, though the cells hold no spaces", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Trial Balance");
    ws.addRow(["Particulars", "Closing Balance", null]);
    ws.addRow([null, "Debit", "Credit"]);
    const body: [string, number | null, number | null, number][] = [
      ["Current Assets", 1500, null, 0],
      ["Cash", 500, null, 1],
      ["Bank", 1000, null, 1],
      ["Capital", null, 1500, 0],
      ["Owner capital", null, 1500, 1],
    ];
    for (const [name, dr, cr, indent] of body) {
      const row = ws.addRow([name, dr, cr]);
      row.getCell(1).alignment = { indent };
    }
    const e = await engagement();
    const state = await upload(e.id, file("tb.xlsx", (await wb.xlsx.writeBuffer()) as ArrayBuffer));
    expect(state.ok).toBe(true);
    expect((await accounts(e.id)).map((a) => a.code)).toEqual(["Bank", "Cash", "Owner capital"]);
    expect(state.details).toEqual(expect.arrayContaining(["Row 3 was left out: a group line (it equals the lines indented below it).", "Row 6 was left out: a group line (it equals the lines indented below it)."]));
  });
});

describe("an export that can be read two ways with different closing balances", () => {
  const read = async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    return fs.readFileSync(path.join(__dirname, "fixtures", "tb-shapes", "erpnext.csv"), "utf8");
  };

  it("is not imported: it asks, with the recogniser's columns filled in; confirming imports them and remembers them for the client", async () => {
    const erpnext = await read();
    const e = await engagement();
    const asked = await upload(e.id, file("tb.csv", erpnext));
    expect(asked.ok).toBe(false);
    expect(asked.message).toBe("This file can be read two ways that give different closing balances (for example, the movement columns and the closing columns). Check which columns are the closing balance.");
    expect(asked.preview).toMatchObject({ headerRow: 4, sheet: 0, selected: { 0: "name", 5: "debit", 6: "credit" } });
    expect(await accounts(e.id)).toHaveLength(0);
    expect(await remembered(e.client)).toBeNull();

    // The person confirms the columns the chooser showed (the account column is a name; the closing pair is the balance).
    const done = await upload(e.id, file("tb.csv", erpnext), { headerRow: "4", sheet: "0", role_0: "name", role_5: "debit", role_6: "credit" });
    expect(done.ok).toBe(true);
    expect(done.message).toContain("Columns you chose");
    const rows = await accounts(e.id);
    expect(rows).toHaveLength(7);
    expect(rows.find((a) => a.code.startsWith("1000"))!.closing_minor).toBe("500000");
    expect(rows.find((a) => a.code.startsWith("4000"))!.closing_minor).toBe("-2000000");
    expect(await remembered(e.client)).not.toBeNull();

    // Next year's file for the same client uses the remembered columns and does not ask again.
    const next = await engagementFor(e.client, ["2026-01-01", "2026-12-31"]);
    const again = await upload(next, file("tb.csv", erpnext));
    expect(again.ok).toBe(true);
    expect(again.preview).toBeUndefined();
    expect(again.message).toContain("Columns as remembered for this client");
    expect((await accounts(next)).find((a) => a.code.startsWith("1000"))!.closing_minor).toBe("500000");
  });

  it("leaves a file both readings agree on, and anything a person chose, untouched", async () => {
    const e = await engagement();
    const state = await upload(e.id, file("tb.csv", STANDARD));
    expect(state.ok).toBe(true);
    expect(state.message).toContain("Columns detected.");
  });
});
