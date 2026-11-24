"use client";

import { useActionState, useRef, useState } from "react";
import { buttonClass } from "@/ui/button";
import { Field, Input, Select } from "@/ui/form";
import { plainCount } from "@/ui/text";
import { ROLES, ROLE_LABEL } from "@/domain/tb-layout";
import { formatAmount } from "@/domain/money";
import { TEMPLATE_LINK_TEXT, TEMPLATE_URL } from "@/domain/tb-template";
import { createClientAction, createEngagementAction, setMappingAction, uploadTrialBalanceAction, type FormState } from "./actions";

const initial: FormState = { ok: true, message: "" };

/** The LedgerFile trial balance template: an .xlsx with fixed headings that is always read with certainty. */
function TemplateLink() {
  return (
    <a href={TEMPLATE_URL} download className="font-medium text-accent underline-offset-2 hover:underline">
      {TEMPLATE_LINK_TEXT}
    </a>
  );
}

function Feedback({ state }: { state: FormState }) {
  if (!state.message) return null;
  return (
    <div role="status" className={`mt-3 rounded-md border px-3 py-2 text-sm ${state.ok ? "border-success bg-success-soft text-success-strong" : "border-danger bg-danger-soft text-danger-strong"}`}>
      <p className="font-medium">{plainCount(state.message)}</p>
      {state.details && state.details.length > 0 && (
        <ul className="mt-2 list-disc pl-5">
          {state.details.map((d) => (
            <li key={d}>{plainCount(d)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function NewClientForm() {
  const [state, action, pending] = useActionState(createClientAction, initial);
  return (
    <form action={action}>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Client name" className="w-full sm:w-72">
          <Input name="name" required maxLength={200} />
        </Field>
        <button className={buttonClass("primary")} disabled={pending}>Add client</button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function NewEngagementForm({ clients }: { clients: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createEngagementAction, initial);
  return (
    <form action={action}>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Client" className="w-full sm:w-72">
          <Select name="clientId" required defaultValue="">
            <option value="" disabled>Choose a client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Period start" className="w-full sm:w-44">
          <Input type="date" name="periodStart" required />
        </Field>
        <Field label="Period end" className="w-full sm:w-44">
          <Input type="date" name="periodEnd" required />
        </Field>
        <button className={buttonClass("primary")} disabled={pending}>Create engagement</button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

const columnName = (c: number) => (c < 26 ? String.fromCharCode(65 + c) : `${c + 1}`);

/**
 * Upload a trial balance, always through a preview. The first step reads the file and shows what an import would do (the sheet, the heading row, a role
 * for each column, the rows left out and why, the totals and whether it balances, how sure the reading is and where the columns came from) and saves
 * nothing. Import saves. Changing a role reads the file again with that choice. A guess of low confidence has to be confirmed by ticking a box. The file is
 * kept here, in the component, because a form action empties a file input; the server reads the file again on every step and takes from the form only the
 * columns a person changed, so what is imported is what the preview read.
 */
export function UploadForm({ engagementId, hasAccounts }: { engagementId: string; hasAccounts: boolean }) {
  const [state, action, pending] = useActionState(uploadTrialBalanceAction, initial);
  const [file, setFile] = useState<File | null>(null);
  const [dismissed, setDismissed] = useState<FormState | null>(null);
  const [changed, setChanged] = useState(false);
  const ask = useRef(false);
  const step = useRef<"preview" | "import">("preview");
  const preview = state.preview && dismissed !== state ? state.preview : null;
  const review = preview?.review ?? null;
  const locked = preview?.locked === true;
  // The columns are the person's own once they have changed one, when the server says so, or when there is no reading to take them from (the chooser).
  const edited = changed || preview?.edited === true || (preview !== null && !review && !locked);
  const submit = (form: FormData) => {
    if (file) form.set("file", file);
    if (ask.current) form.set("chooseColumns", "1");
    ask.current = false;
    form.set("intent", step.current);
    step.current = "preview";
    action(form);
  };
  const reread = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setChanged(true);
    step.current = "preview";
    const form = e.currentTarget.form;
    // The preview is read again with the new choice. Two frames, so the flag above is in the form first.
    requestAnimationFrame(() => form?.requestSubmit());
  };
  const ready = review !== null && review.errors.length === 0 && review.balanced;
  return (
    <form action={submit}>
      <input type="hidden" name="engagementId" value={engagementId} />
      {preview ? (
        <div>
          <p className="text-sm font-medium text-ink">
            {review ? "Check the import of" : "Say which column is which in"} {preview.fileName}
          </p>
          <input type="hidden" name="sheet" value={preview.sheet} />
          {edited && <input type="hidden" name="edited" value="1" />}
          {review?.mustConfirm && <input type="hidden" name="low" value="1" />}
          {review && (
            <div className="mt-3 space-y-3" aria-live="polite">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-ink-muted">Columns</dt>
                  <dd className="font-medium">{review.source}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Sheet</dt>
                  <dd className="font-medium">{review.sheetName}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Accounts</dt>
                  <dd className="font-medium">{review.accounts}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Balance check</dt>
                  <dd className="font-medium">{review.balanced ? "Balances: debits equal credits" : review.accounts === 0 ? "No accounts read" : `Does not balance: out by ${formatAmount(Math.abs(review.differenceMinor))}`}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Total debits</dt>
                  <dd className="font-medium tabular-nums">{formatAmount(review.debitMinor)}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Total credits</dt>
                  <dd className="font-medium tabular-nums">{formatAmount(review.creditMinor)}</dd>
                </div>
              </dl>
              {review.confidence && (
                <div className="text-sm">
                  <p>
                    <span className="text-ink-muted">Confidence:</span> <span className="font-medium">{review.confidence.level}</span>
                    {review.confidence.level === "low" ? " (a guess: check the columns below)" : ""}
                  </p>
                  {review.confidence.reasons.length > 0 && (
                    <ul className="mt-1 list-disc pl-5 text-ink-muted">
                      {review.confidence.reasons.map((r) => (
                        <li key={r}>{plainCount(r)}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {review.errors.length > 0 && (
                <ul className="list-disc rounded-md border border-danger bg-danger-soft py-2 pl-7 pr-3 text-sm text-danger-strong">
                  {review.errors.map((r) => (
                    <li key={r}>{plainCount(r)}</li>
                  ))}
                </ul>
              )}
              {review.warnings.length > 0 && (
                <ul className="list-disc pl-5 text-sm text-ink-muted">
                  {review.warnings.map((r) => (
                    <li key={r}>{plainCount(r)}</li>
                  ))}
                </ul>
              )}
              {review.skipped.length > 0 && (
                <details className="rounded-md border border-border px-3 py-2 text-sm">
                  <summary className="cursor-pointer font-medium">
                    {review.skipped.length} row{review.skipped.length === 1 ? "" : "s"} left out
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {review.skipped.map((k) => (
                      <li key={k.row}>
                        Row {k.row}: {k.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          {locked ? (
            <p className="mt-3 text-sm text-ink-muted">These are the LedgerFile template&apos;s own columns, so there is nothing to choose.</p>
          ) : (
            <p className="mt-3 text-sm text-ink-muted">
              {review ? "The columns are shown below. Change a role if the reading is wrong: the preview is read again with your choice." : "Choose the heading row, then a role for each column you want. Leave the others as Ignore."} You need an account code or name (or one Code and name column), and a Debit and a Credit column or one Balance column.
            </p>
          )}
          {!locked && (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                Heading row
                <select name="headerRow" defaultValue={preview.headerRow} onChange={reread} className="min-h-10 rounded-md border border-border-strong bg-surface px-3 text-sm font-normal text-ink">
                  {preview.rows.map((r) => (
                    <option key={r.index} value={r.index}>
                      Row {r.index + 1}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <div className="mt-3 max-w-full overflow-x-auto rounded-md border border-border">
            <table className="min-w-max border-collapse text-sm">
              <thead>
                <tr>
                  <th scope="col" className="border-b border-border bg-surface-muted px-2 py-2 text-left font-medium text-ink-muted">
                    Row
                  </th>
                  {Array.from({ length: preview.columnCount }, (_, c) => (
                    <th key={c} scope="col" className="border-b border-l border-border bg-surface-muted px-2 py-2 text-left font-medium text-ink">
                      {locked ? (
                        <span className="font-normal">{preview.selected[c] ? ROLE_LABEL[preview.selected[c] as keyof typeof ROLE_LABEL] : "Not read"}</span>
                      ) : (
                        <select name={`role_${c}`} aria-label={`Role of column ${columnName(c)}`} defaultValue={preview.selected[c] ?? ""} onChange={reread} className="min-h-10 w-36 rounded-md border border-border-strong bg-surface px-2 text-sm font-normal text-ink">
                          <option value="">Ignore</option>
                          {ROLES.map((role) => (
                            <option key={role} value={role}>
                              {ROLE_LABEL[role]}
                            </option>
                          ))}
                        </select>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.index}>
                    <th scope="row" className="border-b border-border px-2 py-1.5 text-left font-normal text-ink-muted">
                      {r.index + 1}
                    </th>
                    {Array.from({ length: preview.columnCount }, (_, c) => (
                      <td key={c} className="max-w-48 truncate border-b border-l border-border px-2 py-1.5 text-ink">
                        {r.cells[c] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {review?.mustConfirm && (
            <label className="mt-3 flex items-start gap-2 text-sm">
              <input type="checkbox" name="confirmLow" value="1" required className="mt-1 size-4" />
              <span>I have checked the columns and the totals above, and they are right.</span>
            </label>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              className={buttonClass("primary")}
              disabled={pending || (review !== null && !ready && !review.mustConfirm)}
              onClick={() => {
                step.current = "import";
              }}
            >
              {pending ? "Working…" : hasAccounts ? "Replace the trial balance" : "Import"}
            </button>
            {!locked && (
              <button
                className={buttonClass("secondary")}
                disabled={pending}
                onClick={() => {
                  step.current = "preview";
                }}
                formNoValidate
              >
                {review ? "Update the preview" : "Preview with these columns"}
              </button>
            )}
            <button
              type="button"
              className={buttonClass("secondary")}
              onClick={() => {
                setFile(null);
                setChanged(false);
                setDismissed(state);
              }}
            >
              Choose another file
            </button>
            <TemplateLink />
          </div>
          {review && !ready && !review.mustConfirm && <p className="mt-2 text-sm text-ink-muted">Import is off until the file has no errors and balances. Change a column above, or choose another file.</p>}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-ink">
              Trial balance file (.xlsx or .csv)
              {file && <span className="font-normal text-ink-muted">Using {file.name}</span>}
              <input
                type="file"
                name="file"
                accept=".xlsx,.csv"
                required={!file}
                onChange={(e) => {
                  setFile(e.currentTarget.files?.[0] ?? null);
                  setChanged(false);
                }}
                className="text-sm font-normal text-ink file:mr-3 file:min-h-10 file:cursor-pointer file:rounded-md file:border file:border-border-strong file:bg-surface file:px-4 file:text-sm file:font-medium file:text-ink hover:file:bg-surface-muted"
              />
            </label>
            <button
              className={buttonClass("primary")}
              disabled={pending}
              onClick={() => {
                step.current = "preview";
              }}
            >
              {pending ? "Reading…" : hasAccounts ? "Preview the replacement" : "Preview the import"}
            </button>
            <button
              className={buttonClass("secondary")}
              disabled={pending}
              onClick={() => {
                ask.current = true;
                step.current = "preview";
              }}
            >
              Choose columns
            </button>
          </div>
          <p className="mt-2 text-sm text-ink-muted">
            Needs a column for account code or name, and either Debit and Credit columns or one Balance column. A Prior Year column is optional. You see what would be imported, and can change the columns, before anything is saved. If the columns are not found, or you want to say which is which, choose them: they are remembered for this client.
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            Or fill in our own format, which is always read as it is: <TemplateLink />. Its example rows are ignored when you upload.
          </p>
        </>
      )}
      <Feedback state={state} />
      {!state.ok && state.message && (
        <p className="mt-2 text-sm">
          <TemplateLink />
        </p>
      )}
    </form>
  );
}

export function MappingSelect({
  engagementId,
  accountId,
  value,
  groups,
  label = "Group",
}: {
  engagementId: string;
  accountId: string;
  value: string | null;
  groups: { code: string; name: string }[];
  /** The accessible name, so each row's control is announced with its account. */
  label?: string;
}) {
  return (
    <form action={setMappingAction}>
      <input type="hidden" name="engagementId" value={engagementId} />
      <input type="hidden" name="accountId" value={accountId} />
      <select
        name="groupCode"
        aria-label={label}
        defaultValue={value ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className={`min-h-10 w-full rounded-md border bg-surface px-3 py-1.5 text-sm text-ink sm:w-80 ${value ? "border-border-strong" : "border-warning bg-warning-soft"}`}
      >
        <option value="">Not mapped</option>
        {groups.map((g) => (
          <option key={g.code} value={g.code}>{g.name}</option>
        ))}
      </select>
    </form>
  );
}
