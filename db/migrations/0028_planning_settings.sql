-- The firm's materiality and planning settings, and a fifth benchmark.
--
-- firm_planning_settings holds one row per firm that has changed its planning settings: the percentage range for each materiality benchmark, the default
-- and reduced performance materiality, the trivial percentage and the thresholds the planning assistant uses to flag indicators. A firm with no row uses the
-- defaults in the code, which are the constants materiality has always used (and drafts for the rest, labelled as unreviewed), so nothing changes until a
-- firm edits them. The settings are validated by the server; the table only keeps them. Every change is also kept, before and after, in
-- firm_planning_settings_history, which is insert-only.
--
-- materiality.benchmark gains 'expenses' (total expenses, for a not-for-profit or cost-centre entity): the check is dropped and added again wider, so every
-- existing row still satisfies it.
--
-- Additive and safe for db:setup-hosted on the live database: two new tables with their policies and grants, and one check widened. The old code never reads
-- the new tables and never writes 'expenses'.
create table firm_planning_settings (
  firm_id uuid primary key references firms(id),
  settings jsonb not null check (jsonb_typeof(settings) = 'object'),
  updated_by uuid not null references users(id),
  updated_at timestamptz not null default clock_timestamp()
);

create table firm_planning_settings_history (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  before_values jsonb,
  after_values jsonb not null,
  changed_by uuid not null references users(id),
  changed_at timestamptz not null default clock_timestamp()
);
create index firm_planning_settings_history_lookup on firm_planning_settings_history (firm_id, changed_at);

alter table firm_planning_settings enable row level security;
alter table firm_planning_settings_history enable row level security;
create policy tenant on firm_planning_settings using (firm_id = current_firm_id()) with check (firm_id = current_firm_id());
create policy tenant on firm_planning_settings_history using (firm_id = current_firm_id()) with check (firm_id = current_firm_id());
grant select, insert, update on firm_planning_settings to app_user;
grant select, insert on firm_planning_settings_history to app_user;

do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'materiality'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%''pbt''%' loop
    execute format('alter table materiality drop constraint %I', c.conname);
  end loop;
end $$;
alter table materiality add constraint materiality_benchmark_check check (benchmark in ('pbt', 'revenue', 'expenses', 'assets', 'equity'));
