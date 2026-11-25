"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { buttonClass } from "@/ui/button";
import { Callout } from "@/ui/feedback";
import { Input } from "@/ui/form";
import { Badge } from "@/ui/badge";
import { count } from "@/ui/text";
import { CARRIES_NOTE, MAX_ROLL_FORWARD, notEndedWords, ROLLED_FORWARD, STILL_OPEN, type RollRow } from "@/domain/bulk-rollforward";
import { rollForwardAction, type RollState } from "./rollforward-actions";

const initial: RollState = { ok: true, message: "" };

/**
 * The roll-forward list and its result. The selection and the edited dates are held here, so a refusal leaves them as they were. The server checks
 * every row again.
 */
export function RollForwardForm({ rows }: { rows: RollRow[] }) {
  const [state, run, pending] = useActionState(rollForwardAction, initial);
  const blocked = (r: RollRow) => r.rolledForward || r.notEnded;
  const selectable = rows.filter((r) => !blocked(r));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [dates, setDates] = useState<Record<string, { start: string; end: string }>>(() => Object.fromEntries(rows.map((r) => [r.clientId, { ...r.proposed }])));
  const problemOf = new Map((state.problems ?? []).map((p) => [p.clientId, p.message]));

  if (state.ok && state.created) {
    return (
      <section aria-labelledby="rolled-title" className="space-y-4">
        <Callout variant="success" title={state.message}>
          <p id="rolled-title">{CARRIES_NOTE}</p>
        </Callout>
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface shadow-card">
          {state.created.map((c) => (
            <li key={c.engagementId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
              <Link href={`/engagements/${c.engagementId}`} className="rounded-sm font-medium text-accent hover:underline">
                {c.clientName}
              </Link>
              <span className="text-sm text-ink-muted tabular-nums">
                {c.start} to {c.end}
              </span>
            </li>
          ))}
        </ul>
        <Link href="/" className={buttonClass("secondary")}>
          Back to the engagements
        </Link>
      </section>
    );
  }

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allPicked = selectable.length > 0 && selectable.every((r) => picked.has(r.clientId));
  const over = picked.size > MAX_ROLL_FORWARD;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData();
        for (const r of rows) {
          if (!picked.has(r.clientId)) continue;
          data.append("clientId", r.clientId);
          data.set(`start:${r.clientId}`, dates[r.clientId].start);
          data.set(`end:${r.clientId}`, dates[r.clientId].end);
        }
        startTransition(() => run(data));
      }}
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setPicked(allPicked ? new Set() : new Set(selectable.map((r) => r.clientId)))} disabled={selectable.length === 0}>
          {allPicked ? "Clear the selection" : "Select all that can be rolled forward"}
        </button>
        <p className="text-sm text-ink-muted" aria-live="polite">
          {count(picked.size, "client")} selected of {selectable.length} that can be rolled forward. At most {MAX_ROLL_FORWARD} at a time.
        </p>
      </div>

      {state.message && !state.ok && (
        <Callout variant="danger" title={state.message} className="mb-3">
          {state.problems && state.problems.length > 0 && (
            <ul className="list-disc pl-5">
              {state.problems.map((p) => (
                <li key={`${p.clientId}:${p.message}`}>
                  <span className="font-medium">{p.clientName}:</span> {p.message}
                </li>
              ))}
            </ul>
          )}
        </Callout>
      )}

      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface shadow-card">
        {rows.map((r) => {
          const id = `rf-${r.clientId}`;
          const problem = problemOf.get(r.clientId);
          return (
            <li key={r.clientId} className={`px-4 py-3 ${blocked(r) ? "bg-surface-muted/60" : ""}`}>
              <div className="grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.6fr)] sm:items-center">
                <div className="flex items-start gap-3">
                  <input
                    id={id}
                    type="checkbox"
                    className="mt-1 size-5 shrink-0 accent-accent"
                    checked={picked.has(r.clientId)}
                    disabled={blocked(r)}
                    onChange={() => toggle(r.clientId)}
                  />
                  <label htmlFor={id} className="min-w-0 font-medium text-ink">
                    {r.clientName}
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
                  <span className="tabular-nums">
                    {r.periodStart} to {r.periodEnd}
                  </span>
                  <Badge tone={r.status === "Open" ? "info" : "slate"}>{r.status}</Badge>
                </div>
                <div>
                  {blocked(r) ? (
                    <p className="text-sm font-medium text-ink-muted">{r.notEnded ? notEndedWords(r.periodEnd) : ROLLED_FORWARD}</p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        type="date"
                        aria-label={`${r.clientName}: new period start`}
                        value={dates[r.clientId].start}
                        onChange={(e) => setDates((d) => ({ ...d, [r.clientId]: { ...d[r.clientId], start: e.target.value } }))}
                        className="w-40!"
                      />
                      <span aria-hidden="true">to</span>
                      <Input
                        type="date"
                        aria-label={`${r.clientName}: new period end`}
                        value={dates[r.clientId].end}
                        onChange={(e) => setDates((d) => ({ ...d, [r.clientId]: { ...d[r.clientId], end: e.target.value } }))}
                        className="w-40!"
                      />
                    </div>
                  )}
                  {!blocked(r) && r.status === "Open" && <p className="mt-1 text-small text-warning-strong">{STILL_OPEN}</p>}
                  {!blocked(r) && r.auditEnabled && <p className="mt-1 text-small text-ink-muted">The audit will be on, as in last year&apos;s file.</p>}
                </div>
              </div>
              {problem && (
                <p role="alert" className="mt-2 text-sm font-medium text-danger-strong">
                  {problem}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className={buttonClass("primary")} disabled={pending || picked.size === 0 || over}>
          {pending ? "Creating…" : `Create ${count(picked.size, "engagement")}`}
        </button>
        {over && <p className="text-sm font-medium text-danger-strong">Choose at most {MAX_ROLL_FORWARD}.</p>}
        <p className="text-sm text-ink-muted">All or none: if any row is refused, nothing is created.</p>
      </div>
    </form>
  );
}
