-- Users are deactivated, never deleted: their sign-offs, review points and audit entries must remain.
alter table users add column active boolean not null default true;
grant select (active) on users to app_user;
