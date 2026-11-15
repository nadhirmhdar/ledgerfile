import { describe, expect, it } from "vitest";
import {
  AREA_OF_GROUP,
  buildIndex,
  cleanFileReference,
  cleanSectionCode,
  compareEntries,
  countEntries,
  filterIndex,
  homeOfFile,
  leadSheetReference,
  leadSheetStatus,
  naturalCompare,
  peopleLabel,
  riskStatus,
  scheduleStatus,
  sectionOfCode,
  SECTIONS,
  stepsStatus,
  type IndexEntry,
} from "../src/domain/wp-index";
import { AREAS, CHECKLISTS } from "../src/domain/audit";
import { GROUPS } from "../src/domain/groups";

const entry = (over: Partial<IndexEntry> & Pick<IndexEntry, "section" | "reference">): IndexEntry => ({
  title: over.reference ?? "file",
  kind: "checklist",
  href: "/x",
  preparedBy: null,
  preparedOn: null,
  reviewedBy: null,
  reviewedOn: null,
  status: "not_started",
  reviewable: true,
  note: null,
  ...over,
});

describe("working paper index ordering", () => {
  it("orders references naturally: C2 before C10, B2 before B2.M before B3", () => {
    expect(["C10", "C2", "C1", "C16", "C9"].sort(naturalCompare)).toEqual(["C1", "C2", "C9", "C10", "C16"]);
    expect(["B3", "B2.M", "B10", "B2", "B8.R", "B8"].sort(naturalCompare)).toEqual(["B2", "B2.M", "B3", "B8", "B8.R", "B10"]);
    expect(["C5-10", "C5-2", "C5-1"].sort(naturalCompare)).toEqual(["C5-1", "C5-2", "C5-10"]);
  });

  it("lists sections general, acceptance, planning, then areas in numeric order, then completion, reporting and unfiled", () => {
    const codes = SECTIONS.map((s) => s.code);
    expect(codes.slice(0, 3)).toEqual(["G", "A", "B"]);
    expect(codes.slice(3, 19)).toEqual(Array.from({ length: 16 }, (_, i) => `C${i + 1}`));
    expect(codes.slice(19)).toEqual(["D", "E", "UNFILED"]);
    expect(codes.indexOf("C2")).toBeLessThan(codes.indexOf("C10"));
  });

  it("puts an area's lead sheets, procedures, journal testing, schedules and then files together, files with a reference first", () => {
    const e = [
      entry({ section: "C5", reference: null, kind: "file", title: "zzz.pdf" }),
      entry({ section: "C5", reference: "C5-F2", kind: "file" }),
      entry({ section: "C5", reference: "C5-2", kind: "schedule" }),
      entry({ section: "C5", reference: "C5.P", kind: "procedures" }),
      entry({ section: "C5", reference: "C5-1", kind: "schedule" }),
      entry({ section: "C5", reference: "C5.L1", kind: "lead_sheet" }),
      entry({ section: "C5", reference: null, kind: "file", title: "aaa.pdf" }),
      entry({ section: "C5", reference: "C5-F1", kind: "file" }),
      entry({ section: "C10", reference: "C10.P", kind: "procedures" }),
      entry({ section: "C2", reference: "C2.P", kind: "procedures" }),
      entry({ section: "G", reference: "G2", kind: "journals" }),
      entry({ section: "UNFILED", reference: null, kind: "file", title: "loose.pdf" }),
      entry({ section: "B", reference: "B3", kind: "checklist" }),
      entry({ section: "B", reference: "B2.M", kind: "materiality" }),
      entry({ section: "B", reference: "B2", kind: "checklist" }),
    ];
    const ordered = e.slice().sort(compareEntries).map((x) => `${x.section}:${x.reference ?? x.title}`);
    expect(ordered).toEqual([
      "G:G2",
      "B:B2",
      "B:B2.M",
      "B:B3",
      "C2:C2.P",
      "C5:C5.L1",
      "C5:C5.P",
      "C5:C5-1",
      "C5:C5-2",
      "C5:C5-F1",
      "C5:C5-F2",
      "C5:aaa.pdf",
      "C5:zzz.pdf",
      "C10:C10.P",
      "UNFILED:loose.pdf",
    ]);
  });
});

describe("the reference scheme", () => {
  it("keeps the references the product already uses and adds only suffixes and a general series", () => {
    // Checklist codes are numbered by the library: A1.., B1.., D1.., E1..
    for (const c of CHECKLISTS) expect(c.code).toMatch(/^[ABDE]\d{1,2}$/);
    expect(leadSheetReference("TRADEREC")).toBe("C5.L1");
    expect(leadSheetReference("RPREC")).toBe("C7.L1");
    expect(leadSheetReference("RPPAY")).toBe("C7.L2");
  });

  it("gives every lead sheet group an area, so no lead sheet is left without a place", () => {
    for (const g of GROUPS) expect(AREA_OF_GROUP.has(g.code), g.code).toBe(true);
  });

  it("gives every lead sheet group a different reference, which does not depend on the year's balances", () => {
    const refs = GROUPS.map((g) => leadSheetReference(g.code));
    expect(new Set(refs).size).toBe(refs.length);
    // The place comes from the area's fixed list of groups.
    for (const a of AREAS) a.groups.forEach((g, i) => expect(leadSheetReference(g)).toBe(`${a.code}.L${i + 1}`));
  });

  it("maps checklists to their stage's section and areas to themselves", () => {
    expect(sectionOfCode("B8")).toBe("B");
    expect(sectionOfCode("A1")).toBe("A");
    expect(sectionOfCode("D8")).toBe("D");
    expect(sectionOfCode("C16")).toBe("C16");
    expect(sectionOfCode("E4")).toBeNull(); // after-report checklist, not on the file
    expect(sectionOfCode("Z9")).toBeNull();
  });
});

describe("file references", () => {
  it("accepts the area or checklist code, -F and a number, whatever the case or spacing", () => {
    expect(cleanFileReference(" c5-f1 ")).toBe("C5-F1");
    expect(cleanFileReference("B8-F12")).toBe("B8-F12");
    expect(cleanFileReference("")).toBeNull();
    expect(cleanFileReference(null)).toBeNull();
  });

  it("refuses every shape the application makes itself, so a typed reference never collides with a derived one", () => {
    const derived = ["C5-1", "C5.P", "C5.L1", "C16.J", "B2.M", "B8.R", "B3.A", "A3.L", "D5.L", "D1.M", "G1", "G5", "B8", "C5"];
    for (const d of derived) expect(() => cleanFileReference(d), d).toThrow(/-F/);
  });

  it("refuses a code that is not on the file, and malformed numbers", () => {
    expect(() => cleanFileReference("C17-F1")).toThrow(/not an area or checklist/);
    expect(() => cleanFileReference("E4-F1")).toThrow(/not an area or checklist/);
    expect(() => cleanFileReference("C5-F")).toThrow(/-F/);
    expect(() => cleanFileReference("C5-F1234")).toThrow(/-F/);
    expect(() => cleanFileReference("5-F1")).toThrow(/-F/);
  });

  it("checks the code a file is filed under", () => {
    expect(cleanSectionCode(" c5 ")).toBe("C5");
    expect(cleanSectionCode("")).toBeNull();
    expect(() => cleanSectionCode("C99")).toThrow(/area or checklist/);
  });

  it("files by what the file supports: lead sheet's area, procedure's area or checklist, else the chosen place, else unfiled", () => {
    expect(homeOfFile({ targetKind: "lead_sheet", target: "TRADEREC", procedureTemplate: null, sectionCode: null })).toBe("C5");
    expect(homeOfFile({ targetKind: "procedure", target: "id", procedureTemplate: "C1.03", sectionCode: null })).toBe("C1");
    expect(homeOfFile({ targetKind: "procedure", target: "id", procedureTemplate: "B8.02", sectionCode: null })).toBe("B8");
    expect(homeOfFile({ targetKind: "procedure", target: "id", procedureTemplate: null, sectionCode: null })).toBeNull();
    expect(homeOfFile({ targetKind: "engagement", target: null, procedureTemplate: null, sectionCode: "C6" })).toBe("C6");
    expect(homeOfFile({ targetKind: "engagement", target: null, procedureTemplate: null, sectionCode: null })).toBeNull();
  });
});

describe("status rules", () => {
  it("rolls steps up by the lock's rules: finished is not open, and a finished step needs review unless it is the partner's own", () => {
    expect(stepsStatus({ total: 0, open: 0, notApplicable: 0, unreviewed: 0 })).toBe("not_started");
    expect(stepsStatus({ total: 5, open: 5, notApplicable: 0, unreviewed: 0 })).toBe("not_started");
    expect(stepsStatus({ total: 5, open: 2, notApplicable: 0, unreviewed: 3 })).toBe("in_progress");
    expect(stepsStatus({ total: 5, open: 0, notApplicable: 0, unreviewed: 2 })).toBe("prepared");
    expect(stepsStatus({ total: 5, open: 0, notApplicable: 1, unreviewed: 0 })).toBe("reviewed");
    expect(stepsStatus({ total: 3, open: 0, notApplicable: 3, unreviewed: 3 })).toBe("not_applicable");
  });

  it("treats a lead sheet as reviewed once a reviewer signed, in progress while review points are open", () => {
    expect(leadSheetStatus({ prepared: false, reviewed: false, openPoints: 0 })).toBe("not_started");
    expect(leadSheetStatus({ prepared: true, reviewed: false, openPoints: 0 })).toBe("prepared");
    expect(leadSheetStatus({ prepared: true, reviewed: false, openPoints: 2 })).toBe("in_progress");
    expect(leadSheetStatus({ prepared: true, reviewed: true, openPoints: 0 })).toBe("reviewed");
  });

  it("treats a schedule as prepared only with a conclusion and no unexplained difference", () => {
    const s = { hasLines: true, hasConclusion: false, reviewed: false, differenceUnexplained: false };
    expect(scheduleStatus({ ...s, hasLines: false })).toBe("not_started");
    expect(scheduleStatus(s)).toBe("in_progress");
    expect(scheduleStatus({ ...s, hasConclusion: true })).toBe("prepared");
    expect(scheduleStatus({ ...s, hasConclusion: true, differenceUnexplained: true })).toBe("in_progress");
    expect(scheduleStatus({ ...s, hasConclusion: true, reviewed: true })).toBe("reviewed");
  });

  it("counts the partner's approval of the risk assessment as its review only while it stands", () => {
    expect(riskStatus({ anyRated: false, unassessed: 5, approval: "none" })).toBe("not_started");
    expect(riskStatus({ anyRated: true, unassessed: 2, approval: "none" })).toBe("in_progress");
    expect(riskStatus({ anyRated: true, unassessed: 0, approval: "none" })).toBe("prepared");
    expect(riskStatus({ anyRated: true, unassessed: 0, approval: "current" })).toBe("reviewed");
    expect(riskStatus({ anyRated: true, unassessed: 0, approval: "lapsed" })).toBe("in_progress");
  });

  it("names one person or counts several", () => {
    expect(peopleLabel([])).toBeNull();
    expect(peopleLabel(["Asha", "Asha"])).toBe("Asha");
    expect(peopleLabel(["Asha", "Ben"])).toBe("2 people");
  });
});

describe("summary counts and filters", () => {
  const e = [
    entry({ section: "G", reference: "G1", reviewable: false, status: "prepared" }),
    entry({ section: "G", reference: "G2", reviewable: false, status: "not_applicable" }),
    entry({ section: "C5", reference: "C5.L1", status: "reviewed" }),
    entry({ section: "C5", reference: "C5.P", status: "in_progress" }),
    entry({ section: "C2", reference: "C2.L1", status: "not_started" }),
    entry({ section: "C10", reference: "C10.L1", status: "prepared" }),
    entry({ section: "C10", reference: "C10-F1", kind: "file", reviewable: false, status: "prepared" }),
  ];

  it("counts by status and counts only papers with a review step as still to review", () => {
    expect(countEntries(e)).toEqual({ total: 7, notStarted: 1, inProgress: 1, prepared: 3, reviewed: 1, notApplicable: 1, toReview: 3 });
  });

  it("groups by section in file order, with C2 before C10, per-section counts, and no empty sections", () => {
    const index = buildIndex(e);
    expect(index.sections.map((s) => s.code)).toEqual(["G", "C2", "C5", "C10"]);
    expect(index.sections.find((s) => s.code === "C10")!.counts).toMatchObject({ total: 2, prepared: 2, toReview: 1 });
    expect(index.overall.total).toBe(7);
  });

  it("filters to papers not yet reviewed, or not started, dropping sections that empty out", () => {
    const index = buildIndex(e);
    expect(filterIndex(index, "unreviewed").flatMap((s) => s.entries.map((x) => x.reference))).toEqual(["C2.L1", "C5.P", "C10.L1"]);
    expect(filterIndex(index, "not_started").map((s) => s.code)).toEqual(["C2"]);
    expect(filterIndex(index, "all")).toHaveLength(4);
  });
});
