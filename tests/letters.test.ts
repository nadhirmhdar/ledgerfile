import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildEngagementLetter, buildRepresentationLetter, ENGAGEMENT, fill, REPRESENTATION, type Block } from "../src/domain/letters";

/** Every string in a nested template object. */
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

describe("letter wording", () => {
  // The document is the copy the firm reviews; the code is what the product issues.
  const doc = readFileSync("docs/methodology-templates-and-prompt-lists.md", "utf8").replace(/\*\*/g, "").replace(/\s+/g, " ");

  it("matches the engagement letter in the methodology document, sentence for sentence", () => {
    for (const s of strings(ENGAGEMENT)) expect(doc, s).toContain(s);
  });
  it("matches the representation letter in the methodology document, sentence for sentence", () => {
    for (const s of strings(REPRESENTATION)) expect(doc, s).toContain(s);
  });
});

describe("filling values", () => {
  it("substitutes values and leaves missing ones in brackets for completion", () => {
    expect(fill("Fee of {fee and basis} by {target date}.", { "fee and basis": "AED 20,000 fixed", "target date": "  " })).toBe("Fee of AED 20,000 fixed by [target date].");
    expect(fill("No fields here.", {})).toBe("No fields here.");
  });
});

describe("engagement letter", () => {
  const values = { "Firm name": "Demo Audit Firm", "Client legal name": "Falcon Trading LLC", "period end": "31 December 2025", framework: "IFRS for SMEs", Date: "1 March 2026" };

  it("numbers its sections 1 to 9 without the optional section, and 1 to 10 with it", () => {
    const headings = (other: boolean) =>
      buildEngagementLetter({ values, otherServices: other, aiFeatures: false })
        .filter((b) => b.kind === "heading")
        .map((b) => (b as { text: string }).text);
    expect(headings(false).slice(1)).toEqual([
      "1. What we will do",
      "2. How we will do it",
      "3. What you are responsible for",
      "4. Our report",
      "5. Timing and information",
      "6. Fees",
      "7. Confidentiality and data",
      "8. Other terms",
      "9. Agreement",
    ]);
    expect(headings(true)[4]).toBe("4. Other services");
    expect(headings(true)).toHaveLength(11);
  });

  it("fills what it knows and brackets what it does not", () => {
    const out = text(buildEngagementLetter({ values, otherServices: false, aiFeatures: false }));
    expect(out).toContain("financial statements of Falcon Trading LLC");
    expect(out).toContain("in accordance with IFRS for SMEs");
    expect(out).toContain("Our fee for the audit is [fee and basis], plus applicable VAT, payable [payment terms].");
    expect(out).toContain("[Firm standard terms:");
    expect(out).not.toContain("{");
    expect(out).toContain("Draft template wording");
  });

  it("mentions artificial-intelligence tools only when asked to", () => {
    expect(text(buildEngagementLetter({ values, otherServices: false, aiFeatures: false }))).not.toContain("artificial-intelligence");
    expect(text(buildEngagementLetter({ values, otherServices: false, aiFeatures: true }))).toContain("your data is not used to train those tools");
  });
});

describe("representation letter", () => {
  const base = {
    values: { "Firm name": "Demo Audit Firm", "Client legal name": "Falcon Trading LLC", "period end": "31 December 2025", framework: "IFRS for SMEs" },
    uncorrected: [],
    ownerSupport: false,
    inventory: false,
    receivables: false,
    tax: false,
    specific: [],
  };
  const numbered = (b: Block[]) => b.filter((x) => x.kind === "numbered").map((x) => (x as { text: string }).text);

  it("numbers every representation consecutively whatever is included", () => {
    const plain = numbered(buildRepresentationLetter(base));
    expect(plain).toHaveLength(18);
    expect(plain.map((t) => Number(t.split(".")[0]))).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));

    const full = numbered(
      buildRepresentationLetter({ ...base, ownerSupport: true, inventory: true, receivables: true, tax: true, specific: ["The lease of the warehouse will be renewed."], values: { ...base.values, "Supporter name": "Falcon Holdings" } }),
    );
    expect(full).toHaveLength(23);
    expect(full[18]).toBe("19. Falcon Holdings has confirmed that it will provide the financial support the Company needs for at least twelve months from the date of approval of the financial statements, and we are satisfied that it is able to do so.");
    expect(full[22]).toBe("23. The lease of the warehouse will be renewed.");
  });

  it("says there are no uncorrected misstatements, or attaches the schedule", () => {
    expect(text(buildRepresentationLetter(base))).toContain("5. There are no uncorrected misstatements.");
    expect(text(buildRepresentationLetter(base))).not.toContain("Attachment");

    const blocks = buildRepresentationLetter({ ...base, uncorrected: [{ description: "Accrual not booked", amount: "(4,000.00)" }] });
    expect(text(blocks)).toContain("5. The uncorrected misstatements listed in the attachment are, in our view, immaterial");
    const table = blocks.find((b) => b.kind === "table") as Extract<Block, { kind: "table" }>;
    expect(table.rows).toEqual([["Accrual not booked", "(4,000.00)"]]);
  });

  it("brackets the engagement letter date when it is not given", () => {
    expect(text(buildRepresentationLetter(base))).toContain("engagement letter dated [engagement letter date]");
  });
});
