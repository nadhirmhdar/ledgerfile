-- Working papers: evidence files attached to an engagement, one of its lead sheets, or an audit procedure.
-- The file's bytes are kept in the file store; this table holds what identifies and describes it.
create table working_papers (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  engagement_id uuid not null,
  -- What the file supports: the engagement generally, a lead sheet (group code), or an audit procedure (its id).
  target_kind text not null check (target_kind in ('engagement', 'lead_sheet', 'procedure')),
  target text,
  file_name text not null,
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text not null,
  storage_key text not null unique,
  description text,
  uploaded_by uuid not null references users(id),
  uploaded_at timestamptz not null default now(),
  foreign key (firm_id, engagement_id) references engagements (firm_id, id),
  check ((target_kind = 'engagement') = (target is null))
);

alter table working_papers enable row level security;
create policy tenant on working_papers using (firm_id = current_firm_id()) with check (firm_id = current_firm_id());

grant select, insert, delete on working_papers to app_user;
