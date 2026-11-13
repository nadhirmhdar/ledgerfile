-- Audit engine: materiality, risk assessment and audit programmes.

-- Not every engagement is an audit. The audit work applies, and holds up the lock, only when this is on.
alter table engagements add column audit_enabled boolean not null default false;

-- Each change to materiality adds a row; the latest row is the one in force. Earlier rows are the revision history.
create table materiality (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  engagement_id uuid not null,
  benchmark text not null check (benchmark in ('pbt', 'revenue', 'assets', 'equity')),
  benchmark_amount_minor bigint not null check (benchmark_amount_minor > 0),
  percentage_bp int not null,
  performance_pct int not null,
  trivial_pct int not null,
  overall_minor bigint not null,
  performance_minor bigint not null,
  trivial_minor bigint not null,
  rationale text not null,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  foreign key (firm_id, engagement_id) references engagements (firm_id, id)
);

-- One rating per methodology area and assertion.
create table risk_assessments (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  engagement_id uuid not null,
  area_code text not null,
  assertion text not null,
  level text not null check (level in ('low', 'moderate', 'high', 'significant')),
  updated_by uuid not null references users(id),
  updated_at timestamptz not null default now(),
  unique (engagement_id, area_code, assertion),
  foreign key (firm_id, engagement_id) references engagements (firm_id, id)
);

-- A procedure on an engagement's audit programme. The wording is copied from the methodology
-- library when the procedure is loaded, so the file keeps the wording it was performed under.
create table audit_procedures (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  engagement_id uuid not null,
  area_code text not null,
  template_id text not null,
  tier text not null check (tier in ('core', 'extended', 'significant')),
  assertions text not null,
  body text not null,
  evidence text not null,
  reference text not null,
  status text not null default 'open' check (status in ('open', 'done', 'na')),
  work_done text,
  conclusion text,
  performed_by uuid references users(id),
  performed_at timestamptz,
  unique (engagement_id, template_id),
  foreign key (firm_id, engagement_id) references engagements (firm_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['materiality', 'risk_assessments', 'audit_procedures']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant on %I using (firm_id = current_firm_id()) with check (firm_id = current_firm_id())', t);
  end loop;
end $$;

-- Materiality revisions are never changed or removed.
grant select, insert on materiality to app_user;
grant select, insert, update, delete on risk_assessments, audit_procedures to app_user;
