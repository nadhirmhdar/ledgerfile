import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import { readGrid } from "../src/server/excel";
import { importClients, previewClientImport } from "../src/server/client-import";
import { canCreateClient, CLIENT_REFUSAL } from "../src/domain/permissions";
import { gridFromText } from "../src/domain/listing-parse";
import { classifyNames, cleanName, confirmLabel, gridFromPastedNames, importSentence, MAX_IMPORT_ROWS, nameKey, previewFromGrid, rowsToShow, type ImportCounts } from "../src/domain/client-import";

const col = (...names: string[]) => names.map((n) => [n]);

describe("cleaning and comparing names", () => {
  it("trims and collapses inner spaces, tabs and line breaks", () => {
    expect(cleanName("  Falcon   Trading \t LLC \n")).toBe("Falcon Trading LLC");
    expect(cleanName(null)).toBe("");
    expect(cleanName(42)).toBe("42");
  });
  it("compares by the cleaned name in lower case", () => {
    expect(nameKey("  FALCON   trading llc ")).toBe(nameKey("Falcon Trading LLC"));
    expect(nameKey("Falcon Trading")).not.toBe(nameKey("Falcon Trading LLC"));
  });
  it("keeps a name that starts with = (or +, -, @) exactly as typed: plain text", () => {
    for (const name of ["=HYPERLINK(\"x\")", "+Acme", "-Acme", "@Acme"]) {
      const p = previewFromGrid(col("Client name", name), []);
      expect(p.names).toEqual([name]);
    }
  });
});

describe("finding the column of names", () => {
  it("uses each of the heading words, in any case, wherever the column is", () => {
    for (const heading of ["Client name", "client", "NAME", "Company", "Entity", "  entity  "]) {
      const p = previewFromGrid([["Ref", heading, "Notes"], ["1", "Falcon Trading LLC", "x"], ["2", "Al Noor Contracting", "y"]], []);
      expect(p.foundHeading, heading).toBe(true);
      expect(p.names, heading).toEqual(["Falcon Trading LLC", "Al Noor Contracting"]);
    }
  });
  it("finds a heading below a title row, and starts after it", () => {
    const p = previewFromGrid([["Our clients 2026"], [], ["Client", "Phone"], ["Falcon Trading LLC", "1"]], []);
    expect(p.foundHeading).toBe(true);
    expect(p.names).toEqual(["Falcon Trading LLC"]);
    expect(p.rows[0].line).toBe(4);
  });
  it("with no heading, uses the first column that has anything in it, and every row counts", () => {
    const p = previewFromGrid([[null, "Falcon Trading LLC", "x"], [null, "Al Noor Contracting", "y"]], []);
    expect(p.foundHeading).toBe(false);
    expect(p.names).toEqual(["Falcon Trading LLC", "Al Noor Contracting"]);
    expect(p.rows.map((r) => r.line)).toEqual([1, 2]);
  });
  it("refuses a file with nothing in it, or nothing under the heading", () => {
    expect(previewFromGrid([[], [null, ""]], []).refused).toBe("The file has no names in it.");
    expect(previewFromGrid([["Client name"], [""]], []).refused).toBe("The file has no names under the heading.");
    expect(previewFromGrid([], []).refused).toBe("The file has no names in it.");
  });
  it("refuses more than 1,000 rows of names, and takes exactly 1,000", () => {
    const many = (n: number) => col("Client name", ...Array.from({ length: n }, (_, i) => `Client ${i + 1}`));
    expect(previewFromGrid(many(MAX_IMPORT_ROWS + 1), []).refused).toMatch(/more than 1,000 rows of names/);
    const ok = previewFromGrid(many(MAX_IMPORT_ROWS), []);
    expect(ok.refused).toBeNull();
    expect(ok.names).toHaveLength(MAX_IMPORT_ROWS);
  });
  it("does not count blank rows toward the limit", () => {
    const grid = col("Client name", ...Array.from({ length: 1500 }, (_, i) => (i % 2 === 0 ? `Client ${i}` : "")));
    expect(previewFromGrid(grid, []).refused).toBeNull();
  });
});

describe("what happens to each row", () => {
  const rows = (...names: unknown[]) => names.map((raw, i) => ({ line: i + 1, raw }));
  it("adds new names, in file order", () => {
    const r = classifyNames(rows("Falcon Trading LLC", "Al Noor Contracting"), []);
    expect(r.rows.map((x) => x.status)).toEqual(["add", "add"]);
    expect(r.counts).toEqual({ add: 2, existing: 0, repeated: 0, blank: 0, tooLong: 0, tooShort: 0 });
  });
  it("says a name is already a client when the keys match, whatever the case or spacing", () => {
    const r = classifyNames(rows("FALCON  trading llc", "New Co"), ["Falcon Trading LLC"]);
    expect(r.rows.map((x) => x.status)).toEqual(["existing", "add"]);
  });
  it("adds only the first copy of a name repeated in the file", () => {
    const r = classifyNames(rows("Acme LLC", "acme  llc", "Beta LLC", "ACME LLC"), []);
    expect(r.rows.map((x) => x.status)).toEqual(["add", "repeated", "add", "repeated"]);
    expect(r.counts.add).toBe(2);
    expect(r.counts.repeated).toBe(2);
  });
  it("skips blank rows silently and counts them", () => {
    const r = classifyNames(rows("Acme LLC", "", "   ", null, undefined, "Beta LLC"), []);
    expect(r.rows).toHaveLength(2);
    expect(r.counts.blank).toBe(4);
  });
  it("refuses a name over 200 characters (the Add client limit) and a single character", () => {
    const r = classifyNames(rows("x".repeat(200), "x".repeat(201), "A"), []);
    expect(r.rows.map((x) => x.status)).toEqual(["add", "too_long", "too_short"]);
    expect(r.counts).toMatchObject({ add: 1, tooLong: 1, tooShort: 1 });
  });
  it("does not let a too-long or already-a-client row hide a later copy of a name", () => {
    const r = classifyNames(rows("Acme LLC", "Acme LLC"), ["Acme LLC"]);
    expect(r.rows.map((x) => x.status)).toEqual(["existing", "existing"]);
  });
});

describe("the words", () => {
  const counts = (over: Partial<ImportCounts>): ImportCounts => ({ add: 0, existing: 0, repeated: 0, blank: 0, tooLong: 0, tooShort: 0, ...over });
  it("says the counts in one sentence, leaving out what is nil", () => {
    expect(importSentence(counts({ add: 12, existing: 3, repeated: 1, blank: 2 }))).toBe("12 to add, 3 already clients, 1 repeated in the file, 2 blank rows skipped.");
    expect(importSentence(counts({ add: 1, existing: 1, blank: 1 }))).toBe("1 to add, 1 already a client, 1 blank row skipped.");
    expect(importSentence(counts({ add: 0 }))).toBe("0 to add.");
    expect(importSentence(counts({ add: 2, tooLong: 1, tooShort: 2 }))).toBe("2 to add, 1 too long, 2 too short.");
  });
  it("shows the rows to add first", () => {
    const r = classifyNames([{ line: 1, raw: "Old Co" }, { line: 2, raw: "New Co" }, { line: 3, raw: "Newer Co" }], ["Old Co"]);
    expect(rowsToShow(r.rows).map((x) => x.name)).toEqual(["New Co", "Newer Co", "Old Co"]);
  });
  it("labels the confirm button", () => {
    expect(confirmLabel(1)).toBe("Add 1 client");
    expect(confirmLabel(12)).toBe("Add 12 clients");
    expect(confirmLabel(1200)).toBe("Add 1,200 clients");
  });
});

describe("reading a file and pasted text", () => {
  const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
  it("reads a .csv through readGrid, once, with a heading and a quoted comma", async () => {
    const grid = await readGrid("clients.csv", bytes('Client name,City\n"Falcon Trading, LLC",Dubai\nAl Noor Contracting,Sharjah\n'));
    const p = previewFromGrid(grid, []);
    expect(p.names).toEqual(["Falcon Trading, LLC", "Al Noor Contracting"]);
  });
  it("reads an .xlsx through readGrid, once, from a small generated workbook", async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Clients");
    sheet.addRow(["Ref", "Entity"]);
    sheet.addRow([1, "Falcon Trading LLC"]);
    sheet.addRow([2, "=SUM(1,1)"]);
    sheet.addRow([3, "Al Noor Contracting"]);
    const data = await wb.xlsx.writeBuffer();
    const grid = await readGrid("clients.xlsx", data as ArrayBuffer);
    const p = previewFromGrid(grid, ["al noor contracting"]);
    expect(p.names).toEqual(["Falcon Trading LLC", "=SUM(1,1)"]);
    expect(p.counts.existing).toBe(1);
  });
  it("reads pasted text, one name per line, with or without a heading", () => {
    expect(previewFromGrid(gridFromPastedNames("Client name\nFalcon Trading LLC\nAl Noor Contracting\n"), []).names).toEqual(["Falcon Trading LLC", "Al Noor Contracting"]);
    const bare = previewFromGrid(gridFromPastedNames("Falcon Trading LLC\nAl Noor Contracting"), []);
    expect(bare.foundHeading).toBe(false);
    expect(bare.names).toEqual(["Falcon Trading LLC", "Al Noor Contracting"]);
  });
  it("keeps a comma inside a pasted name: with no tab, each whole line is one name", () => {
    const p = previewFromGrid(gridFromPastedNames("Client name\nFalcon Trading, LLC\n=SUM(1,2) Invented Gamma (sample)\nAl Noor, Contracting & Sons, Ltd\n"), []);
    expect(p.names).toEqual(["Falcon Trading, LLC", "=SUM(1,2) Invented Gamma (sample)", "Al Noor, Contracting & Sons, Ltd"]);
    expect(previewFromGrid(gridFromPastedNames("Falcon Trading, LLC"), []).names).toEqual(["Falcon Trading, LLC"]);
  });
  it("reads a quoted pasted name without the quotes, with doubled quotes as one", () => {
    const p = previewFromGrid(gridFromPastedNames('Client name\n"Falcon Trading, LLC"\n"The ""Gamma"" Group"\n"Unclosed name\nPlain Co'), []);
    expect(p.names).toEqual(["Falcon Trading, LLC", 'The "Gamma" Group', '"Unclosed name', "Plain Co"]);
  });
  it("splits a paste from Excel on its tabs, and takes the column under the heading", () => {
    const p = previewFromGrid(gridFromPastedNames("Ref\tClient name\tCity\n1\tFalcon Trading, LLC\tDubai\n2\tAl Noor Contracting\tSharjah"), []);
    expect(p.foundHeading).toBe(true);
    expect(p.names).toEqual(["Falcon Trading, LLC", "Al Noor Contracting"]);
  });
  it("reads Windows line endings", () => {
    expect(previewFromGrid(gridFromPastedNames("Client name\r\nFalcon Trading, LLC\r\nAl Noor Contracting\r\n"), []).names).toEqual(["Falcon Trading, LLC", "Al Noor Contracting"]);
  });
  it("leaves the schedule listing's own reading of pasted text alone: it still splits on commas", () => {
    expect(gridFromText("Falcon Trading, LLC")).toEqual([["Falcon Trading", " LLC"]]);
  });
  it("refuses a file that is not .xlsx or .csv", async () => {
    await expect(readGrid("clients.pdf", bytes("x"))).rejects.toThrow(/Excel \(\.xlsx\) or CSV/);
  });
});

// --- Database ------------------------------------------------------------------------------------------------------------------------
const FIRM = "aaaaaaaa-7070-4000-8000-000000000001";
const OTHER = "bbbbbbbb-7070-4000-8000-000000000001";
const user = (n: number, role: repo.Session["role"], firmId = FIRM): repo.Session => ({ firmId, userId: `${firmId.slice(0, 8)}-7070-4000-8000-00000000001${n}`, role });
const prep = user(1, "preparer");
const rev = user(2, "reviewer");
const partner = user(3, "partner");
const admin = user(4, "admin");
const outsider = user(5, "partner", OTHER);
let db: Db;
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
const clientNames = async (firm: string) => (await db.query<{ name: string }>("select name from clients where firm_id = $1 order by name", [firm])).rows.map((r) => r.name);

describe("importing clients", () => {
  beforeAll(async () => {
    db = await openDatabase();
    await db.query("insert into firms (id, name) values ($1, 'Firm'), ($2, 'Other Firm')", [FIRM, OTHER]);
    for (const u of [prep, rev, partner, admin, outsider]) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} user`, u.role]);
    await as(partner, (tx) => repo.createClient(tx, partner, "Existing Co LLC"));
    await as(outsider, (tx) => repo.createClient(tx, outsider, "Falcon Trading LLC"));
  });
  afterAll(async () => {
    await db.close();
  });

  it("is for whoever may add a client, the same rule as the Add client form", async () => {
    // canCreateClient is a partner or the firm's administrator (partner-level); a reviewer and a preparer may not.
    const grid = col("Client name", "Falcon Trading LLC");
    for (const s of [prep, rev]) {
      expect(canCreateClient(s.role)).toBe(false);
      await expect(as(s, (tx) => previewClientImport(tx, s, grid))).rejects.toThrow(CLIENT_REFUSAL);
      await expect(as(s, (tx) => importClients(tx, s, ["Falcon Trading LLC"]))).rejects.toThrow(CLIENT_REFUSAL);
    }
    for (const s of [partner, admin]) {
      expect(canCreateClient(s.role)).toBe(true);
      await expect(as(s, (tx) => previewClientImport(tx, s, grid))).resolves.toMatchObject({ refused: null });
    }
    expect(await clientNames(FIRM)).toEqual(["Existing Co LLC"]);
  });

  it("re-reads the role from the database, so a stale session that says partner is refused", async () => {
    const stale = { ...prep, role: "partner" as const };
    await expect(as(stale, (tx) => importClients(tx, stale, ["Falcon Trading LLC"]))).rejects.toThrow(CLIENT_REFUSAL);
    expect(await clientNames(FIRM)).toEqual(["Existing Co LLC"]);
  });

  it("previews against this firm's clients only: another firm's client of the same name is not 'already a client'", async () => {
    const p = await as(partner, (tx) => previewClientImport(tx, partner, col("Client name", "Falcon Trading LLC", "existing co llc", "Al Noor Contracting", "Al Noor  Contracting", "")));
    expect(p.counts).toEqual({ add: 2, existing: 1, repeated: 1, blank: 1, tooLong: 0, tooShort: 0 });
    expect(p.names).toEqual(["Falcon Trading LLC", "Al Noor Contracting"]);
    // Nothing was saved by previewing.
    expect(await clientNames(FIRM)).toEqual(["Existing Co LLC"]);
  });

  it("imports the new names in one go, logs a 'create client' entry for each and one 'import' entry with the counts", async () => {
    const r = await as(partner, (tx) => importClients(tx, partner, ["Falcon Trading LLC", "Al Noor Contracting", "Existing Co LLC", "al noor contracting"]));
    expect(r.added).toBe(2);
    expect(await clientNames(FIRM)).toEqual(["Al Noor Contracting", "Existing Co LLC", "Falcon Trading LLC"]);
    // Another firm's clients are untouched, and not visible here.
    expect(await clientNames(OTHER)).toEqual(["Falcon Trading LLC"]);
    expect(await as(partner, (tx) => repo.listClients(tx))).toHaveLength(3);
    const created = await db.query("select 1 from audit_log where firm_id = $1 and action = 'create' and entity = 'client'", [FIRM]);
    expect(created.rows).toHaveLength(3); // Existing Co LLC (setup) and the two new ones
    const imp = (await db.query<{ user_id: string; detail: Record<string, number> }>("select user_id, detail from audit_log where firm_id = $1 and action = 'import' and entity = 'clients'", [FIRM])).rows;
    expect(imp).toEqual([{ user_id: partner.userId, detail: { added: 2, alreadyClients: 1, repeated: 1, tooLong: 0, tooShort: 0, blank: 0 } }]);
  });

  it("takes a per-firm lock, so two imports of the same list one after the other leave one copy of each name", async () => {
    const list = ["Gamma Holdings, LLC", "Delta Works"];
    const first = await as(partner, (tx) => importClients(tx, partner, list));
    const second = await as(partner, (tx) => importClients(tx, partner, list));
    expect([first.added, second.added]).toEqual([2, 0]);
    expect((await clientNames(FIRM)).filter((n) => n === "Gamma Holdings, LLC" || n === "Delta Works")).toHaveLength(2);
    // The lock is a transaction lock on this firm's key: it is there and released at commit, on PGlite and on PostgreSQL alike.
    await as(partner, async (tx) => {
      await tx.query("select pg_advisory_xact_lock(hashtext($1))", [`clients:${FIRM}`]);
    });
    // Two concurrent imports of the same list leave one copy as well.
    const both = await Promise.allSettled([as(partner, (tx) => importClients(tx, partner, ["Omega Ltd"])), as(partner, (tx) => importClients(tx, partner, ["Omega Ltd"]))]);
    expect(both.every((r) => r.status === "fulfilled")).toBe(true);
    expect((await clientNames(FIRM)).filter((n) => n === "Omega Ltd")).toHaveLength(1);
    await db.query("delete from clients where firm_id = $1 and name in ('Gamma Holdings, LLC', 'Delta Works', 'Omega Ltd')", [FIRM]);
  });

  it("adds nothing the second time", async () => {
    const r = await as(partner, (tx) => importClients(tx, partner, ["Falcon Trading LLC", "Al Noor Contracting"]));
    expect(r.added).toBe(0);
    expect(await clientNames(FIRM)).toHaveLength(3);
  });

  it("never trusts the browser: it cleans, re-checks and refuses what is wrong", async () => {
    const r = await as(admin, (tx) => importClients(tx, admin, ["  =Beta  LLC ", "x".repeat(201), "A", "", "Beta LLC"]));
    // "=Beta LLC" and "Beta LLC" are different names; the long and one-character names and the blank are not added.
    expect(r.added).toBe(2);
    expect(await clientNames(FIRM)).toEqual(expect.arrayContaining(["=Beta LLC", "Beta LLC"]));
    expect(await clientNames(FIRM)).toHaveLength(5);
    await expect(as(partner, (tx) => importClients(tx, partner, "not a list"))).rejects.toThrow(/no names to add/);
    await expect(as(partner, (tx) => importClients(tx, partner, [1, 2]))).rejects.toThrow(/no names to add/);
    await expect(as(partner, (tx) => importClients(tx, partner, Array.from({ length: 1001 }, (_, i) => `C ${i}`)))).rejects.toThrow(/at most 1,000/);
  });
});
