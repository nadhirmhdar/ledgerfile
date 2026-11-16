"use client";

import { useEffect } from "react";

/**
 * Opens the <details> a link in the page points at, and any <details> around it, then brings it into view. It runs when the page
 * loads with a hash, when the hash changes, and when an in-page link is clicked (so a link to a note that was closed again still
 * opens it). "#note-5" from a statement opens note 5 even though the notes start closed. It renders nothing.
 */
export function OpenOnHash() {
  useEffect(() => {
    const show = (hash: string) => {
      let id = hash.replace(/^#/, "");
      try {
        id = decodeURIComponent(id);
      } catch {
        return;
      }
      if (!id) return;
      const target = document.getElementById(id);
      if (!target) return;
      let changed = false;
      for (let el: Element | null = target; el; el = el.parentElement) {
        if (el instanceof HTMLDetailsElement && !el.open) {
          el.open = true;
          changed = true;
        }
      }
      if (changed) target.scrollIntoView({ block: "start" });
    };
    const onHash = () => show(window.location.hash);
    const onClick = (e: MouseEvent) => {
      const a = e.target instanceof Element ? e.target.closest("a[href^='#']") : null;
      if (a) show(a.getAttribute("href") ?? "");
    };
    show(window.location.hash);
    window.addEventListener("hashchange", onHash);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("hashchange", onHash);
      document.removeEventListener("click", onClick);
    };
  }, []);
  return null;
}
