-- Misstatements identified during the audit, accumulated for evaluation against materiality.
create table misstatements (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  engagement_id uuid not null,
  description text not null,
  kind text not null check (kind in ('factual', 'judgemental', 'projected')),
  -- Effect on profit before tax in minor units: positive when profit is overstated, negative when understated.
  amount_minor bigint not null check (amount_minor <> 0),
  corrected boolean not null default false,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  foreign key (firm_id, engagement_id) references engagements (firm_id, id)
);

alter table misstatements enable row level security;
create policy tenant on misstatements using (firm_id = current_firm_id()) with check (firm_id = current_firm_id());

-- A misstatement, once recorded, stays on the file: it is marked corrected, never deleted.
grant select, insert, update on misstatements to app_user;
