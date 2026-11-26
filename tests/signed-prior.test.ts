import { describe, expect, it } from "vitest";
import { buildStatements, type StatementAccount } from "../src/domain/statements";
import { appliesToEngagement, NOTHING_ENTERED, parseSignedAmount, signedPriorCheck, signedPriorLines, SIGNED_PRIOR_LABEL } from "../src/domain/signed-prior";

// An invented company: current and prior balances in ledger sign (debits positive), in cents.
const acct = (groupCode: string, closingMinor: number, priorMinor: number | null): StatementAccount => ({ code: groupCode, name: groupCode, groupCode, closingMinor, priorMinor, approved: true }) as unknown as StatementAccount;
function books(comparatives = true): StatementAccount[] {
  const rows: [string, number, number][] = [
    ["PPE", 5_000_050, 4_000_050],
    ["INVENT", 900_000, 800_000],
    ["TRADEREC", 2_000_000, 1_700_000],
    ["TRADEPAY", -1_300_000, -1_200_000],
    ["CAPITAL", -3_000_000, -3_000_000],
    ["RETAINED", -500_000, -400_000],
    ["REVENUE", -10_500_000, -8_300_000],
    ["COS", 6_000_000, 5_000_000],
    ["ADMIN", 1_300_000, 1_300_000],
  ];
  const all = rows.map(([g, c, p]) => acct(g, c, comparatives ? p : null));
  const cash = acct("CASH", -all.reduce((s, a) => s + a.closingMinor, 0), comparatives ? -all.reduce((s, a) => s + (a.priorMinor ?? 0), 0) : null);
  return [...all, cash];
}
const base = (comparatives = true) => buildStatements(books(comparatives));
const money = (minor: number) => (minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** What a signed statement would show: this file's comparative for every line, in minor units, as a Map to enter. */
const asSigned = (b = base(), unit = 1) => new Map(signedPriorLines(b).map((l) => [l.key, Math.round(l.comparative / unit) * unit] as [string, number | null]));

describe("which lines take a signed figure", () => {
  it("lists the face lines that have a figure, never a subtotal or total, and none without comparatives", () => {
    const b = base();
    const lines = signedPriorLines(b);
    expect(lines.length).toBeGreaterThan(8);
    const kinds = new Map([...b.financialPosition.flatMap((s) => s.lines), ...b.comprehensiveIncome].map((l) => [l.key, l.kind]));
    expect(lines.every((l) => kinds.get(l.key) === "line")).toBe(true);
    expect(new Set(lines.map((l) => l.key)).size).toBe(lines.length);
    expect(signedPriorLines(base(false))).toEqual([]);
  });

  it("applies only to an engagement with no prior engagement and with prior-year figures", () => {
    expect(appliesToEngagement(false, base())).toBe(true);
    expect(appliesToEngagement(true, base())).toBe(false);
    expect(appliesToEngagement(false, base(false))).toBe(false);
  });
});

describe("the amount a person types", () => {
  it("takes a number with at most two decimals, with commas and spaces ignored, and an empty one clears the line", () => {
    expect(parseSignedAmount("1,234,567.89")).toBe(123456789);
    expect(parseSignedAmount(" -500 ")).toBe(-50000);
    expect(parseSignedAmount("0.1")).toBe(10);
    expect(parseSignedAmount("")).toBeNull();
    expect(parseSignedAmount("   ")).toBeNull();
    for (const bad of ["12.345", "abc", "1e5", "--1", "1.", "$100", "1,2,3.456"]) expect(() => parseSignedAmount(bad), bad).toThrow(/number/);
  });
});

describe("Comparative figures agree to the signed prior-year statements", () => {
  it("is a warning with the stated label, and passes when every entered line agrees (exact and whole units)", () => {
    for (const unit of [1, 100]) {
      const b = unit === 1 ? base() : buildStatements(books().map((a) => ({ ...a, closingMinor: Math.round(a.closingMinor / 100) * 100, priorMinor: a.priorMinor === null ? null : Math.round(a.priorMinor / 100) * 100 })));
      const check = signedPriorCheck(b, asSigned(b, unit), unit);
      expect(check).toMatchObject({ label: SIGNED_PRIOR_LABEL, passed: true, severity: "warning" });
      expect(check.items).toBeUndefined();
      expect(check.detail).toBeUndefined();
    }
  });

  it("names a differing line, both amounts and the difference", () => {
    const b = base();
    const entered = asSigned(b);
    const line = signedPriorLines(b).find((l) => l.label.toLowerCase().includes("inventor"))!;
    entered.set(line.key, line.comparative + 25_000);
    const check = signedPriorCheck(b, entered, 1);
    expect(check.passed).toBe(false);
    expect(check.severity).toBe("warning");
    expect(check.detail).toBe("1 figure differs.");
    expect(check.items).toEqual([`${line.label}: this file's comparative ${money(line.comparative)}, signed ${money(line.comparative + 25_000)}, difference minus 250.00`]);
  });

  it("compares after rounding: a signed figure that rounds to the comparative agrees in whole units", () => {
    const b = buildStatements(books().map((a) => ({ ...a, closingMinor: Math.round(a.closingMinor / 100) * 100, priorMinor: a.priorMinor === null ? null : Math.round(a.priorMinor / 100) * 100 })));
    const entered = asSigned(b, 100);
    const line = signedPriorLines(b)[0];
    entered.set(line.key, line.comparative + 40); // 0.40 more than the whole-unit comparative: rounds back to it
    expect(signedPriorCheck(b, entered, 100).passed).toBe(true);
    entered.set(line.key, line.comparative + 60); // 0.60 more: rounds to the next unit
    expect(signedPriorCheck(b, entered, 100).passed).toBe(false);
  });

  it("lists up to five lines, then 'and N more'", () => {
    const b = base();
    const entered = asSigned(b);
    const lines = signedPriorLines(b);
    expect(lines.length).toBeGreaterThanOrEqual(8);
    for (const l of lines.slice(0, 8)) entered.set(l.key, l.comparative + 100);
    const check = signedPriorCheck(b, entered, 1);
    expect(check.detail).toBe("8 figures differ.");
    expect(check.items).toHaveLength(6);
    expect(check.items![5]).toBe("and 3 more");
    const five = asSigned(b);
    for (const l of lines.slice(0, 5)) five.set(l.key, l.comparative + 100);
    expect(signedPriorCheck(b, five, 1).items).toHaveLength(5);
  });

  it("with nothing entered it fails as a warning and says so, and a cleared line counts as not entered", () => {
    const b = base();
    expect(signedPriorCheck(b, new Map(), 1)).toMatchObject({ label: SIGNED_PRIOR_LABEL, passed: false, detail: NOTHING_ENTERED, severity: "warning" });
    const cleared = new Map(signedPriorLines(b).map((l) => [l.key, null as number | null]));
    expect(signedPriorCheck(b, cleared, 1)).toMatchObject({ passed: false, detail: NOTHING_ENTERED });
  });

  it("does not compare lines left empty, and says how many", () => {
    const b = base();
    const lines = signedPriorLines(b);
    const some = new Map<string, number | null>(lines.slice(0, 3).map((l) => [l.key, l.comparative]));
    const check = signedPriorCheck(b, some, 1);
    expect(check.passed).toBe(true);
    expect(check.detail).toBe(`${lines.length - 3} lines were left empty and not compared.`);
    // With a difference too, the detail carries both facts.
    some.set(lines[0].key, lines[0].comparative + 1);
    expect(signedPriorCheck(b, some, 1).detail).toBe(`1 figure differs. ${lines.length - 3} lines were left empty and not compared.`);
    // One empty line reads in the singular.
    const all = asSigned(b);
    all.delete(lines[0].key);
    expect(signedPriorCheck(b, all, 1).detail).toBe("1 line was left empty and not compared.");
  });
});
