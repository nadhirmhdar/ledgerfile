"use client";

import { useActionState, useState } from "react";
import { archiveAction } from "./review-actions";
import type { FormState } from "./actions";
import { archiveConfirmationMatches } from "@/domain/archiving";
import { Button } from "@/ui/button";
import { Field, Input } from "@/ui/form";

const initial: FormState = { ok: true, message: "" };

/** Type the client's name to archive the file. The button stays off until the name matches; the server checks it again. */
export function ArchiveForm({ engagementId, clientName, blocker }: { engagementId: string; clientName: string; blocker: string | null }) {
  const [state, action, pending] = useActionState(archiveAction, initial);
  const [typed, setTyped] = useState("");
  const ready = blocker === null && archiveConfirmationMatches(typed, clientName);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="engagementId" value={engagementId} />
      <Field label="Type the client's name to confirm" hint={`The name is ${clientName}.`}>
        <Input name="confirmation" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" disabled={blocker !== null || pending} className="max-w-md" />
      </Field>
      <Button variant="danger" disabled={!ready || pending}>
        Archive permanently
      </Button>
      <div role="status" className="text-sm">
        {blocker && <p className="text-ink-muted">{blocker}</p>}
        {state.message && <p className={`font-medium ${state.ok ? "text-success-strong" : "text-danger-strong"}`}>{state.message}</p>}
      </div>
    </form>
  );
}
