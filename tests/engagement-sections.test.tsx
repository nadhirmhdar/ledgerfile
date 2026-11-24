import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EngagementSections } from "../src/app/(app)/engagements/[id]/sections";
import { NAV_GROUPS, openGroups } from "../src/ui/engagement-nav";

const ID = "11111111-1111-4111-8111-111111111111";
const html = (current: Parameters<typeof openGroups>[0], cookie: string | undefined) => renderToStaticMarkup(<EngagementSections id={ID} current={current} initialOpen={openGroups(current, cookie)} />);

/** The sidebar's part of the markup (the strip comes after it and is always flat). */
const sidebar = (markup: string) => markup.slice(0, markup.indexOf('id="engagement-sections"'));
const group = (markup: string, id: string) => {
  const start = markup.indexOf(`id="nav-list-${id}"`);
  const open = markup.lastIndexOf("<ul", start);
  return markup.slice(open, markup.indexOf("</ul>", start) + 5);
};

describe("the sidebar groups", () => {
  it("opens the current page's group and closes the others, with their links hidden", () => {
    const side = sidebar(html("tb", undefined));
    expect(group(side, "setup")).not.toMatch(/\bhidden\b/);
    expect(group(side, "setup")).toContain('aria-current="page"');
    expect(group(side, "setup")).toContain("Trial balance and mapping");
    for (const id of ["overview", "audit", "file", "finish"]) {
      expect(group(side, id), id).toMatch(/^<ul[^>]* hidden=""/);
      expect(group(side, id), id).toMatch(/class="[^"]*\bhidden\b/);
    }
  });

  it("makes each heading a button with aria-expanded and aria-controls", () => {
    const side = sidebar(html("tb", undefined));
    for (const g of NAV_GROUPS) {
      const button = new RegExp(`<button type="button" aria-expanded="(true|false)" aria-controls="nav-list-${g.id}"`).exec(side);
      expect(button, g.id).not.toBeNull();
      expect(button![1], g.id).toBe(g.id === "setup" ? "true" : "false");
    }
    expect(side.match(/<h2 /g)).toHaveLength(NAV_GROUPS.length);
  });

  it("opens the groups the cookie remembers, and keeps the current one open whatever it says", () => {
    const side = sidebar(html("tb", "finish.audit"));
    for (const id of ["setup", "audit", "finish"]) expect(group(side, id), id).not.toMatch(/^<ul[^>]* hidden=""/);
    for (const id of ["overview", "file"]) expect(group(side, id), id).toMatch(/^<ul[^>]* hidden=""/);
    expect(sidebar(html("tb", "audit"))).toContain('aria-expanded="true" aria-controls="nav-list-setup"');
  });

  it("falls back to the defaults for a garbled cookie", () => {
    const side = sidebar(html("review", "%%garbled;;"));
    expect(group(side, "finish")).not.toMatch(/^<ul[^>]* hidden=""/);
    expect(group(side, "setup")).toMatch(/^<ul[^>]* hidden=""/);
  });

  it("labels each list by its heading, and every closed group's links are inside a hidden list", () => {
    const side = sidebar(html("home", undefined));
    for (const g of NAV_GROUPS) expect(group(side, g.id)).toContain(`aria-labelledby="nav-group-${g.id}"`);
    const closed = group(side, "audit");
    expect(closed).toMatch(/^<ul[^>]* hidden=""/);
    expect(closed).toContain("Planning");
  });

  it("keeps the strip below lg flat: every section's link, none hidden, no buttons", () => {
    const markup = html("tb", undefined);
    const strip = markup.slice(markup.indexOf('id="engagement-sections"'));
    const labels = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.label));
    for (const label of labels) expect(strip, label).toContain(label.replace(/'/g, "&#x27;"));
    expect(strip).not.toContain("hidden=");
    expect(strip).not.toContain("<button");
    expect(strip).toContain("lg:hidden");
    expect(strip).toContain('aria-current="page"');
  });

  it("shows the sidebar from lg and the strip below it", () => {
    const markup = html("tb", undefined);
    expect(markup).toMatch(/<nav aria-label="Engagement sections" class="hidden lg:flex/);
    expect(markup).toMatch(/<nav id="engagement-sections" aria-label="Engagement sections" class="[^"]*lg:hidden/);
  });
});
