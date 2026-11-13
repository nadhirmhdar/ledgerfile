-- Explanations of significant movements in the analytical review.
--
-- One explanation per statement line per engagement, replaced when it is edited (the audit log keeps the
-- earlier wording). It records the current-year and prior-year amounts it was written against, in presentation
-- sign, so that when the figures later differ the explanation is shown as needing re-confirmation and no longer
-- counts towards the lock.
create table analytical_explanations (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  engagement_id uuid not null,
  line_key text not null,
  explanation text not null,
  current_minor bigint not null,
  prior_minor bigint not null,
  written_by uuid not null references users(id),
  written_at timestamptz not null default clock_timestamp(),
  unique (engagement_id, line_key),
  foreign key (firm_id, engagement_id) references engagements (firm_id, id)
);

alter table analytical_explanations enable row level security;
create policy tenant on analytical_explanations using (firm_id = current_firm_id()) with check (firm_id = current_firm_id());

grant select, insert, update on analytical_explanations to app_user;
