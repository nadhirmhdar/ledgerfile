import JSZip from "jszip";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import { currentOf, loadHistory, loadNoteOverrides, restoreNoteText, saveNoteText, useGeneratedWording, LOCKED, NOT_ALLOWED, UNKNOWN_PASSAGE } from "../src/server/note-texts";
import { buildStatementPack, type PackAccount } from "../src/domain/statement-pack";
import { statementsDocument } from "../src/domain/statements-document";
import { describeKey, keptButNotShown, MAX_PARAGRAPH_LENGTH, MAX_PARAGRAPHS, policyKey, overridesFrom } from "../src/domain/note-texts";
import { placeholderCount } from "../src/ui/statements-view";
import { NotePassage, type PassageData } from "../src/app/note-passage";
import { pdfText } from "./pdf-text";

let db: Db;
let session: repo.Session;
vi.mock("../src/server/session", () => ({ getSession: async () => session, getOptionalSession: async () => session }));
vi.mock("../src/server/db", async (original) => {
  const real = await original<typeof import("../src/server/db")>();
  return { ...real, getDb: async () => db };
});

const A = "aaaaaaaa-5151-4000-8000-000000000001";
const B = "bbbbbbbb-5151-4000-8000-000000000001";
const user = (firm: string, n: number, role: repo.Session["role"]): repo.Session => ({ firmId: firm, userId: `${firm.slice(0, 8)}-5151-4000-8000-00000000007${n}`, role });
const prep = user(A, 1, "preparer");
const rev = user(A, 2, "reviewer");
const partner = user(A, 3, "partner");
const admin = user(A, 4, "admin");
const gone = user(A, 5, "preparer");
const outsider = user(B, 1, "partner");
const TB = [
  { code: "1000", name: "Bank - current account", closingMinor: 15000000, priorMinor: 10000000 },
  { code: "1100", name: "Trade receivables", closingMinor: 2000000, priorMinor: 1500000 },
  { code: "1110", name: "Prepayments", closingMinor: 500000, priorMinor: 400000 },
  { code: "3000", name: "Share capital", closingMinor: -5000000, priorMinor: -5000000 },
  { code: "4000", name: "Sales", closingMinor: -12000000, priorMinor: -8000000 },
  { code: "6000", name: "General and administrative expenses", closingMinor: 7000000, priorMinor: 5000000 },
  { code: "6100", name: "Office rent", closingMinor: 500000, priorMinor: 600000 },
];
const KEY = { general: "general", basis: "basis", policies: "policies", revenue: policyKey("Revenue"), inventories: policyKey("Inventories"), group: "group:TRADEREC" };

type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
let n = 0;
async function newEngagement(by: repo.Session = partner): Promise<string> {
  return as(by, async (tx) => {
    const c = await repo.createClient(tx, partner, `Notes Trading ${++n} LLC`);
    const id = await repo.createEngagement(tx, partner, c, "2025-01-01", "2025-12-31");
    await repo.importTrialBalance(tx, partner, id, "tb.xlsx", TB);
    await repo.approveAllMappings(tx, partner, id);
    return id;
  });
}
const save = (s: repo.Session, id: string, key: string, paragraphs: unknown) => as(s, (tx) => saveNoteText(tx, s, id, key, paragraphs));
const current = async (id: string) => as(partner, async (tx) => currentOf(await loadHistory(tx, id)));
const packFor = async (id: string, noteTexts?: Record<string, string[]>) => {
  const accounts = (await as(partner, (tx) => repo.listAccounts(tx, id))).map((a) => ({ ...a, closingMinor: a.closingMinor + a.adjustmentMinor }));
  return buildStatementPack(accounts, { noteTexts: noteTexts ?? (await as(partner, (tx) => loadNoteOverrides(tx, id))) });
};
const audits = async (id: string) => (await db.query<{ action: string; detail: Record<string, unknown>; user_id: string }>("select action, detail, user_id from audit_log where entity_id = $1 and action like 'note_text_%' order by id", [id])).rows;

beforeAll(async () => {
  db = await openDatabase();
  for (const f of [A, B]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [f]);
  for (const u of [prep, rev, partner, admin, gone, outsider]) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-1)}`, u.role]);
  await db.query("update users set active = false where id = $1", [gone.userId]);
  session = partner;
});

afterAll(async () => {
  await db.close();
});

describe("the table", () => {
  it("is append-only for the application role", async () => {
    const id = await newEngagement();
    await save(partner, id, KEY.general, ["Al Noor Trading LLC is registered in Dubai."]);
    const as_app = (sql: string, params: unknown[] = []) =>
      db.transaction(async (tx) => {
        await tx.exec("set local role app_user");
        await tx.query("select set_config('app.firm_id', $1, true)", [A]);
        return tx.query(sql, params);
      });
    await expect(as_app("update note_texts set paragraphs = '[]'::jsonb where engagement_id = $1", [id])).rejects.toThrow(/permission denied/);
    await expect(as_app("delete from note_texts where engagement_id = $1", [id])).rejects.toThrow(/permission denied/);
    // Another firm's rows are not even seen.
    const other = await db.transaction(async (tx) => {
      await tx.exec("set local role app_user");
      await tx.query("select set_config('app.firm_id', $1, true)", [B]);
      return tx.query("select 1 from note_texts where engagement_id = $1", [id]);
    });
    expect(other.rows).toHaveLength(0);
  });
});

describe("saving, restoring and going back", () => {
  it("writes versions 1, 2, nothing for identical text, 3 for a restore, and a generated marker", async () => {
    const id = await newEngagement();
    expect(await save(partner, id, KEY.general, ["First wording."])).toMatchObject({ written: true, version: 1, message: "Saved as version 1." });
    expect(await save(partner, id, KEY.general, ["Second wording.", "A second paragraph\nwith a line break."])).toMatchObject({ written: true, version: 2 });
    expect(await save(partner, id, KEY.general, ["Second wording.", "A second paragraph\nwith a line break."])).toEqual({ written: false, version: 2, message: "No change: this is the wording already saved." });
    expect(await as(partner, (tx) => restoreNoteText(tx, partner, id, KEY.general, 1))).toMatchObject({ written: true, version: 3, message: "Restored as version 3." });
    const h = (await as(partner, (tx) => loadHistory(tx, id))).get(KEY.general)!;
    expect(h.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(h[2].paragraphs).toEqual(h[0].paragraphs);
    expect(h[1].paragraphs[1]).toBe("A second paragraph\nwith a line break.");
    // Restoring what is already current writes nothing.
    expect((await as(partner, (tx) => restoreNoteText(tx, partner, id, KEY.general, 3))).written).toBe(false);
    expect(await as(partner, (tx) => useGeneratedWording(tx, partner, id, KEY.general))).toMatchObject({ written: true, version: 4, message: "Back to the generated wording." });
    expect((await current(id)).get(KEY.general)).toMatchObject({ version: 4, generated: true, paragraphs: [] });
    expect(await loadNoteOverrides2(id)).toEqual({});
    expect((await as(partner, (tx) => useGeneratedWording(tx, partner, id, KEY.general))).written).toBe(false);
    // Restoring a person's version after going back brings their text back, as version 5.
    expect(await as(partner, (tx) => restoreNoteText(tx, partner, id, KEY.general, 3))).toMatchObject({ written: true, version: 5 });
    expect(await loadNoteOverrides2(id)).toEqual({ general: ["First wording."] });
    // Going back on a passage nobody edited writes nothing.
    expect((await as(partner, (tx) => useGeneratedWording(tx, partner, id, KEY.basis))).written).toBe(false);
    await expect(as(partner, (tx) => restoreNoteText(tx, partner, id, KEY.general, 99))).rejects.toThrow("That version does not exist.");
  });
});
const loadNoteOverrides2 = (id: string) => as(partner, (tx) => loadNoteOverrides(tx, id));

describe("the statement pack", () => {
  it("uses the override for each kind of passage and keeps the figures and the numbers generated", async () => {
    const id = await newEngagement();
    const before = await packFor(id, {});
    const texts = {
      [KEY.general]: ["Al Noor Trading LLC is a limited liability company registered in Dubai."],
      [KEY.basis]: ["Basis: our own wording."],
      [KEY.policies]: ["Intro: our own introduction."],
      [KEY.revenue]: ["Revenue: recognised on delivery.", "Second paragraph on revenue."],
      [KEY.group]: ["Receivables narrative."],
    };
    const after = await packFor(id, texts);
    expect(after.notes[0].paragraphs).toEqual(texts.general);
    expect(after.notes[1].paragraphs).toEqual(texts.basis);
    expect(after.notes[2].paragraphs).toEqual(texts.policies);
    const revenue = after.notes[2].subsections!.find((s) => s.title === "Revenue")!;
    expect(revenue).toMatchObject({ key: KEY.revenue, overridden: true, paragraphs: texts[KEY.revenue], text: "Revenue: recognised on delivery.\n\nSecond paragraph on revenue." });
    expect(revenue.generated[0]).toContain("Revenue is measured at the consideration");
    expect(after.notes.find((x) => x.groupCode === "TRADEREC")).toMatchObject({ key: KEY.group, overridden: true, paragraphs: texts[KEY.group] });
    // Nothing else about the pack moved: figures, tables, totals, checks and the note numbers.
    // The placeholder warning counts the words, which a person's text changes, so it is left out of this comparison.
    const strip = (p: typeof before) => ({ ...p, checks: p.checks.filter((c) => c.label !== "No placeholders left in the notes"), notes: p.notes.map(({ number, title, table, groupCode }) => ({ number, title, table, groupCode })) });
    expect(strip(after)).toEqual(strip(before));
    expect(after.notes.map((x) => x.number)).toEqual(before.notes.map((x) => x.number));
    // A passage without an entry keeps the generated words, and says so.
    expect(after.notes[2].subsections!.find((s) => s.title === "Cash and cash equivalents")).toMatchObject({ overridden: false });
    expect(before.notes[0].overridden).toBe(false);
  });

  it("hides a policy that no longer applies but keeps its text, and lists it as kept", async () => {
    const id = await newEngagement();
    await save(partner, id, KEY.inventories, ["Inventories are counted at year end."]);
    await save(partner, id, KEY.revenue, ["Revenue wording."]);
    const pack = await packFor(id);
    // This engagement has no inventories, so the policy is not shown; the text is still stored.
    expect(pack.notes[2].subsections!.map((s) => s.key)).not.toContain(KEY.inventories);
    const shown = new Set(pack.notes.flatMap((x) => [...(x.key ? [x.key] : []), ...(x.subsections ?? []).map((s) => s.key)]));
    const overrides = await loadNoteOverrides2(id);
    expect(overrides[KEY.inventories]).toEqual(["Inventories are counted at year end."]);
    expect(keptButNotShown(overrides, shown)).toEqual([KEY.inventories]);
    expect(describeKey(KEY.inventories)).toBe("Policy: Inventories");
    expect(describeKey("group:TRADEREC")).toBe("Narrative above the table: Trade and other receivables");
  });

  it("counts the placeholders left, and the count falls as they are completed", async () => {
    const id = await newEngagement();
    const count = (p: Awaited<ReturnType<typeof packFor>>) => placeholderCount(p.notes.flatMap((x) => [...x.paragraphs, ...(x.subsections ?? []).flatMap((s) => s.paragraphs)]));
    const generated = count(await packFor(id));
    expect(generated).toBeGreaterThan(3);
    await save(partner, id, KEY.general, ["Complete: nothing in brackets."]);
    expect(count(await packFor(id))).toBe(generated - 1);
    await save(partner, id, KEY.basis, ["Basis with [one placeholder] and [another]."]);
    expect(count(await packFor(id))).toBe(generated - 2 + 2 - 1);
  });
});

describe("who may edit, and what is refused", () => {
  it("lets a preparer, a reviewer, a partner and an administrator", async () => {
    const id = await newEngagement();
    for (const [i, s] of [prep, rev, partner, admin].entries()) expect((await save(s, id, KEY.general, [`Wording ${i}.`])).written, s.role).toBe(true);
    expect((await current(id)).get(KEY.general)?.version).toBe(4);
  });
  it("refuses a deactivated user, a locked engagement, an archived one and another firm's", async () => {
    const id = await newEngagement();
    await expect(save(gone, id, KEY.general, ["x."])).rejects.toThrow(NOT_ALLOWED);
    await expect(save(outsider, id, KEY.general, ["x."])).rejects.toThrow("Engagement not found.");
    await db.query("update engagements set status = 'locked', locked_by = $2, locked_at = now() where id = $1", [id, partner.userId]);
    await expect(save(partner, id, KEY.general, ["x."])).rejects.toThrow(LOCKED);
    await expect(as(partner, (tx) => useGeneratedWording(tx, partner, id, KEY.general))).rejects.toThrow(LOCKED);
    await expect(as(partner, (tx) => restoreNoteText(tx, partner, id, KEY.general, 1))).rejects.toThrow(LOCKED);
    await db.query("update engagements set archived_at = now(), archived_by = $2 where id = $1", [id, partner.userId]);
    await expect(save(partner, id, KEY.general, ["x."])).rejects.toThrow(LOCKED);
    expect((await current(id)).size).toBe(0);
  });
  it("refuses a passage that does not exist", async () => {
    const id = await newEngagement();
    for (const key of ["nonsense", "policy:not-a-policy", "group:NOPE", "general; drop table note_texts"]) await expect(save(partner, id, key, ["x."])).rejects.toThrow(UNKNOWN_PASSAGE);
  });
  it("refuses text outside the limits, in readable words, and writes nothing", async () => {
    const id = await newEngagement();
    await expect(save(partner, id, KEY.general, [])).rejects.toThrow("Write at least one paragraph, or go back to the generated wording.");
    await expect(save(partner, id, KEY.general, ["fine", "  "])).rejects.toThrow("Paragraph 2 is empty. Write in it or remove it.");
    await expect(save(partner, id, KEY.general, Array.from({ length: MAX_PARAGRAPHS + 1 }, () => "x"))).rejects.toThrow(`at most ${MAX_PARAGRAPHS} paragraphs. This one has ${MAX_PARAGRAPHS + 1}.`);
    await expect(save(partner, id, KEY.general, ["x".repeat(MAX_PARAGRAPH_LENGTH + 1)])).rejects.toThrow(/Paragraph 1 is 4,001 characters; the most is 4,000\. Split it into two\./);
    await expect(save(partner, id, KEY.general, "not an array")).rejects.toThrow("The text was not understood.");
    expect((await save(partner, id, KEY.general, ["x".repeat(MAX_PARAGRAPH_LENGTH)])).written).toBe(true);
    expect((await save(partner, id, KEY.basis, Array.from({ length: MAX_PARAGRAPHS }, (_, i) => `p${i}`))).written).toBe(true);
    expect((await current(id)).size).toBe(2);
  });
});

describe("the audit log", () => {
  it("records every save, restore and go-back with the passage, the version and the text before and after", async () => {
    const id = await newEngagement();
    await save(partner, id, KEY.general, ["First."]);
    await save(prep, id, KEY.general, ["Second."]);
    await as(rev, (tx) => restoreNoteText(tx, rev, id, KEY.general, 1));
    await as(partner, (tx) => useGeneratedWording(tx, partner, id, KEY.general));
    await save(partner, id, KEY.general, ["Second."]).then(() => save(partner, id, KEY.general, ["Second."]));
    const log = await audits(id);
    expect(log.map((l) => l.action)).toEqual(["note_text_save", "note_text_save", "note_text_restore", "note_text_generated", "note_text_save"]);
    expect(log[0]).toMatchObject({ user_id: partner.userId, detail: { noteKey: "general", passage: "General information", version: 1, before: null, after: "First." } });
    expect(log[1].detail).toMatchObject({ version: 2, before: "First.", after: "Second." });
    expect(log[2]).toMatchObject({ user_id: rev.userId, detail: { version: 3, restoredVersion: 1, before: "Second.", after: "First." } });
    expect(log[3].detail).toMatchObject({ version: 4, before: "First.", after: null, generatedWording: true });
    // A long text is cut in the log, and a no-op writes no entry.
    await save(partner, id, KEY.basis, ["y".repeat(3000)]);
    expect(String((await audits(id)).at(-1)!.detail.after).length).toBeLessThan(700);
    expect(await audits(id)).toHaveLength(6);
  });
});

describe("the Word file and the PDF", () => {
  const EDITED = ["Our own general information, written by the firm.", "Registered in Dubai; licence 12345."];
  it("carry the edited text and not the generated text for that passage, and agree with each other", async () => {
    const id = await newEngagement();
    await save(partner, id, KEY.general, EDITED);
    await save(partner, id, KEY.revenue, ["Revenue is recognised when the goods are delivered."]);
    const { GET: word } = await import("../src/app/(app)/engagements/[id]/statements/export/route");
    const { GET: pdfRoute } = await import("../src/app/(app)/engagements/[id]/statements/pdf/route");
    session = partner;
    const ctx = { params: Promise.resolve({ id }) };
    const wordRes = await word(new Request("http://x/e"), ctx);
    const xml = (await (await JSZip.loadAsync(Buffer.from(await wordRes.arrayBuffer()))).file("word/document.xml")!.async("string")).replace(/<[^>]+>/g, "|").replace(/&amp;/g, "&");
    const pdf = pdfText(Buffer.from(await (await pdfRoute(new Request("http://x/p"), ctx)).arrayBuffer())).replace(/\s+/g, " ");
    for (const [name, text] of [["Word", xml], ["PDF", pdf]] as const) {
      expect(text, name).toContain("Our own general information, written by the firm.");
      expect(text, name).toContain("Registered in Dubai; licence 12345.");
      expect(text, name).toContain("Revenue is recognised when the goods are delivered.");
      expect(text, name).not.toContain("[Legal form, country of incorporation");
      expect(text, name).not.toContain("Revenue is measured at the consideration received or receivable");
      // A passage nobody edited still reads as generated.
      expect(text, name).toContain("Cash and cash equivalents comprise cash in hand");
    }
    // The page's own pack and the document builder agree on the same map.
    const doc = statementsDocument({ clientName: "x", periodStart: "2025-01-01", periodEnd: "2025-12-31", pack: await packFor(id), draft: true });
    expect(JSON.stringify(doc)).toContain("Our own general information");
  });
});

describe("the passage on the page", () => {
  const data = (over: Partial<PassageData> = {}): PassageData => ({
    engagementId: "e",
    noteKey: "general",
    name: "note 1",
    paragraphs: ["[Legal form of the entity.]"],
    generated: ["[Legal form of the entity.]"],
    overridden: false,
    current: null,
    history: [],
    canEdit: true,
    ...over,
  });
  it("shows the unreviewed draft label on generated words, and who edited it instead once edited", () => {
    const draft = renderToStaticMarkup(<NotePassage {...data()} />);
    expect(draft).toContain("Unreviewed draft wording");
    expect(draft).toContain("<mark");
    expect(draft).toContain("Edit");
    const edited = renderToStaticMarkup(
      <NotePassage {...data({ overridden: true, paragraphs: ["Our wording."], current: { version: 2, by: "Pia Preparer", at: "2026-03-01 10:00" }, history: [{ version: 1, paragraphs: ["a"], generated: false, by: "Pia Preparer", at: "2026-02-28 09:00" }, { version: 2, paragraphs: ["Our wording."], generated: false, by: "Pia Preparer", at: "2026-03-01 10:00" }] })} />,
    );
    expect(edited).not.toContain("Unreviewed draft wording");
    expect(edited).toContain("Edited by Pia Preparer on 2026-03-01 10:00");
    expect(edited).toContain("History (2)");
    expect(edited).toContain("Go back to the generated wording");
  });
  it("offers no Edit button to someone who cannot edit (a locked file)", () => {
    const html = renderToStaticMarkup(<NotePassage {...data({ canEdit: false })} />);
    expect(html).toContain("Unreviewed draft wording");
    expect(html).not.toContain(">Edit<");
    expect(html).not.toContain("Go back");
  });
  it("keeps the narrative of a group note empty until someone adds one", () => {
    const html = renderToStaticMarkup(<NotePassage {...data({ noteKey: "group:TRADEREC", paragraphs: [], generated: [] })} />);
    expect(html).toContain("No narrative yet");
    expect(html).toContain("Add narrative");
    expect(html).not.toContain("Unreviewed draft wording");
  });
});

describe("the pure helpers", () => {
  const BOOKS: PackAccount[] = [{ code: "1", name: "Bank", groupCode: "CASH", closingMinor: 100, priorMinor: 100, approved: true }];
  it("builds overrides only from a person's current versions", () => {
    expect(overridesFrom(new Map([["general", { version: 2, paragraphs: ["a"], generated: false, by: "x", at: "t" }], ["basis", { version: 3, paragraphs: [], generated: true, by: "x", at: "t" }]]))).toEqual({ general: ["a"] });
    expect(buildStatementPack(BOOKS, { noteTexts: {} }).notes[0].overridden).toBe(false);
  });
});
