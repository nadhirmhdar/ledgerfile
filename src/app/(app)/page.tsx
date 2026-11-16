import Link from "next/link";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import { NewClientForm, NewEngagementForm } from "@/app/forms";
import { canCreateClient, canCreateEngagement } from "@/domain/permissions";
import { StatusBadge } from "@/ui/badge";
import { EngagementsHeader } from "@/ui/create-panels";
import { EmptyState } from "@/ui/feedback";
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
      <EngagementsHeader
        subtitle={engagements.length === 0 ? "No engagements yet." : `${count(engagements.length, "engagement")}, ${open} open.`}
        engagementForm={mayCreateEngagement ? clients.length === 0 ? <p className="text-sm text-ink-muted">Add a client first.</p> : <NewEngagementForm clients={clients} /> : undefined}
        clientForm={mayCreateClient ? <NewClientForm /> : undefined}
      />

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
