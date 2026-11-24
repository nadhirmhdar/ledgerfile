import { describe, expect, it } from "vitest";
import { parseTrialBalance } from "../src/domain/tb-parse";
import { buildPreview, chosenFromEntries, headingKey, matchRemembered, readTrialBalance, savedFrom, validateLayout, type Layout, type SavedLayout } from "../src/domain/tb-layout";

/** A sheet the automatic detection cannot read: none of its headings is one it knows. */
const ODD: unknown[][] = [
  ["Ledger head", "Dr Closing", "Cr Closing", "PY 2024"],
  ["Cash at bank", "1000.00", "", "900.00"],
  ["Share capital", "", "1000.00", "-900.00"],
];
const ODD_LAYOUT: Layout = { headerRow: 0, columns: { name: 0, debit: 1, credit: 2, prior: 3 } };

/** Sheets it already reads. */
const STANDARD: unknown[][][] = [
  [["Account Code", "Account Name", "Debit", "Credit"], ["1000", "Bank", 500, ""], ["3000", "Capital", "", 500]],
  [["Our client Ltd"], ["Trial balance at 31 Dec"], [], ["Code", "Description", "Balance", "Prior Year"], ["1000", "Bank", 500, 400], ["3000", "Capital", -500, -400], ["Total", "", 0, 0]],
  [["a/c no", "particulars", "closing dr", "closing cr", "py"], ["10", "Bank", 5, 0, 4], ["30", "Capital", 0, 5, 4]],
];

describe("automatic detection keeps working exactly as before", () => {
  it("reads every sheet it read, with the same accounts, the same columns and the same messages, and says it was detected", () => {
    for (const grid of STANDARD) {
      const before = parseTrialBalance(grid);
      const reading = readTrialBalance(grid);
      expect(reading.kind).toBe("parsed");
      if (reading.kind !== "parsed") continue;
      expect(reading.source).toBe("detected");
      expect(reading.result).toEqual(before);
    }
  });

  it("asks for the columns, with a preview, when it cannot read the sheet", () => {
    expect(parseTrialBalance(ODD).errors[0]).toContain("Could not find a header row");
    const reading = readTrialBalance(ODD);
    expect(reading.kind).toBe("choose");
    if (reading.kind === "choose") {
      expect(reading.reason).toContain("Could not find a header row");
      expect(reading.preview.rows).toHaveLength(3);
    }
  });

  it("shows the chooser when asked, even for a sheet it could read", () => {
    expect(readTrialBalance(STANDARD[0], { ask: true }).kind).toBe("choose");
  });
});

describe("matching remembered headings", () => {
  const saved: SavedLayout = savedFrom(ODD, ODD_LAYOUT);

  it("remembers the heading text for each role, the columns and the row", () => {
    expect(saved).toEqual({ headings: { name: "Ledger head", debit: "Dr Closing", credit: "Cr Closing", prior: "PY 2024" }, columns: { name: 0, debit: 1, credit: 2, prior: 3 }, headerRow: 0 });
  });

  it("ignores case, extra spaces and the year in a heading", () => {
    expect(headingKey("  CY   2025  ")).toBe("cy");
    expect(headingKey("Closing  Dr")).toBe(headingKey("closing dr"));
    const next = [["LEDGER  HEAD", "dr  closing", "cr closing", "py 2025"], ["Cash", 5, "", 4], ["Capital", "", 5, -4]];
    expect(matchRemembered(next, saved)).toEqual({ headerRow: 0, columns: { name: 0, debit: 1, credit: 2, prior: 3 } });
  });

  it("finds columns that have moved, with extra columns around them, below a title", () => {
    const next = [["Client report"], [], ["Note", "PY 2025", "Cr Closing", "Ledger head", "Other", "Dr Closing"], ["x", 4, "", "Cash", "", 5]];
    expect(matchRemembered(next, saved)).toEqual({ headerRow: 2, columns: { name: 3, debit: 5, credit: 2, prior: 1 } });
  });

  it("does not match when a remembered heading is missing, or after the first 20 rows", () => {
    expect(matchRemembered([["Ledger head", "Dr Closing", "Cr Closing"]], saved)).toBeNull();
    const deep = [...Array.from({ length: 25 }, () => ["x"]), ["Ledger head", "Dr Closing", "Cr Closing", "PY 2024"]];
    expect(matchRemembered(deep, saved)).toBeNull();
  });

  it("falls back to the place the headings were when the words have changed but the row still has headings there", () => {
    const reworded = [["Ledger head", "Dr Closing", "Credit side", "PY 2025"], ["Cash", 5, "", 4]];
    expect(matchRemembered(reworded, saved)).toEqual({ headerRow: 0, columns: { name: 0, debit: 1, credit: 2, prior: 3 } });
    const figures = [[1, 2, 3, 4], ["Cash", 5, "", 4]];
    expect(matchRemembered(figures, saved)).toBeNull();
  });

  it("matches nothing when nothing is remembered", () => {
    expect(matchRemembered(ODD, { headings: {}, columns: {}, headerRow: 0 })).toBeNull();
  });
});

describe("the order: chosen, then remembered, then detected, then ask", () => {
  const saved = savedFrom(ODD, ODD_LAYOUT);

  it("uses what the user chose before anything else", () => {
    const reading = readTrialBalance(ODD, { chosen: ODD_LAYOUT, remembered: saved });
    expect(reading).toMatchObject({ kind: "parsed", source: "chosen" });
    if (reading.kind === "parsed") expect(reading.result).toMatchObject({ balanced: true, errors: [] });
  });

  it("uses the remembered headings before detecting, and says so", () => {
    const reading = readTrialBalance(ODD, { remembered: saved });
    expect(reading).toMatchObject({ kind: "parsed", source: "remembered" });
    if (reading.kind === "parsed") expect(reading.result.accounts.map((a) => [a.code, a.closingMinor, a.priorMinor])).toEqual([["Cash at bank", 100000, 90000], ["Share capital", -100000, -90000]]);
  });

  it("prefers the remembered columns even when detection would read the sheet differently", () => {
    // Both a Balance and an Amount column are detectable; the client's layout says the amount is the one.
    const grid = [["Code", "Name", "Balance", "Amount"], ["1", "Cash", 5, 7], ["2", "Capital", -5, -7]];
    const mine = savedFrom(grid, { headerRow: 0, columns: { code: 0, name: 1, balance: 3 } });
    const detected = readTrialBalance(grid);
    const remembered = readTrialBalance(grid, { remembered: mine });
    expect(detected).toMatchObject({ source: "detected" });
    expect(remembered).toMatchObject({ source: "remembered" });
    if (detected.kind === "parsed" && remembered.kind === "parsed") {
      expect(detected.result.accounts[0].closingMinor).toBe(500);
      expect(remembered.result.accounts[0].closingMinor).toBe(700);
    }
  });

  it("falls back to detection when the remembered headings are not in this file, then to the chooser", () => {
    expect(readTrialBalance(STANDARD[0], { remembered: saved })).toMatchObject({ kind: "parsed", source: "detected" });
    expect(readTrialBalance([["Something"], ["else"]], { remembered: saved }).kind).toBe("choose");
  });
});

describe("checking a layout the user chose", () => {
  const ok: Layout = { headerRow: 0, columns: { name: 0, balance: 1 } };

  it("accepts a name or a code, with Debit and Credit or one Balance, and optionally a prior year", () => {
    expect(validateLayout(ok, 3)).toEqual([]);
    expect(validateLayout({ headerRow: 1, columns: { code: 0, debit: 1, credit: 2, prior: 3 } }, 3)).toEqual([]);
  });

  it("says in plain words what is missing", () => {
    expect(validateLayout({ headerRow: 0, columns: { balance: 1 } }, 3)).toEqual(["Choose which column is the account code or the account name."]);
    expect(validateLayout({ headerRow: 0, columns: { name: 0 } }, 3)).toEqual(["Choose a Debit and a Credit column, or one Balance column."]);
    expect(validateLayout({ headerRow: 0, columns: { name: 0, debit: 1 } }, 3)).toEqual(["Choose both a Debit and a Credit column, or use one Balance column."]);
    expect(validateLayout({ ...ok, headerRow: 9 }, 3)).toEqual(["Choose the heading row from the rows shown."]);
    expect(validateLayout({ ...ok, headerRow: Number.NaN }, 3)).toEqual(["Choose the heading row from the rows shown."]);
    expect(validateLayout({ headerRow: 0, columns: { name: 0, balance: 0 } }, 3)).toEqual(["Each column can have one role only."]);
    expect(validateLayout({ headerRow: 0, columns: { name: 0, balance: 99 } }, 3)).toEqual(["Choose columns from the ones shown."]);
  });

  it("does not read an incomplete choice: it asks again, with the reason", () => {
    const reading = readTrialBalance(ODD, { chosen: { headerRow: 0, columns: { name: 0 } } });
    expect(reading).toMatchObject({ kind: "choose", reason: "Choose a Debit and a Credit column, or one Balance column." });
  });

  it("builds the choice from the form's entries, ignoring Ignore and unknown roles, and reports a role chosen twice", () => {
    expect(chosenFromEntries({ headerRow: "0", role_0: "name", role_1: "debit", role_2: "credit", role_3: "", role_4: "nonsense", other: "x" })).toEqual({ layout: { headerRow: 0, columns: { name: 0, debit: 1, credit: 2 } }, clashes: [] });
    expect(chosenFromEntries({ headerRow: "0", role_0: "name", role_1: "name" }).clashes).toEqual(["name"]);
  });
});

describe("the preview", () => {
  it("shows the first 10 rows with something in them, and starts with the row that has the most headings", () => {
    const grid = [["Client"], [], ["", "", ""], ["Ledger head", "Dr", "Cr", "PY"], ...Array.from({ length: 20 }, (_, i) => [`A${i}`, i, 0, 0])];
    const p = buildPreview(grid);
    expect(p.rows).toHaveLength(10);
    expect(p.rows[0]).toEqual({ index: 0, cells: ["Client"] });
    expect(p.rows[1].index).toBe(3);
    expect(p.headerRow).toBe(3);
    expect(p.columnCount).toBe(4);
  });

  it("cuts long cells and many columns", () => {
    const p = buildPreview([Array.from({ length: 30 }, () => "x".repeat(100))]);
    expect(p.columnCount).toBe(20);
    expect(p.rows[0].cells[0]).toHaveLength(40);
  });

  it("is empty for an empty sheet", () => {
    expect(buildPreview([])).toEqual({ rows: [], columnCount: 0, headerRow: 0 });
  });
});
