"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatAmount } from "@/domain/money";
import { difference, MAX_SCHEDULE_LINES } from "@/domain/test-schedule";
import { matchListing, type ExistingLine } from "@/domain/rollforward";
import { importLinesAction, previewListingAction, type ListingPreview } from "@/app/schedule-actions";

const small = "rounded border border-slate-400 px-2 py-1 text-xs hover:bg-slate-100";
const input = "w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900";

/**
 * Bring in a client's listing by pasting it or uploading a file. It is read and shown first, with what could not be read,
 * and only saved when the user confirms. The preview is kept here, so nothing is lost between the two steps.
 */
export function ImportListing({ scheduleId, balanceMinor, existingLines, broughtForward }: { scheduleId: string; balanceMinor: number | null; existingLines: ExistingLine[]; broughtForward: boolean }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [preview, setPreview] = useState<ListingPreview | null>(null);
  const [mode, setMode] = useState<"append" | "replace" | "match">(broughtForward ? "match" : "append");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const read = () => {
    if (!form.current) return;
    const data = new FormData(form.current);
    setMessage(null);
    startTransition(async () => setPreview(await previewListingAction(data)));
  };
  const save = () => {
    if (!preview) return;
    startTransition(async () => {
      const r = await importLinesAction(scheduleId, preview.lines, mode);
      setMessage({ ok: r.ok, text: r.message });
      if (r.ok) {
        setPreview(null);
        form.current?.reset();
        router.refresh();
      }
    });
  };

  const total = preview?.totalMinor ?? 0;
  const existing = existingLines.length;
  const match = preview && broughtForward && mode === "match" ? matchListing(existingLines, preview.lines) : null;
  return (
    <details className="mt-4 rounded border border-slate-200 p-3">
      <summary className="cursor-pointer text-sm font-medium">Import a listing from the client</summary>
      <p className="mt-2 text-xs text-slate-600">
        Paste from Excel, or upload an .xlsx or .csv file. It needs a heading row with a description column (such as Description, Name or Supplier) and an amount column
        (such as Amount or Balance); a reference column is used if there is one. A schedule holds at most {MAX_SCHEDULE_LINES.toLocaleString("en-US")} lines.
      </p>
      <form ref={form} className="mt-2 space-y-2" onSubmit={(e) => e.preventDefault()}>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Paste the listing
          <textarea name="pasted" rows={4} className={input} placeholder={"Description\tAmount\nSupplier A\t1,250.00"} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Or choose a file
          <input type="file" name="file" accept=".xlsx,.csv" className="text-xs text-slate-900" />
        </label>
        <button type="button" className={small} disabled={pending} onClick={read}>{pending && !preview ? "Reading…" : "Read the listing"}</button>
      </form>

      {preview && (
        <div className="mt-3 text-sm">
          {preview.errors.length > 0 ? (
            <p role="alert" className="text-red-800">{preview.errors.join(" ")}</p>
          ) : (
            <>
              <p>
                Read <span className="font-semibold">{preview.lines.length.toLocaleString("en-US")}</span> line(s) totalling <span className="font-semibold tabular-nums">{formatAmount(total)}</span>.
                {balanceMinor !== null && (mode === "replace" || (mode === "match" && match && match.unmatchedExisting.length === 0)) && (
                  <> The balance is {formatAmount(balanceMinor)}; difference {formatAmount(difference(total, balanceMinor))}.</>
                )}
              </p>
              <ul className="mt-1 max-h-40 overflow-y-auto text-xs text-slate-700">
                {preview.lines.slice(0, 8).map((l, i) => (
                  <li key={i}>{l.docRef ? `${l.docRef} · ` : ""}{l.description}: {formatAmount(l.amountMinor)}</li>
                ))}
                {preview.lines.length > 8 && <li>…and {(preview.lines.length - 8).toLocaleString("en-US")} more</li>}
              </ul>
              {preview.rejected.length > 0 && (
                <div role="note" className="mt-2 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-xs">
                  <p className="font-medium">{preview.rejected.length} row(s) could not be read and will not be imported:</p>
                  <ul className="mt-1">
                    {preview.rejected.slice(0, 15).map((r) => <li key={r.row}>Row {r.row}: {r.reason}</li>)}
                    {preview.rejected.length > 15 && <li>…and {preview.rejected.length - 15} more</li>}
                  </ul>
                </div>
              )}
              {match && (
                <p role="note" className="mt-2 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-xs">
                  {match.matches.length} matched to last year&apos;s lines ({match.byReference} by reference, {match.byDescription} by description). {match.unmatchedImported.length} imported line(s) have no match and will be added with no comparative. {match.unmatchedExisting.length} of last year&apos;s line(s) have nothing imported against them and keep their comparative with a zero amount.
                </p>
              )}
              <fieldset className="mt-2 flex flex-wrap items-center gap-4 text-sm">
                <legend className="sr-only">Where to put the lines</legend>
                {broughtForward && <label className="flex items-center gap-1"><input type="radio" name="mode" checked={mode === "match"} onChange={() => setMode("match")} /> Match to last year&apos;s lines (by reference, then description)</label>}
                <label className="flex items-center gap-1"><input type="radio" name="mode" checked={mode === "append"} onChange={() => setMode("append")} /> Add after the {existing} line(s) already there</label>
                <label className="flex items-center gap-1"><input type="radio" name="mode" checked={mode === "replace"} onChange={() => setMode("replace")} /> Replace them{existing > 0 ? ` (removes ${existing} line(s), their tickmarks and last year's comparatives)` : ""}</label>
              </fieldset>
              <button type="button" className="mt-2 rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50" disabled={pending} onClick={save}>
                Import {preview.lines.length.toLocaleString("en-US")} line(s)
              </button>
            </>
          )}
        </div>
      )}
      {message && <p role="status" className={`mt-2 text-sm ${message.ok ? "text-emerald-800" : "text-red-800"}`}>{message.text}</p>}
    </details>
  );
}
