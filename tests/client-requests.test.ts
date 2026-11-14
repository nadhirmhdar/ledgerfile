import { describe, expect, it } from "vitest";
import { cleanDescription, cleanNote, descriptionKey, isIsoDate, isOverdue, nextStatuses, summarise, todayIso, MAX_DESCRIPTION } from "../src/domain/client-requests";
import { AREA_REQUESTS, DEFAULT_REQUESTS, GENERAL_REQUESTS, REQUEST_DEFAULTS_STATUS } from "../src/domain/client-request-defaults";
import { AREA_BY_CODE, AREAS } from "../src/domain/audit";

describe("client request rules", () => {
  it("calls a request overdue only when it is open and its due date has passed", () => {
    const today = "2025-06-15";
    expect(isOverdue({ status: "open", dueOn: "2025-06-14" }, today)).toBe(true);
    expect(isOverdue({ status: "open", dueOn: "2025-06-15" }, today)).toBe(false); // due today is not late yet
    expect(isOverdue({ status: "open", dueOn: "2025-06-16" }, today)).toBe(false);
    expect(isOverdue({ status: "open", dueOn: null }, today)).toBe(false);
    expect(isOverdue({ status: "received", dueOn: "2025-01-01" }, today)).toBe(false);
    expect(isOverdue({ status: "not_applicable", dueOn: "2025-01-01" }, today)).toBe(false);
  });

  it("moves between statuses only through open", () => {
    expect(nextStatuses("open")).toEqual(["received", "not_applicable"]);
    expect(nextStatuses("received")).toEqual(["open"]);
    expect(nextStatuses("not_applicable")).toEqual(["open"]);
  });

  it("counts open, overdue, received and not applicable, overall and by area", () => {
    const list = [
      { status: "open" as const, dueOn: "2025-06-01", areaCode: "C6" },
      { status: "open" as const, dueOn: "2025-07-01", areaCode: "C6" },
      { status: "open" as const, dueOn: null, areaCode: null },
      { status: "received" as const, dueOn: "2025-05-01", areaCode: "C6" },
      { status: "not_applicable" as const, dueOn: null, areaCode: "C5" },
    ];
    const { overall, byArea } = summarise(list, "2025-06-15");
    // Overdue is part of open: it is the open requests that are late.
    expect(overall).toEqual({ total: 5, open: 3, overdue: 1, received: 1, notApplicable: 1 });
    expect(byArea.get("C6")).toEqual({ total: 3, open: 2, overdue: 1, received: 1, notApplicable: 0 });
    expect(byArea.get("C5")).toEqual({ total: 1, open: 0, overdue: 0, received: 0, notApplicable: 1 });
    expect(byArea.get("general")).toEqual({ total: 1, open: 1, overdue: 0, received: 0, notApplicable: 0 });
    expect(summarise([], "2025-06-15").overall).toEqual({ total: 0, open: 0, overdue: 0, received: 0, notApplicable: 0 });
  });

  it("checks dates are real calendar dates", () => {
    expect(isIsoDate("2025-02-28")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2025-02-29")).toBe(false);
    expect(isIsoDate("2025-13-01")).toBe(false);
    expect(isIsoDate("15/06/2025")).toBe(false);
    expect(isIsoDate("")).toBe(false);
    expect(todayIso(new Date("2025-06-15T10:00:00Z"))).toBe("2025-06-15");
  });

  it("tidies descriptions and notes, and refuses empty or over-long ones", () => {
    expect(cleanDescription("  Bank   statements \n for March ")).toBe("Bank statements for March");
    expect(() => cleanDescription("   ")).toThrow(/Describe/);
    expect(() => cleanDescription("x".repeat(MAX_DESCRIPTION + 1))).toThrow(/too long/);
    expect(cleanNote("  ")).toBeNull();
    expect(cleanNote(null)).toBeNull();
    expect(cleanNote(" kept ")).toBe("kept");
    expect(() => cleanNote("x".repeat(1001))).toThrow(/too long/);
    expect(descriptionKey("  Bank   Statements ")).toBe(descriptionKey("bank statements"));
  });
});

describe("the standard request wording", () => {
  it("is labelled as an unreviewed draft", () => {
    expect(REQUEST_DEFAULTS_STATUS).toMatch(/not reviewed/i);
  });

  it("uses only real audit areas, 2 to 4 for every area but journals, and a handful of general ones", () => {
    expect(GENERAL_REQUESTS.length).toBeGreaterThanOrEqual(4);
    for (const r of AREA_REQUESTS) expect(AREA_BY_CODE.has(r.areaCode!)).toBe(true);
    for (const a of AREAS) {
      const n = AREA_REQUESTS.filter((r) => r.areaCode === a.code).length;
      expect(n, a.code).toBeGreaterThanOrEqual(1);
      expect(n, a.code).toBeLessThanOrEqual(4);
    }
    for (const a of AREAS.filter((x) => x.code !== "C16")) expect(AREA_REQUESTS.filter((r) => r.areaCode === a.code).length, a.code).toBeGreaterThanOrEqual(2);
  });

  it("has no repeated wording and nothing too long", () => {
    const keys = DEFAULT_REQUESTS.map((r) => descriptionKey(r.description));
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of DEFAULT_REQUESTS) expect(r.description.length).toBeLessThanOrEqual(MAX_DESCRIPTION);
  });
});
