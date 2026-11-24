"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDownIcon } from "../../../../ui/icons";
import { NAV_COOKIE, NAV_GROUPS, sectionHref, serializeOpenGroups, type EngagementTab } from "../../../../ui/engagement-nav";
import { StripScroll } from "../../../../ui/strip-scroll";

const linkClass = (active: boolean) =>
  `inline-flex min-h-10 w-full items-center border-b-2 px-3 text-sm whitespace-nowrap lg:rounded-md lg:border-b-0 lg:border-l-2 transition-colors ${
    active ? "border-accent font-semibold text-ink lg:bg-accent-soft lg:text-accent" : "border-transparent font-medium text-ink-muted hover:text-ink lg:font-normal lg:hover:bg-surface-muted"
  }`;

/** Remember the open groups in a cookie, for every engagement in this browser. A browser that refuses it still opens and closes the groups for this visit. */
function remember(open: string[]): void {
  try {
    document.cookie = `${NAV_COOKIE}=${serializeOpenGroups(open)}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {
    // Nothing to do: the choice just is not kept.
  }
}

/**
 * The engagement's sections. On a wide screen a sidebar whose groups open and close: the heading of each is a button, and a closed group's links are
 * hidden (not in the tab order). `initialOpen` comes from the server, from the cookie and the current page, so the first render is the one the user
 * left. Below lg the strip is flat and always shows every section (collapsing a sideways strip would put sections behind two taps).
 */
export function EngagementSections({ id, current, initialOpen }: { id: string; current: EngagementTab; initialOpen: string[] }) {
  const [open, setOpen] = useState<string[]>(initialOpen);
  const toggle = (group: string) => {
    const next = open.includes(group) ? open.filter((g) => g !== group) : [...open, group];
    setOpen(next);
    remember(next);
  };
  return (
    <>
      {/* The sidebar, from lg. */}
      <nav aria-label="Engagement sections" className="hidden lg:flex lg:flex-col lg:gap-1">
        {NAV_GROUPS.map((g) => {
          const isOpen = open.includes(g.id);
          const heading = `nav-group-${g.id}`;
          const list = `nav-list-${g.id}`;
          return (
            <div key={g.id}>
              <h2 id={heading} className="text-sm font-semibold text-ink">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={list}
                  onClick={() => toggle(g.id)}
                  className="flex min-h-10 w-full items-center justify-between gap-2 rounded-md px-3 text-left text-sm font-semibold text-ink transition-colors hover:bg-surface-muted hover:text-accent"
                >
                  {g.title}
                  <ChevronDownIcon width={16} height={16} className={`shrink-0 transition-transform motion-reduce:transition-none ${isOpen ? "" : "-rotate-90"}`} />
                </button>
              </h2>
              <ul id={list} aria-labelledby={heading} hidden={!isOpen} className={`ml-4 flex-col gap-0.5 ${isOpen ? "flex" : "hidden"}`}>
                {g.items.map((t) => (
                  <li key={t.key}>
                    <Link href={sectionHref(id, t.path)} aria-current={t.key === current ? "page" : undefined} className={linkClass(t.key === current)}>
                      {t.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
      {/* The strip below lg: flat, every section, scrolling sideways. */}
      <nav id="engagement-sections" aria-label="Engagement sections" className="-mx-4 flex gap-4 overflow-x-auto border-b border-border px-4 lg:hidden">
        {NAV_GROUPS.map((g) => (
          <ul key={g.id} aria-label={g.title} className="flex shrink-0 items-center gap-1">
            {g.items.map((t) => (
              <li key={t.key}>
                <Link href={sectionHref(id, t.path)} aria-current={t.key === current ? "page" : undefined} className={linkClass(t.key === current)}>
                  {t.label}
                </Link>
              </li>
            ))}
          </ul>
        ))}
      </nav>
      <StripScroll navId="engagement-sections" />
    </>
  );
}
