import Link from "next/link";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { getBranding } from "@/server/branding";
import { loadFirmDefaults } from "@/server/statement-defaults";
import { StatementDefaultsSection } from "@/ui/statement-defaults-section";
import { canLock } from "@/domain/signoff";
import { ActionForm } from "@/app/action-form";
import { removeLogoAction, saveBrandingAction, uploadLogoAction } from "@/app/branding-actions";
import { Button } from "@/ui/button";
import { Callout } from "@/ui/feedback";
import { Field, Input, Textarea } from "@/ui/form";
import { Card, Fact, PageHeader } from "@/ui/layout";
import { BRANDING_SHOWN_ON, LOGO_HINT } from "@/ui/branding-view";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function FirmPage() {
  const session = await getSession();
  const { view, defaults } = await withFirm(await getDb(), session.firmId, async (tx) => ({ view: await getBranding(tx), defaults: await loadFirmDefaults(tx) }));
  if (!view) notFound();
  const admin = session.role === "admin";

  return (
    <div className="py-8 text-ink">
      <PageHeader title="Firm" meta={<Fact label="Firm">{view.firmName}</Fact>} subtitle={BRANDING_SHOWN_ON} />
      <div className="mt-6 max-w-3xl space-y-8">
        <Callout variant="info" title="Planning settings">
          The guide ranges and thresholds behind materiality and the planning assistant are on the{" "}
          <Link href="/firm/planning" className="font-medium underline">
            Planning settings page
          </Link>
          .
        </Callout>
        <Callout variant="info" title="Methodology">
          The audit procedures your firm loads into its programmes can be reworded or hidden on the{" "}
          <Link href="/firm/methodology" className="font-medium underline">
            Methodology page
          </Link>
          .
        </Callout>
        {admin && (
          <Callout variant="info" title="Audit log">
            Every change made in the firm, who made it and when, can be filtered and downloaded on the{" "}
            <Link href="/firm/audit-log" className="font-medium underline">
              Audit log page
            </Link>
            .
          </Callout>
        )}
        <StatementDefaultsSection defaults={defaults} mayEdit={canLock(session.role)} />
        {!admin && <Callout variant="info">Only an administrator can change the firm&apos;s details. What is saved is shown below.</Callout>}

        <Card title="Details" description="Printed under the firm's name on the engagement letter, and in the signature of the auditor's report.">
          {admin ? (
            <ActionForm action={saveBrandingAction} fields={{}}>
              <div className="space-y-4">
                <Field label="Firm name" hint="The name cannot be changed here.">
                  <Input value={view.firmName} readOnly />
                </Field>
                <Field label="Address" hint="Up to 6 lines and 300 characters.">
                  <Textarea name="address" defaultValue={view.address ?? ""} maxLength={300} rows={4} />
                </Field>
                <Field label="Contact line (optional)" hint="For example a phone number, an email address and a website.">
                  <Input name="contactLine" defaultValue={view.contactLine ?? ""} maxLength={200} />
                </Field>
                <Field label="Registration line (optional)" hint="For example a licence or registration number.">
                  <Input name="registrationLine" defaultValue={view.registrationLine ?? ""} maxLength={200} />
                </Field>
                <Button variant="primary">Save</Button>
              </div>
            </ActionForm>
          ) : (
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="font-medium">Address</dt>
                <dd className="whitespace-pre-line text-ink-muted">{view.address ?? "Not set"}</dd>
              </div>
              <div>
                <dt className="font-medium">Contact line</dt>
                <dd className="text-ink-muted">{view.contactLine ?? "Not set"}</dd>
              </div>
              <div>
                <dt className="font-medium">Registration line</dt>
                <dd className="text-ink-muted">{view.registrationLine ?? "Not set"}</dd>
              </div>
            </dl>
          )}
        </Card>

        <Card title="Logo" description={LOGO_HINT}>
          {view.hasLogo ? (
            <div className="space-y-4">
              {/* The logo is served only through this signed-in route; there is no public address for it. */}
              {/* eslint-disable-next-line @next/next/no-img-element -- an authenticated, no-store route, not an optimisable static asset */}
              <img src={`/firm/logo?v=${encodeURIComponent(view.updatedAt ?? "")}`} alt={`${view.firmName} logo`} className="max-h-24 max-w-xs rounded border border-border bg-surface object-contain p-2" />
              {admin && (
                <ActionForm action={removeLogoAction} fields={{}}>
                  <Button variant="secondary">Remove the logo</Button>
                </ActionForm>
              )}
            </div>
          ) : (
            <p className="text-sm text-ink-muted">No logo is set. The downloads show the firm&apos;s name only.</p>
          )}
          {admin && (
            <ActionForm action={uploadLogoAction} fields={{}} className="mt-4">
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-sm font-medium">
                  {view.hasLogo ? "Replace the logo" : "Upload a logo"}
                  <input type="file" name="logo" required accept="image/png,image/jpeg,.png,.jpg,.jpeg" className="text-sm font-normal text-ink file:mr-3 file:min-h-10 file:cursor-pointer file:rounded-md file:border file:border-border-input file:bg-surface file:px-4 file:text-sm file:font-medium file:text-ink hover:file:bg-surface-muted" />
                </label>
                <Button variant="primary">Upload</Button>
              </div>
            </ActionForm>
          )}
        </Card>
      </div>
    </div>
  );
}
