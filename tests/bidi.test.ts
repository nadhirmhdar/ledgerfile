/** Our own bidi ordering, on invented names. Expected strings are written as they are seen, left to right. */
import { describe, expect, it } from "vitest";
import { resolveLevels, toVisualString, visualRuns } from "../src/domain/bidi";

const reversed = (s: string) => Array.from(s).reverse().join("");
// An invented trading company: "Al Noor Al Wahmiya Trading".
const NOOR = "النور";
const TRADING = "للتجارة";

describe("ordering names that mix Arabic, Latin and digits", () => {
  it("leaves a Latin name as it is, in one left-to-right run", () => {
    const name = "Falcon Trading (Gulf) L.L.C - 2025, No. 12/34";
    expect(visualRuns(name)).toEqual([{ text: name, direction: "ltr" }]);
    expect(resolveLevels(name).direction).toBe("ltr");
  });

  it("puts an Arabic name right to left, keeping each word's letters in typing order inside its run", () => {
    const name = `${NOOR} ${TRADING}`;
    expect(resolveLevels(name).direction).toBe("rtl");
    expect(visualRuns(name)).toEqual([{ text: name, direction: "rtl" }]);
    expect(toVisualString(name)).toBe(reversed(name));
  });

  it("keeps a licence number's digits in order after an Arabic name and its legal form", () => {
    const name = `${NOOR} ذ.م.م 123456`;
    expect(toVisualString(name)).toBe(`123456 ${reversed(`${NOOR} ذ.م.م`)}`);
    expect(visualRuns(name).map((r) => r.direction)).toEqual(["ltr", "rtl"]);
    expect(visualRuns(name)[0].text).toBe("123456");
  });

  it("keeps L.L.C and its digits readable inside a right-to-left line", () => {
    expect(toVisualString(`${NOOR} L.L.C 12`)).toBe(`L.L.C 12 ${reversed(NOOR)}`);
  });

  it("orders an Arabic word inside a Latin name without moving the rest", () => {
    expect(toVisualString(`Al ${NOOR} Trading LLC`)).toBe(`Al ${reversed(NOOR)} Trading LLC`);
    expect(resolveLevels(`Al ${NOOR} Trading LLC`).direction).toBe("ltr");
  });

  it("mirrors parentheses and square brackets in right-to-left text", () => {
    const name = `${NOOR} (${TRADING}) [دبي]`;
    expect(toVisualString(name)).toBe(`[${reversed("دبي")}] (${reversed(TRADING)}) ${reversed(NOOR)}`);
  });

  it("keeps parentheses around Latin text inside a Latin line", () => {
    expect(toVisualString(`Noor (${NOOR}) LLC`)).toBe(`Noor (${reversed(NOOR)}) LLC`);
  });

  it("reads Arabic-Indic digits left to right", () => {
    expect(toVisualString(`${NOOR} ١٢٣`)).toBe(`١٢٣ ${reversed(NOOR)}`);
  });

  it("takes a given direction over the first strong letter", () => {
    expect(toVisualString(`LLC ${NOOR}`, "rtl")).toBe(`${reversed(NOOR)} LLC`);
    expect(toVisualString(`${NOOR} LLC`, "ltr")).toBe(`${reversed(NOOR)} LLC`);
  });

  it("keeps a mark with its letter and does not lose zero-width characters", () => {
    const marked = "مُحمّد";
    expect(visualRuns(marked)).toEqual([{ text: marked, direction: "rtl" }]);
    const joined = "می\u200cشود";
    expect(visualRuns(joined)).toEqual([{ text: joined, direction: "rtl" }]);
  });

  it("treats explicit embedding and isolate characters as neutral", () => {
    expect(resolveLevels("a\u2067b").levels).toEqual([0, 0, 0]);
  });

  it("returns nothing for an empty line", () => {
    expect(visualRuns("")).toEqual([]);
  });
});
