import type { Tx } from "./db";
import type { Session } from "./repo";
import { PROCEDURE_AWAITING_REVIEW } from "./audit";
import { GROUP_BY_CODE } from "../domain/groups";
import { effectiveTeam } from "../domain/area-assignments";
import { reportDueState, isShownDue, dueWords, sortGroups, SLOT_LABEL, type WorkGroup, type WorkLine } from "../domain/my-work";
import { count } from "../ui/text";

/**
 * What waits for one person, across the firm's open engagements. One query for the engagements and one for each kind of work, each over
 * all engagements at once. "Open" and "ready for review" are the same definitions the audit and review pages use (PROCEDURE_AWAITING_REVIEW,
 * prepared_by / reviewed_by, a review point's status and response); nothing here has its own.
 *
 * Assignment by area: for an audit area that has its own preparer (or reviewer), that person gets the area's preparer (or reviewer) work, in place of
 * the engagement's preparer (or reviewer). Areas without an override are exactly as before. Only the work grouped by area (procedures and test
 * schedules) follows the area; confirmations, review points, lead sheet sign-offs, the partner's items and the due date stay with the engagement's roles.
 *
 * Only open engagements count: a locked or archived file has nothing left to do. An engagement the person is not on appears only for a
 * review point they raised that has been answered.
 */

interface EngagementRow {
  id: string;
  clientName: string;
  periodEnd: string;
  reportDueOn: string | null;
  preparerId: string | null;
  reviewerId: string | null;
  partnerId: string | null;
  /** The EQ reviewer while the review is on and unsigned. */
  eqWaitingId: string | null;
}

export async function getMyWork(tx: Tx, s: Session, today: string): Promise<WorkGroup[]> {
  const engagements = (
    await tx.query<EngagementRow>(
      `select e.id, c.name as "clientName", to_char(e.period_end, 'YYYY-MM-DD') as "periodEnd", to_char(e.report_due_on, 'YYYY-MM-DD') as "reportDueOn",
              e.preparer_id as "preparerId", e.reviewer_id as "reviewerId", e.partner_id as "partnerId",
              case when e.eq_review_required and e.eq_signed_at is null then e.eq_reviewer_id end as "eqWaitingId"
       from engagements e join clients c on c.id = e.client_id
       where e.status = 'open' and e.archived_at is null and e.firm_id = $1`,
      [s.firmId],
    )
  ).rows;
  if (engagements.length === 0) return [];
  const ids = engagements.map((e) => e.id);

  const [procedures, schedules, confirmations, points, signOffs, areaRows, ownIndependence] = await Promise.all([
    tx.query<{ engagementId: string; areaCode: string; open: number; awaiting: number }>(
      `select engagement_id as "engagementId", area_code as "areaCode",
              count(*) filter (where status = 'open')::int as open, count(*) filter (where ${PROCEDURE_AWAITING_REVIEW})::int as awaiting
       from audit_procedures where engagement_id = any($1::uuid[]) group by engagement_id, area_code`,
      [ids],
    ),
    tx.query<{ engagementId: string; areaCode: string; id: string; unprepared: boolean }>(
      `select engagement_id as "engagementId", area_code as "areaCode", id, prepared_by is null as unprepared
       from test_schedules where engagement_id = any($1::uuid[]) and (prepared_by is null or reviewed_by is null) order by reference`,
      [ids],
    ),
    tx.query<{ engagementId: string; unprepared: boolean }>(
      `select engagement_id as "engagementId", prepared_by is null as unprepared
       from confirmations where engagement_id = any($1::uuid[]) and (prepared_by is null or reviewed_by is null)`,
      [ids],
    ),
    tx.query<{ engagementId: string; authorId: string; answered: boolean }>(
      `select engagement_id as "engagementId", author_id as "authorId", response is not null as answered
       from review_points where engagement_id = any($1::uuid[]) and status = 'open'`,
      [ids],
    ),
    tx.query<{ engagementId: string; target: string }>(
      `select p.engagement_id as "engagementId", p.target
       from sign_offs p
       where p.engagement_id = any($1::uuid[]) and p.level = 'preparer'
         and not exists (select 1 from sign_offs r where r.engagement_id = p.engagement_id and r.target = p.target and r.level = 'reviewer')
       order by p.target`,
      [ids],
    ),
    tx.query<{ engagementId: string; areaCode: string; preparerId: string | null; reviewerId: string | null }>(
      `select engagement_id as "engagementId", area_code as "areaCode", preparer_id as "preparerId", reviewer_id as "reviewerId"
       from engagement_area_assignments where engagement_id = any($1::uuid[])`,
      [ids],
    ),
    tx.query<{ engagementId: string; stages: number }>(
      `select engagement_id as "engagementId", count(distinct stage)::int as stages from independence_confirmations
       where engagement_id = any($1::uuid[]) and user_id = $2 group by engagement_id`,
      [ids, s.userId],
    ),
  ]);
  const confirmedStages = new Map(ownIndependence.rows.map((r) => [r.engagementId, r.stages]));

  const by = <T extends { engagementId: string }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const r of rows) map.set(r.engagementId, [...(map.get(r.engagementId) ?? []), r]);
    return map;
  };
  const proc = by(procedures.rows);
  const sched = by(schedules.rows);
  const conf = by(confirmations.rows);
  const pts = by(points.rows);
  const sheets = by(signOffs.rows);
  const owned = by(areaRows.rows);

  const groups: WorkGroup[] = [];
  for (const e of engagements) {
    const base = `/engagements/${e.id}`;
    const asPreparer = e.preparerId === s.userId;
    const asReviewer = e.reviewerId === s.userId;
    const asPartner = e.partnerId === s.userId;
    const reviewSide = asReviewer || asPartner;
    const lines: WorkLine[] = [];
    const add = (line: Omit<WorkLine, "key"> & { slug: string }) => {
      if (line.count > 0) lines.push({ key: `${e.id}:${line.slug}`, kind: line.kind, label: line.label, count: line.count, href: line.href });
    };
    /** The page for a set of items: their own page when there is one, their area when they share one, else the audit overview. */
    const where = (items: { areaCode: string; id?: string }[]) => {
      const areas = new Set(items.map((i) => i.areaCode));
      if (items.length === 1 && items[0].id) return `${base}/audit/${items[0].areaCode}/schedules/${items[0].id}`;
      return areas.size === 1 ? `${base}/audit/${[...areas][0]}` : `${base}/audit`;
    };

    // Who prepares and who reviews each area: its own person where one is set, else the engagement's.
    const own = new Map((owned.get(e.id) ?? []).map((a) => [a.areaCode, a]));
    const prepOf = (areaCode: string) => effectiveTeam(own.get(areaCode), e).preparerId;
    const revOf = (areaCode: string) => effectiveTeam(own.get(areaCode), e).reviewerId;
    const reviewsArea = (areaCode: string) => revOf(areaCode) === s.userId || asPartner;
    const myProcs = proc.get(e.id) ?? [];
    const mySched = sched.get(e.id) ?? [];
    const myConf = conf.get(e.id) ?? [];
    const myPoints = pts.get(e.id) ?? [];

    // The work grouped by area follows the area's own preparer where there is one.
    const open = myProcs.filter((p) => p.open > 0 && prepOf(p.areaCode) === s.userId);
    const nOpen = open.reduce((t, p) => t + p.open, 0);
    add({ slug: "prep-proc", kind: "prepare", label: `${count(nOpen, "procedure")} still open`, count: nOpen, href: where(open) });
    const toPrep = mySched.filter((x) => x.unprepared && prepOf(x.areaCode) === s.userId);
    add({ slug: "prep-sched", kind: "prepare", label: `${count(toPrep.length, "test schedule")} not yet prepared`, count: toPrep.length, href: where(toPrep) });

    if (asPreparer) {
      const toPrepC = myConf.filter((x) => x.unprepared).length;
      add({ slug: "prep-conf", kind: "prepare", label: `${count(toPrepC, "confirmation")} not yet prepared`, count: toPrepC, href: `${base}/audit/confirmations` });
      const waiting = myPoints.filter((p) => !p.answered).length;
      add({ slug: "prep-points", kind: "prepare", label: `${count(waiting, "review point")} waiting for your response`, count: waiting, href: `${base}/review` });
    }

    // The review of an area's work goes to the area's own reviewer where there is one, in place of the engagement's reviewer; the partner still sees all of it.
    const toReview = myProcs.filter((p) => p.awaiting > 0 && reviewsArea(p.areaCode));
    const nReview = toReview.reduce((t, p) => t + p.awaiting, 0);
    add({ slug: "rev-proc", kind: "review", label: `${count(nReview, "procedure")} done and not yet reviewed`, count: nReview, href: where(toReview) });
    const sch = mySched.filter((x) => !x.unprepared && reviewsArea(x.areaCode));
    add({ slug: "rev-sched", kind: "review", label: `${count(sch.length, "test schedule")} prepared and not yet reviewed`, count: sch.length, href: where(sch) });

    if (reviewSide) {
      const cnf = myConf.filter((x) => !x.unprepared).length;
      add({ slug: "rev-conf", kind: "review", label: `${count(cnf, "confirmation")} prepared and not yet reviewed`, count: cnf, href: `${base}/audit/confirmations` });
      const answered = myPoints.filter((p) => p.answered).length;
      add({ slug: "rev-points", kind: "review", label: `${count(answered, "review point")} answered, waiting to be cleared`, count: answered, href: `${base}/review` });
      const lead = sheets.get(e.id) ?? [];
      const names = lead.map((l) => GROUP_BY_CODE.get(l.target)?.name ?? l.target);
      add({
        slug: "rev-sheets",
        kind: "review",
        label: `${count(lead.length, "lead sheet")} signed as prepared, not yet reviewed${names.length <= 2 ? `: ${names.join(", ")}` : ""}`,
        count: lead.length,
        href: `${base}/review`,
      });
    }

    // (c) Review points I raised that have an answer and are still open, on any engagement I am not already reviewing (those are listed above).
    if (!reviewSide) {
      const mine = myPoints.filter((p) => p.authorId === s.userId && p.answered).length;
      add({ slug: "yours", kind: "yours", label: `${count(mine, "review point")} you raised ${mine === 1 ? "has" : "have"} an answer`, count: mine, href: `${base}/review` });
    }

    // Independence: a person on this file's team (its roles or an area) who has not confirmed both stages gets one line.
    const onTeam = asPreparer || asReviewer || asPartner || [...own.values()].some((a) => a.preparerId === s.userId || a.reviewerId === s.userId);
    if (onTeam && (confirmedStages.get(e.id) ?? 0) < 2) {
      add({ slug: "independence", kind: "confirm", label: "Independence not confirmed", count: 1, href: `${base}#independence` });
    }

    // The engagement quality review, for the named reviewer while it is on and unsigned (they need not be on the team).
    if (e.eqWaitingId === s.userId) add({ slug: "eq", kind: "review", label: "Quality review", count: 1, href: `${base}#quality-review` });

    // (d) Report due: only for an engagement the person is on.
    const on = asPreparer || asReviewer || asPartner;
    const due = reportDueState(e.reportDueOn, today);
    if (on && isShownDue(due)) {
      add({ slug: "due", kind: "due", label: `Report ${dueWords(due).toLowerCase()}`, count: 1, href: base });
    }

    if (lines.length === 0) continue;
    const areaPreparer = [...own.values()].some((a) => a.preparerId === s.userId);
    const areaReviewer = [...own.values()].some((a) => a.reviewerId === s.userId);
    const roles = [(asPreparer || areaPreparer) && SLOT_LABEL.preparer, (asReviewer || areaReviewer) && SLOT_LABEL.reviewer, asPartner && SLOT_LABEL.partner, e.eqWaitingId === s.userId && "EQ reviewer"].filter((r): r is string => !!r);
    groups.push({ engagementId: e.id, clientName: e.clientName, periodEnd: e.periodEnd, reportDueOn: e.reportDueOn, due, roles, lines });
  }
  return sortGroups(groups);
}
