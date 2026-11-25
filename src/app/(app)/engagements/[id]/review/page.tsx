import Link from "next/link";
import { Thread } from "@/ui/review-thread";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import * as review from "@/server/review";
import { getRevenuePresumption } from "@/server/planning-answers";
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
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { ctl, Disclosure, fieldLabel } from "@/ui/controls";
import { explainBlocker } from "@/ui/engagement-home";
import { Callout, EmptyState, ProgressBar } from "@/ui/feedback";
import { ArchiveForm } from "@/app/archive-form";
import { ASSEMBLY_RULE } from "@/domain/archiving";
import { todayIso } from "@/domain/client-requests";
import { ARCHIVE_IRREVERSIBLE, ARCHIVE_PREVENTS, ARCHIVE_STAYS, archiveSection, deadlineView } from "@/ui/archive-view";
import { Card, PageHeader, Section, EngagementFacts } from "@/ui/layout";
import { ToDoRows } from "@/ui/todo-rows";
import { openPointsPill, pointControls, readinessView, signCell, signOffProgress, type Level } from "@/ui/review-view";
import { Table, TCell, THead, TRow } from "@/ui/table";
import { count } from "@/ui/text";
import { EngagementNav } from "../nav";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const session = await getSession();
  const { engagement, overview, revenue } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    engagement: await repo.getEngagement(tx, id),
    overview: await review.getOverview(tx, id),
    revenue: await getRevenuePresumption(tx, id),
  }));
  if (!engagement || !overview) notFound();

  const open = overview.status === "open";
  const base = `/engagements/${id}`;
  const view = readinessView({ open, ready: overview.readiness.ready, blockers: overview.readiness.blockers.length, role: session.role, lockedByName: overview.lockedByName, lockedAt: overview.lockedAt, archivedAt: overview.archivedAt, archivedByName: overview.archivedByName });
  const today = todayIso();
  const archived = overview.archivedAt !== null;
  const deadline = deadlineView(overview.reportDate, today, overview.archivedAt);
  const archive = archiveSection({ role: session.role, locked: !open, archived, audited: overview.audited, hasOpinion: overview.hasOpinion, reportDate: overview.reportDate, today });
  const points = pointControls({ open, role: session.role });
  const openPoints = overview.points.filter((p) => p.status === "open");
  const clearedPoints = overview.points.filter((p) => p.status === "cleared");
  const targets = [{ code: review.GENERAL, name: "General (whole engagement)" }, ...overview.leadSheets.map((l) => ({ code: l.groupCode, name: l.groupName }))];
  const sortOf = new Map(GROUPS.map((g) => [g.code, g.sort]));
  const sheets = [...overview.leadSheets].sort((a, b) => (sortOf.get(a.groupCode) ?? 0) - (sortOf.get(b.groupCode) ?? 0));
  const progress = signOffProgress(sheets);

  // One cell of the table or card: who signed and when, a sign button, or who it is waiting on.
  const cell = (sheet: review.LeadSheetReview, level: Level) => {
    const c = signCell({ level, preparer: sheet.preparer, reviewer: sheet.reviewer, openPoints: sheet.openPoints, solePractitioner: overview.solePractitioner, open, role: session.role, userId: session.userId });
    const fields = { engagementId: id, groupCode: sheet.groupCode, level };
    if (c.kind === "signed") {
      return (
        <div>
          <span className="font-medium">{c.name}</span> <span className="text-sm text-ink-muted">{c.at}</span>
          {c.canWithdraw && (
            <ActionForm action={withdrawSignOffAction} fields={fields} className="mt-1">
              <Button variant="secondary" size="sm">
                Withdraw
              </Button>
            </ActionForm>
          )}
        </div>
      );
    }
    if (c.kind === "sign") {
      return (
        <ActionForm action={signOffAction} fields={fields}>
          <Button variant="secondary" size="sm">
            {c.label}
          </Button>
        </ActionForm>
      );
    }
    if (c.kind === "waiting") return <Badge tone="neutral">{c.label}</Badge>;
    if (c.kind === "blocked") return <Badge tone="warning">{c.label}</Badge>;
    return <span className="text-ink-muted">{c.label}</span>;
  };
  const pointsCell = (n: number) => {
    const pill = openPointsPill(n);
    return pill ? <Badge tone={pill.tone}>{pill.label}</Badge> : <span className="text-ink-muted">None</span>;
  };

  return (
    <div className="py-8 text-ink">
      <PageHeader
        breadcrumb={[{ label: "All engagements", href: "/" }]}
        title="Review and sign-off"
        meta={<EngagementFacts client={engagement.clientName} periodStart={engagement.periodStart} periodEnd={engagement.periodEnd} />}
        subtitle={view.sentence}
      />
      <EngagementNav id={id} current="review" status={engagement.status} archived={archived} />

      <div className="mt-6 space-y-8">
        {overview.audited && revenue.rebutted && (
          <Callout variant="warning" title="Revenue presumption rebutted">
            A partner rebutted the presumed significant risk on revenue recognition (C13, ISA 240). Reason: {revenue.reason} Rebutted by {revenue.by} on {revenue.at}.
          </Callout>
        )}
        {view.state === "locked" ? (
          <>
            <Card title={archived ? "Archived" : "Locked"}>
              <p className="flex flex-wrap items-center gap-2">
                <Badge tone="slate">{archived ? "Archived" : "Locked"}</Badge>
                <span className="text-sm">
                  Locked by {overview.lockedByName} on {overview.lockedAt}.{" "}
                  {archived ? "This file is archived: it can never be unlocked or changed. You can still open it, download and export from it." : "Nothing on this engagement can be changed while it is locked."}
                </span>
              </p>
              {archived && (
                <p className="mt-2 text-sm text-ink-muted">
                  Archived on {overview.archivedAt}
                  {overview.archivedByName ? ` by ${overview.archivedByName}` : ""}.
                </p>
              )}
              {view.canUnlock && !archived && (
                <Disclosure summary="Unlock this engagement" className="mt-4">
                  <ActionForm action={unlockAction} fields={{ engagementId: id }}>
                    <div className="flex flex-wrap items-end gap-3">
                      <label className={`${fieldLabel} min-w-72 flex-1`}>
                        Reason for unlocking (recorded in the audit log)
                        <input name="reason" required minLength={5} maxLength={500} className={ctl} />
                      </label>
                      <Button variant="secondary">Unlock</Button>
                    </div>
                  </ActionForm>
                </Disclosure>
              )}
            </Card>

            {overview.audited && (
              <Card title="File assembly deadline">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone={deadline.tone}>{deadline.label}</Badge>
                  <span>{deadline.words}</span>
                </p>
                <p className="mt-2 text-sm text-ink-muted">{ASSEMBLY_RULE}</p>
              </Card>
            )}

            {archive.show && (
              <Section title="Archive the file" description="The permanent lock, for when the file has been assembled.">
                <Callout variant="danger" title={ARCHIVE_IRREVERSIBLE}>
                  <ul className="list-disc pl-5">
                    {ARCHIVE_PREVENTS.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                  <p className="mt-2">{ARCHIVE_STAYS}</p>
                </Callout>
                <div className="mt-4">
                  <ArchiveForm engagementId={id} clientName={engagement.clientName} blocker={archive.blocker} />
                </div>
              </Section>
            )}
          </>
        ) : view.state === "ready" ? (
          <Card title="Ready to lock">
            <p className="flex flex-wrap items-center gap-2">
              <Badge tone="success">Ready to lock</Badge>
              <span className="text-sm">Every lead sheet is prepared and reviewed, no review points are open, and the statement checks pass.</span>
            </p>
            {(overview.auditNotApplicable ?? 0) > 0 && (
              <Callout variant="warning" className="mt-3">
                {count(overview.auditNotApplicable ?? 0, "audit procedure")} {overview.auditNotApplicable === 1 ? "was" : "were"} marked not applicable. Review the reasons on the{" "}
                <Link href={`${base}/audit`} className="font-medium underline">
                  audit planning page
                </Link>{" "}
                before locking.
              </Callout>
            )}
            <div className="mt-4">
              {view.lock === "lock" ? (
                <ActionForm action={lockAction} fields={{ engagementId: id }}>
                  <Button variant="primary">Lock engagement</Button>
                </ActionForm>
              ) : (
                <Badge tone="neutral">Waiting for a partner to lock</Badge>
              )}
            </div>
          </Card>
        ) : (
          <Section title="Still open" description="Each item links to where it is dealt with.">
            <ToDoRows items={overview.readiness.blockers.map((b) => explainBlocker(b, id))} />
          </Section>
        )}

        <Section
          title="Lead sheet sign-off"
          description={`A sign-off is removed automatically if the lead sheet's figures change afterwards. ${
            overview.solePractitioner
              ? "You are the firm's only user, so you may review your own lead sheets; each self-review is recorded in the audit log."
              : "The reviewer must be a different person from the preparer."
          }`}
        >
          {sheets.length === 0 ? (
            <EmptyState title="No lead sheets yet" description="Import a trial balance and map its accounts to see lead sheets here." />
          ) : (
            <>
              <div className="mb-3 max-w-xl">
                <p className="mb-1 text-sm text-ink-muted">{progress.text}</p>
                <ProgressBar value={progress.prepared + progress.reviewed} max={progress.total * 2} label={`Lead sheets signed: ${progress.text}`} showText={false} />
              </div>
              <div className="hidden sm:block">
                <Table caption="Lead sheet sign-off">
                  <THead>
                    <TRow>
                      <TCell header="col">Lead sheet</TCell>
                      <TCell header="col" numeric>
                        Balance
                      </TCell>
                      <TCell header="col">Prepared by</TCell>
                      <TCell header="col">Reviewed by</TCell>
                      <TCell header="col">Open points</TCell>
                    </TRow>
                  </THead>
                  <tbody>
                    {sheets.map((sheet) => (
                      <TRow key={sheet.groupCode} className="align-top">
                        <TCell header="row">
                          <Link href={`${base}/lead-sheets#ls-${sheet.groupCode}`} className="rounded-sm text-accent hover:underline">
                            {sheet.groupName}
                          </Link>
                        </TCell>
                        <TCell numeric>{formatAmount(sheet.closingMinor)}</TCell>
                        <TCell>{cell(sheet, "preparer")}</TCell>
                        <TCell>{cell(sheet, "reviewer")}</TCell>
                        <TCell>{pointsCell(sheet.openPoints)}</TCell>
                      </TRow>
                    ))}
                  </tbody>
                </Table>
              </div>
              {/* Phone: line 1 is the lead sheet and its balance, line 2 the two sign-off states with short labels, and a pill only when there are open points. */}
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface shadow-card sm:hidden">
                {sheets.map((sheet) => {
                  const pill = openPointsPill(sheet.openPoints);
                  return (
                    <li key={sheet.groupCode} className="px-4 py-2.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="min-w-0 font-semibold">
                          <Link href={`${base}/lead-sheets#ls-${sheet.groupCode}`} className="text-accent hover:underline">
                            {sheet.groupName}
                          </Link>
                        </p>
                        <p className="shrink-0 text-sm text-ink tabular-nums">{formatAmount(sheet.closingMinor)}</p>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-start gap-x-4 gap-y-1.5 text-sm">
                        <div className="flex flex-wrap items-center gap-x-1.5">
                          <span className="text-ink-muted">Prepared</span>
                          {cell(sheet, "preparer")}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-1.5">
                          <span className="text-ink-muted">Reviewed</span>
                          {cell(sheet, "reviewer")}
                        </div>
                        {pill && <Badge tone={pill.tone}>{pill.label}</Badge>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Section>

        <Section
          title="Review points"
          description={points.raise ? "Raise a point against a lead sheet or the whole engagement. Anyone can reply; a reviewer clears it once it is dealt with." : "Points raised by reviewers appear here for a reply."}
        >
          <div className="space-y-4">
            {points.raise && (
              <Disclosure summary="Raise a review point">
                <ActionForm action={addReviewPointAction} fields={{ engagementId: id }}>
                  <div className="flex flex-wrap items-end gap-3">
                    <label className={fieldLabel}>
                      Relates to
                      <select name="target" className={ctl} defaultValue={review.GENERAL}>
                        {targets.map((t) => (
                          <option key={t.code} value={t.code}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={`${fieldLabel} min-w-72 flex-1`}>
                      Review point
                      <input name="body" required minLength={3} maxLength={2000} className={ctl} />
                    </label>
                    <Button variant="primary">Raise point</Button>
                  </div>
                </ActionForm>
              </Disclosure>
            )}

            {overview.points.length === 0 && <EmptyState title="No review points" description="No review points have been raised on this engagement." />}

            {openPoints.length > 0 && (
              <ul className="space-y-3">
                {openPoints.map((p) => (
                  <li key={p.id}>
                    <Card>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="flex flex-wrap gap-x-3 text-sm text-ink-muted">
                          <span>{p.targetName}</span>
                          <span>
                            raised by {p.authorName} on {p.createdAt}
                          </span>
                        </p>
                        <Badge tone="warning">Open</Badge>
                      </div>
                      <p className="mt-1 font-semibold">{p.body}</p>
                      <Thread thread={p.thread} />
                      {points.respond && (
                        <ActionForm action={respondReviewPointAction} fields={{ engagementId: id, pointId: p.id }} className="mt-3">
                          <div className="flex flex-wrap items-end gap-2">
                            <label className={`${fieldLabel} min-w-0 flex-1 basis-56`}>
                              {p.thread.length > 0 ? "Reply" : "Response"}
                              <input name="response" required minLength={2} maxLength={2000} className={ctl} />
                            </label>
                            <Button variant="secondary">{p.thread.length > 0 ? "Add reply" : "Save response"}</Button>
                          </div>
                        </ActionForm>
                      )}
                      {points.clear && (
                        <div className="mt-4 flex justify-end border-t border-border pt-3">
                          <ActionForm action={clearReviewPointAction} fields={{ engagementId: id, pointId: p.id }}>
                            <Button variant="primary" size="sm">
                              Clear point
                            </Button>
                          </ActionForm>
                        </div>
                      )}
                    </Card>
                  </li>
                ))}
              </ul>
            )}

            {clearedPoints.length > 0 && (
              <details className="rounded-lg border border-border bg-surface px-4 py-3 shadow-card">
                <summary className="cursor-pointer text-sm font-semibold">{count(clearedPoints.length, "cleared point")}</summary>
                <ul className="mt-3 space-y-2">
                  {clearedPoints.map((p) => (
                    <li key={p.id} className="rounded-md border border-border bg-surface-muted p-3 text-sm">
                      <p className="flex flex-wrap gap-x-3 text-ink-muted">
                        <span>{p.targetName}</span>
                        <span>
                          raised by {p.authorName} on {p.createdAt}
                        </span>
                        <span>cleared by {p.clearedByName}</span>
                      </p>
                      <p className="mt-1">{p.body}</p>
                      <Thread thread={p.thread} />
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}
