import { describe, expect, it } from "vitest";
import { checkDetail, checkFix, checksSentence, draftNoteNumbers, draftNoteSentence, orderChecks, placeholderCount, splitBrackets } from "../src/ui/statements-view";

const c = (label: string, passed: boolean) => ({ label, passed });

describe("checksSentence", () => {
  it("says all pass", () => {
    expect(checksSentence([c("a", true), c("b", true), c("c", true)])).toBe("All 3 checks pass.");
    expect(checksSentence([c("a", true)])).toBe("The one check passes.");
  });
  it("counts what is outstanding, with plain plurals", () => {
    expect(checksSentence([c("a", false), c("b", true), c("c", true)])).toBe("Draft: 1 of 3 checks outstanding.");
    expect(checksSentence([c("a", false), c("b", false), c("c", true), c("d", true), c("e", true), c("f", true), c("g", true)])).toBe("Draft: 2 of 7 checks outstanding.");
    expect(checksSentence([c("a", false)])).toBe("Draft: 1 of 1 check outstanding.");
  });
  it("copes with no checks", () => {
    expect(checksSentence([])).toBe("No checks to run.");
  });
});

describe("orderChecks", () => {
  it("puts failed checks first and keeps the order within each group", () => {
    const out = orderChecks([c("a", true), c("b", false), c("c", true), c("d", false)]);
    expect(out.map((x) => x.label)).toEqual(["b", "d", "a", "c"]);
  });
  it("does not change the input", () => {
    const input = [c("a", true), c("b", false)];
    orderChecks(input);
    expect(input.map((x) => x.label)).toEqual(["a", "b"]);
  });
});

describe("checkDetail", () => {
  it("works out (s) plurals and leaves a missing detail alone", () => {
    expect(checkDetail("2 account(s) are unmapped and are missing from the statements.")).toBe("2 accounts are unmapped and are missing from the statements.");
    expect(checkDetail("1 suggested mapping(s) are not yet accepted.")).toBe("1 suggested mapping is not yet accepted.");
    expect(checkDetail(undefined)).toBeUndefined();
  });
});

describe("checkFix", () => {
  const id = "abc";
  it("links the trial balance checks to trial balance and mapping", () => {
    for (const label of ["Adjusted trial balance adds to zero", "Every account is mapped to a group", "Every mapping has been reviewed"]) {
      expect(checkFix(label, id)).toEqual({ href: "/engagements/abc/trial-balance", text: "Open trial balance and mapping" });
    }
  });
  it("links the borrowings check to the borrowings panel", () => {
    expect(checkFix("Current portion of borrowings is within total borrowings", id)?.href).toBe("#borrowings");
  });
  it("gives no link to the others", () => {
    expect(checkFix("Total assets equal total equity and liabilities", id)).toBeNull();
    expect(checkFix("Comparative figures balance", id)).toBeNull();
    expect(checkFix("Cash flow statement agrees to the movement in cash", id)).toBeNull();
  });
});

const join = (s: string) => splitBrackets(s).map((p) => p.text).join("");

describe("splitBrackets", () => {
  it("returns one plain piece when there are no brackets", () => {
    expect(splitBrackets("Plain text.")).toEqual([{ text: "Plain text.", placeholder: false }]);
  });
  it("returns nothing for empty text", () => {
    expect(splitBrackets("")).toEqual([]);
  });
  it("marks one placeholder", () => {
    expect(splitBrackets("Prepared in [currency] on the basis.")).toEqual([
      { text: "Prepared in ", placeholder: false },
      { text: "[currency]", placeholder: true },
      { text: " on the basis.", placeholder: false },
    ]);
  });
  it("marks several, including one at each end", () => {
    const t = "[Legal form], registered at [address] [licence].";
    const pieces = splitBrackets(t);
    expect(pieces.filter((p) => p.placeholder).map((p) => p.text)).toEqual(["[Legal form]", "[address]", "[licence]"]);
    expect(join(t)).toBe(t);
  });
  it("leaves an unmatched bracket as plain text", () => {
    expect(splitBrackets("Open [bracket only")).toEqual([{ text: "Open [bracket only", placeholder: false }]);
    expect(splitBrackets("Closed only] here")).toEqual([{ text: "Closed only] here", placeholder: false }]);
    expect(join("a [b] c [d")).toBe("a [b] c [d");
    expect(splitBrackets("a [b] c [d").filter((p) => p.placeholder)).toHaveLength(1);
  });
  it("counts placeholders across texts", () => {
    expect(placeholderCount(["[a] and [b]", "none", "[c]"])).toBe(3);
  });
});

describe("draft notes", () => {
  const notice = "NOTICE";
  const notes = [
    { number: 1, paragraphs: ["a"] },
    { number: 3, paragraphs: [notice] },
    { number: 7, paragraphs: ["x", notice] },
  ];
  it("finds the notes that carry the notice, by the number the pack gives", () => {
    expect(draftNoteNumbers(notes.slice(0, 1), notice)).toEqual([]);
    expect(draftNoteNumbers(notes.slice(0, 2), notice)).toEqual([3]);
    expect(draftNoteNumbers([{ number: 5, paragraphs: [notice] }], notice)).toEqual([5]);
    expect(draftNoteNumbers(notes, notice)).toEqual([3, 7]);
  });
  it("words the line, or gives none", () => {
    expect(draftNoteSentence([])).toBeNull();
    expect(draftNoteSentence([3])).toBe("The accounting policies in note 3 are draft wording and need review before issue.");
    expect(draftNoteSentence([3, 7])).toBe("The accounting policies in notes 3 and 7 are draft wording and need review before issue.");
  });
});
