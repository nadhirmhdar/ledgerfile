import { readFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import { sameAccountName } from "../src/domain/mapping-assistant";
import { validateLayout } from "../src/domain/tb-layout";
import { buildTrialBalanceTemplate } from "../src/server/tb-template";

let db: Db;
let current: repo.Session;
vi.mock("../src/server/session", () => ({ getSession: async () => current, getOptionalSession: async () => current }));
vi.mock("../src/server/db", async (original) => {
  const real = await original<typeof import("../src/server/db")>();
  return { ...real, getDb: async () => db };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { uploadTrialBalanceAction } = await import("../src/app/actions");

const X = "aaaaaaaa-8080-4000-8000-000000000001";
const partner: repo.Session = { firmId: X, userId: `${X.slice(0, 8)}-8080-4000-8000-000000000011`, role: "partner" };

const STANDARD = "Account Code,Account Name,Debit,Credit\n1000,Bank,500.00,\n3000,Capital,,500.00\n";
const WITH_NOISE = "Account Code,Account Name,Debit,Credit\nAssets,,,\n1000,Bank,500.00,\n3000,Capital,,500.00\nTotal,,500.00,500.00\n";
const UNBALANCED = "Account Code,Account Name,Debit,Credit\n1000,Bank,500.00,\n3000,Capital,,400.00\n";
const DUPLICATE = "Account Code,Account Name,Debit,Credit\n1000,Bank,500.00,\n1000,Bank again,,500.00\n";
const ERPNEXT = readFileSync(path.join(__dirname, "fixtures", "tb-shapes", "erpnext.csv"), "utf8");
const ODD_2024 = "Head,Closing amt Dr,Closing amt Cr,Yr 2023\nCash at bank,1000.00,,900.00\nShare capital,,1000.00,-900.00\n";
const ODD_2025 = "Note,Yr 2024,Closing amt Cr,HEAD,Closing amt Dr\nx,800.00,,Cash at bank,1200.00\ny,-800.00,1200.00,Share capital,\n";
const CHOICE = { headerRow: "0", role_0: "name", role_1: "debit", role_2: "credit", role_3: "prior" };

const file = (name: string, content: string | ArrayBuffer | Buffer) => new File([content as BlobPart], name);
const send = (engagementId: string, f: File, extra: Record<string, string> = {}) => {
  current = partner;
  const form = new FormData();
  form.set("engagementId", engagementId);
  form.set("file", f);
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return uploadTrialBalanceAction({ ok: true, message: "" }, form);
};
const preview = (id: string, f: File, extra: Record<string, string> = {}) => send(id, f, { intent: "preview", ...extra });
const doImport = (id: string, f: File, extra: Record<string, string> = {}) => send(id, f, { intent: "import", ...extra });

let n = 0;
async function engagement(): Promise<{ id: string; client: string }> {
  n++;
  return withFirm(db, X, async (tx) => {
    const client = await repo.createClient(tx, partner, `Preview Co ${n}`);
    return { id: await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31"), client };
  });
}
const engagementFor = (client: string, period: [string, string]) => withFirm(db, X, (tx) => repo.createEngagement(tx, partner, client, period[0], period[1]));
const accounts = async (id: string) => (await db.query<{ code: string; name: string; closing_minor: string; prior_minor: string | null }>("select code, name, closing_minor::text, prior_minor::text from accounts where engagement_id = $1 order by code", [id])).rows;
const mappings = async (id: string) =>
  (await db.query<{ code: string; group_code: string; source: string; approved: boolean; reason: string | null }>("select a.code, m.group_code, m.source, m.approved, m.reason from mappings m join accounts a on a.id = m.account_id where a.engagement_id = $1 order by a.code", [id])).rows;
const imports = async (id: string) => Number((await db.query<{ n: string }>("select count(*)::text n from tb_imports where engagement_id = $1", [id])).rows[0].n);
const importSource = async (id: string) => (await db.query<{ layout: { source: string } | null }>("select layout from tb_imports where engagement_id = $1 order by imported_at desc, id desc limit 1", [id])).rows[0]?.layout?.source ?? null;
const remembered = async (client: string) => (await db.query<{ tb_layout: unknown }>("select tb_layout from clients where id = $1", [client])).rows[0].tb_layout;

beforeAll(async () => {
  db = await openDatabase();
  await db.query("insert into firms (id, name) values ($1, 'Firm')", [X]);
  await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, 'p@x.test', 'Pat Partner', 'partner')", [partner.userId, X]);
});
afterAll(async () => {
  await db.close();
});

describe("the preview before an import", () => {
  it("shows what the import would do, and saves nothing", async () => {
    const e = await engagement();
    const state = await preview(e.id, file("tb.csv", STANDARD));
    expect(state.ok).toBe(true);
    expect(state.message).toContain("Nothing has been imported yet");
    expect(state.preview!.review).toMatchObject({ source: "Columns detected", accounts: 2, debitMinor: 50000, creditMinor: 50000, differenceMinor: 0, balanced: true, errors: [], mustConfirm: false, canImport: true });
    expect(state.preview!.selected).toMatchObject({ 0: "code", 1: "name", 2: "debit", 3: "credit" });
    expect(state.preview!.rows.length).toBeGreaterThan(0);
    expect(await accounts(e.id)).toEqual([]);
    expect(await imports(e.id)).toBe(0);
    expect(await mappings(e.id)).toEqual([]);
    expect(await remembered(e.client)).toBeNull();
    expect(Number((await db.query<{ n: string }>("select count(*)::text n from audit_log where action = 'import'")).rows[0].n)).toBe(0);
  });

  it("lists the rows it leaves out, with the reason, and the sheet and the source", async () => {
    const e = await engagement();
    const state = await preview(e.id, file("tb.csv", WITH_NOISE));
    expect(state.ok).toBe(true);
    const review = state.preview!.review!;
    expect(review.accounts).toBe(2);
    expect(review.skipped).toEqual([
      { row: 2, reason: expect.stringContaining("heading line") },
      { row: 5, reason: expect.stringContaining("total line") },
    ]);
    expect(review.sheetName).toBe("Sheet1");
  });

  it("says when it does not balance or has errors, and the import is not offered", async () => {
    const e = await engagement();
    const bad = await preview(e.id, file("tb.csv", UNBALANCED));
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain("does not balance");
    expect(bad.preview!.review).toMatchObject({ balanced: false, differenceMinor: 10000, canImport: false });
    const dup = await preview(e.id, file("tb.csv", DUPLICATE));
    expect(dup.ok).toBe(false);
    expect(dup.preview!.review!.errors[0]).toContain("also appears on row");
    expect(await accounts(e.id)).toEqual([]);
  });

  it("imports exactly what a plain import has always imported, with the same mappings and source", async () => {
    const a = await engagement();
    const b = await engagement();
    const legacy = await send(a.id, file("tb.csv", STANDARD));
    expect(legacy.ok).toBe(true);
    await preview(b.id, file("tb.csv", STANDARD));
    const after = await doImport(b.id, file("tb.csv", STANDARD));
    expect(after.ok).toBe(true);
    expect(after.message).toBe(legacy.message);
    expect(await accounts(b.id)).toEqual(await accounts(a.id));
    expect((await mappings(b.id)).map(({ code, group_code, source, approved }) => ({ code, group_code, source, approved }))).toEqual((await mappings(a.id)).map(({ code, group_code, source, approved }) => ({ code, group_code, source, approved })));
    expect(await importSource(b.id)).toBe(await importSource(a.id));
    expect(await importSource(b.id)).toBe("detected");
  });

  it("uses the columns remembered for the client first, and says so", async () => {
    const e2024 = await engagement();
    expect((await send(e2024.id, file("tb.csv", ODD_2024), CHOICE)).ok).toBe(true);
    expect(await remembered(e2024.client)).not.toBeNull();
    const next = await engagementFor(e2024.client, ["2026-01-01", "2026-12-31"]);
    const state = await preview(next, file("tb.csv", ODD_2025));
    expect(state.ok).toBe(true);
    expect(state.preview!.review).toMatchObject({ source: "Columns as remembered for this client", accounts: 2, balanced: true });
    expect(await accounts(next)).toEqual([]);
    const done = await doImport(next, file("tb.csv", ODD_2025));
    expect(done.ok).toBe(true);
    expect(await importSource(next)).toBe("remembered");
  });

  it("is read again with a changed role, saves nothing, and imports as chosen", async () => {
    const e = await engagement();
    // Swap debit and credit: the same file reads with the totals the other way round.
    const swapped = { intent: "preview", edited: "1", sheet: "0", headerRow: "0", role_0: "code", role_1: "name", role_2: "credit", role_3: "debit" };
    const state = await send(e.id, file("tb.csv", STANDARD), swapped);
    expect(state.ok).toBe(true);
    expect(state.preview!.review).toMatchObject({ source: "Columns you chose", debitMinor: 50000, creditMinor: 50000 });
    expect(state.preview!.edited).toBe(true);
    // A choice that cannot be read is said, with the preview kept.
    const none = await send(e.id, file("tb.csv", STANDARD), { intent: "preview", edited: "1", sheet: "0", headerRow: "0", role_0: "code", role_1: "name" });
    expect(none.ok).toBe(false);
    expect(none.message).toContain("Debit and a Credit column");
    expect(none.preview).toBeDefined();
    expect(await accounts(e.id)).toEqual([]);
    const done = await send(e.id, file("tb.csv", STANDARD), { ...swapped, intent: "import" });
    expect(done.ok).toBe(true);
    expect(done.message).toContain("Columns you chose");
    expect(await importSource(e.id)).toBe("chosen");
  });

  it("ignores the columns in the form after a preview unless the person changed them", async () => {
    const e = await engagement();
    const done = await doImport(e.id, file("tb.csv", STANDARD), { sheet: "0", headerRow: "0", role_0: "name", role_1: "debit", role_2: "credit" });
    expect(done.ok).toBe(true);
    expect(await importSource(e.id)).toBe("detected");
    expect((await accounts(e.id)).map((a) => a.code)).toEqual(["1000", "3000"]);
  });
});

describe("a low-confidence reading must be confirmed", () => {
  it("is shown with the reasons and imports nothing, even when asked to import", async () => {
    const e = await engagement();
    for (const step of ["preview", "import"]) {
      const state = await send(e.id, file("tb.csv", ERPNEXT), { intent: step });
      expect(state.ok).toBe(false);
      expect(state.preview!.review).toMatchObject({ mustConfirm: true, canImport: false });
      expect(state.preview!.review!.confidence!.level).toBe("low");
      expect(state.preview!.edited).toBe(true);
      expect(state.preview!.selected[0]).toBe("codename");
    }
    expect(await accounts(e.id)).toEqual([]);
  });

  it("needs the box ticked, then imports the columns the person confirmed", async () => {
    const e = await engagement();
    const confirmed = { intent: "import", edited: "1", low: "1", sheet: "0", headerRow: "4", role_0: "codename", role_5: "debit", role_6: "credit" };
    const refused = await send(e.id, file("tb.csv", ERPNEXT), confirmed);
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain("Tick the box");
    expect(await accounts(e.id)).toEqual([]);
    const done = await send(e.id, file("tb.csv", ERPNEXT), { ...confirmed, confirmLow: "1" });
    expect(done.ok).toBe(true);
    expect(await accounts(e.id)).toHaveLength(7);
    expect(await importSource(e.id)).toBe("chosen");
    expect(await remembered(e.client)).not.toBeNull();
  });
});

describe("the LedgerFile template", () => {
  async function filled() {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildTrialBalanceTemplate()) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Trial balance")!;
    ws.getRow(5).getCell(1).value = "1000";
    ws.getRow(5).getCell(2).value = "Cash at bank";
    ws.getRow(5).getCell(3).value = 100;
    ws.getRow(6).getCell(1).value = "3000";
    ws.getRow(6).getCell(2).value = "Capital";
    ws.getRow(6).getCell(4).value = 100;
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it("shows a short preview with the columns fixed and its example rows listed, and one Import", async () => {
    const e = await engagement();
    const state = await preview(e.id, file("tb.xlsx", await filled()));
    expect(state.ok).toBe(true);
    expect(state.preview!.locked).toBe(true);
    expect(state.preview!.review).toMatchObject({ source: "Read as the LedgerFile template", accounts: 2, balanced: true, canImport: true });
    expect(state.preview!.review!.skipped.map((s) => s.row)).toEqual([2, 3, 4]);
    expect(await accounts(e.id)).toEqual([]);
    const done = await doImport(e.id, file("tb.xlsx", await filled()));
    expect(done.ok).toBe(true);
    expect(await importSource(e.id)).toBe("template");
    expect((await accounts(e.id)).map((a) => a.code)).toEqual(["1000", "3000"]);
  });
});

describe("code and name in one column", () => {
  const COMBINED = "Ledger account,Debit,Credit\n1100 - Debtors,900.00,\nDebtors petty (1200),100.00,\n3000 - Capital,,1000.00\n";
  const roles = { sheet: "0", headerRow: "0", role_0: "codename", role_1: "debit", role_2: "credit" };

  it("is a role the chooser offers, and splits the code from the name", async () => {
    const e = await engagement();
    const state = await send(e.id, file("tb.csv", COMBINED), roles);
    expect(state.ok).toBe(true);
    expect((await accounts(e.id)).map((a) => [a.code, a.name])).toEqual([
      ["1100", "Debtors"],
      ["1200", "Debtors petty"],
      ["3000", "Capital"],
    ]);
    expect(await remembered(e.client)).toMatchObject({ headings: { codename: "Ledger account" } });
  });

  it("keeps the whole text as the name when it cannot be split", async () => {
    const e = await engagement();
    const text = "Ledger account,Debit,Credit\nPetty cash float,100.00,\nCapital,,100.00\n";
    const state = await send(e.id, file("tb.csv", text), roles);
    expect(state.ok).toBe(true);
    expect((await accounts(e.id)).map((a) => [a.code, a.name])).toEqual([
      ["Capital", "Capital"],
      ["Petty cash float", "Petty cash float"],
    ]);
  });

  it("is on its own: not together with a code or a name column", () => {
    expect(validateLayout({ headerRow: 0, columns: { codename: 0, debit: 1, credit: 2 } }, 5)).toEqual([]);
    expect(validateLayout({ headerRow: 0, columns: { codename: 0, name: 1, debit: 2, credit: 3 } }, 5)).toEqual([expect.stringContaining("one Code and name column")]);
  });
});

describe("accounts renamed on a re-import", () => {
  const TB = (names: Record<string, string> = {}): { code: string; name: string; closingMinor: number; priorMinor: number | null }[] => [
    { code: "1000", name: names["1000"] ?? "Bank - current account", closingMinor: 10000, priorMinor: null },
    { code: "1100", name: names["1100"] ?? "Trade receivables", closingMinor: 5000, priorMinor: null },
    { code: "2000", name: names["2000"] ?? "Trade payables", closingMinor: -4000, priorMinor: null },
    { code: "3000", name: names["3000"] ?? "Share capital", closingMinor: -6000, priorMinor: null },
    { code: "4000", name: names["4000"] ?? "Sales", closingMinor: -5000, priorMinor: null },
  ];
  const as = <R,>(fn: (tx: Parameters<Parameters<typeof withFirm>[2]>[0]) => Promise<R>) => withFirm(db, X, fn);

  async function accepted() {
    const e = await engagement();
    await as(async (tx) => {
      await repo.importTrialBalance(tx, partner, e.id, "tb.xlsx", TB());
      await repo.approveAllMappings(tx, partner, e.id);
    });
    return e.id;
  }

  it("keeps an accepted mapping when the name is the same account: case, punctuation, or an added qualifier", async () => {
    const id = await accepted();
    const before = await mappings(id);
    expect(before.every((m) => m.approved)).toBe(true);
    const result = await as((tx) => repo.importTrialBalance(tx, partner, id, "tb2.xlsx", TB({ "1100": "TRADE RECEIVABLES.", "2000": "Trade Payables - AED", "4000": "Sales (net)" })));
    expect(result).not.toHaveProperty("renamed");
    expect(await mappings(id)).toEqual(before);
  });

  it("keeps the group only as an unaccepted suggestion, with the old name, when the account is a different one", async () => {
    const id = await accepted();
    const before = await mappings(id);
    const result = await as((tx) => repo.importTrialBalance(tx, partner, id, "tb2.xlsx", TB({ "2000": "Accrued expenses" })));
    expect(result.renamed).toBe(1);
    const after = await mappings(id);
    const was = before.find((m) => m.code === "2000")!;
    const now = after.find((m) => m.code === "2000")!;
    expect(now).toMatchObject({ group_code: was.group_code, approved: false, source: "assistant", reason: "The account's name changed since this mapping was accepted (was: Trade payables)" });
    // Every other account keeps exactly what it had.
    expect(after.filter((m) => m.code !== "2000")).toEqual(before.filter((m) => m.code !== "2000"));
  });

  it("counts it as a suggestion, not as carried forward", async () => {
    const id = await accepted();
    const result = await as((tx) => repo.importTrialBalance(tx, partner, id, "tb2.xlsx", TB({ "3000": "Directors current account" })));
    expect(result).toMatchObject({ imported: 5, carriedForward: 4, suggested: 1, unmapped: 0, renamed: 1 });
  });

  it("changes nothing on an existing engagement until a trial balance is imported", async () => {
    const id = await accepted();
    const before = await mappings(id);
    // The accounts are left as they are; nothing re-checks them.
    expect(await mappings(id)).toEqual(before);
    expect((await accounts(id)).map((a) => a.name)).toContain("Trade payables");
  });

  it("tells the person, in the message and details, when an account changed name", async () => {
    const id = await accepted();
    await as((tx) => tx.query("update engagements set status = status where id = $1", [id]));
    const csv = "Account Code,Account Name,Debit,Credit\n1000,Bank - current account,100.00,\n1100,Trade receivables,50.00,\n2000,Accrued expenses,,40.00\n3000,Share capital,,60.00\n4000,Sales,,50.00\n";
    const state = await doImport(id, file("tb.csv", csv));
    expect(state.ok).toBe(true);
    expect(state.details?.[0]).toContain("1 account changed name since the mapping was accepted");
  });
});

describe("when two names are the same account (the owner's rule)", () => {
  it("is the same after case, spacing and punctuation, or when one name's content words are within the other's", () => {
    expect(sameAccountName("Trade receivables", "TRADE  RECEIVABLES.")).toBe(true);
    expect(sameAccountName("Trade receivables", "Trade Receivables - AED")).toBe(true);
    expect(sameAccountName("Trade Receivables - AED", "Trade receivables")).toBe(true);
    expect(sameAccountName("A/C Receivable", "Accounts receivable")).toBe(true);
  });
  it("is the same when only a qualifier is added: a currency, a status, a place", () => {
    expect(sameAccountName("Trade receivables", "Trade receivables - AED")).toBe(true);
    expect(sameAccountName("Cash at bank", "Cash at bank - closed account")).toBe(true);
    expect(sameAccountName("Bank - Dubai main", "Bank")).toBe(true);
  });
  it("is not the same when the extra word changes what the account is", () => {
    expect(sameAccountName("Salaries", "Salaries payable")).toBe(false);
    expect(sameAccountName("Rent", "Prepaid rent")).toBe(false);
    expect(sameAccountName("Vehicles", "Accumulated depreciation vehicles")).toBe(false);
    expect(sameAccountName("Interest", "Interest income")).toBe(false);
    expect(sameAccountName("Loan", "Loan write off")).toBe(false);
  });
  it("is not the same when they are different accounts", () => {
    expect(sameAccountName("Accrued expenses", "Invented trade payables")).toBe(false);
    expect(sameAccountName("Trade payables", "Trade receivables")).toBe(false);
    expect(sameAccountName("Bank", "")).toBe(false);
  });
});
