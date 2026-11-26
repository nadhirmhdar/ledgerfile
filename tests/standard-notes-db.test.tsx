import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import { currentOf, loadHistory, loadNoteOverrides, restoreNoteText, saveNoteText, useGeneratedWording } from "../src/server/note-texts";
import { DEFAULT_KEYS, loadFirmDefaults, saveFirmDefaults } from "../src/server/statement-defaults";
import { buildStatementPack } from "../src/domain/statement-pack";
import { keptButNotShown } from "../src/domain/note-texts";
import { NotePassage, type PassageData } from "../src/app/note-passage";
import { StatementDefaultsSection } from "../src/ui/statement-defaults-section";
import { STANDARD_NOTE_WORDING } from "../src/domain/standard-notes";

// Invented firm and people.
const A = "aaaaaaaa-8484-4000-8000-000000000001";
const user = (n: number, role: repo.Session["role"]): repo.Session => ({ firmId: A, userId: `${A.slice(0, 8)}-8484-4000-8000-00000000007${n}`, role });
const partner = user(1, "partner");
const preparer = user(2, "preparer");
const NEW_KEYS = ["related", "tax", "commitments", "events", "going_concern"];
const TB = [
  { code: "1000", name: "Bank - current account", closingMinor: 15000000, priorMinor: 10000000 },
  { code: "3000", name: "Share capital", closingMinor: -5000000, priorMinor: -5000000 },
  { code: "4000", name: "Sales", closingMinor: -10000000, priorMinor: -5000000 },
];

let db: Db;
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
let n = 0;
const newEngagement = () =>
  as(partner, async (tx) => {
    const id = await repo.createEngagement(tx, partner, await repo.createClient(tx, partner, `Standard Notes ${++n} LLC`), "2025-01-01", "2025-12-31");
    await repo.importTrialBalance(tx, partner, id, "tb.xlsx", TB);
    await repo.approveAllMappings(tx, partner, id);
    return id;
  });
const packOf = async (id: string) => {
  const accounts = (await as(partner, (tx) => repo.listAccounts(tx, id))).map((a) => ({ ...a, closingMinor: a.closingMinor + a.adjustmentMinor }));
  return buildStatementPack(accounts, { noteTexts: await as(partner, (tx) => loadNoteOverrides(tx, id)) });
};

beforeAll(async () => {
  db = await openDatabase();
  await db.query("insert into firms (id, name) values ($1, 'Firm')", [A]);
  for (const u of [partner, preparer]) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, A, `${u.userId}@x.test`, `${u.role} user`, u.role]);
});
afterAll(async () => {
  await db.close();
});

describe("the migration", () => {
  it("is migration 0038, accepts the five new keys in both tables, keeps the old keys, and still refuses anything else", async () => {
    expect((await db.query("select 1 from schema_migrations where name = $1", ["0038_standard_note_keys.sql"])).rows).toHaveLength(1);
    const e = await newEngagement();
    const insertNote = (key: string) =>
      db.query("insert into note_texts (firm_id, engagement_id, note_key, version, paragraphs, written_by) values ($1, $2, $3, 1, '[\"x\"]', $4)", [A, e, key, partner.userId]);
    const insertDefault = (key: string) => db.query("insert into firm_note_defaults (firm_id, note_key, version, paragraphs, written_by) values ($1, $2, 1, '[\"x\"]', $3)", [A, key, partner.userId]);
    let version = 0;
    for (const key of [...NEW_KEYS, "general", "basis", "policies", "policy:revenue", "group:TRADEREC"]) {
      await expect(insertNote(key), `note_texts ${key}`).resolves.toBeDefined();
      version++;
      await db.query("delete from note_texts where engagement_id = $1 and note_key = $2", [e, key]);
    }
    expect(version).toBe(10);
    for (const key of [...NEW_KEYS, "general", "basis", "policies", "policy:revenue"]) {
      await expect(insertDefault(key), `firm_note_defaults ${key}`).resolves.toBeDefined();
      await db.query("delete from firm_note_defaults where firm_id = $1 and note_key = $2", [A, key]);
    }
    for (const bad of ["going-concern", "Related", "events:1", "group:", "nonsense", "related "]) {
      await expect(insertNote(bad), bad).rejects.toThrow();
      await expect(insertDefault(bad), bad).rejects.toThrow();
    }
    // A group narrative is still not a firm default.
    await expect(insertDefault("group:TRADEREC")).rejects.toThrow();
  });
});

describe("editing the new passages", () => {
  it("saves a person's text under each new key, restores an earlier version, and goes back to the generated wording", async () => {
    const e = await newEngagement();
    for (const key of NEW_KEYS) {
      const r = await as(partner, (tx) => saveNoteText(tx, partner, e, key, [`A person's wording for ${key}.`]));
      expect(r).toMatchObject({ written: true, version: 1 });
    }
    const pack = await packOf(e);
    for (const key of ["commitments", "events", "going_concern"]) {
      const note = pack.notes.find((x) => x.key === key)!;
      expect(note.overridden, key).toBe(true);
      expect(note.paragraphs).toEqual([`A person's wording for ${key}.`]);
    }
    await as(partner, (tx) => saveNoteText(tx, partner, e, "events", ["Second wording."]));
    await as(partner, (tx) => restoreNoteText(tx, partner, e, "events", 1));
    expect((await packOf(e)).notes.find((x) => x.key === "events")!.paragraphs).toEqual(["A person's wording for events."]);
    await as(partner, (tx) => useGeneratedWording(tx, partner, e, "events"));
    const back = (await packOf(e)).notes.find((x) => x.key === "events")!;
    expect(back.overridden).toBe(false);
    expect(back.paragraphs).toEqual(STANDARD_NOTE_WORDING.events);
    // Related parties and income tax have no balances here, so their saved text is kept but not shown.
    const shown = new Set((await packOf(e)).notes.flatMap((x) => (x.key ? [x.key] : [])));
    expect(keptButNotShown(await as(partner, (tx) => loadNoteOverrides(tx, e)), shown).sort()).toEqual(["related", "tax"]);
  });
});

describe("firm defaults", () => {
  it("lists the five among the passages a firm can set, copies them onto a new engagement as the firm's wording, and leaves an earlier engagement alone", async () => {
    for (const key of NEW_KEYS) expect(DEFAULT_KEYS).toContain(key);
    const before = await newEngagement();
    await as(partner, (tx) => saveFirmDefaults(tx, partner, { currency: "", unit: "", notes: { going_concern: "The firm's standard going concern wording.", events: "Firm wording for events after the period." } }));
    const e = await newEngagement();
    const current = await as(partner, async (tx) => currentOf(await loadHistory(tx, e)));
    expect(current.get("going_concern")).toMatchObject({ paragraphs: ["The firm's standard going concern wording."], source: "firm_default" });
    expect(current.get("events")).toMatchObject({ source: "firm_default" });
    expect((await packOf(e)).notes.find((x) => x.key === "going_concern")!.paragraphs).toEqual(["The firm's standard going concern wording."]);
    expect((await as(partner, async (tx) => currentOf(await loadHistory(tx, before)))).has("going_concern")).toBe(false);

    // The label: the firm's default, then the draft label after going back.
    const passage = async (key: string): Promise<PassageData> => {
      const history = await as(partner, (tx) => loadHistory(tx, e));
      const cur = currentOf(history).get(key);
      const overridden = !!cur && !cur.generated;
      return {
        engagementId: e,
        noteKey: key,
        name: key,
        paragraphs: overridden ? cur!.paragraphs : STANDARD_NOTE_WORDING[key],
        generated: STANDARD_NOTE_WORDING[key],
        overridden,
        current: overridden ? { version: cur!.version, by: cur!.by, at: cur!.at, fromDefault: cur!.source === "firm_default" } : null,
        history: history.get(key) ?? [],
        canEdit: true,
      };
    };
    expect(renderToStaticMarkup(<NotePassage {...await passage("going_concern")} />)).toMatch(/Firm default wording, from \d{4}-\d{2}-\d{2}/);
    // A passage with no default is the app's draft wording, labelled as such.
    expect(renderToStaticMarkup(<NotePassage {...await passage("commitments")} />)).toContain("Unreviewed draft wording");
    await as(partner, (tx) => saveNoteText(tx, partner, e, "going_concern", ["A person's own going concern wording."]));
    expect(renderToStaticMarkup(<NotePassage {...await passage("going_concern")} />)).toContain("Edited by");
    await as(partner, (tx) => useGeneratedWording(tx, partner, e, "going_concern"));
    expect(renderToStaticMarkup(<NotePassage {...await passage("going_concern")} />)).toContain("Unreviewed draft wording");
  });

  it("shows the five on the Firm page for a partner", async () => {
    const d = await as(partner, (tx) => loadFirmDefaults(tx));
    const html = renderToStaticMarkup(<StatementDefaultsSection defaults={d} mayEdit />);
    for (const key of NEW_KEYS) expect(html, key).toContain(`name="note:${key}"`);
    expect(html).toContain("Other standard notes (5)");
    expect(html).toContain("Going concern");
  });
});
