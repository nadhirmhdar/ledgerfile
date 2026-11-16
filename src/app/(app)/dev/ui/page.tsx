import { notFound } from "next/navigation";
import { Badge, StatusBadge } from "@/ui/badge";
import { Button, LinkButton } from "@/ui/button";
import { Callout, EmptyState, ProgressBar, StepList } from "@/ui/feedback";
import { Field, Input, Select, Textarea } from "@/ui/form";
import { Card, ListRow, ListRows, PageHeader, Section, Stat } from "@/ui/layout";
import { STATUS_LABEL, type Status } from "@/ui/status";
import { Table, TCell, THead, TRow } from "@/ui/table";
import { count } from "@/ui/text";

export const dynamic = "force-dynamic";

const STATUSES = Object.keys(STATUS_LABEL) as Status[];

/** Every shared component in every state, for review. Development only: it does not exist in a production build. */
export default function UiGallery() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="space-y-10 py-8 text-ink">
      <PageHeader
        breadcrumb={[{ label: "Engagements", href: "/" }]}
        meta={<Badge tone="muted">Development only</Badge>}
        title="UI components"
        subtitle="Every shared component and state. This page is not linked from the app and is not served in production."
        actions={<Button variant="primary">Primary action</Button>}
      />

      <Section title="Buttons" description="One primary button per area. Danger is never beside the primary one.">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Delete</Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <Button variant="secondary" size="sm">
            Small
          </Button>
          <LinkButton href="/dev/ui" variant="secondary">
            Link button
          </LinkButton>
        </div>
      </Section>

      <Section title="Status" description="A soft pill with an icon and a word, from one fixed vocabulary. Never colour alone.">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {STATUSES.map((s) => (
            <li key={s} className="rounded-lg border border-border bg-surface px-3 py-2">
              <StatusBadge status={s} />
            </li>
          ))}
          <li className="rounded-lg border border-border bg-surface px-3 py-2">
            <StatusBadge status="done" label="Ready to lock" />
          </li>
          <li className="rounded-lg border border-border bg-surface px-3 py-2">
            <Badge tone="info">Audit on</Badge>
          </li>
        </ul>
      </Section>

      <Section title="Callouts">
        <div className="space-y-3">
          <Callout variant="info" title="Information">
            Something worth knowing that does not stop the work.
          </Callout>
          <Callout variant="warning" title="Warning">
            Something to look at before going on.
          </Callout>
          <Callout variant="danger" title="Problem">
            Something went wrong and needs fixing.
          </Callout>
          <Callout variant="draft" title="AI draft: not reviewed">
            Written by a machine. A person has to check it before it is relied on.
          </Callout>
          <Callout variant="locked" title="This engagement is locked">
            Changes are refused until a partner unlocks it.
          </Callout>
        </div>
      </Section>

      <Section title="Cards, rows and figures">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="A card" description="Header, body and an optional footer." actions={<Button size="sm">Action</Button>} footer="Footer text sits on a muted band.">
            Body text in a white panel with a 1 px border.
          </Card>
          <ListRows>
            <ListRow title="Falcon Trading LLC" subtitle="Year to 31 December 2025" meta="12 papers" href="/dev/ui" />
            <ListRow title="Harbour Logistics" subtitle="Year to 30 June 2025" meta={<StatusBadge status="locked" />} />
            <ListRow title="Oasis Foods" subtitle="Year to 31 March 2026" meta="3 open" href="/dev/ui" />
          </ListRows>
        </div>
        <ul className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <li>
            <Stat label="Papers reviewed" value="12 of 40" />
          </li>
          <li>
            <Stat label="Open client requests" value="7" hint="2 overdue" href="/dev/ui" />
          </li>
          <li>
            <Stat label="Awaiting a reply" value="3" />
          </li>
          <li>
            <Stat label="Open review points" value="0" />
          </li>
        </ul>
      </Section>

      <Section title="Table" description="Real tables are for figures. Numbers are right-aligned with tabular figures.">
        <Table caption="Example lead sheet figures">
          <THead>
            <TRow>
              <TCell header="col">Account</TCell>
              <TCell header="col" numeric>
                Closing
              </TCell>
              <TCell header="col" numeric>
                Prior year
              </TCell>
            </TRow>
          </THead>
          <tbody>
            <TRow>
              <TCell header="row">Trade receivables</TCell>
              <TCell numeric>1,204,500.00</TCell>
              <TCell numeric>980,250.00</TCell>
            </TRow>
            <TRow>
              <TCell header="row">Cash at bank</TCell>
              <TCell numeric>(52,300.00)</TCell>
              <TCell numeric>12,010.00</TCell>
            </TRow>
          </tbody>
        </Table>
      </Section>

      <Section title="Form controls" description="Every input has a visible label. Hints and errors are read with the input.">
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client name" hint="As it appears on the signed statements.">
              <Input name="client" placeholder="Falcon Trading LLC" />
            </Field>
            <Field label="Period end" error="Enter a date in the form 2025-12-31.">
              <Input name="end" defaultValue="31/12/2025" />
            </Field>
            <Field label="Role">
              <Select name="role" defaultValue="reviewer">
                <option value="preparer">Preparer</option>
                <option value="reviewer">Reviewer</option>
                <option value="partner">Partner</option>
              </Select>
            </Field>
            <Field label="Rationale">
              <Textarea name="why" />
            </Field>
          </div>
        </Card>
      </Section>

      <Section title="Progress and steps">
        <div className="max-w-md space-y-3">
          <ProgressBar value={2} max={5} label="Setup" />
          <ProgressBar value={5} max={5} label="Review" tone="success" />
        </div>
        <div className="mt-4">
          <StepList
            steps={[
              { key: "a", title: "Set up", status: "done", done: 3, total: 3, summary: `${count(42, "account")} imported, mapped and checked.`, href: "/dev/ui" },
              { key: "b", title: "Plan", status: "in_progress", done: 2, total: 4, summary: "Materiality set. Risks not assessed yet.", href: "/dev/ui" },
              { key: "c", title: "Fieldwork", status: "not_applicable", statusLabel: "Not being audited", done: 0, total: 0, summary: "The audit is off.", href: "/dev/ui" },
              { key: "d", title: "Finish", status: "locked", done: 1, total: 1, summary: "Locked on 2026-11-02 by A. Partner.", href: "/dev/ui" },
            ]}
          />
        </div>
      </Section>

      <Section title="Empty state">
        <EmptyState
          title="No trial balance yet"
          description="Import the client's trial balance to begin."
          action={
            <LinkButton href="/dev/ui" variant="primary">
              Import the trial balance
            </LinkButton>
          }
        />
      </Section>
    </div>
  );
}
