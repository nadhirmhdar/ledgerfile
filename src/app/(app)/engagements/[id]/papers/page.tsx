import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import * as papers from "@/server/working-papers";
import { buildLeadSheets } from "@/domain/leadsheet";
import { ActionForm } from "@/app/action-form";
import { FileInput } from "@/app/file-input";
import { fileWorkingPaperAction, removeWorkingPaperAction } from "@/app/papers-actions";
import { uploadLimitLabel } from "@/server/config";
import { workingPaperLimit } from "@/server/direct-upload";
import { UploadForm } from "@/app/upload-form";
import { uploadHint } from "@/ui/upload-view";
import { AREAS, CHECKLISTS } from "@/domain/audit";
import { Button, buttonClass } from "@/ui/button";
import { ctl, Disclosure, fieldLabel } from "@/ui/controls";
import { EmptyState } from "@/ui/feedback";
import { PageHeader, Section } from "@/ui/layout";
import { fileSize, filingText, filterPapers, paperControls, paperCounts, paperResults, papersSentence, parsePapersSearch, parsePapersShow, type PapersShow } from "@/ui/papers-view";
import { TwoLineRow } from "@/ui/two-line-row";
import { EngagementNav } from "../nav";

export const dynamic = "force-dynamic";

export default async function PapersPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const query = await searchParams;
  const show = parsePapersShow(query.show);
  const q = parsePapersSearch(query.q);

  const session = await getSession();
  const { engagement, accounts, list } = await withFirm(await getDb(), session.firmId, async (tx) => ({
    engagement: await repo.getEngagement(tx, id),
    accounts: await repo.listAccounts(tx, id),
    list: await papers.listWorkingPapers(tx, id),
  }));
  if (!engagement) notFound();

  const open = engagement.status === "open";
  const limit = workingPaperLimit();
  const sheets = buildLeadSheets(accounts).sheets;
  const base = `/engagements/${id}/papers`;
  const view = filterPapers(list, { show, q });
  const chips = paperCounts(list, q);
  const link = (s: PapersShow) => {
    const p = new URLSearchParams();
    if (s) p.set("show", s);
    if (q) p.set("q", q);
    const str = p.toString();
    return `${base}${str ? `?${str}` : ""}`;
  };
  const chipList: { key: PapersShow; label: string; n: number }[] = [
    { key: "", label: "All", n: chips.all },
    { key: "notfiled", label: "Not filed", n: chips.notfiled },
    { key: "noreference", label: "No reference", n: chips.noreference },
    { key: "leadsheet", label: "Lead sheet", n: chips.leadsheet },
    { key: "procedure", label: "Procedure", n: chips.procedure },
  ];

  return (
    <div className="py-8 text-ink">
      <PageHeader
        breadcrumb={[{ label: "All engagements", href: "/" }]}
        title="Working papers"
        meta={
          <>
            <span>{engagement.clientName}</span>
            <span aria-hidden="true">·</span>
            <span>
              {engagement.periodStart} to {engagement.periodEnd}
            </span>
          </>
        }
        subtitle={papersSentence(list)}
      />
      <EngagementNav id={id} current="papers" status={engagement.status} />

      <div className="mt-6 space-y-8">
        {open && (
          <Disclosure summary="Upload a file" open={list.length === 0}>
            <UploadForm engagementId={id}>
              <div className="flex flex-wrap items-end gap-3">
                <label className={fieldLabel}>
                  File
                  <FileInput
                    maxBytes={limit.bytes}
                    accept={papers.ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",")}
                    className="text-sm font-normal text-ink file:mr-3 file:min-h-10 file:cursor-pointer file:rounded-md file:border file:border-border-strong file:bg-surface file:px-4 file:text-sm file:font-medium file:text-ink hover:file:bg-surface-muted"
                  />
                </label>
                <label className={fieldLabel}>
                  Supports
                  <select name="supports" defaultValue="engagement" className={ctl}>
                    <option value="engagement">The engagement generally</option>
                    {sheets.map((sh) => (
                      <option key={sh.groupCode} value={`lead_sheet:${sh.groupCode}`}>
                        Lead sheet: {sh.groupName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={`${fieldLabel} min-w-56 flex-1`}>
                  Description (optional)
                  <input name="description" maxLength={500} className={ctl} />
                </label>
                <Button variant="primary">Upload</Button>
              </div>
              <p className="mt-3 text-sm text-ink-muted">{uploadHint({ direct: limit.direct, limitLabel: limit.label, importLabel: uploadLimitLabel(), types: papers.ALLOWED_EXTENSIONS })} To attach evidence to an audit procedure, upload it from that procedure on the audit page.</p>
            </UploadForm>
          </Disclosure>
        )}

        {list.length === 0 ? (
          <EmptyState
            title="No files yet"
            description="Working papers are the files that support the work on this engagement: client documents, schedules and evidence, each filed against the index."
            action={open ? <p className="text-sm text-ink-muted">Open Upload a file above to add the first one.</p> : undefined}
          />
        ) : (
          <Section title="Files">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <nav aria-label="Filter files">
                <ul className="flex flex-wrap gap-2">
                  {chipList.map((c) => {
                    const active = show === c.key;
                    return (
                      <li key={c.key || "all"}>
                        <Link
                          href={link(c.key)}
                          aria-current={active ? "true" : undefined}
                          className={`inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-medium ${active ? "border-accent bg-accent text-surface" : "border-border-strong bg-surface text-ink hover:bg-surface-muted"}`}
                        >
                          {c.label} {c.n}
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
                  <input name="q" type="search" defaultValue={q} placeholder="File name or description" className={`${ctl} w-full sm:w-64`} />
                </label>
                <Button variant="secondary">Search</Button>
              </form>
            </div>
            <p role="status" className="mt-3 text-sm text-ink-muted">
              {paperResults(view.shown, view.total)}
            </p>

            {view.rows.length === 0 ? (
              <div className="mt-3">
                <EmptyState
                  title="No files match"
                  description="Nothing fits this filter and search."
                  action={
                    <Link href={base} className={buttonClass("secondary")}>
                      Show all
                    </Link>
                  }
                />
              </div>
            ) : (
              <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface shadow-card">
                {view.rows.map((w) => {
                  const ctrl = paperControls(w, { open, role: session.role, userId: session.userId });
                  return (
                    <TwoLineRow
                      key={w.id}
                      label="More"
                      accessibleName={`More for ${w.fileName}`}
                      line1={
                        <>
                          {/* A plain link: the route streams the file and logs a download, so it must not be prefetched. */}
                          <a href={`/engagements/${id}/files/${w.id}`} className="min-w-40 flex-1 truncate font-semibold text-accent hover:underline">
                            {w.fileName}
                          </a>
                          <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-sm text-ink-muted">{w.targetLabel}</span>
                          {w.reference && <span className="rounded-full border border-border-strong px-2.5 py-0.5 text-sm font-medium tabular-nums">{w.reference}</span>}
                        </>
                      }
                      detail={[w.description, fileSize(w.sizeBytes), `Uploaded by ${w.uploadedByName}, ${w.uploadedAt}`, filingText(w)].filter(Boolean).join(" · ")}
                    >
                      <div className="space-y-4 text-sm">
                        {ctrl.filing ? (
                          <ActionForm action={fileWorkingPaperAction} fields={{ paperId: w.id }}>
                            <div className="flex flex-wrap items-end gap-3">
                              <label className={fieldLabel}>
                                Index reference
                                <input name="reference" defaultValue={w.reference ?? ""} maxLength={8} placeholder="C5-F1" aria-label={`Index reference for ${w.fileName}`} className={`${ctl} w-32`} />
                              </label>
                              {ctrl.sectionSelect && (
                                <label className={fieldLabel}>
                                  Filed under
                                  <select name="sectionCode" defaultValue={w.sectionCode ?? ""} aria-label={`Filed under, for ${w.fileName}`} className={ctl}>
                                    <option value="">Unfiled</option>
                                    {AREAS.map((a) => (
                                      <option key={a.code} value={a.code}>
                                        {a.code} {a.title}
                                      </option>
                                    ))}
                                    {CHECKLISTS.map((c) => (
                                      <option key={c.code} value={c.code}>
                                        {c.code} {c.title}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              )}
                              <Button variant="primary" size="sm">
                                Save filing
                              </Button>
                            </div>
                          </ActionForm>
                        ) : (
                          <p>
                            <span className="font-medium">Index reference:</span> <span className="tabular-nums">{w.reference ?? "None"}</span>. {filingText(w)}.
                          </p>
                        )}
                        <p className="text-ink-muted">Every upload, download and removal is recorded in the audit log.</p>
                        {ctrl.remove && (
                          <div className="border-t border-border pt-3">
                            <ActionForm action={removeWorkingPaperAction} fields={{ paperId: w.id }}>
                              <Button variant="danger" size="sm">
                                Remove
                              </Button>
                            </ActionForm>
                            <p className="mt-1 text-ink-muted">The person who uploaded a file, or a reviewer or partner, can remove it until the engagement is locked.</p>
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
