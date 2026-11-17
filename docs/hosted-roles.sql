-- Run once per database, AFTER `npm run db:migrate`, as the owner-level role that ran the migrations (Supabase: `postgres`).
--
--   psql "$DATABASE_URL_MIGRATIONS" -v app_password='<a long random password>' -f docs/hosted-roles.sql
--
-- It creates the login role the deployed app connects as, ledgerfile_app. That role owns nothing, is not a superuser and cannot bypass
-- row-level security. It reaches data only by switching, inside a transaction, to app_user (tenant work, through row-level security
-- and withFirm) or app_auth (sign-in, sessions, sign-up and user management, on four tables). It has NOINHERIT, so it holds no table
-- privilege of its own. The password is a psql variable: nothing secret is written here or stored in the repository.

select format('create role ledgerfile_app login password %L nosuperuser nocreatedb nocreaterole noinherit nobypassrls', :'app_password')
where not exists (select from pg_roles where rolname = 'ledgerfile_app') \gexec

-- Allow SET ROLE to the two application roles. Postgres 16 and later name the options; earlier versions have one form.
select format('grant %I to ledgerfile_app with inherit false, set true', r)
from unnest(array['app_user', 'app_auth']) as r
where current_setting('server_version_num')::int >= 160000 \gexec
select format('grant %I to ledgerfile_app', r)
from unnest(array['app_user', 'app_auth']) as r
where current_setting('server_version_num')::int < 160000 \gexec

-- The app checks at start that the database is at the migration the code expects.
grant select on schema_migrations to ledgerfile_app;

-- Supabase only: new tables in the public schema are readable by its API roles. LedgerFile does not use that API, so close it.
-- (Also remove `public` from the exposed schemas in Settings > API.)
select format('revoke all on all tables in schema public from %I', r)
from unnest(array['anon', 'authenticated']) as r
where exists (select from pg_roles where rolname = r) \gexec
select format('revoke all on all sequences in schema public from %I', r)
from unnest(array['anon', 'authenticated']) as r
where exists (select from pg_roles where rolname = r) \gexec
