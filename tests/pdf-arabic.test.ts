/**
 * Arabic names in the PDF downloads, with invented names.
 *
 * Order and placing are read from what the renderer draws: every stretch with its position, an Arabic one turned round as the font engine
 * turns it (shown by the joined-forms test). So a line read here is the line as a reader sees it, left to right. The file itself is read
 * for words whose letters do not share a shape: Noto draws several letters as one base shape plus dots, and pdfkit's text table keeps one
 * letter for each shape, so the file's text cannot be trusted letter by letter (copying Arabic out of the PDF has the same limit).
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import PDFDocument from "pdfkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toVisualString } from "../src/domain/bidi";
import { buildReport } from "../src/domain/report";
import { buildStatementPack } from "../src/domain/statement-pack";
import { statementsDocument } from "../src/domain/statements-document";
import { renderPdf, type PdfBlock } from "../src/server/pdf";
import { baseDirection, hasArabic, linePieces } from "../src/server/pdf-arabic";
import { buildStatementsDocx } from "../src/server/statements-docx";

// "Al Noor Al Wahmiya (fictitious) Trading", an invented company.
const NAME = "شركة النور الوهمية للتجارة";
const LEGAL = "ذ.م.م";
const ACCOUNT = "ذمم دائنة (موردون)";
const PERSON = "مراجع وهمي";
const reversed = (s: string) => Array.from(s).reverse().join("");

interface Drawn {
  x: number;
  y: number;
  text: string;
  arabic: boolean;
  glyphs: number;
}

/** pdfkit's own layout of an uncompressed PDF: one BT…ET block for each drawn stretch. */
function read(buffer: Buffer): Drawn[][] {
  const source = buffer.toString("latin1");
  const objects = new Map([...source.matchAll(/(?:^|\n)(\d+) 0 obj\n([\s\S]*?)\nendobj/g)].map((m) => [m[1], m[2]]));
  const tables = new Map<string, string[] | null>();
  for (const [, dictionary] of source.matchAll(/\/Font <<([\s\S]*?)>>/g)) {
    for (const [, name, id] of dictionary.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
      const ref = /\/ToUnicode (\d+) 0 R/.exec(objects.get(id) ?? "")?.[1];
      if (!ref) {
        tables.set(name, null);
        continue;
      }
      const map = /beginbfrange\s*<0000> <[0-9a-f]+> \[([\s\S]*?)\]\s*endbfrange/.exec(objects.get(ref)!)![1];
      const codes = [...map.matchAll(/<([0-9a-f ]*)>/g)].map((m) => String.fromCharCode(...m[1].split(" ").filter(Boolean).map((h) => parseInt(h, 16))));
      tables.set(name, codes);
    }
  }
  const pages: Drawn[][] = [];
  for (const [, content] of source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const drawn: Drawn[] = [];
    for (const [, block] of content.matchAll(/\bBT\b([\s\S]*?)\bET\b/g)) {
      const font = /\/(F\d+) [\d.]+ Tf/.exec(block)![1];
      const table = tables.get(font) ?? null;
      // A stretch can be placed in parts: a dot or vowel sign that sits off the baseline gets its own position.
      const parts: { x: number; y: number; units: string[] }[] = [];
      for (const m of block.matchAll(/1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm|\[([^\]]*)\]\s*TJ/g)) {
        if (m[1] !== undefined) parts.push({ x: Number(m[1]), y: Number(m[2]), units: [] });
        else {
          const hex = [...m[3].matchAll(/<([0-9a-f]*)>/g)].map((h) => h[1]).join("");
          parts.at(-1)!.units.push(...(hex.match(table ? /.{4}/g : /.{2}/g) ?? []));
        }
      }
      const units = parts.flatMap((p) => p.units);
      const text = units.map((u) => (table ? table[parseInt(u, 16)] ?? "" : String.fromCharCode(parseInt(u, 16)))).join("");
      // The baseline is where most of its glyphs sit.
      const baseline = [...parts].sort((p, q) => q.units.length - p.units.length)[0].y;
      drawn.push({ x: Math.min(...parts.map((p) => p.x)), y: baseline, text, arabic: table !== null, glyphs: units.length });
    }
    if (drawn.length) pages.push(drawn);
  }
  return pages;
}

interface Stretch {
  page: unknown;
  x: number;
  y: number;
  seen: string;
  arabic: boolean;
}
let stretches: Stretch[] = [];
beforeEach(() => {
  stretches = [];
  const proto = PDFDocument.prototype as unknown as { text: (...args: unknown[]) => unknown };
  type Doc = { page: unknown; _fontSize: number; _font: { ascender: number } };
  const original = proto.text;
  vi.spyOn(proto, "text").mockImplementation(function (this: unknown, ...args: unknown[]) {
    const doc = this as Doc;
    const [text, x, y, options] = args as [string, number, number, { features?: unknown; baseline?: string } | undefined];
    // Only a stretch of Arabic is drawn with a feature list (see pdf-arabic.ts).
    const arabic = options?.features !== undefined;
    // Where the letters stand: pdfkit takes the top of the line unless it is told the baseline.
    const baseline = options?.baseline === "alphabetic" ? y : y + (doc._font.ascender / 1000) * doc._fontSize;
    stretches.push({ page: doc.page, x, y: baseline, seen: arabic ? reversed(text) : text, arabic });
    return original.apply(this, args);
  });
});
afterEach(() => void vi.restoreAllMocks());

/** The body's lines as drawn, each as it is seen. The headers and page numbers come after the body and are left in. */
function drawnLines(): string[] {
  const rows = new Map<string, Stretch[]>();
  const pages: unknown[] = [];
  for (const d of stretches) {
    if (!pages.includes(d.page)) pages.push(d.page);
    const key = `${pages.indexOf(d.page)}:${d.y.toFixed(1)}`;
    rows.set(key, [...(rows.get(key) ?? []), d]);
  }
  return [...rows.values()].map((row) => [...row].sort((a, b) => a.x - b.x).map((d) => d.seen).join(""));
}

/** The page's lines in the file, top to bottom, each as it is seen. */
function lines(page: Drawn[]): string[] {
  const rows = new Map<string, Drawn[]>();
  for (const d of page) rows.set(d.y.toFixed(1), [...(rows.get(d.y.toFixed(1)) ?? []), d]);
  return [...rows.entries()].sort((a, b) => Number(b[0]) - Number(a[0])).map(([, row]) => row.sort((a, b) => a.x - b.x).map((d) => d.text).join(""));
}

const OPTIONS = { title: "Statements", header: "Falcon Trading LLC, period ended 2025-12-31", compress: false };
const pdf = (blocks: PdfBlock[], options: Partial<Parameters<typeof renderPdf>[1]> = {}) => renderPdf(blocks, { ...OPTIONS, ...options });
const body = async (blocks: PdfBlock[]) => {
  stretches = [];
  await pdf(blocks);
  return drawnLines();
};

describe("Arabic names in a PDF", () => {
  it("prints an Arabic client name right to left, with the licence number's digits in their own order", async () => {
    const name = `${NAME} ${LEGAL} 123456`;
    const seen = await body([{ kind: "title", text: name }]);
    expect(seen).toContain(`123456 ${reversed(`${NAME} ${LEGAL}`)}`);
    expect(seen.join("\n")).not.toContain("?");
  });

  it("keeps a mixed Arabic, Latin and digit name in order", async () => {
    const name = "Al Noor النور Trading 2025 L.L.C";
    expect(await body([{ kind: "para", text: name }])).toContain(`Al Noor ${reversed("النور")} Trading 2025 L.L.C`);
  });

  it("mirrors the brackets of an Arabic account name, drawing them with the document's font, in a table and beside figures", async () => {
    await pdf([
      { kind: "figures", labelPct: 55, rows: [{ label: ACCOUNT, figures: ["1,500.00"], kind: "line" }] },
      { kind: "table", header: ["Account", "Debit"], rows: [[ACCOUNT, "1.00"]] },
    ]);
    const seen = drawnLines();
    const expected = `(${reversed("موردون")}) ${reversed("ذمم دائنة")}`;
    expect(toVisualString(ACCOUNT)).toBe(expected);
    expect(seen).toContain(`${expected}1,500.00`);
    expect(seen).toContain(`${expected}1.00`);
    const brackets = stretches.filter((d) => /[()]/.test(d.seen));
    expect(brackets.length).toBeGreaterThan(0);
    for (const d of brackets) expect(d.arabic).toBe(false);
  });

  it("reads Arabic-Indic digits left to right", async () => {
    expect(await body([{ kind: "para", text: "رقم ١٢٣" }])).toContain(`١٢٣ ${reversed("رقم")}`);
  });

  it("prints names in the header, the firm line, bullets, numbered items, headings and the signature block", async () => {
    const buffer = await pdf(
      [
        { kind: "heading", text: NAME },
        { kind: "bullet", text: PERSON },
        { kind: "numbered", text: `2. ${PERSON}` },
        { kind: "signature", lines: [`Signed by ${PERSON}, partner`] },
        { kind: "pagebreak" },
        { kind: "para", text: "second page" },
      ],
      { header: `${NAME}, period ended 2025-12-31`, brand: { firmName: "مكتب وهمي", logo: null } },
    );
    const seen = drawnLines();
    // The header and the firm's name on each of the two pages.
    expect(seen.filter((l) => l === `${reversed(NAME)}, period ended 2025-12-31${reversed("مكتب وهمي")}`)).toHaveLength(2);
    expect(seen).toContain(reversed(NAME));
    // The bullet and the number are drawn beside the name, on the same line.
    expect(seen).toContain(`•${reversed(PERSON)}`);
    expect(seen).toContain(`2.${reversed(PERSON)}`);
    expect(seen).toContain(`Signed by ${reversed(PERSON)}, partner`);
    expect(read(buffer)).toHaveLength(2);
    expect(stretches.map((d) => d.seen).join("")).not.toContain("?");
  });

  it("breaks a long line at spaces, first words on the first line, and carries on to a new page", async () => {
    const words = Array.from({ length: 2400 }, (_, i) => (i % 2 ? "النور" : "للتجارة"));
    const pages = read(await pdf([{ kind: "para", text: words.join(" ") }]));
    expect(pages.length).toBeGreaterThan(1);
    // The paragraph's lines: everything drawn that holds Arabic.
    const text = drawnLines().filter((l) => /[\u0600-\u06ff]/.test(l));
    expect(text.length).toBeGreaterThan(20);
    expect(text[0].endsWith(reversed(words[0]))).toBe(true);
    expect(text.map((l) => reversed(l)).join(" ")).toBe(words.join(" "));
    for (const d of stretches.filter((d) => d.arabic)) {
      expect(d.x).toBeGreaterThanOrEqual(55.9);
      expect(d.x).toBeLessThan(540);
      expect(d.y).toBeLessThan(842 - 60);
    }
  });

  it("hands the font whole words, so the letters take their joined forms", () => {
    const doc = new PDFDocument();
    doc.registerFont("noto", readFileSync("assets/fonts/noto-naskh-arabic/NotoNaskhArabic-Regular.ttf"));
    doc.font("noto");
    const font = (doc as unknown as { _font: { font: { layout(t: string, f: string[]): { glyphs: { name: string }[] } } } })._font.font;
    const [piece] = linePieces("سلام", baseDirection("سلام"), () => true, (t) => t);
    // Left to right: meem standing alone, alef joined to the lam before it, lam in the middle, seen at the start.
    expect(font.layout(piece.text, []).glyphs.map((g) => g.name)).toEqual(["uni0645", "uni0627.fina.rlig.2", "uni0644.medi.rlig", "uni0633.init"]);
  });

  it("draws those joined glyphs in the file", async () => {
    const page = read(await pdf([{ kind: "para", text: "سلام" }]))[0];
    expect(page.find((d) => d.arabic)).toMatchObject({ text: reversed("سلام"), glyphs: 4 });
  });

  it("writes a name, its digits and its Latin words into the file in the order seen", async () => {
    const page = read(await pdf([{ kind: "para", text: "Al سلام Trading 2025" }, { kind: "para", text: "سلام 123" }, { kind: "para", text: "سلام ١٢٣" }]))[0];
    const seen = lines(page);
    expect(seen).toContain(`Al ${reversed("سلام")} Trading 2025`);
    expect(seen).toContain(`123 ${reversed("سلام")}`);
    expect(seen).toContain(`١٢٣ ${reversed("سلام")}`);
  });

  it("embeds the Arabic font only when there is Arabic, and keeps other scripts as question marks", async () => {
    const latin = (await pdf([{ kind: "para", text: "Falcon Trading 公司" }])).toString("latin1");
    expect(latin).not.toContain("NotoNaskh");
    stretches = [];
    const arabic = await pdf([{ kind: "para", text: `公司 ${NAME}` }]);
    expect(arabic.toString("latin1")).toContain("NotoNaskhArabic-Regular");
    expect(drawnLines()).toContain(`?? ${reversed(NAME)}`);
    const bold = (await pdf([{ kind: "title", text: NAME }])).toString("latin1");
    expect(bold).toContain("NotoNaskhArabic-Bold");
  });

  it("lays an English sentence out left to right even when it begins with an Arabic name", () => {
    expect(baseDirection(`${NAME}, period ended 2025-12-31`)).toBe("ltr");
    expect(baseDirection(`${NAME} 123456`)).toBe("rtl");
    expect(hasArabic("Falcon Trading — Société")).toBe(false);
  });
});

describe("the app's own documents with Arabic names", () => {
  const pack = buildStatementPack(
    [
      { code: "1000", name: ACCOUNT, closingMinor: 150000, priorMinor: 0, groupCode: "CASH", approved: true },
      { code: "3000", name: "Share capital", closingMinor: -150000, priorMinor: 0, groupCode: "EQUITY_CAPITAL", approved: true },
    ],
    { unitMinor: 100 },
  );
  const input = { clientName: `${NAME} ${LEGAL}`, periodStart: "2025-01-01", periodEnd: "2025-12-31", pack, draft: true };

  it("prints the client's name in the financial statements", async () => {
    const buffer = await renderPdf(statementsDocument(input), { title: "t", header: `${input.clientName}, financial statements`, compress: false });
    const seen = drawnLines();
    expect(seen).toContain(reversed(input.clientName));
    expect(seen).toContain(`${reversed(input.clientName)}, financial statements`);
    expect(read(buffer).length).toBeGreaterThan(1);
  });

  it("prints the client, firm and partner in the auditor's report", async () => {
    const blocks = buildReport({ clientName: NAME, periodEnd: "2025-12-31", framework: "IFRS for SMEs", firmName: "مكتب وهمي", partner: PERSON, city: "Dubai", reportDate: "2026-03-15", opinion: "unmodified", firmLines: ["مبنى وهمي"] });
    await renderPdf(blocks, { title: "t", header: `${NAME}, report`, compress: false });
    const seen = drawnLines();
    for (const name of ["مكتب وهمي", PERSON, "مبنى وهمي"]) expect(seen).toContain(reversed(name));
    expect(seen.join("")).toContain(reversed("النور"));
    expect(stretches.map((d) => d.seen).join("")).not.toContain("?");
  });

  it("keeps the Arabic text in the Word file, in typing order and without right-to-left marks", async () => {
    const zip = await JSZip.loadAsync(await buildStatementsDocx(input));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain(input.clientName);
    // Recorded as it is today: Word orders Arabic itself, and the file does not mark these runs right-to-left.
    expect(xml).not.toMatch(/<w:(rtl|bidi)\b/);
  });
});

describe("what does not change", () => {
  it("draws a document without Arabic byte for byte as before Arabic was added", async () => {
    // The hash was taken from main's renderer for these blocks, with this clock and no compression.
    vi.useFakeTimers({ now: Date.UTC(2026, 0, 15, 8), toFake: ["Date"] });
    try {
      const blocks: PdfBlock[] = [
        { kind: "para", text: "[Draft notice, not yet reviewed.]", bold: true },
        { kind: "title", text: "Falcon Trading LLC — Société" },
        { kind: "heading", text: "Statement of financial position" },
        { kind: "figures", labelPct: 55, rows: [{ label: "", figures: ["Note", "2025"], kind: "header" }, { label: "Cash", figures: ["1", "1,500.00"], kind: "line" }, { label: "Total assets", figures: ["", "1,500.00"], kind: "total" }] },
        { kind: "bullet", text: "A point, x ≥ 1, − 5 and 公司" },
        { kind: "numbered", text: "1. A numbered item" },
        { kind: "table", header: ["Account", "Debit"], rows: [["Cash", "1.00"]] },
        { kind: "signature", lines: ["Demo Audit Firm", "Dubai"] },
      ];
      const buffer = await renderPdf(blocks, { title: "Test", header: "Falcon Trading LLC, period ended 2025-12-31", brand: { firmName: "Demo Audit Firm", logo: null }, compress: false });
      expect(createHash("sha256").update(buffer).digest("hex")).toBe("129120d60a52442b0213089af689b3da42c6791edac617f37ea9e1446393c27d");
    } finally {
      vi.useRealTimers();
    }
  });

  it("prints Arabic as question marks, without failing, when the font files are not there", async () => {
    const empty = mkdtempSync(path.join(os.tmpdir(), "lf-nofont-"));
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(empty);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const buffer = await renderPdf([{ kind: "para", text: "Client شركة" }], OPTIONS);
      expect(lines(read(buffer)[0])).toContain("Client ????");
      expect(error).toHaveBeenCalled();
    } finally {
      cwd.mockRestore();
      error.mockRestore();
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
