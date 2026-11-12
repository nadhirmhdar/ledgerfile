-- Sign-offs, review points and engagement lock.

-- A sign-off is one person's confirmation at one level on one lead sheet (target = group code).
create table sign_offs (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  engagement_id uuid not null,
  target text not null,
  level text not null check (level in ('preparer', 'reviewer')),
  user_id uuid not null references users(id),
  signed_at timestamptz not null default now(),
  unique (engagement_id, target, level),
  foreign key (firm_id, engagement_id) references engagements (firm_id, id)
);

-- A review point is a query raised on a lead sheet (or on the engagement generally) that must
-- be cleared before the lead sheet can be reviewed and the file locked.
create table review_points (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  engagement_id uuid not null,
  target text not null,
  author_id uuid not null references users(id),
  body text not null,
  response text,
  responded_by uuid references users(id),
  status text not null default 'open' check (status in ('open', 'cleared')),
  cleared_by uuid references users(id),
  created_at timestamptz not null default now(),
  cleared_at timestamptz,
  foreign key (firm_id, engagement_id) references engagements (firm_id, id)
);

alter table engagements add column locked_by uuid references users(id);
alter table engagements add column locked_at timestamptz;

alter table sign_offs enable row level security;
create policy tenant on sign_offs using (firm_id = current_firm_id()) with check (firm_id = current_firm_id());
alter table review_points enable row level security;
create policy tenant on review_points using (firm_id = current_firm_id()) with check (firm_id = current_firm_id());

grant select, insert, delete on sign_offs to app_user;
-- Review points are never deleted: they are answered and cleared, and stay on the file.
grant select, insert, update on review_points to app_user;
