import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import { buildLeadSheets } from "@/domain/leadsheet";
import { GROUPS, GROUP_BY_CODE } from "@/domain/groups";
import { formatAmount } from "@/domain/money";
import { acceptHighConfidenceAction, acceptMappingAction, approveAllAction, forgetTbLayoutAction, suggestAgainAction } from "@/app/actions";
import { ActionForm } from "@/app/action-form";
import { couldNotPlace } from "@/server/mapping-assistant";
import * as tbLayout from "@/server/tb-layout";
import { SOURCE_SENTENCE } from "@/domain/tb-layout";
import { canReview } from "@/domain/signoff";
import { bandOf, HIGH } from "@/domain/mapping-assistant";
import { MappingSelect, UploadForm } from "@/app/forms";
import { importLimits } from "@/server/direct-upload";
import { Badge } from "@/ui/badge";
import { Button, LinkButton, buttonClass } from "@/ui/button";
import { Callout, EmptyState } from "@/ui/feedback";
import { SearchField } from "@/ui/form";
import { Card, PageHeader, Section, Stat, EngagementFacts } from "@/ui/layout";
import { countMappings, isBalanced, mappingControls, mappingSentence, mappingState, parseQuery, parseShow, resultsText, viewMappings, type MappingShow } from "@/ui/mapping-view";
import { Table, TCell, THead, TRow } from "@/ui/table";
import { count } from "@/ui/text";
import { EngagementNav } from "../nav";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = {
  prior_year: "Prior year",
  rule: "Suggested",
  // Older rows only: nothing makes a suggestion of this kind any more.
  ai: "Suggested",
  assistant: "Assistant",
  manual: "Set by hand",
};
const BAND_LABEL = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" } as const;

type Params = { show?: string | string[]; q?: string | string[] };

export default async function TrialBalancePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Params> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sp = await searchParams;
  const show = parseShow(sp.show);
  const q = parseQuery(sp.q);

  const session = await getSession();
  const { engagement, accounts, unplaced, remembered, usedSource } = await withFirm(await getDb(), session.firmId, async (tx) => {
    const engagement = await repo.getEngagement(tx, id);
    return { engagement, accounts: await repo.listAccounts(tx, id), remembered: await tbLayout.getRemembered(tx, id), usedSource: await tbLayout.latestImportSource(tx, id), unplaced: engagement?.status === "open" ? await couldNotPlace(tx, session, id) : [] };
  });
  if (!engagement) notFound();

  const locked = engagement.status !== "open";
  // What is remembered for this client, with the way to forget it (a reviewer or partner may).
  const rememberedNote =
    remembered?.layout && !locked ? (
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-ink-muted">
        <span>Columns are remembered for this client{remembered.updatedAt ? ` (saved ${remembered.updatedAt})` : ""}.</span>
        {canReview(session.role) && (
          <form action={forgetTbLayoutAction}>
            <input type="hidden" name="engagementId" value={id} />
            <Button variant="secondary" size="sm">
              Forget the remembered columns
            </Button>
          </form>
        )}
      </div>
    ) : null;
  const highPending = accounts.filter((a) => a.source === "assistant" && !a.approved && (a.confidence ?? 0) >= HIGH).length;
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
    const suggested = a.source === "rule" || a.source === "ai" || a.source === "assistant";
    const basis = a.source ? (state === "mapped" && suggested ? `${SOURCE_LABEL[a.source]}, accepted` : SOURCE_LABEL[a.source]) : null;
    const assistant = a.source === "assistant" && a.confidence !== null;
    const basisText = basis ? (assistant && state === "to_check" ? `${basis}, ${BAND_LABEL[bandOf(a.confidence!)].toLowerCase()}` : basis) : null;
    return (
      <div className="flex min-w-0 flex-col items-start gap-1">
        {state === "to_map" ? <Badge tone="danger">To map</Badge> : state === "to_check" ? <Badge tone="warning">To check</Badge> : <Badge tone="success">Mapped</Badge>}
        {state !== "to_map" && basisText && <span className="text-small text-ink-muted">{basisText}</span>}
        {/* One line under the chip; the whole reason is still in the page for a screen reader and shows in full on hover. */}
        {assistant && a.reason && (
          <span className="block w-full truncate text-small text-ink-muted" title={a.reason}>
            {a.reason}
          </span>
        )}
      </div>
    );
  };
  const acceptForm = (a: (typeof accounts)[number]) =>
    mappingState(a) === "to_check" && !locked ? (
      <form action={acceptMappingAction}>
        <input type="hidden" name="engagementId" value={id} />
        <input type="hidden" name="accountId" value={a.id} />
        <Button variant="secondary" size="sm">
          Accept<span className="sr-only"> {a.code} {a.name}</span>
        </Button>
      </form>
    ) : null;
  // The group control, with Accept beside it when the row has a suggestion to accept.
  const groupCell = (a: (typeof accounts)[number]) =>
    controls.selects ? (
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 [&_select]:w-full!">
          <MappingSelect key={`${a.id}:${a.groupCode}`} engagementId={id} accountId={a.id} value={a.groupCode} groups={groups} label={`Group for ${a.code} ${a.name}`} />
        </div>
        {acceptForm(a)}
      </div>
    ) : (
      <span>{a.groupCode ? (GROUP_BY_CODE.get(a.groupCode)?.name ?? a.groupCode) : "Not mapped"}</span>
    );
  // The account: its name, with the code before it in muted type; when the code and the name are the same text it is shown once.
  const accountLabel = (a: { code: string; name: string }) =>
    a.code.trim().toLowerCase() === a.name.trim().toLowerCase() ? (
      <span className="font-medium">{a.name}</span>
    ) : (
      <>
        <span className="mr-2 font-normal text-ink-muted">{a.code}</span>
        <span className="font-medium">{a.name}</span>
      </>
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
        meta={<EngagementFacts client={engagement.clientName} periodStart={engagement.periodStart} periodEnd={engagement.periodEnd} />}
        note={`${[engagement.priorEngagementId ? "Mappings carry forward from the prior year" : "No prior-year engagement linked", usedSource ? SOURCE_SENTENCE[usedSource] : null].filter(Boolean).join(". ")}.`}
        subtitle={mappingSentence(counts)}
      />
      <EngagementNav id={id} current="tb" status={engagement.status} archived={engagement.archivedAt !== null} />

      <div className="mt-6 space-y-8">
        {accounts.length === 0 ? (
          controls.importFirst ? (
            <Card title="Import the trial balance" description="Start here. The mapping, lead sheets and statements are all built from it.">
              <UploadForm engagementId={id} hasAccounts={false} limits={importLimits()} />
              {rememberedNote}
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
                <Stat label="To map" value={counts.toMap} href={here("unmapped", "")} attention={counts.toMap > 0 ? "warning" : undefined} />
              </li>
              <li>
                <Stat label="To check" value={counts.toCheck} href={here("review", "")} attention={counts.toCheck > 0 ? "warning" : undefined} />
              </li>
              <li>
                <Stat
                  label="Balance check"
                  value={isBalanced(total) ? <Badge tone="success">Balances</Badge> : <Badge tone="danger">Out by {formatAmount(Math.abs(total))}</Badge>}
                />
              </li>
            </ul>

            {!locked && counts.toMap > 0 ? (
              <Card raised title={`Map ${count(counts.toMap, "account")}`} description="Each account needs a lead sheet group before the lead sheets and statements are right.">
                <LinkButton href={here("unmapped", "")} variant="primary">
                  Show the accounts to map
                </LinkButton>
              </Card>
            ) : (
              controls.accept && (
                <Card
                  raised
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

            {!locked && (
              <Card title="Mapping assistant" description="Suggests a group for each account that is not yet accepted, from the account's wording and the mappings your firm has already accepted. It runs inside LedgerFile and sends nothing anywhere. You accept each suggestion, and an accepted mapping is never changed.">
                <div className="flex flex-wrap items-start gap-3">
                  <ActionForm action={suggestAgainAction} fields={{ engagementId: id }}>
                    <Button variant="secondary">Suggest again</Button>
                  </ActionForm>
                  {highPending > 0 && (
                    <form action={acceptHighConfidenceAction}>
                      <input type="hidden" name="engagementId" value={id} />
                      <Button variant="primary">{highPending === 1 ? "Accept 1 high-confidence suggestion" : `Accept all ${highPending} high-confidence suggestions`}</Button>
                    </form>
                  )}
                </div>
              </Card>
            )}

            {unplaced.length > 0 && (
              <Section title={`Could not place ${unplaced.length}`} description="The assistant does not guess. Choose a group for each of these below.">
                <ul className="divide-y divide-border rounded-lg border border-border bg-surface shadow-card">
                  {unplaced.map((u) => (
                    <li key={u.code} className="px-4 py-2.5">
                      <p>
                        {accountLabel(u)}
                      </p>
                      <p className="text-sm text-ink-muted">{u.reason}</p>
                    </li>
                  ))}
                </ul>
              </Section>
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
                            className={`inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-medium ${active ? "border-accent bg-accent text-surface" : "border-border-input bg-surface text-ink hover:bg-surface-muted"}`}
                          >
                            {c.label} {c.n}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </nav>
                <form method="get" action={`${base}/trial-balance`} role="search">
                  {show !== "all" && <input type="hidden" name="show" value={show} />}
                  <SearchField id="account-search" label="Search accounts" defaultValue={q} placeholder="Code or name" className="w-full sm:w-72" />
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
                    <Table caption="Accounts and their lead sheet groups" fixed>
                      <colgroup>
                        <col className="w-[20%]" />
                        <col className="w-32" />
                        <col className="w-32" />
                        <col className="w-[19%]" />
                        <col />
                      </colgroup>
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
                              {accountLabel(a)}
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
                          <p className="min-w-0">
                            {accountLabel(a)}
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
                        {/* The badge and its source tag side by side on a phone (the cell stacks them on desktop). */}
                        <div className="mt-1.5 [&>div]:flex-row [&>div]:flex-wrap [&>div]:items-center [&>div]:gap-x-2">{statusCell(a)}</div>
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
              </LinkButton>
            </Card>

            {controls.replace && (
              <details className="rounded-lg border border-border bg-surface shadow-card">
                <summary className={`${buttonClass("secondary")} m-3 w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>Replace the trial balance</summary>
                <div className="border-t border-border px-4 py-4 sm:px-5">
                  <Callout variant="warning" className="mb-4">
                    Replacing re-reads every balance and removes all lead-sheet sign-offs. Mappings are kept for account codes that stay the same. It cannot be done while there are journal entries.
                  </Callout>
                  <UploadForm engagementId={id} hasAccounts limits={importLimits()} />
                  {rememberedNote}
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}
