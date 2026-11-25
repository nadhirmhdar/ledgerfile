import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Thread } from "../src/ui/review-thread";

const thread = [
  { id: "legacy", authorName: "Test Preparer", body: "An older answer.", writtenAt: null, legacy: true },
  { id: "1", authorName: "Test Reviewer", body: "Which page?", writtenAt: "2026-11-25", legacy: false },
  { id: "2", authorName: "Test Preparer", body: "Page 4.", writtenAt: "2026-11-26", legacy: false },
];

describe("a rendered thread", () => {
  it("shows author and date as separate pieces, in order, with no middle dot", () => {
    const html = renderToStaticMarkup(<Thread thread={thread} />);
    expect(html).not.toContain("·");
    expect(html).toContain("<span>Test Reviewer</span><span>2026-11-25</span>");
    expect(html.indexOf("An older answer.")).toBeLessThan(html.indexOf("Which page?"));
    expect(html.indexOf("Which page?")).toBeLessThan(html.indexOf("Page 4."));
  });
  it("keeps the older response's missing date as plain words", () => {
    expect(renderToStaticMarkup(<Thread thread={thread} />)).toContain("<span>earlier response, date not recorded</span>");
  });
  it("renders nothing for an empty thread", () => {
    expect(renderToStaticMarkup(<Thread thread={[]} />)).toBe("");
  });
});
