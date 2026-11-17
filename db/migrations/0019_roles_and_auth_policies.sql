-- Hosted databases: let the authentication code run without owning the tables.
--
-- Until now sign-in, sessions, sign-up and user management ran as the connecting role, which owns every table and so is not
-- subject to row-level security. A hosted deployment should connect as a login role that owns nothing, so those paths run as
-- app_auth instead: a role with exactly the access they need, on four tables, and nothing on tenant data.
--
--   firms       select, insert   (find a firm's name; register a new firm)
--   users       select, insert, update   (sign-in, lockout, passwords, roles, deactivation)
--   sessions    select, insert, delete
--   audit_log   insert only      (never read back or changed)
--
-- app_user keeps its existing access: it has no access to sessions and cannot read password hashes. Neither role owns a table,
-- is a superuser, or has BYPASSRLS.

do $$
begin
  if not exists (select from pg_roles where rolname = 'app_auth') then
    create role app_auth nologin;
  end if;
end $$;

grant select, insert on firms to app_auth;
create policy auth_access on firms to app_auth using (true) with check (true);

grant select, insert, update on users to app_auth;
create policy auth_access on users to app_auth using (true) with check (true);

grant select, insert, delete on sessions to app_auth;
create policy auth_access on sessions to app_auth using (true) with check (true);

grant insert on audit_log to app_auth;
grant usage on sequence audit_log_id_seq to app_auth;
create policy auth_insert on audit_log for insert to app_auth with check (true);

-- The role that runs migrations also runs the owner-level scripts (seeding, tests) that switch into these roles. On Postgres 16 and
-- later a role that creates another role does not get the right to SET ROLE to it automatically, so grant it. A superuser needs
-- nothing. If the role cannot grant (the roles already existed under another owner), carry on: the runtime login role is granted
-- its own membership by the deployment SQL, and the application never depends on this.
do $$
declare r text;
begin
  if (select rolsuper from pg_roles where rolname = current_user) then
    return;
  end if;
  foreach r in array array['app_user', 'app_auth'] loop
    begin
      if current_setting('server_version_num')::int >= 160000 then
        execute format('grant %I to %I with inherit false, set true', r, current_user);
      else
        execute format('grant %I to %I', r, current_user);
      end if;
    exception when others then
      raise notice 'could not grant % to %: %', r, current_user, sqlerrm;
    end;
  end loop;
end $$;
