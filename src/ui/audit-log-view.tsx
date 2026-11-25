import Link from "next/link";
import { CAP_MESSAGE, EXPORT_CAP, filterParams, hasFilters, type LogFilters } from "@/domain/audit-log";
import type { FilterChoices, LogPage } from "@/server/audit-log";
import { Button, LinkButton } from "./button";
import { Callout, EmptyState } from "./feedback";
import { Field, Input, Select } from "./form";
import { Table, TCell, THead, TRow } from "./table";

const href = (base: string, f: LogFilters, extra: Record<string, string> = {}) => {
  const p = filterParams(f);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const q = p.toString();
  return q ? `${base}?${q}` : base;
};

export const AUDIT_LOG_PATH = "/firm/audit-log";

/**
 * The audit log page body: the filter form (a plain GET form, so a filtered view can be linked), what was ignored and why, the export buttons or
 * the cap message, the table, and the Older and Newer links. Every state is in words.
 */
export function AuditLogView({ page, filters, problems, choices, total, cap = EXPORT_CAP }: { page: LogPage; filters: LogFilters; problems: string[]; choices: FilterChoices; total: number; cap?: number }) {
  const over = total > cap;
  return (
    <div className="space-y-5">
      <form method="get" action={AUDIT_LOG_PATH} className="rounded-lg border border-border bg-surface p-4 shadow-card sm:p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Person">
            <Select name="person" defaultValue={filters.person ?? ""}>
              <option value="">Everyone</option>
              {choices.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Engagement">
            <Select name="engagement" defaultValue={filters.engagement ?? ""}>
              <option value="">All engagements</option>
              {choices.engagements.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Action">
            <Select name="action" defaultValue={filters.action ?? ""}>
              <option value="">All actions</option>
              {choices.actions.map((a) => (
                <option key={a.action} value={a.action}>
                  {a.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From" hint="Whole days, UTC, included.">
            <Input name="from" type="date" defaultValue={filters.from ?? ""} />
          </Field>
          <Field label="To">
            <Input name="to" type="date" defaultValue={filters.to ?? ""} />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="primary">Apply the filters</Button>
          {hasFilters(filters) && (
            <Link href={AUDIT_LOG_PATH} className="rounded-sm text-sm font-medium text-accent hover:underline">
              Clear the filters
            </Link>
          )}
        </div>
      </form>

      {problems.length > 0 && (
        <Callout variant="warning" title="Some filters were ignored">
          <ul className="list-disc pl-5">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Callout>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {total.toLocaleString("en-GB")} {total === 1 ? "entry" : "entries"}
          {hasFilters(filters) ? " match these filters" : ""}, newest first.
        </p>
        {total > 0 &&
          (over ? (
            <p role="status" className="text-sm font-medium text-warning-strong">
              {CAP_MESSAGE(total, cap)}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <LinkButton href={href(`${AUDIT_LOG_PATH}/export`, filters, { format: "xlsx" })} size="sm" prefetch={false}>
                Download as Excel
              </LinkButton>
              <LinkButton href={href(`${AUDIT_LOG_PATH}/export`, filters, { format: "csv" })} size="sm" prefetch={false}>
                Download as CSV
              </LinkButton>
            </div>
          ))}
      </div>

      {page.entries.length === 0 ? (
        <EmptyState title="No entries match these filters." description={hasFilters(filters) ? "Clear a filter or widen the dates." : "Nothing has been recorded yet."} />
      ) : (
        <Table caption="Audit log, newest first">
          <THead>
            <TRow>
              <TCell header="col">When (UTC)</TCell>
              <TCell header="col">Who</TCell>
              <TCell header="col">What</TCell>
              <TCell header="col">Engagement</TCell>
              <TCell header="col">Details</TCell>
            </TRow>
          </THead>
          <tbody>
            {page.entries.map((e) => (
              <TRow key={e.id} className="align-top">
                <TCell className="whitespace-nowrap tabular-nums">{e.at}</TCell>
                <TCell>{e.who}</TCell>
                <TCell>
                  <div className="font-medium text-ink">{e.what}</div>
                  <div className="text-small text-ink-subtle">{e.action}</div>
                </TCell>
                <TCell>
                  {e.engagementId && e.engagement ? (
                    <Link href={`/engagements/${e.engagementId}`} className="rounded-sm text-accent hover:underline">
                      {e.engagement}
                    </Link>
                  ) : (
                    <span className="text-ink-muted">None</span>
                  )}
                </TCell>
                <TCell className="min-w-56 max-w-md">
                  {e.summary && <p className="break-words">{e.summary}</p>}
                  {e.json && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-small text-accent">Full detail</summary>
                      <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-surface-muted p-2 text-small whitespace-pre-wrap break-words">{e.json}</pre>
                    </details>
                  )}
                  {!e.summary && !e.json && <span className="text-ink-muted">None</span>}
                </TCell>
              </TRow>
            ))}
          </tbody>
        </Table>
      )}

      {(page.newer || page.older) && (
        <nav aria-label="Pages" className="flex items-center justify-between gap-3">
          {page.newer ? (
            <LinkButton href={href(AUDIT_LOG_PATH, filters, { newer: page.newer })} size="sm">
              Newer
            </LinkButton>
          ) : (
            <span />
          )}
          {page.older ? (
            <LinkButton href={href(AUDIT_LOG_PATH, filters, { older: page.older })} size="sm">
              Older
            </LinkButton>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
