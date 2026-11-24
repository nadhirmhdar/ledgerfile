import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { getClientRecord } from "@/server/clients";
import { canCreateClient } from "@/domain/permissions";
import { DETAIL_LABEL, MAX_ADDRESS, MAX_AUTHORITY, MAX_CONTACT, MAX_EMAIL, MAX_LICENCE, MONTHS, yearEndText } from "@/domain/client-details";
import { MAX_NAME } from "@/domain/client-import";
import { ActionForm } from "@/app/action-form";
import { updateClientAction } from "@/app/client-actions";
import { Button } from "@/ui/button";
import { Callout } from "@/ui/feedback";
import { Field, Input, Select, Textarea } from "@/ui/form";
import { Card, PageHeader } from "@/ui/layout";
import { count } from "@/ui/text";

export const dynamic = "force-dynamic";

/** One client's details. Someone who may add a client (a partner or the administrator) edits them; everyone else in the firm reads them. */
export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const client = await withFirm(await getDb(), session.firmId, (tx) => getClientRecord(tx, id));
  if (!client) notFound();
  const mayEdit = canCreateClient(session.role);
  const [month, day] = client.yearEnd ? client.yearEnd.split("-") : ["", ""];
  const rows: [string, string | null][] = [
    [DETAIL_LABEL.licenceNumber, client.licenceNumber],
    [DETAIL_LABEL.licensingAuthority, client.licensingAuthority],
    [DETAIL_LABEL.taxRegistrationNumber, client.taxRegistrationNumber],
    [DETAIL_LABEL.yearEnd, client.yearEnd ? yearEndText(client.yearEnd) : null],
    [DETAIL_LABEL.address, client.address],
    [DETAIL_LABEL.contactName, client.contactName],
    [DETAIL_LABEL.contactEmail, client.contactEmail],
  ];
  return (
    <div className="py-8 text-ink">
      <PageHeader breadcrumb={[{ label: "Clients", href: "/clients" }]} title={client.name} meta={<span>{client.framework}</span>} subtitle={`${count(client.engagements, "engagement")}.`} />
      <div className="mt-6 max-w-3xl space-y-8">
        {!mayEdit && <Callout variant="info">Only a partner or the administrator can change a client&apos;s details. They are shown as saved.</Callout>}
        {mayEdit ? (
          <Card title="Details" description="All optional. The year-end suggests the period of a new engagement, and the address is printed on the engagement letter. Nothing here is checked against any outside register.">
            <ActionForm action={updateClientAction} fields={{ clientId: client.id }}>
              <div className="space-y-4">
                <Field label="Name">
                  <Input name="name" defaultValue={client.name} required maxLength={MAX_NAME} />
                </Field>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label={DETAIL_LABEL.licenceNumber}>
                    <Input name="licenceNumber" defaultValue={client.licenceNumber ?? ""} maxLength={MAX_LICENCE} />
                  </Field>
                  <Field label={DETAIL_LABEL.licensingAuthority}>
                    <Input name="licensingAuthority" defaultValue={client.licensingAuthority ?? ""} maxLength={MAX_AUTHORITY} />
                  </Field>
                  <Field label={DETAIL_LABEL.taxRegistrationNumber} hint="15 digits">
                    <Input name="taxRegistrationNumber" defaultValue={client.taxRegistrationNumber ?? ""} inputMode="numeric" maxLength={20} />
                  </Field>
                  <div className="flex gap-3">
                    <Field label="Year-end month" className="flex-1">
                      <Select name="yearEndMonth" defaultValue={month ? String(Number(month)) : ""}>
                        <option value="">Not set</option>
                        {MONTHS.map((m, i) => (
                          <option key={m} value={i + 1}>
                            {m}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Day" className="w-24">
                      <Input name="yearEndDay" defaultValue={day ? String(Number(day)) : ""} inputMode="numeric" maxLength={2} />
                    </Field>
                  </div>
                </div>
                <Field label={DETAIL_LABEL.address}>
                  <Textarea name="address" defaultValue={client.address ?? ""} rows={3} maxLength={MAX_ADDRESS + 40} />
                </Field>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label={DETAIL_LABEL.contactName}>
                    <Input name="contactName" defaultValue={client.contactName ?? ""} maxLength={MAX_CONTACT} />
                  </Field>
                  <Field label={DETAIL_LABEL.contactEmail}>
                    <Input name="contactEmail" type="email" defaultValue={client.contactEmail ?? ""} maxLength={MAX_EMAIL} />
                  </Field>
                </div>
                <Button variant="primary">Save the details</Button>
              </div>
            </ActionForm>
          </Card>
        ) : (
          <Card title="Details">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {rows.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-ink-muted">{label}</dt>
                  <dd className="font-medium whitespace-pre-line">{value ?? <span className="font-normal text-ink-muted">Not set</span>}</dd>
                </div>
              ))}
            </dl>
          </Card>
        )}
        <p className="text-sm">
          <Link href="/" className="text-accent hover:underline">
            Back to the engagements
          </Link>
        </p>
      </div>
    </div>
  );
}
