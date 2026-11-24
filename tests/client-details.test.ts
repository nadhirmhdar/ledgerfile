import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import { generateLetter } from "../src/server/letters";
import { getClientRecord, listClientRows, updateClient } from "../src/server/clients";
import { importClients, previewClientImport } from "../src/server/client-import";
import { CLIENT_REFUSAL } from "../src/domain/permissions";
import { checkDetails, checkEmail, checkTrn, checkYearEnd, parseYearEndText, periodForYearEnd } from "../src/domain/client-details";
import { previewFromGrid, readDetails } from "../src/domain/client-import";
import { buildEngagementLetter, type Block } from "../src/domain/letters";

describe("a tax registration number", () => {
  it("has 15 digits; spaces and hyphens between them are dropped; empty is none", () => {
    expect(checkTrn("100123456789003")).toEqual({ ok: true, value: "100123456789003" });
    expect(checkTrn(" 1001 2345 6789 003 ")).toEqual({ ok: true, value: "100123456789003" });
    expect(checkTrn("100-123-456-789-003")).toEqual({ ok: true, value: "100123456789003" });
    expect(checkTrn("")).toEqual({ ok: true, value: null });
  });
  it("refuses anything else, with a plain message", () => {
    for (const bad of ["12345", "1001234567890031", "10012345678900A", "TRN100123456789003"]) expect(checkTrn(bad), bad).toEqual({ ok: false, message: "A tax registration number has 15 digits." });
  });
});

describe("a year-end", () => {
  it("is a real day, stored as MM-DD", () => {
    expect(checkYearEnd("3-31")).toEqual({ ok: true, value: "03-31" });
    expect(checkYearEnd("12-31")).toEqual({ ok: true, value: "12-31" });
    expect(checkYearEnd("02-28")).toEqual({ ok: true, value: "02-28" });
    expect(checkYearEnd("")).toEqual({ ok: true, value: null });
  });
  it("refuses 29 February, a day that does not exist, and anything that is not a month and a day", () => {
    expect(checkYearEnd("02-29")).toMatchObject({ ok: false, message: expect.stringContaining("29 February") });
    expect(checkYearEnd("04-31")).toMatchObject({ ok: false, message: "April does not have 31 days." });
    expect(checkYearEnd("13-01")).toMatchObject({ ok: false });
    expect(checkYearEnd("00-10")).toMatchObject({ ok: false });
    expect(checkYearEnd("March 31")).toMatchObject({ ok: false });
  });
});

describe("a contact email", () => {
  it("has the shape of an address, and is optional", () => {
    expect(checkEmail("accounts@example.test")).toEqual({ ok: true, value: "accounts@example.test" });
    expect(checkEmail("")).toEqual({ ok: true, value: null });
    for (const bad of ["accounts", "accounts@", "@example.test", "a b@example.test", "a@b", "a@example.test, b@example.test"]) expect(checkEmail(bad), bad).toMatchObject({ ok: false });
  });
});

describe("all the details together", () => {
  it("are cleaned: empty is none, the address keeps its lines", () => {
    const r = checkDetails({ licenceNumber: "  CN-123   456 ", licensingAuthority: "", taxRegistrationNumber: "", yearEnd: "", address: " Office 12 \n\n Invented Tower \r\n Dubai ", contactName: "  Sam Invented ", contactEmail: "" });
    expect(r).toEqual({
      ok: true,
      value: { licenceNumber: "CN-123 456", licensingAuthority: null, taxRegistrationNumber: null, yearEnd: null, address: "Office 12\nInvented Tower\nDubai", contactName: "Sam Invented", contactEmail: null },
    });
  });
  it("names each field that is wrong, and the lengths", () => {
    const r = checkDetails({ licenceNumber: "x".repeat(61), taxRegistrationNumber: "12", yearEnd: "02-29", address: "x".repeat(301), contactEmail: "nope", licensingAuthority: "y".repeat(121) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["address", "contactEmail", "licenceNumber", "licensingAuthority", "taxRegistrationNumber", "yearEnd"]);
  });
});

describe("the period suggested for a year-end", () => {
  it("ends on the year-end just past and starts the day after the one a year earlier: 31 March", () => {
    expect(periodForYearEnd("03-31", "2026-05-10")).toEqual({ start: "2025-04-01", end: "2026-03-31" });
    expect(periodForYearEnd("03-31", "2026-02-01")).toEqual({ start: "2024-04-01", end: "2025-03-31" });
    expect(periodForYearEnd("03-31", "2026-03-31")).toEqual({ start: "2025-04-01", end: "2026-03-31" });
    expect(periodForYearEnd("03-31", "2026-03-30")).toEqual({ start: "2024-04-01", end: "2025-03-31" });
  });
  it("handles 31 December", () => {
    expect(periodForYearEnd("12-31", "2026-01-15")).toEqual({ start: "2025-01-01", end: "2025-12-31" });
    expect(periodForYearEnd("12-31", "2025-12-31")).toEqual({ start: "2025-01-01", end: "2025-12-31" });
  });
  it("handles 28 February in a leap year, and out of one", () => {
    // 2024 is a leap year: after it, the day after 28 February 2024 is 29 February.
    expect(periodForYearEnd("02-28", "2024-06-01")).toEqual({ start: "2023-03-01", end: "2024-02-28" });
    expect(periodForYearEnd("02-28", "2024-02-10")).toEqual({ start: "2022-03-01", end: "2023-02-28" });
    expect(periodForYearEnd("02-28", "2025-03-05")).toEqual({ start: "2024-02-29", end: "2025-02-28" });
  });
  it("suggests nothing for a year-end that is not valid, or a date that is not a date", () => {
    expect(periodForYearEnd("02-29", "2026-05-10")).toBeNull();
    expect(periodForYearEnd("03-31", "10 May 2026")).toBeNull();
  });
});

describe("reading a year-end from a spreadsheet cell", () => {
  it("reads the usual ways of writing it", () => {
    for (const [text, want] of [["31 March", "03-31"], ["31-Mar", "03-31"], ["31/03", "03-31"], ["03-31", "03-31"], ["March 31", "03-31"], ["31st December", "12-31"], ["Dec 31", "12-31"], ["30 June", "06-30"]] as const) expect(parseYearEndText(text), text).toBe(want);
  });
  it("gives nothing for what cannot be read, or 29 February", () => {
    for (const text of ["", "year end", "99/99", "29 February", "31 April"]) expect(parseYearEndText(text), text).toBeNull();
  });
});

describe("the client list import with extra columns", () => {
  const grid = [
    ["Client name", "Trade licence number", "TRN", "Year end", "Address", "Licensing authority"],
    ["Invented Contracting LLC (sample)", "CN-1001", "100123456789003", "31 March", "Office 1\nInvented Tower", "Department of Economy (invented)"],
    ["Invented Trading LLC (sample)", "", "12345", "someday", "", ""],
    ["Plain Name LLC (sample)"],
  ];
  it("reads the columns by their headings, still needs only a name, and names what it leaves out", () => {
    const p = previewFromGrid(grid, []);
    expect(p.extraColumns.sort()).toEqual(["address", "licenceNumber", "licensingAuthority", "taxRegistrationNumber", "yearEnd"]);
    expect(p.entries).toEqual([
      { name: "Invented Contracting LLC (sample)", details: { licenceNumber: "CN-1001", taxRegistrationNumber: "100123456789003", yearEnd: "03-31", address: "Office 1\nInvented Tower", licensingAuthority: "Department of Economy (invented)" } },
      { name: "Invented Trading LLC (sample)", details: {} },
      { name: "Plain Name LLC (sample)", details: {} },
    ]);
    const second = p.rows.find((r) => r.name.startsWith("Invented Trading"))!;
    expect(second.notes).toEqual([expect.stringContaining("TRN does not have 15 digits"), expect.stringContaining("year-end could not be read")]);
    expect(p.names).toHaveLength(3);
  });
  it("is unchanged for a file with only names", () => {
    const p = previewFromGrid([["Client"], ["A One LLC"], ["B Two LLC"]], []);
    expect(p.extraColumns).toEqual([]);
    expect(p.entries).toEqual([{ name: "A One LLC", details: {} }, { name: "B Two LLC", details: {} }]);
  });
  it("checks each value on its own", () => {
    const r = readDetails({ licenceNumber: "x".repeat(61), taxRegistrationNumber: "100123456789003" }, 4);
    expect(r.details).toEqual({ taxRegistrationNumber: "100123456789003" });
    expect(r.notes).toEqual([expect.stringContaining("Row 4: the licence number is longer than 60")]);
  });
});

describe("the engagement letter and the client's address", () => {
  const values = { "Firm name": "Demo Audit Firm", "Client legal name": "Falcon Trading LLC", "period end": "31 December 2025", framework: "IFRS for SMEs", Date: "1 March 2026", Addressee: "The Directors" };
  const lines = (blocks: Block[]) => blocks.flatMap((b) => (b.kind === "para" || b.kind === "heading" || b.kind === "bullet" ? [b.text] : []));
  it("prints the address under the addressee line, one line to a paragraph", () => {
    const l = lines(buildEngagementLetter({ values, otherServices: false, aiFeatures: false, clientAddress: ["Office 12", "Invented Tower", "Dubai"] }));
    const at = l.indexOf("To: The Directors, Falcon Trading LLC");
    expect(l.slice(at, at + 5)).toEqual(["To: The Directors, Falcon Trading LLC", "Office 12", "Invented Tower", "Dubai", "Audit of the financial statements for the year ending 31 December 2025"]);
  });
  it("is the letter it always was when the client has no address", () => {
    const without = buildEngagementLetter({ values, otherServices: false, aiFeatures: false });
    expect(buildEngagementLetter({ values, otherServices: false, aiFeatures: false, clientAddress: [] })).toEqual(without);
    expect(buildEngagementLetter({ values, otherServices: false, aiFeatures: false, clientAddress: undefined })).toEqual(without);
  });
});

describe("a client's details in the database", () => {
  const FIRM = "aaaaaaaa-9090-4000-8000-000000000001";
  const OTHER = "bbbbbbbb-9090-4000-8000-000000000001";
  const user = (n: number, role: repo.Session["role"], firmId = FIRM): repo.Session => ({ firmId, userId: `${firmId.slice(0, 8)}-9090-4000-8000-00000000001${n}`, role });
  const partner = user(1, "partner");
  const admin = user(2, "admin");
  const reviewer = user(3, "reviewer");
  const preparer = user(4, "preparer");
  const outsider = user(5, "partner", OTHER);
  let db: Db;
  type T = Parameters<Parameters<typeof withFirm>[2]>[0];
  const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
  let falcon: string;
  let desert: string;
  let ledgerEngagement: string;
  const DETAILS = { licenceNumber: "CN-5001", licensingAuthority: "Department of Economy (invented)", taxRegistrationNumber: "100123456789003", yearEnd: "03-31", address: "Office 12\nInvented Tower\nDubai", contactName: "Sam Invented", contactEmail: "sam@example.test" };

  beforeAll(async () => {
    db = await openDatabase();
    for (const firm of [FIRM, OTHER]) await db.query("insert into firms (id, name) values ($1, 'Al Noor Auditing')", [firm]);
    for (const u of [partner, admin, reviewer, preparer, outsider]) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-1)}`, u.role]);
    falcon = await as(partner, (tx) => repo.createClient(tx, partner, "Falcon Trading LLC"));
    desert = await as(partner, (tx) => repo.createClient(tx, partner, "Desert Logistics LLC"));
  });
  afterAll(async () => {
    await db.close();
  });

  it("is empty for an existing client, which keeps working", async () => {
    const c = (await as(preparer, (tx) => getClientRecord(tx, falcon)))!;
    expect(c).toMatchObject({ name: "Falcon Trading LLC", framework: "IFRS for SMEs", licenceNumber: null, licensingAuthority: null, taxRegistrationNumber: null, yearEnd: null, address: null, contactName: null, contactEmail: null, engagements: 0 });
    expect((await as(preparer, (tx) => repo.listClients(tx))).find((x) => x.id === falcon)).toMatchObject({ yearEnd: null });
  });

  it("may be edited by a partner or the administrator, and by nobody else", async () => {
    expect(await as(partner, (tx) => updateClient(tx, partner, falcon, { name: "Falcon Trading LLC", ...DETAILS }))).toMatchObject({ ok: true });
    expect(await as(admin, (tx) => updateClient(tx, admin, falcon, { name: "Falcon Trading LLC", ...DETAILS, contactName: "Alex Invented" }))).toMatchObject({ ok: true });
    for (const s of [reviewer, preparer]) await expect(as(s, (tx) => updateClient(tx, s, falcon, { name: "Falcon Trading LLC", ...DETAILS })), s.role).rejects.toThrow(CLIENT_REFUSAL);
    // The role is read from the database: a session that says partner for a preparer is refused.
    const stale: repo.Session = { ...preparer, role: "partner" };
    await expect(as(stale, (tx) => updateClient(tx, stale, falcon, { name: "Falcon Trading LLC", ...DETAILS }))).rejects.toThrow(CLIENT_REFUSAL);
    const c = (await as(preparer, (tx) => getClientRecord(tx, falcon)))!;
    expect(c).toMatchObject({ ...DETAILS, contactName: "Alex Invented" });
  });

  it("checks every value, names the field, and saves nothing when one is wrong", async () => {
    const r = await as(partner, (tx) => updateClient(tx, partner, falcon, { name: "Falcon Trading LLC", ...DETAILS, taxRegistrationNumber: "12", yearEnd: "02-29", contactEmail: "nope", licenceNumber: "NEW" }));
    expect(r).toMatchObject({ ok: false, errors: { taxRegistrationNumber: expect.any(String), yearEnd: expect.stringContaining("29 February"), contactEmail: expect.any(String) } });
    const c = (await as(partner, (tx) => getClientRecord(tx, falcon)))!;
    expect(c.licenceNumber).toBe("CN-5001");
    expect(c.taxRegistrationNumber).toBe("100123456789003");
  });

  it("refuses a rename to another client's name, in any case or spacing, and allows the client's own", async () => {
    for (const name of ["Desert Logistics LLC", "desert  LOGISTICS llc", " Desert Logistics   LLC "]) {
      expect(await as(partner, (tx) => updateClient(tx, partner, falcon, { name, ...DETAILS })), name).toMatchObject({ ok: false, message: "Desert Logistics LLC is already a client." });
    }
    expect((await as(partner, (tx) => getClientRecord(tx, falcon)))!.name).toBe("Falcon Trading LLC");
    expect(await as(partner, (tx) => updateClient(tx, partner, falcon, { name: "FALCON TRADING LLC", ...DETAILS, contactName: "Alex Invented" }))).toMatchObject({ ok: true });
    expect(await as(partner, (tx) => updateClient(tx, partner, falcon, { name: "Falcon Trading LLC", ...DETAILS, contactName: "Alex Invented" }))).toMatchObject({ ok: true });
  });

  it("takes the same lock as Add client, so a rename and an add cannot both take a name", async () => {
    const results = await Promise.allSettled([
      as(partner, (tx) => updateClient(tx, partner, desert, { name: "Mirage Holdings LLC" })),
      as(partner, (tx) => repo.createClient(tx, partner, "Mirage Holdings LLC")),
    ]);
    const names = (await db.query<{ name: string }>("select name from clients where firm_id = $1 and lower(name) = 'mirage holdings llc'", [FIRM])).rows;
    expect(names).toHaveLength(1);
    expect(results.filter((r) => r.status === "fulfilled" && (r.value as { ok?: boolean }).ok !== false).length).toBeGreaterThanOrEqual(1);
    // put the name back for the tests that follow
    const id = (await db.query<{ id: string }>("select id from clients where firm_id = $1 and lower(name) = 'mirage holdings llc'", [FIRM])).rows[0].id;
    if (id === desert) await as(partner, (tx) => updateClient(tx, partner, desert, { name: "Desert Logistics LLC" }));
  });

  it("logs each edit with what changed, before and after, and nothing when nothing changed", async () => {
    const before = Number((await db.query<{ n: string }>("select count(*)::text n from audit_log where action = 'update' and entity = 'client' and entity_id = $1", [desert])).rows[0].n);
    await as(partner, (tx) => updateClient(tx, partner, desert, { name: "Desert Logistics LLC", licenceNumber: "DL-77", yearEnd: "12-31" }));
    const rows = (await db.query<{ detail: { changed: string[]; before: Record<string, unknown>; after: Record<string, unknown> }; user_id: string }>("select detail, user_id from audit_log where action = 'update' and entity = 'client' and entity_id = $1 order by id", [desert])).rows;
    expect(rows).toHaveLength(before + 1);
    const last = rows[rows.length - 1];
    expect(last.user_id).toBe(partner.userId);
    expect(last.detail.changed.sort()).toEqual(["licenceNumber", "yearEnd"]);
    expect(last.detail.before).toEqual({ licenceNumber: null, yearEnd: null });
    expect(last.detail.after).toEqual({ licenceNumber: "DL-77", yearEnd: "12-31" });
    const result = await as(partner, (tx) => updateClient(tx, partner, desert, { name: "Desert Logistics LLC", licenceNumber: "DL-77", yearEnd: "12-31" }));
    expect(result).toEqual({ ok: true, changed: [] });
    expect(Number((await db.query<{ n: string }>("select count(*)::text n from audit_log where action = 'update' and entity = 'client' and entity_id = $1", [desert])).rows[0].n)).toBe(before + 1);
  });

  it("is not visible to another firm, which cannot edit it either", async () => {
    expect(await as(outsider, (tx) => getClientRecord(tx, falcon))).toBeNull();
    expect(await as(outsider, (tx) => listClientRows(tx))).toEqual([]);
    await expect(as(outsider, (tx) => updateClient(tx, outsider, falcon, { name: "Hijacked LLC" }))).rejects.toThrow("Client not found.");
    expect((await as(partner, (tx) => getClientRecord(tx, falcon)))!.name).toBe("Falcon Trading LLC");
  });

  it("lists clients with licence, year-end and engagements, and searches by name or licence number", async () => {
    await as(partner, (tx) => repo.createEngagement(tx, partner, falcon, "2024-04-01", "2025-03-31"));
    await as(partner, (tx) => repo.createEngagement(tx, partner, falcon, "2025-04-01", "2026-03-31"));
    const all = await as(preparer, (tx) => listClientRows(tx));
    expect(all.find((c) => c.id === falcon)).toEqual({ id: falcon, name: "Falcon Trading LLC", licenceNumber: "CN-5001", yearEnd: "03-31", engagements: 2 });
    expect(all.find((c) => c.id === desert)).toMatchObject({ engagements: 0, licenceNumber: "DL-77" });
    expect((await as(preparer, (tx) => listClientRows(tx, "falcon"))).map((c) => c.name)).toEqual(["Falcon Trading LLC"]);
    expect((await as(preparer, (tx) => listClientRows(tx, "dl-77"))).map((c) => c.name)).toEqual(["Desert Logistics LLC"]);
    expect(await as(preparer, (tx) => listClientRows(tx, "%"))).toEqual([]);
    expect((await as(preparer, (tx) => listClientRows(tx, "_"))).length).toBe(0);
  });

  it("puts the address on the engagement letter when there is one, and not when there is not", async () => {
    const client = await as(partner, (tx) => repo.createClient(tx, partner, "Letter Address Co LLC"));
    ledgerEngagement = await as(partner, async (tx) => {
      const id = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
      await repo.importTrialBalance(tx, partner, id, "tb.xlsx", [
        { code: "1000", name: "Bank - current account", closingMinor: 10000, priorMinor: null },
        { code: "3000", name: "Share capital", closingMinor: -10000, priorMinor: null },
      ]);
      await repo.approveAllMappings(tx, partner, id);
      await audit.setAuditEnabled(tx, partner, id, true);
      return id;
    });
    const text = (blocks: Block[]) => blocks.flatMap((b) => (b.kind === "para" ? [b.text] : [])).join("\n");
    const none = (await as(partner, (tx) => generateLetter(tx, partner, ledgerEngagement, "engagement", { addressee: "The Directors" })))!;
    expect(text(none.blocks)).toContain("To: The Directors, Letter Address Co LLC");
    expect(text(none.blocks)).not.toContain("Invented Tower");
    await as(partner, (tx) => updateClient(tx, partner, client, { name: "Letter Address Co LLC", address: "Office 12\nInvented Tower\nDubai" }));
    const withAddress = (await as(partner, (tx) => generateLetter(tx, partner, ledgerEngagement, "engagement", { addressee: "The Directors" })))!;
    expect(text(withAddress.blocks)).toContain("To: The Directors, Letter Address Co LLC\nOffice 12\nInvented Tower\nDubai");
  });

  it("is added by the import with the extra columns, and an import without them is as it was", async () => {
    const grid = [
      ["Client name", "Licence number", "TRN", "Year end", "Address"],
      ["Import One LLC (sample)", "IM-1", "100123456789003", "31 March", "Office 3, Invented Road"],
      ["Import Two LLC (sample)", "", "123", "", ""],
    ];
    const preview = await as(partner, (tx) => previewClientImport(tx, partner, grid));
    expect(preview.entries).toHaveLength(2);
    const result = await as(partner, (tx) => importClients(tx, partner, preview.entries));
    expect(result.added).toBe(2);
    const one = (await db.query<{ id: string }>("select id from clients where name = 'Import One LLC (sample)' and firm_id = $1", [FIRM])).rows[0].id;
    const two = (await db.query<{ id: string }>("select id from clients where name = 'Import Two LLC (sample)' and firm_id = $1", [FIRM])).rows[0].id;
    expect(await as(partner, (tx) => getClientRecord(tx, one))).toMatchObject({ licenceNumber: "IM-1", taxRegistrationNumber: "100123456789003", yearEnd: "03-31", address: "Office 3, Invented Road" });
    expect(await as(partner, (tx) => getClientRecord(tx, two))).toMatchObject({ licenceNumber: null, taxRegistrationNumber: null, yearEnd: null, address: null });
    // Bare names, as before.
    expect((await as(partner, (tx) => importClients(tx, partner, ["Bare Name LLC (sample)"]))).added).toBe(1);
    // A detail that does not pass is dropped on the server too, never trusted from the browser.
    const hostile = await as(partner, (tx) => importClients(tx, partner, [{ name: "Hostile LLC (sample)", details: { taxRegistrationNumber: "1", yearEnd: "02-29", licenceNumber: "OK-1" } }]));
    expect(hostile.added).toBe(1);
    const id = (await db.query<{ id: string }>("select id from clients where name = 'Hostile LLC (sample)' and firm_id = $1", [FIRM])).rows[0].id;
    expect(await as(partner, (tx) => getClientRecord(tx, id))).toMatchObject({ licenceNumber: "OK-1", taxRegistrationNumber: null, yearEnd: null });
  });
});
