-- Test schedules: the detailed testing of an audit area, kept on the file instead of in a separate workbook.
--
-- A schedule belongs to an audit area (and optionally one lead-sheet group in it, which gives it a balance to agree to).
-- It has a header, a listing of lines from the client, the tickmarks and evidence against each line, the work done and a
-- conclusion. Amounts are in the area's own sign: positive on the side the balance normally falls (assets, expenses as
-- debits; liabilities, equity and income as credits), the way a client's listing is usually presented.
create table test_schedules (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  engagement_id uuid not null,
  area_code text not null,
  -- The lead-sheet group whose balance the listing should agree to; null for a schedule with no balance to agree to.
  group_code text references groups(code),
  -- Running number within the area (one more than the highest still on the file), and the reference built from it, such as C5-1.
  seq integer not null check (seq > 0),
  reference text not null,
  title text not null,
  objective text,
  work_done text,
  conclusion text,
  -- Required when the listing does not agree to the balance.
  explanation_of_difference text,
  -- Which materiality-based amount marks the key items. Stored as the choice, so it follows revisions of materiality.
  threshold text not null default 'performance' check (threshold in ('overall', 'performance', 'half_performance', 'quarter_performance')),
  -- Who recorded the conclusion, and when. This is the person a reviewer must differ from.
  prepared_by uuid references users(id),
  prepared_at timestamptz,
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  created_by uuid not null references users(id),
  created_at timestamptz not null default clock_timestamp(),
  unique (engagement_id, reference),
  unique (engagement_id, area_code, seq),
  unique (firm_id, id),
  foreign key (firm_id, engagement_id) references engagements (firm_id, id),
  check ((reviewed_by is null) = (reviewed_at is null)),
  check ((prepared_by is null) = (prepared_at is null)),
  -- A review needs a conclusion to review.
  check (reviewed_by is null or (prepared_by is not null and conclusion is not null))
);
create index test_schedules_engagement on test_schedules (engagement_id, area_code, seq);

create table test_schedule_lines (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  schedule_id uuid not null,
  position integer not null,
  description text not null,
  -- An account code, invoice number or other pointer into the client's records.
  doc_ref text,
  amount_minor bigint not null default 0,
  tested boolean not null default false,
  tickmarks text[] not null default '{}',
  -- Evidence: a file already uploaded to this engagement. The application checks it is on the same engagement.
  working_paper_id uuid references working_papers(id),
  remarks text,
  foreign key (firm_id, schedule_id) references test_schedules (firm_id, id) on delete cascade
);
create index test_schedule_lines_schedule on test_schedule_lines (schedule_id, position);

alter table test_schedules enable row level security;
alter table test_schedule_lines enable row level security;
create policy tenant on test_schedules using (firm_id = current_firm_id()) with check (firm_id = current_firm_id());
create policy tenant on test_schedule_lines using (firm_id = current_firm_id()) with check (firm_id = current_firm_id());

grant select, insert, update, delete on test_schedules, test_schedule_lines to app_user;
