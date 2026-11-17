"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parseAmount, formatAmount } from "@/domain/money";
import { TICKMARKS } from "@/domain/tickmarks";
import { coverage, difference, isKeyItem, scheduleTotal } from "@/domain/test-schedule";
import { comparativeTotals, isKeyMovement, movement } from "@/domain/rollforward";
import { saveLinesAction } from "@/app/schedule-actions";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { ctl } from "@/ui/controls";
import { Stat } from "@/ui/layout";
import { unsavedLabel } from "@/ui/schedule-view";
import { Table, TCell, THead, TRow } from "@/ui/table";
import { plainCount } from "@/ui/text";

export interface LineData {
  id: string;
  description: string;
  docRef: string | null;
  amountMinor: number;
  tested: boolean;
  tickmarks: string[];
  workingPaperId: string | null;
  remarks: string | null;
  priorAmountMinor: number | null;
}

interface Row {
  key: string;
  id: string | null;
  description: string;
  docRef: string;
  amount: string;
  tested: boolean;
  tickmarks: string[];
  workingPaperId: string;
  remarks: string;
  prior: number | null;
  dirty: boolean;
}

const plainAmount = (minor: number) => (minor / 100).toFixed(2);
const toRow = (l: LineData): Row => ({ key: l.id, id: l.id, description: l.description, docRef: l.docRef ?? "", amount: plainAmount(l.amountMinor), tested: l.tested, tickmarks: l.tickmarks, workingPaperId: l.workingPaperId ?? "", remarks: l.remarks ?? "", prior: l.priorAmountMinor, dirty: false });
const cell = `${ctl} w-full min-h-9 px-2`;

/**
 * The editable line table. Edits are kept in the page and saved together, only the rows that changed, so a long listing is
 * not sent a request at a time. Totals, key items and coverage follow the edits as they are made.
 */
export function LinesTable({
  scheduleId,
  initial,
  files,
  editable,
  thresholdMinor,
  balanceMinor,
}: {
  scheduleId: string;
  initial: LineData[];
  files: { id: string; fileName: string }[];
  editable: boolean;
  thresholdMinor: number;
  balanceMinor: number | null;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => initial.map(toRow));
  const [removed, setRemoved] = useState<string[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [counter, setCounter] = useState(0);

  const parsed = useMemo(
    () => rows.map((r) => {
      const a = parseAmount(r.amount);
      const invalid = a === null || Number.isNaN(a);
      return { amountMinor: invalid ? 0 : a, invalid };
    }),
    [rows],
  );
  const lines = rows.map((r, i) => ({ amountMinor: parsed[i].amountMinor, tested: r.tested }));
  const total = scheduleTotal(lines);
  const cov = coverage(lines, thresholdMinor);
  const diff = balanceMinor === null ? null : difference(total, balanceMinor);
  const hasPrior = rows.some((r) => r.prior !== null);
  const comp = comparativeTotals(rows.map((r, i) => ({ amountMinor: parsed[i].amountMinor, priorAmountMinor: r.prior })));
  const changes = rows.filter((r) => r.dirty || r.id === null).length + removed.length;
  const anyInvalid = rows.some((r, i) => parsed[i].invalid || r.description.trim() === "");

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch, dirty: true } : r)));
  const toggleTick = (r: Row, code: string) => update(r.key, { tickmarks: r.tickmarks.includes(code) ? r.tickmarks.filter((c) => c !== code) : [...r.tickmarks, code] });
  const addRow = () => {
    setCounter((c) => c + 1);
    setRows((rs) => [...rs, { key: `new-${counter}`, id: null, description: "", docRef: "", amount: "", tested: false, tickmarks: [], workingPaperId: "", remarks: "", prior: null, dirty: true }]);
  };
  const remove = (r: Row) => {
    if (r.id) setRemoved((x) => [...x, r.id as string]);
    setRows((rs) => rs.filter((x) => x.key !== r.key));
  };

  const save = () => {
    setMessage(null);
    const payload = rows
      .map((r, i) => ({ r, minor: parsed[i].amountMinor }))
      .filter(({ r }) => r.dirty || r.id === null)
      .map(({ r, minor }) => ({ id: r.id, description: r.description, docRef: r.docRef.trim() || null, amountMinor: minor, tested: r.tested, tickmarks: r.tickmarks, workingPaperId: r.workingPaperId || null, remarks: r.remarks.trim() || null }));
    startTransition(async () => {
      const result = await saveLinesAction(scheduleId, payload, removed);
      setMessage({ ok: result.ok, text: result.message });
      if (result.ok) {
        setRemoved([]);
        setRows((rs) => rs.map((r) => ({ ...r, dirty: false })));
        router.refresh();
      }
    });
  };

  const keyWarn = cov.keyItems > 0 && !cov.allKeyItemsTested;
  return (
    <div className="min-w-0">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <li>
          <Stat label="Total" value={formatAmount(total)} />
        </li>
        {balanceMinor !== null && (
          <li>
            <Stat label="Balance" value={formatAmount(balanceMinor)} />
          </li>
        )}
        {diff !== null && (
          <li>
            <Stat label="Difference" value={formatAmount(diff)} hint={diff === 0 ? <Badge tone="success">Agrees</Badge> : <Badge tone="danger">Does not agree</Badge>} />
          </li>
        )}
        {hasPrior && (
          <>
            <li>
              <Stat label="Last year" value={formatAmount(comp.priorMinor)} />
            </li>
            <li>
              <Stat label="Movement" value={formatAmount(comp.movementMinor)} />
            </li>
          </>
        )}
        <li>
          <Stat label="Tested" value={formatAmount(cov.testedMinor)} hint={cov.pct !== null ? `${cov.pct.toFixed(1)}% of the listing` : "No listing total"} />
        </li>
        <li>
          <Stat
            label="Key items"
            value={`${cov.keyItemsTested} of ${cov.keyItems}`}
            hint={thresholdMinor === 0 ? "Set materiality to find key items" : keyWarn ? <Badge tone="warning">Not all tested</Badge> : "tested"}
          />
        </li>
      </ul>

      <Table className="mt-4" caption="Lines of the schedule">
        <THead>
          <TRow>
            <TCell header="col" className="sticky left-0 z-10 min-w-64 bg-surface-muted">Line</TCell>
            <TCell header="col">Reference</TCell>
            <TCell header="col" numeric>Amount</TCell>
            {hasPrior && <TCell header="col" numeric>Last year</TCell>}
            {hasPrior && <TCell header="col" numeric>Movement</TCell>}
            <TCell header="col">Tested</TCell>
            <TCell header="col">Tickmarks</TCell>
            <TCell header="col">Evidence</TCell>
            <TCell header="col">Remarks</TCell>
            {editable && (
              <TCell header="col">
                <span className="sr-only">Remove</span>
              </TCell>
            )}
          </TRow>
        </THead>
        <tbody>
          {rows.map((r, i) => {
            const key = isKeyItem(parsed[i].amountMinor, thresholdMinor);
            const keyMove = isKeyMovement(parsed[i].amountMinor, r.prior, thresholdMinor);
            const move = movement(parsed[i].amountMinor, r.prior);
            const fileName = files.find((f) => f.id === r.workingPaperId)?.fileName;
            const bg = key || keyMove ? "bg-warning-soft" : "bg-surface";
            return (
              <TRow key={r.key} className={`align-top ${bg}`}>
                <TCell className={`sticky left-0 z-[1] min-w-64 ${bg}`}>
                  <div className="flex flex-wrap items-center gap-1 text-sm text-ink-muted">
                    <span>Line {i + 1}</span>
                    {key && <Badge tone="warning">Key</Badge>}
                    {keyMove && <Badge tone="warning">Key movement</Badge>}
                  </div>
                  {editable ? <input aria-label={`Description, line ${i + 1}`} className={`${cell} mt-1 min-w-56`} maxLength={500} value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} /> : <div className="mt-1 text-ink">{r.description}</div>}
                </TCell>
                <TCell>{editable ? <input aria-label={`Reference, line ${i + 1}`} className={`${cell} min-w-28`} maxLength={100} value={r.docRef} onChange={(e) => update(r.key, { docRef: e.target.value })} /> : r.docRef}</TCell>
                <TCell numeric>
                  {editable ? (
                    <input aria-label={`Amount, line ${i + 1}`} inputMode="decimal" aria-invalid={parsed[i].invalid || undefined} className={`${cell} min-w-36 text-right ${parsed[i].invalid ? "border-danger bg-danger-soft" : ""}`} value={r.amount} onChange={(e) => update(r.key, { amount: e.target.value })} />
                  ) : (
                    formatAmount(parsed[i].amountMinor)
                  )}
                </TCell>
                {hasPrior && <TCell numeric className="text-ink-muted">{r.prior === null ? "" : formatAmount(r.prior)}</TCell>}
                {hasPrior && <TCell numeric>{move === null ? "" : formatAmount(move)}</TCell>}
                <TCell>
                  <input type="checkbox" className="size-5" aria-label={`Tested, line ${i + 1}`} disabled={!editable} checked={r.tested} onChange={(e) => update(r.key, { tested: e.target.checked })} />
                </TCell>
                <TCell>
                  <div className="flex min-w-48 flex-wrap gap-1">
                    {TICKMARKS.map((t) => {
                      const on = r.tickmarks.includes(t.code);
                      return editable ? (
                        <button
                          key={t.code}
                          type="button"
                          title={t.meaning}
                          aria-label={`${t.meaning} (line ${i + 1})`}
                          aria-pressed={on}
                          onClick={() => toggleTick(r, t.code)}
                          className={`inline-flex min-h-8 min-w-8 items-center justify-center rounded-md border px-1.5 text-sm ${on ? "border-accent bg-accent font-bold text-surface underline decoration-2 underline-offset-2" : "border-border-strong bg-surface text-ink-muted hover:bg-surface-muted"}`}
                        >
                          {t.symbol}
                        </button>
                      ) : on ? (
                        <span key={t.code} role="img" title={t.meaning} aria-label={t.meaning} className="inline-flex min-h-7 min-w-7 items-center justify-center rounded-md border border-border-strong bg-surface px-1.5 text-sm font-medium text-ink">
                          {t.symbol}
                        </span>
                      ) : null;
                    })}
                  </div>
                </TCell>
                <TCell>
                  {editable ? (
                    <select aria-label={`Evidence, line ${i + 1}`} className={`${cell} min-w-44`} value={r.workingPaperId} onChange={(e) => update(r.key, { workingPaperId: e.target.value })}>
                      <option value="">None</option>
                      {files.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.fileName}
                        </option>
                      ))}
                    </select>
                  ) : fileName ? (
                    <span className="text-sm break-all">{fileName}</span>
                  ) : null}
                </TCell>
                <TCell>{editable ? <input aria-label={`Remarks, line ${i + 1}`} className={`${cell} min-w-44`} maxLength={1000} value={r.remarks} onChange={(e) => update(r.key, { remarks: e.target.value })} /> : r.remarks}</TCell>
                {editable && (
                  <TCell>
                    <Button type="button" variant="danger" size="sm" aria-label={`Remove line ${i + 1}`} onClick={() => remove(r)}>
                      Remove
                    </Button>
                  </TCell>
                )}
              </TRow>
            );
          })}
          {rows.length === 0 && (
            <TRow>
              <TCell colSpan={11} className="text-ink-muted">
                No lines yet. Import a listing above or add a line.
              </TCell>
            </TRow>
          )}
        </tbody>
      </Table>

      {editable && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-muted px-4 py-3">
          <Button type="button" variant="secondary" onClick={addRow}>
            Add a line
          </Button>
          <Button type="button" variant="primary" disabled={pending || changes === 0 || anyInvalid} onClick={save}>
            {pending ? "Saving…" : `Save line changes${changes > 0 ? ` (${changes})` : ""}`}
          </Button>
          {changes > 0 && <Badge tone="warning">{unsavedLabel(changes)}</Badge>}
          {anyInvalid && <span className="text-sm font-medium text-danger-strong">Every line needs a description and a valid amount.</span>}
          {message && (
            <span role="status" className={`text-sm font-medium ${message.ok ? "text-success-strong" : "text-danger-strong"}`}>
              {plainCount(message.text)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
