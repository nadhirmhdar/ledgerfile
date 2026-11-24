import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { getClientRecord } from "@/server/clients";
import { canCreateClient } from "@/domain/permissions";
import { DETAIL_LABEL, yearEndText } from "@/domain/client-details";
import { ClientEditForm } from "@/app/client-edit-form";
import { Callout } from "@/ui/feedback";
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
            <ClientEditForm client={client} />
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
