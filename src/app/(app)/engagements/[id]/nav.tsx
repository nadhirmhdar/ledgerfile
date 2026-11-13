import Link from "next/link";

const TABS = [
  { key: "tb", label: "Trial balance and mapping", path: "" },
  { key: "journals", label: "Journal entries", path: "/journals" },
  { key: "statements", label: "Financial statements", path: "/statements" },
  { key: "audit", label: "Audit", path: "/audit" },
  { key: "review", label: "Review and sign-off", path: "/review" },
] as const;

export function EngagementNav({ id, current, status }: { id: string; current: (typeof TABS)[number]["key"]; status: string }) {
  return (
    <>
      {status !== "open" && (
        <p role="status" className="mt-4 rounded border border-slate-400 bg-slate-100 px-3 py-2 text-sm">
          This engagement is locked. Changes are refused until a partner unlocks it on the Review and sign-off tab.
        </p>
      )}
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
    </>
  );
}
