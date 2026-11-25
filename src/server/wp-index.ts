import type { Tx } from "./db";
import { getEngagement, listAccounts } from "./repo";
import { getAuditOverview } from "./audit";
import { getAnalytics } from "./analytics";
import { requestCounts } from "./client-requests";
import { buildLeadSheets } from "../domain/leadsheet";
import { buildStatements } from "../domain/statements";
import { AREA_BY_CODE, CHECKLISTS } from "../domain/audit";
import { GROUP_BY_CODE } from "../domain/groups";
import { confirmationState } from "../domain/confirmations";
import { differenceUnexplained, presentationBalance } from "../domain/test-schedule";
import {
  buildIndex,
  confirmationsNote,
  confirmationsStatus,
  GENERAL,
  homeOfFile,
  leadSheetReference,
  leadSheetStatus,
  peopleLabel,
  riskStatus,
  scheduleStatus,
  sectionOfCode,
  stepsStatus,
  UNFILED,
  AREA_OF_GROUP,
  type IndexEntry,
  type Status,
  type WorkingPaperIndex,
} from "../domain/wp-index";

/**
 * Build the working paper index for an engagement.
 *
 * Nothing is stored for the index: each entry is read from the record the paper already has (sign-offs, procedures, schedules, uploads
 * and so on). The number of queries is fixed, a few per kind of paper, and does not grow with the number of papers. Everything runs
 * inside the caller's firm transaction, so row-level security keeps it to the firm's own rows.
 *
 * Where the product holds no preparer or reviewer for a kind of paper (the trial balance, adjusting journals, statements, client
 * requests, letters), the entry shows none and says so in its note. It is never filled in with a guess.
 */
export async function buildWorkingPaperIndex(tx: Tx, engagementId: string): Promise<(WorkingPaperIndex & { engagementStatus: string; auditOn: boolean }) | null> {
  const engagement = await getEngagement(tx, engagementId);
  if (!engagement) return null;
  const base = `/engagements/${engagementId}`;
  const entries: IndexEntry[] = [];
  const add = (e: Omit<IndexEntry, "preparedBy" | "preparedOn" | "reviewedBy" | "reviewedOn" | "note"> & Partial<IndexEntry>) =>
    entries.push({ preparedBy: null, preparedOn: null, reviewedBy: null, reviewedOn: null, note: null, ...e });

  const flags = await tx.query<{ auditOn: boolean; lockedByName: string | null; lockedOn: string | null }>(
    `select e.audit_enabled as "auditOn", u.name as "lockedByName", to_char(e.locked_at at time zone 'UTC', 'YYYY-MM-DD') as "lockedOn"
     from engagements e left join users u on u.id = e.locked_by where e.id = $1`,
    [engagementId],
  );
  const auditOn = flags.rows[0]?.auditOn ?? false;
  const accounts = (await listAccounts(tx, engagementId)).map((a) => ({ ...a, closingMinor: a.closingMinor + a.adjustmentMinor }));

  // --- General papers: they exist on every engagement, audited or not --------------------------------------------------------------
  const imported = await tx.query<{ on: string | null }>(`select to_char(max(imported_at), 'YYYY-MM-DD') as "on" from tb_imports where engagement_id = $1`, [engagementId]);
  const unmapped = accounts.filter((a) => !a.groupCode).length;
  const unapproved = accounts.filter((a) => a.groupCode && !a.approved).length;
  add({
    reference: "G1",
    section: GENERAL,
    title: "Trial balance and mapping",
    kind: "trial_balance",
    href: `${base}/trial-balance`,
    status: accounts.length === 0 ? "not_started" : unmapped + unapproved > 0 ? "in_progress" : "prepared",
    reviewable: false,
    preparedOn: imported.rows[0]?.on ?? null,
    note:
      accounts.length === 0
        ? "No trial balance imported."
        : `${accounts.length} accounts. ${unmapped + unapproved > 0 ? `${unmapped} not mapped, ${unapproved} mapping(s) not approved. ` : ""}The product does not record who imported or approved the mapping.`,
  });

  const journals = await tx.query<{ n: number; on: string | null; by: string | null }>(
    `select count(*)::int as n, to_char(max(j.created_at), 'YYYY-MM-DD') as "on", (array_agg(u.name order by j.created_at desc))[1] as "by"
     from journal_entries j left join users u on u.id = j.created_by where j.engagement_id = $1`,
    [engagementId],
  );
  const j = journals.rows[0];
  add({
    reference: "G2",
    section: GENERAL,
    title: "Adjusting and reclassification journals",
    kind: "journals",
    href: `${base}/journals`,
    status: j.n === 0 ? "not_applicable" : "prepared",
    reviewable: false,
    preparedBy: j.n === 0 ? null : j.by,
    preparedOn: j.n === 0 ? null : j.on,
    note: j.n === 0 ? "None recorded." : `${j.n} journal entr${j.n === 1 ? "y" : "ies"}. Journals are not reviewed separately; the lead sheets that carry them are.`,
  });

  const statements = buildStatements(accounts, { borrowingsCurrent: { current: engagement.borrowingsCurrentMinor, prior: engagement.borrowingsCurrentPriorMinor } });
  const failed = statements.checks.filter((c) => !c.passed).length;
  add({
    reference: "G3",
    section: GENERAL,
    title: "Financial statements",
    kind: "statements",
    href: `${base}/statements`,
    status: accounts.length === 0 ? "not_started" : failed > 0 ? "in_progress" : "prepared",
    reviewable: false,
    note: accounts.length === 0 ? "No trial balance imported." : failed > 0 ? `${failed} statement check(s) fail.` : "Drawn from the trial balance; all checks pass. No preparer is recorded.",
  });

  const counts = (await requestCounts(tx, engagementId)).overall;
  const askers = await tx.query<{ people: string[] | null; on: string | null }>(
    `select array_agg(distinct u.name) as people, to_char(max(r.requested_on), 'YYYY-MM-DD') as "on" from client_requests r join users u on u.id = r.requested_by where r.engagement_id = $1`,
    [engagementId],
  );
  add({
    reference: "G4",
    section: GENERAL,
    title: "Client requests",
    kind: "requests",
    href: `${base}/requests`,
    status: counts.total === 0 ? "not_started" : counts.open > 0 ? "in_progress" : "prepared",
    reviewable: false,
    preparedBy: peopleLabel(askers.rows[0].people ?? []),
    preparedOn: counts.total === 0 ? null : askers.rows[0].on,
    note: counts.total === 0 ? "No requests recorded." : `${counts.received} received, ${counts.notApplicable} not applicable, ${counts.open} open${counts.overdue > 0 ? ` (${counts.overdue} overdue)` : ""}.`,
  });

  const locked = flags.rows[0]?.lockedOn ?? null;
  add({
    reference: "G5",
    section: GENERAL,
    title: "Review and file lock",
    kind: "lock",
    href: `${base}/review`,
    status: engagement.status === "locked" ? "reviewed" : "not_started",
    reviewable: true,
    reviewedBy: engagement.status === "locked" ? (flags.rows[0]?.lockedByName ?? null) : null,
    reviewedOn: engagement.status === "locked" ? locked : null,
    note: engagement.status === "locked" ? "Locked by a partner." : "Not locked.",
  });

  // --- Lead sheets: sign-off is per lead sheet group, on every engagement ----------------------------------------------------------
  const signOffs = await tx.query<{ target: string; level: "preparer" | "reviewer"; name: string; at: string; userId: string }>(
    `select s.target, s.level, s.user_id as "userId", u.name, to_char(s.signed_at, 'YYYY-MM-DD') as at from sign_offs s join users u on u.id = s.user_id where s.engagement_id = $1`,
    [engagementId],
  );
  const points = await tx.query<{ target: string; n: number }>(
    `select target, count(*)::int as n from review_points where engagement_id = $1 and status = 'open' group by target`,
    [engagementId],
  );
  const openPoints = new Map(points.rows.map((p) => [p.target, p.n]));
  for (const sheet of buildLeadSheets(accounts).sheets) {
    const reference = leadSheetReference(sheet.groupCode);
    const area = AREA_OF_GROUP.get(sheet.groupCode);
    if (!reference || !area) continue; // every group belongs to an area; a test holds that
    const prep = signOffs.rows.find((s) => s.target === sheet.groupCode && s.level === "preparer");
    const rev = signOffs.rows.find((s) => s.target === sheet.groupCode && s.level === "reviewer");
    const open = openPoints.get(sheet.groupCode) ?? 0;
    add({
      reference,
      section: area,
      title: `Lead sheet: ${sheet.groupName}`,
      kind: "lead_sheet",
      href: `${base}/review`,
      status: leadSheetStatus({ prepared: !!prep, reviewed: !!rev, openPoints: open }),
      reviewable: true,
      preparedBy: prep?.name ?? null,
      preparedOn: prep?.at ?? null,
      reviewedBy: rev?.name ?? null,
      reviewedOn: rev?.at ?? null,
      note: [open > 0 ? `${open} open review point(s).` : null, prep && rev && prep.userId === rev.userId ? "Self-reviewed." : null].filter(Boolean).join(" ") || null,
    });
  }

  // --- Uploaded files: any engagement, filed where the preparer put them ------------------------------------------------------------
  // Only the current version of each file is indexed (the row no other row replaces); the earlier versions stay on the file's own page.
  const files = await tx.query<{ id: string; replacesId: string | null; fileName: string; reference: string | null; sectionCode: string | null; targetKind: string; target: string | null; template: string | null; by: string; on: string }>(
    `select w.id, w.replaces_id as "replacesId", w.file_name as "fileName", w.reference, w.section_code as "sectionCode", w.target_kind as "targetKind", w.target,
            p.template_id as template, u.name as by, to_char(w.uploaded_at, 'YYYY-MM-DD') as "on"
     from working_papers w join users u on u.id = w.uploaded_by
     left join audit_procedures p on w.target_kind = 'procedure' and p.id::text = w.target
     where w.engagement_id = $1 order by w.reference nulls last, w.file_name, w.id`,
    [engagementId],
  );
  const replacedIds = new Set(files.rows.map((f) => f.replacesId).filter((x): x is string => !!x));
  const fileById = new Map(files.rows.map((f) => [f.id, f]));
  for (const f of files.rows.filter((x) => !replacedIds.has(x.id))) {
    let version = 1;
    for (let r = f.replacesId ? fileById.get(f.replacesId) : undefined; r; r = r.replacesId ? fileById.get(r.replacesId) : undefined) version++;
    const home = homeOfFile({ targetKind: f.targetKind, target: f.target, procedureTemplate: f.template, sectionCode: f.sectionCode });
    add({
      reference: f.reference,
      section: home ? (sectionOfCode(home) ?? UNFILED) : UNFILED,
      title: f.fileName,
      kind: "file",
      href: `${base}/files/${f.id}`,
      status: "prepared",
      reviewable: false,
      preparedBy: f.by,
      preparedOn: f.on,
      note: `${version > 1 ? `Version ${version}. ` : ""}Uploaded evidence. Files are not reviewed as such; the paper they support is.`,
    });
  }

  // --- Audit papers: only when the audit is on ---------------------------------------------------------------------------------------
  if (auditOn) {
    const overview = await getAuditOverview(tx, engagementId);
    const analytics = await getAnalytics(tx, engagementId);

    // Procedures and checklist steps, rolled up per area or checklist.
    const rollup = await tx.query<{
      code: string; total: number; open: number; na: number; done: number; unreviewed: number; reviewedN: number; selfN: number; firmN: number; addedN: number;
      performers: string[] | null; performedOn: string | null; reviewers: string[] | null; reviewedOn: string | null;
    }>(
      `select p.area_code as code, count(*)::int as total, count(*) filter (where p.status = 'open')::int as open, count(*) filter (where p.status = 'na')::int as na,
              count(*) filter (where p.status <> 'open')::int as done,
              count(*) filter (where p.status <> 'open' and p.reviewed_by is null and p.evidence !~* '^Partner sign-off')::int as unreviewed,
              count(*) filter (where p.reviewed_by is not null)::int as "reviewedN",
              count(*) filter (where p.reviewed_by is not null and p.reviewed_by = p.performed_by)::int as "selfN",
              count(*) filter (where p.firm_wording)::int as "firmN", count(*) filter (where p.firm_added)::int as "addedN",
              array_agg(distinct pu.name) filter (where pu.name is not null) as performers, to_char(max(p.performed_at), 'YYYY-MM-DD') as "performedOn",
              array_agg(distinct ru.name) filter (where ru.name is not null) as reviewers, to_char(max(p.reviewed_at), 'YYYY-MM-DD') as "reviewedOn"
       from audit_procedures p left join users pu on pu.id = p.performed_by left join users ru on ru.id = p.reviewed_by
       where p.engagement_id = $1 group by p.area_code`,
      [engagementId],
    );
    const steps = new Map(rollup.rows.map((r) => [r.code, r]));
    const stepEntry = (code: string, base2: { reference: string; section: string; title: string; kind: "checklist" | "procedures"; href: string }) => {
      const r = steps.get(code);
      const status = stepsStatus({ total: r?.total ?? 0, open: r?.open ?? 0, notApplicable: r?.na ?? 0, unreviewed: r?.unreviewed ?? 0 });
      add({
        ...base2,
        status,
        reviewable: true,
        preparedBy: peopleLabel(r?.performers ?? []),
        preparedOn: r?.performedOn ?? null,
        reviewedBy: status === "reviewed" || status === "not_applicable" ? peopleLabel(r?.reviewers ?? []) : null,
        reviewedOn: status === "reviewed" || status === "not_applicable" ? (r?.reviewedOn ?? null) : null,
        note: !r || r.total === 0 ? "Programme not loaded." : `${r.done} of ${r.total} steps finished, ${r.reviewedN} reviewed${r.na > 0 ? `, ${r.na} not applicable` : ""}.${r.selfN > 0 ? ` ${r.selfN} self-reviewed.` : ""}${r.firmN > 0 ? ` ${r.firmN} with your firm's wording.` : ""}${r.addedN > 0 ? ` ${r.addedN} added by your firm.` : ""}`,
      });
    };
    for (const c of CHECKLISTS) {
      const section = sectionOfCode(c.code);
      if (section) stepEntry(c.code, { reference: c.code, section, title: c.title, kind: "checklist", href: `${base}/audit/${c.code}` });
    }
    // An area that is out of scope this year but still has procedures on the file keeps its entry.
    const areaCodes = new Set<string>([...overview!.areas.map((a) => a.code), ...rollup.rows.map((r) => r.code).filter((c) => AREA_BY_CODE.has(c))]);
    for (const code of areaCodes) {
      const area = AREA_BY_CODE.get(code)!;
      stepEntry(code, { reference: `${code}.P`, section: code, title: `${area.title}: audit procedures`, kind: "procedures", href: `${base}/audit/${code}` });
    }

    // Materiality, the risk assessment and the partner's approval of it.
    const mat = overview!.materiality;
    add({
      reference: "B2.M",
      section: "B",
      title: "Materiality",
      kind: "materiality",
      href: `${base}/audit`,
      status: !mat ? "not_started" : overview!.materialityStale ? "in_progress" : "prepared",
      reviewable: false,
      preparedBy: mat?.setBy ?? null,
      preparedOn: mat?.setAt ?? null,
      note: !mat ? "Not set." : `${overview!.revisions} revision(s). ${overview!.materialityStale ? "The benchmark figure has changed since it was set. " : ""}Approved with the risk assessment (B8.R).`,
    });
    const ratings = await tx.query<{ n: number; by: string | null; on: string | null; people: string[] | null }>(
      `select count(*)::int as n, (array_agg(u.name order by r.updated_at desc))[1] as by, to_char(max(r.updated_at), 'YYYY-MM-DD') as "on", array_agg(distinct u.name) as people
       from risk_assessments r join users u on u.id = r.updated_by where r.engagement_id = $1`,
    [engagementId],
    );
    const unassessed = overview!.areas.filter((a) => !a.assessed).length;
    const approval = overview!.approval;
    const riskState: Status = riskStatus({ anyRated: ratings.rows[0].n > 0, unassessed, approval: approval.state });
    add({
      reference: "B8.R",
      section: "B",
      title: "Risk assessment and partner approval",
      kind: "risk",
      href: `${base}/audit`,
      status: riskState,
      reviewable: true,
      preparedBy: ratings.rows[0].n > 0 ? peopleLabel(ratings.rows[0].people ?? []) : null,
      preparedOn: ratings.rows[0].on,
      reviewedBy: approval.state === "current" ? approval.approvedBy : null,
      reviewedOn: approval.state === "current" ? approval.approvedAt : null,
      note:
        approval.state === "lapsed"
          ? "The assessment changed after the partner approved it."
          : approval.state === "none" && unassessed > 0
            ? `${unassessed} area(s) not yet assessed.`
            : approval.state === "none"
              ? "Awaiting the partner's approval."
              : null,
    });

    // Analytical review: explanations of significant movements. Re-confirmation is not a review, so none is shown.
    const writers = await tx.query<{ n: number; people: string[] | null; on: string | null }>(
      `select count(*)::int as n, array_agg(distinct u.name) as people, to_char(max(e.written_at), 'YYYY-MM-DD') as "on"
       from analytical_explanations e join users u on u.id = e.written_by where e.engagement_id = $1`,
      [engagementId],
    );
    add({
      reference: "B3.A",
      section: "B",
      title: "Analytical review and ratios",
      kind: "analytics",
      href: `${base}/audit/analytics`,
      status: !analytics || !analytics.thresholds ? "not_started" : analytics.unexplained > 0 ? "in_progress" : "prepared",
      reviewable: false,
      preparedBy: peopleLabel(writers.rows[0].people ?? []),
      preparedOn: writers.rows[0].on,
      note: !analytics || !analytics.thresholds ? "Needs materiality before movements are flagged." : analytics.unexplained > 0 ? `${analytics.unexplained} flagged movement(s) have no explanation that stands.` : "Every flagged movement is explained.",
    });

    // Letters are produced on demand and not stored; the log of when they were produced is all the product knows.
    const letters = await tx.query<{ entity: string; name: string | null; on: string }>(
      `select distinct on (l.entity) l.entity, u.name, to_char(l.at, 'YYYY-MM-DD') as on
       from audit_log l left join users u on u.id = l.user_id
       where l.entity_id = $1 and l.action = 'export' and l.entity in ('engagement_letter', 'representation_letter')
       order by l.entity, l.at desc`,
      [engagementId],
    );
    for (const [entity, reference, section, title] of [
      ["engagement_letter", "A3.L", "A", "Engagement letter"],
      ["representation_letter", "D5.L", "D", "Management representation letter"],
    ] as const) {
      const made = letters.rows.find((r) => r.entity === entity);
      add({
        reference,
        section,
        title,
        kind: "letter",
        href: `${base}/audit/letters`,
        status: made ? "prepared" : "not_started",
        reviewable: false,
        preparedBy: made?.name ?? null,
        preparedOn: made?.on ?? null,
        note: made ? "Last produced from the template on this date. The signed copy is not tracked here." : "Not yet produced.",
      });
    }

    // Misstatements recorded.
    const items = overview!.misstatements.items;
    add({
      reference: "D1.M",
      section: "D",
      title: "Schedule of misstatements",
      kind: "misstatements",
      href: `${base}/audit`,
      status: items.length === 0 ? "not_applicable" : overview!.misstatements.exceedsMateriality ? "in_progress" : "prepared",
      reviewable: false,
      preparedBy: items.length === 0 ? null : peopleLabel(items.map((i) => i.recordedBy)),
      preparedOn: items.length === 0 ? null : items.map((i) => i.recordedAt).sort().at(-1)!,
      note: items.length === 0 ? "None recorded." : `${items.length} recorded, ${items.filter((i) => !i.corrected).length} uncorrected.${overview!.misstatements.exceedsMateriality ? " Uncorrected items reach overall materiality." : ""}`,
    });

    // Journal entry testing (management override), in area C16.
    const jt = await tx.query<{ imports: number; selected: number; untested: number; testers: string[] | null; on: string | null }>(
      `select (select count(*)::int from ledger_imports where engagement_id = $1) as imports,
              count(*)::int as selected, count(*) filter (where t.tested_at is null)::int as untested,
              array_agg(distinct u.name) filter (where u.name is not null) as testers, to_char(max(t.tested_at), 'YYYY-MM-DD') as "on"
       from journal_tests t left join users u on u.id = t.tested_by where t.engagement_id = $1`,
      [engagementId],
    );
    const t = jt.rows[0];
    add({
      reference: "C16.J",
      section: "C16",
      title: "Journal entry testing",
      kind: "journal_testing",
      href: `${base}/audit/journals`,
      status: t.selected === 0 ? (t.imports > 0 ? "in_progress" : "not_started") : t.untested > 0 ? "in_progress" : "prepared",
      reviewable: false,
      preparedBy: peopleLabel(t.testers ?? []),
      preparedOn: t.on,
      note: t.selected === 0 ? (t.imports > 0 ? "Listing imported; no entries selected." : "No journal listing imported.") : `${t.selected - t.untested} of ${t.selected} selected entries tested. Reviewed with the C16 procedures.`,
    });

    // Test schedules.
    const sched = await tx.query<{
      id: string; areaCode: string; groupCode: string | null; reference: string; title: string; conclusion: string | null; explanation: string | null;
      preparedBy: string | null; preparedOn: string | null; reviewedBy: string | null; reviewedOn: string | null; lines: number | null; total: number | null; selfReviewed: boolean;
    }>(
      `select s.id, s.area_code as "areaCode", s.group_code as "groupCode", s.reference, s.title, s.conclusion, s.explanation_of_difference as explanation,
              pu.name as "preparedBy", to_char(s.prepared_at, 'YYYY-MM-DD') as "preparedOn", ru.name as "reviewedBy", to_char(s.reviewed_at, 'YYYY-MM-DD') as "reviewedOn",
              l.n as lines, l.total, coalesce(s.reviewed_by = s.prepared_by, false) as "selfReviewed"
       from test_schedules s
       left join users pu on pu.id = s.prepared_by left join users ru on ru.id = s.reviewed_by
       left join (select schedule_id, count(*)::int as n, sum(amount_minor)::float8 as total from test_schedule_lines group by schedule_id) l on l.schedule_id = s.id
       where s.engagement_id = $1`,
      [engagementId],
    );
    for (const s of sched.rows) {
      const hasConclusion = !!s.conclusion?.trim();
      const reviewed = s.reviewedBy !== null;
      const unexplained = differenceUnexplained({
        reference: s.reference,
        hasConclusion,
        reviewed,
        balanceMinor: s.groupCode && GROUP_BY_CODE.has(s.groupCode) ? presentationBalance(accounts, s.groupCode) : null,
        totalMinor: s.total ?? 0,
        explanation: s.explanation,
      });
      add({
        reference: s.reference,
        section: sectionOfCode(s.areaCode) ?? UNFILED,
        title: s.title,
        kind: "schedule",
        href: `${base}/audit/${s.areaCode}/schedules/${s.id}`,
        status: scheduleStatus({ hasLines: (s.lines ?? 0) > 0, hasConclusion, reviewed, differenceUnexplained: unexplained }),
        reviewable: true,
        preparedBy: s.preparedBy,
        preparedOn: s.preparedOn,
        reviewedBy: s.reviewedBy,
        reviewedOn: s.reviewedOn,
        note: [unexplained ? (reviewed ? "Reviewed, but the listing does not agree to the balance and the difference is not explained." : "The listing does not agree to the balance and the difference is not explained.") : null, s.selfReviewed ? "Self-reviewed." : null].filter(Boolean).join(" ") || null,
      });
    }

    // External confirmations: one paper per area that has any, after the area's test schedules.
    const confs = await tx.query<{
      areaCode: string; reply: "agreed" | "differs" | "no_reply" | null; sent: boolean; prepared: boolean; reviewed: boolean;
      preparedBy: string | null; preparedOn: string | null; reviewedBy: string | null; reviewedOn: string | null; self: boolean;
    }>(
      `select c.area_code as "areaCode", c.reply, c.sent_on is not null as sent, c.prepared_by is not null as prepared, c.reviewed_by is not null as reviewed,
              pu.name as "preparedBy", to_char(c.prepared_at, 'YYYY-MM-DD') as "preparedOn", ru.name as "reviewedBy", to_char(c.reviewed_at, 'YYYY-MM-DD') as "reviewedOn",
              coalesce(c.reviewed_by = c.prepared_by or c.reviewed_by = any(c.contributors), false) as self
       from confirmations c left join users pu on pu.id = c.prepared_by left join users ru on ru.id = c.reviewed_by
       where c.engagement_id = $1`,
      [engagementId],
    );
    for (const code of new Set(confs.rows.map((c) => c.areaCode))) {
      const own = confs.rows.filter((c) => c.areaCode === code);
      const facts = own.map((c) => ({ reply: c.reply, state: confirmationState({ sentOn: c.sent ? "x" : null, reply: c.reply, prepared: c.prepared, reviewed: c.reviewed }) }));
      const status = confirmationsStatus(facts);
      const selfN = own.filter((c) => c.reviewed && c.self).length;
      const latest = (dates: (string | null)[]) => dates.filter((d): d is string => !!d).sort().at(-1) ?? null;
      add({
        reference: `${code}.CF`,
        section: sectionOfCode(code) ?? UNFILED,
        title: "External confirmations",
        kind: "confirmations",
        href: `${base}/audit/confirmations#area-${code}`,
        status,
        reviewable: true,
        preparedBy: peopleLabel(own.map((c) => c.preparedBy).filter((n): n is string => !!n)),
        preparedOn: latest(own.map((c) => c.preparedOn)),
        reviewedBy: status === "reviewed" ? peopleLabel(own.map((c) => c.reviewedBy).filter((n): n is string => !!n)) : null,
        reviewedOn: status === "reviewed" ? latest(own.map((c) => c.reviewedOn)) : null,
        note: `${confirmationsNote(facts)}${selfN > 0 ? ` ${selfN} self-reviewed.` : ""}`,
      });
    }
  }

  return { ...buildIndex(entries), engagementStatus: engagement.status, auditOn };
}
