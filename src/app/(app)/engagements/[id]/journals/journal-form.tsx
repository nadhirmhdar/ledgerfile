"use client";

import { useActionState, useState } from "react";
import { createJournalAction, type FormState } from "@/app/actions";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Field, Input, Select } from "@/ui/form";
import { balancePill, formatEntryAmount } from "@/ui/journal-entries-view";
import { Table, TCell, THead, TRow } from "@/ui/table";
import { plainCount } from "@/ui/text";

interface Line {
  accountId: string;
  debit: string;
  credit: string;
}

type State = FormState & { posted: number };
const initial: State = { ok: true, message: "", posted: 0 };
const blank = (): Line => ({ accountId: "", debit: "", credit: "" });

/** Loose client-side reading of an amount, only for the running totals; the server does the real parsing. */
function toNumber(text: string): number {
  const n = Number(text.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

type Props = { engagementId: string; accounts: { id: string; code: string; name: string }[] };

export function JournalForm(props: Props) {
  // Count successful posts: the fields are re-created (cleared) only after a success,
  // so a rejected entry keeps what the user typed.
  const [state, action, pending] = useActionState(async (prev: State, data: FormData): Promise<State> => {
    const result = await createJournalAction(prev, data);
    return { ...result, posted: prev.posted + (result.ok ? 1 : 0) };
  }, initial);
  return (
    <form action={action}>
      <Fields key={state.posted} pending={pending} message={state.message} ok={state.ok} {...props} />
    </form>
  );
}

function Fields({ engagementId, accounts, pending, message, ok }: Props & { pending: boolean; message: string; ok: boolean }) {
  const [lines, setLines] = useState<Line[]>([blank(), blank()]);
  const [type, setType] = useState("adjusting");
  const [description, setDescription] = useState("");

  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const debits = lines.reduce((s, l) => s + toNumber(l.debit), 0);
  const credits = lines.reduce((s, l) => s + toNumber(l.credit), 0);
  const balance = balancePill(debits, credits);

  return (
    <>
      <input type="hidden" name="engagementId" value={engagementId} />
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      <div className="flex flex-wrap gap-4">
        <Field label="Type" className="w-full sm:w-56">
          <Select name="type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="adjusting">Adjusting entry</option>
            <option value="reclassification">Reclassification</option>
          </Select>
        </Field>
        <Field label="Description" className="min-w-64 flex-1">
          <Input name="description" required minLength={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What the entry corrects and why" />
        </Field>
      </div>

      <Table className="mt-4" caption="Lines of the entry">
        <THead>
          <TRow>
            <TCell header="col">Account</TCell>
            <TCell header="col" numeric>
              Debit
            </TCell>
            <TCell header="col" numeric>
              Credit
            </TCell>
            <TCell header="col">
              <span className="sr-only">Remove</span>
            </TCell>
          </TRow>
        </THead>
        <tbody>
          {lines.map((l, i) => (
            <TRow key={i}>
              <TCell>
                <Select aria-label={`Line ${i + 1} account`} value={l.accountId} onChange={(e) => update(i, { accountId: e.target.value })} className="min-w-56">
                  <option value="">Choose an account</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} · {a.name}
                    </option>
                  ))}
                </Select>
              </TCell>
              <TCell numeric>
                <Input aria-label={`Line ${i + 1} debit`} inputMode="decimal" value={l.debit} onChange={(e) => update(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} className="min-w-32 text-right" />
              </TCell>
              <TCell numeric>
                <Input aria-label={`Line ${i + 1} credit`} inputMode="decimal" value={l.credit} onChange={(e) => update(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} className="min-w-32 text-right" />
              </TCell>
              <TCell>
                {lines.length > 2 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Remove line ${i + 1}`}>
                    Remove
                  </Button>
                )}
              </TCell>
            </TRow>
          ))}
          <TRow className="bg-surface-muted font-semibold">
            <TCell>
              <Button type="button" variant="secondary" size="sm" onClick={() => setLines((ls) => [...ls, blank()])}>
                Add line
              </Button>
            </TCell>
            <TCell numeric>{formatEntryAmount(debits)}</TCell>
            <TCell numeric>{formatEntryAmount(credits)}</TCell>
            <TCell />
          </TRow>
        </tbody>
      </Table>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button variant="primary" disabled={pending || balance.blocked !== null}>
          {pending ? "Posting…" : "Post entry"}
        </Button>
        <Badge tone={balance.tone}>{balance.label}</Badge>
        <span className="text-sm text-ink-muted">{balance.blocked ?? "Debits equal credits."}</span>
      </div>
      {message && (
        <p role="status" className={`mt-3 rounded-md border px-3 py-2 text-sm font-medium ${ok ? "border-success bg-success-soft text-success-strong" : "border-danger bg-danger-soft text-danger-strong"}`}>
          {plainCount(message)}
        </p>
      )}
    </>
  );
}

export function DeleteJournalButton({ label }: { label: string }) {
  return (
    <Button
      variant="danger"
      size="sm"
      onClick={(e) => {
        if (!window.confirm(`Delete ${label}? Its number will not be reused.`)) e.preventDefault();
      }}
    >
      Delete
    </Button>
  );
}
