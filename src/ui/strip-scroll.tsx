"use client";

import { useEffect } from "react";
import { stripScrollLeft } from "./engagement-nav";

/**
 * On a phone the section strip scrolls sideways and starts at the left, so a section far along it (Review, Statements, Letters) is
 * highlighted but off screen. This sets the strip's scrollLeft so the current item is roughly centred. It sets scrollLeft on the strip
 * only, never scrollIntoView, which could scroll the page too, and it does nothing where the navigation is a vertical sidebar. The
 * jump is instant, so it needs no reduced-motion variant. It renders nothing.
 */
export function StripScroll({ navId }: { navId: string }) {
  useEffect(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    const strip = document.getElementById(navId);
    const current = strip?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!strip || !current) return;
    const s = strip.getBoundingClientRect();
    const c = current.getBoundingClientRect();
    strip.scrollLeft = stripScrollLeft({ stripWidth: strip.clientWidth, stripScrollWidth: strip.scrollWidth, stripScrollLeft: strip.scrollLeft, childLeft: c.left - s.left, childWidth: c.width });
  }, [navId]);
  return null;
}
