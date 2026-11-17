import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import type { Db } from "../src/server/db";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import { recordOpinion } from "../src/server/opinion";
import { buildStatementPack } from "../src/domain/statement-pack";
import { statementsDocument } from "../src/domain/statements-document";
import { REPORT_NOTICE } from "../src/domain/report";
import { pdfText } from "./pdf-text";

// The routes read the signed-in user and the database from the request; stand in for both.
let db: Db;
let current: repo.Session;
vi.mock("../src/server/session", () => ({ getSession: async () => current, getOptionalSession: async () => current }));
vi.mock("../src/server/db", async (original) => {
  const real = await original<typeof import("../src/server/db")>();
  return { ...real, getDb: async () => db };
});

const FIRM = "aaaaaaaa-2020-4000-8000-000000000001";
const OTHER = "bbbbbbbb-2020-4000-8000-000000000001";
const user = (n: number, role: repo.Session["role"], firmId = FIRM): repo.Session => ({ firmId, userId: `${firmId.slice(0, 8)}-2020-4000-8000-00000000001${n}`, role });
const prep = user(1, "preparer");
const partner = user(3, "partner");
const outsider = user(5, "partner", OTHER);
const TB = [
  { code: "1000", name: "Bank - current account", closingMinor: 15000012, priorMinor: 10000000 },
  { code: "3000", name: "Share capital", closingMinor: -5000000, priorMinor: -5000000 },
  { code: "4000", name: "Sales", closingMinor: -10000012, priorMinor: 0 },
];
let engagement: string;
type T = Parameters<Parameters<typeof withFirm>[2]>[0];
const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const entries = async (action: string) => (await db.query<{ user_id: string; detail: Record<string, unknown> | null }>("select user_id, detail from audit_log where action = $1 and entity_id = $2 order by id", [action, engagement])).rows;

beforeAll(async () => {
  db = await openDatabase();
  for (const f of [FIRM, OTHER]) await db.query("insert into firms (id, name) values ($1, 'Demo Audit Firm')", [f]);
  for (const u of [prep, partner, outsider]) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, `${u.role} user`, u.role]);
  await as(partner, async (tx) => {
    const client = await repo.createClient(tx, partner, "Falcon Trading LLC");
    engagement = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
    await repo.importTrialBalance(tx, partner, engagement, "tb.xlsx", TB);
    await repo.approveAllMappings(tx, partner, engagement);
  });
  current = partner;
});

afterAll(async () => {
  await db.close();
});

describe("the statements PDF route", () => {
  it("downloads a PDF for anyone in the firm, named like the Word file, and logs it with its format", async () => {
    const { GET } = await import("../src/app/(app)/engagements/[id]/statements/pdf/route");
    current = prep;
    const res = await GET(new Request("http://localhost/x"), ctx(engagement));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="Falcon-Trading-LLC-financial-statements-2025-12-31.pdf"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    const log = await entries("export");
    expect(log.at(-1)).toEqual({ user_id: prep.userId, detail: { format: "pdf" } });
  });

  it("is not found for another firm, an unknown engagement and a bad id, and logs nothing for them", async () => {
    const { GET } = await import("../src/app/(app)/engagements/[id]/statements/pdf/route");
    const before = (await entries("export")).length;
    current = outsider;
    expect((await GET(new Request("http://localhost/x"), ctx(engagement))).status).toBe(404);
    current = partner;
    expect((await GET(new Request("http://localhost/x"), ctx("dddddddd-2020-4000-8000-000000000001"))).status).toBe(404);
    expect((await GET(new Request("http://localhost/x"), ctx("not-an-id"))).status).toBe(404);
    expect((await entries("export")).length).toBe(before);
  });

  it("shows the same lines and figures as the Word download, in cents and, with ?units=whole, in whole units", async () => {
    const pdfRoute = await import("../src/app/(app)/engagements/[id]/statements/pdf/route");
    const wordRoute = await import("../src/app/(app)/engagements/[id]/statements/export/route");
    current = partner;
    const accounts = await as(partner, (tx) => repo.listAccounts(tx, engagement));
    const e = (await as(partner, (tx) => repo.getEngagement(tx, engagement)))!;
    for (const whole of [false, true]) {
      const url = `http://localhost/x${whole ? "?units=whole" : ""}`;
      // A long label wraps onto several lines of the PDF, so read the line breaks as spaces.
      const pdf = pdfText(Buffer.from(await (await pdfRoute.GET(new Request(url), ctx(engagement))).arrayBuffer())).replace(/\s+/g, " ");
      const wordRes = await wordRoute.GET(new Request(url), ctx(engagement));
      expect(wordRes.headers.get("content-disposition")).toContain(".docx");
      const xml = (await (await JSZip.loadAsync(Buffer.from(await wordRes.arrayBuffer()))).file("word/document.xml")!.async("string")).replace(/<[^>]+>/g, "|").replace(/&amp;/g, "&");
      const pack = buildStatementPack(accounts.map((a) => ({ ...a, closingMinor: a.closingMinor + a.adjustmentMinor })), { unitMinor: whole ? 100 : 1, borrowingsCurrent: { current: e.borrowingsCurrentMinor, prior: e.borrowingsCurrentPriorMinor } });
      let rows = 0;
      for (const b of statementsDocument({ clientName: e.clientName, periodStart: e.periodStart, periodEnd: e.periodEnd, pack, draft: true })) {
        if (b.kind !== "figures") continue;
        for (const r of b.rows) {
          for (const s of [r.label, ...r.figures].filter((x) => x !== "")) {
            expect(pdf, `PDF ${s}`).toContain(s);
            expect(xml, `Word ${s}`).toContain(s);
          }
          rows++;
        }
      }
      expect(rows).toBeGreaterThan(20);
      expect(pdf).toContain("DRAFT: these statements");
    }
  });
});

describe("the auditor's report PDF", () => {
  const post = (fields: Record<string, string>, headers: Record<string, string> = {}) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    return new Request("http://localhost/x", { method: "POST", body: form, headers });
  };

  it("is refused with no opinion recorded, in either format, and logs nothing", async () => {
    const { POST } = await import("../src/app/(app)/engagements/[id]/audit/report/download/route");
    await as(partner, (tx) => audit.setAuditEnabled(tx, partner, engagement, true));
    current = partner;
    for (const format of ["pdf", "docx"]) {
      const res = await POST(post({ format }), ctx(engagement));
      expect(res.status).toBe(409);
      expect(await res.text()).toContain("No audit opinion is recorded yet");
    }
    expect(await entries("download_report")).toHaveLength(0);
  });

  it("downloads a PDF with the notice first, the opinion heading and the basis, and logs the format", async () => {
    const { POST } = await import("../src/app/(app)/engagements/[id]/audit/report/download/route");
    await as(partner, (tx) =>
      recordOpinion(tx, partner, engagement, { opinion: "qualified", basisForModification: "Stock of AED 12,000.00 was not counted.", goingConcern: false, goingConcernNote: "", emphasisOfMatter: "", otherMatter: "", reportDate: "2026-03-15" }),
    );
    current = prep;
    const res = await POST(post({ format: "pdf", partner: "Bea Partner", city: "Dubai" }), ctx(engagement));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="Auditors-report-Falcon-Trading-LLC-2025-12-31-draft.pdf"');
    const text = pdfText(Buffer.from(await res.arrayBuffer())).replace(/\s+/g, " ");
    expect(text.indexOf(REPORT_NOTICE)).toBe(0);
    expect(text).toContain("Qualified opinion We audited the financial statements");
    expect(text).toContain("Stock of AED 12,000.00 was not counted.");
    expect(text).toContain("Bea Partner");
    expect(text).toContain("Dubai");
    expect(text).toContain("15 March 2026");
    expect((await entries("download_report")).at(-1)).toEqual({ user_id: prep.userId, detail: { opinion: "qualified", format: "pdf" } });
  });

  it("still gives the Word file when no format, or Word, is asked for, and logs that", async () => {
    const { POST } = await import("../src/app/(app)/engagements/[id]/audit/report/download/route");
    current = partner;
    const res = await POST(post({ partner: "Bea Partner" }), ctx(engagement));
    expect(res.headers.get("content-type")).toContain("wordprocessingml");
    expect(res.headers.get("content-disposition")).toContain(".docx");
    expect((await entries("download_report")).at(-1)?.detail).toEqual({ opinion: "qualified", format: "docx" });
  });

  it("refuses a post from another site, and another firm's engagement", async () => {
    const { POST } = await import("../src/app/(app)/engagements/[id]/audit/report/download/route");
    current = partner;
    expect((await POST(post({ format: "pdf" }, { origin: "https://evil.example", "x-forwarded-host": "localhost" }), ctx(engagement))).status).toBe(403);
    current = outsider;
    expect((await POST(post({ format: "pdf" }), ctx(engagement))).status).toBe(404);
  });
});
