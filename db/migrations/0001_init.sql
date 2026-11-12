-- LedgerFile schema, first slice.
-- Plain PostgreSQL: runs on PGlite in development and on managed Postgres in production.
-- Every tenant table carries firm_id and a row-level security policy. The application
-- connects as app_user, which does not own the tables, so the policies always apply.
-- Foreign keys between tenant tables include firm_id: referential checks bypass row-level
-- security, so a plain key would let one firm attach rows to another firm's records.

create role app_user nologin;

create table firms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  email text not null,
  name text not null,
  role text not null check (role in ('admin', 'partner', 'reviewer', 'preparer')),
  unique (firm_id, email)
);

create table clients (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  name text not null,
  framework text not null default 'IFRS for SMEs',
  created_at timestamptz not null default now(),
  unique (firm_id, id)
);

create table engagements (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  client_id uuid not null,
  period_start date not null,
  period_end date not null,
  status text not null default 'open' check (status in ('open', 'locked')),
  prior_engagement_id uuid,
  created_at timestamptz not null default now(),
  check (period_end > period_start),
  unique (firm_id, id),
  foreign key (firm_id, client_id) references clients (firm_id, id),
  foreign key (firm_id, prior_engagement_id) references engagements (firm_id, id)
);

-- Each import is kept; the latest one is the engagement's current trial balance.
create table tb_imports (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  engagement_id uuid not null,
  file_name text not null,
  row_count int not null,
  imported_at timestamptz not null default now(),
  unique (firm_id, id),
  foreign key (firm_id, engagement_id) references engagements (firm_id, id)
);

-- Balances are integer minor units (fils). Debits are positive, credits negative.
create table accounts (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  engagement_id uuid not null,
  tb_import_id uuid not null,
  code text not null,
  name text not null,
  closing_minor bigint not null,
  prior_minor bigint,
  unique (engagement_id, code),
  unique (firm_id, id),
  foreign key (firm_id, engagement_id) references engagements (firm_id, id),
  foreign key (firm_id, tb_import_id) references tb_imports (firm_id, id)
);

-- The standard grouping structure is system content shared by all firms: read-only to the app.
create table groups (
  code text primary key,
  name text not null,
  statement text not null check (statement in ('SFP', 'SCI')),
  section text not null,
  sort int not null
);

create table mappings (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  account_id uuid not null unique,
  group_code text not null references groups(code),
  source text not null check (source in ('prior_year', 'rule', 'ai', 'manual')),
  confidence numeric(3, 2) not null check (confidence between 0 and 1),
  approved boolean not null default false,
  foreign key (firm_id, account_id) references accounts (firm_id, id) on delete cascade
);

create table audit_log (
  id bigserial primary key,
  firm_id uuid not null references firms(id),
  user_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  detail jsonb,
  at timestamptz not null default now()
);

-- Row-level security -------------------------------------------------------

-- The firm for the current transaction. Unset or empty yields null, which matches no row.
create function current_firm_id() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.firm_id', true), '')::uuid $$;

alter table firms enable row level security;
create policy tenant on firms
  using (id = current_firm_id());

do $$
declare t text;
begin
  foreach t in array array['users', 'clients', 'engagements', 'tb_imports', 'accounts', 'mappings', 'audit_log']
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy tenant on %I using (firm_id = current_firm_id()) with check (firm_id = current_firm_id())',
      t
    );
  end loop;
end $$;

grant select on firms, groups to app_user;
grant select, insert, update, delete on users, clients, engagements, tb_imports, accounts, mappings to app_user;
-- The audit log is append-only for the application.
grant select, insert on audit_log to app_user;
grant usage on sequence audit_log_id_seq to app_user;
