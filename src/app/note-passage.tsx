"use client";

import { useState, useTransition } from "react";
import { buttonClass } from "@/ui/button";
import { Badge } from "@/ui/badge";
import { Callout } from "@/ui/feedback";
import { splitBrackets } from "@/ui/statements-view";
import { firmDefaultLabel } from "@/domain/statement-defaults";
import { carriedLabel, DRAFT_PASSAGE_LABEL, MAX_PARAGRAPH_LENGTH, MAX_PARAGRAPHS } from "@/domain/note-texts";
import { POLICY_REVIEW_NOTICE } from "@/domain/policies";
import { generatedNoteAction, restoreNoteAction, saveNoteAction } from "./note-actions";
import type { FormState } from "./actions";

export interface PassageVersion {
  version: number;
  paragraphs: string[];
  generated: boolean;
  by: string;
  at: string;
  source?: "person" | "firm_default" | "carried_forward" | null;
}

export interface PassageData {
  engagementId: string;
  noteKey: string;
  /** The words shown now: a person's where there are some, else the generated ones. */
  paragraphs: string[];
  /** The generated words, which may be none (a group note has no generated narrative). */
  generated: string[];
  /** A person's text is shown. */
  overridden: boolean;
  /** Who and when, for the current person's version. */
  current: { version: number; by: string; at: string; /** The wording was copied from the firm's statement defaults when the file was created. */ fromDefault?: boolean; /** The wording was carried forward from last year's file. */ carried?: boolean } | null;
  /** The period end of last year's file, for the label on a carried passage. */
  priorPeriodEnd?: string | null;
  history: PassageVersion[];
  /** The person may edit and the file is open. */
  canEdit: boolean;
  /** What to call the passage in the buttons' labels. */
  name: string;
}

/** Text with its [bracketed placeholders] marked. The words are unchanged, and line breaks inside a paragraph are kept. */
function Brackets({ text }: { text: string }) {
  return (
    <>
      {splitBrackets(text).map((p, i) =>
        p.placeholder ? (
          <mark key={i} className="rounded-sm bg-warning-soft px-1 text-warning-strong">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

const small = `${buttonClass("secondary", "sm")}`;

/**
 * One editable passage of the notes: its words, who last edited it (or the unreviewed-draft label when nobody has), and plain textareas to change it,
 * a history with restore, and a way back to the generated wording. The figures are never here. The server checks every rule again.
 */
export function NotePassage(p: PassageData) {
  const [mode, setMode] = useState<"view" | "edit" | "history">("view");
  const [draft, setDraft] = useState<string[]>(p.paragraphs.length > 0 ? p.paragraphs : [""]);
  const [message, setMessage] = useState<FormState | null>(null);
  const [pending, startTransition] = useTransition();

  const fields = (extra: Record<string, string>) => {
    const f = new FormData();
    f.set("engagementId", p.engagementId);
    f.set("noteKey", p.noteKey);
    for (const [k, v] of Object.entries(extra)) f.set(k, v);
    return f;
  };
  const call = (action: (prev: FormState, form: FormData) => Promise<FormState>, form: FormData, done: "view" | "stay") =>
    startTransition(async () => {
      const r = await action({ ok: true, message: "" }, form);
      setMessage(r);
      if (r.ok && done === "view") setMode("view");
    });
  const save = () => {
    const form = fields({});
    for (const t of draft) form.append("paragraph", t);
    call(saveNoteAction, form, "view");
  };
  const startEdit = () => {
    setDraft(p.paragraphs.length > 0 ? p.paragraphs : [""]);
    setMessage(null);
    setMode("edit");
  };

  const carriedText = (priorEnd?: string | null) => (priorEnd ? carriedLabel(priorEnd) : "Carried forward from last year");
  const label = p.overridden && p.current?.carried ? (
    <span className="text-small font-medium text-ink-subtle">{carriedText(p.priorPeriodEnd)}</span>
  ) : p.overridden && p.current?.fromDefault ? (
    <span className="text-small font-medium text-ink-subtle">{firmDefaultLabel(p.current.at.slice(0, 10))}</span>
  ) : p.overridden && p.current ? (
    <span className="text-small text-ink-subtle">
      Edited by {p.current.by} on {p.current.at}
    </span>
  ) : p.generated.length > 0 ? (
    <Badge tone="warning">{DRAFT_PASSAGE_LABEL}</Badge>
  ) : (
    <span className="text-small text-ink-subtle">No narrative yet</span>
  );

  return (
    <div data-passage={p.noteKey} className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {label}
        {p.canEdit && mode === "view" && (
          <button type="button" className={small} onClick={startEdit} aria-label={`Edit ${p.name}`}>
            {p.paragraphs.length > 0 ? "Edit" : "Add narrative"}
          </button>
        )}
        {p.history.length > 0 && mode === "view" && (
          <button type="button" className={small} onClick={() => setMode("history")} aria-label={`History of ${p.name}`}>
            History ({p.history.length})
          </button>
        )}
      </div>

      {mode !== "edit" &&
        p.paragraphs.map((t, i) =>
          t === POLICY_REVIEW_NOTICE ? (
            <Callout key={i} variant="draft">
              {t}
            </Callout>
          ) : (
            <p key={i} className="whitespace-pre-line">
              <Brackets text={t} />
            </p>
          ),
        )}

      {mode === "edit" && (
        <form
          className="space-y-3 rounded-md border border-border bg-surface-muted/40 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          {draft.map((t, i) => (
            <div key={i} className="space-y-1">
              <label className="text-small font-medium text-ink" htmlFor={`${p.noteKey}-${i}`}>
                Paragraph {i + 1}
              </label>
              <textarea
                id={`${p.noteKey}-${i}`}
                name="paragraph"
                value={t}
                rows={Math.min(12, Math.max(3, Math.ceil(t.length / 90) + t.split("\n").length - 1))}
                maxLength={MAX_PARAGRAPH_LENGTH + 200}
                onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? e.target.value : x)))}
                className="min-h-24 w-full rounded-md border border-border-input bg-surface px-3 py-2 text-sm text-ink"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`text-small ${t.length > MAX_PARAGRAPH_LENGTH ? "font-medium text-danger-strong" : "text-ink-subtle"}`}>
                  {t.length.toLocaleString("en-GB")} of {MAX_PARAGRAPH_LENGTH.toLocaleString("en-GB")} characters
                </span>
                <button type="button" className={small} disabled={draft.length <= 1} onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}>
                  Remove paragraph {i + 1}
                </button>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={small} disabled={draft.length >= MAX_PARAGRAPHS} onClick={() => setDraft((d) => [...d, ""])}>
              Add a paragraph
            </button>
            <button className={buttonClass("primary", "sm")} disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </button>
            <button type="button" className={small} disabled={pending} onClick={() => setMode("view")}>
              Cancel
            </button>
          </div>
          <p className="text-small text-ink-subtle">
            Plain text. Up to {MAX_PARAGRAPHS} paragraphs of {MAX_PARAGRAPH_LENGTH.toLocaleString("en-GB")} characters. Words in [square brackets] are shown as still to complete. The figures and note numbers are generated and cannot be edited here.
          </p>
        </form>
      )}

      {mode === "history" && (
        <div className="space-y-3 rounded-md border border-border bg-surface-muted/40 p-3">
          <ol className="space-y-3">
            {[...p.history].reverse().map((v) => {
              const latest = v.version === p.history[p.history.length - 1].version;
              return (
                <li key={v.version} className="space-y-1 border-b border-border pb-3 last:border-b-0 last:pb-0">
                  <p className="text-small font-medium text-ink">
                    Version {v.version}, {v.by}, {v.at}
                    {v.source === "carried_forward" && <span className="ml-2 font-normal text-ink-subtle">{carriedText(p.priorPeriodEnd)}</span>}
                    {latest && <span className="ml-2 font-normal text-ink-subtle">(current)</span>}
                  </p>
                  {v.generated ? (
                    <p className="text-ink-muted">Back to the generated wording.</p>
                  ) : (
                    v.paragraphs.map((t, i) => (
                      <p key={i} className="whitespace-pre-line text-ink-muted">
                        {t}
                      </p>
                    ))
                  )}
                  {p.canEdit && !latest && (
                    <button type="button" className={small} disabled={pending} onClick={() => call(restoreNoteAction, fields({ version: String(v.version) }), "stay")}>
                      Restore this version
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            {p.canEdit && p.overridden && (
              <button type="button" className={small} disabled={pending} onClick={() => call(generatedNoteAction, fields({}), "stay")}>
                Go back to the generated wording
              </button>
            )}
            <button type="button" className={small} onClick={() => setMode("view")}>
              Close the history
            </button>
          </div>
        </div>
      )}

      {mode === "view" && p.canEdit && p.overridden && (
        <button type="button" className="text-small text-accent underline underline-offset-2" disabled={pending} onClick={() => call(generatedNoteAction, fields({}), "stay")}>
          Go back to the generated wording
        </button>
      )}

      {message && (
        <p role="status" className={`text-small font-medium ${message.ok ? "text-success-strong" : "text-danger-strong"}`}>
          {message.message}
        </p>
      )}
    </div>
  );
}
