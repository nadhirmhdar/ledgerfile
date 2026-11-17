-- Archiving: the permanent lock that follows a lock once the file has been assembled.
--
-- NOTHING IS ARCHIVED BY THIS MIGRATION. The two new columns are nullable, with no default and no backfill, so every existing engagement,
-- locked or not, keeps archived_at null. A file is archived only by the explicit, confirmed action in the application.
--
-- Additive only: two nullable columns (a metadata-only change on PostgreSQL, no table rewrite and no scan), one function and one trigger.
-- The trigger only fires when a row that already has archived_at set is changed or deleted, or when archived_at is being set, so on a database
-- where nothing is archived it changes nothing about any existing statement. Safe to run on the live database during a build while the old
-- code is serving: the old code never touches the new columns.
alter table engagements add column archived_at timestamptz;
alter table engagements add column archived_by uuid references users(id);

-- A last line of defence below the application. Once archived, a file cannot be unlocked, re-dated, re-attributed or deleted, whatever code
-- or role tries. Other changes to an archived row stay with the application's own locked-engagement checks.
create function engagements_archive_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.archived_at is not null then
      raise exception 'This file is archived. Archived files cannot be deleted.';
    end if;
    return old;
  end if;
  if old.archived_at is not null then
    if new.status is distinct from old.status
       or new.archived_at is distinct from old.archived_at
       or new.archived_by is distinct from old.archived_by
       or new.locked_at is distinct from old.locked_at
       or new.locked_by is distinct from old.locked_by then
      raise exception 'This file is archived. Archived files cannot be unlocked or changed.';
    end if;
    return new;
  end if;
  if new.archived_at is not null and new.status is distinct from 'locked' then
    raise exception 'A file can be archived only after it has been locked.';
  end if;
  return new;
end;
$$;

create trigger engagements_archive_guard before update or delete on engagements for each row execute function engagements_archive_guard();
