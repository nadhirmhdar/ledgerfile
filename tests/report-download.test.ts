import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { assembleReportInput, reportFileName, type ReportFacts } from "../src/server/report-download";
import type { AuditOpinion } from "../src/server/opinion";
import { buildLetterDocx } from "../src/server/letters-docx";
import { docxResponse, plainName, sameHost, sameOriginPost } from "../src/server/http";
import { buildReport, REPORT_NOTICE } from "../src/domain/report";
import { DOWNLOAD_BEFORE, DOWNLOAD_NOTE, noticeBody, NOTICE_TITLE } from "../src/ui/opinion-view";

const facts: ReportFacts = { clientName: "Falcon Trading LLC", periodEnd: "2025-12-31", framework: "IFRS for SMEs", firmName: "Demo Audit Firm" };
const opinion = (over: Partial<AuditOpinion> = {}): AuditOpinion => ({
  opinion: "unmodified",
  basisForModification: null,
  goingConcernNote: null,
  emphasisOfMatter: null,
  otherMatter: null,
  reportDate: "2026-03-15",
  decidedBy: "u1",
  decidedByName: "Ada Partner",
  decidedAt: "2026-03-10",
  ...over,
});

describe("assembling the report's input", () => {
  it("takes the engagement, the recorded opinion and the form, with the partner defaulting to whoever recorded the opinion", () => {
    const a = assembleReportInput(facts, opinion(), {});
    expect(a).toEqual({
      ok: true,
      input: {
        clientName: "Falcon Trading LLC",
        periodEnd: "2025-12-31",
        framework: "IFRS for SMEs",
        firmName: "Demo Audit Firm",
        partner: "Ada Partner",
        city: "",
        reportDate: "2026-03-15",
        opinion: "unmodified",
        basisForModification: undefined,
        goingConcern: null,
        emphasisOfMatter: undefined,
        otherMatter: undefined,
      },
    });
  });

  it("uses the partner and city typed on the form, tidied", () => {
    const a = assembleReportInput(facts, opinion(), { partner: "  Bea   Partner ", city: " Abu  Dhabi " });
    expect(a.ok && a.input).toMatchObject({ partner: "Bea Partner", city: "Abu Dhabi" });
    const blank = assembleReportInput(facts, opinion(), { partner: "   ", city: "" });
    expect(blank.ok && blank.input.partner).toBe("Ada Partner");
  });

  it("carries the modification, going concern, emphasis and other matter from the row", () => {
    const a = assembleReportInput(facts, opinion({ opinion: "qualified", basisForModification: "Stock was not counted.", goingConcernNote: "7", emphasisOfMatter: "A claim.", otherMatter: "Prior year." }), {});
    expect(a.ok && a.input).toMatchObject({ opinion: "qualified", basisForModification: "Stock was not counted.", goingConcern: { noteReference: "7" }, emphasisOfMatter: "A claim.", otherMatter: "Prior year." });
  });

  it("refuses with a plain message when no opinion is recorded", () => {
    expect(assembleReportInput(facts, null, {})).toEqual({ ok: false, message: "No audit opinion is recorded yet. The report can be downloaded once the partner records the opinion." });
  });

  it("refuses a row that would give a report with problems", () => {
    const a = assembleReportInput(facts, opinion({ opinion: "qualified", basisForModification: null }), {});
    expect(a.ok).toBe(false);
    expect(!a.ok && a.message).toMatch(/cannot be turned into a report yet.*basis for the modification/);
    const undated = assembleReportInput(facts, opinion({ reportDate: null }), {});
    expect(!undated.ok && undated.message).toMatch(/date of the report/);
  });

  it("leaves a blank city as a placeholder in the report", () => {
    const a = assembleReportInput(facts, opinion(), {});
    if (!a.ok) throw new Error("expected input");
    const last = buildReport(a.input).at(-1)!;
    expect(last).toEqual({ kind: "signature", lines: ["Demo Audit Firm", "Ada Partner", "[city]", "15 March 2026"] });
  });
});

describe("the file name and the helpers the downloads share", () => {
  it("uses plain characters only", () => {
    expect(reportFileName("Falcon Trading LLC", "2025-12-31")).toBe("Auditors-report-Falcon-Trading-LLC-2025-12-31-draft.docx");
    expect(reportFileName('Bad"; name\r\nX-Evil: 1', "2025-12-31")).toMatch(/^[A-Za-z0-9.-]+$/);
    expect(plainName("!!!")).toBe("client");
  });
  it("refuses a post from another site and accepts one from this host or with no Origin", () => {
    expect(sameHost("https://app.example.test", "app.example.test")).toBe(true);
    expect(sameHost("null", "app.example.test")).toBe(false);
    const post = (headers: Record<string, string>) => new Request("https://app.example.test/x", { method: "POST", headers });
    expect(sameOriginPost(post({ host: "app.example.test" }))).toBe(true);
    expect(sameOriginPost(post({ origin: "https://app.example.test", host: "app.example.test" }))).toBe(true);
    expect(sameOriginPost(post({ origin: "https://evil.test", host: "app.example.test" }))).toBe(false);
    expect(sameOriginPost(post({ origin: "https://app.example.test", host: "internal:3000", "x-forwarded-host": "app.example.test" }))).toBe(true);
  });
  it("sends Word as an attachment that is never cached", () => {
    const r = docxResponse(Buffer.from("x"), "a.docx");
    expect(r.headers.get("content-disposition")).toBe('attachment; filename="a.docx"');
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("content-type")).toContain("wordprocessingml");
  });
});

describe("the page's words", () => {
  it("shows the draft title once: the callout body is what follows the notice's first sentence", () => {
    expect(NOTICE_TITLE).toBe("Draft wording, not yet reviewed.");
    const body = noticeBody(REPORT_NOTICE);
    expect(body.startsWith("Check it against ISA 700, 705, 706 and 570")).toBe(true);
    expect(body).not.toMatch(/not yet reviewed/);
    expect(body.startsWith("[")).toBe(false);
    expect(body.endsWith("]")).toBe(false);
  });
  it("has a line for before and after an opinion is recorded", () => {
    expect(DOWNLOAD_BEFORE).toMatch(/once the partner records the opinion/);
    expect(DOWNLOAD_NOTE).toMatch(/unreviewed draft to check and complete in Word/);
  });
});

describe("the Word file", () => {
  const xmlOf = async (input: Parameters<typeof buildReport>[0]) => {
    const buffer = await buildLetterDocx("Report", buildReport(input));
    return (await (await JSZip.loadAsync(buffer)).file("word/document.xml")!.async("string")).replace(/<[^>]+>/g, "|").replace(/\|+/g, "|").replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  };
  const base = { clientName: "Falcon Trading LLC", periodEnd: "2025-12-31", framework: "IFRS for SMEs", firmName: "Demo Audit Firm", partner: "Ada Partner", city: "Dubai", reportDate: "2026-03-15" };

  it("starts with the draft notice, then the title", async () => {
    const x = await xmlOf({ ...base, opinion: "unmodified" });
    expect(x.indexOf(REPORT_NOTICE)).toBeGreaterThan(-1);
    expect(x.indexOf(REPORT_NOTICE)).toBeLessThan(x.indexOf("Independent auditor's report"));
    expect(x).toContain("To the shareholders of Falcon Trading LLC");
  });

  it("has the opinion heading for each kind, and the partner's basis text for a modified one", async () => {
    const headings: Record<string, string> = { unmodified: "|Opinion|", qualified: "|Qualified opinion|", adverse: "|Adverse opinion|", disclaimer: "|Disclaimer of opinion|" };
    for (const kind of ["unmodified", "qualified", "adverse", "disclaimer"] as const) {
      const x = await xmlOf({ ...base, opinion: kind, basisForModification: kind === "unmodified" ? undefined : "Stock of AED 12,000.00 was not counted." });
      expect(x, kind).toContain(headings[kind]);
      if (kind === "unmodified") expect(x).not.toContain("Stock of AED 12,000.00");
      else expect(x, kind).toContain("Stock of AED 12,000.00 was not counted.");
    }
  });

  it("has the going-concern section only when recorded, with its note", async () => {
    expect(await xmlOf({ ...base, opinion: "unmodified" })).not.toContain("Material uncertainty related to going concern");
    const x = await xmlOf({ ...base, opinion: "unmodified", goingConcern: { noteReference: "7" } });
    expect(x).toContain("Material uncertainty related to going concern");
    expect(x).toContain("Note 7 to the financial statements");
  });

  it("holds the signature block and the report date in words, and brackets what is missing", async () => {
    const x = await xmlOf({ ...base, city: "", opinion: "unmodified" });
    expect(x).toContain("15 March 2026");
    expect(x).toContain("[city]");
    expect(x).toContain("[Complete as required by local law]");
  });
});
