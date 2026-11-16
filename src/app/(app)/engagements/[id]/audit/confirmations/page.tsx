import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import { getAuditOverview } from "@/server/audit";
import { confirmationSummary, listConfirmations } from "@/server/confirmations";
import { listWorkingPapers } from "@/server/working-papers";
import { AREAS } from "@/domain/audit";
import { todayIso } from "@/domain/client-requests";
import { compareAreas, KIND_LABEL, KINDS, REPLY_LABEL, STATE_LABEL, type ConfirmationState } from "@/domain/confirmations";
import { canReview } from "@/domain/signoff";
import { formatAmount } from "@/domain/money";
import { ActionForm } from "@/app/action-form";
import {
  addConfirmationAction,
  addReminderAction,
  bringForwardConfirmationsAction,
  clearReplyAction,
  clearSentAction,
  deleteConfirmationAction,
  editConfirmationAction,
  linkConfirmationFileAction,
  markSentAction,
  prepareConfirmationAction,
  recordReplyAction,
  removeReminderAction,
  reviewConfirmationAction,
  saveAlternativeProceduresAction,
  saveReconciliationAction,
  unlinkConfirmationFileAction,
  unprepareConfirmationAction,
  unreviewConfirmationAction,
} from "@/app/confirmation-actions";
import { EngagementNav } from "../../nav";

export const dynamic = "force-dynamic";

const input = "w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900";
const small = "rounded border border-slate-400 px-2 py-1 text-xs hover:bg-slate-100";
const FILTERS = [["", "All"], ["awaiting", "Awaiting reply"], ["differs", "With differences"], ["unreviewed", "Not reviewed"]] as const;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const stateClass = (s: ConfirmationState) => (s === "reviewed" ? "text-emerald-800" : s === "prepared" ? "text-blue-800" : s === "to_prepare" ? "text-amber-800" : "text-slate-700");

export default async function ConfirmationsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const filter = one((await searchParams).show);

  const session = await getSession();
  const today = todayIso();
  const { engagement, auditOn, all, summary, papers } = await withFirm(await getDb(), session.firmId, async (tx) => {
    const engagement = await repo.getEngagement(tx, id);
    const auditOn = engagement ? ((await getAuditOverview(tx, id))?.enabled ?? false) : false;
    return {
      engagement,
      auditOn,
      all: auditOn ? await listConfirmations(tx, id) : [],
      summary: auditOn ? await confirmationSummary(tx, id) : null,
      papers: auditOn ? await listWorkingPapers(tx, id) : [],
    };
  });
  if (!engagement) notFound();

  const open = engagement.status === "open" && auditOn;
  const reviewer = canReview(session.role);
  const shown = all.filter((c) => (filter === "awaiting" ? c.state === "awaiting_reply" : filter === "differs" ? c.reply === "differs" : filter === "unreviewed" ? c.state !== "reviewed" : true));
  const areas = [...new Set(shown.map((c) => c.areaCode))].sort(compareAreas);
  const summaryAreas = summary ? [...summary.byArea.keys()].sort(compareAreas) : [];

  return (
    <div className="py-8 text-slate-900">
      <Link href="/" className="text-sm text-blue-700 underline">All engagements</Link>
      <h1 className="mt-2 text-2xl font-semibold">{engagement.clientName}</h1>
      <p className="mt-1 text-sm text-slate-600">{engagement.periodStart} to {engagement.periodEnd}</p>
      <EngagementNav id={id} current="confirmations" status={engagement.status} />

      <h2 className="mt-6 text-xl font-semibold">External confirmations</h2>
      <p className="mt-1 text-sm text-slate-700">
        Who each confirmation went to, the balance in the books, when it was sent and chased, the reply, any difference and how it was dealt with, and who prepared and reviewed it.
        <Link href={`/engagements/${id}/audit`} className="ml-2 text-blue-700 underline">Back to Audit</Link>
      </p>

      {!auditOn ? (
        <p role="status" className="mt-4 rounded border border-slate-400 bg-slate-100 px-3 py-2 text-sm">The audit is off for this engagement, so there are no confirmations to show. A reviewer or partner turns it on from the Audit tab.</p>
      ) : (
        <>
          {summary && summary.overall.count > 0 && (
            <section className="mt-4 overflow-x-auto" aria-label="Summary by area">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-300 text-slate-600">
                  <tr>
                    <th className="py-2 font-medium">Area</th>
                    {["Total", "Not sent", "Awaiting", "Agreed", "Differs", "No reply", "Prepared", "Reviewed"].map((h) => <th key={h} className="py-2 pl-3 text-right font-medium">{h}</th>)}
                    {["Book", "Confirmed", "Net difference"].map((h) => <th key={h} className="py-2 pl-3 text-right font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[...summaryAreas.map((code) => [code, summary.byArea.get(code)!] as const), ["All areas", summary.overall] as const].map(([code, s]) => (
                    <tr key={code} className={`border-b border-slate-200 ${code === "All areas" ? "font-semibold" : ""}`}>
                      <td className="py-2">{code === "All areas" ? code : `${code} ${AREAS.find((a) => a.code === code)?.title ?? ""}`.trim()}</td>
                      {[s.count, s.notSent, s.awaitingReply, s.agreed, s.differs, s.noReply, s.prepared, s.reviewed].map((n, i) => <td key={i} className="py-2 pl-3 text-right tabular-nums">{n}</td>)}
                      <td className="py-2 pl-3 text-right tabular-nums">{formatAmount(s.bookMinor)}</td>
                      <td className="py-2 pl-3 text-right tabular-nums">{formatAmount(s.confirmedMinor)}</td>
                      <td className="py-2 pl-3 text-right tabular-nums">{formatAmount(s.differenceMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-xs text-slate-600">Net difference is book less confirmed, over the confirmations that have a confirmed amount.</p>
            </section>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <a href={`/engagements/${id}/audit/confirmations/export`} className="text-blue-700 underline">Download (Excel)</a>
            <span className="text-slate-500">Show:</span>
            {FILTERS.map(([value, label]) => (
              <Link key={value} href={`/engagements/${id}/audit/confirmations${value ? `?show=${value}` : ""}`} aria-current={filter === value ? "true" : undefined} className={filter === value ? "font-semibold" : "text-blue-700 underline"}>{label}</Link>
            ))}
          </div>

          {open && (
            <section className="mt-6 rounded border border-slate-200 p-4">
              <h3 className="font-semibold">Add a confirmation</h3>
              <ActionForm action={addConfirmationAction} fields={{ engagementId: id }} className="mt-2">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1 text-xs text-slate-700">Kind
                    <select name="kind" defaultValue="bank" className={input}>{KINDS.map((k) => <option key={k.code} value={k.code}>{k.label}</option>)}</select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-slate-700">Area
                    <select name="areaCode" defaultValue="" className={input}>
                      <option value="">The usual area for the kind</option>
                      {AREAS.map((a) => <option key={a.code} value={a.code}>{a.code} {a.title}</option>)}
                    </select>
                  </label>
                  <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs text-slate-700">Goes to
                    <input name="partyName" required maxLength={200} className={input} />
                  </label>
                  <label className="flex min-w-48 flex-col gap-1 text-xs text-slate-700">Contact (address or email)
                    <input name="contact" maxLength={500} className={input} />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-slate-700">Account or code
                    <input name="accountRef" maxLength={100} className={input} />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-slate-700">Balance per books
                    <input name="book" inputMode="decimal" placeholder="0.00" className={`${input} text-right`} />
                  </label>
                  <button className={small}>Add</button>
                </div>
                <p className="mt-2 text-xs text-slate-600">For &ldquo;Other&rdquo; choose the area. The book balance is the amount the client&apos;s books show for that party and can be negative.</p>
              </ActionForm>
              {engagement.priorEngagementId && (
                <ActionForm action={bringForwardConfirmationsAction} fields={{ engagementId: id }} className="mt-4 border-t border-slate-200 pt-3">
                  <button className={small}>Bring forward from last year</button>
                  <span className="ml-2 text-xs text-slate-600">Copies kind, area, party, contact and account from the prior-year engagement as new confirmations with a zero book balance. Ones already there are skipped.</span>
                </ActionForm>
              )}
            </section>
          )}
          <p className="mt-4 max-w-3xl text-xs text-slate-600">
            A lawyer&apos;s reply: record Agreed when it is consistent with what the books show for that matter (the book balance may be 0), or Differs with the lawyer&apos;s amount otherwise, and put the detail in the reply note.
          </p>

          {all.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">No confirmations yet.</p>
          ) : shown.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">None match this filter. <Link href={`/engagements/${id}/audit/confirmations`} className="text-blue-700 underline">Show all</Link></p>
          ) : (
            areas.map((code) => (
              <section key={code} className="mt-8" aria-labelledby={`area-${code}`}>
                <h3 id={`area-${code}`} className="text-base font-semibold">{shown.find((c) => c.areaCode === code)!.areaTitle}</h3>
                <ul className="mt-2 space-y-3">
                  {shown.filter((c) => c.areaCode === code).map((c) => {
                    const unlinked = papers.filter((p) => !c.files.some((f) => f.id === p.id));
                    const editable = open && !c.reviewedByName;
                    return (
                      <li key={c.id} className="rounded border border-slate-200 p-3">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span className="font-semibold tabular-nums">{c.reference}</span>
                          <span className="rounded bg-slate-100 px-1.5 text-xs">{KIND_LABEL[c.kind]}</span>
                          <span className="font-medium">{c.partyName}</span>
                          {c.accountRef && <span className="text-xs text-slate-600">{c.accountRef}</span>}
                          <span className={`text-sm font-medium ${stateClass(c.state)}`}>{STATE_LABEL[c.state]}</span>
                        </div>
                        {c.contact && <p className="mt-1 text-xs text-slate-600">{c.contact}</p>}
                        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                          <div><dt className="text-xs text-slate-600">Book balance</dt><dd className="tabular-nums">{formatAmount(c.bookMinor)}</dd></div>
                          <div><dt className="text-xs text-slate-600">Sent on</dt><dd>{c.sentOn ?? "Not sent"}</dd></div>
                          <div><dt className="text-xs text-slate-600">Reminders</dt><dd>{c.reminders.length > 0 ? c.reminders.join(", ") : "None"}</dd></div>
                          <div><dt className="text-xs text-slate-600">Reply</dt><dd>{c.reply ? `${REPLY_LABEL[c.reply]}${c.repliedOn ? ` on ${c.repliedOn}` : ""}` : "None yet"}</dd></div>
                          <div><dt className="text-xs text-slate-600">Confirmed balance</dt><dd className="tabular-nums">{c.confirmedMinor === null ? "None" : formatAmount(c.confirmedMinor)}</dd></div>
                          <div><dt className="text-xs text-slate-600">Difference (book less confirmed)</dt><dd className="tabular-nums">{c.differenceMinor === null ? "None" : formatAmount(c.differenceMinor)}</dd></div>
                          <div><dt className="text-xs text-slate-600">Prepared by</dt><dd>{c.preparedByName ? `${c.preparedByName}, ${c.preparedAt}` : "Not prepared"}</dd></div>
                          <div><dt className="text-xs text-slate-600">Reviewed by</dt><dd>{c.reviewedByName ? `${c.reviewedByName}, ${c.reviewedAt}${c.selfReviewed ? " (self-reviewed)" : ""}` : "Not reviewed"}</dd></div>
                        </dl>
                        {c.replyNote && <p className="mt-2 text-sm"><span className="text-xs text-slate-600">Reply note: </span>{c.replyNote}</p>}
                        {c.reconciliation && <p className="mt-1 text-sm"><span className="text-xs text-slate-600">Reconciliation: </span>{c.reconciliation}</p>}
                        {c.alternativeProcedures && <p className="mt-1 text-sm"><span className="text-xs text-slate-600">Alternative procedures: </span>{c.alternativeProcedures}</p>}
                        {c.files.length > 0 && (
                          <ul className="mt-2 space-y-1 text-sm">
                            {c.files.map((f) => (
                              <li key={f.id} className="flex flex-wrap items-center gap-3">
                                <a href={`/engagements/${id}/files/${f.id}`} className="text-blue-700 underline">{f.fileName}</a>
                                {editable && (
                                  <ActionForm action={unlinkConfirmationFileAction} fields={{ confirmationId: c.id, fileId: f.id }}>
                                    <button className={small}>Unlink</button>
                                  </ActionForm>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}

                        {open && c.reviewedByName && (
                          <div className="mt-2 flex flex-wrap items-start gap-3">
                            {reviewer && (
                              <ActionForm action={unreviewConfirmationAction} fields={{ confirmationId: c.id }}>
                                <button className={small}>Withdraw review</button>
                              </ActionForm>
                            )}
                            <p className="text-xs text-slate-600">Reviewed: withdraw the review to change it.</p>
                          </div>
                        )}
                        {editable && (
                          <div className="mt-2 flex flex-wrap items-start gap-3">
                            {!c.sentOn ? (
                              <ActionForm action={markSentAction} fields={{ confirmationId: c.id }} className="flex items-center gap-1">
                                <input type="date" name="sentOn" defaultValue={today} max={today} aria-label={`Sent on, ${c.reference}`} className="rounded border border-slate-300 px-1 py-1 text-xs" />
                                <button className={small}>Mark sent</button>
                              </ActionForm>
                            ) : (
                              <>
                                <ActionForm action={markSentAction} fields={{ confirmationId: c.id }} className="flex items-center gap-1">
                                  <input type="date" name="sentOn" defaultValue={c.sentOn} max={today} aria-label={`Change the date sent, ${c.reference}`} className="rounded border border-slate-300 px-1 py-1 text-xs" />
                                  <button className={small}>Change date sent</button>
                                </ActionForm>
                                {!c.reply && c.reminders.length === 0 && (
                                  <ActionForm action={clearSentAction} fields={{ confirmationId: c.id }}><button className={small}>Clear sent date</button></ActionForm>
                                )}
                                {c.reminders.length < 5 && (
                                  <ActionForm action={addReminderAction} fields={{ confirmationId: c.id }} className="flex items-center gap-1">
                                    <input type="date" name="on" defaultValue={today} min={c.sentOn} max={today} aria-label={`Reminder date, ${c.reference}`} className="rounded border border-slate-300 px-1 py-1 text-xs" />
                                    <button className={small}>Add reminder</button>
                                  </ActionForm>
                                )}
                                {c.reminders.map((r) => (
                                  <ActionForm key={r} action={removeReminderAction} fields={{ confirmationId: c.id, on: r }}>
                                    <button className={small} aria-label={`Remove the reminder of ${r}`}>Remove reminder {r}</button>
                                  </ActionForm>
                                ))}
                              </>
                            )}
                          </div>
                        )}

                        {editable && c.sentOn && (
                          <details className="mt-2 text-xs" open={!c.reply}>
                            <summary className="cursor-pointer text-blue-700 underline">{c.reply ? "Change the reply" : "Record the reply"}</summary>
                            <ActionForm action={recordReplyAction} fields={{ confirmationId: c.id }} className="mt-2 flex flex-wrap items-end gap-2">
                              <label className="flex flex-col gap-1 text-slate-700">Reply
                                <select name="reply" defaultValue={c.reply ?? "agreed"} className={input}>
                                  <option value="agreed">Agreed with the books</option>
                                  <option value="differs">Differs from the books</option>
                                  <option value="no_reply">No reply</option>
                                </select>
                              </label>
                              <label className="flex flex-col gap-1 text-slate-700">Replied on<input type="date" name="repliedOn" defaultValue={c.repliedOn ?? today} min={c.sentOn} max={today} className={input} /></label>
                              <label className="flex flex-col gap-1 text-slate-700">Confirmed amount (when it differs)<input name="confirmed" inputMode="decimal" defaultValue={c.reply === "differs" && c.confirmedMinor !== null ? formatAmount(c.confirmedMinor).replace(/[(),]/g, (m) => (m === "(" ? "-" : "")) : ""} className={`${input} text-right`} /></label>
                              <label className="flex min-w-56 flex-1 flex-col gap-1 text-slate-700">Reply note<input name="replyNote" defaultValue={c.replyNote ?? ""} maxLength={2000} className={input} /></label>
                              <button className={small}>Save reply</button>
                            </ActionForm>
                            {c.reply && (
                              <ActionForm action={clearReplyAction} fields={{ confirmationId: c.id }} className="mt-2"><button className={small}>Clear the reply</button></ActionForm>
                            )}
                          </details>
                        )}
                        {editable && c.reply === "differs" && (
                          <ActionForm action={saveReconciliationAction} fields={{ confirmationId: c.id }} className="mt-2">
                            <label className="flex flex-col gap-1 text-xs text-slate-700">Reconciliation of the difference
                              <textarea name="text" defaultValue={c.reconciliation ?? ""} rows={3} maxLength={4000} className={input} />
                            </label>
                            <button className={`${small} mt-1`}>Save reconciliation</button>
                          </ActionForm>
                        )}
                        {editable && c.reply === "no_reply" && (
                          <ActionForm action={saveAlternativeProceduresAction} fields={{ confirmationId: c.id }} className="mt-2">
                            <label className="flex flex-col gap-1 text-xs text-slate-700">Alternative procedures performed
                              <textarea name="text" defaultValue={c.alternativeProcedures ?? ""} rows={3} maxLength={4000} className={input} />
                            </label>
                            <button className={`${small} mt-1`}>Save alternative procedures</button>
                          </ActionForm>
                        )}

                        {editable && (
                          <div className="mt-2 flex flex-wrap items-start gap-3">
                            {unlinked.length > 0 && (
                              <ActionForm action={linkConfirmationFileAction} fields={{ confirmationId: c.id }} className="flex items-center gap-1">
                                <select name="fileId" aria-label={`Link a file, ${c.reference}`} className="max-w-48 rounded border border-slate-300 bg-white px-1 py-1 text-xs">
                                  {unlinked.map((p) => <option key={p.id} value={p.id}>{p.fileName}</option>)}
                                </select>
                                <button className={small}>Link file</button>
                              </ActionForm>
                            )}
                            {!c.preparedByName && (
                              <ActionForm action={prepareConfirmationAction} fields={{ confirmationId: c.id }}><button className={small}>Mark prepared</button></ActionForm>
                            )}
                            {c.preparedByName && (
                              <>
                                <ActionForm action={unprepareConfirmationAction} fields={{ confirmationId: c.id }}><button className={small}>Withdraw preparation</button></ActionForm>
                                {reviewer && <ActionForm action={reviewConfirmationAction} fields={{ confirmationId: c.id }}><button className={small}>Mark reviewed</button></ActionForm>}
                              </>
                            )}
                            {(!c.reply || reviewer) && c.files.length === 0 && (
                              <ActionForm action={deleteConfirmationAction} fields={{ confirmationId: c.id }}><button className={small}>Delete</button></ActionForm>
                            )}
                            <details className="text-xs">
                              <summary className="cursor-pointer text-blue-700 underline">Edit</summary>
                              <ActionForm action={editConfirmationAction} fields={{ confirmationId: c.id }} className="mt-2 space-y-2">
                                <label className="flex flex-col gap-1 text-slate-700">Kind
                                  <select name="kind" defaultValue={c.kind} className={input}>{KINDS.map((k) => <option key={k.code} value={k.code}>{k.label}</option>)}</select>
                                </label>
                                <label className="flex flex-col gap-1 text-slate-700">Area
                                  <select name="areaCode" defaultValue={c.areaCode} className={input}>{AREAS.map((a) => <option key={a.code} value={a.code}>{a.code} {a.title}</option>)}</select>
                                </label>
                                <label className="flex flex-col gap-1 text-slate-700">Goes to<input name="partyName" defaultValue={c.partyName} required maxLength={200} className={input} /></label>
                                <label className="flex flex-col gap-1 text-slate-700">Contact<input name="contact" defaultValue={c.contact ?? ""} maxLength={500} className={input} /></label>
                                <label className="flex flex-col gap-1 text-slate-700">Account or code<input name="accountRef" defaultValue={c.accountRef ?? ""} maxLength={100} className={input} /></label>
                                <label className="flex flex-col gap-1 text-slate-700">Balance per books (clear the reply first to change it)
                                  <input name="book" inputMode="decimal" defaultValue={(c.bookMinor / 100).toFixed(2)} className={`${input} text-right`} />
                                </label>
                                <button className={small}>Save</button>
                              </ActionForm>
                            </details>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
          {engagement.status !== "open" && <p className="mt-6 text-xs text-slate-600">This engagement is locked, so this page is read-only.</p>}
        </>
      )}
    </div>
  );
}
