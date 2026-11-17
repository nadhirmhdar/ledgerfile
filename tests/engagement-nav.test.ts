import { describe, expect, it } from "vitest";
import { areaCrumbs, NAV_GROUPS, scheduleCrumbs, sectionHref, stripScrollLeft, tabForPath } from "../src/ui/engagement-nav";

const labels = (id: string) => NAV_GROUPS.find((g) => g.id === id)!.items.map((i) => i.label);

describe("the groups", () => {
  it("lists the audit work in work order, with the new entries", () => {
    expect(labels("audit")).toEqual(["Planning", "Confirmations", "Journal testing", "Analytical review", "Client requests"]);
    expect(labels("finish")).toEqual(["Letters", "Auditor's report", "Review and sign-off"]);
  });
  it("keeps the other groups as they were", () => {
    expect(labels("overview")).toEqual(["Home"]);
    expect(labels("setup")).toEqual(["Trial balance and mapping", "Lead sheets", "Journal entries"]);
    expect(labels("file")).toEqual(["Working papers", "Index", "Financial statements"]);
  });
  it("has a unique key and path for every item", () => {
    const items = NAV_GROUPS.flatMap((g) => [...g.items] as { key: string; path: string }[]);
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
    expect(new Set(items.map((i) => i.path)).size).toBe(items.length);
  });
  it("builds an address from the engagement id", () => {
    expect(sectionHref("abc", "/audit/letters")).toBe("/engagements/abc/audit/letters");
    expect(sectionHref("abc", "")).toBe("/engagements/abc");
  });
});

describe("tabForPath", () => {
  it("maps every section's own path to its key", () => {
    for (const g of NAV_GROUPS) for (const i of g.items) expect(tabForPath(i.path)).toBe(i.key);
  });
  it("highlights journal testing, analytical review and letters, not Planning", () => {
    expect(tabForPath("/audit/journals")).toBe("journaltesting");
    expect(tabForPath("/audit/analytics")).toBe("analytics");
    expect(tabForPath("/audit/letters")).toBe("letters");
    expect(tabForPath("/audit/letters/engagement")).toBe("letters");
    expect(tabForPath("/audit/report")).toBe("report");
  });
  it("keeps Planning for the planning page, area pages and schedules", () => {
    expect(tabForPath("/audit")).toBe("audit");
    expect(tabForPath("/audit/C5")).toBe("audit");
    expect(tabForPath("/audit/C5/schedules/abc")).toBe("audit");
    expect(tabForPath("/audit/schedules-export")).toBe("audit");
  });
  it("tells journal testing from the adjusting journal entries", () => {
    expect(tabForPath("/journals")).toBe("journals");
    expect(tabForPath("/audit/journals")).toBe("journaltesting");
  });
  it("ignores a trailing slash, and knows nothing about a path outside the engagement", () => {
    expect(tabForPath("/review/")).toBe("review");
    expect(tabForPath("/")).toBe("home");
    expect(tabForPath("/unknown")).toBeNull();
  });
});

describe("breadcrumbs", () => {
  const area = { code: "C5", title: "Trade and other receivables" };
  it("the area page: All engagements, Planning, then the page as text", () => {
    expect(areaCrumbs("e1", area)).toEqual([
      { label: "All engagements", href: "/" },
      { label: "Planning", href: "/engagements/e1/audit" },
      { label: "C5 Trade and other receivables" },
    ]);
  });
  it("a schedule: through the area, then the schedule as text", () => {
    expect(scheduleCrumbs("e1", area, { reference: "C5-1", title: "Receivables listing" })).toEqual([
      { label: "All engagements", href: "/" },
      { label: "Planning", href: "/engagements/e1/audit" },
      { label: "C5 Trade and other receivables", href: "/engagements/e1/audit/C5" },
      { label: "C5-1 Receivables listing" },
    ]);
  });
  it("only the last crumb has no link", () => {
    const crumbs = scheduleCrumbs("e1", area, { reference: "C5-1", title: "x" });
    expect(crumbs.slice(0, -1).every((c) => !!c.href)).toBe(true);
    expect(crumbs[crumbs.length - 1].href).toBeUndefined();
  });
});

describe("stripScrollLeft", () => {
  const strip = { stripWidth: 390, stripScrollWidth: 1500, stripScrollLeft: 0 };
  it("centres a child that is off screen", () => {
    // child starts 1000px along and is 100 wide: centred means its middle at 195
    expect(stripScrollLeft({ ...strip, childLeft: 1000, childWidth: 100 })).toBe(855);
  });
  it("does not scroll for an item at the start", () => {
    expect(stripScrollLeft({ ...strip, childLeft: 10, childWidth: 100 })).toBe(0);
  });
  it("never scrolls past the end of the strip", () => {
    expect(stripScrollLeft({ ...strip, childLeft: 1450, childWidth: 100 })).toBe(1110);
  });
  it("takes the strip's current scroll into account", () => {
    expect(stripScrollLeft({ stripWidth: 390, stripScrollWidth: 1500, stripScrollLeft: 300, childLeft: 600, childWidth: 100 })).toBe(755);
  });
  it("is zero when nothing scrolls", () => {
    expect(stripScrollLeft({ stripWidth: 390, stripScrollWidth: 390, stripScrollLeft: 0, childLeft: 200, childWidth: 100 })).toBe(0);
  });
});
