-- The planning questionnaire's answers.
--
-- One row per answer given or confirmed, kept for good: a change is a new row, never an update, so the history is whole. The current answer to a
-- question is the row with the highest seq for that engagement and question_key. source says where the answer came from: 'auto' (the value the app
-- filled in from the trial balance or a default, confirmed by a person) or 'person' (typed by a person; when it replaces an auto value, reason says why).
-- The same table keeps the partner's decision on the revenue presumption (question_key 'revenue_presumption': value 'rebutted' with the reason, or
-- 'standing' to put it back).
--
-- The server checks every value; the table only keeps them.
--
-- Additive and safe for db:setup-hosted on the live database: one new table with its policy and grants. The old code never reads it, and an engagement
-- with no rows simply has no answers.
create table planning_answers (
  seq bigint generated always as identity primary key,
  firm_id uuid not null references firms(id),
  engagement_id uuid not null,
  question_key text not null check (length(question_key) between 1 and 64),
  value text not null check (length(value) between 1 and 2000),
  source text not null check (source in ('auto', 'person')),
  reason text check (reason is null or length(reason) between 1 and 2000),
  answered_by uuid not null references users(id),
  answered_at timestamptz not null default clock_timestamp(),
  foreign key (firm_id, engagement_id) references engagements (firm_id, id)
);
create index planning_answers_lookup on planning_answers (engagement_id, question_key, seq desc);

alter table planning_answers enable row level security;
create policy tenant on planning_answers using (firm_id = current_firm_id()) with check (firm_id = current_firm_id());
grant select, insert on planning_answers to app_user;
