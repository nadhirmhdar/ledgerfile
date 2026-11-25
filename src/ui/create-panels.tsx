"use client";

import { useState, type ReactNode } from "react";
import { Button, LinkButton } from "./button";
import { PageHeader } from "./layout";

/**
 * The engagements page header with its two create buttons. Each button opens its existing form in a panel under the header;
 * only one is open at a time. The forms are passed in already built, so their actions are untouched.
 */
export function EngagementsHeader({ subtitle, engagementForm, clientForm, importHref, rollForwardHref }: { subtitle: string; engagementForm?: ReactNode; clientForm?: ReactNode; importHref?: string; rollForwardHref?: string }) {
  const [open, setOpen] = useState<"engagement" | "client" | null>(null);
  const toggle = (which: "engagement" | "client") => setOpen((o) => (o === which ? null : which));
  return (
    <>
      <PageHeader
        title="Engagements"
        subtitle={subtitle}
        actions={
          <>
            {engagementForm && (
              <Button variant="primary" aria-expanded={open === "engagement"} aria-controls="create-engagement" onClick={() => toggle("engagement")}>
                New engagement
              </Button>
            )}
            {clientForm && (
              <Button variant="secondary" aria-expanded={open === "client"} aria-controls="create-client" onClick={() => toggle("client")}>
                New client
              </Button>
            )}
            {rollForwardHref && (
              <LinkButton variant="secondary" href={rollForwardHref}>
                Roll forward to next year
              </LinkButton>
            )}
            {importHref && (
              <LinkButton variant="secondary" href={importHref}>
                Import clients
              </LinkButton>
            )}
          </>
        }
      />
      {open === "engagement" && engagementForm && (
        <div id="create-engagement" className="mt-4 rounded-lg border border-border bg-surface px-4 py-4 shadow-card sm:px-5">
          {engagementForm}
        </div>
      )}
      {open === "client" && clientForm && (
        <div id="create-client" className="mt-4 rounded-lg border border-border bg-surface px-4 py-4 shadow-card sm:px-5">
          {clientForm}
        </div>
      )}
    </>
  );
}
