import { describe, expect, it } from "vitest";
import { buildStatementPack, type PackAccount } from "../src/domain/statement-pack";
import { buildStatementsDocx } from "../src/server/statements-docx";
import { formatPresentation } from "../src/domain/money";

const acct = (code: string, groupCode: string, name: string, closingMinor: number, priorMinor: number): PackAccount => ({ code, name, groupCode, closingMinor, priorMinor, approved: true });
const BOOKS = [
  acct("1", "CASH", "Bank", 150000, 100000),
  acct("2", "CAPITAL", "Share capital", -100000, -100000),
  acct("3", "REVENUE", "Sales", -90000, -40000),
  acct("4", "ADMIN", "Rent", 30000, 30000),
  acct("5", "ADMIN", "Utilities", 10000, 10000),
];

describe("presentation format", () => {
  it("shows whole units without decimals and never prints a negative zero", () => {
    expect(formatPresentation(123456, 100)).toBe("1,235");
    expect(formatPresentation(-123456, 100)).toBe("(1,235)");
    expect(formatPresentation(-40, 100)).toBe("0");
    expect(formatPresentation(-123456, 1)).toBe("(1,234.56)");
  });
});

describe("Word export", () => {
  it("produces a Word document containing every statement", async () => {
    const pack = buildStatementPack(BOOKS, { unitMinor: 100 });
    expect(pack.clean).toBe(true);
    const buffer = await buildStatementsDocx({ clientName: "Export Co <Test> & Sons", periodStart: "2025-01-01", periodEnd: "2025-12-31", pack, draft: true });
    // A .docx file is a zip archive.
    expect(buffer.subarray(0, 2).toString()).toBe("PK");
    expect(buffer.length).toBeGreaterThan(5000);

    // Read the main document part out of the archive to check the content.
    const { default: JSZip } = await import("jszip");
    const xml = await (await JSZip.loadAsync(buffer)).file("word/document.xml")!.async("string");
    for (const text of [
      "Statement of financial position",
      "Statement of comprehensive income",
      "Statement of changes in equity",
      "Statement of cash flows",
      "Notes to the financial statements",
      "DRAFT",
      "General and administrative expenses",
      "1,500",
    ]) {
      expect(xml, text).toContain(text);
    }
    // The client's name is escaped, not injected as markup.
    expect(xml).toContain("Export Co &lt;Test&gt; &amp; Sons");
  });

  it("omits the draft warning for an approved file and the comparative-only statements without prior figures", async () => {
    const pack = buildStatementPack(BOOKS.map((a) => ({ ...a, priorMinor: null })));
    const buffer = await buildStatementsDocx({ clientName: "No Prior Co", periodStart: "2025-01-01", periodEnd: "2025-12-31", pack, draft: false });
    const { default: JSZip } = await import("jszip");
    const xml = await (await JSZip.loadAsync(buffer)).file("word/document.xml")!.async("string");
    expect(xml).not.toContain("DRAFT");
    expect(xml).not.toContain("Statement of cash flows");
    expect(xml).toContain("Statement of financial position");
  });
});
