import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import { getLetterContext } from "@/server/letters";
import { longDate } from "@/domain/letters";
import { Button } from "@/ui/button";
import { Callout } from "@/ui/feedback";
import { Field, Input, Textarea } from "@/ui/form";
import { Card, PageHeader } from "@/ui/layout";
import { lettersSentence, misstatementSentence } from "@/ui/letters-view";
import { EngagementNav } from "../../nav";

export const dynamic = "force-dynamic";

const check = "flex items-center gap-2 text-sm text-ink";
const box = "size-4 accent-accent";

export default async function LettersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const session = await getSession();
  const { engagement, context } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    engagement: await repo.getEngagement(tx, id),
    context: await getLetterContext(tx, id),
  }));
  if (!engagement) notFound();
  const base = `/engagements/${id}/audit`;
  const uncorrected = context?.uncorrected.map((m) => m.amountMinor) ?? [];

  return (
    <div className="py-8 text-ink">
      <PageHeader
        breadcrumb={[{ label: "All engagements", href: "/" }]}
        title="Letters"
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
        subtitle={context ? lettersSentence(uncorrected) : undefined}
      />
      <EngagementNav id={id} current="letters" status={engagement.status} archived={engagement.archivedAt !== null} />

      <div className="mt-6 min-w-0 space-y-6">
        {!context ? (
          <Callout variant="info">
            Letters are for audited engagements. Turn the audit on from the{" "}
            <Link href={base} className="font-medium underline">
              audit page
            </Link>{" "}
            first.
          </Callout>
        ) : (
          <>
            <Callout variant="draft" title="Template wording: draft, not yet reviewed.">
              Each letter downloads as a Word document for you to check, complete and put on your letterhead. Anything left blank here appears in the letter in [square brackets]. The engagement letter&apos;s &ldquo;Other terms&rdquo; section is
              left for your firm&apos;s own terms, which a lawyer should review.
            </Callout>
            <p className="text-sm text-ink-muted">
              Filled in for you: {context.firmName}, {context.clientName}, year end {longDate(context.periodEnd)}, {context.framework}. What you type below is used for the download only and is not saved.
            </p>

            <Card title="Engagement letter" description="Sent before the audit starts, and signed by the client to agree the terms.">
              <form method="post" action={`${base}/letters/engagement`} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Addressed to">
                  <Input name="addressee" placeholder="The Directors" maxLength={200} />
                </Field>
                <Field label="Letter date">
                  <Input name="date" type="date" />
                </Field>
                <Field label="Engagement partner">
                  <Input name="partnerName" maxLength={200} />
                </Field>
                <Field label="Fieldwork period">
                  <Input name="fieldwork" placeholder="February 2026" maxLength={200} />
                </Field>
                <Field label="Information needed by">
                  <Input name="informationDate" type="date" />
                </Field>
                <Field label="Report target date">
                  <Input name="targetDate" type="date" />
                </Field>
                <Field label="Fee and basis">
                  <Input name="fee" placeholder="AED 25,000, fixed" maxLength={200} />
                </Field>
                <Field label="Payment terms">
                  <Input name="paymentTerms" placeholder="within 30 days of invoice" maxLength={200} />
                </Field>
                <Field label="Where client data is stored">
                  <Input name="dataLocation" placeholder="the United Arab Emirates" maxLength={200} />
                </Field>
                <Field label="Other services you provide to this client (leave blank if none)" className="sm:col-span-2 lg:col-span-3">
                  <Input name="otherServices" placeholder="bookkeeping and VAT return preparation" maxLength={300} />
                </Field>
                <label className={`${check} sm:col-span-2 lg:col-span-3`}>
                  <input type="checkbox" name="ai" className={box} /> Say that artificial-intelligence tools are used on the audit
                </label>
                <div className="sm:col-span-2 lg:col-span-3">
                  <Button variant="primary">Download engagement letter (Word)</Button>
                </div>
              </form>
            </Card>

            <Card
              title="Management representation letter"
              description="Signed by the client at the end of the audit, on its own letterhead, and dated as close as possible to the date of the audit report."
            >
              <p className="text-sm text-ink-muted">{misstatementSentence(uncorrected)}</p>
              {context.exceedsMateriality && context.uncorrected.length > 0 && (
                <Callout variant="danger" className="mt-3">
                  These uncorrected misstatements reach overall materiality, so the letter&apos;s statement that they are immaterial would not be supportable. Have them corrected before issuing it. The download carries the same warning at the top.
                </Callout>
              )}
              <form method="post" action={`${base}/letters/representation`} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Letter date">
                  <Input name="date" type="date" />
                </Field>
                <Field label="Date of the engagement letter">
                  <Input name="engagementLetterDate" type="date" />
                </Field>
                <Field label="Owner or related party giving financial support (blank if none)">
                  <Input name="supporter" maxLength={200} />
                </Field>
                <fieldset className="sm:col-span-2 lg:col-span-3">
                  <legend className="text-sm font-medium text-ink">Include the representations on</legend>
                  <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
                    <label className={check}>
                      <input type="checkbox" name="inventory" className={box} defaultChecked={context.has.inventory} /> Inventories
                    </label>
                    <label className={check}>
                      <input type="checkbox" name="receivables" className={box} defaultChecked={context.has.receivables} /> Receivables
                    </label>
                    <label className={check}>
                      <input type="checkbox" name="tax" className={box} defaultChecked={context.has.tax} /> Tax
                    </label>
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">Ticked where the trial balance has accounts in that area.</p>
                </fieldset>
                <Field label="Representations specific to this audit, one per line" className="sm:col-span-2 lg:col-span-3">
                  <Textarea name="specific" rows={3} maxLength={4000} />
                </Field>
                <div className="sm:col-span-2 lg:col-span-3">
                  <Button variant="primary">Download representation letter (Word)</Button>
                </div>
              </form>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
