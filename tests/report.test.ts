import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildReport, OPINION_KINDS, OPINION_LABEL, REPORT, REPORT_NOTICE, reportProblems, type OpinionKind, type ReportInput } from "../src/domain/report";
import { fill, type Block } from "../src/domain/letters";

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}
const text = (blocks: Block[]) =>
  blocks
    .flatMap((b) => (b.kind === "signature" ? b.lines : b.kind === "table" ? [b.header.join(" | "), ...b.rows.map((r) => r.join(" | "))] : [b.text]))
    .join("\n");
const headings = (blocks: Block[]) => blocks.filter((b) => b.kind === "heading").map((b) => (b as { text: string }).text);

const base: ReportInput = {
  clientName: "Falcon Trading LLC",
  periodEnd: "2025-12-31",
  framework: "IFRS for SMEs",
  firmName: "Demo Audit Firm",
  partner: "Ada Partner",
  city: "Dubai",
  reportDate: "2026-03-15",
  opinion: "unmodified",
};
const modified = (opinion: OpinionKind): ReportInput => ({ ...base, opinion, basisForModification: "Stock of AED 1.2 million was not counted and could not be verified in other ways." });

describe("report wording", () => {
  const doc = readFileSync("docs/methodology-templates-and-prompt-lists.md", "utf8").replace(/\*\*/g, "").replace(/\s+/g, " ");
  const section = doc.slice(doc.indexOf("## 5. Auditor's report template"));

  it("has a section 5 labelled as an unreviewed draft, and cites the standards by number only", () => {
    expect(doc).toContain("## 5. Auditor's report template (draft, not yet reviewed)");
    expect(doc).toContain("Status: unreviewed draft.");
    expect(doc).toContain("ISA 700, ISA 705, ISA 706 or ISA 570");
    expect(doc).not.toMatch(/ISA 7\d\d[^.]{0,6}paragraph \d/i);
  });

  it("matches the report in the methodology document, sentence for sentence", () => {
    for (const s of strings(REPORT)) expect(section, s).toContain(s);
    expect(section).toContain(REPORT_NOTICE);
  });

  it("says in its code comment and notice that it is an unreviewed draft", () => {
    expect(REPORT_NOTICE).toMatch(/not yet reviewed/);
    expect(readFileSync("src/domain/report.ts", "utf8")).toContain("THE WORDING IS AN UNREVIEWED DRAFT");
  });
});

describe("kinds of opinion", () => {
  it("are the four, each with a label", () => {
    expect([...OPINION_KINDS]).toEqual(["unmodified", "qualified", "adverse", "disclaimer"]);
    for (const k of OPINION_KINDS) expect(OPINION_LABEL[k]).toBeTruthy();
  });
});

describe("building the report", () => {
  it("puts the draft notice first, then the title and addressee", () => {
    const b = buildReport(base);
    expect(b[0]).toEqual({ kind: "para", text: REPORT_NOTICE });
    expect(b[1]).toEqual({ kind: "heading", text: "Independent auditor's report" });
    expect(b[2]).toEqual({ kind: "para", text: "To the shareholders of Falcon Trading LLC" });
  });

  it("words an unmodified opinion with no basis-for-modification paragraph", () => {
    const b = buildReport(base);
    expect(headings(b)).toEqual(["Independent auditor's report", "Opinion", "Basis for opinion", REPORT.management.heading, "Auditor's responsibilities", REPORT.legal.heading]);
    const out = text(b);
    expect(out).toContain("We audited the financial statements of Falcon Trading LLC");
    expect(out).toContain("statement of financial position at 31 December 2025");
    expect(out).toContain("in accordance with IFRS for SMEs.");
    expect(out).toContain("In our opinion the financial statements present fairly");
    expect(out).toContain("sufficient and appropriate as a basis for our opinion.");
    expect(out).not.toContain("except for");
    expect(out).toContain("Our job is to form an opinion");
    expect(out).not.toContain("{");
    expect(out).not.toContain("["+"basis for modification]");
  });

  it("words a qualified opinion with its basis", () => {
    const b = buildReport(modified("qualified"));
    expect(headings(b).slice(1, 3)).toEqual(["Qualified opinion", "Basis for qualified opinion"]);
    const out = text(b);
    expect(out).toContain("except for the effects of the matter described in the Basis for qualified opinion section");
    expect(out).toContain("Stock of AED 1.2 million was not counted");
    expect(out).toContain("sufficient and appropriate as a basis for our qualified opinion.");
    expect(out).toContain("International Standards on Auditing");
  });

  it("words an adverse opinion with its basis", () => {
    const b = buildReport(modified("adverse"));
    expect(headings(b).slice(1, 3)).toEqual(["Adverse opinion", "Basis for adverse opinion"]);
    const out = text(b);
    expect(out).toContain("the financial statements do not present fairly");
    expect(out).toContain("sufficient and appropriate as a basis for our adverse opinion.");
  });

  it("words a disclaimer: no opinion, no statement that the audit met the standards, a shorter responsibilities section", () => {
    const b = buildReport(modified("disclaimer"));
    expect(headings(b).slice(1, 3)).toEqual(["Disclaimer of opinion", "Basis for disclaimer of opinion"]);
    const out = text(b);
    expect(out).toContain("We were engaged to audit the financial statements");
    expect(out).toContain("We do not express an opinion on the financial statements.");
    expect(out).not.toContain("In our opinion");
    expect(out).not.toContain("We carried out this audit under the International Standards on Auditing");
    expect(out).toContain("we could not gather enough appropriate audit evidence");
    expect(out).not.toContain("Our job is to form an opinion");
    expect(out).toContain("We were engaged to audit under the International Standards");
    expect(b.filter((x) => x.kind === "bullet")).toHaveLength(REPORT.management.list.length);
  });

  it("lists the auditor's responsibilities as bullets for the other three kinds", () => {
    for (const k of ["unmodified", "qualified", "adverse"] as const) {
      expect(buildReport(k === "unmodified" ? base : modified(k)).filter((x) => x.kind === "bullet")).toHaveLength(REPORT.management.list.length + REPORT.auditor.list.length);
    }
  });

  it("adds the going-concern section only when asked, with the note reference", () => {
    expect(headings(buildReport(base))).not.toContain(REPORT.goingConcern.heading);
    expect(headings(buildReport({ ...base, goingConcern: null }))).not.toContain(REPORT.goingConcern.heading);
    const b = buildReport({ ...base, goingConcern: { noteReference: "7" } });
    expect(headings(b)).toContain(REPORT.goingConcern.heading);
    expect(text(b)).toContain("Note 7 to the financial statements describes a material uncertainty");
    // The section follows the basis for opinion and comes before the responsibilities.
    const h = headings(b);
    expect(h.indexOf(REPORT.goingConcern.heading)).toBeGreaterThan(h.indexOf("Basis for opinion"));
    expect(h.indexOf(REPORT.goingConcern.heading)).toBeLessThan(h.indexOf(REPORT.management.heading));
  });

  it("adds an emphasis of matter and an other matter only when they have text, in the partner's words", () => {
    expect(headings(buildReport({ ...base, emphasisOfMatter: "  ", otherMatter: "" }))).toEqual(headings(buildReport(base)));
    const b = buildReport({ ...base, emphasisOfMatter: "Note 9 describes a lawsuit whose outcome is not yet known.", otherMatter: "The prior year statements were audited by another firm." });
    const h = headings(b);
    expect(h).toContain("Emphasis of matter");
    expect(h).toContain("Other matter");
    expect(h.indexOf("Emphasis of matter")).toBeLessThan(h.indexOf("Other matter"));
    const out = text(b);
    expect(out).toContain("Note 9 describes a lawsuit whose outcome is not yet known.\nThis matter does not change our opinion.");
    expect(out).toContain("The prior year statements were audited by another firm.");
  });

  it("can carry every optional section at once on a qualified opinion", () => {
    const b = buildReport({ ...modified("qualified"), goingConcern: { noteReference: "7" }, emphasisOfMatter: "E", otherMatter: "O" });
    expect(headings(b)).toEqual(["Independent auditor's report", "Qualified opinion", "Basis for qualified opinion", REPORT.goingConcern.heading, "Emphasis of matter", "Other matter", REPORT.management.heading, "Auditor's responsibilities", REPORT.legal.heading]);
  });

  it("has the other-legal-requirements placeholder and the signature block, last", () => {
    const b = buildReport(base);
    expect(text(b)).toContain("[Complete as required by local law]");
    expect(text(b)).not.toMatch(/Federal|Law No|Commercial Companies/);
    expect(b[b.length - 1]).toEqual({ kind: "signature", lines: ["Demo Audit Firm", "Ada Partner", "Dubai", "15 March 2026"] });
  });

  it("leaves missing values as [the field name] for completion", () => {
    const b = buildReport({ clientName: "", periodEnd: "", framework: "", firmName: " ", partner: "", city: "", reportDate: "", opinion: "qualified", goingConcern: {} });
    const out = text(b);
    for (const f of ["client name", "period end", "framework", "firm name", "engagement partner", "city", "report date", "basis for modification", "note reference"]) expect(out).toContain(`[${f}]`);
    expect(out).not.toContain("{");
    expect(fill("{x}", {})).toBe("[x]");
  });

  it("keeps a date that is not in the 2025-12-31 form as typed", () => {
    expect(text(buildReport({ ...base, periodEnd: "year ended 31 December 2025", reportDate: "15 March 2026" }))).toContain("statement of financial position at year ended 31 December 2025");
  });
});

describe("problems", () => {
  it("has none for a complete report of any kind", () => {
    expect(reportProblems(base)).toEqual([]);
    for (const k of ["qualified", "adverse", "disclaimer"] as const) expect(reportProblems(modified(k))).toEqual([]);
    expect(reportProblems({ ...base, goingConcern: { noteReference: "7" }, emphasisOfMatter: "x", otherMatter: "y" })).toEqual([]);
  });

  it("asks for the basis of any modified opinion", () => {
    for (const k of ["qualified", "adverse", "disclaimer"] as const) {
      const p = reportProblems({ ...base, opinion: k, basisForModification: "  " });
      expect(p).toHaveLength(1);
      expect(p[0]).toContain(OPINION_LABEL[k].toLowerCase());
      expect(p[0]).toContain("basis for the modification");
    }
    expect(reportProblems({ ...base, opinion: "unmodified" })).toEqual([]);
  });

  it("does not allow a disclaimer with a going-concern section or an emphasis of matter, and says the reviewer decides", () => {
    const gc = reportProblems({ ...modified("disclaimer"), goingConcern: { noteReference: "7" } });
    expect(gc).toHaveLength(1);
    expect(gc[0]).toMatch(/going-concern/);
    expect(gc[0]).toMatch(/reviewer decides/);
    const em = reportProblems({ ...modified("disclaimer"), emphasisOfMatter: "Something" });
    expect(em).toHaveLength(1);
    expect(em[0]).toMatch(/emphasis of matter/);
    expect(em[0]).toMatch(/reviewer decides/);
    expect(reportProblems({ ...modified("disclaimer"), emphasisOfMatter: "  " })).toEqual([]);
    // A going-concern section on a qualified or adverse opinion is allowed in this draft.
    expect(reportProblems({ ...modified("adverse"), goingConcern: {} })).toEqual([]);
  });

  it("asks for the report date", () => {
    expect(reportProblems({ ...base, reportDate: "" })).toEqual(["Enter the date of the report."]);
    expect(reportProblems({ ...base, reportDate: "   " })).toEqual(["Enter the date of the report."]);
  });

  it("reports several problems together and rejects an unknown kind", () => {
    expect(reportProblems({ ...base, opinion: "disclaimer", goingConcern: {}, reportDate: "" })).toHaveLength(3);
    expect(reportProblems({ ...base, opinion: "other" as OpinionKind })[0]).toMatch(/Choose the kind of opinion/);
  });
});
