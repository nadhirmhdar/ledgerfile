-- Sign-in: passwords, lockout and sessions.

alter table users add column password_hash text;
alter table users add column failed_attempts int not null default 0;
alter table users add column locked_until timestamptz;
alter table users add column created_at timestamptz not null default now();

-- One account per email address across all firms, so sign-in needs only email and password.
create unique index users_email_unique on users (lower(email));

-- Sessions are looked up before the firm is known, so they are handled only by the
-- authentication code running as the table owner. The application role has no access.
create table sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  firm_id uuid not null references firms(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table sessions enable row level security;

-- The application role may read who is in the firm, but never password hashes or lockout
-- state, and it cannot create or change users: that goes through the authentication code.
revoke all on users from app_user;
grant select (id, firm_id, email, name, role, created_at) on users to app_user;
