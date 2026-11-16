"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Engagements", match: (p: string) => p === "/" || p.startsWith("/engagements") },
  { href: "/team", label: "Team", match: (p: string) => p.startsWith("/team") },
];

/** The top bar's links. A client component only to know which page is current. */
export function TopNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex items-center sm:gap-1">
      {ITEMS.map((item) => {
        const current = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={`inline-flex min-h-10 items-center border-b-2 px-2 text-sm sm:px-3 font-medium ${
              current ? "border-accent text-ink" : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
