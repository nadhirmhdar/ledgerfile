import Link from "next/link";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import { listClientRows } from "@/server/clients";
import { canCreateClient } from "@/domain/permissions";
import { yearEndText } from "@/domain/client-details";
import { Button, LinkButton } from "@/ui/button";
import { EmptyState } from "@/ui/feedback";
import { Input } from "@/ui/form";
import { PageHeader } from "@/ui/layout";
import { Table, TCell, THead, TRow } from "@/ui/table";
import { count } from "@/ui/text";

export const dynamic = "force-dynamic";

/** The firm's clients, with a search. Anyone in the firm can read it; the details are edited on each client's page by someone who may add a client. */
export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  const session = await getSession();
  const clients = await withFirm(await getDb(), session.firmId, (tx) => listClientRows(tx, q));
  const mayAdd = canCreateClient(session.role);
  return (
    <div className="py-8 text-ink">
      <PageHeader
        title="Clients"
        subtitle={q.trim() ? `${count(clients.length, "client")} match “${q.trim()}”.` : clients.length === 0 ? "No clients yet." : `${count(clients.length, "client")}.`}
        actions={
          mayAdd ? (
            <LinkButton variant="secondary" href="/clients/import">
              Import clients
            </LinkButton>
          ) : undefined
        }
      />
      <form method="get" action="/clients" role="search" className="mt-6 flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-medium sm:max-w-sm">
          Search clients
          <Input name="q" defaultValue={q} placeholder="Name or licence number" maxLength={100} />
        </label>
        <Button variant="secondary">Search</Button>
        {q.trim() && (
          <Link href="/clients" className="text-sm text-accent hover:underline">
            Show every client
          </Link>
        )}
      </form>
      <section aria-label="Clients" className="mt-6">
        {clients.length === 0 ? (
          <EmptyState title={q.trim() ? "No client matches" : "No clients yet"} description={q.trim() ? "Try part of the name or the licence number." : mayAdd ? "Add a client on the engagements page, or import a list." : "A partner or the administrator adds clients."} />
        ) : (
          <Table caption="Clients">
            <THead>
              <TRow>
                <TCell header="col">Client</TCell>
                <TCell header="col">Licence number</TCell>
                <TCell header="col">Year-end</TCell>
                <TCell header="col" numeric>
                  Engagements
                </TCell>
              </TRow>
            </THead>
            <tbody>
              {clients.map((c) => (
                <TRow key={c.id}>
                  <TCell header="row">
                    <Link href={`/clients/${c.id}`} className="rounded-sm text-accent hover:underline">
                      {c.name}
                    </Link>
                  </TCell>
                  <TCell>{c.licenceNumber ?? <span className="text-ink-muted">Not set</span>}</TCell>
                  <TCell>{c.yearEnd ? yearEndText(c.yearEnd) : <span className="text-ink-muted">Not set</span>}</TCell>
                  <TCell numeric>{c.engagements}</TCell>
                </TRow>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}
