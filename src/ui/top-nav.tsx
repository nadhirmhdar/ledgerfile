"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Engagements", match: (p: string) => p === "/" || p.startsWith("/engagements") },
  { href: "/my-work", label: "My work", match: (p: string) => p.startsWith("/my-work") },
  { href: "/clients", label: "Clients", match: (p: string) => p.startsWith("/clients") },
  { href: "/team", label: "Team", match: (p: string) => p.startsWith("/team") },
];

/** The top bar's links. A client component only to know which page is current. The Firm page is linked for administrators only. */
export function TopNav({ admin = false }: { admin?: boolean }) {
  const pathname = usePathname();
  const items = admin ? [...ITEMS, { href: "/firm", label: "Firm", match: (p: string) => p.startsWith("/firm") }] : ITEMS;
  return (
    <nav aria-label="Main" className="flex items-stretch self-stretch max-sm:order-last max-sm:basis-full sm:gap-1">
      {items.map((item) => {
        const current = item.match(pathname);
        // The active link's underline sits on the bar's own bottom edge (-mb-px over the hairline).
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={`-mb-px inline-flex min-h-14 items-center border-b-[3px] px-1.5 text-sm font-medium transition-colors focus-visible:outline-accent-bright sm:px-3 ${
              current ? "border-accent-bright text-white" : "border-transparent text-nav-text hover:text-white"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
