import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import { listRequests, requestCounts } from "@/server/client-requests";
import { listWorkingPapers } from "@/server/working-papers";
import { AREAS } from "@/domain/audit";
import { REQUEST_DEFAULTS_STATUS } from "@/domain/client-request-defaults";
import { todayIso } from "@/domain/client-requests";
import { ActionForm } from "@/app/action-form";
import {
  addRequestAction,
  addStandardRequestsAction,
  bringForwardRequestsAction,
  deleteRequestAction,
  editRequestAction,
  linkFileAction,
  markNotApplicableAction,
  markReceivedAction,
  reopenRequestAction,
  unlinkFileAction,
} from "@/app/request-actions";
import { Badge } from "@/ui/badge";
import { Button, LinkButton } from "@/ui/button";
import { ctl, Disclosure, fieldLabel } from "@/ui/controls";
import { Callout, EmptyState } from "@/ui/feedback";
import { Card, PageHeader, Section, Stat } from "@/ui/layout";
import { filterRequests, parseAreaFilter, parseSearch, parseStatus, requestMeta, requestResults, requestsSentence, rowControls, statusCounts, STATUS_PILL, type StatusFilter } from "@/ui/request-view";
import { count } from "@/ui/text";
import { TwoLineRow } from "@/ui/two-line-row";
import { EngagementNav } from "../nav";

export const dynamic = "force-dynamic";

type Query = Record<string, string | string[] | undefined>;

export default async function RequestsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const query = await searchParams;
  const statusFilter = parseStatus(query.status);
  const areaFilter = parseAreaFilter(query.area);
  const q = parseSearch(query.q);

  const session = await getSession();
  const today = todayIso();
  const { engagement, all, counts, papers } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    engagement: await repo.getEngagement(tx, id),
    all: await listRequests(tx, id, today),
    counts: await requestCounts(tx, id, today),
    papers: await listWorkingPapers(tx, id),
  }));
  if (!engagement) notFound();

  const open = engagement.status === "open";
  const base = `/engagements/${id}/requests`;
  const view = filterRequests(all, { status: statusFilter, area: areaFilter, q });
  const chips = statusCounts(all, { area: areaFilter, q });
  const link = (status: StatusFilter) => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (areaFilter) p.set("area", areaFilter);
    if (q) p.set("q", q);
    const str = p.toString();
    return `${base}${str ? `?${str}` : ""}`;
  };
  // The tiles use the chips' counts (the chosen area and search), so the two never disagree.
  const c = chips;

  const chipList: { key: StatusFilter; label: string; n: number }[] = [
    { key: "", label: "All", n: chips.all },
    { key: "open", label: "Open", n: chips.open },
    { key: "overdue", label: "Overdue", n: chips.overdue },
    { key: "received", label: "Received", n: chips.received },
    { key: "not_applicable", label: "Not applicable", n: chips.notApplicable },
  ];

  return (
    <div className="py-8 text-ink">
      <PageHeader
        breadcrumb={[{ label: "All engagements", href: "/" }]}
        title="Client requests"
        meta={
          <>
            <span>{engagement.clientName}</span>
            <span aria-hidden="true">·</span>
            <span>
              {engagement.periodStart} to {engagement.periodEnd}
            </span>
          </>
        }
        subtitle={requestsSentence(counts.overall)}
        actions={
          <a href={`${base}/export`} className="inline-flex min-h-10 items-center justify-center rounded-md border border-border-strong bg-surface px-4 text-sm font-medium whitespace-nowrap text-ink hover:bg-surface-muted">
            Download as Excel
          </a>
        }
      />
      <EngagementNav id={id} current="requests" status={engagement.status} />

      <div className="mt-6 space-y-6">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Summary">
          <li>
            <Stat label="Open" value={c.open} href={link("open")} />
          </li>
          <li>
            <Stat label="Overdue" value={c.overdue > 0 ? <Badge tone="danger">{c.overdue}</Badge> : c.overdue} href={link("overdue")} />
          </li>
          <li>
            <Stat label="Received" value={c.received} href={link("received")} />
          </li>
          <li>
            <Stat label="Not applicable" value={c.notApplicable} href={link("not_applicable")} />
          </li>
        </ul>

        {open && (
          <>
            <Card title="Add a request">
              <ActionForm action={addRequestAction} fields={{ engagementId: id }}>
                <div className="flex flex-wrap items-end gap-3">
                  <label className={`${fieldLabel} min-w-72 flex-1`}>
                    What is needed
                    <input name="description" required maxLength={500} placeholder="For example: Bank statements for March" className={ctl} />
                  </label>
                  <label className={fieldLabel}>
                    Area
                    <select name="areaCode" className={ctl} defaultValue={areaFilter && areaFilter !== "general" ? areaFilter : ""}>
                      <option value="">General</option>
                      {AREAS.map((a) => (
                        <option key={a.code} value={a.code}>
                          {a.code} {a.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={fieldLabel}>
                    Due
                    <input type="date" name="dueOn" className={ctl} />
                  </label>
                  <Button variant="primary">Add request</Button>
                </div>
              </ActionForm>
            </Card>

            <Disclosure summary="Set up the list">
              <div className="flex flex-wrap gap-x-10 gap-y-6">
                <ActionForm action={addStandardRequestsAction} fields={{ engagementId: id }} className="max-w-md">
                  <Button variant="secondary">Add the standard requests</Button>
                  <p className="mt-2 text-sm text-ink-muted">Adds general requests, and those for each audit area with a balance on the trial balance. Wording already on the list is skipped.</p>
                  <Callout variant="draft" title={`Standard wording: ${REQUEST_DEFAULTS_STATUS}`} className="mt-2">
                    Read it before sending it to a client.
                  </Callout>
                </ActionForm>
                {engagement.priorEngagementId && (
                  <ActionForm action={bringForwardRequestsAction} fields={{ engagementId: id }} className="max-w-md">
                    <Button variant="secondary">Bring forward last year&apos;s requests</Button>
                    <p className="mt-2 text-sm text-ink-muted">Copies each request from the prior-year engagement as open, dated today, with no due date. Ones already brought forward, or already on the list, are skipped.</p>
                  </ActionForm>
                )}
              </div>
            </Disclosure>
          </>
        )}

        {all.length === 0 ? (
          <EmptyState
            title="No requests yet"
            description="This is the list of documents and information asked of the client, when each is due, and the received files that answer it."
            action={open ? <p className="text-sm text-ink-muted">Add a request above, or open Set up the list to add the standard requests.</p> : undefined}
          />
        ) : (
          <Section title="Requests">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <nav aria-label="Filter requests">
                <ul className="flex flex-wrap gap-2">
                  {chipList.map((chip) => {
                    const active = statusFilter === chip.key;
                    return (
                      <li key={chip.key || "all"}>
                        <Link
                          href={link(chip.key)}
                          aria-current={active ? "true" : undefined}
                          className={`inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-medium ${active ? "border-accent bg-accent text-surface" : "border-border-strong bg-surface text-ink hover:bg-surface-muted"}`}
                        >
                          {chip.label} {chip.n}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>
              <form action={base} method="get" role="search" className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
                {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
                <label className={fieldLabel}>
                  Area
                  <select name="area" defaultValue={areaFilter} className={`${ctl} w-full sm:w-64`}>
                    <option value="">All areas</option>
                    <option value="general">General</option>
                    {AREAS.map((a) => (
                      <option key={a.code} value={a.code}>
                        {a.code} {a.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={fieldLabel}>
                  Search
                  <input name="q" type="search" defaultValue={q} placeholder="Reference or wording" className={`${ctl} w-full sm:w-52`} />
                </label>
                <Button variant="secondary">Show</Button>
              </form>
            </div>
            <p role="status" className="mt-3 text-sm text-ink-muted">
              {requestResults(view.shown, view.total)}
            </p>

            {view.rows.length === 0 ? (
              <div className="mt-3">
                <EmptyState
                  title="No requests match"
                  description="Nothing fits this filter and search."
                  action={
                    <LinkButton href={base} variant="secondary">
                      Show all
                    </LinkButton>
                  }
                />
              </div>
            ) : (
              <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface shadow-card">
                {view.rows.map((r) => {
                  const unlinked = papers.filter((p) => !r.files.some((f) => f.id === p.id));
                  const ctrl = rowControls({ status: r.status, files: r.files.length, unlinkedAvailable: unlinked.length }, !open);
                  const pill = STATUS_PILL[r.status];
                  return (
                    <TwoLineRow
                      key={r.id}
                      label="More"
                      accessibleName={`More for ${r.reference}`}
                      line1={
                        <>
                          <span className="font-semibold tabular-nums">{r.reference}</span>
                          <p className="min-w-48 flex-1 truncate font-semibold">{r.description}</p>
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-sm text-ink-muted">{r.areaTitle}</span>
                            <Badge tone={pill.tone}>{pill.label}</Badge>
                            {r.overdue && <Badge tone="danger">Overdue</Badge>}
                          </span>
                        </>
                      }
                      detail={requestMeta({ requestedByName: r.requestedByName, requestedOn: r.requestedOn, dueOn: r.dueOn, receivedOn: r.receivedOn, files: r.files.length })}
                      quick={
                        ctrl.inlineReceived ? (
                          <ActionForm action={markReceivedAction} fields={{ requestId: r.id }}>
                            <div className="flex flex-wrap items-center gap-2">
                              <input type="date" name="receivedOn" defaultValue={today} max={today} min={r.requestedOn} aria-label={`Received on, ${r.reference}`} className={`${ctl} min-h-8 py-0.5`} />
                              <Button variant="secondary" size="sm">
                                Mark received
                              </Button>
                            </div>
                          </ActionForm>
                        ) : undefined
                      }
                    >
                        <div className="space-y-4 text-sm">
                          <p>{r.description}</p>
                          {r.note && (
                            <p className="text-ink-muted">
                              <span className="font-medium text-ink">Internal note:</span> {r.note}
                            </p>
                          )}
                          {r.files.length > 0 && (
                            <div>
                              <p className="font-medium">{count(r.files.length, "linked file")}</p>
                              <ul className="mt-1 space-y-1">
                                {r.files.map((f) => (
                                  <li key={f.id} className="flex flex-wrap items-center gap-3">
                                    <a href={`/engagements/${id}/files/${f.id}`} className="font-medium text-accent hover:underline">
                                      {f.fileName}
                                    </a>
                                    {ctrl.unlink && (
                                      <ActionForm action={unlinkFileAction} fields={{ requestId: r.id, fileId: f.id }}>
                                        <Button variant="ghost" size="sm">
                                          Unlink
                                        </Button>
                                      </ActionForm>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {ctrl.link && (
                            <ActionForm action={linkFileAction} fields={{ requestId: r.id }}>
                              <div className="flex flex-wrap items-end gap-2">
                                <label className={fieldLabel}>
                                  Link a received file
                                  <select name="fileId" className={`${ctl} max-w-64`}>
                                    {unlinked.map((p) => (
                                      <option key={p.id} value={p.id}>
                                        {p.fileName}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <Button variant="secondary" size="sm">
                                  Link file
                                </Button>
                              </div>
                            </ActionForm>
                          )}
                          {ctrl.notApplicable && (
                            <ActionForm action={markNotApplicableAction} fields={{ requestId: r.id }}>
                              <div className="flex flex-wrap items-end gap-2">
                                <label className={`${fieldLabel} min-w-64 flex-1`}>
                                  Why this is not applicable
                                  <input name="note" required maxLength={1000} className={ctl} />
                                </label>
                                <Button variant="secondary" size="sm">
                                  Not applicable
                                </Button>
                              </div>
                            </ActionForm>
                          )}
                          {ctrl.reopen && (
                            <ActionForm action={reopenRequestAction} fields={{ requestId: r.id }}>
                              <Button variant="secondary" size="sm">
                                Reopen
                              </Button>
                            </ActionForm>
                          )}
                          {ctrl.edit && (
                            <ActionForm action={editRequestAction} fields={{ requestId: r.id }} className="space-y-3">
                              <p className="font-medium">Edit the request</p>
                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <label className={`${fieldLabel} sm:col-span-2`}>
                                  What is needed
                                  <input name="description" defaultValue={r.description} required maxLength={500} className={ctl} />
                                </label>
                                <label className={fieldLabel}>
                                  Area
                                  <select name="areaCode" defaultValue={r.areaCode ?? ""} className={ctl}>
                                    <option value="">General</option>
                                    {AREAS.map((a) => (
                                      <option key={a.code} value={a.code}>
                                        {a.code} {a.title}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className={fieldLabel}>
                                  Asked on
                                  <input type="date" name="requestedOn" defaultValue={r.requestedOn} required className={ctl} />
                                </label>
                                <label className={fieldLabel}>
                                  Due
                                  <input type="date" name="dueOn" defaultValue={r.dueOn ?? ""} className={ctl} />
                                </label>
                                <label className={fieldLabel}>
                                  Internal note (not in the Excel download)
                                  <input name="note" defaultValue={r.note ?? ""} maxLength={1000} className={ctl} />
                                </label>
                              </div>
                              <Button variant="primary" size="sm">
                                Save
                              </Button>
                            </ActionForm>
                          )}
                          {ctrl.delete && (
                            <div className="border-t border-border pt-3">
                              <ActionForm action={deleteRequestAction} fields={{ requestId: r.id }}>
                                <Button variant="danger" size="sm">
                                  Delete
                                </Button>
                              </ActionForm>
                            </div>
                          )}
                        </div>
                    </TwoLineRow>
                  );
                })}
              </ul>
            )}
          </Section>
        )}
      </div>
    </div>
  );
}
