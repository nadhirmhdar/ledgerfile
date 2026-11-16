import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge, StatusBadge } from "../src/ui/badge";
import { buttonClass } from "../src/ui/button";
import { Callout, ProgressBar, StepList } from "../src/ui/feedback";
import { Field, Input } from "../src/ui/form";
import { EngagementNav } from "../src/app/(app)/engagements/[id]/nav";
import { Table, TCell, THead, TRow } from "../src/ui/table";

const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

describe("components render the accessibility attributes they promise", () => {
  it("a field links its label, hint and error to the input", () => {
    const out = html(h(Field, { label: "Client name", hint: "As signed.", error: "Required.", children: h(Input, { name: "client" }) }));
    const id = out.match(/<input[^>]* id="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(out).toContain(`<label for="${id}"`);
    expect(out).toContain('aria-invalid="true"');
    const described = out.match(/aria-describedby="([^"]+)"/)?.[1].split(" ") ?? [];
    expect(described).toHaveLength(2);
    for (const d of described) expect(out).toContain(`id="${d}"`);
  });
  it("a field without a hint or error sets no description", () => {
    const out = html(h(Field, { label: "Name", children: h(Input, { name: "n" }) }));
    expect(out).not.toContain("aria-describedby");
    expect(out).not.toContain("aria-invalid");
  });
  it("a progress bar is a progressbar with its figures and a text label", () => {
    const out = html(h(ProgressBar, { value: 2, max: 5, label: "Setup" }));
    expect(out).toContain('role="progressbar"');
    expect(out).toContain('aria-valuenow="2"');
    expect(out).toContain('aria-valuemax="5"');
    expect(out).toContain('aria-label="Setup"');
    expect(out).toContain("2 of 5");
  });
  it("a progress bar never overflows or divides by zero", () => {
    expect(html(h(ProgressBar, { value: 9, max: 5, label: "x" }))).toContain('aria-valuenow="5"');
    expect(html(h(ProgressBar, { value: 0, max: 0, label: "x" }))).toContain("width:0%");
  });
  it("a status is a word as well as a dot, and locked carries an icon", () => {
    expect(html(h(StatusBadge, { status: "needs_review" }))).toContain("Needs review");
    expect(html(h(StatusBadge, { status: "done", label: "Ready to lock" }))).toContain("Ready to lock");
    const locked = html(h(StatusBadge, { status: "locked" }));
    expect(locked).toContain("Locked");
    expect(locked).toContain("<svg");
    expect(html(h(Badge, { tone: "info", children: "Audit on" }))).toContain("Audit on");
  });
  it("icons are hidden from assistive technology", () => {
    expect(html(h(StatusBadge, { status: "locked" }))).toContain('aria-hidden="true"');
  });
  it("a callout is a note, and a danger callout is an alert; the draft variant keeps its title", () => {
    expect(html(h(Callout, { variant: "info" }, "x"))).toContain('role="note"');
    expect(html(h(Callout, { variant: "danger" }, "x"))).toContain('role="alert"');
    expect(html(h(Callout, { variant: "draft", title: "AI draft: not reviewed" }, "x"))).toContain("AI draft: not reviewed");
  });
  it("a step list is an ordered list with status words and a link per step", () => {
    const out = html(
      h(StepList, {
        steps: [
          { key: "a", title: "Set up", summary: "s", status: "done", done: 3, total: 3, href: "/a" },
          { key: "b", title: "Plan", summary: "s", status: "not_applicable", statusLabel: "Not being audited", done: 0, total: 0, href: "/b" },
          { key: "c", title: "Finish", summary: "s", status: "not_started", done: 0, total: 1, href: "/c" },
        ],
      }),
    );
    expect(out).toMatch(/^<ol/);
    expect(out).toContain('href="/a"');
    expect(out).toContain("Not being audited");
    expect(out.match(/role="progressbar"/g)).toHaveLength(1);
  });
  it("table cells are headers with a scope, and numbers are right-aligned", () => {
    const head = h(THead, { key: "h", children: h(TRow, { children: h(TCell, { header: "col", children: "Account" }) }) });
    const body = h("tbody", { key: "b" }, h(TRow, { children: [h(TCell, { key: "1", header: "row", children: "Cash" }), h(TCell, { key: "2", numeric: true, children: "1.00" })] }));
    const out = html(h(Table, { caption: "Figures", children: [head, body] }));
    expect(out).toContain('<th scope="col"');
    expect(out).toContain('<th scope="row"');
    expect(out).toContain("text-right tabular-nums");
    expect(out).toContain("<caption");
  });
  it("buttons are at least 40 px high at the normal size", () => {
    expect(buttonClass("primary")).toContain("min-h-10");
    expect(buttonClass("danger", "sm")).toContain("min-h-8");
  });
  it("the engagement nav labels each group list with one real heading id", () => {
    const out = html(h(EngagementNav, { id: "x", current: "home", status: "open" }));
    const labels = [...out.matchAll(/aria-labelledby="([^"]*)"/g)].map((m) => m[1]);
    expect(labels).toHaveLength(5);
    for (const l of labels) {
      expect(l).not.toMatch(/s/);
      expect(out).toContain(`id="${l}"`);
    }
    expect(new Set(labels).size).toBe(5);
    expect(out).toContain('aria-current="page"');
  });
});
