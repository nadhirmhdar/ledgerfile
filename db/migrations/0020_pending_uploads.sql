-- Hosted uploads that go straight from the browser to the private Blob store.
--
-- The server chooses the storage key and records it here BEFORE the browser may write to it: the row is the permission. The row
-- says who may write which key, for which engagement and what the file is meant to support, how large it was declared to be, and
-- until when. The token route accepts only a key that has an unexpired row of the signed-in user, and finishing the upload deletes
-- the row in the same transaction that creates the working paper. A row that is never finished expires and is swept.
--
-- Additive only: one new table, its policy and grants. Nothing existing is altered, so it is safe to run on the live database
-- while an older build is still serving. app_auth gets nothing here; sign-in code never touches uploads.
create table pending_uploads (
  key text primary key check (key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  firm_id uuid not null references firms(id),
  engagement_id uuid not null,
  user_id uuid not null references users(id),
  target_kind text not null check (target_kind in ('engagement', 'lead_sheet', 'procedure')),
  target text,
  file_name text not null check (char_length(file_name) between 1 and 200),
  size_bytes bigint not null check (size_bytes > 0),
  description text check (char_length(description) <= 500),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  -- A key is the firm's id and a random id; the row cannot name another firm's prefix.
  check (split_part(key, '/', 1) = firm_id::text),
  check (expires_at > created_at),
  foreign key (firm_id, engagement_id) references engagements (firm_id, id)
);

create index pending_uploads_expiry on pending_uploads (firm_id, expires_at);

alter table pending_uploads enable row level security;
create policy tenant on pending_uploads using (firm_id = current_firm_id()) with check (firm_id = current_firm_id());

grant select, insert, delete on pending_uploads to app_user;
