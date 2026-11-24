"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importClientsAction, previewClientImportAction, type PreviewResult } from "@/app/client-import-actions";
import { confirmLabel, importSentence, rowsToShow, STATUS_LABEL, type ImportRow, type RowStatus } from "@/domain/client-import";
import { DETAIL_LABEL, yearEndText } from "@/domain/client-details";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Callout } from "@/ui/feedback";
import { Field, Textarea } from "@/ui/form";
import type { Tone } from "@/ui/status";

const SHOWN = 100;
const TONE: Record<RowStatus, Tone> = { add: "success", existing: "neutral", repeated: "warning", too_long: "danger", too_short: "danger" };

/** Step 1: a file or a pasted list. Step 2: what would happen to each row. Then confirm. The names travel in this component, never in the address. */
export function ImportClients() {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const preview = result?.preview ?? null;

  const read = () => {
    if (!form.current) return;
    const data = new FormData(form.current);
    setMessage(null);
    startTransition(async () => setResult(await previewClientImportAction(data)));
  };
  const confirm = () => {
    if (!preview) return;
    startTransition(async () => {
      const r = await importClientsAction(preview.entries);
      setMessage({ ok: r.ok, text: r.message });
      if (r.ok) {
        setResult(null);
        form.current?.reset();
        router.refresh();
      }
    });
  };

  const rows: ImportRow[] = preview ? rowsToShow(preview.rows) : [];
  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-muted">
        You need a column of client names with a heading such as Client name, Client, Name, Company or Entity. Without a heading, the first column is used. Optional columns next to it, with headings such as Licence number, Licensing authority, TRN, Year end and Address, are read too; a value that does not fit is left out and named, and the client is still added. Upload an .xlsx or .csv file, or paste one name per line. A client that is already
        in LedgerFile is not added twice, and a name that appears twice in your list is added once.
      </p>
      <form ref={form} className="space-y-3" onSubmit={(e) => e.preventDefault()}>
        <Field label="Paste a list of names">
          <Textarea name="pasted" rows={5} placeholder={"Client name\nFalcon Trading LLC (sample)\nInvented Contracting LLC (sample)"} />
        </Field>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Or upload a file
          <input
            type="file"
            name="file"
            accept=".xlsx,.csv"
            className="text-sm font-normal text-ink file:mr-3 file:min-h-10 file:cursor-pointer file:rounded-md file:border file:border-border-strong file:bg-surface file:px-4 file:text-sm file:font-medium file:text-ink hover:file:bg-surface-muted"
          />
        </label>
        <Button type="button" variant="primary" onClick={read} disabled={pending}>
          Read the list
        </Button>
      </form>

      <div role="status" aria-live="polite" className="space-y-4">
        {message && <p className={`text-sm font-medium ${message.ok ? "text-success-strong" : "text-danger-strong"}`}>{message.text}</p>}
        {result && !result.ok && <p className="text-sm font-medium text-danger-strong">{result.message}</p>}
        {preview && (
          <>
            <p className="text-sm font-medium">{importSentence(preview.counts)}</p>
            {!preview.foundHeading && <Callout variant="info">No heading such as Client name was found, so the first column was used and every row counted as a name.</Callout>}
            {rows.length > 0 && (
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-sm" aria-label="What will happen to each row">
                {rows.slice(0, SHOWN).map((r) => (
                  <li key={`${r.line}-${r.name}`} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 px-3 py-2">
                    <span className="min-w-0 flex-1 break-words">
                      <span className="mr-2 text-ink-subtle tabular-nums">{r.line}</span>
                      {r.name.length > 200 ? `${r.name.slice(0, 200)}…` : r.name}
                      {r.details && Object.keys(r.details).length > 0 && (
                        <span className="mt-0.5 block text-ink-muted">
                          {Object.entries(r.details)
                            .map(([k, v]) => `${DETAIL_LABEL[k as keyof typeof DETAIL_LABEL]}: ${k === "yearEnd" ? yearEndText(String(v)) : String(v).split("\n").join(", ")}`)
                            .join(" · ")}
                        </span>
                      )}
                      {r.notes?.map((n) => (
                        <span key={n} className="mt-0.5 block text-warning-strong">
                          {n}
                        </span>
                      ))}
                    </span>
                    <Badge tone={TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                  </li>
                ))}
              </ul>
            )}
            {rows.length > SHOWN && <p className="text-sm text-ink-muted">Showing the first {SHOWN} rows, the ones to add first. The counts above cover all {rows.length.toLocaleString("en-US")}.</p>}
            {preview.names.length > 0 ? (
              <Button type="button" variant="primary" onClick={confirm} disabled={pending}>
                {confirmLabel(preview.names.length)}
              </Button>
            ) : (
              <p className="text-sm text-ink-muted">There is nothing new to add.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
