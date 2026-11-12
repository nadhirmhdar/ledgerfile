import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import * as audit from "@/server/audit";
import { AREA_BY_CODE, LIBRARY_STATUS } from "@/domain/audit";
import { ActionForm } from "@/app/action-form";
import { updateProcedureAction } from "@/app/audit-actions";
import { EngagementNav } from "../../nav";

export const dynamic = "force-dynamic";

const TIER_LABEL: Record<string, string> = { core: "Core", extended: "Extended", significant: "Significant risk" };
const STATUS_LABEL: Record<string, string> = { open: "Open", done: "Completed", na: "Not applicable" };
const input = "w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900";
const small = "rounded border border-slate-400 px-2 py-1 text-xs hover:bg-slate-100";

export default async function ProgrammePage({ params }: { params: Promise<{ id: string; area: string }> }) {
  const { id, area: areaCode } = await params;
  const area = AREA_BY_CODE.get(areaCode);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !area) notFound();

  const session = await getSession();
  const { engagement, procedures } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    engagement: await repo.getEngagement(tx, id),
    procedures: await audit.listProcedures(tx, id, area.code),
  }));
  if (!engagement) notFound();

  const open = engagement.status === "open";
  const completed = procedures.filter((p) => p.status !== "open").length;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 text-slate-900">
      <Link href="/" className="text-sm text-blue-700 underline">All engagements</Link>
      <h1 className="mt-2 text-2xl font-semibold">{engagement.clientName}</h1>
      <p className="mt-1 text-sm text-slate-600">{engagement.periodStart} to {engagement.periodEnd}</p>
      <EngagementNav id={id} current="audit" status={engagement.status} />

      <p className="mt-6 text-sm">
        <Link href={`/engagements/${id}/audit`} className="text-blue-700 underline">Audit planning</Link>
      </p>
      <h2 className="mt-2 text-xl font-semibold">
        {area.code} {area.title}
      </h2>
      <p className="mt-1 text-sm text-slate-700">{area.objective}</p>
      <p role="note" className="mt-3 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-xs">
        Methodology content: {LIBRARY_STATUS}.
      </p>

      {procedures.length === 0 ? (
        <p className="mt-6 text-sm text-slate-600">No programme is loaded for this area. Assess its risks on the audit planning page.</p>
      ) : (
        <>
          <p className="mt-4 text-sm font-medium">
            {completed} of {procedures.length} procedures completed
          </p>
          {procedures.map((p) => (
            <section key={p.id} className={`mt-4 rounded border p-4 ${p.status === "open" ? "border-slate-300" : "border-emerald-300 bg-emerald-50"}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold">
                  {p.templateId} <span className="ml-1 text-xs font-normal text-slate-600">{TIER_LABEL[p.tier]} · Assertions: {p.assertions}</span>
                </h3>
                <span className="text-sm">
                  {STATUS_LABEL[p.status]}
                  {p.performedByName && <span className="ml-1 text-xs text-slate-600">by {p.performedByName} on {p.performedAt}</span>}
                </span>
              </div>
              <p className="mt-2 text-sm">{p.body}</p>
              <p className="mt-1 text-xs text-slate-600">
                Evidence expected: {p.evidence} · Reference: {p.reference}
              </p>

              {open ? (
                <ActionForm action={updateProcedureAction} fields={{ procedureId: p.id }} className="mt-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-sm text-slate-700">
                      Work done
                      <textarea name="workDone" rows={3} maxLength={5000} defaultValue={p.workDone ?? ""} className={input} />
                    </label>
                    <label className="flex flex-col gap-1 text-sm text-slate-700">
                      Conclusion
                      <textarea name="conclusion" rows={3} maxLength={5000} defaultValue={p.conclusion ?? ""} className={input} />
                    </label>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {p.status === "open" ? (
                      <>
                        <button name="status" value="done" className={small}>Mark completed</button>
                        <button name="status" value="na" className={small}>Not applicable</button>
                        <button name="status" value="open" className={small}>Save without completing</button>
                      </>
                    ) : (
                      <button name="status" value="open" className={small}>Reopen</button>
                    )}
                  </div>
                </ActionForm>
              ) : (
                <div className="mt-3 text-sm">
                  <p><span className="font-medium">Work done:</span> {p.workDone ?? "None recorded"}</p>
                  <p className="mt-1"><span className="font-medium">Conclusion:</span> {p.conclusion ?? "None recorded"}</p>
                </div>
              )}
            </section>
          ))}
        </>
      )}
    </main>
  );
}
