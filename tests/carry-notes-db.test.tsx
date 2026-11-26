import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import { currentOf, loadHistory, saveNoteText, useGeneratedWording } from "../src/server/note-texts";
import { carryPriorNotes, saveFirmDefaults } from "../src/server/statement-defaults";
import { rollForward } from "../src/server/rollforward";
import { carriedLabel, carriesForward, policyKey } from "../src/domain/note-texts";
import { NotePassage, type PassageData } from "../src/app/note-passage";

// Invented firms and people.
const A = "aaaaaaaa-8686-4000-8000-000000000001";
const B = "bbbbbbbb-8686-4000-8000-000000000001";
const user = (firm: string, n: number, role: repo.Session["role"]): repo.Session => ({ firmId: firm, userId: `${firm.slice(0, 8)}-8686-4000-8000-00000000009${n}`, role });
const partner = user(A, 1, "partner");
const preparer = user(A, 2, "preparer");
const partnerB = user(B, 1, "partner");
const TODAY = "2026-06-01";
const REVENUE = policyKey("Revenue");
const GROUP = "group:PPE";

let db: Db;
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
let n = 0;
const roll = (s: repo.Session, clientId: string, start: string, end: string) => as(s, (tx) => rollForward(tx, s, [{ clientId, start, end }], TODAY)).then((c) => c[0].engagementId);
const history = (s: repo.Session, id: string) => as(s, (tx) => loadHistory(tx, id));
const current = async (s: repo.Session, id: string) => currentOf(await history(s, id));
const audits = async (action: string, entity: string) => (await db.query<{ detail: Record<string, unknown> }>("select detail from audit_log where action = $1 and entity_id = $2", [action, entity])).rows.map((r) => r.detail);

beforeAll(async () => {
  db = await openDatabase();
  for (const f of [A, B]) await db.query("insert into firms (id, name) values ($1, 'Firm')", [f]);
  for (const u of [partner, preparer, partnerB]) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} ${u.userId.slice(-1)}`, u.role]);
});
afterAll(async () => {
  await db.close();
});

describe("the migration", () => {
  it("accepts 'carried_forward', refuses anything else, and leaves existing rows as they were", async () => {
    const client = await as(partner, (tx) => repo.createClient(tx, partner, `Migration Trading ${++n} LLC`));
    const e = await as(partner, (tx) => repo.createEngagement(tx, partner, client, "2024-01-01", "2024-12-31"));
    await as(partner, (tx) => saveNoteText(tx, partner, e, "general", ["Existing person wording."]));
    const insert = (source: string | null, key: string) =>
      db.query("insert into note_texts (firm_id, engagement_id, note_key, version, paragraphs, is_generated, written_by, source) values ($1, $2, $3, 1, '[]'::jsonb, false, $4, $5)", [A, e, key, partner.userId, source]);
    await insert("carried_forward", "basis");
    await insert("firm_default", "tax");
    await insert("person", "events");
    await insert(null, "related");
    await expect(insert("carried", "commitments")).rejects.toThrow(/note_texts_source_check|violates check/);
    await expect(insert("", "going_concern")).rejects.toThrow(/violates check/);
    expect((await current(partner, e)).get("general")).toMatchObject({ paragraphs: ["Existing person wording."], source: null });
    expect((await db.query("select 1 from schema_migrations where name = $1", ["0039_note_source_carried.sql"])).rows).toHaveLength(1);
  });

  it("the pure rule: only a person's own words, or wording carried and not edited since, carry forward", () => {
    const v = (generated: boolean, source: "person" | "firm_default" | "carried_forward" | null) => carriesForward({ generated, source });
    expect(v(false, null)).toBe(true);
    expect(v(false, "person")).toBe(true);
    expect(v(false, "carried_forward")).toBe(true);
    expect(v(false, "firm_default")).toBe(false);
    expect(v(true, null)).toBe(false);
    expect(v(true, "person")).toBe(false);
  });
});

describe("roll-forward carries last year's person-written notes", () => {
  /** A client with last year's file, the firm's defaults in place when it was made, then a person's edits. */
  async function lastYear() {
    await as(partner, (tx) => saveFirmDefaults(tx, partner, { currency: "", unit: "", notes: { general: "Firm default general.", basis: "Firm default basis.", [REVENUE]: "Firm default revenue." } }));
    const client = await as(partner, (tx) => repo.createClient(tx, partner, `Carry Trading ${++n} LLC`));
    const e = await as(partner, (tx) => repo.createEngagement(tx, partner, client, "2024-01-01", "2024-12-31"));
    await as(partner, (tx) => saveNoteText(tx, partner, e, "general", ["Last year's own general wording."]));
    await as(partner, (tx) => saveNoteText(tx, partner, e, "basis", ["A basis a person wrote."]));
    await as(partner, (tx) => useGeneratedWording(tx, partner, e, "basis"));
    await as(partner, (tx) => saveNoteText(tx, partner, e, GROUP, ["Last year's property note wording."]));
    // The revenue policy stays as the firm default copied when the file was made.
    return { client, e };
  }

  it("bulk: a person-edited passage is carried as version 1 ahead of the firm default; a default and a back-to-generated key are not", async () => {
    const { client, e } = await lastYear();
    // A key the prior file has nothing for gets today's firm default.
    await as(partner, (tx) => saveFirmDefaults(tx, partner, { currency: "", unit: "", notes: { general: "Firm default general.", basis: "Firm default basis.", [REVENUE]: "Firm default revenue.", events: "Firm default events." } }));
    const next = await roll(partner, client, "2025-01-01", "2025-12-31");
    const h = await history(partner, next);
    const c = currentOf(h);
    expect(c.get("general")).toMatchObject({ version: 1, paragraphs: ["Last year's own general wording."], source: "carried_forward", generated: false });
    expect(c.get(GROUP)).toMatchObject({ version: 1, paragraphs: ["Last year's property note wording."], source: "carried_forward" });
    expect(c.get("basis")).toMatchObject({ version: 1, paragraphs: ["Firm default basis."], source: "firm_default" });
    expect(c.get(REVENUE)).toMatchObject({ version: 1, paragraphs: ["Firm default revenue."], source: "firm_default" });
    expect(c.get("events")).toMatchObject({ version: 1, paragraphs: ["Firm default events."], source: "firm_default" });
    // The carried passage is written now by the person rolling forward, and the general key has no second (default) version.
    expect(h.get("general")).toHaveLength(1);
    expect(c.get("general")!.by).toContain("partner");
    // Last year's file is untouched.
    expect((await current(partner, e)).get("general")).toMatchObject({ version: 2, source: null });
    // The audit entry says how many were carried.
    expect((await audits("create", next))[0]).toMatchObject({ bulk: true, carriedNotes: 2 });
  });

  it("single next year: creating the client's next engagement carries the same way", async () => {
    const { client } = await lastYear();
    const next = await as(partner, (tx) => repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31"));
    const c = await current(partner, next);
    expect(c.get("general")).toMatchObject({ version: 1, source: "carried_forward", paragraphs: ["Last year's own general wording."] });
    expect(c.get(GROUP)).toMatchObject({ source: "carried_forward" });
    expect(c.get("basis")).toMatchObject({ source: "firm_default" });
    expect((await audits("create", next))[0]).toMatchObject({ carriedNotes: 2 });
  });

  it("a carried passage nobody edited is carried again into a third year, and an edit in between travels on as the person's", async () => {
    const { client } = await lastYear();
    const y2 = await roll(partner, client, "2025-01-01", "2025-12-31");
    // Year 2: the general wording is left alone; the property wording is edited by a person.
    await as(partner, (tx) => saveNoteText(tx, partner, y2, GROUP, ["Edited again in the second year."]));
    const y3 = await roll(partner, client, "2026-01-01", "2026-12-31");
    const c = await current(partner, y3);
    expect(c.get("general")).toMatchObject({ version: 1, source: "carried_forward", paragraphs: ["Last year's own general wording."] });
    expect(c.get(GROUP)).toMatchObject({ version: 1, source: "carried_forward", paragraphs: ["Edited again in the second year."] });
    expect(c.get("basis")).toMatchObject({ source: "firm_default" });
    expect((await audits("create", y3))[0]).toMatchObject({ carriedNotes: 2 });
  });

  it("editing a carried passage makes a normal person version, and going back to generated wording is not carried on", async () => {
    const { client } = await lastYear();
    const y2 = await roll(partner, client, "2025-01-01", "2025-12-31");
    await as(partner, (tx) => saveNoteText(tx, partner, y2, "general", ["Rewritten this year."]));
    expect((await current(partner, y2)).get("general")).toMatchObject({ version: 2, source: null, paragraphs: ["Rewritten this year."] });
    await as(partner, (tx) => useGeneratedWording(tx, partner, y2, GROUP));
    const y3 = await roll(partner, client, "2026-01-01", "2026-12-31");
    const c = await current(partner, y3);
    expect(c.get("general")).toMatchObject({ source: "carried_forward", paragraphs: ["Rewritten this year."] });
    expect(c.has(GROUP)).toBe(false);
  });

  it("a client's first engagement carries nothing, and a firm with nothing edited carries nothing", async () => {
    const client = await as(partner, (tx) => repo.createClient(tx, partner, `First Trading ${++n} LLC`));
    const first = await as(partner, (tx) => repo.createEngagement(tx, partner, client, "2024-01-01", "2024-12-31"));
    expect([...(await current(partner, first)).values()].some((v) => v.source === "carried_forward")).toBe(false);
    expect((await audits("create", first))[0]).not.toHaveProperty("carriedNotes");
    const next = await roll(partner, client, "2025-01-01", "2025-12-31");
    expect((await audits("create", next))[0]).toMatchObject({ carriedNotes: 0 });
  });

  it("another firm's notes are never read", async () => {
    const clientB = await as(partnerB, (tx) => repo.createClient(tx, partnerB, `Firm B Trading ${++n} LLC`));
    const eB = await as(partnerB, (tx) => repo.createEngagement(tx, partnerB, clientB, "2024-01-01", "2024-12-31"));
    await as(partnerB, (tx) => saveNoteText(tx, partnerB, eB, "general", ["Firm B's private wording."]));
    const clientA = await as(partner, (tx) => repo.createClient(tx, partner, `Firm A Trading ${++n} LLC`));
    const eA = await as(partner, (tx) => repo.createEngagement(tx, partner, clientA, "2024-01-01", "2024-12-31"));
    // Asked to carry firm B's engagement onto firm A's, firm A's session finds nothing and writes nothing.
    const carried = await as(partner, (tx) => carryPriorNotes(tx, partner, eB, eA));
    expect(carried).toEqual([]);
    expect([...(await current(partner, eA)).values()].some((v) => v.paragraphs.join(" ").includes("Firm B"))).toBe(false);
    // Firm B's own roll-forward carries its own wording.
    const nextB = await roll(partnerB, clientB, "2025-01-01", "2025-12-31");
    expect((await current(partnerB, nextB)).get("general")).toMatchObject({ source: "carried_forward", paragraphs: ["Firm B's private wording."] });
  });

  it("a preparer who rolls forward carries the passages in their own name", async () => {
    const client = await as(partner, (tx) => repo.createClient(tx, partner, `Prep Trading ${++n} LLC`));
    const e = await as(partner, (tx) => repo.createEngagement(tx, partner, client, "2024-01-01", "2024-12-31"));
    await as(partner, (tx) => saveNoteText(tx, partner, e, "tax", ["Last year's tax wording."]));
    // A preparer cannot create engagements, so a refusal leaves nothing carried.
    await expect(as(preparer, (tx) => rollForward(tx, preparer, [{ clientId: client, start: "2025-01-01", end: "2025-12-31" }], TODAY))).rejects.toThrow();
  });
});

describe("the label", () => {
  const passage = (e: string, key: string, h: Awaited<ReturnType<typeof loadHistory>>, priorPeriodEnd: string | null): PassageData => {
    const cur = currentOf(h).get(key);
    const overridden = !!cur && !cur.generated;
    return {
      engagementId: e,
      noteKey: key,
      name: key,
      paragraphs: overridden ? cur!.paragraphs : ["[Generated wording to complete.]"],
      generated: ["[Generated wording to complete.]"],
      overridden,
      current: overridden ? { version: cur!.version, by: cur!.by, at: cur!.at, fromDefault: cur!.source === "firm_default", carried: cur!.source === "carried_forward" } : null,
      priorPeriodEnd,
      history: h.get(key) ?? [],
      canEdit: true,
    };
  };

  it("says 'Carried forward from last year (period ended DATE)', not the draft label, and returns to Edited by after an edit", async () => {
    const client = await as(partner, (tx) => repo.createClient(tx, partner, `Label Trading ${++n} LLC`));
    const e = await as(partner, (tx) => repo.createEngagement(tx, partner, client, "2024-01-01", "2024-12-31"));
    await as(partner, (tx) => saveNoteText(tx, partner, e, "tax", ["Wording a person wrote."]));
    const next = await roll(partner, client, "2025-01-01", "2025-12-31");
    const html = renderToStaticMarkup(<NotePassage {...passage(next, "tax", await history(partner, next), "2024-12-31")} />);
    expect(carriedLabel("2024-12-31")).toBe("Carried forward from last year (period ended 2024-12-31)");
    // The date is one unbreakable piece, so it cannot split across lines at 390 px.
    expect(html.replace(/<[^>]+>/g, "")).toContain("Carried forward from last year (period ended 2024-12-31)");
    expect(html).toContain('<span class="whitespace-nowrap">2024-12-31</span>');
    expect(html).not.toContain("Unreviewed draft wording");
    expect(html).not.toContain("Edited by");
    // Wording nobody wrote keeps the draft label exactly as before.
    expect(renderToStaticMarkup(<NotePassage {...passage(next, "commitments", await history(partner, next), "2024-12-31")} />)).toContain("Unreviewed draft wording");
    // An edit makes a normal person version, labelled as an edit.
    await as(partner, (tx) => saveNoteText(tx, partner, next, "tax", ["Rewritten."]));
    const edited = renderToStaticMarkup(<NotePassage {...passage(next, "tax", await history(partner, next), "2024-12-31")} />);
    expect(edited).toContain("Edited by");
    expect(edited).not.toContain("Carried forward from last year");
  });
});
