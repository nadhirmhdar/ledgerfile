import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import { getAuditOverview } from "@/server/audit";
import { confirmationSummary, listConfirmations } from "@/server/confirmations";
import { listWorkingPapers } from "@/server/working-papers";
import { AREAS } from "@/domain/audit";
import { todayIso } from "@/domain/client-requests";
import { compareAreas, KIND_LABEL, KINDS } from "@/domain/confirmations";
import { canReview } from "@/domain/signoff";
import { formatAmount } from "@/domain/money";
import { ActionForm } from "@/app/action-form";
import {
  addConfirmationAction,
  addReminderAction,
  bringForwardConfirmationsAction,
  clearReplyAction,
  clearSentAction,
  deleteConfirmationAction,
  editConfirmationAction,
  linkConfirmationFileAction,
  markSentAction,
  prepareConfirmationAction,
  recordReplyAction,
  removeReminderAction,
  reviewConfirmationAction,
  saveAlternativeProceduresAction,
  saveReconciliationAction,
  unlinkConfirmationFileAction,
  unprepareConfirmationAction,
  unreviewConfirmationAction,
} from "@/app/confirmation-actions";
import { Badge } from "@/ui/badge";
import { Button, buttonClass } from "@/ui/button";
import { ctl, Disclosure, fieldLabel } from "@/ui/controls";
import { Callout, EmptyState } from "@/ui/feedback";
import { CheckIcon, DotIcon, RingIcon } from "@/ui/icons";
import { PageHeader, Section, Stat } from "@/ui/layout";
import { Table, TCell, THead, TRow } from "@/ui/table";
import {
  confirmationLine,
  confirmationResults,
  confirmationsSentence,
  filterConfirmations,
  nextAction,
  SELF_REVIEW_NOTE,
  parseConfirmationSearch,
  parseConfirmationShow,
  replyPill,
  showCounts,
  statePill,
  stepTracker,
  summaryTiles,
  type ConfirmationShow,
} from "@/ui/confirmation-view";
import { TwoLineRow } from "@/ui/two-line-row";
import { EngagementNav } from "../../nav";

export const dynamic = "force-dynamic";

const heading = "text-sm font-semibold text-ink";

export default async function ConfirmationsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const query = await searchParams;
  const show = parseConfirmationShow(query.show);
  const q = parseConfirmationSearch(query.q);

  const session = await getSession();
  const today = todayIso();
  const { engagement, auditOn, all, summary, papers, selfReviewAllowed } = await withFirm(await getDb(), session.firmId, async (tx) => {
    const engagement = await repo.getEngagement(tx, id);
    const auditOn = engagement ? ((await getAuditOverview(tx, id))?.enabled ?? false) : false;
    return {
      engagement,
      auditOn,
      all: auditOn ? await listConfirmations(tx, id, session.userId) : [],
      // Whether the firm may let a reviewer review work they did themselves (the server's own rule).
      selfReviewAllowed: auditOn ? await repo.canSelfReviewAudit(tx) : false,
      summary: auditOn ? await confirmationSummary(tx, id) : null,
      papers: auditOn ? await listWorkingPapers(tx, id) : [],
    };
  });
  if (!engagement) notFound();

  const locked = engagement.status !== "open";
  const open = !locked && auditOn;
  const reviewer = canReview(session.role);
  const base = `/engagements/${id}/audit/confirmations`;
  const view = filterConfirmations(all, { show, q });
  const chips = showCounts(all, q);
  const areas = [...new Set(view.rows.map((c) => c.areaCode))].sort(compareAreas);
  const summaryAreas = summary ? [...summary.byArea.keys()].sort(compareAreas) : [];
  const overall = summary?.overall;
  const tiles = overall ? summaryTiles(overall) : null;
  const link = (s: ConfirmationShow) => {
    const p = new URLSearchParams();
    if (s) p.set("show", s);
    if (q) p.set("q", q);
    const str = p.toString();
    return `${base}${str ? `?${str}` : ""}`;
  };
  const chipList: { key: ConfirmationShow; label: string; n: number }[] = [
    { key: "", label: "All", n: chips.all },
    { key: "notsent", label: "Not sent", n: chips.notsent },
    { key: "awaiting", label: "Awaiting reply", n: chips.awaiting },
    { key: "toprepare", label: "To prepare", n: chips.toprepare },
    { key: "waiting", label: "Waiting for review", n: chips.waiting },
    { key: "reviewed", label: "Reviewed", n: chips.reviewed },
    { key: "differs", label: "With differences", n: chips.differs },
  ];

  return (
    <div className="py-8 text-ink">
      <PageHeader
        breadcrumb={[{ label: "Audit planning", href: `/engagements/${id}/audit` }]}
        title="External confirmations"
        meta={
          <>
            <span>{engagement.clientName}</span>
            <span aria-hidden="true">·</span>
            <span>
              {engagement.periodStart} to {engagement.periodEnd}
            </span>
          </>
        }
        subtitle={auditOn && overall ? confirmationsSentence(overall) : undefined}
        actions={
          auditOn ? (
            <a href={`${base}/export`} className={buttonClass("secondary")}>
              Download (Excel)
            </a>
          ) : undefined
        }
      />
      <EngagementNav id={id} current="confirmations" status={engagement.status} archived={engagement.archivedAt !== null} />

      <div className="mt-6 space-y-8">
        {!auditOn ? (
          <Callout variant="info" title="The audit is off for this engagement">
            There are no confirmations to show. A reviewer or partner turns the audit on from the audit planning page.
          </Callout>
        ) : (
          <>
            {tiles && overall && overall.count > 0 && (
              <>
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <li>
                    <Stat label="Not sent" value={tiles.notSent} href={link("notsent")} />
                  </li>
                  <li>
                    <Stat label="Awaiting reply" value={tiles.awaiting} href={link("awaiting")} />
                  </li>
                  <li>
                    <Stat label="To prepare" value={tiles.toPrepare} href={link("toprepare")} />
                  </li>
                  <li>
                    <Stat label="Waiting for review" value={tiles.waitingForReview} href={link("waiting")} />
                  </li>
                  <li>
                    <Stat label="Reviewed" value={tiles.reviewed} href={link("reviewed")} />
                  </li>
                  <li>
                    <Stat label="Net difference" value={overall.differenceMinor !== 0 ? <Badge tone="danger">{formatAmount(overall.differenceMinor)}</Badge> : formatAmount(0)} href={link("differs")} />
                  </li>
                </ul>
                <section aria-label="Summary by area">
                  <Table caption="Confirmations by area">
                    <THead>
                      <TRow>
                        <TCell header="col">Area</TCell>
                        {["Total", "Agreed", "Differs", "No reply", "Book", "Confirmed", "Net difference"].map((h) => (
                          <TCell key={h} header="col" numeric>
                            {h}
                          </TCell>
                        ))}
                      </TRow>
                    </THead>
                    <tbody>
                      {[...summaryAreas.map((code) => [code, summary!.byArea.get(code)!] as const), ["All areas", overall] as const].map(([code, s]) => (
                        <TRow key={code} className={code === "All areas" ? "font-semibold" : ""}>
                          <TCell header="row">{code === "All areas" ? code : `${code} ${AREAS.find((a) => a.code === code)?.title ?? ""}`.trim()}</TCell>
                          {[s.count, s.agreed, s.differs, s.noReply].map((n, i) => (
                            <TCell key={i} numeric>
                              {n}
                            </TCell>
                          ))}
                          <TCell numeric>{formatAmount(s.bookMinor)}</TCell>
                          <TCell numeric>{formatAmount(s.confirmedMinor)}</TCell>
                          <TCell numeric>{formatAmount(s.differenceMinor)}</TCell>
                        </TRow>
                      ))}
                    </tbody>
                  </Table>
                  <p className="mt-1 text-sm text-ink-muted">Net difference is book less confirmed, over the confirmations that have a confirmed amount.</p>
                </section>
              </>
            )}

            {open && (
              <Disclosure summary="Add a confirmation" open={all.length === 0}>
                <ActionForm action={addConfirmationAction} fields={{ engagementId: id }}>
                  <div className="flex flex-wrap items-end gap-3">
                    <label className={fieldLabel}>
                      Kind
                      <select name="kind" defaultValue="bank" className={ctl}>
                        {KINDS.map((k) => (
                          <option key={k.code} value={k.code}>
                            {k.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={fieldLabel}>
                      Area
                      <select name="areaCode" defaultValue="" className={ctl}>
                        <option value="">The usual area for the kind</option>
                        {AREAS.map((a) => (
                          <option key={a.code} value={a.code}>
                            {a.code} {a.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={`${fieldLabel} min-w-56 flex-1`}>
                      Goes to
                      <input name="partyName" required maxLength={200} className={ctl} />
                    </label>
                    <label className={`${fieldLabel} min-w-48`}>
                      Contact (address or email)
                      <input name="contact" maxLength={500} className={ctl} />
                    </label>
                    <label className={fieldLabel}>
                      Account or code
                      <input name="accountRef" maxLength={100} className={ctl} />
                    </label>
                    <label className={fieldLabel}>
                      Balance per books
                      <input name="book" inputMode="decimal" placeholder="0.00" className={`${ctl} text-right`} />
                    </label>
                    <Button variant="primary">Add</Button>
                  </div>
                  <p className="mt-2 text-sm text-ink-muted">For &ldquo;Other&rdquo; choose the area. The book balance is the amount the client&apos;s books show for that party and can be negative.</p>
                </ActionForm>
                <Callout variant="info" title="A lawyer's reply" className="mt-4">
                  Record Agreed when it is consistent with what the books show for that matter (the book balance may be 0), or Differs with the lawyer&apos;s amount otherwise, and put the detail in the reply note.
                </Callout>
                {engagement.priorEngagementId && (
                  <ActionForm action={bringForwardConfirmationsAction} fields={{ engagementId: id }} className="mt-4 border-t border-border pt-4">
                    <Button variant="secondary">Bring forward from last year</Button>
                    <p className="mt-2 text-sm text-ink-muted">Copies kind, area, party, contact and account from the prior-year engagement as new confirmations with a zero book balance. Ones already there are skipped.</p>
                  </ActionForm>
                )}
              </Disclosure>
            )}

            {all.length === 0 ? (
              <EmptyState
                title="No confirmations yet"
                description="Who each confirmation went to, the balance in the books, when it was sent and chased, the reply, any difference and how it was dealt with, and who prepared and reviewed it."
                action={open ? <p className="text-sm text-ink-muted">Add a confirmation above to start.</p> : undefined}
              />
            ) : (
              <Section title="Confirmations">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <nav aria-label="Filter confirmations">
                    <ul className="flex flex-wrap gap-2">
                      {chipList.map((chip) => {
                        const active = show === chip.key;
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
                    {show && <input type="hidden" name="show" value={show} />}
                    <label className={fieldLabel}>
                      Search
                      <input name="q" type="search" defaultValue={q} placeholder="Party, account or reference" className={`${ctl} w-full sm:w-64`} />
                    </label>
                    <Button variant="secondary">Show</Button>
                  </form>
                </div>
                <p role="status" className="mt-3 text-sm text-ink-muted">
                  {confirmationResults(view.shown, view.total)}
                </p>

                {view.rows.length === 0 ? (
                  <div className="mt-3">
                    <EmptyState
                      title="No confirmations match"
                      description="Nothing fits this filter and search."
                      action={
                        <Link href={base} className={buttonClass("secondary")}>
                          Show all
                        </Link>
                      }
                    />
                  </div>
                ) : (
                  areas.map((code) => (
                    <section key={code} className="mt-6" aria-labelledby={`area-${code}`}>
                      <h3 id={`area-${code}`} className="text-base font-semibold">
                        {view.rows.find((c) => c.areaCode === code)!.areaTitle}
                      </h3>
                      <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface shadow-card">
                        {view.rows
                          .filter((c) => c.areaCode === code)
                          .map((c) => {
                            const unlinked = papers.filter((p) => !c.files.some((f) => f.id === p.id));
                            const editable = open && !c.reviewedByName;
                            const pill = statePill(c);
                            const rp = replyPill(c.reply);
                            const next = nextAction(c, session.role, locked, auditOn, { workedOnIt: c.viewerWorkedOnIt, selfReviewAllowed });
                            return (
                              <TwoLineRow
                                key={c.id}
                                label="More"
                                accessibleName={`More for ${c.reference}`}
                                openLabel={next.kind === "record_reply" ? "Record the reply" : next.kind === "add_work" ? "Add it" : undefined}
                                line1={
                                  <>
                                    <span className="font-semibold tabular-nums">{c.reference}</span>
                                    <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-sm text-ink-muted">{KIND_LABEL[c.kind]}</span>
                                    <span className="min-w-40 flex-1 truncate font-semibold">{c.partyName}</span>
                                    {c.accountRef && <span className="text-sm text-ink-muted">{c.accountRef}</span>}
                                    <span className="flex flex-wrap items-center gap-2">
                                      <Badge tone={pill.tone}>{pill.label}</Badge>
                                      {rp && <Badge tone={rp.tone}>{rp.label}</Badge>}
                                    </span>
                                  </>
                                }
                                detail={confirmationLine(c)}
                                quick={
                                  next.kind === "mark_sent" ? (
                                    <ActionForm action={markSentAction} fields={{ confirmationId: c.id }}>
                                      <div className="flex flex-wrap items-center gap-2">
                                        <input type="date" name="sentOn" defaultValue={today} max={today} aria-label={`Sent on, ${c.reference}`} className={`${ctl} min-h-8 py-0.5`} />
                                        <Button variant="secondary" size="sm">
                                          Mark sent
                                        </Button>
                                      </div>
                                    </ActionForm>
                                  ) : next.kind === "add_work" ? (
                                    <Badge tone="warning">{next.reason}</Badge>
                                  ) : next.kind === "prepare" ? (
                                    <ActionForm action={prepareConfirmationAction} fields={{ confirmationId: c.id }}>
                                      <Button variant="secondary" size="sm">
                                        Mark prepared
                                      </Button>
                                    </ActionForm>
                                  ) : next.kind === "review" ? (
                                    <span className="flex flex-wrap items-center gap-2">
                                      <ActionForm action={reviewConfirmationAction} fields={{ confirmationId: c.id }}>
                                        <Button variant="primary" size="sm">
                                          Mark reviewed
                                        </Button>
                                      </ActionForm>
                                      {next.selfReview && <span className="text-sm text-ink-muted">{SELF_REVIEW_NOTE}</span>}
                                    </span>
                                  ) : next.kind === "waiting_review" ? (
                                    <Badge tone="neutral">Waiting for review</Badge>
                                  ) : next.kind === "waiting_other_reviewer" ? (
                                    <span className="flex flex-wrap items-center gap-2">
                                      <Badge tone="neutral">Waiting for another reviewer</Badge>
                                      <span className="text-sm text-ink-muted">{next.reason}</span>
                                    </span>
                                  ) : undefined
                                }
                              >
                                <div className="space-y-5 text-sm">
                                  <ol className="flex flex-wrap gap-x-5 gap-y-1" aria-label="Progress">
                                    {stepTracker(c).map((s) => (
                                      <li key={s.key} className="flex items-center gap-1.5">
                                        {s.state === "done" ? <CheckIcon className="text-success" /> : s.state === "current" ? <DotIcon className="text-accent" /> : <RingIcon className="text-ink-subtle" />}
                                        <span className={s.state === "todo" ? "text-ink-muted" : "font-medium"}>{s.label}</span>
                                        <span className="text-ink-muted">{s.text}</span>
                                      </li>
                                    ))}
                                  </ol>

                                  {c.sentOn && editable && (
                                    <div className="space-y-3">
                                      <h4 className={heading}>Sending and reminders</h4>
                                      <div className="flex flex-wrap items-end gap-2">
                                        <ActionForm action={markSentAction} fields={{ confirmationId: c.id }}>
                                          <div className="flex flex-wrap items-end gap-2">
                                            <label className={fieldLabel}>
                                              Date sent
                                              <input type="date" name="sentOn" defaultValue={c.sentOn} max={today} aria-label={`Change the date sent, ${c.reference}`} className={ctl} />
                                            </label>
                                            <Button variant="secondary" size="sm">
                                              Change date sent
                                            </Button>
                                          </div>
                                        </ActionForm>
                                        {!c.reply && c.reminders.length === 0 && (
                                          <ActionForm action={clearSentAction} fields={{ confirmationId: c.id }}>
                                            <Button variant="secondary" size="sm">
                                              Clear sent date
                                            </Button>
                                          </ActionForm>
                                        )}
                                      </div>
                                      {c.reminders.length > 0 && (
                                        <ul className="space-y-1">
                                          {c.reminders.map((r) => (
                                            <li key={r} className="flex flex-wrap items-center gap-3">
                                              <span>Reminder on {r}</span>
                                              <ActionForm action={removeReminderAction} fields={{ confirmationId: c.id, on: r }}>
                                                <Button variant="ghost" size="sm" aria-label={`Remove the reminder of ${r}`}>
                                                  Remove
                                                </Button>
                                              </ActionForm>
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                      {c.reminders.length < 5 && (
                                        <ActionForm action={addReminderAction} fields={{ confirmationId: c.id }}>
                                          <div className="flex flex-wrap items-end gap-2">
                                            <label className={fieldLabel}>
                                              Reminder date
                                              <input type="date" name="on" defaultValue={today} min={c.sentOn} max={today} aria-label={`Reminder date, ${c.reference}`} className={ctl} />
                                            </label>
                                            <Button variant="secondary" size="sm">
                                              Add reminder
                                            </Button>
                                          </div>
                                        </ActionForm>
                                      )}
                                    </div>
                                  )}

                                  {editable && c.sentOn && (
                                    <div className="space-y-3">
                                      <h4 className={heading}>{c.reply ? "Change the reply" : "Record the reply"}</h4>
                                      <ActionForm action={recordReplyAction} fields={{ confirmationId: c.id }}>
                                        <div className="flex flex-wrap items-end gap-3">
                                          <label className={fieldLabel}>
                                            Reply
                                            <select name="reply" defaultValue={c.reply ?? "agreed"} className={ctl}>
                                              <option value="agreed">Agreed with the books</option>
                                              <option value="differs">Differs from the books</option>
                                              <option value="no_reply">No reply</option>
                                            </select>
                                          </label>
                                          <label className={fieldLabel}>
                                            Replied on
                                            <input type="date" name="repliedOn" defaultValue={c.repliedOn ?? today} min={c.sentOn} max={today} className={ctl} />
                                          </label>
                                          <label className={fieldLabel}>
                                            Confirmed amount (when it differs)
                                            <input
                                              name="confirmed"
                                              inputMode="decimal"
                                              defaultValue={c.reply === "differs" && c.confirmedMinor !== null ? formatAmount(c.confirmedMinor).replace(/[(),]/g, (m) => (m === "(" ? "-" : "")) : ""}
                                              className={`${ctl} text-right`}
                                            />
                                          </label>
                                          <label className={`${fieldLabel} min-w-56 flex-1`}>
                                            Reply note
                                            <input name="replyNote" defaultValue={c.replyNote ?? ""} maxLength={2000} className={ctl} />
                                          </label>
                                          <Button variant="primary" size="sm">
                                            Save reply
                                          </Button>
                                        </div>
                                      </ActionForm>
                                      {c.reply && (
                                        <ActionForm action={clearReplyAction} fields={{ confirmationId: c.id }}>
                                          <Button variant="secondary" size="sm">
                                            Clear the reply
                                          </Button>
                                        </ActionForm>
                                      )}
                                    </div>
                                  )}
                                  {!editable && c.reply && (
                                    <div className="space-y-1">
                                      <h4 className={heading}>Reply</h4>
                                      <p>
                                        {c.reply === "agreed" ? "Agreed with the books" : c.reply === "differs" ? "Differs from the books" : "No reply"}
                                        {c.repliedOn ? ` on ${c.repliedOn}` : ""}
                                      </p>
                                    </div>
                                  )}
                                  {c.replyNote && (
                                    <p>
                                      <span className="font-medium">Reply note: </span>
                                      {c.replyNote}
                                    </p>
                                  )}

                                  {editable && c.reply === "differs" && (
                                    <ActionForm action={saveReconciliationAction} fields={{ confirmationId: c.id }} className="space-y-2">
                                      <h4 className={heading}>Reconciliation of the difference</h4>
                                      <label className={fieldLabel}>
                                        How the difference was reconciled
                                        <textarea name="text" defaultValue={c.reconciliation ?? ""} rows={3} maxLength={4000} className={`${ctl} min-h-20`} />
                                      </label>
                                      <Button variant="secondary" size="sm">
                                        Save reconciliation
                                      </Button>
                                    </ActionForm>
                                  )}
                                  {editable && c.reply === "no_reply" && (
                                    <ActionForm action={saveAlternativeProceduresAction} fields={{ confirmationId: c.id }} className="space-y-2">
                                      <h4 className={heading}>Alternative procedures performed</h4>
                                      <label className={fieldLabel}>
                                        What was done instead
                                        <textarea name="text" defaultValue={c.alternativeProcedures ?? ""} rows={3} maxLength={4000} className={`${ctl} min-h-20`} />
                                      </label>
                                      <Button variant="secondary" size="sm">
                                        Save alternative procedures
                                      </Button>
                                    </ActionForm>
                                  )}
                                  {!editable && c.reconciliation && (
                                    <p>
                                      <span className="font-medium">Reconciliation: </span>
                                      {c.reconciliation}
                                    </p>
                                  )}
                                  {!editable && c.alternativeProcedures && (
                                    <p>
                                      <span className="font-medium">Alternative procedures: </span>
                                      {c.alternativeProcedures}
                                    </p>
                                  )}

                                  {(c.files.length > 0 || (editable && unlinked.length > 0)) && (
                                    <div className="space-y-2">
                                      <h4 className={heading}>Evidence</h4>
                                      {c.files.length > 0 && (
                                        <ul className="space-y-1">
                                          {c.files.map((f) => (
                                            <li key={f.id} className="flex flex-wrap items-center gap-3">
                                              <a href={`/engagements/${id}/files/${f.id}`} className="font-medium text-accent hover:underline">
                                                {f.fileName}
                                              </a>
                                              {editable && (
                                                <ActionForm action={unlinkConfirmationFileAction} fields={{ confirmationId: c.id, fileId: f.id }}>
                                                  <Button variant="ghost" size="sm">
                                                    Unlink
                                                  </Button>
                                                </ActionForm>
                                              )}
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                      {editable && unlinked.length > 0 && (
                                        <ActionForm action={linkConfirmationFileAction} fields={{ confirmationId: c.id }}>
                                          <div className="flex flex-wrap items-end gap-2">
                                            <label className={fieldLabel}>
                                              Link a file
                                              <select name="fileId" aria-label={`Link a file, ${c.reference}`} className={`${ctl} max-w-64`}>
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
                                    </div>
                                  )}

                                  {((open && c.reviewedByName && reviewer) || (editable && c.preparedByName) || (c.preparedByName && locked)) && (
                                    <div className="space-y-2">
                                      <h4 className={heading}>Sign-off</h4>
                                      {c.preparedByName && (
                                        <p className="text-ink-muted">
                                          Prepared by {c.preparedByName}, {c.preparedAt}
                                          {c.reviewedByName ? `. Reviewed by ${c.reviewedByName}, ${c.reviewedAt}${c.selfReviewed ? " (self-reviewed)" : ""}` : ""}.
                                        </p>
                                      )}
                                      <div className="flex flex-wrap items-center gap-2">
                                        {open && c.reviewedByName && reviewer && (
                                          <ActionForm action={unreviewConfirmationAction} fields={{ confirmationId: c.id }}>
                                            <Button variant="secondary" size="sm">
                                              Withdraw review
                                            </Button>
                                          </ActionForm>
                                        )}
                                        {editable && c.preparedByName && (
                                          <ActionForm action={unprepareConfirmationAction} fields={{ confirmationId: c.id }}>
                                            <Button variant="secondary" size="sm">
                                              Withdraw preparation
                                            </Button>
                                          </ActionForm>
                                        )}
                                      </div>
                                      {open && c.reviewedByName && <p className="text-ink-muted">Reviewed: withdraw the review to change it.</p>}
                                    </div>
                                  )}

                                  <div className="space-y-3">
                                    <h4 className={heading}>Details</h4>
                                    {c.contact && <p className="text-ink-muted">{c.contact}</p>}
                                    {editable && (
                                      <ActionForm action={editConfirmationAction} fields={{ confirmationId: c.id }} className="space-y-3">
                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                          <label className={fieldLabel}>
                                            Kind
                                            <select name="kind" defaultValue={c.kind} className={ctl}>
                                              {KINDS.map((k) => (
                                                <option key={k.code} value={k.code}>
                                                  {k.label}
                                                </option>
                                              ))}
                                            </select>
                                          </label>
                                          <label className={fieldLabel}>
                                            Area
                                            <select name="areaCode" defaultValue={c.areaCode} className={ctl}>
                                              {AREAS.map((a) => (
                                                <option key={a.code} value={a.code}>
                                                  {a.code} {a.title}
                                                </option>
                                              ))}
                                            </select>
                                          </label>
                                          <label className={fieldLabel}>
                                            Goes to
                                            <input name="partyName" defaultValue={c.partyName} required maxLength={200} className={ctl} />
                                          </label>
                                          <label className={fieldLabel}>
                                            Contact
                                            <input name="contact" defaultValue={c.contact ?? ""} maxLength={500} className={ctl} />
                                          </label>
                                          <label className={fieldLabel}>
                                            Account or code
                                            <input name="accountRef" defaultValue={c.accountRef ?? ""} maxLength={100} className={ctl} />
                                          </label>
                                          <label className={fieldLabel}>
                                            Balance per books (clear the reply first to change it)
                                            <input name="book" inputMode="decimal" defaultValue={(c.bookMinor / 100).toFixed(2)} className={`${ctl} text-right`} />
                                          </label>
                                        </div>
                                        <Button variant="primary" size="sm">
                                          Save
                                        </Button>
                                      </ActionForm>
                                    )}
                                  </div>

                                  {editable && (!c.reply || reviewer) && c.files.length === 0 && (
                                    <div className="border-t border-border pt-3">
                                      <ActionForm action={deleteConfirmationAction} fields={{ confirmationId: c.id }}>
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
                    </section>
                  ))
                )}
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
