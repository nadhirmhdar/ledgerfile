"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatAmount } from "@/domain/money";
import { difference, MAX_SCHEDULE_LINES } from "@/domain/test-schedule";
import { matchListing, type ExistingLine } from "@/domain/rollforward";
import { importLinesAction, previewListingAction, type ListingPreview } from "@/app/schedule-actions";
import { Button } from "@/ui/button";
import { Disclosure } from "@/ui/controls";
import { Callout } from "@/ui/feedback";
import { Field, Textarea } from "@/ui/form";
import { count, plainCount } from "@/ui/text";

const radio = "flex items-start gap-2 text-sm text-ink";

/**
 * Bring in a client's listing by pasting it or uploading a file. It is read and shown first, with what could not be read,
 * and only saved when the user confirms. The preview is kept here, so nothing is lost between the two steps.
 */
export function ImportListing({ scheduleId, balanceMinor, existingLines, broughtForward }: { scheduleId: string; balanceMinor: number | null; existingLines: (ExistingLine & { amountMinor: number; ticked: boolean })[]; broughtForward: boolean }) {
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
  // Matched lines that are ticked and whose amount would change lose their ticks.
  const ticksToClear = match && preview ? match.matches.filter((m) => { const e = existingLines.find((x) => x.id === m.existingId); return !!e && e.ticked && e.amountMinor !== preview.lines[m.importedIndex].amountMinor; }).length : 0;
  return (
    <Disclosure summary="Import a listing from the client" className="mt-3">
      <p className="text-sm text-ink-muted">
        Paste from Excel, or upload an .xlsx or .csv file. It needs a heading row with a description column (such as Description, Name or Supplier) and an amount column
        (such as Amount or Balance); a reference column is used if there is one. A schedule holds at most {MAX_SCHEDULE_LINES.toLocaleString("en-US")} lines.
      </p>
      <form ref={form} className="mt-3 space-y-3" onSubmit={(e) => e.preventDefault()}>
        <Field label="Paste the listing">
          <Textarea name="pasted" rows={4} placeholder={"Description\tAmount\nSupplier A\t1,250.00"} />
        </Field>
        <Field label="Or choose a file">
          <input type="file" name="file" accept=".xlsx,.csv" className="block w-full text-sm text-ink file:mr-3 file:min-h-10 file:cursor-pointer file:rounded-md file:border file:border-border-strong file:bg-surface file:px-4 file:text-sm file:font-medium file:text-ink hover:file:bg-surface-muted" />
        </Field>
        <Button type="button" variant="secondary" disabled={pending} onClick={read}>
          {pending && !preview ? "Reading…" : "Read the listing"}
        </Button>
      </form>

      {preview && (
        <div className="mt-4 space-y-3 text-sm">
          {preview.errors.length > 0 ? (
            <Callout variant="danger">{preview.errors.join(" ")}</Callout>
          ) : (
            <>
              <p>
                Read <span className="font-semibold">{count(preview.lines.length, "line")}</span> totalling <span className="font-semibold tabular-nums">{formatAmount(total)}</span>.
                {balanceMinor !== null && (mode === "replace" || (mode === "match" && match && match.unmatchedExisting.length === 0)) && (
                  <> The balance is {formatAmount(balanceMinor)}; difference {formatAmount(difference(total, balanceMinor))}.</>
                )}
              </p>
              <ul className="max-h-40 overflow-y-auto rounded-md border border-border bg-surface-muted px-3 py-2 text-ink-muted">
                {preview.lines.slice(0, 8).map((l, i) => (
                  <li key={i} className="break-words">{l.docRef ? `${l.docRef} · ` : ""}{l.description}: {formatAmount(l.amountMinor)}</li>
                ))}
                {preview.lines.length > 8 && <li>…and {(preview.lines.length - 8).toLocaleString("en-US")} more</li>}
              </ul>
              {preview.rejected.length > 0 && (
                <Callout variant="warning" title={`${count(preview.rejected.length, "row")} could not be read and will not be imported`}>
                  <ul>
                    {preview.rejected.slice(0, 15).map((r) => <li key={r.row}>Row {r.row}: {r.reason}</li>)}
                    {preview.rejected.length > 15 && <li>…and {preview.rejected.length - 15} more</li>}
                  </ul>
                </Callout>
              )}
              {match && (
                <Callout variant="info">
                  {match.matches.length} matched to last year&apos;s lines ({match.byReference} by reference, {match.byDescription} by description). {count(match.unmatchedImported.length, "imported line")} {match.unmatchedImported.length === 1 ? "has" : "have"} no match and will be added with no comparative. {match.unmatchedExisting.length} of last year&apos;s {match.unmatchedExisting.length === 1 ? "line has" : "lines have"} nothing imported against them and keep their comparative with a zero amount.
                  {ticksToClear > 0 && <span className="mt-1 block font-semibold">{count(ticksToClear, "matched line")} {ticksToClear === 1 ? "is" : "are"} tested or ticked and would change amount: their tested box and tickmarks will be cleared, because they no longer describe the new amount. Evidence links and remarks stay.</span>}
                </Callout>
              )}
              <fieldset className="space-y-2">
                <legend className="sr-only">Where to put the lines</legend>
                {broughtForward && <label className={radio}><input type="radio" name="mode" className="mt-1" checked={mode === "match"} onChange={() => setMode("match")} /> Match to last year&apos;s lines (by reference, then description)</label>}
                <label className={radio}><input type="radio" name="mode" className="mt-1" checked={mode === "append"} onChange={() => setMode("append")} /> Add after the {count(existing, "line")} already there</label>
                <label className={radio}><input type="radio" name="mode" className="mt-1" checked={mode === "replace"} onChange={() => setMode("replace")} /> Replace them{existing > 0 ? ` (removes ${count(existing, "line")}, their tickmarks and last year's comparatives)` : ""}</label>
              </fieldset>
              {mode === "replace" && existing > 0 && <Callout variant="warning">Replacing removes the lines that are there now, with their tickmarks and comparatives. It cannot be undone.</Callout>}
              <Button type="button" variant="primary" disabled={pending} onClick={save}>
                Import {count(preview.lines.length, "line")}
              </Button>
            </>
          )}
        </div>
      )}
      {message && (
        <p role="status" className={`mt-3 text-sm font-medium ${message.ok ? "text-success-strong" : "text-danger-strong"}`}>
          {plainCount(message.text)}
        </p>
      )}
    </Disclosure>
  );
}
