-- A firm's own procedures, added to the methodology library's areas (C1 to C16; the checklists are not changed).
--
-- The library (src/domain/methodology-library.json) is not changed. A firm with no rows here sees exactly what it sees today, and every programme loads
-- as it always did. A row is one procedure the firm wrote for one area. Its id is made by the server from the area and a sequence number, for example
-- C1.F01, C1.F02: unique per firm and area, never reused (there is no delete, a procedure is retired instead), and unable to collide with a library id
-- (library ids end in two digits). It sorts after the area's library procedures.
--
-- Assertions are stored as the codes the library uses, and the server only accepts ones the library's own area already covers, so an area's risk
-- assessment still asks for exactly the same assertions. Evidence may not start "Partner sign-off": that wording makes a step the partner's own sign-off
-- (no review), and a firm's wording must never change a control. The checks here repeat what the server enforces.
--
-- Engagements keep what they were loaded with: loading COPIES the wording into audit_procedures, and a later edit or retirement here never rewrites
-- those rows. audit_procedures gets one flag, firm_added, set when a procedure is loaded from one of these, so the engagement page can say "Added by
-- your firm" from the row itself. It is separate from firm_wording (a firm's rewording of a library procedure), so the two read differently.
--
-- A new table and a new history table rather than a change to firm_procedures: that table's template_id check and its history's action check stay as
-- they are, so nothing already live is altered. Additive only: two new tables with their policies and grants, and one new column with a constant
-- default (a metadata-only change on PostgreSQL 11 and later, so audit_procedures is not rewritten). Safe to run on the live database during a build
-- while the old code is serving: the old code never reads or writes any of it.
create table firm_own_procedures (
  firm_id uuid not null references firms(id),
  area_code text not null check (area_code ~ '^C([1-9]|1[0-6])$'),
  seq integer not null check (seq between 1 and 30),
  tier text not null check (tier in ('core', 'extended', 'significant')),
  assertions text[] not null check (cardinality(assertions) >= 1),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  evidence text not null check (char_length(btrim(evidence)) between 1 and 300 and btrim(evidence) !~* '^Partner sign-off'),
  reference text not null check (char_length(reference) <= 300),
  retired boolean not null default false,
  created_by uuid not null references users(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references users(id),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (firm_id, area_code, seq)
);

-- Every change, before and after. Rows are never changed or removed.
create table firm_own_procedure_history (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  template_id text not null,
  action text not null check (action in ('add', 'edit', 'retire', 'restore')),
  before_values jsonb,
  after_values jsonb,
  changed_by uuid not null references users(id),
  changed_at timestamptz not null default clock_timestamp()
);
create index firm_own_procedure_history_lookup on firm_own_procedure_history (firm_id, template_id, changed_at);

alter table audit_procedures add column firm_added boolean not null default false;

alter table firm_own_procedures enable row level security;
alter table firm_own_procedure_history enable row level security;
create policy tenant on firm_own_procedures using (firm_id = current_firm_id()) with check (firm_id = current_firm_id());
create policy tenant on firm_own_procedure_history using (firm_id = current_firm_id()) with check (firm_id = current_firm_id());

grant select, insert, update on firm_own_procedures to app_user;
grant select, insert on firm_own_procedure_history to app_user;
