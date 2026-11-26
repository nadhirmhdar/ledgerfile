import { describe, expect, it } from "vitest";
import { buildStatementPack, type PackAccount } from "../src/domain/statement-pack";
import { statementsDocument } from "../src/domain/statements-document";
import { buildStatementsDocx } from "../src/server/statements-docx";
import { renderPdf } from "../src/server/pdf";
import { pdfText } from "./pdf-text";
import { placeholderCount, splitBrackets } from "../src/ui/statements-view";
import { COMMITMENTS_KEY, describeKey, EVENTS_KEY, GOING_CONCERN_KEY, isKnownKey, RELATED_KEY, STANDARD_NOTES, TAX_KEY } from "../src/domain/note-texts";
import { STANDARD_NOTE_WORDING } from "../src/domain/standard-notes";

let n = 0;
const acct = (groupCode: string, name: string, closingMinor: number, priorMinor: number | null): PackAccount => ({ code: String(1000 + n++), name, groupCode, closingMinor, priorMinor, approved: true });

/** An invented trading company with related-party balances and income tax, in ledger sign. Cash balances each year; the cents leave a rounding difference in whole units. */
function books(opts: { related?: boolean; tax?: boolean; comparatives?: boolean } = {}): PackAccount[] {
  n = 0;
  const { related = true, tax = true, comparatives = true } = opts;
  const rows: [string, string, number, number][] = [
    ["PPE", "Equipment", 4300050, 4000050],
    ["PPE", "Vehicles", 1250050, 1250050],
    ["TRADEREC", "Receivables", 1800000, 1500000],
    ["TRADEPAY", "Payables", -1200000, -1000000],
    ["CAPITAL", "Share capital", -3000000, -3000000],
    ["RETAINED", "Retained earnings", -500000, -400000],
    ["REVENUE", "Sales", -10000000, -8000000],
    ["COS", "Cost of sales", 6000000, 5000000],
    ["ADMIN", "Rent", 1000000, 1000000],
    ...(related ? ([["RPREC", "Due from the shareholder", 350033, 120011], ["RPPAY", "Due to a sister company", -220077, -90055]] as [string, string, number, number][]) : []),
    ...(tax ? ([["TAXEXP", "Corporate tax expense", 90025, 70040], ["TAXLIAB", "Corporate tax payable", -90025, -70040]] as [string, string, number, number][]) : []),
  ];
  const all = rows.map(([g, name, c, p]) => acct(g, name, c, comparatives ? p : null));
  const cash = acct("CASH", "Bank", -all.reduce((s, a) => s + a.closingMinor, 0), comparatives ? -all.reduce((s, a) => s + (a.priorMinor ?? 0), 0) : null);
  return [...all, cash];
}
const titles = (pack: ReturnType<typeof buildStatementPack>) => pack.notes.map((x) => x.title);
const standard = (pack: ReturnType<typeof buildStatementPack>) => pack.notes.filter((x) => x.key && STANDARD_NOTES.some((s) => s.key === x.key));

describe("the standard notes, their keys and order", () => {
  it("are five, with stable keys, known to the editor and named", () => {
    expect(STANDARD_NOTES.map((s) => s.key)).toEqual([RELATED_KEY, TAX_KEY, COMMITMENTS_KEY, EVENTS_KEY, GOING_CONCERN_KEY]);
    expect(STANDARD_NOTES.map((s) => s.key)).toEqual(["related", "tax", "commitments", "events", "going_concern"]);
    for (const s of STANDARD_NOTES) {
      expect(isKnownKey(s.key), s.key).toBe(true);
      expect(describeKey(s.key)).toBe(s.title);
    }
    expect(isKnownKey("going-concern")).toBe(false);
  });
});

describe("which notes are included, and how they are numbered", () => {
  for (const comparatives of [true, false]) {
    it(`${comparatives ? "with" : "without"} comparatives: related and tax with balances, then the three that are always there, numbered on from the group notes`, () => {
      const pack = buildStatementPack(books({ comparatives }));
      const groupNotes = pack.notes.filter((x) => x.groupCode);
      const lastGroup = Math.max(...groupNotes.map((x) => x.number));
      expect(standard(pack).map((x) => [x.number, x.key, x.title])).toEqual([
        [lastGroup + 1, "related", "Related parties"],
        [lastGroup + 2, "tax", "Income tax"],
        [lastGroup + 3, "commitments", "Commitments and contingencies"],
        [lastGroup + 4, "events", "Events after the reporting period"],
        [lastGroup + 5, "going_concern", "Going concern"],
      ]);
      // The numbers run on without a gap from the first note to the last.
      expect(pack.notes.map((x) => x.number)).toEqual(pack.notes.map((_, i) => i + 1));
    });
  }

  it("leaves out related parties and income tax when their groups have no balance, but never the other three", () => {
    const none = buildStatementPack(books({ related: false, tax: false }));
    expect(standard(none).map((x) => x.key)).toEqual(["commitments", "events", "going_concern"]);
    expect(standard(buildStatementPack(books({ tax: false }))).map((x) => x.key)).toEqual(["related", "commitments", "events", "going_concern"]);
    expect(standard(buildStatementPack(books({ related: false }))).map((x) => x.key)).toEqual(["tax", "commitments", "events", "going_concern"]);
    expect(titles(none).slice(-3)).toEqual(["Commitments and contingencies", "Events after the reporting period", "Going concern"]);
  });

  it("includes a note whose balance is only in the prior year", () => {
    const accounts = books().map((a) => (a.groupCode === "RPREC" || a.groupCode === "RPPAY" ? { ...a, closingMinor: 0 } : a));
    // Cash is the balancing figure for this year; put the removed balance back through cash so the books still add up.
    const gone = books().filter((a) => a.groupCode === "RPREC" || a.groupCode === "RPPAY").reduce((s, a) => s + a.closingMinor, 0);
    const cash = accounts.find((a) => a.groupCode === "CASH")!;
    cash.closingMinor += gone;
    expect(standard(buildStatementPack(accounts)).map((x) => x.key)).toContain("related");
  });
});

describe("the tables come from the same figures as the face lines", () => {
  for (const unitMinor of [1, 100]) {
    for (const comparatives of [true, false]) {
      it(`${unitMinor === 1 ? "exact" : "whole units"}, ${comparatives ? "with" : "without"} comparatives`, () => {
        const pack = buildStatementPack(books({ comparatives }), { unitMinor });
        const face = [...pack.base.comprehensiveIncome, ...pack.base.financialPosition.flatMap((s) => s.lines)];
        const sum = (code: string, year: "current" | "prior") => face.filter((l) => l.groupCode === code).reduce((s, l) => s + l[year], 0);
        for (const key of ["related", "tax"]) {
          const note = pack.notes.find((x) => x.key === key)!;
          expect(note.table!.showTotal).toBe(false);
          expect(note.table!.rows).toHaveLength(2);
          for (const r of note.table!.rows) {
            expect(r.current, `${key} ${r.label}`).toBe(sum(r.groupCode!, "current"));
            if (comparatives) expect(r.prior, `${key} ${r.label} prior`).toBe(sum(r.groupCode!, "prior"));
            else expect(r.prior).toBeNull();
            if (unitMinor === 100) expect(r.current % 100).toBe(0);
          }
        }
        const related = pack.notes.find((x) => x.key === "related")!.table!.rows;
        expect(related.map((r) => r.label)).toEqual(["Due from related parties", "Due to related parties"]);
        expect(pack.notes.find((x) => x.key === "tax")!.table!.rows.map((r) => r.label)).toEqual(["Income tax expense", "Current tax liability"]);
      });
    }
  }
});

describe("the wording", () => {
  const pack = buildStatementPack(books());
  it("is generated, original, and labelled as a draft until edited: the passages are the generated words, not overridden", () => {
    for (const note of standard(pack)) {
      expect(note.overridden, note.title).toBe(false);
      expect(note.paragraphs, note.title).toEqual(STANDARD_NOTE_WORDING[note.key!]);
      expect(note.generated, note.title).toEqual(STANDARD_NOTE_WORDING[note.key!]);
    }
  });

  it("states no rate or law as fact: outside the square brackets there are no digits, percentages, or named laws, and the tax note has the rate as a placeholder", () => {
    for (const [key, paragraphs] of Object.entries(STANDARD_NOTE_WORDING)) {
      const fixed = paragraphs.flatMap((p) => splitBrackets(p).filter((x) => !x.placeholder).map((x) => x.text)).join(" ");
      expect(fixed, key).not.toMatch(/[0-9%]/);
      expect(fixed.toLowerCase(), key).not.toMatch(/\b(act|law|decree|regulation|isa|ifrs|ias)\b/);
    }
    const tax = pack.notes.find((x) => x.key === "tax")!;
    expect(tax.paragraphs[0]).toContain("[State the tax regime that applies to the entity, the tax period, and the rate or rates used to measure the tax for the year.]");
    expect(tax.paragraphs.join(" ")).toContain("rate or rates");
  });

  it("is counted by the placeholder count, which is the one the page uses", () => {
    const standardCount = standard(pack).reduce((s, x) => s + placeholderCount(x.paragraphs), 0);
    expect(standardCount).toBeGreaterThanOrEqual(8);
    const all = placeholderCount(pack.notes.flatMap((x) => [...x.paragraphs, ...(x.subsections ?? []).flatMap((s) => s.paragraphs)]));
    const without = placeholderCount(pack.notes.filter((x) => !standard(pack).includes(x)).flatMap((x) => [...x.paragraphs, ...(x.subsections ?? []).flatMap((s) => s.paragraphs)]));
    expect(all - without).toBe(standardCount);
  });

  it("is replaced by a person's text for that passage only, and the figures stay generated", () => {
    const edited = buildStatementPack(books(), { noteTexts: { going_concern: ["The preparers have assessed the going-concern position and found no uncertainty."] } });
    const gc = edited.notes.find((x) => x.key === "going_concern")!;
    expect(gc.overridden).toBe(true);
    expect(gc.paragraphs).toEqual(["The preparers have assessed the going-concern position and found no uncertainty."]);
    expect(gc.generated).toEqual(STANDARD_NOTE_WORDING.going_concern);
    expect(edited.notes.find((x) => x.key === "events")!.overridden).toBe(false);
    expect(edited.notes.find((x) => x.key === "related")!.table).toEqual(pack.notes.find((x) => x.key === "related")!.table);
  });
});

describe("Word and PDF", () => {
  const input = (unitMinor: number) => ({ clientName: "Export Co", periodStart: "2025-01-01", periodEnd: "2025-12-31", pack: buildStatementPack(books(), { unitMinor }), draft: true });

  it("show the new notes in the same order and numbering as the page, with their tables and without a total on the ledger tables", async () => {
    const pack = buildStatementPack(books());
    const text = pdfText(await renderPdf(statementsDocument(input(1)), { title: "S", header: "Export Co", compress: false }));
    let at = -1;
    for (const note of standard(pack)) {
      const i = text.indexOf(`${note.number}. ${note.title}`, at + 1);
      expect(i, note.title).toBeGreaterThan(at);
      at = i;
    }
    for (const label of ["Due from related parties", "Due to related parties", "Income tax expense", "Current tax liability"]) expect(text, label).toContain(label);
    expect(text).toContain("[date the statements were approved]");

    const { default: JSZip } = await import("jszip");
    const buffer = await buildStatementsDocx(input(100));
    const xml = await (await JSZip.loadAsync(buffer)).file("word/document.xml")!.async("string");
    for (const note of standard(pack)) expect(xml, note.title).toContain(`${note.number}. ${note.title}`);
    expect(xml).toContain("Due from related parties");
    expect(xml).toContain("rate or rates");
  });

  it("carry a person's edit of a standard note", async () => {
    const pack = buildStatementPack(books(), { noteTexts: { events: ["No events after the reporting period need disclosure."] } });
    const text = pdfText(await renderPdf(statementsDocument({ ...input(1), pack }), { title: "S", header: "H", compress: false }));
    expect(text).toContain("No events after the reporting period need disclosure.");
    expect(text).not.toContain("[date the statements were approved]");
  });
});

describe("the going concern wording", () => {
  it("is management's assessment, in one placeholder", async () => {
    const { STANDARD_NOTE_WORDING } = await import("../src/domain/standard-notes");
    const text = STANDARD_NOTE_WORDING[GOING_CONCERN_KEY];
    expect(text).toHaveLength(1);
    expect(text[0]).toContain("management's assessment");
    expect(text[0]).not.toContain("preparers");
    expect(placeholderCount(text)).toBe(1);
  });
});
