"use client";

import { useActionState, useRef, useState } from "react";
import { buttonClass } from "@/ui/button";
import { Field, Input, Select } from "@/ui/form";
import { plainCount } from "@/ui/text";
import { ROLES, ROLE_LABEL } from "@/domain/tb-layout";
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
 * Upload a trial balance. The file is kept here, in the component, because a form action empties a file input: when the columns have to be chosen the
 * second submit sends the same file again without choosing it twice. The server reads the file again either way and only takes the choice from the form.
 */
export function UploadForm({ engagementId, hasAccounts }: { engagementId: string; hasAccounts: boolean }) {
  const [state, action, pending] = useActionState(uploadTrialBalanceAction, initial);
  const [file, setFile] = useState<File | null>(null);
  const [dismissed, setDismissed] = useState<FormState | null>(null);
  const ask = useRef(false);
  const preview = state.preview && dismissed !== state ? state.preview : null;
  const submit = (form: FormData) => {
    if (file) form.set("file", file);
    if (ask.current) form.set("chooseColumns", "1");
    ask.current = false;
    action(form);
  };
  return (
    <form action={submit}>
      <input type="hidden" name="engagementId" value={engagementId} />
      {preview ? (
        <div>
          <p className="text-sm font-medium text-ink">Say which column is which in {preview.fileName}</p>
          <p className="mt-1 text-sm text-ink-muted">Choose the heading row, then a role for each column you want. Leave the others as Ignore. You need an account code or name, and a Debit and a Credit column or one Balance column.</p>
          <input type="hidden" name="sheet" value={preview.sheet} />
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-ink">
              Heading row
              <select name="headerRow" defaultValue={preview.headerRow} className="min-h-10 rounded-md border border-border-strong bg-surface px-3 text-sm font-normal text-ink">
                {preview.rows.map((r) => (
                  <option key={r.index} value={r.index}>
                    Row {r.index + 1}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-3 max-w-full overflow-x-auto rounded-md border border-border">
            <table className="min-w-max border-collapse text-sm">
              <thead>
                <tr>
                  <th scope="col" className="border-b border-border bg-surface-muted px-2 py-2 text-left font-medium text-ink-muted">
                    Row
                  </th>
                  {Array.from({ length: preview.columnCount }, (_, c) => (
                    <th key={c} scope="col" className="border-b border-l border-border bg-surface-muted px-2 py-2 text-left font-medium text-ink">
                      <select name={`role_${c}`} aria-label={`Role of column ${columnName(c)}`} defaultValue={preview.selected[c] ?? ""} className="min-h-10 w-36 rounded-md border border-border-strong bg-surface px-2 text-sm font-normal text-ink">
                        <option value="">Ignore</option>
                        {ROLES.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABEL[role]}
                          </option>
                        ))}
                      </select>
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
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className={buttonClass("primary")} disabled={pending}>
              {pending ? "Importing…" : "Import with these columns"}
            </button>
            <button
              type="button"
              className={buttonClass("secondary")}
              onClick={() => {
                setFile(null);
                setDismissed(state);
              }}
            >
              Choose another file
            </button>
            <TemplateLink />
          </div>
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
                onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)}
                className="text-sm font-normal text-ink file:mr-3 file:min-h-10 file:cursor-pointer file:rounded-md file:border file:border-border-strong file:bg-surface file:px-4 file:text-sm file:font-medium file:text-ink hover:file:bg-surface-muted"
              />
            </label>
            <button className={buttonClass("primary")} disabled={pending}>
              {pending ? "Importing…" : hasAccounts ? "Replace trial balance" : "Import trial balance"}
            </button>
            <button
              className={buttonClass("secondary")}
              disabled={pending}
              onClick={() => {
                ask.current = true;
              }}
            >
              Choose columns
            </button>
          </div>
          <p className="mt-2 text-sm text-ink-muted">
            Needs a column for account code or name, and either Debit and Credit columns or one Balance column. A Prior Year column is optional. If the columns are not found, or you want to say which is which, choose them: they are remembered for this client.
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
