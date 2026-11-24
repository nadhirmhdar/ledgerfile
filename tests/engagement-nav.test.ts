import { describe, expect, it } from "vitest";
import { areaCrumbs, groupOfTab, NAV_COOKIE, NAV_GROUPS, openGroups, parseOpenGroups, scheduleCrumbs, sectionHref, serializeOpenGroups, stripScrollLeft, tabForPath } from "../src/ui/engagement-nav";

const labels = (id: string) => NAV_GROUPS.find((g) => g.id === id)!.items.map((i) => i.label);

describe("the groups", () => {
  it("lists the audit work in work order, with the new entries", () => {
    expect(labels("audit")).toEqual(["Planning", "Planning questionnaire", "Confirmations", "Journal testing", "Analytical review", "Client requests"]);
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

describe("which groups of sections are open", () => {
  it("opens only the current page's group when nothing is remembered", () => {
    expect(openGroups("tb", undefined)).toEqual(["setup"]);
    expect(openGroups("home", null)).toEqual(["overview"]);
    expect(openGroups("review", "")).toEqual(["finish"]);
    expect(openGroups("confirmations", undefined)).toEqual(["audit"]);
    expect(openGroups("requests", undefined)).toEqual(["audit"]);
  });

  it("adds the groups remembered, in the order of the sidebar, and always the current one", () => {
    expect(openGroups("tb", "finish.audit")).toEqual(["setup", "audit", "finish"]);
    expect(openGroups("papers", "overview")).toEqual(["overview", "file"]);
    // The current group is open whatever the cookie says.
    expect(openGroups("tb", "audit")).toEqual(["setup", "audit"]);
  });

  it("treats a missing, empty or garbled cookie as the defaults", () => {
    for (const bad of [undefined, null, "", ".", "..", "nonsense", "Setup", "setup,audit", "setup;audit", "%00", "x".repeat(500), "audit.audit.audit", "__proto__", "constructor"]) {
      const open = openGroups("tb", bad);
      if (bad === "audit.audit.audit") expect(open).toEqual(["setup", "audit"]);
      else expect(open, String(bad)).toEqual(["setup"]);
    }
  });

  it("ignores ids that are not groups, and keeps the ones that are", () => {
    expect(parseOpenGroups("setup.nonsense.finish")).toEqual(["setup", "finish"]);
    expect(parseOpenGroups("finish.setup")).toEqual(["setup", "finish"]);
  });

  it("round-trips: what is written is what is read, in the sidebar's order", () => {
    for (const ids of [[], ["audit"], ["finish", "overview"], ["overview", "setup", "audit", "file", "finish"]]) {
      expect(parseOpenGroups(serializeOpenGroups(ids))).toEqual(NAV_GROUPS.map((g) => g.id as string).filter((id) => ids.includes(id)));
    }
    expect(serializeOpenGroups(["finish", "setup"])).toBe("setup.finish");
    expect(serializeOpenGroups(new Set(["audit"]))).toBe("audit");
    expect(serializeOpenGroups(["nonsense"])).toBe("");
  });

  it("finds the group of every section", () => {
    for (const g of NAV_GROUPS) for (const item of g.items) expect(groupOfTab(item.key)).toBe(g.id);
  });

  it("uses a cookie name and a value that are safe in a cookie", () => {
    expect(NAV_COOKIE).toBe("lf_nav");
    expect(serializeOpenGroups(NAV_GROUPS.map((g) => g.id))).toMatch(/^[a-z.]+$/);
  });
});
