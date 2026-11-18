import { describe, expect, it } from "vitest";
import { AREAS, AREA_BY_CODE, areasInScope, assertionsOf, selectProcedures } from "../src/domain/audit";
import { applyFirmChanges, checkWording, isProtected, stateOf, MAX_BODY, MAX_EVIDENCE, MAX_REFERENCE, type FirmChange } from "../src/domain/firm-methodology";
import { areaSummary, canEditMethodology, STATE_BADGE } from "../src/ui/methodology-view";

const change = (templateId: string, over: Partial<FirmChange> = {}): FirmChange => ({ templateId, body: null, evidence: null, reference: null, hidden: false, ...over });
const find = (areas: typeof AREAS, id: string) => areas.flatMap((a) => a.procedures).find((p) => p.id === id);
const lib = (id: string) => find(AREAS, id)!;

describe("applyFirmChanges", () => {
  it("returns the library itself when the firm has made no changes", () => {
    expect(applyFirmChanges(AREAS, [])).toBe(AREAS);
  });

  it("replaces the body, the evidence and the reference field by field, and marks the procedure as the firm's wording", () => {
    const original = lib("C5.01");
    const bodyOnly = find(applyFirmChanges(AREAS, [change("C5.01", { body: "Invented firm wording for the listing check." })]), "C5.01")!;
    expect(bodyOnly).toMatchObject({ text: "Invented firm wording for the listing check.", evidence: original.evidence, reference: original.reference, firmWording: true });

    const evidenceOnly = find(applyFirmChanges(AREAS, [change("C5.01", { evidence: "Invented evidence line." })]), "C5.01")!;
    expect(evidenceOnly).toMatchObject({ text: original.text, evidence: "Invented evidence line.", reference: original.reference, firmWording: true });

    const referenceOnly = find(applyFirmChanges(AREAS, [change("C5.01", { reference: "Invented reference." })]), "C5.01")!;
    expect(referenceOnly).toMatchObject({ text: original.text, evidence: original.evidence, reference: "Invented reference.", firmWording: true });
  });

  it("keeps ids, tiers and assertions as the library has them, and leaves other procedures and the library untouched", () => {
    const before = JSON.stringify(AREAS);
    const original = lib("C5.01");
    const applied = applyFirmChanges(AREAS, [change("C5.01", { body: "Invented wording." })]);
    const edited = find(applied, "C5.01")!;
    expect(edited).toMatchObject({ id: original.id, tier: original.tier, assertions: original.assertions });
    expect(find(applied, "C5.02")).toBe(lib("C5.02"));
    expect(find(applied, "C5.02")!.firmWording).toBeUndefined();
    expect(JSON.stringify(AREAS)).toBe(before);
  });

  it("leaves a hidden procedure out, and brings it back when it is no longer hidden", () => {
    const hidden = applyFirmChanges(AREAS, [change("C5.02", { hidden: true })]);
    expect(find(hidden, "C5.02")).toBeUndefined();
    expect(AREA_BY_CODE.get("C5")!.procedures.length - hidden.find((a) => a.code === "C5")!.procedures.length).toBe(1);
    expect(find(applyFirmChanges(AREAS, [change("C5.02", { hidden: false })]), "C5.02")).toBe(lib("C5.02"));
  });

  it("keeps the wording edit of a hidden procedure for when it is shown again", () => {
    const edited = change("C5.02", { body: "Invented wording.", hidden: true });
    expect(find(applyFirmChanges(AREAS, [edited]), "C5.02")).toBeUndefined();
    expect(find(applyFirmChanges(AREAS, [{ ...edited, hidden: false }]), "C5.02")).toMatchObject({ text: "Invented wording.", firmWording: true });
  });

  it("a reset (no row, or a row with nothing different) gives the library's own procedure", () => {
    expect(find(applyFirmChanges(AREAS, [change("C5.01")]), "C5.01")).toBe(lib("C5.01"));
  });

  it("ignores a change for an id that is not in the library", () => {
    const applied = applyFirmChanges(AREAS, [change("C99.01", { body: "Nothing to change." }), change("C5.99", { hidden: true })]);
    expect(applied.flatMap((a) => a.procedures.map((p) => p.id))).toEqual(AREAS.flatMap((a) => a.procedures.map((p) => p.id)));
  });

  it("does not hide a protected procedure (a core procedure of management override), but does apply its wording", () => {
    const c16 = AREA_BY_CODE.get("C16")!;
    const first = c16.procedures[0];
    expect(isProtected(c16, first)).toBe(true);
    const applied = applyFirmChanges(AREAS, [change(first.id, { hidden: true, body: "Invented override wording." })]);
    expect(find(applied, first.id)).toMatchObject({ text: "Invented override wording.", firmWording: true });
    const hiddenOnly = applyFirmChanges(AREAS, [change(first.id, { hidden: true })]);
    expect(find(hiddenOnly, first.id)).toBe(first);
  });

  it("protects every procedure of C16 and no procedure of any other area", () => {
    const protectedIds = AREAS.flatMap((a) => a.procedures.filter((p) => isProtected(a, p)).map((p) => p.id));
    expect(protectedIds).toEqual(AREA_BY_CODE.get("C16")!.procedures.map((p) => p.id));
  });
});

describe("the firm's areas drive what a programme loads", () => {
  const c5 = AREA_BY_CODE.get("C5")!;
  const allLow = Object.fromEntries(assertionsOf(c5).map((a) => [a, "low"])) as Parameters<typeof selectProcedures>[1];

  it("selectProcedures on the firm's area leaves out a hidden procedure and carries the edited wording", () => {
    const firmC5 = applyFirmChanges(AREAS, [change("C5.02", { hidden: true }), change("C5.01", { body: "Invented wording." })]).find((a) => a.code === "C5")!;
    const chosen = selectProcedures(firmC5, allLow);
    expect(chosen.map((p) => p.id)).not.toContain("C5.02");
    expect(chosen.find((p) => p.id === "C5.01")).toMatchObject({ text: "Invented wording.", firmWording: true });
    expect(selectProcedures(c5, allLow).map((p) => p.id)).toContain("C5.02");
  });

  it("areasInScope uses the areas it is given, and the library by default", () => {
    const firmAreas = applyFirmChanges(AREAS, [change("C5.01", { body: "Invented wording." })]);
    const used = new Set([c5.groups[0]]);
    const defaults = areasInScope(used);
    const firm = areasInScope(used, firmAreas);
    expect(firm.map((a) => a.code)).toEqual(defaults.map((a) => a.code));
    expect(firm.map((a) => a.code)).toContain("C5");
    expect(find(firm, "C5.01")).toMatchObject({ text: "Invented wording.", firmWording: true });
    expect(find(defaults, "C5.01")).toBe(lib("C5.01"));
  });

  it("with no firm changes, selecting from the firm's areas gives exactly today's programme", () => {
    for (const area of AREAS) {
      const fixed = area.fixedRisk ? {} : Object.fromEntries(assertionsOf(area).map((a) => [a, "high"]));
      expect(selectProcedures(applyFirmChanges(AREAS, []).find((a) => a.code === area.code)!, fixed as Parameters<typeof selectProcedures>[1])).toEqual(selectProcedures(area, fixed as Parameters<typeof selectProcedures>[1]));
    }
    expect(AREAS.flatMap((a) => a.procedures).some((p) => p.firmWording)).toBe(false);
  });
});

describe("checkWording", () => {
  const original = { text: "Library text.", evidence: "Library evidence.", reference: "Library reference." };
  const input = (over: Partial<Record<"body" | "evidence" | "reference", string>> = {}) => ({ body: original.text, evidence: original.evidence, reference: original.reference, ...over });

  it("returns null for a field the same as the library's, so it stays the library's", () => {
    expect(checkWording(input(), original)).toEqual({ ok: true, value: { body: null, evidence: null, reference: null } });
    expect(checkWording(input({ body: "  Library text.  " }), original)).toEqual({ ok: true, value: { body: null, evidence: null, reference: null } });
    expect(checkWording(input({ body: "Invented text." }), original)).toEqual({ ok: true, value: { body: "Invented text.", evidence: null, reference: null } });
  });

  it("trims the text and turns line endings into newlines", () => {
    expect(checkWording(input({ body: "  Line one.\r\nLine two.  " }), original)).toMatchObject({ ok: true, value: { body: "Line one.\nLine two." } });
  });

  it("refuses blank wording for a field the library fills", () => {
    expect(checkWording(input({ body: "   " }), original)).toEqual({ ok: false, message: "Write the procedure wording: it cannot be blank." });
    expect(checkWording(input({ evidence: "" }), original)).toEqual({ ok: false, message: "Write the evidence: it cannot be blank." });
    expect(checkWording(input({ reference: "" }), original)).toEqual({ ok: false, message: "Write the reference: it cannot be blank." });
  });

  it("accepts a blank field when the library's own field is blank", () => {
    expect(checkWording(input({ reference: "" }), { ...original, reference: "" })).toEqual({ ok: true, value: { body: null, evidence: null, reference: null } });
  });

  it("refuses evidence that starts \"Partner sign-off\" (any case) when the library's does not, and removing it when the library's does", () => {
    for (const typed of ["Partner sign-off on the file.", "  partner SIGN-OFF recorded", "PARTNER SIGN-OFF"]) {
      const checked = checkWording(input({ evidence: typed }), original);
      expect(checked.ok, typed).toBe(false);
      expect(checked.ok ? "" : checked.message).toMatch(/Partner sign-off/);
    }
    expect(checkWording(input({ evidence: "Reviewed by the partner; Partner sign-off follows." }), original).ok).toBe(true);
    const partnerStep = { ...original, evidence: "Partner sign-off recorded." };
    expect(checkWording({ ...input(), evidence: "Partner sign-off noted on the file." }, partnerStep).ok).toBe(true);
    expect(checkWording({ ...input(), evidence: "Signed by the partner." }, partnerStep).ok).toBe(false);
  });

  it("limits the body to 2,000 characters and the evidence and reference to 300", () => {
    expect(MAX_BODY).toBe(2000);
    expect(MAX_EVIDENCE).toBe(300);
    expect(MAX_REFERENCE).toBe(300);
    expect(checkWording(input({ body: "x".repeat(2000) }), original).ok).toBe(true);
    expect(checkWording(input({ body: "x".repeat(2001) }), original)).toEqual({ ok: false, message: "The procedure wording is too long. Keep it to 2,000 characters." });
    expect(checkWording(input({ evidence: "x".repeat(300) }), original).ok).toBe(true);
    expect(checkWording(input({ evidence: "x".repeat(301) }), original)).toEqual({ ok: false, message: "The evidence is too long. Keep it to 300 characters." });
    expect(checkWording(input({ reference: "x".repeat(301) }), original)).toEqual({ ok: false, message: "The reference is too long. Keep it to 300 characters." });
  });
});

describe("the state of a procedure, for the page", () => {
  it("is the library's, the firm's own wording, or hidden", () => {
    expect(stateOf(undefined)).toBe("library");
    expect(stateOf(change("C5.01"))).toBe("library");
    expect(stateOf(change("C5.01", { body: "Invented." }))).toBe("edited");
    expect(stateOf(change("C5.01", { hidden: true }))).toBe("hidden");
    expect(stateOf(change("C5.01", { hidden: true, body: "Invented." }))).toBe("hidden");
    expect(STATE_BADGE).toMatchObject({ library: { label: "Library draft" }, edited: { label: "Your firm's wording" }, hidden: { label: "Hidden" } });
  });

  it("summarises an area in words", () => {
    expect(areaSummary(["library", "library"])).toBe("No changes");
    expect(areaSummary(["edited", "library", "edited"])).toBe("2 edited");
    expect(areaSummary(["edited", "hidden", "hidden"])).toBe("1 edited, 2 hidden");
  });

  it("lets partner-level roles edit and no one else", () => {
    expect(["partner", "admin"].map(canEditMethodology)).toEqual([true, true]);
    expect(["reviewer", "preparer"].map(canEditMethodology)).toEqual([false, false]);
  });
});
