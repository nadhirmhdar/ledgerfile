import JSZip from "jszip";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import { currentOf, loadHistory, restoreNoteText, saveNoteText, useGeneratedWording } from "../src/server/note-texts";
import { loadFirmDefaults, saveFirmDefaults, setEngagementCurrency } from "../src/server/statement-defaults";
import { rollForward } from "../src/server/rollforward";
import { checkCurrency, checkDefaultText, firmDefaultLabel, NOT_PARTNER_DEFAULTS, textToParagraphs, unitMinorOf } from "../src/domain/statement-defaults";
import { policyKey } from "../src/domain/note-texts";
import { NotePassage, type PassageData } from "../src/app/note-passage";
import { StatementDefaultsSection } from "../src/ui/statement-defaults-section";

let db: Db;
let session: repo.Session;
/** An engagement created before any firm default existed. */
let preDefault = "";
vi.mock("../src/server/session", () => ({ getSession: async () => session, getOptionalSession: async () => session }));
vi.mock("../src/server/db", async (original) => {
  const real = await original<typeof import("../src/server/db")>();
  return { ...real, getDb: async () => db };
});

const A = "aaaaaaaa-8282-4000-8000-000000000001";
const B = "bbbbbbbb-8282-4000-8000-000000000001";
const user = (firm: string, n: number, role: repo.Session["role"]): repo.Session => ({ firmId: firm, userId: `${firm.slice(0, 8)}-8282-4000-8000-00000000009${n}`, role });
const partner = user(A, 1, "partner");
const admin = user(A, 2, "admin");
const reviewer = user(A, 3, "reviewer");
const preparer = user(A, 4, "preparer");
const partnerB = user(B, 1, "partner");
const TB = [
  { code: "1000", name: "Bank - current account", closingMinor: 15000012, priorMinor: 10000000 },
  { code: "3000", name: "Share capital", closingMinor: -5000000, priorMinor: -5000000 },
  { code: "4000", name: "Sales", closingMinor: -10000012, priorMinor: 0 },
];
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
const save = (s: repo.Session, input: Partial<Parameters<typeof saveFirmDefaults>[2]>) => as(s, (tx) => saveFirmDefaults(tx, s, { currency: "", unit: "", notes: {}, ...input }));
let n = 0;
const newEngagement = (s: repo.Session = partner, start = "2025-01-01", end = "2025-12-31") =>
  as(s, async (tx) => repo.createEngagement(tx, partner, await repo.createClient(tx, partner, `Defaults Trading ${++n} LLC`), start, end));
const row = async (id: string) => (await db.query<{ currency: string | null; statement_unit: string | null }>("select currency, statement_unit from engagements where id = $1", [id])).rows[0];
const notesOf = async (id: string) => as(partner, async (tx) => currentOf(await loadHistory(tx, id)));
const audits = async (action: string, firm = A) => (await db.query<{ detail: Record<string, unknown>; user_id: string; entity_id: string }>("select detail, user_id, entity_id from audit_log where firm_id = $1 and action = $2 order by id", [firm, action])).rows;
const KEY = { general: "general", basis: "basis", revenue: policyKey("Revenue") };

beforeAll(async () => {
  db = await openDatabase();
  for (const f of [A, B]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [f]);
  for (const u of [partner, admin, reviewer, preparer, partnerB]) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-1)}`, u.role]);
  session = partner;
});

afterAll(async () => {
  await db.close();
});

describe("the migration", () => {
  it("is append-only for the firm's wording and narrow for the firm row, and leaves existing notes as they were", async () => {
    // An engagement made before any default exists, with a person's note.
    const before = await newEngagement();
    preDefault = before;
    await as(partner, (tx) => saveNoteText(tx, partner, before, "general", ["A person wrote this."]));
    await save(partner, { notes: { general: "Default wording." } });
    const app = (sql: string, params: unknown[] = []) =>
      db.transaction(async (tx) => {
        await tx.exec("set local role app_user");
        await tx.query("select set_config('app.firm_id', $1, true)", [A]);
        return tx.query(sql, params);
      });
    await expect(app("update firm_note_defaults set paragraphs = '[]'::jsonb")).rejects.toThrow(/permission denied/);
    await expect(app("delete from firm_note_defaults")).rejects.toThrow(/permission denied/);
    await expect(app("update firms set name = 'x' where id = $1", [A])).rejects.toThrow(/permission denied/);
    await expect(app("update firms set statement_currency = 'AED' where id = $1", [A])).resolves.toBeDefined();
    await db.query("update firms set statement_currency = null where id = $1", [A]);
    expect((await db.query<{ source: string | null }>("select source from note_texts where engagement_id = $1", [before])).rows).toEqual([{ source: null }]);
    expect(await row(before)).toEqual({ currency: null, statement_unit: null });
    await expect(db.query("update firms set statement_currency = 'aed' where id = $1", [A])).rejects.toThrow();
    await expect(db.query("insert into note_texts (firm_id, engagement_id, note_key, version, paragraphs, written_by, source) values ($1, $2, 'general', 9, '[]', $3, 'robot')", [A, before, partner.userId])).rejects.toThrow();
  });
});

describe("the pure rules", () => {
  it("checks a currency as three letters and makes it upper case, with blank meaning not set", () => {
    expect(checkCurrency("aed")).toEqual({ ok: true, code: "AED" });
    expect(checkCurrency("  usd ")).toEqual({ ok: true, code: "USD" });
    expect(checkCurrency("")).toEqual({ ok: true, code: null });
    for (const bad of ["AE", "AEDX", "A1D", "ا ب ت", "12"]) expect(checkCurrency(bad).ok, bad).toBe(false);
    expect(unitMinorOf("whole")).toBe(100);
    expect(unitMinorOf(null)).toBe(1);
  });
  it("splits typed wording into paragraphs and keeps line breaks inside one", () => {
    expect(textToParagraphs("One.\nStill one.\n\nTwo.\r\n\r\n\r\nThree.")).toEqual(["One.\nStill one.", "Two.", "Three."]);
    expect(checkDefaultText("   ")).toEqual({ ok: true, paragraphs: null });
    expect(checkDefaultText(Array.from({ length: 21 }, (_, i) => `p${i}`).join("\n\n")).ok).toBe(false);
    expect(checkDefaultText("x".repeat(4001))).toMatchObject({ ok: false });
    expect(checkDefaultText("x".repeat(4000)).ok).toBe(true);
  });
});

describe("who may set the defaults, and what is refused", () => {
  it("lets a partner and an administrator, and refuses a reviewer and a preparer, reading the role from the database", async () => {
    expect((await save(partner, { currency: "aed" })).changed).toEqual(["Currency"]);
    expect((await save(admin, { currency: "AED", unit: "whole" })).changed).toEqual(["Rounding"]);
    for (const s of [reviewer, preparer]) await expect(save(s, { currency: "USD" }), s.role).rejects.toThrow(NOT_PARTNER_DEFAULTS);
    await expect(save({ ...preparer, role: "partner" }, { currency: "USD" })).rejects.toThrow(NOT_PARTNER_DEFAULTS);
    const d = await as(partner, (tx) => loadFirmDefaults(tx));
    expect(d).toMatchObject({ currency: "AED", unit: "whole" });
  });

  it("checks the currency, the rounding, the passage and the limits, and writes nothing when one value is bad", async () => {
    await expect(save(partner, { currency: "AEDX" })).rejects.toThrow("A currency code is three letters, such as AED. Leave it blank for none.");
    await expect(save(partner, { unit: "tonnes" })).rejects.toThrow("Choose exact or whole units.");
    await expect(save(partner, { notes: { nonsense: "x" } })).rejects.toThrow("That passage is not part of the notes.");
    await expect(save(partner, { notes: { "group:TRADEREC": "x" } })).rejects.toThrow("That passage is not part of the notes.");
    await expect(save(partner, { notes: { general: "fine", basis: "x".repeat(4001) } })).rejects.toThrow(/Basis of preparation: Paragraph 1 is 4,001 characters/);
    await expect(save(partner, { notes: { general: Array.from({ length: 21 }, (_, i) => `p${i}`).join("\n\n") } })).rejects.toThrow(/at most 20 paragraphs/);
    expect((await as(partner, (tx) => loadFirmDefaults(tx))).notes.size).toBe(1);
  });

  it("keeps a version for each change, writes nothing for the same wording, clears on blank, and logs before and after", async () => {
    const before = (await as(partner, (tx) => loadFirmDefaults(tx))).history.get(KEY.general)!.length;
    expect((await save(partner, { currency: "AED", unit: "whole", notes: { general: "Default wording." } })).changed).toEqual([]);
    expect((await save(partner, { currency: "AED", unit: "whole", notes: { general: "Second default wording.\n\nWith a second paragraph." } })).changed).toEqual(["General information"]);
    let d = await as(partner, (tx) => loadFirmDefaults(tx));
    expect(d.history.get(KEY.general)!.map((v) => v.version)).toEqual(Array.from({ length: before + 1 }, (_, i) => i + 1));
    expect(d.notes.get(KEY.general)!.paragraphs).toEqual(["Second default wording.", "With a second paragraph."]);
    expect((await save(partner, { currency: "AED", unit: "whole", notes: { general: "" } })).changed).toEqual(["General information"]);
    d = await as(partner, (tx) => loadFirmDefaults(tx));
    expect(d.notes.has(KEY.general)).toBe(false);
    expect(d.history.get(KEY.general)!.at(-1)!.paragraphs).toEqual([]);
    // Blank on a passage with no default writes nothing.
    expect((await save(partner, { currency: "AED", unit: "whole", notes: { basis: "" } })).changed).toEqual([]);
    const log = (await audits("statement_defaults_update")).map((l) => l.detail);
    expect(log.find((l) => l.currency)).toMatchObject({ changed: ["Currency"], currency: { before: null, after: "AED" } });
    const wording = log.find((l) => (l.changed as string[]).includes("General information") && (l.notes as Record<string, { before: string | null; after: string | null }>).general.after?.startsWith("Second"))!;
    expect(wording.notes).toMatchObject({ general: { before: "Default wording.", after: "Second default wording.\n\nWith a second paragraph." } });
    expect((await audits("statement_defaults_update")).every((l) => l.entity_id === A)).toBe(true);
  });
});

describe("applying the defaults to new engagements only", () => {
  it("snapshots the currency, the rounding and version-1 notes marked as the firm's, on a single creation", async () => {
    const oldOne = preDefault;
    await save(partner, { currency: "AED", unit: "whole", notes: { general: "Firm general wording.", [KEY.revenue]: "Firm revenue policy.\n\nSecond paragraph." } });
    const created = await newEngagement(partner, "2026-01-01", "2026-12-31");
    expect(await row(created)).toEqual({ currency: "AED", statement_unit: "whole" });
    const notes = await notesOf(created);
    expect([...notes.keys()].sort()).toEqual(["general", KEY.revenue].sort());
    expect(notes.get("general")).toMatchObject({ version: 1, paragraphs: ["Firm general wording."], source: "firm_default", generated: false });
    expect(notes.get(KEY.revenue)).toMatchObject({ version: 1, paragraphs: ["Firm revenue policy.", "Second paragraph."], source: "firm_default" });
    expect((await audits("apply_firm_defaults")).at(-1)).toMatchObject({ entity_id: created, detail: { currency: "AED", unit: "whole", notes: expect.arrayContaining(["general", KEY.revenue]) } });
    // An engagement made BEFORE the defaults is unchanged, and so is one after a later change.
    expect(await row(oldOne)).toEqual({ currency: null, statement_unit: null });
    expect((await notesOf(oldOne)).get("general")!.paragraphs).toEqual(["A person wrote this."]);
    expect((await notesOf(oldOne)).size).toBe(1);
    await save(partner, { currency: "USD", unit: "exact", notes: { general: "Changed later.", [KEY.revenue]: "" } });
    expect(await row(created)).toEqual({ currency: "AED", statement_unit: "whole" });
    expect((await notesOf(created)).get("general")!.paragraphs).toEqual(["Firm general wording."]);
    expect(await row(oldOne)).toEqual({ currency: null, statement_unit: null });
    await save(partner, { currency: "AED", unit: "whole", notes: { general: "Firm general wording.", [KEY.revenue]: "Firm revenue policy.\n\nSecond paragraph." } });
  });

  it("does the same for bulk roll-forward, with last year's person-edited notes carried alongside (owner decision 2026-11-25)", async () => {
    const f = "cccccccc-8282-4000-8000-000000000001";
    await db.query("insert into firms (id, name, statement_currency, statement_unit) values ($1, 'Roll Firm', 'QAR', 'exact')", [f]);
    const p = user(f, 1, "partner");
    await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, 'r@x.test', 'R Partner', 'partner')", [p.userId, f]);
    await db.query("insert into firm_note_defaults (firm_id, note_key, version, paragraphs, written_by) values ($1, 'basis', 1, $2::jsonb, $3)", [f, JSON.stringify(["Roll firm basis wording."]), p.userId]);
    const last = await as(p, async (tx) => repo.createEngagement(tx, p, await repo.createClient(tx, p, "Rolling Client LLC"), "2024-01-01", "2024-12-31"));
    const lastNotes = await as(p, async (tx) => (await saveNoteText(tx, p, last, "general", ["Last year's edited general note."]), currentOf(await loadHistory(tx, last))));
    expect(lastNotes.get("general")!.source ?? null).toBeNull();
    const clientId = (await db.query<{ client_id: string }>("select client_id from engagements where id = $1", [last])).rows[0].client_id;
    const [made] = await as(p, (tx) => rollForward(tx, p, [{ clientId, start: "2025-01-01", end: "2025-12-31" }], "2026-03-01"));
    expect((await db.query<{ currency: string; statement_unit: string }>("select currency, statement_unit from engagements where id = $1", [made.engagementId])).rows[0]).toEqual({ currency: "QAR", statement_unit: "exact" });
    const notes = await as(p, async (tx) => currentOf(await loadHistory(tx, made.engagementId)));
    expect([...notes.keys()].sort()).toEqual(["basis", "general"]);
    expect(notes.get("general")).toMatchObject({ version: 1, source: "carried_forward", paragraphs: ["Last year's edited general note."] });
    expect(notes.get("basis")).toMatchObject({ version: 1, source: "firm_default", paragraphs: ["Roll firm basis wording."] });
  });

  it("never applies another firm's defaults, in either direction", async () => {
    await db.query("update firms set statement_currency = 'SAR', statement_unit = 'whole' where id = $1", [B]);
    await db.query("insert into firm_note_defaults (firm_id, note_key, version, paragraphs, written_by) values ($1, 'general', 1, $2::jsonb, $3)", [B, JSON.stringify(["Firm B wording."]), partnerB.userId]);
    const a = await newEngagement();
    expect((await row(a)).currency).toBe("AED");
    expect((await notesOf(a)).get("general")!.paragraphs).toEqual(["Firm general wording."]);
    const b = await as(partnerB, async (tx) => repo.createEngagement(tx, partnerB, await repo.createClient(tx, partnerB, "B Client LLC"), "2025-01-01", "2025-12-31"));
    expect(await row(b)).toEqual({ currency: "SAR", statement_unit: "whole" });
    expect((await db.query<{ paragraphs: string[] }>("select paragraphs from note_texts where engagement_id = $1 and note_key = 'general'", [b])).rows[0].paragraphs).toEqual(["Firm B wording."]);
    expect((await as(partner, (tx) => loadFirmDefaults(tx))).currency).toBe("AED");
  });

  it("writes nothing onto an engagement when the firm has set nothing", async () => {
    const f = "dddddddd-8282-4000-8000-000000000001";
    await db.query("insert into firms (id, name) values ($1, 'Plain Firm')", [f]);
    const p = user(f, 1, "partner");
    await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, 'p@x.test', 'P', 'partner')", [p.userId, f]);
    const e = await as(p, async (tx) => repo.createEngagement(tx, p, await repo.createClient(tx, p, "Plain Client LLC"), "2025-01-01", "2025-12-31"));
    expect(await row(e)).toEqual({ currency: null, statement_unit: null });
    expect((await db.query("select 1 from note_texts where engagement_id = $1", [e])).rows).toHaveLength(0);
  });
});

describe("the engagement's own currency", () => {
  it("can be changed by a partner while the file is open, logged, and leaves the firm's defaults alone", async () => {
    const e = await newEngagement();
    const set = (s: repo.Session, v: string) => as(s, (tx) => setEngagementCurrency(tx, s, e, v));
    expect(await set(partner, "usd")).toEqual({ changed: true });
    expect((await row(e)).currency).toBe("USD");
    expect(await set(partner, "USD")).toEqual({ changed: false });
    await expect(set(preparer, "EUR")).rejects.toThrow(NOT_PARTNER_DEFAULTS);
    await expect(set(partner, "EURO")).rejects.toThrow(/three letters/);
    expect((await audits("set_engagement_currency")).at(-1)).toMatchObject({ entity_id: e, detail: { before: "AED", after: "USD" } });
    expect((await as(partner, (tx) => loadFirmDefaults(tx))).currency).toBe("AED");
    await db.query("update engagements set status = 'locked', locked_by = $2, locked_at = now() where id = $1", [e, partner.userId]);
    await expect(set(partner, "EUR")).rejects.toThrow("This engagement is locked.");
  });
});

describe("the statements and the exports", () => {
  async function wordText(id: string, query = ""): Promise<string> {
    const { GET } = await import("../src/app/(app)/engagements/[id]/statements/export/route");
    session = partner;
    const res = await GET(new Request(`http://x/e${query}`), { params: Promise.resolve({ id }) });
    return (await (await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()))).file("word/document.xml")!.async("string")).replace(/<[^>]+>/g, "|").replace(/&amp;/g, "&");
  }
  it("use the engagement's currency and default rounding, and the toggle still overrides it", async () => {
    await save(partner, { currency: "AED", unit: "whole", notes: {} });
    const e = await newEngagement();
    await as(partner, async (tx) => {
      await repo.importTrialBalance(tx, partner, e, "tb.xlsx", TB);
      await repo.approveAllMappings(tx, partner, e);
    });
    const byDefault = await wordText(e);
    expect(byDefault).toContain("presented in AED, rounded to the nearest whole unit");
    expect(byDefault).toContain("150,000");
    const exact = await wordText(e, "?units=exact");
    expect(exact).toContain("presented in AED");
    expect(exact).not.toContain("rounded to the nearest whole unit");
    expect(exact).toContain("150,000.12");
    expect(await wordText(e, "?units=whole")).toContain("rounded to the nearest whole unit");
    // An engagement with no currency keeps the placeholder, as before.
    const old = await db.query<{ id: string }>("select id from engagements where firm_id = $1 and currency is null limit 1", [A]);
    expect(old.rows.length).toBeGreaterThan(0);
    await as(partner, async (tx) => {
      await repo.importTrialBalance(tx, partner, old.rows[0].id, "tb.xlsx", TB);
      await repo.approveAllMappings(tx, partner, old.rows[0].id);
    });
    expect(await wordText(old.rows[0].id)).toContain("presented in [currency]");
  }, 120_000);

  it("carry the firm's default wording into the Word file", async () => {
    await save(partner, { currency: "AED", unit: "exact", notes: { basis: "Our own basis of preparation wording for new files." } });
    const e = await newEngagement();
    await as(partner, async (tx) => {
      await repo.importTrialBalance(tx, partner, e, "tb.xlsx", TB);
      await repo.approveAllMappings(tx, partner, e);
    });
    const xml = await wordText(e);
    expect(xml).toContain("Our own basis of preparation wording for new files.");
    expect(xml).not.toContain("These financial statements have been prepared in accordance with");
  }, 120_000);
});

describe("the label", () => {
  const passage = (e: string, key: string, history: Awaited<ReturnType<typeof loadHistory>>): PassageData => {
    const cur = currentOf(history).get(key);
    const overridden = !!cur && !cur.generated;
    return {
      engagementId: e,
      noteKey: key,
      name: key,
      paragraphs: overridden ? cur!.paragraphs : ["[Generated wording to complete.]"],
      generated: ["[Generated wording to complete.]"],
      overridden,
      current: overridden ? { version: cur!.version, by: cur!.by, at: cur!.at, fromDefault: cur!.source === "firm_default" } : null,
      history: history.get(key) ?? [],
      canEdit: true,
    };
  };
  it("shows the firm default label, then Edited by after a person's edit, then the draft label after going back", async () => {
    await save(partner, { currency: "AED", unit: "exact", notes: { general: "Firm default general wording." } });
    const e = await newEngagement();
    const h = () => as(partner, (tx) => loadHistory(tx, e));
    const fromDefault = renderToStaticMarkup(<NotePassage {...passage(e, "general", await h())} />);
    expect(fromDefault).toMatch(/Firm default wording, from \d{4}-\d{2}-\d{2}/);
    expect(fromDefault).not.toContain("Unreviewed draft wording");
    expect(fromDefault).not.toContain("Edited by");
    expect(firmDefaultLabel("2026-03-01")).toBe("Firm default wording, from 2026-03-01");
    // A passage with no default keeps the app's draft label.
    expect(renderToStaticMarkup(<NotePassage {...passage(e, "policies", await h())} />)).toContain("Unreviewed draft wording");

    await as(partner, (tx) => saveNoteText(tx, partner, e, "general", ["A person's own wording."]));
    const edited = renderToStaticMarkup(<NotePassage {...passage(e, "general", await h())} />);
    expect(edited).toContain("Edited by");
    expect(edited).not.toContain("Firm default wording");
    expect(edited).not.toContain("Unreviewed draft wording");

    await as(partner, (tx) => restoreNoteText(tx, partner, e, "general", 1));
    expect(renderToStaticMarkup(<NotePassage {...passage(e, "general", await h())} />)).toContain("Edited by");

    await as(partner, (tx) => useGeneratedWording(tx, partner, e, "general"));
    const back = renderToStaticMarkup(<NotePassage {...passage(e, "general", await h())} />);
    expect(back).toContain("Unreviewed draft wording");
    expect(back).not.toContain("Firm default wording");
  });
});

describe("the section on the Firm page", () => {
  it("is a form for a partner and read-only for anyone else, and says the defaults apply to new engagements only", async () => {
    const d = await as(partner, (tx) => loadFirmDefaults(tx));
    const edit = renderToStaticMarkup(<StatementDefaultsSection defaults={d} mayEdit />);
    expect(edit).toContain("Statement defaults");
    expect(edit).toContain("Used for new engagements only");
    expect(edit).toContain('name="currency"');
    expect(edit).toContain('name="note:general"');
    expect(edit).toContain(`name="note:${KEY.revenue}"`);
    expect(edit).toContain("Save the statement defaults");
    expect(edit).toContain("unreviewed draft");
    const read = renderToStaticMarkup(<StatementDefaultsSection defaults={d} mayEdit={false} />);
    expect(read).toContain("A partner changes the statement defaults.");
    expect(read).not.toContain('name="currency"');
  });
});
