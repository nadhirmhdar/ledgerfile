import { describe, expect, it } from "vitest";
import { AREAS, AREA_BY_CODE, assertionsOf, selectProcedures, type Assertion } from "../src/domain/audit";
import { applyFirmChanges, checkOwnProcedure, MAX_OWN_PER_AREA, nextOwnSeq, ownId, type FirmOwnProcedure } from "../src/domain/firm-methodology";

const own = (over: Partial<FirmOwnProcedure> = {}): FirmOwnProcedure => ({ areaCode: "C5", seq: 1, tier: "core", assertions: ["E"], body: "Invented own procedure.", evidence: "Invented evidence.", reference: "", retired: false, ...over });
const input = (over: Partial<Record<"tier" | "body" | "evidence" | "reference", string>> & { assertions?: string[] } = {}) => ({ tier: "core", assertions: ["E"], body: "Invented own procedure.", evidence: "Invented evidence.", reference: "", ...over });
const c5 = AREA_BY_CODE.get("C5")!;
const c5Allowed = assertionsOf(c5);
const lowRisks = Object.fromEntries(c5Allowed.map((a) => [a, "low"])) as Parameters<typeof selectProcedures>[1];

describe("ids for the firm's own procedures", () => {
  it("are made from the area and a sequence number, and cannot collide with a library id", () => {
    expect(ownId("C1", 1)).toBe("C1.F01");
    expect(ownId("C16", 12)).toBe("C16.F12");
    const libraryIds = new Set(AREAS.flatMap((a) => a.procedures.map((p) => p.id)));
    for (const a of AREAS) for (let n = 1; n <= MAX_OWN_PER_AREA; n++) expect(libraryIds.has(ownId(a.code, n))).toBe(false);
    expect(ownId("C5", 1)).toMatch(/^C[0-9]{1,2}\.F[0-9]{2}$/);
    expect(/^C[0-9]{1,2}\.[0-9]{2}$/.test(ownId("C5", 1))).toBe(false);
  });

  it("take the next number after every one used, retired ones included, and never reuse one", () => {
    expect(nextOwnSeq([])).toBe(1);
    expect(nextOwnSeq([1, 2, 3])).toBe(4);
    expect(nextOwnSeq([2])).toBe(3);
    expect(nextOwnSeq([1, 3])).toBe(4);
  });

  it("stop at 30 per area", () => {
    expect(MAX_OWN_PER_AREA).toBe(30);
    expect(nextOwnSeq(Array.from({ length: 29 }, (_, i) => i + 1))).toBe(30);
    expect(nextOwnSeq(Array.from({ length: 30 }, (_, i) => i + 1))).toBeNull();
  });
});

describe("the firm's own procedures in the areas", () => {
  it("are appended after the area's library procedures, in order, and marked as the firm's own", () => {
    const applied = applyFirmChanges(AREAS, [], [own({ seq: 2, body: "Second." }), own({ seq: 1, body: "First." })]).find((a) => a.code === "C5")!;
    const ids = applied.procedures.map((p) => p.id);
    expect(ids.slice(0, c5.procedures.length)).toEqual(c5.procedures.map((p) => p.id));
    expect(ids.slice(c5.procedures.length)).toEqual(["C5.F01", "C5.F02"]);
    expect(applied.procedures[c5.procedures.length]).toMatchObject({ text: "First.", tier: "core", assertions: ["E"], firmOwn: true });
    expect(applied.procedures.slice(0, c5.procedures.length).every((p) => !p.firmOwn)).toBe(true);
  });

  it("add nothing to another area, and leave the library alone", () => {
    const before = JSON.stringify(AREAS);
    const applied = applyFirmChanges(AREAS, [], [own()]);
    expect(applied.find((a) => a.code === "C6")!.procedures).toEqual(AREA_BY_CODE.get("C6")!.procedures);
    expect(JSON.stringify(AREAS)).toBe(before);
  });

  it("leave a retired one out", () => {
    const applied = applyFirmChanges(AREAS, [], [own({ retired: true })]);
    expect(applied).toBe(AREAS);
    const two = applyFirmChanges(AREAS, [], [own({ retired: true }), own({ seq: 2 })]).find((a) => a.code === "C5")!;
    expect(two.procedures.map((p) => p.id)).not.toContain("C5.F01");
    expect(two.procedures.map((p) => p.id)).toContain("C5.F02");
  });

  it("are chosen by tier and risk like any other procedure", () => {
    const firmC5 = applyFirmChanges(AREAS, [], [own({ seq: 1, tier: "core" }), own({ seq: 2, tier: "extended", assertions: ["V"] }), own({ seq: 3, tier: "significant", assertions: ["C"] })]).find((a) => a.code === "C5")!;
    const ids = (risks: typeof lowRisks) => selectProcedures(firmC5, risks).map((p) => p.id).filter((id) => id.includes(".F"));
    expect(ids(lowRisks)).toEqual(["C5.F01"]);
    expect(ids({ ...lowRisks, V: "moderate" })).toEqual(["C5.F01", "C5.F02"]);
    expect(ids({ ...lowRisks, V: "high", C: "significant" })).toEqual(["C5.F01", "C5.F02", "C5.F03"]);
    expect(ids({ ...lowRisks, C: "high" })).toEqual(["C5.F01"]);
  });

  it("are all loaded in management override, where the risk is fixed", () => {
    const c16 = applyFirmChanges(AREAS, [], [own({ areaCode: "C16", tier: "extended", assertions: ["E"] })]).find((a) => a.code === "C16")!;
    expect(selectProcedures(c16, {}).map((p) => p.id)).toContain("C16.F01");
  });

  it("with none, give the library itself", () => {
    expect(applyFirmChanges(AREAS, [], [])).toBe(AREAS);
  });

  it("do not change the assertions an area is rated on", () => {
    const firmC5 = applyFirmChanges(AREAS, [], [own({ assertions: ["E", "V"] })]).find((a) => a.code === "C5")!;
    expect(assertionsOf(firmC5)).toEqual(assertionsOf(c5));
  });
});

describe("checkOwnProcedure", () => {
  it("accepts a procedure and puts its assertions in the standard order", () => {
    const checked = checkOwnProcedure(input({ assertions: ["V", "E"], reference: "  Invented reference.  " }), c5Allowed);
    expect(checked).toEqual({ ok: true, value: { tier: "core", assertions: ["E", "V"], body: "Invented own procedure.", evidence: "Invented evidence.", reference: "Invented reference." } });
  });

  it("needs a tier it knows", () => {
    expect(checkOwnProcedure(input({ tier: "optional" }), c5Allowed).ok).toBe(false);
  });

  it("needs at least one assertion, and only ones the library's area covers", () => {
    expect(checkOwnProcedure(input({ assertions: [] }), c5Allowed)).toEqual({ ok: false, message: "Choose at least one assertion the procedure addresses." });
    const c15 = assertionsOf(AREA_BY_CODE.get("C15")!);
    expect(c15).not.toContain("E");
    expect(checkOwnProcedure(input({ assertions: ["E"] }), c15)).toEqual({ ok: false, message: "Choose only assertions this area already covers." });
    expect(checkOwnProcedure(input({ assertions: ["A", "ZZ"] }), c15).ok).toBe(false);
    expect(checkOwnProcedure(input({ assertions: ["A", "C"] }), c15).ok).toBe(true);
  });

  it("refuses blank wording and evidence, but not a blank reference", () => {
    expect(checkOwnProcedure(input({ body: "  " }), c5Allowed)).toEqual({ ok: false, message: "Write the procedure wording: it cannot be blank." });
    expect(checkOwnProcedure(input({ evidence: "" }), c5Allowed)).toEqual({ ok: false, message: "Write the evidence: it cannot be blank." });
    expect(checkOwnProcedure(input({ reference: "" }), c5Allowed).ok).toBe(true);
  });

  it("keeps part 1's limits: 2,000 for the text, 300 for the evidence and the reference", () => {
    expect(checkOwnProcedure(input({ body: "x".repeat(2000) }), c5Allowed).ok).toBe(true);
    expect(checkOwnProcedure(input({ body: "x".repeat(2001) }), c5Allowed)).toEqual({ ok: false, message: "The procedure wording is too long. Keep it to 2,000 characters." });
    expect(checkOwnProcedure(input({ evidence: "x".repeat(301) }), c5Allowed)).toEqual({ ok: false, message: "The evidence is too long. Keep it to 300 characters." });
    expect(checkOwnProcedure(input({ reference: "x".repeat(301) }), c5Allowed)).toEqual({ ok: false, message: "The reference is too long. Keep it to 300 characters." });
  });

  it("refuses evidence that starts \"Partner sign-off\", in any case, so an own procedure can never be a partner step", () => {
    for (const evidence of ["Partner sign-off on the file.", "  partner SIGN-OFF recorded", "PARTNER SIGN-OFF"]) {
      const checked = checkOwnProcedure(input({ evidence }), c5Allowed);
      expect(checked.ok, evidence).toBe(false);
      expect(checked.ok ? "" : checked.message).toMatch(/Partner sign-off/);
    }
    expect(checkOwnProcedure(input({ evidence: "Agreed before the partner's sign-off." }), c5Allowed).ok).toBe(true);
  });

  it("only offers assertion codes the standard has", () => {
    expect(c5Allowed.every((a: Assertion) => typeof a === "string")).toBe(true);
  });
});
