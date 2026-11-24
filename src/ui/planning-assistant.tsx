import Link from "next/link";
import { BENCHMARKS } from "@/domain/audit";
import { formatAmount } from "@/domain/money";
import type { Derivation } from "@/domain/planning";
import { Badge } from "@/ui/badge";
import { Callout } from "@/ui/feedback";
import { Table, TCell, THead, TRow } from "@/ui/table";
import { NOT_SAVED, PLANNING_DRAFT, PLANNING_DRAFT_TITLE, VERDICT_LABEL } from "@/ui/planning-view";

/** The planning assistant panel on the audit planning page: what the trial balance says and what it suggests. Read-only: it saves nothing. */
export function PlanningAssistant({ derivation: d, engagementId, customised, settingsHref, questionnaireHref }: { derivation: Derivation; engagementId: string; customised: boolean; settingsHref: string | null; questionnaireHref: string }) {
  const lead = (code: string) => (
    <Link key={code} href={`/engagements/${engagementId}/lead-sheets#ls-${code}`} className="text-accent underline-offset-2 hover:underline">
      {code}
    </Link>
  );
  const significant = d.significant.filter((s) => s.verdict === "significant");
  const notSignificant = d.significant.filter((s) => s.verdict === "not_significant");
  return (
    <div className="space-y-5">
      <Callout variant="draft" title={PLANNING_DRAFT_TITLE}>
        {PLANNING_DRAFT}
      </Callout>
      <p className="text-sm">
        <Link href={questionnaireHref} className="font-medium text-accent underline-offset-2 hover:underline">
          Answer the planning questionnaire
        </Link>{" "}
        to confirm these suggestions, with a reason for any change, and to record the going-concern, fraud and understanding answers.
      </p>
      {d.notes.map((n) => (
        <p key={n} className="text-sm text-ink-muted">
          {n}
        </p>
      ))}

      {!d.empty && (
        <>
          <div>
            <h3 className="font-semibold">Figures</h3>
            <p className="text-sm text-ink-muted">Source: the adjusted trial balance. Each figure links to the lead sheets behind it.</p>
            <div className="mt-2">
              <Table caption="Figures for planning, current and prior year">
                <THead>
                  <TRow>
                    <TCell header="col">Figure</TCell>
                    <TCell header="col" numeric>
                      Current year
                    </TCell>
                    <TCell header="col" numeric>
                      Prior year
                    </TCell>
                    <TCell header="col">Lead sheets</TCell>
                  </TRow>
                </THead>
                <tbody>
                  {d.figures.map((f) => (
                    <TRow key={f.key}>
                      <TCell header="row">{f.label}</TCell>
                      <TCell numeric>{formatAmount(f.current)}</TCell>
                      <TCell numeric>{formatAmount(f.prior)}</TCell>
                      <TCell>
                        <span className="flex flex-wrap gap-x-2 gap-y-1 text-sm">{f.leadSheets.map(lead)}</span>
                      </TCell>
                    </TRow>
                  ))}
                </tbody>
              </Table>
            </div>
          </div>

          {d.benchmark && d.percentage && d.suggested && (
            <div>
              <h3 className="font-semibold">Suggested materiality</h3>
              <p className="text-sm text-ink-muted">
                {NOT_SAVED} Source: the benchmark rules, the answers so far and the firm&apos;s percentage ranges{customised ? " (edited by the firm)" : " (the defaults)"}.
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                <li>
                  <span className="font-medium">Benchmark:</span> {BENCHMARKS[d.benchmark.benchmark].label}, {formatAmount(d.benchmark.amountMinor)}. {d.benchmark.reason}
                </li>
                <li>
                  <span className="font-medium">Percentage:</span> {d.percentage.bp / 100}%. {d.percentage.reasons.join(" ")}
                </li>
                <li>
                  <span className="font-medium">Performance:</span> {d.performance.pct}% of overall. {d.performance.reasons.join(" ")}
                </li>
              </ul>
              <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {(
                  [
                    ["Overall materiality", d.suggested.overallMinor],
                    ["Performance materiality", d.suggested.performanceMinor],
                    [`Clearly trivial below (${d.suggested.trivialPct}%)`, d.suggested.trivialMinor],
                  ] as [string, number][]
                ).map(([label, value]) => (
                  <li key={label} className="rounded-lg border border-border bg-surface px-4 py-3 shadow-card">
                    <p className="text-sm text-ink-muted">{label}</p>
                    <p className="text-xl font-semibold tabular-nums">{formatAmount(value)}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h3 className="font-semibold">Indicators</h3>
            <p className="text-sm text-ink-muted">
              Source: the adjusted trial balance and the firm&apos;s thresholds. Each one that is found opens a question for the team. Only these make the going-concern questions (ISA 570) mandatory: {d.goingConcern.triggers.length > 0 ? d.goingConcern.triggers.join(", ").toLowerCase() : "none, because the firm has ticked none"} (the firm&apos;s list, a draft default).{" "}
              {d.goingConcern.required ? `Found: ${d.goingConcern.hits.join(", ").toLowerCase()}, so the going-concern questions are mandatory.` : "None of those is found, so the going-concern questions are not mandatory."}
            </p>
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface shadow-card">
              {d.indicators.map((i) => (
                <li key={i.key} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={i.hit ? "warning" : "neutral"}>{i.hit ? "Found" : "Not found"}</Badge>
                    <span className="font-medium">{i.label}</span>
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">{i.detail}</p>
                  {i.hit && <p className="mt-1 text-sm">Question: {i.question}</p>}
                  {i.hit && i.leadSheets.length > 0 && <p className="mt-1 flex flex-wrap gap-x-2 text-sm">Lead sheets: {i.leadSheets.map(lead)}</p>}
                </li>
              ))}
            </ul>
          </div>

          {d.suggested && (
            <div>
              <h3 className="font-semibold">Significant areas</h3>
              <p className="text-sm text-ink-muted">
                {NOT_SAVED} Source: performance materiality and the clearly trivial figure above. A person confirms each area. {significant.length} suggested significant, {notSignificant.length} suggested not significant, the rest a judgement.
              </p>
              <div className="mt-2">
                <Table caption="Lead sheets and whether they are suggested significant">
                  <THead>
                    <TRow>
                      <TCell header="col">Lead sheet</TCell>
                      <TCell header="col" numeric>
                        Current year
                      </TCell>
                      <TCell header="col" numeric>
                        Prior year
                      </TCell>
                      <TCell header="col">Suggestion</TCell>
                    </TRow>
                  </THead>
                  <tbody>
                    {d.significant.map((s) => (
                      <TRow key={s.groupCode}>
                        <TCell header="row">{s.name}</TCell>
                        <TCell numeric>{formatAmount(s.current)}</TCell>
                        <TCell numeric>{formatAmount(s.prior)}</TCell>
                        <TCell>
                          <Badge tone={s.verdict === "significant" ? "warning" : "neutral"}>{VERDICT_LABEL[s.verdict]}</Badge>
                          <span className="mt-1 block text-sm text-ink-muted">{s.reason}</span>
                        </TCell>
                      </TRow>
                    ))}
                  </tbody>
                </Table>
              </div>
            </div>
          )}

          <div>
            <h3 className="font-semibold">Presumed risks</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {d.presumedRisks.map((r) => (
                <li key={r.areaCode}>
                  <span className="font-medium">{r.areaCode}:</span> {r.text} <span className="text-ink-muted">Source: {r.source}</span>
                </li>
              ))}
            </ul>
          </div>

          {d.areaSuggestions.length > 0 && (
            <div>
              <h3 className="font-semibold">Suggested area ratings</h3>
              <p className="text-sm text-ink-muted">{NOT_SAVED} Rate the areas on this page; nothing is filled in for you here.</p>
              <ul className="mt-2 space-y-1 text-sm">
                {d.areaSuggestions.map((a) => (
                  <li key={`${a.areaCode}:${a.assertion}`}>
                    <span className="font-medium">
                      {a.areaCode}, {a.assertion}: {a.level}.
                    </span>{" "}
                    {a.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <p className="text-sm text-ink-muted">
        {settingsHref ? (
          <>
            The percentage ranges and thresholds are the firm&apos;s planning settings.{" "}
            <Link href={settingsHref} className="text-accent underline-offset-2 hover:underline">
              Change the planning settings
            </Link>
            .
          </>
        ) : (
          "The percentage ranges and thresholds are the firm's planning settings. A partner or the administrator can change them."
        )}
      </p>
    </div>
  );
}
