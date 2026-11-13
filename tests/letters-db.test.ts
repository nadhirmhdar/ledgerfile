import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import JSZip from "jszip";
import { openDatabase, withFirm } from "../src/server/db";
import * as repo from "../src/server/repo";
import * as audit from "../src/server/audit";
import { generateLetter, getLetterContext } from "../src/server/letters";
import { buildLetterDocx } from "../src/server/letters-docx";
import { longDate, type Block } from "../src/domain/letters";

const text = (blocks: Block[]) =>
  blocks.flatMap((b) => (b.kind === "signature" ? b.lines : b.kind === "table" ? b.rows.map((r) => r.join(" | ")) : [b.text])).join("\n");

describe("long dates", () => {
  it("writes a date out in full, and leaves anything else as typed", () => {
    expect(longDate("2025-12-31")).toBe("31 December 2025");
    expect(longDate("2026-03-01")).toBe("1 March 2026");
    expect(longDate("2025-02-30")).toBe("2025-02-30");
    expect(longDate(" early March ")).toBe("early March");
  });
});

describe("letters for an engagement", () => {
  const FIRM = "aaaaaaaa-6666-4000-8000-000000000001";
  const OTHER = "bbbbbbbb-6666-4000-8000-000000000001";
  const partner: repo.Session = { firmId: FIRM, userId: "aaaaaaaa-6666-4000-8000-000000000011", role: "partner" };
  const outsider: repo.Session = { firmId: OTHER, userId: "bbbbbbbb-6666-4000-8000-000000000011", role: "partner" };
  const TB = [
    { code: "1000", name: "Bank - current account", closingMinor: 15000000, priorMinor: 10000000 },
    { code: "1200", name: "Trade receivables", closingMinor: 5000000, priorMinor: 0 },
    { code: "3000", name: "Share capital", closingMinor: -10000000, priorMinor: -10000000 },
    { code: "4000", name: "Sales", closingMinor: -10000000, priorMinor: 0 },
  ];
  let db: PGlite;
  let engagement: string;
  type T = Parameters<Parameters<typeof withFirm>[2]>[0];
  const as = <R,>(s: repo.Session, fn: (tx: T) => Promise<R>) => withFirm(db, s.firmId, fn);

  beforeAll(async () => {
    db = await openDatabase();
    await db.query("insert into firms (id, name) values ($1, $2), ($3, $4)", [FIRM, "Al Noor Auditing", OTHER, "Other Firm"]);
    for (const u of [partner, outsider]) await db.query("insert into users (id, firm_id, email, name, role) values ($1, $2, $3, $4, $5)", [u.userId, u.firmId, `${u.userId}@x.test`, "Partner", u.role]);
    await as(partner, async (tx) => {
      const client = await repo.createClient(tx, partner, "Letter Co LLC");
      engagement = await repo.createEngagement(tx, partner, client, "2025-01-01", "2025-12-31");
      await repo.importTrialBalance(tx, partner, engagement, "tb.xlsx", TB);
      await repo.approveAllMappings(tx, partner, engagement);
    });
  });

  it("are not offered until the audit is on", async () => {
    expect(await as(partner, (tx) => getLetterContext(tx, engagement))).toBeNull();
    expect(await as(partner, (tx) => generateLetter(tx, partner, engagement, "engagement", {}))).toBeNull();
    await as(partner, (tx) => audit.setAuditEnabled(tx, partner, engagement, true));
  });

  it("know the firm, the client, the framework and which balances exist", async () => {
    expect(await as(partner, (tx) => getLetterContext(tx, engagement))).toEqual({
      clientName: "Letter Co LLC",
      periodEnd: "2025-12-31",
      framework: "IFRS for SMEs",
      firmName: "Al Noor Auditing",
      has: { inventory: false, receivables: true, tax: false },
      uncorrected: [],
    });
  });

  it("fill the engagement letter from the engagement and the form, and log the export", async () => {
    const letter = (await as(partner, (tx) =>
      generateLetter(tx, partner, engagement, "engagement", { addressee: " The Directors ", date: "2026-01-15", fee: "AED 25,000, fixed", otherServices: "", ai: "on", targetDate: "2026-03-31" }),
    ))!;
    const out = text(letter.blocks);
    expect(letter.title).toBe("Letter Co LLC engagement letter 2025-12-31");
    expect(out).toContain("To: The Directors, Letter Co LLC");
    expect(out).toContain("15 January 2026");
    expect(out).toContain("for the year ending 31 December 2025");
    expect(out).toContain("Our fee for the audit is AED 25,000, fixed, plus applicable VAT, payable [payment terms].");
    expect(out).toContain("issue our report by 31 March 2026");
    expect(out).toContain("[Partner name], Al Noor Auditing");
    expect(out).toContain("artificial-intelligence");
    expect(out).not.toContain("Other services");
    const logged = await db.query("select 1 from audit_log where action = 'export' and entity = 'engagement_letter' and entity_id = $1", [engagement]);
    expect(logged.rows).toHaveLength(1);
  });

  it("attach uncorrected misstatements to the representation letter, with their net effect", async () => {
    await as(partner, async (tx) => {
      await audit.addMisstatement(tx, partner, engagement, { description: "Accrual not booked", kind: "factual", amountMinor: 400000 });
      await audit.addMisstatement(tx, partner, engagement, { description: "Cut-off error on sales", kind: "factual", amountMinor: -150000 });
      const fixed = await audit.addMisstatement(tx, partner, engagement, { description: "Corrected item", kind: "factual", amountMinor: 999900 });
      await audit.setMisstatementCorrected(tx, partner, fixed, true);
    });
    const letter = (await as(partner, (tx) =>
      generateLetter(tx, partner, engagement, "representation", { receivables: "on", supporter: "Noor Holdings", specific: "The warehouse lease will be renewed.\r\n\r\n  Second   matter. " }),
    ))!;
    const out = text(letter.blocks);
    expect(out).toContain("5. The uncorrected misstatements listed in the attachment");
    expect(out).toContain("Noor Holdings has confirmed");
    expect(out).toContain("20. The allowance for doubtful debts is adequate.");
    expect(out).not.toContain("Inventories are stated");
    expect(out).toContain("21. The warehouse lease will be renewed.");
    expect(out).toContain("22. Second matter.");
    const table = letter.blocks.find((b) => b.kind === "table") as Extract<Block, { kind: "table" }>;
    expect(table.rows).toEqual([
      ["Accrual not booked", "4,000.00"],
      ["Cut-off error on sales", "(1,500.00)"],
      ["Net effect", "2,500.00"],
    ]);
  });

  it("are closed to another firm", async () => {
    expect(await as(outsider, (tx) => getLetterContext(tx, engagement))).toBeNull();
    expect(await as(outsider, (tx) => generateLetter(tx, outsider, engagement, "representation", {}))).toBeNull();
  });

  it("come out as a Word document that holds the wording", async () => {
    const letter = (await as(partner, (tx) => generateLetter(tx, partner, engagement, "representation", {})))!;
    const buffer = await buildLetterDocx(letter.title, letter.blocks);
    const xml = await (await JSZip.loadAsync(buffer)).file("word/document.xml")!.async("string");
    expect(xml).toContain("Draft template wording");
    expect(xml).toContain("We consider the going-concern basis appropriate");
    expect(xml).toContain("Accrual not booked");
    expect(xml).toContain("<w:tbl>");
  });
});
