"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parseAmount, formatAmount } from "@/domain/money";
import { TICKMARKS } from "@/domain/tickmarks";
import { coverage, difference, isKeyItem, scheduleTotal } from "@/domain/test-schedule";
import { saveLinesAction } from "@/app/schedule-actions";

export interface LineData {
  id: string;
  description: string;
  docRef: string | null;
  amountMinor: number;
  tested: boolean;
  tickmarks: string[];
  workingPaperId: string | null;
  remarks: string | null;
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
  dirty: boolean;
}

const plainAmount = (minor: number) => (minor / 100).toFixed(2);
const toRow = (l: LineData): Row => ({ key: l.id, id: l.id, description: l.description, docRef: l.docRef ?? "", amount: plainAmount(l.amountMinor), tested: l.tested, tickmarks: l.tickmarks, workingPaperId: l.workingPaperId ?? "", remarks: l.remarks ?? "", dirty: false });
const cell = "w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-sm text-slate-900";
const small = "rounded border border-slate-400 px-2 py-1 text-xs hover:bg-slate-100";

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
  const changes = rows.filter((r) => r.dirty || r.id === null).length + removed.length;
  const anyInvalid = rows.some((r, i) => parsed[i].invalid || r.description.trim() === "");

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch, dirty: true } : r)));
  const toggleTick = (r: Row, code: string) => update(r.key, { tickmarks: r.tickmarks.includes(code) ? r.tickmarks.filter((c) => c !== code) : [...r.tickmarks, code] });
  const addRow = () => {
    setCounter((c) => c + 1);
    setRows((rs) => [...rs, { key: `new-${counter}`, id: null, description: "", docRef: "", amount: "", tested: false, tickmarks: [], workingPaperId: "", remarks: "", dirty: true }]);
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

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        <span>Total: <span className="font-semibold tabular-nums">{formatAmount(total)}</span></span>
        {balanceMinor !== null && <span>Balance: <span className="tabular-nums">{formatAmount(balanceMinor)}</span></span>}
        {diff !== null && diff !== 0 && <span className="rounded bg-red-100 px-2 py-0.5 font-semibold text-red-900">Difference: {formatAmount(diff)}</span>}
        {diff === 0 && <span className="font-medium text-emerald-800">Agrees to the balance</span>}
        <span>
          Tested: <span className="tabular-nums">{formatAmount(cov.testedMinor)}</span>
          {cov.pct !== null ? ` (${cov.pct.toFixed(1)}% of the listing)` : " (no listing total)"}
        </span>
        <span className={cov.keyItems > 0 && !cov.allKeyItemsTested ? "font-medium text-amber-900" : ""}>
          Key items: {cov.keyItemsTested} of {cov.keyItems} tested{thresholdMinor === 0 ? " (set materiality to find key items)" : ""}
        </span>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="border-b border-slate-300 text-slate-600">
            <tr>
              <th className="py-2 pr-2 font-medium">#</th>
              <th className="py-2 pr-2 font-medium">Description</th>
              <th className="py-2 pr-2 font-medium">Reference</th>
              <th className="py-2 pr-2 text-right font-medium">Amount</th>
              <th className="py-2 pr-2 font-medium">Tested</th>
              <th className="py-2 pr-2 font-medium">Tickmarks</th>
              <th className="py-2 pr-2 font-medium">Evidence</th>
              <th className="py-2 pr-2 font-medium">Remarks</th>
              {editable && <th className="py-2 font-medium"><span className="sr-only">Remove</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const key = isKeyItem(parsed[i].amountMinor, thresholdMinor);
              const fileName = files.find((f) => f.id === r.workingPaperId)?.fileName;
              return (
                <tr key={r.key} className={`border-b border-slate-100 align-top ${key ? "bg-amber-50" : ""}`}>
                  <td className="py-1.5 pr-2 text-slate-600">{i + 1}{key && <span className="ml-1 rounded bg-amber-200 px-1 text-xs font-medium text-amber-950">Key</span>}</td>
                  <td className="py-1.5 pr-2">
                    {editable ? <input aria-label={`Description, line ${i + 1}`} className={cell} maxLength={500} value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} /> : r.description}
                  </td>
                  <td className="py-1.5 pr-2">
                    {editable ? <input aria-label={`Reference, line ${i + 1}`} className={`${cell} w-28`} maxLength={100} value={r.docRef} onChange={(e) => update(r.key, { docRef: e.target.value })} /> : r.docRef}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {editable ? (
                      <input aria-label={`Amount, line ${i + 1}`} inputMode="decimal" className={`${cell} w-32 text-right ${parsed[i].invalid ? "border-red-600 bg-red-50" : ""}`} value={r.amount} onChange={(e) => update(r.key, { amount: e.target.value })} />
                    ) : (
                      formatAmount(parsed[i].amountMinor)
                    )}
                  </td>
                  <td className="py-1.5 pr-2">
                    <input type="checkbox" aria-label={`Tested, line ${i + 1}`} disabled={!editable} checked={r.tested} onChange={(e) => update(r.key, { tested: e.target.checked })} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <div className="flex flex-wrap gap-1">
                      {TICKMARKS.map((t) =>
                        editable ? (
                          <button
                            key={t.code}
                            type="button"
                            title={t.meaning}
                            aria-label={`${t.meaning} (line ${i + 1})`}
                            aria-pressed={r.tickmarks.includes(t.code)}
                            onClick={() => toggleTick(r, t.code)}
                            className={`min-w-6 rounded border px-1 text-xs ${r.tickmarks.includes(t.code) ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-100"}`}
                          >
                            {t.symbol}
                          </button>
                        ) : r.tickmarks.includes(t.code) ? (
                          <span key={t.code} title={t.meaning} className="rounded border border-slate-400 px-1 text-xs">{t.symbol}</span>
                        ) : null,
                      )}
                    </div>
                  </td>
                  <td className="py-1.5 pr-2">
                    {editable ? (
                      <select aria-label={`Evidence, line ${i + 1}`} className={`${cell} w-40`} value={r.workingPaperId} onChange={(e) => update(r.key, { workingPaperId: e.target.value })}>
                        <option value="">None</option>
                        {files.map((f) => <option key={f.id} value={f.id}>{f.fileName}</option>)}
                      </select>
                    ) : fileName ? <span className="text-xs">{fileName}</span> : null}
                  </td>
                  <td className="py-1.5 pr-2">
                    {editable ? <input aria-label={`Remarks, line ${i + 1}`} className={`${cell} w-44`} maxLength={1000} value={r.remarks} onChange={(e) => update(r.key, { remarks: e.target.value })} /> : r.remarks}
                  </td>
                  {editable && <td className="py-1.5"><button type="button" className={small} aria-label={`Remove line ${i + 1}`} onClick={() => remove(r)}>Remove</button></td>}
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={9} className="py-4 text-sm text-slate-600">No lines yet. Import a listing above or add a line.</td></tr>}
          </tbody>
        </table>
      </div>

      {editable && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className={small} onClick={addRow}>Add a line</button>
          <button type="button" disabled={pending || changes === 0 || anyInvalid} onClick={save} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
            {pending ? "Saving…" : `Save line changes${changes > 0 ? ` (${changes})` : ""}`}
          </button>
          {anyInvalid && <span className="text-sm text-red-800">Every line needs a description and a valid amount.</span>}
          {message && <span role="status" className={`text-sm ${message.ok ? "text-emerald-800" : "text-red-800"}`}>{message.text}</span>}
        </div>
      )}
    </div>
  );
}
