-- The partner's approval of the risk assessment.
--
-- Each approval keeps a snapshot of exactly what was approved: the materiality in force and the
-- rating of every area in scope. The approval stands only while the assessment still matches that
-- snapshot, however it came to change, so nothing has to remember to withdraw it. Approvals are
-- never changed or removed; the latest one is the one considered.
create table risk_approvals (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  engagement_id uuid not null,
  snapshot text not null,
  approved_by uuid not null references users(id),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (firm_id, engagement_id) references engagements (firm_id, id)
);
create index risk_approvals_engagement on risk_approvals (engagement_id, created_at desc);

alter table risk_approvals enable row level security;
create policy tenant on risk_approvals using (firm_id = current_firm_id()) with check (firm_id = current_firm_id());

grant select, insert on risk_approvals to app_user;
