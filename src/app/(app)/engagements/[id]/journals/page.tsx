import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import * as journals from "@/server/journals";
import { formatAmount } from "@/domain/money";
import { canDeleteJournal } from "@/domain/permissions";
import { deleteJournalAction } from "@/app/actions";
import { Badge } from "@/ui/badge";
import { LinkButton } from "@/ui/button";
import { EmptyState } from "@/ui/feedback";
import { entriesSentence, entryReference, entryTotals, postedText } from "@/ui/journal-entries-view";
import { Card, PageHeader, Section, EngagementFacts } from "@/ui/layout";
import { Table, TCell, THead, TRow } from "@/ui/table";
import { EngagementNav } from "../nav";
import { DeleteJournalButton, NewEntryPanel } from "./journal-form";

export const dynamic = "force-dynamic";

export default async function JournalsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const session = await getSession();
  const { engagement, accounts, list } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    engagement: await repo.getEngagement(tx, id),
    accounts: await repo.listAccounts(tx, id),
    list: await journals.listJournals(tx, id),
  }));
  if (!engagement) notFound();
  const open = engagement.status === "open";

  return (
    <div className="py-8 text-ink">
      <PageHeader
        breadcrumb={[{ label: "All engagements", href: "/" }]}
        title="Journal entries"
        meta={<EngagementFacts client={engagement.clientName} periodStart={engagement.periodStart} periodEnd={engagement.periodEnd} />}
        subtitle={accounts.length === 0 ? "Import a trial balance before posting journal entries." : entriesSentence(list)}
      />
      <EngagementNav id={id} current="journals" status={engagement.status} archived={engagement.archivedAt !== null} />

      <div className="mt-6 min-w-0 space-y-8">
        {accounts.length === 0 ? (
          <EmptyState
            title="Import a trial balance first"
            description="Journal entries adjust the trial balance, so there has to be one. Import it, then post entries here."
            action={
              <LinkButton href={`/engagements/${id}/trial-balance`} variant="primary">
                Trial balance and mapping
              </LinkButton>
            }
          />
        ) : (
          <>
            <p className="max-w-3xl text-sm text-ink-muted">Entries adjust the trial balance that the lead sheets and the financial statements are built from.</p>

            {open && <NewEntryPanel startOpen={list.length === 0} engagementId={id} accounts={accounts.map((a) => ({ id: a.id, code: a.code, name: a.name }))} />}

            <Section title="Posted entries">
              {list.length === 0 ? (
                <p className="text-sm text-ink-muted">No entries yet. Lead sheets and statements show the trial balance as imported.</p>
              ) : (
                <ul className="space-y-4">
                  {list.map((j) => {
                    const ref = entryReference(j.type, j.number);
                    const totals = entryTotals(j.lines);
                    return (
                      <li key={j.id}>
                        <Card
                          title={
                            <span className="flex flex-wrap items-center gap-2">
                              <Badge tone="info">{ref}</Badge>
                              <span>{j.description}</span>
                            </span>
                          }
                          description={postedText(j.createdAt, j.createdByName)}
                          actions={
                            open && canDeleteJournal(session.role, j.createdBy === session.userId) ? (
                              <form action={deleteJournalAction}>
                                <input type="hidden" name="engagementId" value={id} />
                                <input type="hidden" name="journalId" value={j.id} />
                                <DeleteJournalButton label={ref} />
                              </form>
                            ) : undefined
                          }
                        >
                          <Table caption={`Lines of ${ref}`}>
                            <THead>
                              <TRow>
                                <TCell header="col">Code</TCell>
                                <TCell header="col">Account</TCell>
                                <TCell header="col" numeric>
                                  Debit
                                </TCell>
                                <TCell header="col" numeric>
                                  Credit
                                </TCell>
                              </TRow>
                            </THead>
                            <tbody>
                              {j.lines.map((l, i) => (
                                <TRow key={i}>
                                  <TCell className="font-mono text-sm">{l.accountCode}</TCell>
                                  <TCell>{l.accountName}</TCell>
                                  <TCell numeric>{l.amountMinor > 0 ? formatAmount(l.amountMinor) : ""}</TCell>
                                  <TCell numeric>{l.amountMinor < 0 ? formatAmount(-l.amountMinor) : ""}</TCell>
                                </TRow>
                              ))}
                              <TRow className="bg-surface-muted font-semibold">
                                <TCell colSpan={2}>Totals</TCell>
                                <TCell numeric>{formatAmount(totals.debitMinor)}</TCell>
                                <TCell numeric>{formatAmount(totals.creditMinor)}</TCell>
                              </TRow>
                            </tbody>
                          </Table>
                        </Card>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
