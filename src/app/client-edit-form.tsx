"use client";

import { useActionState, startTransition } from "react";
import { DETAIL_LABEL, MAX_ADDRESS, MAX_AUTHORITY, MAX_CONTACT, MAX_EMAIL, MAX_LICENCE, MONTHS, type ClientDetails } from "@/domain/client-details";
import { MAX_NAME } from "@/domain/client-import";
import { buttonClass } from "@/ui/button";
import { Field, Input, Select, Textarea } from "@/ui/form";
import { plainCount } from "@/ui/text";
import { updateClientAction } from "./client-actions";
import type { FormState } from "./actions";

const initial: FormState = { ok: true, message: "" };

/**
 * The client's details form. The values stay in the form when a check fails, so nothing a person typed is lost (a form action would reset the form after
 * every submit). The server checks every value again.
 */
export function ClientEditForm({ client }: { client: ClientDetails & { id: string; name: string } }) {
  const [state, run, pending] = useActionState(updateClientAction, initial);
  const [month, day] = client.yearEnd ? client.yearEnd.split("-") : ["", ""];
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => run(data));
      }}
    >
      <input type="hidden" name="clientId" value={client.id} />
      <fieldset disabled={pending} className="contents">
        <div className="space-y-4">
          <Field label="Name">
            <Input name="name" defaultValue={client.name} required maxLength={MAX_NAME} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={DETAIL_LABEL.licenceNumber}>
              <Input name="licenceNumber" defaultValue={client.licenceNumber ?? ""} maxLength={MAX_LICENCE} />
            </Field>
            <Field label={DETAIL_LABEL.licensingAuthority}>
              <Input name="licensingAuthority" defaultValue={client.licensingAuthority ?? ""} maxLength={MAX_AUTHORITY} />
            </Field>
            <Field label={DETAIL_LABEL.taxRegistrationNumber} hint="15 digits">
              <Input name="taxRegistrationNumber" defaultValue={client.taxRegistrationNumber ?? ""} inputMode="numeric" maxLength={20} />
            </Field>
            <div className="flex gap-3">
              <Field label="Year-end month" className="flex-1">
                <Select name="yearEndMonth" defaultValue={month ? String(Number(month)) : ""}>
                  <option value="">Not set</option>
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Day" className="w-24">
                <Input name="yearEndDay" defaultValue={day ? String(Number(day)) : ""} inputMode="numeric" maxLength={2} />
              </Field>
            </div>
          </div>
          <Field label={DETAIL_LABEL.address}>
            <Textarea name="address" defaultValue={client.address ?? ""} rows={3} maxLength={MAX_ADDRESS + 40} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={DETAIL_LABEL.contactName}>
              <Input name="contactName" defaultValue={client.contactName ?? ""} maxLength={MAX_CONTACT} />
            </Field>
            <Field label={DETAIL_LABEL.contactEmail}>
              <Input name="contactEmail" type="email" defaultValue={client.contactEmail ?? ""} maxLength={MAX_EMAIL} />
            </Field>
          </div>
          <button className={buttonClass("primary")} disabled={pending}>
            {pending ? "Saving…" : "Save the details"}
          </button>
        </div>
      </fieldset>
      {state.message && (
        <div role="status" className={`mt-3 text-sm font-medium ${state.ok ? "text-success-strong" : "text-danger-strong"}`}>
          <p>{plainCount(state.message)}</p>
          {state.details && state.details.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {state.details.map((d) => (
                <li key={d}>{plainCount(d)}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
