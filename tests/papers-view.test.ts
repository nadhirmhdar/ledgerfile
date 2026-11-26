import { describe, expect, it } from "vitest";
import { fileSize, filingText, filterPapers, isNotFiled, paperControls, paperCounts, paperResults, papersSentence, parsePapersSearch, parsePapersShow, type PaperLike } from "../src/ui/papers-view";

const p = (fileName: string, o: Partial<PaperLike> = {}): PaperLike => ({ fileName, description: null, targetKind: "engagement", reference: null, sectionCode: null, uploadedBy: "u1", ...o });
const rows = [
  p("bank-statement.pdf", { reference: "C6-F1", sectionCode: "C6" }),
  p("engagement-letter.pdf"),
  p("debtors.xlsx", { targetKind: "lead_sheet", reference: "C5-F1", description: "Debtors listing at year end" }),
  p("confirmation-reply.pdf", { targetKind: "procedure" }),
  p("board-minutes.pdf", { description: "Signed minutes" }),
  p("fixed-assets.xlsx", { targetKind: "lead_sheet" }),
];
const names = (x: { rows: PaperLike[] }) => x.rows.map((r) => r.fileName);

describe("what counts as not filed", () => {
  it("is a general file with no section, and never a lead sheet or procedure file", () => {
    expect(isNotFiled(rows[1])).toBe(true);
    expect(isNotFiled(rows[0])).toBe(false);
    expect(isNotFiled(rows[2])).toBe(false);
    expect(isNotFiled(rows[3])).toBe(false);
  });
});

describe("filters", () => {
  it("keeps the given order and shows everything by default", () => {
    expect(filterPapers(rows).shown).toBe(6);
  });
  it("shows each chip", () => {
    expect(names(filterPapers(rows, { show: "notfiled" }))).toEqual(["engagement-letter.pdf", "board-minutes.pdf"]);
    expect(names(filterPapers(rows, { show: "noreference" }))).toEqual(["engagement-letter.pdf", "confirmation-reply.pdf", "board-minutes.pdf", "fixed-assets.xlsx"]);
    expect(names(filterPapers(rows, { show: "leadsheet" }))).toEqual(["debtors.xlsx", "fixed-assets.xlsx"]);
    expect(names(filterPapers(rows, { show: "procedure" }))).toEqual(["confirmation-reply.pdf"]);
  });
  it("searches the file name or the description, in any case", () => {
    expect(names(filterPapers(rows, { q: "MINUTES" }))).toEqual(["board-minutes.pdf"]);
    expect(names(filterPapers(rows, { q: "year end" }))).toEqual(["debtors.xlsx"]);
    expect(names(filterPapers(rows, { q: ".xlsx" }))).toEqual(["debtors.xlsx", "fixed-assets.xlsx"]);
  });
  it("combines a chip with a search, and gives nothing rather than failing", () => {
    expect(names(filterPapers(rows, { show: "leadsheet", q: "fixed" }))).toEqual(["fixed-assets.xlsx"]);
    expect(filterPapers(rows, { show: "procedure", q: "bank" })).toMatchObject({ rows: [], shown: 0, total: 6 });
    expect(filterPapers([], {})).toMatchObject({ shown: 0, total: 0 });
  });
  it("counts the chips with the search applied", () => {
    expect(paperCounts(rows)).toEqual({ all: 6, notfiled: 2, noreference: 4, leadsheet: 2, procedure: 1 });
    expect(paperCounts(rows, "pdf")).toEqual({ all: 4, notfiled: 2, noreference: 3, leadsheet: 0, procedure: 1 });
  });
  it("reads the address", () => {
    for (const v of ["notfiled", "noreference", "leadsheet", "procedure"]) expect(parsePapersShow(v)).toBe(v);
    expect(parsePapersShow("x")).toBe("");
    expect(parsePapersShow(undefined)).toBe("");
    expect(parsePapersShow(["procedure", "leadsheet"])).toBe("procedure");
    expect(parsePapersSearch("  a ")).toBe("a");
    expect(parsePapersSearch("x".repeat(300))).toHaveLength(100);
  });
});

describe("words", () => {
  it("writes the header sentence", () => {
    expect(papersSentence(rows)).toBe("6 files: 2 with an index reference, 2 not filed.");
    expect(papersSentence([p("a.pdf", { reference: "C1-F1", sectionCode: "C1" })])).toBe("1 file: 1 with an index reference.");
    expect(papersSentence([])).toBe("No files yet.");
  });
  it("says where a file is filed", () => {
    expect(filingText(p("a", { sectionCode: "C6" }))).toBe("Filed under C6");
    expect(filingText(p("a"))).toBe("Not filed");
    expect(filingText(p("a", { targetKind: "lead_sheet" }))).toBe("Filed with its lead sheet");
    expect(filingText(p("a", { targetKind: "procedure" }))).toBe("Filed with its procedure");
  });
  it("counts the results and sizes a file", () => {
    expect(paperResults(2, 6)).toBe("Showing 2 of 6 files.");
    expect(paperResults(1, 1)).toBe("Showing 1 of 1 file.");
    expect(fileSize(500)).toBe("500 B");
    expect(fileSize(2048)).toBe("2 KB");
    expect(fileSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("a file's controls", () => {
  const ctx = (role: "preparer" | "reviewer" | "partner", o: { open?: boolean; userId?: string } = {}) => ({ open: true, role, userId: "u1", ...o });
  it("offers filing to anyone, with the section select only for a general file", () => {
    expect(paperControls(p("a"), ctx("preparer"))).toMatchObject({ filing: true, sectionSelect: true });
    expect(paperControls(p("a", { targetKind: "lead_sheet" }), ctx("preparer"))).toMatchObject({ filing: true, sectionSelect: false });
    expect(paperControls(p("a", { targetKind: "procedure" }), ctx("preparer"))).toMatchObject({ filing: true, sectionSelect: false });
  });
  it("offers a new version to anyone while the engagement is open", () => {
    for (const role of ["preparer", "reviewer", "partner"] as const) expect(paperControls(p("a"), ctx(role, { userId: "u2" })).newVersion).toBe(true);
  });
  it("lets the uploader, or a reviewer or partner, remove a file", () => {
    expect(paperControls(p("a"), ctx("preparer")).remove).toBe(true);
    expect(paperControls(p("a"), ctx("preparer", { userId: "u2" })).remove).toBe(false);
    expect(paperControls(p("a"), ctx("reviewer", { userId: "u2" })).remove).toBe(true);
    expect(paperControls(p("a"), ctx("partner", { userId: "u2" })).remove).toBe(true);
  });
  it("offers nothing on a locked engagement", () => {
    for (const role of ["preparer", "reviewer", "partner"] as const) expect(paperControls(p("a"), ctx(role, { open: false }))).toEqual({ filing: false, sectionSelect: false, remove: false, newVersion: false });
  });
});
