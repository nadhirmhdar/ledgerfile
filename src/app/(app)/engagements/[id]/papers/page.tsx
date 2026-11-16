import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import * as papers from "@/server/working-papers";
import { buildLeadSheets } from "@/domain/leadsheet";
import { canReview } from "@/domain/signoff";
import { ActionForm } from "@/app/action-form";
import { FileInput } from "@/app/file-input";
import { fileWorkingPaperAction, removeWorkingPaperAction, uploadWorkingPaperAction } from "@/app/papers-actions";
import { AREAS, CHECKLISTS } from "@/domain/audit";
import { EngagementNav } from "../nav";

export const dynamic = "force-dynamic";

const input = "rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900";
const label = "flex flex-col gap-1 text-sm text-slate-700";
const small = "rounded border border-slate-400 px-2 py-1 text-xs hover:bg-slate-100";

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default async function PapersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const session = await getSession();
  const { engagement, accounts, list } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    engagement: await repo.getEngagement(tx, id),
    accounts: await repo.listAccounts(tx, id),
    list: await papers.listWorkingPapers(tx, id),
  }));
  if (!engagement) notFound();

  const open = engagement.status === "open";
  const sheets = buildLeadSheets(accounts).sheets;

  return (
    <div className="py-8 text-slate-900">
      <Link href="/" className="text-sm text-blue-700 underline">All engagements</Link>
      <h1 className="mt-2 text-2xl font-semibold">{engagement.clientName}</h1>
      <p className="mt-1 text-sm text-slate-600">{engagement.periodStart} to {engagement.periodEnd}</p>
      <EngagementNav id={id} current="papers" status={engagement.status} />

      {open && (
        <ActionForm action={uploadWorkingPaperAction} fields={{ engagementId: id }} className="mt-6 rounded border border-slate-200 bg-slate-50 p-4">
          <h2 className="text-base font-semibold">Upload a working paper</h2>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className={label}>
              File
              <FileInput maxBytes={papers.MAX_FILE_BYTES} accept={papers.ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",")} className="text-sm text-slate-900" />
            </label>
            <label className={label}>
              Supports
              <select name="supports" defaultValue="engagement" className={input}>
                <option value="engagement">The engagement generally</option>
                {sheets.map((sh) => (
                  <option key={sh.groupCode} value={`lead_sheet:${sh.groupCode}`}>Lead sheet: {sh.groupName}</option>
                ))}
              </select>
            </label>
            <label className={`${label} min-w-56 flex-1`}>
              Description (optional)
              <input name="description" maxLength={500} className={input} />
            </label>
            <button className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">Upload</button>
          </div>
          <p className="mt-2 text-xs text-slate-600">
            Up to 10 MB. Accepted types: {papers.ALLOWED_EXTENSIONS.join(", ")}. To attach evidence to an audit procedure, upload it from that procedure on the Audit tab.
          </p>
        </ActionForm>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Working papers</h2>
        {list.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">No files have been uploaded to this engagement.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-300 text-slate-600">
                <tr>
                  <th className="py-2 font-medium">File</th>
                  <th className="py-2 pl-4 font-medium">Supports</th>
                  <th className="py-2 pl-4 text-right font-medium">Size</th>
                  <th className="py-2 pl-4 font-medium">Uploaded</th>
                  <th className="py-2 pl-4 font-medium">Index reference</th>
                  <th className="py-2 pl-4 font-medium" />
                </tr>
              </thead>
              <tbody>
                {list.map((w) => (
                  <tr key={w.id} className="border-b border-slate-200 align-top">
                    <td className="py-2">
                      <a href={`/engagements/${id}/files/${w.id}`} className="text-blue-700 underline">{w.fileName}</a>
                      {w.description && <div className="text-xs text-slate-600">{w.description}</div>}
                    </td>
                    <td className="py-2 pl-4">{w.targetLabel}</td>
                    <td className="py-2 pl-4 text-right tabular-nums whitespace-nowrap">{size(w.sizeBytes)}</td>
                    <td className="py-2 pl-4 whitespace-nowrap">
                      {w.uploadedByName} <span className="text-xs text-slate-600">{w.uploadedAt}</span>
                    </td>
                    <td className="py-2 pl-4">
                      {open ? (
                        <ActionForm action={fileWorkingPaperAction} fields={{ paperId: w.id }}>
                          <div className="flex flex-wrap items-center gap-1">
                            <input
                              name="reference"
                              defaultValue={w.reference ?? ""}
                              maxLength={8}
                              placeholder="C5-F1"
                              aria-label={`Index reference for ${w.fileName}`}
                              className="w-20 rounded border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-900"
                            />
                            {w.targetKind === "engagement" && (
                              <select name="sectionCode" defaultValue={w.sectionCode ?? ""} aria-label={`Filed under, for ${w.fileName}`} className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-900">
                                <option value="">Unfiled</option>
                                {AREAS.map((a) => <option key={a.code} value={a.code}>{a.code} {a.title}</option>)}
                                {CHECKLISTS.map((c) => <option key={c.code} value={c.code}>{c.code} {c.title}</option>)}
                              </select>
                            )}
                            <button className={small}>Save</button>
                          </div>
                        </ActionForm>
                      ) : (
                        <span className="tabular-nums">{w.reference ?? "None"}</span>
                      )}
                    </td>
                    <td className="py-2 pl-4">
                      {open && (w.uploadedBy === session.userId || canReview(session.role)) && (
                        <ActionForm action={removeWorkingPaperAction} fields={{ paperId: w.id }}>
                          <button className={small}>Remove</button>
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-600">
          Files can be removed by the person who uploaded them, or by a reviewer or partner, until the engagement is locked. Every upload, download and removal is recorded in the audit log.
        </p>
      </section>
    </div>
  );
}
