import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import { buildLeadSheets } from "@/domain/leadsheet";
import { GROUPS, GROUP_BY_CODE } from "@/domain/groups";
import { formatAmount } from "@/domain/money";
import { approveAllAction } from "@/app/actions";
import { MappingSelect, UploadForm } from "@/app/forms";
import { Badge } from "@/ui/badge";
import { Button, LinkButton, buttonClass } from "@/ui/button";
import { Callout, EmptyState } from "@/ui/feedback";
import { Input } from "@/ui/form";
import { ArrowRightIcon } from "@/ui/icons";
import { Card, PageHeader, Section, Stat } from "@/ui/layout";
import { countMappings, isBalanced, mappingControls, mappingSentence, mappingState, parseQuery, parseShow, resultsText, viewMappings, type MappingShow } from "@/ui/mapping-view";
import { Table, TCell, THead, TRow } from "@/ui/table";
import { count } from "@/ui/text";
import { EngagementNav } from "../nav";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = {
  prior_year: "Prior year",
  rule: "Suggested",
  ai: "AI suggested",
  manual: "Set by hand",
};

type Params = { show?: string | string[]; q?: string | string[] };

export default async function TrialBalancePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Params> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sp = await searchParams;
  const show = parseShow(sp.show);
  const q = parseQuery(sp.q);

  const session = await getSession();
  const { engagement, accounts } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    engagement: await repo.getEngagement(tx, id),
    accounts: await repo.listAccounts(tx, id),
  }));
  if (!engagement) notFound();

  const locked = engagement.status !== "open";
  const counts = countMappings(accounts);
  const controls = mappingControls({ locked, accounts: accounts.length, toCheck: counts.toCheck });
  const total = accounts.reduce((s, a) => s + a.closingMinor, 0);
  const view = viewMappings(accounts, { show, q });
  // The tie-out is the lead sheets' own calculation, on adjusted balances, as the lead sheets page does it.
  const ties = buildLeadSheets(accounts.map((a) => ({ ...a, closingMinor: a.closingMinor + a.adjustmentMinor }))).tiesToTrialBalance;
  const groups = [...GROUPS].sort((a, b) => a.sort - b.sort).map((g) => ({ code: g.code, name: g.name }));
  const base = `/engagements/${id}`;
  const here = (s: MappingShow, query: string) => {
    const p = new URLSearchParams();
    if (s !== "all") p.set("show", s);
    if (query) p.set("q", query);
    const str = p.toString();
    return `${base}/trial-balance${str ? `?${str}` : ""}`;
  };

  const statusCell = (a: (typeof accounts)[number]) => {
    const state = mappingState(a);
    // A suggestion that a person has accepted says so, so "Suggested" never reads as still pending.
    const basis = a.source ? (state === "mapped" && (a.source === "rule" || a.source === "ai") ? `${SOURCE_LABEL[a.source]}, accepted` : SOURCE_LABEL[a.source]) : null;
    return (
      <div className="flex flex-col items-start gap-0.5">
        {state === "to_map" ? <Badge tone="danger">To map</Badge> : state === "to_check" ? <Badge tone="warning">To check</Badge> : <Badge tone="success">Mapped</Badge>}
        {state !== "to_map" && basis && <span className="text-sm whitespace-nowrap text-ink-muted">{basis}</span>}
      </div>
    );
  };
  const groupCell = (a: (typeof accounts)[number]) =>
    controls.selects ? (
      <MappingSelect key={`${a.id}:${a.groupCode}`} engagementId={id} accountId={a.id} value={a.groupCode} groups={groups} label={`Group for ${a.code} ${a.name}`} />
    ) : (
      <span>{a.groupCode ? (GROUP_BY_CODE.get(a.groupCode)?.name ?? a.groupCode) : "Not mapped"}</span>
    );

  const chips: { key: MappingShow; label: string; n: number }[] = [
    { key: "all", label: "All", n: counts.all },
    { key: "unmapped", label: "To map", n: counts.toMap },
    { key: "review", label: "To check", n: counts.toCheck },
    { key: "mapped", label: "Mapped", n: counts.mapped },
  ];

  return (
    <div className="py-8 text-ink">
      <PageHeader
        breadcrumb={[{ label: "All engagements", href: "/" }]}
        title="Trial balance and mapping"
        meta={
          <>
            <span>{engagement.clientName}</span>
            <span aria-hidden="true">·</span>
            <span>
              {engagement.periodStart} to {engagement.periodEnd}
            </span>
            <span aria-hidden="true">·</span>
            <span>{engagement.priorEngagementId ? "Mappings carry forward from the prior year" : "No prior-year engagement linked"}</span>
          </>
        }
        subtitle={mappingSentence(counts)}
      />
      <EngagementNav id={id} current="tb" status={engagement.status} />

      <div className="mt-6 space-y-8">
        {accounts.length === 0 ? (
          controls.importFirst ? (
            <Card title="Import the trial balance" description="Start here. The mapping, lead sheets and statements are all built from it.">
              <UploadForm engagementId={id} hasAccounts={false} />
            </Card>
          ) : (
            <EmptyState title="No trial balance was imported" description="This engagement was locked before a trial balance was imported." />
          )
        ) : (
          <>
            <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <li>
                <Stat label="Accounts" value={counts.all} href={here("all", "")} />
              </li>
              <li>
                <Stat label="To map" value={counts.toMap} href={here("unmapped", "")} />
              </li>
              <li>
                <Stat label="To check" value={counts.toCheck} href={here("review", "")} />
              </li>
              <li>
                <Stat
                  label="Balance check"
                  value={isBalanced(total) ? <Badge tone="success">Balances</Badge> : <Badge tone="danger">Out by {formatAmount(Math.abs(total))}</Badge>}
                />
              </li>
            </ul>

            {!locked && counts.toMap > 0 ? (
              <Card title={`Map ${count(counts.toMap, "account")}`} description="Each account needs a lead sheet group before the lead sheets and statements are right.">
                <LinkButton href={here("unmapped", "")} variant="primary">
                  Show the accounts to map
                  <ArrowRightIcon />
                </LinkButton>
              </Card>
            ) : (
              controls.accept && (
                <Card
                  title={`Check ${count(counts.toCheck, "suggested mapping")}`}
                  description="Accepting confirms the suggested group for each account. You can still change any of them afterwards."
                >
                  <form action={approveAllAction}>
                    <input type="hidden" name="engagementId" value={id} />
                    <Button variant="primary">{counts.toCheck === 1 ? "Accept 1 suggestion" : `Accept all ${counts.toCheck} suggestions`}</Button>
                  </form>
                </Card>
              )
            )}

            <Section title="Account mapping" description={locked ? "This engagement is locked, so the mapping is read-only." : "Choose a group for each account. A change is saved as soon as you pick it."}>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <nav aria-label="Filter accounts">
                  <ul className="flex flex-wrap gap-2">
                    {chips.map((c) => {
                      const active = show === c.key;
                      return (
                        <li key={c.key}>
                          <Link
                            href={here(c.key, q)}
                            aria-current={active ? "true" : undefined}
                            className={`inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-medium ${active ? "border-accent bg-accent text-surface" : "border-border-strong bg-surface text-ink hover:bg-surface-muted"}`}
                          >
                            {c.label} {c.n}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </nav>
                <form method="get" action={`${base}/trial-balance`} role="search" className="flex items-end gap-2">
                  {show !== "all" && <input type="hidden" name="show" value={show} />}
                  <div>
                    <label htmlFor="account-search" className="mb-1 block text-sm font-medium text-ink">
                      Search accounts
                    </label>
                    <Input id="account-search" name="q" type="search" defaultValue={q} placeholder="Code or name" className="w-56" />
                  </div>
                  <Button variant="secondary">Search</Button>
                </form>
              </div>
              <p role="status" className="mt-3 text-sm text-ink-muted">
                {resultsText(view.shown, view.total)}
              </p>

              {view.rows.length === 0 ? (
                <div className="mt-3">
                  <EmptyState
                    title="No accounts match"
                    description="Nothing fits this filter and search."
                    action={
                      <LinkButton href={`${base}/trial-balance`} variant="secondary">
                        Clear the filter
                      </LinkButton>
                    }
                  />
                </div>
              ) : (
                <>
                  <div className="mt-3 hidden sm:block">
                    <Table caption="Accounts and their lead sheet groups">
                      <THead>
                        <TRow>
                          <TCell header="col">Account</TCell>
                          <TCell header="col" numeric>
                            Closing
                          </TCell>
                          <TCell header="col" numeric>
                            Prior year
                          </TCell>
                          <TCell header="col">Status</TCell>
                          <TCell header="col">Group</TCell>
                        </TRow>
                      </THead>
                      <tbody>
                        {view.rows.map((a) => (
                          <TRow key={a.id}>
                            <TCell header="row">
                              <span className="font-mono text-sm font-normal text-ink-muted">{a.code}</span> <span className="font-semibold">{a.name}</span>
                            </TCell>
                            <TCell numeric>{formatAmount(a.closingMinor)}</TCell>
                            <TCell numeric>{a.priorMinor === null ? "" : formatAmount(a.priorMinor)}</TCell>
                            <TCell>{statusCell(a)}</TCell>
                            <TCell>{groupCell(a)}</TCell>
                          </TRow>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                  {/* Phone: one compact row each. Line 1 is the account and its figures, line 2 the status (and source tag), line 3 the group control at the full row width so the chosen group is readable. */}
                  <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface shadow-card sm:hidden">
                    {view.rows.map((a) => (
                      <li key={a.id} className="px-4 py-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <p className="min-w-0 font-semibold">
                            <span className="font-mono text-sm font-normal text-ink-muted">{a.code}</span> {a.name}
                          </p>
                          <p className="shrink-0 text-right tabular-nums">
                            <span className="sr-only">Closing </span>
                            {formatAmount(a.closingMinor)}
                            {a.priorMinor !== null && (
                              <span className="block text-sm text-ink-muted">
                                Prior year {formatAmount(a.priorMinor)}
                              </span>
                            )}
                          </p>
                        </div>
                        <div className="mt-1.5">{statusCell(a)}</div>
                        <div className="mt-1.5">{groupCell(a)}</div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Section>

            <Card title="Lead sheets" description="The accounts, grouped by lead sheet, with prior-year movement.">
              <p className="mb-3">{ties ? <Badge tone="success">Agrees to the trial balance</Badge> : <Badge tone="danger">Does not agree</Badge>}</p>
              <LinkButton href={`${base}/lead-sheets`}>
                Open the lead sheets
                <ArrowRightIcon />
              </LinkButton>
            </Card>

            {controls.replace && (
              <details className="rounded-lg border border-border bg-surface shadow-card">
                <summary className={`${buttonClass("secondary")} m-3 w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>Replace the trial balance</summary>
                <div className="border-t border-border px-4 py-4 sm:px-5">
                  <Callout variant="warning" className="mb-4">
                    Replacing re-reads every balance and removes all lead-sheet sign-offs. Mappings are kept for account codes that stay the same. It cannot be done while there are journal entries.
                  </Callout>
                  <UploadForm engagementId={id} hasAccounts />
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}
