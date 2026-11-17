import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as auth from "../src/server/auth";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import { recordOpinion } from "../src/server/opinion";
import { removeLogo, updateBranding, uploadLogo } from "../src/server/branding";
import { REPORT_NOTICE } from "../src/domain/report";
import { LETTER_NOTICE } from "../src/domain/letters";
import { pdfPages } from "./pdf-text";
import { makePng } from "./image-fixtures";

// The routes read the signed-in user, the database and the file store from the request; stand in for them.
const mem = vi.hoisted(() => ({ files: new Map<string, Uint8Array>() }));
let db: Db;
let current: repo.Session;
vi.mock("../src/server/session", () => ({ getSession: async () => current, getOptionalSession: async () => current }));
vi.mock("../src/server/db", async (original) => {
  const real = await original<typeof import("../src/server/db")>();
  return { ...real, getDb: async () => db };
});
vi.mock("../src/server/file-store", async (original) => {
  const real = await original<typeof import("../src/server/file-store")>();
  return {
    ...real,
    getFileStore: () => ({
      put: async (k: string, d: Uint8Array) => void mem.files.set(k, d),
      get: async (k: string) => mem.files.get(k) ?? null,
      remove: async (k: string) => void mem.files.delete(k),
    }),
  };
});

const FIRM = "aaaaaaaa-4040-4000-8000-000000000001";
const admin: auth.AuthSession = { firmId: FIRM, userId: "aaaaaaaa-4040-4000-8000-000000000011", name: "Ada Admin", email: "ada@x.test", role: "admin", firmName: "Demo Audit Firm" };
const partner: repo.Session = { firmId: FIRM, userId: "aaaaaaaa-4040-4000-8000-000000000012", role: "partner" };
const TB = [
  { code: "1000", name: "Bank - current account", closingMinor: 15000012, priorMinor: 10000000 },
  { code: "3000", name: "Share capital", closingMinor: -5000000, priorMinor: -5000000 },
  { code: "4000", name: "Sales", closingMinor: -10000012, priorMinor: 0 },
];
let engagement: string;
const ctx = (extra: { kind?: string } = {}) => ({ params: Promise.resolve({ id: engagement, kind: extra.kind ?? "" }) });
const post = (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new Request("http://localhost/x", { method: "POST", body: form });
};

interface Docx {
  xml: string;
  names: string[];
}
const readDocx = async (res: Response): Promise<Docx> => {
  expect(res.status).toBe(200);
  const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
  return { xml: await zip.file("word/document.xml")!.async("string"), names: Object.keys(zip.files) };
};
const text = (xml: string) => xml.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|").replace(/&amp;/g, "&").replace(/&apos;/g, "'");
const pdfOf = async (res: Response) => {
  expect(res.status).toBe(200);
  const buffer = Buffer.from(await res.arrayBuffer());
  return { raw: buffer.toString("latin1"), pages: pdfPages(buffer), flat: pdfPages(buffer).flat().join("\n").replace(/\s+/g, " ") };
};

async function everything() {
  const statementsPdf = (await import("../src/app/(app)/engagements/[id]/statements/pdf/route")).GET;
  const statementsDocx = (await import("../src/app/(app)/engagements/[id]/statements/export/route")).GET;
  const letters = (await import("../src/app/(app)/engagements/[id]/audit/letters/[kind]/route")).POST;
  const report = (await import("../src/app/(app)/engagements/[id]/audit/report/download/route")).POST;
  current = partner;
  return {
    statementsDocx: await readDocx(await statementsDocx(new Request("http://localhost/x"), ctx())),
    statementsPdf: await pdfOf(await statementsPdf(new Request("http://localhost/x"), ctx())),
    engagementLetter: await readDocx(await letters(post({}), ctx({ kind: "engagement" }))),
    representationLetter: await readDocx(await letters(post({}), ctx({ kind: "representation" }))),
    reportDocx: await readDocx(await report(post({ format: "docx", partner: "Bea Partner", city: "Dubai" }), ctx())),
    reportPdf: await pdfOf(await report(post({ format: "pdf", partner: "Bea Partner", city: "Dubai" }), ctx())),
  };
}

beforeAll(async () => {
  db = await openDatabase();
  await db.query("insert into firms (id, name) values ($1, 'Demo Audit Firm')", [FIRM]);
  for (const u of [admin, partner]) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, FIRM, `${u.userId}@x.test`, "name" in u ? u.name : "Pat Partner", u.role]);
  await withFirm(db, FIRM, async (tx) => {
    const client = await repo.createClient(tx, partner, "Falcon Trading LLC");
    engagement = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
    await repo.importTrialBalance(tx, partner, engagement, "tb.xlsx", TB);
    await repo.approveAllMappings(tx, partner, engagement);
    await audit.setAuditEnabled(tx, partner, engagement, true);
    await recordOpinion(tx, partner, engagement, { opinion: "unmodified", basisForModification: "", goingConcern: false, goingConcernNote: "", emphasisOfMatter: "", otherMatter: "", reportDate: "2026-03-15" });
  });
});

afterAll(async () => {
  await db.close();
});

describe("branding on the downloads", () => {
  let baseline: Awaited<ReturnType<typeof everything>>;

  it("with no branding set, shows no logo, no firm header and no extra lines anywhere", async () => {
    baseline = await everything();
    for (const d of [baseline.statementsDocx, baseline.engagementLetter, baseline.representationLetter, baseline.reportDocx]) {
      expect(d.xml).not.toContain("<w:drawing>");
      expect(d.names.filter((n) => /header|media/.test(n))).toEqual([]);
    }
    for (const p of [baseline.statementsPdf, baseline.reportPdf]) expect(p.raw).not.toContain("/Subtype /Image");
    expect(text(baseline.engagementLetter.xml)).toContain("Demo Audit Firm");
    expect(baseline.reportPdf.pages[0][0]).toContain("[Draft report wording");
    expect(baseline.statementsPdf.flat).not.toContain("Demo Audit Firm");
  });

  it("with branding set, brands the engagement letter, the report and the statements, and not the representation letter", async () => {
    await updateBranding(db, admin, { address: "Office 12\nBusiness Bay\nDubai", contactLine: "info@demo.test", registrationLine: "Licence 123" });
    await uploadLogo(db, admin, makePng(120, 40), (await import("../src/server/file-store")).getFileStore());
    const branded = await everything();

    // The engagement letter: the logo after the draft notice, then the firm's name, address, contact and registration lines.
    const letter = text(branded.engagementLetter.xml);
    expect(branded.engagementLetter.xml).toContain("<w:drawing>");
    expect(branded.engagementLetter.names.some((n) => n.startsWith("word/media/"))).toBe(true);
    expect(branded.engagementLetter.xml.indexOf("<w:drawing>")).toBeGreaterThan(branded.engagementLetter.xml.indexOf("Draft template wording"));
    expect(letter.indexOf(LETTER_NOTICE.slice(1, 30))).toBeGreaterThan(-1);
    for (const s of ["Demo Audit Firm", "Office 12", "Business Bay", "Dubai", "info@demo.test", "Licence 123"]) expect(letter, s).toContain(s);
    expect(letter.indexOf("Demo Audit Firm")).toBeLessThan(letter.indexOf("Office 12"));
    expect(letter.indexOf("Licence 123")).toBeLessThan(letter.indexOf("To: "));

    // The representation letter is on the client's letterhead: unchanged.
    expect(branded.representationLetter.xml).toBe(baseline.representationLetter.xml);

    // The auditor's report: the logo after the draft notice, and the firm's address and registration line in the signature.
    const report = text(branded.reportDocx.xml);
    expect(branded.reportDocx.xml).toContain("<w:drawing>");
    expect(branded.reportDocx.xml.indexOf("<w:drawing>")).toBeGreaterThan(branded.reportDocx.xml.indexOf("Draft report wording"));
    expect(report.indexOf("Draft report wording")).toBeGreaterThan(-1);
    const signature = report.slice(report.indexOf("Report on other legal and regulatory requirements"));
    for (const s of ["Demo Audit Firm", "Office 12", "Business Bay", "Dubai", "Licence 123", "Bea Partner", "15 March 2026"]) expect(signature, s).toContain(s);
    expect(signature.indexOf("Demo Audit Firm")).toBeLessThan(signature.indexOf("Office 12"));
    expect(signature.indexOf("Licence 123")).toBeLessThan(signature.indexOf("Bea Partner"));
    expect(signature).not.toContain("info@demo.test");
    expect(branded.reportPdf.raw).toContain("/Subtype /Image");
    expect(branded.reportPdf.pages[0][0]).toContain("[Draft report wording");
    expect(branded.reportPdf.flat).toContain("Business Bay Dubai Licence 123 Bea Partner");

    // The statements: a discreet header with the logo and the firm's name, on every page, in Word and PDF.
    expect(branded.statementsDocx.names.some((n) => /^word\/header\d*\.xml$/.test(n))).toBe(true);
    expect(branded.statementsDocx.names.some((n) => n.startsWith("word/media/"))).toBe(true);
    expect(branded.statementsPdf.raw).toContain("/Subtype /Image");
    expect(branded.statementsPdf.pages.length).toBeGreaterThan(1);
    for (const [i, p] of branded.statementsPdf.pages.entries()) expect(p.join(" "), `page ${i + 1}`).toContain("Demo Audit Firm");
    // The statements' own content is untouched by the header (only the section's link to the header part is new).
    const body = (xml: string) => xml.replace(/<w:sectPr>[\s\S]*?<\/w:sectPr>/g, "");
    expect(branded.statementsDocx.xml).toContain("w:headerReference");
    expect(body(branded.statementsDocx.xml)).toBe(body(baseline.statementsDocx.xml));
    expect(branded.statementsPdf.pages.map((p) => p.filter((s) => s !== "Demo Audit Firm"))).toEqual(baseline.statementsPdf.pages);
  });

  it("with a firm that has set only its details, and no logo, shows the lines and no picture", async () => {
    await removeLogo(db, admin, (await import("../src/server/file-store")).getFileStore());
    const noLogo = await everything();
    expect(noLogo.engagementLetter.xml).not.toContain("<w:drawing>");
    expect(text(noLogo.engagementLetter.xml)).toContain("Licence 123");
    expect(noLogo.reportPdf.raw).not.toContain("/Subtype /Image");
    expect(noLogo.statementsPdf.raw).not.toContain("/Subtype /Image");
    expect(noLogo.statementsPdf.flat).toContain("Demo Audit Firm");
    expect(noLogo.statementsDocx.names.some((n) => /^word\/header\d*\.xml$/.test(n))).toBe(true);
  });

  it("after the branding is cleared, every output is exactly as it was before it was set", async () => {
    await updateBranding(db, admin, { address: "", contactLine: "", registrationLine: "" });
    const after = await everything();
    expect(after.statementsDocx.xml).toBe(baseline.statementsDocx.xml);
    expect(after.statementsDocx.names).toEqual(baseline.statementsDocx.names);
    expect(after.engagementLetter.xml).toBe(baseline.engagementLetter.xml);
    expect(after.engagementLetter.names).toEqual(baseline.engagementLetter.names);
    expect(after.representationLetter.xml).toBe(baseline.representationLetter.xml);
    expect(after.reportDocx.xml).toBe(baseline.reportDocx.xml);
    expect(after.reportDocx.names).toEqual(baseline.reportDocx.names);
    expect(after.statementsPdf.pages).toEqual(baseline.statementsPdf.pages);
    expect(after.reportPdf.pages).toEqual(baseline.reportPdf.pages);
    expect(after.statementsPdf.raw).not.toContain("/Subtype /Image");
    expect(REPORT_NOTICE).toBeTruthy();
  });

  it("leaves a logo off the download, rather than failing it, when the file cannot be read", async () => {
    await uploadLogo(db, admin, makePng(120, 40), (await import("../src/server/file-store")).getFileStore());
    mem.files.clear();
    const res = await (await import("../src/app/(app)/engagements/[id]/statements/pdf/route")).GET(new Request("http://localhost/x"), ctx());
    const p = await pdfOf(res);
    expect(p.raw).not.toContain("/Subtype /Image");
    // Nothing else is set, so with the logo unreadable there is nothing to brand with: the statements download as they always did.
    expect(p.flat).not.toContain("Demo Audit Firm");
    expect(p.flat).toContain("Statement of financial position");
  });
});
