import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import { getOpinionPage } from "@/server/opinion";
import { REPORT_NOTICE } from "@/domain/report";
import { ActionForm } from "@/app/action-form";
import { clearOpinionAction } from "@/app/opinion-actions";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Callout } from "@/ui/feedback";
import { Card, PageHeader } from "@/ui/layout";
import { decisionSentence, DOWNLOAD_BEFORE, DOWNLOAD_NOTE, misstatementPill, noticeBody, NOTICE_TITLE, opinionBadge, opinionReadOnlyReason } from "@/ui/opinion-view";
import { Field, Input } from "@/ui/form";
import { EngagementNav } from "../../nav";
import { OpinionForm } from "./opinion-form";

export const dynamic = "force-dynamic";

export default async function AuditorsReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const session = await getSession();
  const { engagement, page } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    engagement: await repo.getEngagement(tx, id),
    page: await getOpinionPage(tx, id),
  }));
  if (!engagement || !page) notFound();
  const base = `/engagements/${id}/audit`;
  const open = engagement.status === "open";
  const decision = page.opinion;
  const readOnly = opinionReadOnlyReason({ role: session.role, open, auditOn: page.enabled });
  const mis = misstatementPill(page);

  return (
    <div className="py-8 text-ink">
      <PageHeader
        breadcrumb={[{ label: "All engagements", href: "/" }]}
        title="Auditor's report"
        meta={
          <>
            <span>{engagement.clientName}</span>
            <span aria-hidden="true">·</span>
            <span>
              {engagement.periodStart} to {engagement.periodEnd}
            </span>
            <span aria-hidden="true">·</span>
            <Link href={base} className="text-accent hover:underline">
              Back to audit planning
            </Link>
          </>
        }
        subtitle="The partner's decision on the audit opinion. The report is worded from it."
      />
      <EngagementNav id={id} current="report" status={engagement.status} archived={engagement.archivedAt !== null} />

      <div className="mt-6 min-w-0 space-y-6">
        {!page.enabled ? (
          <Callout variant="info">
            The auditor&apos;s report is for audited engagements. Turn the audit on from the{" "}
            <Link href={base} className="font-medium underline">
              audit page
            </Link>{" "}
            first.
          </Callout>
        ) : (
          <>
            <Callout variant="draft" title={NOTICE_TITLE}>
              {noticeBody(REPORT_NOTICE)}
            </Callout>

            <Card title="The file" description="What the opinion has to answer to.">
              <div className="space-y-3 text-sm">
                <p className="flex flex-wrap items-center gap-2">
                  <Badge tone={mis.tone}>{mis.label}</Badge>
                  <span>{mis.sentence}</span>{" "}
                  <Link href={`${base}#misstatements`} className="text-accent hover:underline">
                    Planning, misstatements
                  </Link>
                </p>
                {page.blockers.length > 0 && (
                  <Callout variant="warning" title="Stopping the engagement from being locked">
                    <ul className="list-disc pl-5">
                      {page.blockers.map((b) => (
                        <li key={b}>{b.replace(/^Audit: /, "")}</li>
                      ))}
                    </ul>
                  </Callout>
                )}
              </div>
            </Card>

            <Card title="The decision">
              {decision ? (
                <div className="space-y-3 text-sm">
                  <p className="flex flex-wrap items-center gap-2">
                    <Badge tone={opinionBadge(decision.opinion).tone}>{opinionBadge(decision.opinion).label}</Badge>
                    <span>{decisionSentence(decision)}</span>
                  </p>
                  {decision.basisForModification && (
                    <div>
                      <h3 className="font-medium">Basis for the modification</h3>
                      <p className="whitespace-pre-line text-ink-muted">{decision.basisForModification}</p>
                    </div>
                  )}
                  {decision.goingConcernNote && <p>Material uncertainty about going concern, disclosed in note {decision.goingConcernNote}.</p>}
                  {decision.emphasisOfMatter && (
                    <div>
                      <h3 className="font-medium">Emphasis of matter</h3>
                      <p className="whitespace-pre-line text-ink-muted">{decision.emphasisOfMatter}</p>
                    </div>
                  )}
                  {decision.otherMatter && (
                    <div>
                      <h3 className="font-medium">Other matter</h3>
                      <p className="whitespace-pre-line text-ink-muted">{decision.otherMatter}</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-ink-muted">No opinion recorded yet.</p>
              )}
            </Card>

            <Card title="Download the report (Word)">
              {decision ? (
                <form method="post" action={`${base}/report/download`} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Engagement partner" hint="Printed in the signature block. Used for this download only.">
                      <Input name="partner" defaultValue={decision.decidedByName} maxLength={200} />
                    </Field>
                    <Field label="City" hint="Printed in the signature block. Used for this download only.">
                      <Input name="city" maxLength={200} />
                    </Field>
                  </div>
                  <Button variant="primary">Download the report (Word)</Button>
                  <p className="text-sm text-ink-muted">{DOWNLOAD_NOTE}</p>
                </form>
              ) : (
                <p className="text-sm text-ink-muted">{DOWNLOAD_BEFORE}</p>
              )}
            </Card>

            {readOnly ? (
              <p className="text-sm text-ink-muted">{readOnly}</p>
            ) : (
              <>
                <Card title={decision ? "Change the opinion" : "Record the opinion"} description="Only a partner can do this. It can be changed until the engagement is locked.">
                  <OpinionForm
                    engagementId={id}
                    defaults={{
                      opinion: decision?.opinion ?? "",
                      basis: decision?.basisForModification ?? "",
                      goingConcern: decision?.goingConcernNote != null,
                      goingConcernNote: decision?.goingConcernNote ?? "",
                      emphasis: decision?.emphasisOfMatter ?? "",
                      otherMatter: decision?.otherMatter ?? "",
                      reportDate: decision?.reportDate ?? "",
                    }}
                  />
                </Card>
                {decision && (
                  <div className="border-t border-border pt-6">
                    <ActionForm action={clearOpinionAction} fields={{ engagementId: id }}>
                      <p className="mb-2 text-sm text-ink-muted">Clearing the opinion removes the decision above. The engagement cannot be locked again until a new one is recorded.</p>
                      <Button variant="secondary">Clear the opinion</Button>
                    </ActionForm>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
