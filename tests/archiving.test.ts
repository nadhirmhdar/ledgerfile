import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ASSEMBLY_DAYS, ASSEMBLY_RULE, archiveBlocker, archiveConfirmationMatches, assemblyDeadline, daysBetween, deadlineState, deadlineWords, type ArchiveFacts } from "../src/domain/archiving";
import { archiveSection, ARCHIVE_IRREVERSIBLE, ARCHIVE_PREVENTS, ARCHIVE_STAYS, deadlineView } from "../src/ui/archive-view";
import { readinessView } from "../src/ui/review-view";

describe("the file assembly deadline", () => {
  it("is the report date and 60 days, one constant, stated plainly and no longer as draft guidance", () => {
    expect(ASSEMBLY_DAYS).toBe(60);
    expect(ASSEMBLY_RULE).toBe("The file is due to be assembled within 60 days of the date of the auditor's report.");
    expect(ASSEMBLY_RULE).not.toMatch(/draft|default|confirm/i);
    expect(assemblyDeadline("2026-01-01")).toBe("2026-03-02");
    // The word "draft guidance" is gone from the archiving code, page and tests.
    for (const file of ["src/domain/archiving.ts", "src/app/(app)/engagements/[id]/review/page.tsx", "src/ui/archive-view.ts", "src/server/archiving.ts"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/draft guidance|default for the firm to confirm|DEFAULT TO CONFIRM/i);
    }
  });
  it("follows the calendar across month ends", () => {
    expect(assemblyDeadline("2025-12-31")).toBe("2026-03-01");
    expect(assemblyDeadline("2026-11-20")).toBe("2027-01-19");
    expect(assemblyDeadline("2026-04-30")).toBe("2026-06-29");
    expect(assemblyDeadline("2026-08-01")).toBe("2026-09-30");
  });
  it("follows the calendar across leap years", () => {
    expect(assemblyDeadline("2024-01-01")).toBe("2024-03-01");
    expect(assemblyDeadline("2025-01-01")).toBe("2025-03-02");
    expect(assemblyDeadline("2023-12-31")).toBe("2024-02-29");
    expect(assemblyDeadline("2024-12-31")).toBe("2025-03-01");
    expect(assemblyDeadline("2024-02-29")).toBe("2024-04-29");
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2);
    expect(daysBetween("2025-02-28", "2025-03-01")).toBe(1);
  });
  it("refuses a date that is not real", () => {
    expect(() => assemblyDeadline("2026-02-30")).toThrow();
    expect(() => assemblyDeadline("soon")).toThrow();
  });
});

describe("where a file stands against its deadline", () => {
  const report = "2026-01-01"; // deadline 2026-03-02
  it("says there is no deadline without a report date", () => {
    expect(deadlineState(null, "2026-03-01", null)).toEqual({ kind: "no_report_date" });
    expect(deadlineWords({ kind: "no_report_date" })).toMatch(/No report date/);
  });
  it("is due in N days before the deadline, with the singular", () => {
    expect(deadlineState(report, "2026-01-01", null)).toEqual({ kind: "due", days: 60, deadline: "2026-03-02" });
    expect(deadlineState(report, "2026-03-01", null)).toEqual({ kind: "due", days: 1, deadline: "2026-03-02" });
    expect(deadlineWords(deadlineState(report, "2026-03-01", null))).toBe("The file is due to be assembled by 2026-03-02, in 1 day.");
    expect(deadlineWords(deadlineState(report, "2026-02-28", null))).toBe("The file is due to be assembled by 2026-03-02, in 2 days.");
  });
  it("is due today on the day", () => {
    expect(deadlineState(report, "2026-03-02", null)).toEqual({ kind: "today", deadline: "2026-03-02" });
    expect(deadlineWords({ kind: "today", deadline: "2026-03-02" })).toBe("The file is due to be assembled today (2026-03-02).");
  });
  it("is overdue by N days after it", () => {
    expect(deadlineState(report, "2026-03-03", null)).toEqual({ kind: "overdue", days: 1, deadline: "2026-03-02" });
    expect(deadlineState(report, "2026-03-12", null)).toEqual({ kind: "overdue", days: 10, deadline: "2026-03-02" });
    expect(deadlineWords(deadlineState(report, "2026-03-12", null))).toMatch(/overdue by 10 days/);
  });
  it("is simply archived once archived, whatever the dates", () => {
    expect(deadlineState(report, "2027-01-01", "2026-02-20")).toEqual({ kind: "archived", on: "2026-02-20", deadline: "2026-03-02" });
    expect(deadlineState(null, "2027-01-01", "2026-02-20")).toEqual({ kind: "archived", on: "2026-02-20", deadline: null });
    expect(deadlineWords({ kind: "archived", on: "2026-02-20", deadline: null })).toBe("Archived on 2026-02-20.");
  });
});

describe("the typed confirmation", () => {
  it("matches the client's name exactly, ignoring case and the space at either end", () => {
    expect(archiveConfirmationMatches("Falcon Trading LLC", "Falcon Trading LLC")).toBe(true);
    expect(archiveConfirmationMatches("  falcon trading llc ", "Falcon Trading LLC")).toBe(true);
    expect(archiveConfirmationMatches("FALCON TRADING LLC", "Falcon Trading LLC")).toBe(true);
  });
  it("does not match anything else", () => {
    for (const typed of ["", "Falcon Trading", "Falcon Trading LLC.", "Falcon  Trading LLC", "falcon-trading-llc", "Archive"]) expect(archiveConfirmationMatches(typed, "Falcon Trading LLC")).toBe(false);
    expect(archiveConfirmationMatches("", "")).toBe(false);
    expect(archiveConfirmationMatches("  ", "  ")).toBe(false);
  });
});

describe("when a file may be archived", () => {
  const ok: ArchiveFacts = { locked: true, archived: false, audited: true, hasOpinion: true, reportDate: "2026-01-10", today: "2026-02-01" };
  it("may, when it is locked, audited, has an opinion with a report date that has passed", () => {
    expect(archiveBlocker(ok)).toBeNull();
    expect(archiveBlocker({ ...ok, today: "2026-01-10" })).toBeNull();
  });
  it("says why not, in order", () => {
    expect(archiveBlocker({ ...ok, archived: true })).toBe("This file is already archived.");
    expect(archiveBlocker({ ...ok, locked: false })).toMatch(/only after it has been locked/);
    expect(archiveBlocker({ ...ok, audited: false })).toMatch(/audited files/);
    expect(archiveBlocker({ ...ok, hasOpinion: false, reportDate: null })).toMatch(/audit opinion first/);
    expect(archiveBlocker({ ...ok, reportDate: null })).toMatch(/date of the auditor's report first/);
    expect(archiveBlocker({ ...ok, today: "2026-01-09" })).toBe("The auditor's report is dated 2026-01-10. The file cannot be archived before that date.");
  });
});

describe("the Review page's words", () => {
  it("shows the deadline as a pill with words, amber when overdue or due today", () => {
    expect(deadlineView("2026-01-01", "2026-03-12", null)).toMatchObject({ tone: "warning", label: "Overdue by 10 days" });
    expect(deadlineView("2026-01-01", "2026-03-03", null)).toMatchObject({ tone: "warning", label: "Overdue by 1 day" });
    expect(deadlineView("2026-01-01", "2026-03-02", null)).toMatchObject({ tone: "warning", label: "Due today" });
    expect(deadlineView("2026-01-01", "2026-02-20", null)).toMatchObject({ tone: "info", label: "Due in 10 days" });
    expect(deadlineView(null, "2026-02-20", null)).toMatchObject({ tone: "neutral", label: "No report date" });
    expect(deadlineView("2026-01-01", "2026-03-12", "2026-02-20")).toMatchObject({ tone: "slate", label: "Archived", words: "Archived on 2026-02-20." });
  });
  it("says exactly what archiving prevents, what stays, and that it cannot be undone", () => {
    expect(ARCHIVE_IRREVERSIBLE).toBe("This cannot be undone.");
    expect(ARCHIVE_PREVENTS.join(" ")).toMatch(/never be unlocked/);
    expect(ARCHIVE_PREVENTS.join(" ")).toMatch(/Nothing on the file can be changed/);
    expect(ARCHIVE_STAYS).toMatch(/download and export/);
    expect(ARCHIVE_STAYS).toMatch(/still recorded/);
  });
  it("offers the archive section only to a partner or administrator, on a locked, audited, not yet archived file", () => {
    const facts = { locked: true, archived: false, audited: true, hasOpinion: true, reportDate: "2026-01-10", today: "2026-02-01" };
    expect(archiveSection({ ...facts, role: "partner" })).toEqual({ show: true, blocker: null });
    expect(archiveSection({ ...facts, role: "admin" })).toEqual({ show: true, blocker: null });
    for (const role of ["reviewer", "preparer"] as const) expect(archiveSection({ ...facts, role }).show).toBe(false);
    expect(archiveSection({ ...facts, role: "partner", locked: false }).show).toBe(false);
    expect(archiveSection({ ...facts, role: "partner", archived: true }).show).toBe(false);
    expect(archiveSection({ ...facts, role: "partner", audited: false }).show).toBe(false);
  });
  it("shows the section but with the reason when the file is not ready to archive", () => {
    const s = archiveSection({ locked: true, archived: false, audited: true, hasOpinion: true, reportDate: "2026-03-01", today: "2026-02-01", role: "partner" });
    expect(s.show).toBe(true);
    expect(s.blocker).toMatch(/cannot be archived before that date/);
  });
  it("words an archived file as archived, with no unlock", () => {
    const v = readinessView({ open: false, ready: true, blockers: 0, role: "partner", lockedByName: "Pat", lockedAt: "2026-01-20 09:00 UTC", archivedAt: "2026-02-20", archivedByName: "Pat" });
    expect(v.sentence).toBe("Archived on 2026-02-20 by Pat.");
    expect(v.canUnlock).toBe(false);
    expect(readinessView({ open: false, ready: true, blockers: 0, role: "partner", lockedByName: "Pat", lockedAt: "x" }).canUnlock).toBe(true);
  });
});

describe("the migration", () => {
  const sql = readFileSync("db/migrations/0022_archiving.sql", "utf8");
  const code = sql.replace(/--.*$/gm, "");
  it("adds two nullable columns with no default, and updates nothing", () => {
    expect(code).toMatch(/add column archived_at timestamptz;/);
    expect(code).toMatch(/add column archived_by uuid references users\(id\);/);
    const alters = code.match(/alter table engagements[^;]*;/g) ?? [];
    expect(alters).toHaveLength(2);
    for (const a of alters) expect(a).not.toMatch(/not null|default/i);
    expect(code).not.toMatch(/\bupdate\s+engagements\b/i);
    expect(code).not.toMatch(/\binsert\s+into\b/i);
    expect(code).not.toMatch(/\bdelete\s+from\b/i);
  });
});
