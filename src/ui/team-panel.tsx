import Link from "next/link";
import { AreaAssignmentForm } from "@/app/area-assignment-form";
import { EngagementTeamForm } from "@/app/engagement-team-form";
import { ASSIGNABLE_AREAS, SAME_AS_ENGAGEMENT, areaTitle } from "@/domain/area-assignments";
import type { AreaAssignment } from "@/server/area-assignments";
import { dueWords, NO_DATE, NOT_ASSIGNED, reportDueState, SLOT_LABEL, SLOTS } from "@/domain/my-work";
import type { EngagementTeam, TeamPerson } from "@/server/engagement-team";
import { Badge } from "./badge";
import { Section } from "./layout";
import { roleLabel } from "./team-view";

/**
 * Who is on the engagement and when the report is due. A partner or administrator on an open engagement gets the form; everyone else (and
 * anyone on a locked file) reads it. Both show the same four facts, so a person can always see who should do what.
 */
export function TeamPanel({
  engagementId,
  team,
  people,
  canAssign,
  today,
  areaAssignments = [],
}: {
  engagementId: string;
  team: EngagementTeam;
  people: TeamPerson[];
  /** A partner or administrator, on an engagement that is open. */
  canAssign: boolean;
  today: string;
  /** The audit areas that have their own preparer or reviewer. */
  areaAssignments?: AreaAssignment[];
}) {
  const due = reportDueState(team.reportDueOn, today);
  return (
    <Section
      title="Team"
      id="team"
      actions={team.reportDueOn ? <Badge tone={due.kind === "overdue" ? "danger" : due.kind === "soon" ? "warning" : "neutral"}>{dueWords(due)}</Badge> : undefined}
      description={
        canAssign
          ? "Who prepares, reviews and signs this file, and when the report is due. My work lists each person's open items."
          : "Who prepares, reviews and signs this file, and when the report is due. A partner assigns the team."
      }
    >
      {canAssign ? (
        <div className="rounded-lg border border-border bg-surface p-4 shadow-card sm:p-6">
          <EngagementTeamForm
            engagementId={engagementId}
            people={people}
            current={{ preparerId: team.preparer?.id ?? null, reviewerId: team.reviewer?.id ?? null, partnerId: team.partner?.id ?? null, reportDueOn: team.reportDueOn }}
          />
        </div>
      ) : (
        <dl className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-4 shadow-card sm:grid-cols-2 sm:p-6 lg:grid-cols-4">
          {SLOTS.map((slot) => (
            <div key={slot} className="min-w-0">
              <dt className="text-small text-ink-subtle">{SLOT_LABEL[slot]}</dt>
              <dd className="mt-0.5 text-sm font-medium text-ink">
                {team[slot] ? (
                  <>
                    {team[slot]!.name} <span className="font-normal text-ink-muted">({roleLabel(team[slot]!.role)})</span>
                  </>
                ) : (
                  <span className="font-normal text-ink-muted">{NOT_ASSIGNED}</span>
                )}
              </dd>
            </div>
          ))}
          <div className="min-w-0">
            <dt className="text-small text-ink-subtle">Report due</dt>
            <dd className="mt-0.5 text-sm font-medium text-ink">{team.reportDueOn ?? <span className="font-normal text-ink-muted">{NO_DATE}</span>}</dd>
          </div>
        </dl>
      )}
      <div className="mt-6 space-y-3" id="area-teams">
        <h3 className="text-sm font-semibold text-ink">Areas with their own team</h3>
        {areaAssignments.length === 0 ? (
          <p className="text-sm text-ink-muted">Every audit area follows the engagement&apos;s preparer and reviewer.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface shadow-card">
            {areaAssignments.map((a) => (
              <li key={a.areaCode} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3">
                <Link href={`/engagements/${engagementId}/audit/${a.areaCode}`} className="min-w-0 basis-full rounded-sm font-medium text-accent hover:underline sm:basis-64">
                  {a.areaCode} {areaTitle(a.areaCode)}
                </Link>
                <span className="text-small text-ink-muted">
                  Preparer: <span className="font-medium text-ink">{a.preparer?.name ?? SAME_AS_ENGAGEMENT}</span>
                </span>
                <span className="text-small text-ink-muted">
                  Reviewer: <span className="font-medium text-ink">{a.reviewer?.name ?? SAME_AS_ENGAGEMENT}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {canAssign && (
          <div className="rounded-lg border border-border bg-surface p-4 shadow-card sm:p-6">
            <AreaAssignmentForm
              engagementId={engagementId}
              people={people}
              areas={ASSIGNABLE_AREAS}
              current={Object.fromEntries(areaAssignments.map((a) => [a.areaCode, { preparerId: a.preparer?.id ?? null, reviewerId: a.reviewer?.id ?? null }]))}
            />
          </div>
        )}
      </div>
    </Section>
  );
}
