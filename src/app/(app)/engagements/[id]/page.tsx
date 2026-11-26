import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withFirm } from "@/server/db";
import { getSession } from "@/server/session";
import * as repo from "@/server/repo";
import * as review from "@/server/review";
import { getAuditOverview } from "@/server/audit";
import { requestCounts } from "@/server/client-requests";
import { confirmationSummary } from "@/server/confirmations";
import { getEngagementTeam, listAssignable } from "@/server/engagement-team";
import { listAreaAssignments } from "@/server/area-assignments";
import { todayIso } from "@/domain/client-requests";
import { canLock } from "@/domain/signoff";
import { buildWorkingPaperIndex } from "@/server/wp-index";
import { getPriorYearChecks } from "@/server/prior-year-checks";
import { priorYearAttention } from "@/ui/prior-year-view";
import { Badge, StatusBadge } from "@/ui/badge";
import { LinkButton } from "@/ui/button";
import { buildHomeModel, paths, seeAllLabel, type HomeInput } from "@/ui/engagement-home";
import { Callout, EmptyState, StepList } from "@/ui/feedback";
import { Card, Fact, PageHeader, Section, Stat } from "@/ui/layout";
import { TeamPanel } from "@/ui/team-panel";
import { ToDoRows } from "@/ui/todo-rows";
import { count } from "@/ui/text";
import { EngagementNav } from "./nav";

export const dynamic = "force-dynamic";

/** The engagement home: what to do next, how far along each stage is, and what is left before the file can be locked. */
export default async function EngagementHome({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const session = await getSession();
  const data = await withFirm(await getDb(), session.firmId, async (tx) => {
    const engagement = await repo.getEngagement(tx, id);
    if (!engagement) return null;
    return {
      engagement,
      accounts: await repo.listAccounts(tx, id),
      audit: await getAuditOverview(tx, id),
      overview: await review.getOverview(tx, id),
      index: await buildWorkingPaperIndex(tx, id),
      requests: (await requestCounts(tx, id)).overall,
      confirmations: (await confirmationSummary(tx, id)).overall,
      priorYear: await getPriorYearChecks(tx, session.firmId, id),
      team: await getEngagementTeam(tx, id),
      people: await listAssignable(tx),
      areaAssignments: [...(await listAreaAssignments(tx, id)).values()],
    };
  });
  if (!data || !data.audit || !data.overview || !data.index || !data.team) notFound();
  const { engagement, accounts, audit, overview, index, requests, confirmations, priorYear, team, people, areaAssignments } = data;

  const input: HomeInput = {
    engagementId: id,
    role: session.role,
    status: engagement.status,
    lockedByName: overview.lockedByName,
    lockedAt: overview.lockedAt,
    accounts: {
      total: accounts.length,
      unmapped: accounts.filter((a) => !a.groupCode).length,
      toAccept: accounts.filter((a) => a.groupCode && !a.approved).length,
    },
    audit: {
      enabled: audit.enabled,
      materialitySet: audit.materiality !== null,
      materialityStale: audit.materialityStale,
      areas: audit.areas.map((a) => ({
        assessed: a.assessed,
        procedures: a.procedures,
        completed: a.completed,
        unreviewed: a.unreviewed,
        schedules: a.schedules,
        schedulesToFinish: a.schedulesToFinish,
      })),
      approval: audit.approval.state,
      approvalNotReady: audit.approval.notReady,
    },
    review: {
      leadSheets: overview.leadSheets.map((l) => ({ prepared: l.preparer !== null, reviewed: l.reviewer !== null })),
      openPoints: overview.points.filter((p) => p.status === "open").length,
      ready: overview.readiness.ready,
      blockers: overview.readiness.blockers,
    },
    papers: { total: index.overall.total, reviewed: index.overall.reviewed },
    requests,
    confirmations: { ...confirmations, total: confirmations.count },
    priorYearAttention: priorYearAttention(priorYear).map((c) => c.label),
  };
  const model = buildHomeModel(input);
  const p = paths(id);
  const more = seeAllLabel(model.toDoTotal);
  const step = model.nextStep;

  return (
    <div className="py-8 text-ink">
      <PageHeader
        breadcrumb={[{ label: "All engagements", href: "/" }]}
        meta={
          <>
            <Fact label="Period">
              {engagement.periodStart} to {engagement.periodEnd}
            </Fact>
            <Fact label="Status">
              <StatusBadge status={model.locked ? "locked" : "in_progress"} label={model.locked ? "Locked" : "Open"} />
            </Fact>
            <Fact label="Audit">
              <Badge tone={audit.enabled ? "info" : "muted"}>{audit.enabled ? "Audit on" : "Audit off"}</Badge>
            </Fact>
          </>
        }
        title={engagement.clientName}
        subtitle={model.summary}
      />
      <EngagementNav id={id} current="home" status={engagement.status} archived={engagement.archivedAt !== null} />

      <div className="mt-6 space-y-8">
        {model.locked ? (
          <Card title="This engagement is locked">
            <p className="text-base text-ink-muted">{model.summary}</p>
            <div className="mt-4">
              <LinkButton href={p.review}>View sign-off</LinkButton>
            </div>
          </Card>
        ) : model.empty ? (
          <EmptyState
            title="No trial balance yet"
            description="Import the client's trial balance to begin. The lead sheets, audit planning and statements are all built from it."
            action={
              <LinkButton href={p.trialBalance} variant="primary">
                Import the trial balance
              </LinkButton>
            }
          />
        ) : step ? (
          <Card raised>
            <p className="text-sm font-semibold text-accent">Your next step</p>
            <h2 className="mt-1 text-xl font-semibold text-ink">{step.title}</h2>
            <p className="mt-1 text-base text-ink-muted">{step.description}</p>
            {step.waitingOn && step.kind === "action" && (
              <Callout variant="info" className="mt-3">
                {step.waitingOn}
              </Callout>
            )}
            <div className="mt-4">
              <LinkButton href={step.href} variant={step.kind === "action" ? "primary" : "secondary"}>
                {step.label}
              </LinkButton>
            </div>
          </Card>
        ) : null}

        <Section title="Where things stand" description="Worked out from what is recorded on the file.">
          <ul className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {model.tiles.map((t) => (
              <li key={t.key}>
                <Stat label={t.label} value={t.value} hint={t.hint} href={t.href} />
              </li>
            ))}
          </ul>
          <StepList steps={model.stages.map((s) => ({ ...s }))} />
        </Section>

        <TeamPanel engagementId={id} team={team} people={people} canAssign={canLock(session.role) && engagement.status === "open"} today={todayIso()} areaAssignments={areaAssignments} />

        {!model.locked && model.toDo.length > 0 && (
          <Section
            title="Still open before the file can be locked"
            description={count(model.toDoTotal, "thing") + " left."}
            actions={
              more && (
                <Link href={p.review} className="rounded-sm text-sm font-medium text-accent hover:underline">
                  {more}
                </Link>
              )
            }
          >
            <ToDoRows items={model.toDo} />
          </Section>
        )}

        {model.attention.length > 0 && (
          <Section title="Needs attention" description="Warnings from the checks against last year. They do not stop the file being locked.">
            <ToDoRows items={model.attention} />
          </Section>
        )}
      </div>
    </div>
  );
}
