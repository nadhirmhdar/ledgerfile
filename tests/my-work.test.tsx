import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { dueWords, groupTotal, isRealDate, isShownDue, reportDueState, slotBlocker, slotOptions, sortGroups, type WorkGroup } from "../src/domain/my-work";
import { MyWorkBody, myWorkSubtitle } from "../src/ui/my-work-view";
import { TeamPanel } from "../src/ui/team-panel";

const TODAY = "2026-03-01";

describe("the report due date", () => {
  it("is shown from the past to day 30 and not beyond, or without a date", () => {
    expect(reportDueState(null, TODAY)).toEqual({ kind: "none" });
    expect(reportDueState("2026-02-26", TODAY)).toEqual({ kind: "overdue", days: 3 });
    expect(reportDueState("2026-03-01", TODAY)).toEqual({ kind: "soon", days: 0 });
    expect(reportDueState("2026-03-31", TODAY)).toEqual({ kind: "soon", days: 30 });
    expect(reportDueState("2026-04-01", TODAY)).toEqual({ kind: "later", days: 31 });
    expect([null, "2026-02-26", "2026-03-31", "2026-04-01"].map((d) => isShownDue(reportDueState(d, TODAY)))).toEqual([false, true, true, false]);
  });

  it("is worded, so a late report never rests on colour", () => {
    expect(dueWords(reportDueState("2026-02-28", TODAY))).toBe("Overdue by 1 day");
    expect(dueWords(reportDueState("2026-02-26", TODAY))).toBe("Overdue by 3 days");
    expect(dueWords(reportDueState("2026-03-01", TODAY))).toBe("Due today");
    expect(dueWords(reportDueState("2026-03-02", TODAY))).toBe("Due in 1 day");
    expect(dueWords(reportDueState(null, TODAY))).toBe("No date");
  });

  it("accepts real dates only", () => {
    expect(["2026-02-28", "2028-02-29"].every(isRealDate)).toBe(true);
    expect(["2026-02-29", "2026-13-01", "01/03/2026", "", "2026-3-1"].some(isRealDate)).toBe(false);
  });
});

describe("the places on a team", () => {
  it("asks a reviewer to be able to review and a partner to be able to sign off, and a preparer to be anyone", () => {
    expect(slotBlocker("preparer", "preparer")).toBeNull();
    expect(slotBlocker("reviewer", "preparer")).not.toBeNull();
    expect(slotBlocker("reviewer", "reviewer")).toBeNull();
    expect(slotBlocker("partner", "reviewer")).not.toBeNull();
    expect(slotBlocker("partner", "admin")).toBeNull();
  });
});

describe("the options in each select", () => {
  const people = [
    { id: "p", name: "Pia", role: "preparer" as const },
    { id: "r", name: "Rae", role: "reviewer" as const },
    { id: "s", name: "Sol", role: "partner" as const },
    { id: "a", name: "Ada", role: "admin" as const },
  ];
  it("offers only the people the server accepts for that place", () => {
    expect(slotOptions("preparer", people, null).map((o) => o.id)).toEqual(["p", "r", "s", "a"]);
    expect(slotOptions("reviewer", people, null).map((o) => o.id)).toEqual(["r", "s", "a"]);
    expect(slotOptions("partner", people, null).map((o) => o.id)).toEqual(["s", "a"]);
  });
  it("keeps a saved person who no longer qualifies, marked, and only that person", () => {
    const opts = slotOptions("partner", people, "r");
    expect(opts.map((o) => o.id)).toEqual(["r", "s", "a"]);
    expect(opts.map((o) => o.stale)).toEqual([true, false, false]);
  });
  it("renders the stale person with the reason in the Team form", () => {
    const team = { preparer: null, reviewer: { id: "p", name: "Pia", role: "preparer" as const }, partner: null, reportDueOn: null };
    const html = renderToStaticMarkup(<TeamPanel engagementId="e" team={team} people={people} canAssign today="2026-03-01" />);
    expect(html).toContain("Pia (Preparer), no longer a reviewer");
    // The engagement team form, before the areas section: the preparer select and the stale reviewer; none under partner.
    expect(html.split('id="area-teams"')[0].match(/Pia \(Preparer\)/g)).toHaveLength(2);
  });
});

const group = (over: Partial<WorkGroup> & { clientName: string }): WorkGroup => ({
  engagementId: over.clientName,
  periodEnd: "2025-12-31",
  reportDueOn: null,
  due: { kind: "none" },
  roles: ["Preparer"],
  lines: [{ key: `${over.clientName}:x`, kind: "prepare", label: "2 procedures still open", count: 2, href: "/engagements/x/audit" }],
  ...over,
});

describe("the order of the groups", () => {
  it("is earliest date first, undated last, then by client name", () => {
    const sorted = sortGroups([
      group({ clientName: "Zed", reportDueOn: "2026-03-20" }),
      group({ clientName: "Undated B" }),
      group({ clientName: "Alpha", reportDueOn: "2026-03-20" }),
      group({ clientName: "Late", reportDueOn: "2026-02-20" }),
      group({ clientName: "Undated A" }),
    ]).map((g) => g.clientName);
    expect(sorted).toEqual(["Late", "Alpha", "Zed", "Undated A", "Undated B"]);
  });
});

describe("the My work page body", () => {
  it("shows the empty state in one sentence, with a link to assign people for a partner", () => {
    const partner = renderToStaticMarkup(<MyWorkBody groups={[]} mayAssign />);
    expect(partner).toContain("Nothing waits for you");
    expect(partner).toContain("Engagements you are assigned to will show their open work here.");
    expect(partner).toContain('href="/"');
    expect(partner).toContain("assign people");
    const preparer = renderToStaticMarkup(<MyWorkBody groups={[]} mayAssign={false} />);
    expect(preparer).toContain("Nothing waits for you");
    expect(preparer).not.toContain("assign people");
    expect(myWorkSubtitle([])).toBe("Nothing waits for you.");
  });

  it("groups the lines by engagement with a count, links each line, and says Overdue in words", () => {
    const late = group({
      clientName: "Late Foods LLC",
      engagementId: "11111111-1111-4111-8111-111111111111",
      reportDueOn: "2026-02-26",
      due: { kind: "overdue", days: 3 },
      lines: [
        { key: "a:1", kind: "prepare", label: "3 procedures still open", count: 3, href: "/engagements/11111111-1111-4111-8111-111111111111/audit/C5" },
        { key: "a:2", kind: "due", label: "Report overdue by 3 days", count: 1, href: "/engagements/11111111-1111-4111-8111-111111111111" },
      ],
    });
    expect(groupTotal(late)).toBe(4);
    const html = renderToStaticMarkup(<MyWorkBody groups={[late]} mayAssign={false} />);
    expect(html).toContain("Late Foods LLC");
    expect(html).toContain("4 things");
    expect(html).toContain("Overdue by 3 days");
    expect(html).toContain("You are preparer");
    expect(html).not.toContain("·");
    expect(html).toContain('href="/engagements/11111111-1111-4111-8111-111111111111/audit/C5"');
    expect(html).toContain("To prepare");
    expect(html).toContain("Report due");
    expect(myWorkSubtitle([late])).toBe("4 things waiting on 1 engagement.");
  });
});

describe("the Team panel", () => {
  const team = { preparer: { id: "p", name: "Pia Preparer", role: "preparer" as const }, reviewer: null, partner: null, reportDueOn: null };
  it("is read-only for anyone who cannot assign, with Not assigned and No date in words", () => {
    const html = renderToStaticMarkup(<TeamPanel engagementId="e" team={team} people={[]} canAssign={false} today="2026-03-01" />);
    expect(html).toContain("Pia Preparer");
    expect(html).toContain("Not assigned");
    expect(html).toContain("No date");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Save the team");
  });
  it("shows the form to a partner on an open engagement", () => {
    const html = renderToStaticMarkup(<TeamPanel engagementId="e" team={team} people={[{ id: "p", name: "Pia Preparer", role: "preparer" }]} canAssign today="2026-03-01" />);
    expect(html).toContain("Save the team");
    expect(html).toContain("Pia Preparer (Preparer)");
  });
});
