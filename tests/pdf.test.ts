import { describe, expect, it } from "vitest";
import { renderPdf, toWinAnsi, type PdfBlock } from "../src/server/pdf";
import { pageCount, pdfPages, pdfText } from "./pdf-text";
import { buildStatementPack, type PackAccount } from "../src/domain/statement-pack";
import { statementsDocument } from "../src/domain/statements-document";
import { buildReport, REPORT_NOTICE, type ReportInput } from "../src/domain/report";
import { formatPresentation } from "../src/domain/money";

const OPTIONS = { title: "Test document", header: "Falcon Trading LLC, period ended 2025-12-31", compress: false };

describe("text the standard fonts can print (WinAnsi)", () => {
  it("keeps ASCII, accented letters and the WinAnsi punctuation we use", () => {
    for (const s of ["Plain text 123 (45.67)", "Café Zürich Ñandú", "Sales – 2025 × 3 ÷ 2", "“quoted” and ‘single’ and don’t", "• bullet … ellipsis €100 ™"]) expect(toWinAnsi(s)).toBe(s);
  });
  it("maps look-alikes that WinAnsi lacks", () => {
    expect(toWinAnsi("−5 and 5‑year")).toBe("-5 and 5-year");
    expect(toWinAnsi("a b c")).toBe("a b c");
    expect(toWinAnsi("x ≥ 1, y ≤ 2, z ≠ 3 → ok")).toBe("x >= 1, y <= 2, z != 3 -> ok");
    expect(toWinAnsi("done ✓")).toBe("done [x]");
  });
  it("gives a letter with a mark WinAnsi lacks its plain letter", () => {
    expect(toWinAnsi("Ādam Łukasz Dvořák")).toBe("Adam ?ukasz Dvorák");
  });
  it("replaces anything else with a question mark, one for each character, and drops control characters and zero-width marks", () => {
    expect(toWinAnsi("شركة")).toBe("????");
    expect(toWinAnsi("Acme 公司 Ltd")).toBe("Acme ?? Ltd");
    expect(toWinAnsi("😀")).toBe("?");
    expect(toWinAnsi("a\u0000b​c﻿d")).toBe("abcd");
    expect(toWinAnsi("tab\there")).toBe("tab here");
  });
  it("only ever returns characters WinAnsi has", () => {
    const sample = Array.from({ length: 3000 }, (_, i) => String.fromCodePoint(i)).join("");
    for (const ch of toWinAnsi(sample)) {
      const c = ch.charCodeAt(0);
      expect(c === 0x0a || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".includes(ch), JSON.stringify(ch)).toBe(true);
    }
  });
  it("prints the dash, the multiplication sign and curly quotes into the PDF as WinAnsi", async () => {
    const pdf = await renderPdf([{ kind: "para", text: "Sales – 2025 × 3 ÷ 2 “net”" }], OPTIONS);
    expect(pdfText(pdf)).toContain("Sales – 2025 × 3 ÷ 2 “net”");
  });
});

describe("the renderer", () => {
  const blocks: PdfBlock[] = [
    { kind: "para", text: "[Draft notice, not yet reviewed.]" },
    { kind: "title", text: "Falcon Trading LLC" },
    { kind: "heading", text: "Statement of financial position" },
    { kind: "para", text: "At 2025-12-31", italics: true },
    {
      kind: "figures",
      labelPct: 55,
      rows: [
        { label: "", figures: ["Note", "2025"], kind: "header" },
        { label: "Cash", figures: ["1", "1,500.00"], kind: "line" },
        { label: "Total assets", figures: ["", "1,500.00"], kind: "total" },
      ],
    },
    { kind: "bullet", text: "first point" },
    { kind: "numbered", text: "3. a numbered item" },
    { kind: "signature", lines: ["Demo Audit Firm", "Ada Partner"] },
  ];

  it("draws the blocks in order", async () => {
    const lines = pdfPages(await renderPdf(blocks, OPTIONS))[0];
    const body = lines.join("\n");
    const order = ["[Draft notice, not yet reviewed.]", "Falcon Trading LLC", "Statement of financial position", "At 2025-12-31", "Cash", "1,500.00", "Total assets", "first point", "a numbered item", "Demo Audit Firm", "Ada Partner"];
    let at = -1;
    for (const s of order) {
      const i = body.indexOf(s, at + 1);
      expect(i, s).toBeGreaterThan(at);
      at = i;
    }
  });

  it("writes the client and period at the top, and Page N of M at the bottom, of every page", async () => {
    const many: PdfBlock[] = Array.from({ length: 90 }, (_, i) => ({ kind: "para" as const, text: `Paragraph ${i + 1} of the long document, with enough words in it to take up a line or two on the page.` }));
    const pdf = await renderPdf(many, OPTIONS);
    const pages = pdfPages(pdf);
    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect(pageCount(pdf)).toBe(pages.length);
    pages.forEach((p, i) => {
      expect(p.join("\n"), `page ${i + 1}`).toContain("Falcon Trading LLC, period ended 2025-12-31");
      expect(p.join("\n"), `page ${i + 1}`).toContain(`Page ${i + 1} of ${pages.length}`);
    });
    // Nothing is lost across the page breaks.
    const all = pdfText(pdf);
    for (const n of [1, 45, 90]) expect(all).toContain(`Paragraph ${n} of the long document`);
  });

  it("repeats the table header on every page a long table runs onto", async () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ label: `Line item ${i + 1}`, figures: ["", `${(i + 1) * 100}.00`], kind: "line" as const }));
    const pdf = await renderPdf([{ kind: "figures", labelPct: 60, rows: [{ label: "", figures: ["Note", "2025"], kind: "header" }, ...rows] }], OPTIONS);
    const pages = pdfPages(pdf);
    expect(pages.length).toBeGreaterThanOrEqual(2);
    for (const p of pages) expect(p.join("\n")).toContain("Note");
    const all = pdfText(pdf);
    expect(all).toContain("Line item 1\n");
    expect(all).toContain("Line item 120");
    expect(all).toContain("12000.00");
  });

  it("makes a real PDF, compressed by default", async () => {
    const pdf = await renderPdf(blocks, { title: "T", header: "H" });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.subarray(-6).toString()).toContain("%%EOF");
    expect(pdf.length).toBeGreaterThan(1000);
    // The streams are compressed, and the text is still all there once they are inflated.
    expect(pdf.toString("latin1")).toContain("/FlateDecode");
    expect(pdfText(pdf)).toContain("Statement of financial position");
  });

  it("uses A4", async () => {
    const pdf = (await renderPdf([{ kind: "para", text: "x" }], OPTIONS)).toString("latin1");
    expect(pdf).toMatch(/\/MediaBox \[0 0 595\.28 841\.89\]/);
  });

  it("uses only the built-in Helvetica fonts", async () => {
    const pdf = (await renderPdf(blocks, OPTIONS)).toString("latin1");
    const fonts = [...pdf.matchAll(/\/BaseFont \/([A-Za-z-]+)/g)].map((m) => m[1]);
    expect(fonts.length).toBeGreaterThan(0);
    for (const f of fonts) expect(f).toMatch(/^Helvetica/);
    expect(pdf).not.toMatch(/\/FontFile/);
  });
});

describe("the statements PDF", () => {
  const acct = (code: string, groupCode: string, name: string, closingMinor: number, priorMinor: number): PackAccount => ({ code, name, groupCode, closingMinor, priorMinor, approved: true });
  const BOOKS = [
    acct("1", "CASH", "Bank", 150000, 100000),
    acct("2", "CAPITAL", "Share capital", -100000, -100000),
    acct("3", "REVENUE", "Sales", -90000, -40000),
    acct("4", "ADMIN", "Rent", 30000, 30000),
    acct("5", "ADMIN", "Utilities", 10000, 10000),
  ];
  const input = (unitMinor: number, draft: boolean) => ({ clientName: "Export Co & Sons", periodStart: "2025-01-01", periodEnd: "2025-12-31", pack: buildStatementPack(BOOKS, { unitMinor }), draft });

  it("shows every statement, in order, with the draft banner when it is a draft", async () => {
    const pdf = await renderPdf(statementsDocument(input(1, true)), { title: "S", header: "Export Co & Sons", compress: false });
    const text = pdfText(pdf);
    const order = ["DRAFT: these statements have outstanding checks", "Statement of financial position", "Statement of comprehensive income", "Statement of changes in equity", "Statement of cash flows", "Notes to the financial statements"];
    let at = -1;
    for (const s of order) {
      const i = text.indexOf(s, at + 1);
      expect(i, s).toBeGreaterThan(at);
      at = i;
    }
    expect(text).toContain("Export Co & Sons");
  });

  it("leaves the banner off a locked, clean set", async () => {
    const text = pdfText(await renderPdf(statementsDocument(input(1, false)), { title: "S", header: "H", compress: false }));
    expect(text).not.toContain("DRAFT: these statements");
  });

  it("holds the same lines and figures as the pack, in cents and in whole units", async () => {
    for (const unit of [1, 100]) {
      const pack = buildStatementPack(BOOKS, { unitMinor: unit });
      const text = pdfText(await renderPdf(statementsDocument({ ...input(unit, false), pack }), { title: "S", header: "H", compress: false }));
      const fmt = (n: number) => formatPresentation(n, unit);
      for (const section of pack.base.financialPosition) for (const l of section.lines) {
        expect(text, l.label).toContain(l.label);
        expect(text, `${l.label} ${unit}`).toContain(fmt(l.current));
      }
      for (const l of pack.base.comprehensiveIncome) {
        expect(text).toContain(l.label);
        expect(text).toContain(fmt(l.current));
      }
      for (const note of pack.notes) {
        expect(text).toContain(`${note.number}. ${note.title}`);
        for (const p of note.paragraphs) expect(text).toContain(p.slice(0, 40));
      }
      if (pack.cashFlow) {
        expect(text).toContain(fmt(pack.cashFlow.closing));
        expect(text).toContain("Cash and cash equivalents at the end of the year");
      }
    }
  });

  it("is drawn from the same block list as the Word file", () => {
    const blocks = statementsDocument(input(1, true));
    expect(blocks[0]).toEqual({ kind: "para", text: expect.stringContaining("DRAFT"), bold: true });
    expect(blocks.filter((b) => b.kind === "pagebreak").length).toBeGreaterThanOrEqual(3);
  });
});

describe("the auditor's report PDF", () => {
  const base: ReportInput = { clientName: "Falcon Trading LLC", periodEnd: "2025-12-31", framework: "IFRS for SMEs", firmName: "Demo Audit Firm", partner: "Ada Partner", city: "Dubai", reportDate: "2026-03-15", opinion: "unmodified" };
  // A long paragraph wraps onto several lines of the PDF, so compare with the line breaks read as spaces.
  const flat = (s: string) => s.replace(/\s+/g, " ");
  const pdfOf = (input: ReportInput) => renderPdf(buildReport(input), { title: "R", header: "Falcon Trading LLC, independent auditor's report", compress: false });

  it("starts with the draft notice, then the title, and prints the signature block", async () => {
    const text = flat(pdfText(await pdfOf(base)));
    expect(text.indexOf(REPORT_NOTICE)).toBe(0);
    expect(text.indexOf(REPORT_NOTICE)).toBeLessThan(text.indexOf("Independent auditors report To the shareholders".replace("auditors", "auditor's")));
    for (const s of ["To the shareholders of Falcon Trading LLC", "Demo Audit Firm", "Ada Partner", "Dubai", "15 March 2026", "[Complete as required by local law]"]) expect(text).toContain(s);
  });

  it("has the opinion heading for each kind and the partner's basis text", async () => {
    const headings: Record<string, string> = { unmodified: "Opinion\n", qualified: "Qualified opinion\n", adverse: "Adverse opinion\n", disclaimer: "Disclaimer of opinion\n" };
    for (const kind of ["unmodified", "qualified", "adverse", "disclaimer"] as const) {
      const text = pdfText(await pdfOf({ ...base, opinion: kind, basisForModification: kind === "unmodified" ? undefined : "Stock of AED 12,000.00 was not counted." }));
      expect(text, kind).toContain(headings[kind]);
      if (kind !== "unmodified") expect(text, kind).toContain("Stock of AED 12,000.00 was not counted.");
    }
  });

  it("has the going-concern section only when recorded", async () => {
    expect(pdfText(await pdfOf(base))).not.toContain("Material uncertainty related to going concern");
    const text = flat(pdfText(await pdfOf({ ...base, goingConcern: { noteReference: "7" } })));
    expect(text).toContain("Material uncertainty related to going concern");
    expect(text).toContain("Note 7 to the financial statements");
  });
});
