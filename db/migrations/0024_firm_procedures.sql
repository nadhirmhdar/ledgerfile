-- A firm's own changes to the methodology library's procedures: its wording in place of the library's, and procedures it leaves out.
--
-- The library (src/domain/methodology-library.json) is not changed. A firm with no rows here sees exactly the library, and every programme loads as it
-- always did. A row holds the firm's change for one library procedure: the wording it uses instead (null means "use the library's"), and whether the
-- procedure is hidden, so it is not loaded into new programmes. Ids, tiers and assertions are not editable in this version.
--
-- Engagements keep the wording they were loaded with: loading COPIES the wording into audit_procedures, and a later edit here never rewrites those rows.
-- audit_procedures gets one flag, firm_wording, set when a procedure is loaded from wording the firm changed, so the engagement page can say so from
-- the row itself rather than looking the firm's edits up again (which would change after a later edit).
--
-- Additive only: two new tables with their policies and grants, and one new column with a constant default (a metadata-only change on PostgreSQL 11
-- and later, so audit_procedures is not rewritten). Existing rows read false. Safe to run on the live database during a build while the old code is
-- serving: the old code never reads or writes any of it.
create table firm_procedures (
  firm_id uuid not null references firms(id),
  template_id text not null check (template_id ~ '^C[0-9]{1,2}\.[0-9]{2}$'),
  body text check (body is null or char_length(btrim(body)) between 1 and 2000),
  evidence text check (evidence is null or char_length(btrim(evidence)) between 1 and 300),
  reference text check (reference is null or char_length(reference) <= 300),
  hidden boolean not null default false,
  updated_by uuid not null references users(id),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (firm_id, template_id)
);

-- Every change, before and after, so the firm can show who changed its methodology and when. Rows are never changed or removed.
create table firm_procedure_history (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  template_id text not null,
  action text not null check (action in ('edit', 'hide', 'show', 'reset')),
  before_values jsonb,
  after_values jsonb,
  changed_by uuid not null references users(id),
  changed_at timestamptz not null default clock_timestamp()
);
create index firm_procedure_history_lookup on firm_procedure_history (firm_id, template_id, changed_at);

alter table audit_procedures add column firm_wording boolean not null default false;

alter table firm_procedures enable row level security;
alter table firm_procedure_history enable row level security;
create policy tenant on firm_procedures using (firm_id = current_firm_id()) with check (firm_id = current_firm_id());
create policy tenant on firm_procedure_history using (firm_id = current_firm_id()) with check (firm_id = current_firm_id());

grant select, insert, update, delete on firm_procedures to app_user;
grant select, insert on firm_procedure_history to app_user;
