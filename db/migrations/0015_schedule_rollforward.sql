-- Rolling test schedules forward into the next year's engagement.
--
-- A schedule brought forward remembers the schedule it came from, so bringing forward again creates nothing twice and the page
-- can link back to last year's. Its lines carry last year's amount as a comparative. Last year's work done is kept in a separate
-- read-only field: it is a starting point and must not pass as this year's work.
alter table test_schedules
  add column rolled_from_id uuid,
  add column prior_work_done text,
  add foreign key (firm_id, rolled_from_id) references test_schedules (firm_id, id) on delete set null (rolled_from_id);

-- A prior-year schedule is brought forward at most once into the engagement that follows it.
create unique index test_schedules_rolled_from on test_schedules (rolled_from_id) where rolled_from_id is not null;

alter table test_schedule_lines add column prior_amount_minor bigint;
