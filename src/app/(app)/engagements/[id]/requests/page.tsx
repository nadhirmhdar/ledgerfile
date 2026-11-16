import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import { listRequests, requestCounts } from "@/server/client-requests";
import { listWorkingPapers } from "@/server/working-papers";
import { AREAS } from "@/domain/audit";
import { REQUEST_DEFAULTS_STATUS } from "@/domain/client-request-defaults";
import { isRequestStatus, STATUS_LABEL, todayIso } from "@/domain/client-requests";
import { ActionForm } from "@/app/action-form";
import {
  addRequestAction,
  addStandardRequestsAction,
  bringForwardRequestsAction,
  deleteRequestAction,
  editRequestAction,
  linkFileAction,
  markNotApplicableAction,
  markReceivedAction,
  reopenRequestAction,
  unlinkFileAction,
} from "@/app/request-actions";
import { EngagementNav } from "../nav";

export const dynamic = "force-dynamic";

const input = "w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900";
const small = "rounded border border-slate-400 px-2 py-1 text-xs hover:bg-slate-100";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function RequestsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const query = await searchParams;
  const statusFilter = one(query.status);
  const areaFilter = one(query.area);

  const session = await getSession();
  const today = todayIso();
  const { engagement, all, counts, papers } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    engagement: await repo.getEngagement(tx, id),
    all: await listRequests(tx, id, today),
    counts: await requestCounts(tx, id, today),
    papers: await listWorkingPapers(tx, id),
  }));
  if (!engagement) notFound();

  const open = engagement.status === "open";
  const shown = all.filter((r) => {
    if (statusFilter === "overdue" ? !r.overdue : statusFilter && isRequestStatus(statusFilter) && r.status !== statusFilter) return false;
    if (areaFilter === "general") return r.areaCode === null;
    if (areaFilter) return r.areaCode === areaFilter;
    return true;
  });
  const link = (status: string, area: string) => {
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    if (area) q.set("area", area);
    return `/engagements/${id}/requests${q.size ? `?${q}` : ""}`;
  };
  // With an area chosen, the cards count that area (general requests under "general"), so they match the list below.
  const empty = { total: 0, open: 0, overdue: 0, received: 0, notApplicable: 0 };
  const c = areaFilter ? (counts.byArea.get(areaFilter) ?? empty) : counts.overall;

  return (
    <div className="py-8 text-slate-900">
      <Link href="/" className="text-sm text-blue-700 underline">All engagements</Link>
      <h1 className="mt-2 text-2xl font-semibold">{engagement.clientName}</h1>
      <p className="mt-1 text-sm text-slate-600">{engagement.periodStart} to {engagement.periodEnd}</p>
      <EngagementNav id={id} current="requests" status={engagement.status} />

      <h2 className="mt-6 text-xl font-semibold">Client requests</h2>
      <p className="mt-1 text-sm text-slate-700">The documents and information asked of the client, when each is due, and the received files that answer it.</p>

      <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Summary">
        {[
          ["Open", c.open, "open"],
          ["Overdue", c.overdue, "overdue"],
          ["Received", c.received, "received"],
          ["Not applicable", c.notApplicable, "not_applicable"],
        ].map(([label, value, status]) => (
          <Link key={String(label)} href={link(String(status), areaFilter)} className="rounded border border-slate-200 p-3 hover:bg-slate-50">
            <div className="text-xs text-slate-600">{label}</div>
            <div className={`mt-1 text-xl font-semibold tabular-nums ${label === "Overdue" && c.overdue > 0 ? "text-red-800" : ""}`}>{value}</div>
          </Link>
        ))}
      </section>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <a href={`/engagements/${id}/requests/export`} className="text-blue-700 underline">Download as Excel</a>
        <span className="text-slate-500">Status:</span>
        {[["", "All"], ["open", "Open"], ["overdue", "Overdue"], ["received", "Received"], ["not_applicable", "Not applicable"]].map(([s, label]) => (
          <Link key={s} href={link(s, areaFilter)} aria-current={statusFilter === s ? "true" : undefined} className={statusFilter === s ? "font-semibold" : "text-blue-700 underline"}>{label}</Link>
        ))}
        <form action={`/engagements/${id}/requests`} className="flex items-center gap-2">
          {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
          <label className="flex items-center gap-1 text-slate-500">Area
            <select name="area" defaultValue={areaFilter} className="rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900">
              <option value="">All areas</option>
              <option value="general">General</option>
              {AREAS.map((a) => <option key={a.code} value={a.code}>{a.code} {a.title}</option>)}
            </select>
          </label>
          <button className={small}>Filter</button>
        </form>
      </div>

      {open && (
        <section className="mt-6 rounded border border-slate-200 p-4">
          <h3 className="font-semibold">Add a request</h3>
          <ActionForm action={addRequestAction} fields={{ engagementId: id }} className="mt-2">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-72 flex-1 flex-col gap-1 text-xs text-slate-700">What is needed
                <input name="description" required maxLength={500} placeholder="For example: Bank statements for March" className={input} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-700">Area
                <select name="areaCode" className={input} defaultValue={areaFilter && areaFilter !== "general" ? areaFilter : ""}>
                  <option value="">General</option>
                  {AREAS.map((a) => <option key={a.code} value={a.code}>{a.code} {a.title}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-700">Due<input type="date" name="dueOn" className={input} /></label>
              <button className={small}>Add</button>
            </div>
          </ActionForm>

          <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3 border-t border-slate-200 pt-3">
            <ActionForm action={addStandardRequestsAction} fields={{ engagementId: id }}>
              <button className={small}>Add the standard requests</button>
              <p className="mt-1 max-w-md text-xs text-slate-600">
                Adds general requests, and those for each audit area with a balance on the trial balance. Wording already on the list is skipped.
              </p>
              <p role="note" className="mt-1 max-w-md rounded border border-amber-400 bg-amber-50 px-2 py-1 text-xs">Standard wording: {REQUEST_DEFAULTS_STATUS}. Read it before sending it to a client.</p>
            </ActionForm>
            {engagement.priorEngagementId && (
              <ActionForm action={bringForwardRequestsAction} fields={{ engagementId: id }}>
                <button className={small}>Bring forward last year&apos;s requests</button>
                <p className="mt-1 max-w-md text-xs text-slate-600">Copies each request from the prior-year engagement as open, dated today, with no due date. Ones already brought forward, or already on the list, are skipped.</p>
              </ActionForm>
            )}
          </div>
        </section>
      )}

      {all.length === 0 ? (
        <p className="mt-6 text-sm text-slate-600">No requests yet.</p>
      ) : shown.length === 0 ? (
        <p className="mt-6 text-sm text-slate-600">No requests match this filter. <Link href={`/engagements/${id}/requests`} className="text-blue-700 underline">Show all</Link></p>
      ) : (
        <ul className="mt-6 space-y-3">
          {shown.map((r) => {
            const unlinked = papers.filter((p) => !r.files.some((f) => f.id === p.id));
            return (
              <li key={r.id} className="rounded border border-slate-200 p-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-semibold tabular-nums">{r.reference}</span>
                  <span className="rounded bg-slate-100 px-1.5 text-xs">{r.areaTitle}</span>
                  <span className={r.status === "received" ? "text-emerald-800" : r.status === "not_applicable" ? "text-slate-600" : "text-amber-800"}>{STATUS_LABEL[r.status]}</span>
                  {r.overdue && <span className="rounded bg-red-100 px-1.5 text-xs font-semibold text-red-900">Overdue</span>}
                </div>
                <p className="mt-1 text-sm">{r.description}</p>
                <p className="mt-1 text-xs text-slate-600">
                  Asked by {r.requestedByName} on {r.requestedOn}
                  {r.dueOn ? `, due ${r.dueOn}` : ", no due date"}
                  {r.receivedOn ? `, received ${r.receivedOn}` : ""}
                </p>
                {r.note && <p className="mt-1 text-xs text-slate-700">Note: {r.note}</p>}
                {r.files.length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm">
                    {r.files.map((f) => (
                      <li key={f.id} className="flex flex-wrap items-center gap-3">
                        <a href={`/engagements/${id}/files/${f.id}`} className="text-blue-700 underline">{f.fileName}</a>
                        {open && (
                          <ActionForm action={unlinkFileAction} fields={{ requestId: r.id, fileId: f.id }}>
                            <button className={small}>Unlink</button>
                          </ActionForm>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {open && (
                  <div className="mt-2 flex flex-wrap items-start gap-3">
                    {r.status === "open" && (
                      <>
                        <ActionForm action={markReceivedAction} fields={{ requestId: r.id }} className="flex items-center gap-1">
                          <input type="date" name="receivedOn" defaultValue={today} max={today} min={r.requestedOn} aria-label={`Received on, ${r.reference}`} className="rounded border border-slate-300 px-1 py-1 text-xs" />
                          <button className={small}>Mark received</button>
                        </ActionForm>
                        <ActionForm action={markNotApplicableAction} fields={{ requestId: r.id }} className="flex items-center gap-1">
                          <input name="note" required maxLength={1000} placeholder="Why not applicable" aria-label={`Reason not applicable, ${r.reference}`} className="rounded border border-slate-300 px-2 py-1 text-xs" />
                          <button className={small}>Not applicable</button>
                        </ActionForm>
                      </>
                    )}
                    {r.status !== "open" && (
                      <ActionForm action={reopenRequestAction} fields={{ requestId: r.id }}>
                        <button className={small}>Reopen</button>
                      </ActionForm>
                    )}
                    {unlinked.length > 0 && (
                      <ActionForm action={linkFileAction} fields={{ requestId: r.id }} className="flex items-center gap-1">
                        <select name="fileId" aria-label={`Link a received file, ${r.reference}`} className="max-w-48 rounded border border-slate-300 bg-white px-1 py-1 text-xs">
                          {unlinked.map((p) => <option key={p.id} value={p.id}>{p.fileName}</option>)}
                        </select>
                        <button className={small}>Link file</button>
                      </ActionForm>
                    )}
                    {r.status === "open" && r.files.length === 0 && (
                      <ActionForm action={deleteRequestAction} fields={{ requestId: r.id }}>
                        <button className={small}>Delete</button>
                      </ActionForm>
                    )}
                    <details className="text-xs">
                      <summary className="cursor-pointer text-blue-700 underline">Edit</summary>
                      <ActionForm action={editRequestAction} fields={{ requestId: r.id }} className="mt-2 space-y-2">
                        <label className="flex flex-col gap-1 text-slate-700">What is needed<input name="description" defaultValue={r.description} required maxLength={500} className={input} /></label>
                        <label className="flex flex-col gap-1 text-slate-700">Area
                          <select name="areaCode" defaultValue={r.areaCode ?? ""} className={input}>
                            <option value="">General</option>
                            {AREAS.map((a) => <option key={a.code} value={a.code}>{a.code} {a.title}</option>)}
                          </select>
                        </label>
                        <label className="flex flex-col gap-1 text-slate-700">Asked on<input type="date" name="requestedOn" defaultValue={r.requestedOn} required className={input} /></label>
                        <label className="flex flex-col gap-1 text-slate-700">Due<input type="date" name="dueOn" defaultValue={r.dueOn ?? ""} className={input} /></label>
                        <label className="flex flex-col gap-1 text-slate-700">Internal note (not in the Excel download)<input name="note" defaultValue={r.note ?? ""} maxLength={1000} className={input} /></label>
                        <button className={small}>Save</button>
                      </ActionForm>
                    </details>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
