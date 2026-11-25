import Link from "next/link";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import { listEngagementTeams } from "@/server/engagement-team";
import { NOT_ASSIGNED } from "@/domain/my-work";
import { NewClientForm, NewEngagementForm } from "@/app/forms";
import { canCreateClient, canCreateEngagement } from "@/domain/permissions";
import { StatusBadge } from "@/ui/badge";
import { EngagementsHeader } from "@/ui/create-panels";
import { EmptyState } from "@/ui/feedback";
import { Table, TCell, THead, TRow } from "@/ui/table";
import { count } from "@/ui/text";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ mine?: string | string[] }> }) {
  const session = await getSession();
  const mineOnly = (await searchParams).mine === "1";
  const { clients, all, teams } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    clients: await repo.listClients(tx),
    all: await repo.listEngagements(tx),
    teams: await listEngagementTeams(tx),
  }));
  const isMine = (id: string) => [teams.get(id)?.preparer, teams.get(id)?.reviewer, teams.get(id)?.partner].some((p) => p?.id === session.userId);
  const engagements = mineOnly ? all.filter((e) => isMine(e.id)) : all;
  const mineCount = all.filter((e) => isMine(e.id)).length;
  const mayCreateEngagement = canCreateEngagement(session.role);
  const mayCreateClient = canCreateClient(session.role);
  const open = engagements.filter((e) => e.status === "open").length;

  return (
    <div className="py-8 text-ink">
      <EngagementsHeader
        subtitle={all.length === 0 ? "No engagements yet." : mineOnly ? `${count(engagements.length, "engagement")} assigned to you, ${open} open.` : `${count(engagements.length, "engagement")}, ${open} open.`}
        engagementForm={mayCreateEngagement ? clients.length === 0 ? <p className="text-sm text-ink-muted">Add a client first.</p> : <NewEngagementForm clients={clients} /> : undefined}
        clientForm={mayCreateClient ? <NewClientForm /> : undefined}
        importHref={mayCreateClient ? "/clients/import" : undefined}
      />

      <section aria-label="Engagement list" className="mt-6">
        {all.length > 0 && (
          <nav aria-label="Show" className="mb-3 flex flex-wrap gap-2 text-sm">
            <Link href="/" aria-current={mineOnly ? undefined : "page"} className={`rounded-full border px-3 py-1 font-medium ${mineOnly ? "border-border-control text-ink-muted hover:text-accent" : "border-accent bg-accent-wash text-accent"}`}>
              All engagements
            </Link>
            <Link href="/?mine=1" aria-current={mineOnly ? "page" : undefined} className={`rounded-full border px-3 py-1 font-medium ${mineOnly ? "border-accent bg-accent-wash text-accent" : "border-border-control text-ink-muted hover:text-accent"}`}>
              Assigned to me ({mineCount})
            </Link>
          </nav>
        )}
        {engagements.length === 0 && all.length > 0 ? (
          <EmptyState title="Nothing is assigned to you" description="Engagements you are assigned to as preparer, reviewer or partner appear here. A partner assigns the team on each engagement's overview." />
        ) : engagements.length === 0 ? (
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
                <TCell header="col">Preparer</TCell>
                <TCell header="col">Reviewer</TCell>
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
                    <span className="whitespace-nowrap">
                      {e.periodStart} to {e.periodEnd}
                    </span>
                  </TCell>
                  <TCell>{teams.get(e.id)?.preparer?.name ?? <span className="text-ink-muted">{NOT_ASSIGNED}</span>}</TCell>
                  <TCell>{teams.get(e.id)?.reviewer?.name ?? <span className="text-ink-muted">{NOT_ASSIGNED}</span>}</TCell>
                  <TCell>
                    <StatusBadge status={e.status === "open" ? "in_progress" : "locked"} label={e.archivedAt ? "Archived" : e.status === "open" ? "Open" : "Locked"} />
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
