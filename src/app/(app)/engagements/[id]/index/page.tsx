import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { buildWorkingPaperIndex } from "@/server/wp-index";
import * as repo from "@/server/repo";
import { filterIndex, isIndexFilter, KIND_LABEL, notApplicableNote, STATUS_LABEL, type Status } from "@/domain/wp-index";
import { EngagementNav } from "../nav";

export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

// Each status reads as text first; the colour only reinforces it.
const BADGE: Record<Status, string> = {
  not_started: "border-slate-400 bg-white text-slate-800",
  in_progress: "border-amber-500 bg-amber-50 text-amber-900",
  prepared: "border-blue-500 bg-blue-50 text-blue-900",
  reviewed: "border-emerald-600 bg-emerald-50 text-emerald-900",
  not_applicable: "border-slate-300 bg-slate-100 text-slate-700",
};

function Who({ name, on }: { name: string | null; on: string | null }) {
  if (!name && !on) return <span className="text-slate-500">None recorded</span>;
  return (
    <>
      {name ?? <span className="text-slate-500">Not recorded</span>}
      {on && <div className="text-xs text-slate-600">{on}</div>}
    </>
  );
}

export default async function IndexPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const query = await searchParams;
  const requested = one(query.show);
  const filter = isIndexFilter(requested) ? requested : "all";

  const session = await getSession();
  const { engagement, index } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    engagement: await repo.getEngagement(tx, id),
    index: await buildWorkingPaperIndex(tx, id),
  }));
  if (!engagement || !index) notFound();

  const sections = filterIndex(index, filter);
  const o = index.overall;
  const link = (show: string) => `/engagements/${id}/index${show === "all" ? "" : `?show=${show}`}`;

  return (
    <div className="py-8 text-slate-900">
      <Link href="/" className="text-sm text-blue-700 underline">All engagements</Link>
      <h1 className="mt-2 text-2xl font-semibold">{engagement.clientName}</h1>
      <p className="mt-1 text-sm text-slate-600">{engagement.periodStart} to {engagement.periodEnd}</p>
      <EngagementNav id={id} current="index" status={engagement.status} />

      <h2 className="mt-6 text-xl font-semibold">Working paper index</h2>
      <p className="mt-1 text-sm text-slate-700">
        Every paper on the file in file order, with who prepared and reviewed it and where it stands. It is read from the papers themselves, so it is always current.
        {!index.auditOn && " The audit is off for this engagement, so only the papers that do not depend on it are listed."}
      </p>

      <p className="mt-4 text-xs text-slate-600">Totals for the whole file, whatever filter is chosen below.</p>
      <section className="mt-1 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Summary, whole file">
        {[
          ["Papers", o.total],
          ["Reviewed", o.reviewed],
          ["Prepared", o.prepared],
          ["In progress", o.inProgress],
          ["Not started", o.notStarted],
          ["Still to review", o.toReview],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded border border-slate-200 p-3">
            <div className="text-xs text-slate-600">{label}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
          </div>
        ))}
      </section>
      {notApplicableNote(o.notApplicable) && <p className="mt-2 text-xs text-slate-600">{notApplicableNote(o.notApplicable)} &ldquo;Still to review&rdquo; counts only papers that have a review step.</p>}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <a href={`/engagements/${id}/index/export`} className="text-blue-700 underline">Download index (Excel)</a>
        <span className="text-slate-500">Show:</span>
        {[["all", "All papers"], ["unreviewed", "Not yet reviewed"], ["not_started", "Not started"]].map(([s, label]) => (
          <Link key={s} href={link(s)} aria-current={filter === s ? "true" : undefined} className={filter === s ? "font-semibold" : "text-blue-700 underline"}>{label}</Link>
        ))}
      </div>

      {sections.length === 0 ? (
        <p className="mt-6 text-sm text-slate-700">{filter === "all" ? "There are no papers on this file yet." : "Nothing matches this filter."}</p>
      ) : (
        sections.map((s) => (
          <section key={s.code} className="mt-8" aria-labelledby={`sec-${s.code}`}>
            <h3 id={`sec-${s.code}`} className="text-base font-semibold">
              {s.title}
              <span className="ml-2 text-xs font-normal text-slate-600">
                {filter === "all" ? `${s.counts.reviewed} of ${s.counts.total} reviewed` : `${s.counts.total} shown`}{s.counts.toReview > 0 ? `, ${s.counts.toReview} still to review` : ""}
              </span>
            </h3>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">{s.title}</caption>
                <thead className="border-b border-slate-300 text-slate-600">
                  <tr>
                    <th scope="col" className="py-2 pr-3 font-medium">Reference</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Paper</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Prepared by</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Reviewed by</th>
                    <th scope="col" className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {s.entries.map((e) => (
                    <tr key={`${e.reference ?? ""}|${e.title}|${e.href}`} className="border-b border-slate-200 align-top">
                      <td className="py-2 pr-3 whitespace-nowrap tabular-nums">{e.reference ?? <span className="text-slate-500">None</span>}</td>
                      <td className="py-2 pr-3">
                        {e.kind === "file" ? (
                          // A plain link: the route streams the file and logs a download, so it must not be prefetched.
                          <a href={e.href} className="text-blue-700 underline">{e.title}</a>
                        ) : (
                          <Link href={e.href} className="text-blue-700 underline">{e.title}</Link>
                        )}
                        <div className="text-xs text-slate-600">{KIND_LABEL[e.kind]}{e.note ? `. ${e.note}` : ""}</div>
                      </td>
                      <td className="py-2 pr-3"><Who name={e.preparedBy} on={e.preparedOn} /></td>
                      <td className="py-2 pr-3">{e.reviewable ? <Who name={e.reviewedBy} on={e.reviewedOn} /> : <span className="text-slate-500">No review step</span>}</td>
                      <td className="py-2 whitespace-nowrap">
                        <span className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${BADGE[e.status]}`}>{STATUS_LABEL[e.status]}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}

      <p className="mt-8 max-w-3xl text-xs text-slate-600">
        References follow the numbers the file already uses (checklists A1 to E3, areas C1 to C16, schedules such as C5-1) and add G1 to G5 for general papers, a suffix such as
        .L1 for a lead sheet and .P for the procedures of an area, and C5-F1 for an uploaded file you reference on the Working papers tab. The scheme is a default for the firm to confirm.
        Where the product holds no preparer or reviewer for a paper, none is shown rather than a guess.
      </p>
    </div>
  );
}
