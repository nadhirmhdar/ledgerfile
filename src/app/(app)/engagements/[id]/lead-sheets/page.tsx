import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import * as review from "@/server/review";
import { buildLeadSheets } from "@/domain/leadsheet";
import { formatAmount } from "@/domain/money";
import { Badge, StatusBadge } from "@/ui/badge";
import { Callout, EmptyState } from "@/ui/feedback";
import { LinkButton } from "@/ui/button";
import { openPointsLabel, signBadge, signOffSentence } from "@/ui/leadsheet-view";
import { PageHeader, Section } from "@/ui/layout";
import { OpenOnHash } from "@/ui/open-on-hash";
import { SummaryChevron, summaryRow } from "@/ui/summary-cue";
import { Table, TCell, THead, TRow } from "@/ui/table";
import { count } from "@/ui/text";
import { EngagementNav } from "../nav";

export const dynamic = "force-dynamic";

export default async function LeadSheetsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const session = await getSession();
  const { engagement, accounts, overview } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    engagement: await repo.getEngagement(tx, id),
    accounts: await repo.listAccounts(tx, id),
    // The same sign-off data the review page reads: shown here, read-only.
    overview: await review.getOverview(tx, id),
  }));
  if (!engagement) notFound();

  // Lead sheets show adjusted balances: trial balance plus journal entries.
  const hasAdjustments = accounts.some((a) => a.adjustmentMinor !== 0);
  const set = buildLeadSheets(accounts.map((a) => ({ ...a, closingMinor: a.closingMinor + a.adjustmentMinor })));
  const base = `/engagements/${id}`;
  const unmapped = set.unmapped.length;
  const signOf = new Map((overview?.leadSheets ?? []).map((l) => [l.groupCode, l]));
  const stateOf = (code: string) => {
    const r = signOf.get(code);
    return { preparer: r?.preparer ?? null, reviewer: r?.reviewer ?? null, openPoints: r?.openPoints ?? 0 };
  };
  const signSummary = signOffSentence(set.sheets.map((sh) => stateOf(sh.groupCode)));

  const sentence =
    accounts.length === 0
      ? "No trial balance yet."
      : set.tiesToTrialBalance
        ? `${count(set.sheets.length, "lead sheet")}. The totals agree to the trial balance.`
        : `${count(set.sheets.length, "lead sheet")}. The totals do not agree to the trial balance.`;

  return (
    <div className="py-8 text-ink">
      <PageHeader
        breadcrumb={[{ label: "All engagements", href: "/" }]}
        title="Lead sheets"
        meta={
          <>
            <span>{engagement.clientName}</span>
            <span aria-hidden="true">·</span>
            <span>
              {engagement.periodStart} to {engagement.periodEnd}
            </span>
            {hasAdjustments && (
              <>
                <span aria-hidden="true">·</span>
                <span>Balances include journal adjustments</span>
              </>
            )}
          </>
        }
        subtitle={sentence}
      />
      <EngagementNav id={id} current="leadsheets" status={engagement.status} />
      <OpenOnHash />

      <div className="mt-6 space-y-8">
        {accounts.length === 0 ? (
          <EmptyState
            title="No lead sheets yet"
            description="Lead sheets are built from the trial balance once its accounts are mapped."
            action={
              <LinkButton href={`${base}/trial-balance`} variant="primary">
                Go to the trial balance
              </LinkButton>
            }
          />
        ) : (
          <>
            {!set.tiesToTrialBalance && (
              <Callout variant="danger" title="The lead sheets do not agree to the trial balance">
                The lead sheet totals differ from the trial balance. Check that every account is mapped and that the trial balance was read correctly.
              </Callout>
            )}
            {unmapped > 0 && (
              <Callout variant="warning" title={`${count(unmapped, "account")} not on any lead sheet yet`}>
                <Link href={`${base}/trial-balance?show=unmapped`} className="font-medium underline">
                  Map {unmapped === 1 ? "it" : "them"} on the trial balance page
                </Link>
                .
              </Callout>
            )}

            <Section title="Summary" description="Select a lead sheet to open its accounts.">
              <Table caption="Lead sheet totals">
                <THead>
                  <TRow>
                    <TCell header="col">Lead sheet</TCell>
                    <TCell header="col">Section</TCell>
                    <TCell header="col" numeric>
                      {hasAdjustments ? "Adjusted" : "Closing"}
                    </TCell>
                    <TCell header="col" numeric>
                      Prior year
                    </TCell>
                    <TCell header="col" numeric>
                      Movement
                    </TCell>
                    <TCell header="col" numeric>
                      %
                    </TCell>
                    <TCell header="col">Sign-off</TCell>
                  </TRow>
                </THead>
                <tbody>
                  {set.sheets.map((s) => (
                    <TRow key={s.groupCode}>
                      <TCell header="row">
                        <a href={`#ls-${s.groupCode}`} className="rounded-sm text-accent hover:underline">
                          {s.groupName}
                        </a>
                      </TCell>
                      <TCell className="text-ink-muted">{s.section}</TCell>
                      <TCell numeric>{formatAmount(s.closingMinor)}</TCell>
                      <TCell numeric>{formatAmount(s.priorMinor)}</TCell>
                      <TCell numeric>{formatAmount(s.varianceMinor)}</TCell>
                      <TCell numeric>{s.variancePct === null ? "" : `${s.variancePct.toFixed(1)}%`}</TCell>
                      <TCell>
                        <SignCell state={stateOf(s.groupCode)} />
                      </TCell>
                    </TRow>
                  ))}
                </tbody>
              </Table>
              {signSummary && (
                <p className="mt-2 text-sm text-ink-muted">
                  {signSummary} Signing is on the{" "}
                  <Link href={`${base}/review`} className="font-medium text-accent hover:underline">
                    Review and sign-off
                  </Link>{" "}
                  page.
                </p>
              )}
            </Section>

            <div className="space-y-3">
              {set.sheets.map((sheet) => (
                <details key={sheet.groupCode} id={`ls-${sheet.groupCode}`} className="group scroll-mt-4 rounded-lg border border-border bg-surface shadow-card">
                  <summary className={`${summaryRow} font-semibold`}>
                    <SummaryChevron />
                    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
                      <span>{sheet.groupName}</span>
                      <span className="text-sm font-normal text-ink-muted">{sheet.section}</span>
                      <SignCell state={stateOf(sheet.groupCode)} />
                    </span>
                    <span className="text-right font-semibold tabular-nums">{formatAmount(sheet.closingMinor)}</span>
                  </summary>
                  <div className="border-t border-border px-4 py-4 sm:px-5">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <caption className="sr-only">{sheet.groupName} accounts</caption>
                        <thead className="border-b border-border text-ink-muted">
                          <tr>
                            <th scope="col" className="py-2 pr-4 font-medium">
                              Code
                            </th>
                            <th scope="col" className="py-2 pr-4 font-medium">
                              Account
                            </th>
                            {hasAdjustments && (
                              <th scope="col" className="py-2 pl-4 text-right font-medium whitespace-nowrap">
                                Per trial balance
                              </th>
                            )}
                            {hasAdjustments && (
                              <th scope="col" className="py-2 pl-4 text-right font-medium">
                                Adjustments
                              </th>
                            )}
                            <th scope="col" className="py-2 pl-4 text-right font-medium">
                              {hasAdjustments ? "Adjusted" : "Closing"}
                            </th>
                            <th scope="col" className="py-2 pl-4 text-right font-medium whitespace-nowrap">
                              Prior year
                            </th>
                            <th scope="col" className="py-2 pl-4 text-right font-medium">
                              Movement
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {sheet.accounts.map((a) => (
                            <tr key={a.code} className="border-b border-border">
                              <td className="py-2 pr-4 font-mono text-sm text-ink-muted">{a.code}</td>
                              <td className="py-2 pr-4">{a.name}</td>
                              {hasAdjustments && <td className="py-2 pl-4 text-right whitespace-nowrap tabular-nums">{formatAmount(a.closingMinor - (a.adjustmentMinor ?? 0))}</td>}
                              {hasAdjustments && <td className="py-2 pl-4 text-right whitespace-nowrap tabular-nums">{a.adjustmentMinor ? formatAmount(a.adjustmentMinor) : ""}</td>}
                              <td className="py-2 pl-4 text-right whitespace-nowrap tabular-nums">{formatAmount(a.closingMinor)}</td>
                              <td className="py-2 pl-4 text-right whitespace-nowrap tabular-nums">{a.priorMinor === null ? "" : formatAmount(a.priorMinor)}</td>
                              <td className="py-2 pl-4 text-right whitespace-nowrap tabular-nums">{formatAmount(a.closingMinor - (a.priorMinor ?? 0))}</td>
                            </tr>
                          ))}
                          <tr className="font-semibold">
                            <th scope="row" className="py-2 pr-4" colSpan={hasAdjustments ? 4 : 2}>
                              Total
                            </th>
                            <td className="py-2 pl-4 text-right whitespace-nowrap tabular-nums">{formatAmount(sheet.closingMinor)}</td>
                            <td className="py-2 pl-4 text-right whitespace-nowrap tabular-nums">{formatAmount(sheet.priorMinor)}</td>
                            <td className="py-2 pl-4 text-right whitespace-nowrap tabular-nums">
                              {formatAmount(sheet.varianceMinor)}
                              {sheet.variancePct !== null && <span className="ml-2 text-sm font-normal text-ink-muted">{sheet.variancePct.toFixed(1)}%</span>}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** A lead sheet's sign-off state, read-only: a status with words, and the open review points when there are any. */
function SignCell({ state }: { state: { preparer: unknown | null; reviewer: unknown | null; openPoints: number } }) {
  const badge = signBadge(state);
  const points = openPointsLabel(state.openPoints);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <StatusBadge status={badge.status} label={badge.label} />
      {points && <Badge tone="warning">{points}</Badge>}
    </span>
  );
}
