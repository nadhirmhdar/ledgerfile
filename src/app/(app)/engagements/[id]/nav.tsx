import Link from "next/link";

const TABS = [
  { key: "tb", label: "Trial balance and mapping", path: "" },
  { key: "journals", label: "Journal entries", path: "/journals" },
  { key: "statements", label: "Financial statements", path: "/statements" },
] as const;

export function EngagementNav({ id, current }: { id: string; current: (typeof TABS)[number]["key"] }) {
  return (
    <nav aria-label="Engagement sections" className="mt-5 flex flex-wrap gap-1 border-b border-slate-300">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={`/engagements/${id}${t.path}`}
          aria-current={t.key === current ? "page" : undefined}
          className={`-mb-px rounded-t border px-3 py-2 text-sm ${
            t.key === current ? "border-slate-300 border-b-white bg-white font-semibold text-slate-900" : "border-transparent text-blue-700 hover:bg-slate-100"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
