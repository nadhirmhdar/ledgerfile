import Link from "next/link";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import { NewClientForm, NewEngagementForm } from "@/app/forms";
import { canCreateClient, canCreateEngagement } from "@/domain/permissions";
import { StatusBadge } from "@/ui/badge";
import { buttonClass } from "@/ui/button";
import { EmptyState } from "@/ui/feedback";
import { PageHeader } from "@/ui/layout";
import { Table, TCell, THead, TRow } from "@/ui/table";
import { count } from "@/ui/text";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  const { clients, engagements } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    clients: await repo.listClients(tx),
    engagements: await repo.listEngagements(tx),
  }));
  const mayCreateEngagement = canCreateEngagement(session.role);
  const mayCreateClient = canCreateClient(session.role);
  const open = engagements.filter((e) => e.status === "open").length;

  return (
    <div className="py-8 text-ink">
      <PageHeader
        title="Engagements"
        subtitle={engagements.length === 0 ? "No engagements yet." : `${count(engagements.length, "engagement")}, ${open} open.`}
      />

      {(mayCreateEngagement || mayCreateClient) && (
        <div className="mt-6 space-y-3">
          {mayCreateEngagement && (
            <details className="group rounded-lg border border-border bg-surface shadow-card">
              <summary className={`${buttonClass("primary")} m-3 w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>New engagement</summary>
              <div className="border-t border-border px-4 py-4 sm:px-5">
                {clients.length === 0 ? <p className="text-sm text-ink-muted">Add a client first.</p> : <NewEngagementForm clients={clients} />}
              </div>
            </details>
          )}
          {mayCreateClient && (
            <details className="group rounded-lg border border-border bg-surface shadow-card">
              <summary className={`${buttonClass("secondary")} m-3 w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>New client</summary>
              <div className="border-t border-border px-4 py-4 sm:px-5">
                <NewClientForm />
              </div>
            </details>
          )}
        </div>
      )}

      <section aria-label="Engagement list" className="mt-6">
        {engagements.length === 0 ? (
          <EmptyState
            title="No engagements yet"
            description={mayCreateEngagement ? "Add a client, then create an engagement for it." : "A reviewer or partner creates engagements. They will appear here."}
          />
        ) : (
          <Table caption="Engagements">
            <THead>
              <TRow>
                <TCell header="col">Client</TCell>
                <TCell header="col">Period</TCell>
                <TCell header="col">Status</TCell>
                <TCell header="col">Prior year linked</TCell>
              </TRow>
            </THead>
            <tbody>
              {engagements.map((e) => (
                <TRow key={e.id}>
                  <TCell header="row">
                    <Link href={`/engagements/${e.id}`} className="rounded-sm text-accent hover:underline">
                      {e.clientName}
                    </Link>
                  </TCell>
                  <TCell>
                    {e.periodStart} to {e.periodEnd}
                  </TCell>
                  <TCell>
                    <StatusBadge status={e.status === "open" ? "in_progress" : "locked"} label={e.status === "open" ? "Open" : "Locked"} />
                  </TCell>
                  <TCell>{e.priorEngagementId ? "Yes" : "No"}</TCell>
                </TRow>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}
