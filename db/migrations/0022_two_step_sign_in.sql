-- Two-step sign-in, the foundations. Nobody's sign-in changes with this migration: nothing reads these tables yet except the tests, and
-- every firm starts with the requirement off.
--
-- Additive only: three new tables, one new column with a constant default (a metadata-only change on PostgreSQL 11 and later, so it does
-- not rewrite the firms table), and a unique constraint on users (firm_id, id) so the new tables can tie a row to a user of the same firm
-- with a composite foreign key, as other tables do. users.id is already the primary key, so the constraint can never be violated by
-- existing rows; it takes a brief lock on a small table. Safe to run on the live database during a build while the old code is serving.
--
-- Who may touch what (see 0019 for the sign-in design):
--   app_auth   runs the sign-in step and the account changes with no firm context (withAuth). It gets exactly what those need on these
--              tables, through app_auth-only policies. Enrolment, the second-step check, disabling, and an administrator's reset all
--              run as app_auth, like change-password does.
--   app_user   (tenant work, withFirm) may read only the non-secret columns, and only its own firm's rows, so a page can say whether a
--              colleague has two-step sign-in on. It can never read secret_ciphertext, code_hash, salt, the attempt counters or the last
--              accepted step, and it cannot write anything here.
alter table users add constraint users_firm_id_id_key unique (firm_id, id);

alter table firms add column mfa_required boolean not null default false;

-- One authenticator secret per user. enabled_at stays null until the user confirms a first code: an unconfirmed secret does not count as
-- two-step sign-in. The secret is AES-256-GCM ciphertext, "v1:<iv>:<tag>:<ciphertext>" in base64, never the secret itself.
create table user_mfa (
  user_id uuid primary key references users(id) on delete cascade,
  firm_id uuid not null references firms(id),
  secret_ciphertext text not null check (secret_ciphertext ~ '^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$'),
  enabled_at timestamptz,
  -- The last time step accepted, so a code cannot be used twice within its window.
  last_step bigint,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (firm_id, user_id) references users (firm_id, id)
);

-- Single-use recovery codes, kept only as a salted SHA-256 (the codes are random values of well over 60 bits, so a slow hash adds nothing).
create table mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  firm_id uuid not null references firms(id),
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  salt text not null check (salt ~ '^[0-9a-f]{32}$'),
  used_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (firm_id, user_id) references users (firm_id, id)
);
create index mfa_recovery_codes_user on mfa_recovery_codes (user_id);

-- The half-signed-in state between the password and the code (used by the sign-in step in a later slice). Only a hash of the token is kept.
create table pending_sign_ins (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  firm_id uuid not null references firms(id),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (firm_id, user_id) references users (firm_id, id)
);
create index pending_sign_ins_expiry on pending_sign_ins (expires_at);

alter table user_mfa enable row level security;
alter table mfa_recovery_codes enable row level security;
alter table pending_sign_ins enable row level security;

-- Tenant work reads its own firm's non-secret columns.
create policy tenant on user_mfa for select to app_user using (firm_id = current_firm_id());
create policy tenant on mfa_recovery_codes for select to app_user using (firm_id = current_firm_id());
grant select (user_id, firm_id, enabled_at, created_at) on user_mfa to app_user;
grant select (id, user_id, firm_id, used_at, created_at) on mfa_recovery_codes to app_user;

-- The sign-in role works with no firm context, so its policies are not tied to one.
create policy auth_access on user_mfa to app_auth using (true) with check (true);
grant select, insert, update, delete on user_mfa to app_auth;
create policy auth_access on mfa_recovery_codes to app_auth using (true) with check (true);
grant select, insert, update, delete on mfa_recovery_codes to app_auth;
create policy auth_access on pending_sign_ins to app_auth using (true) with check (true);
grant select, insert, update, delete on pending_sign_ins to app_auth;
