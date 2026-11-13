import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import * as review from "@/server/review";
import { canLock, canReview } from "@/domain/signoff";
import { GROUPS } from "@/domain/groups";
import { formatAmount } from "@/domain/money";
import { ActionForm } from "@/app/action-form";
import {
  addReviewPointAction,
  clearReviewPointAction,
  lockAction,
  respondReviewPointAction,
  signOffAction,
  unlockAction,
  withdrawSignOffAction,
} from "@/app/review-actions";
import { EngagementNav } from "../nav";

export const dynamic = "force-dynamic";

const small = "rounded border border-slate-400 px-2 py-1 text-xs hover:bg-slate-100";
const primary = "rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700";
const input = "rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const session = await getSession();
  const { engagement, overview } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    engagement: await repo.getEngagement(tx, id),
    overview: await review.getOverview(tx, id),
  }));
  if (!engagement || !overview) notFound();

  const open = overview.status === "open";
  const reviewer = canReview(session.role);
  const openPoints = overview.points.filter((p) => p.status === "open");
  const clearedPoints = overview.points.filter((p) => p.status === "cleared");
  const targets = [{ code: review.GENERAL, name: "General (whole engagement)" }, ...overview.leadSheets.map((l) => ({ code: l.groupCode, name: l.groupName }))];
  const sortOf = new Map(GROUPS.map((g) => [g.code, g.sort]));
  const sheets = [...overview.leadSheets].sort((a, b) => (sortOf.get(a.groupCode) ?? 0) - (sortOf.get(b.groupCode) ?? 0));

  const cell = (sheet: review.LeadSheetReview, level: "preparer" | "reviewer") => {
    const signed = sheet[level];
    const fields = { engagementId: id, groupCode: sheet.groupCode, level };
    if (signed) {
      return (
        <div>
          <span>{signed.name}</span> <span className="text-xs text-slate-600">{signed.at}</span>
          {open && signed.userId === session.userId && (
            <ActionForm action={withdrawSignOffAction} fields={fields} className="mt-1">
              <button className={small}>Withdraw</button>
            </ActionForm>
          )}
        </div>
      );
    }
    if (!open) return <span className="text-slate-500">Not signed</span>;
    if (level === "reviewer" && !reviewer) return <span className="text-slate-500">Awaiting reviewer</span>;
    return (
      <ActionForm action={signOffAction} fields={fields}>
        <button className={small}>{level === "preparer" ? "Sign as prepared" : "Sign as reviewed"}</button>
      </ActionForm>
    );
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 text-slate-900">
      <Link href="/" className="text-sm text-blue-700 underline">All engagements</Link>
      <h1 className="mt-2 text-2xl font-semibold">{engagement.clientName}</h1>
      <p className="mt-1 text-sm text-slate-600">{engagement.periodStart} to {engagement.periodEnd}</p>
      <EngagementNav id={id} current="review" status={engagement.status} />

      <section className={`mt-6 rounded border p-4 ${!open ? "border-slate-400 bg-slate-100" : overview.readiness.ready ? "border-emerald-300 bg-emerald-50" : "border-amber-400 bg-amber-50"}`}>
        {!open ? (
          <>
            <h2 className="text-base font-semibold">Locked</h2>
            <p className="mt-1 text-sm">
              Locked by {overview.lockedByName} on {overview.lockedAt}. Nothing on this engagement can be changed while it is locked.
            </p>
            {canLock(session.role) && (
              <ActionForm action={unlockAction} fields={{ engagementId: id }} className="mt-3">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1 text-sm">
                    Reason for unlocking (recorded in the audit log)
                    <input name="reason" required minLength={5} maxLength={500} className={`${input} w-80`} />
                  </label>
                  <button className={small}>Unlock</button>
                </div>
              </ActionForm>
            )}
          </>
        ) : overview.readiness.ready ? (
          <>
            <h2 className="text-base font-semibold">Ready to lock</h2>
            <p className="mt-1 text-sm">Every lead sheet is prepared and reviewed, no review points are open, and the statement checks pass.</p>
            {(overview.auditNotApplicable ?? 0) > 0 && (
              <p className="mt-1 text-sm font-medium">
                {overview.auditNotApplicable} audit procedure(s) were marked not applicable. Review the reasons on the{" "}
                <Link href={`/engagements/${id}/audit`} className="text-blue-700 underline">Audit tab</Link> before locking.
              </p>
            )}
            {canLock(session.role) ? (
              <ActionForm action={lockAction} fields={{ engagementId: id }} className="mt-3">
                <button className={primary}>Lock engagement</button>
              </ActionForm>
            ) : (
              <p className="mt-2 text-sm text-slate-700">A partner can now lock the engagement.</p>
            )}
          </>
        ) : (
          <>
            <h2 className="text-base font-semibold">Not ready to lock</h2>
            <ul className="mt-2 list-disc pl-5 text-sm">
              {overview.readiness.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Lead sheet sign-off</h2>
        <p className="mt-1 text-sm text-slate-600">
          A sign-off is removed automatically if the lead sheet&apos;s figures change afterwards.{" "}
          {overview.solePractitioner
            ? "You are the firm's only user, so you may review your own lead sheets; each self-review is recorded in the audit log."
            : "The reviewer must be a different person from the preparer."}
        </p>
        {sheets.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">Import a trial balance and map its accounts to see lead sheets here.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-300 text-slate-600">
                <tr>
                  <th className="py-2 font-medium">Lead sheet</th>
                  <th className="py-2 pl-4 text-right font-medium">Balance</th>
                  <th className="py-2 pl-4 font-medium">Prepared by</th>
                  <th className="py-2 pl-4 font-medium">Reviewed by</th>
                  <th className="py-2 pl-4 font-medium">Open points</th>
                </tr>
              </thead>
              <tbody>
                {sheets.map((sheet) => (
                  <tr key={sheet.groupCode} className="border-b border-slate-200 align-top">
                    <td className="py-2">
                      <Link href={`/engagements/${id}#ls-${sheet.groupCode}`} className="text-blue-700 underline">{sheet.groupName}</Link>
                    </td>
                    <td className="py-2 pl-4 text-right tabular-nums whitespace-nowrap">{formatAmount(sheet.closingMinor)}</td>
                    <td className="py-2 pl-4">{cell(sheet, "preparer")}</td>
                    <td className="py-2 pl-4">{cell(sheet, "reviewer")}</td>
                    <td className="py-2 pl-4">{sheet.openPoints > 0 ? <span className="font-semibold text-red-800">{sheet.openPoints}</span> : "0"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Review points</h2>

        {open && reviewer && (
          <ActionForm action={addReviewPointAction} fields={{ engagementId: id }} className="mt-3 rounded border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                Relates to
                <select name="target" className={input} defaultValue={review.GENERAL}>
                  {targets.map((t) => (
                    <option key={t.code} value={t.code}>{t.name}</option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-72 flex-1 flex-col gap-1 text-sm text-slate-700">
                Review point
                <input name="body" required minLength={3} maxLength={2000} className={input} />
              </label>
              <button className={primary}>Raise point</button>
            </div>
          </ActionForm>
        )}
        {open && !reviewer && <p className="mt-2 text-sm text-slate-600">Reviewers and partners raise review points; you can respond to them here.</p>}

        {overview.points.length === 0 && <p className="mt-3 text-sm text-slate-600">No review points have been raised.</p>}

        {openPoints.map((p) => (
          <div key={p.id} className="mt-3 rounded border border-amber-400 bg-amber-50 p-3 text-sm">
            <p className="text-xs text-slate-700">
              {p.targetName} · raised by {p.authorName} on {p.createdAt}
            </p>
            <p className="mt-1 font-medium">{p.body}</p>
            {p.response && (
              <p className="mt-2 border-l-2 border-slate-400 pl-2">
                {p.response} <span className="text-xs text-slate-600">— {p.responderName}</span>
              </p>
            )}
            {open && (
              <div className="mt-2 flex flex-wrap items-start gap-3">
                <ActionForm action={respondReviewPointAction} fields={{ engagementId: id, pointId: p.id }} className="flex-1">
                  <div className="flex gap-2">
                    <input name="response" required minLength={2} maxLength={2000} aria-label="Response" placeholder={p.response ? "Replace the response" : "Respond"} className={`${input} min-w-56 flex-1`} />
                    <button className={small}>Save response</button>
                  </div>
                </ActionForm>
                {reviewer && (
                  <ActionForm action={clearReviewPointAction} fields={{ engagementId: id, pointId: p.id }}>
                    <button className={small}>Clear point</button>
                  </ActionForm>
                )}
              </div>
            )}
          </div>
        ))}

        {clearedPoints.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-blue-700 underline">{clearedPoints.length} cleared point(s)</summary>
            {clearedPoints.map((p) => (
              <div key={p.id} className="mt-2 rounded border border-slate-200 p-3 text-sm">
                <p className="text-xs text-slate-600">
                  {p.targetName} · raised by {p.authorName} on {p.createdAt} · cleared by {p.clearedByName}
                </p>
                <p className="mt-1">{p.body}</p>
                {p.response && (
                  <p className="mt-1 border-l-2 border-slate-300 pl-2 text-slate-700">
                    {p.response} <span className="text-xs">— {p.responderName}</span>
                  </p>
                )}
              </div>
            ))}
          </details>
        )}
      </section>
    </main>
  );
}
