-- Retention controls: a firm's own retention period, a two-person deletion of an archived engagement, and the one function that performs it.
--
-- NOTHING IS DELETED, AND NO PERIOD IS SET, BY THIS MIGRATION. firms.retention_years is nullable with no default, so every firm starts with no period and
-- nothing is ever "past retention" until the firm's administrator sets one. The clock runs from the date the file was archived (engagements.archived_at).
-- No legal period is stated here or anywhere in the application: the firm decides its own.
--
-- What it adds: one nullable column, five new tables, two new functions, and a create-or-replace of the archive guard (0022) that ADDS one allowed case.
-- Safe for db:setup-hosted on the live database while an older build is serving: the old code never reads any of it, and no existing row is touched.
--
--   firms.retention_years        the period in years (1 to 30), set by the administrator through the sign-in role
--   retention_deletions          append-only: a request (with a reason), and either its approval (a different partner-level person, who typed the
--                                client's name) or its cancellation. No foreign key to engagements, so it outlives the engagement it concerns.
--   retention_purges             the tombstone: who/what/when and how many rows of each table were removed. Written only by purge_engagement().
--   retention_files              the file-store keys of a purged engagement's files, written by purge_engagement(), so removing them after the commit
--   retention_file_removals      can be retried and is never silent: a key with no removal row is still to remove. Insert-only for the application.
--
-- purge_engagement(engagement, deletion) is the only way an archived engagement is ever deleted. It is security definer (owned by whoever runs this
-- migration), re-checks every condition itself, and deletes the engagement's rows from every table that holds them, children first. KEPT, on purpose:
-- the audit_log (the firm's record, including of the deletion, whose detail may still name the client) and the tombstone.

alter table firms add column retention_years integer check (retention_years is null or retention_years between 1 and 30);
grant update (retention_years) on firms to app_auth;

create table retention_deletions (
  id bigint generated always as identity primary key,
  firm_id uuid not null references firms(id),
  -- Deliberately no foreign key: this row must still be here after the engagement is gone.
  engagement_id uuid not null,
  kind text not null check (kind in ('requested', 'approved', 'cancelled')),
  -- An approval or cancellation points at its request. A request points at nothing.
  request_id bigint references retention_deletions(id),
  actor_id uuid not null references users(id),
  at timestamptz not null default clock_timestamp(),
  reason text check (reason is null or length(reason) between 1 and 1000),
  -- The client's name as the approver typed it; purge_engagement() compares it with the client's name again.
  confirmed_name text check (confirmed_name is null or length(confirmed_name) between 1 and 300),
  -- On a request: the client's name, the period, the archive date and what would be removed, as they were then.
  snapshot jsonb,
  check ((kind = 'requested') = (request_id is null)),
  check (kind <> 'requested' or (reason is not null and snapshot is not null)),
  check (kind <> 'approved' or confirmed_name is not null)
);
-- A request is approved once or cancelled once, never both and never twice.
create unique index retention_deletions_one_outcome on retention_deletions (request_id) where kind in ('approved', 'cancelled');
create index retention_deletions_engagement on retention_deletions (firm_id, engagement_id, id desc);

create table retention_purges (
  id bigint generated always as identity primary key,
  firm_id uuid not null references firms(id),
  engagement_id uuid not null unique,
  client_name text not null,
  period_start date not null,
  period_end date not null,
  archived_at timestamptz not null,
  deletion_id bigint not null unique references retention_deletions(id),
  purged_at timestamptz not null default clock_timestamp(),
  counts jsonb not null default '{}'::jsonb
);

create table retention_files (
  id bigint generated always as identity primary key,
  firm_id uuid not null references firms(id),
  purge_id bigint not null references retention_purges(id),
  key text not null unique
);

create table retention_file_removals (
  file_id bigint primary key references retention_files(id),
  firm_id uuid not null references firms(id),
  removed_at timestamptz not null default clock_timestamp()
);

do $$
declare t text;
begin
  foreach t in array array['retention_deletions', 'retention_purges', 'retention_files', 'retention_file_removals']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant on %I using (firm_id = current_firm_id()) with check (firm_id = current_firm_id())', t);
  end loop;
end $$;
grant select, insert on retention_deletions to app_user;
grant select on retention_purges, retention_files to app_user;
grant select, insert on retention_file_removals to app_user;

-- What purge_engagement() would remove, by table, for the engagement of the caller's firm. Shown with a request and on the page; it deletes nothing.
create function retention_counts(p_engagement uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_firm uuid := current_firm_id();
begin
  if v_firm is null or not exists (select 1 from engagements where id = p_engagement and firm_id = v_firm) then
    raise exception 'Engagement not found.';
  end if;
  return jsonb_build_object(
    'accounts', (select count(*) from accounts where engagement_id = p_engagement and firm_id = v_firm),
    'analytical_explanations', (select count(*) from analytical_explanations where engagement_id = p_engagement and firm_id = v_firm),
    'audit_opinions', (select count(*) from audit_opinions where engagement_id = p_engagement and firm_id = v_firm),
    'audit_procedures', (select count(*) from audit_procedures where engagement_id = p_engagement and firm_id = v_firm),
    'client_request_files', (select count(*) from client_request_files where engagement_id = p_engagement and firm_id = v_firm),
    'client_requests', (select count(*) from client_requests where engagement_id = p_engagement and firm_id = v_firm),
    'confirmation_files', (select count(*) from confirmation_files where engagement_id = p_engagement and firm_id = v_firm),
    'confirmations', (select count(*) from confirmations where engagement_id = p_engagement and firm_id = v_firm),
    'journal_entries', (select count(*) from journal_entries where engagement_id = p_engagement and firm_id = v_firm),
    'journal_tests', (select count(*) from journal_tests where engagement_id = p_engagement and firm_id = v_firm),
    'ledger_entries', (select count(*) from ledger_entries where engagement_id = p_engagement and firm_id = v_firm),
    'ledger_imports', (select count(*) from ledger_imports where engagement_id = p_engagement and firm_id = v_firm),
    'ledger_lines', (select count(*) from ledger_lines where engagement_id = p_engagement and firm_id = v_firm),
    'materiality', (select count(*) from materiality where engagement_id = p_engagement and firm_id = v_firm),
    'misstatements', (select count(*) from misstatements where engagement_id = p_engagement and firm_id = v_firm),
    'note_texts', (select count(*) from note_texts where engagement_id = p_engagement and firm_id = v_firm),
    'pending_uploads', (select count(*) from pending_uploads where engagement_id = p_engagement and firm_id = v_firm),
    'planning_answers', (select count(*) from planning_answers where engagement_id = p_engagement and firm_id = v_firm),
    'review_points', (select count(*) from review_points where engagement_id = p_engagement and firm_id = v_firm),
    'risk_approvals', (select count(*) from risk_approvals where engagement_id = p_engagement and firm_id = v_firm),
    'risk_assessments', (select count(*) from risk_assessments where engagement_id = p_engagement and firm_id = v_firm),
    'sign_offs', (select count(*) from sign_offs where engagement_id = p_engagement and firm_id = v_firm),
    'tb_imports', (select count(*) from tb_imports where engagement_id = p_engagement and firm_id = v_firm),
    'test_schedules', (select count(*) from test_schedules where engagement_id = p_engagement and firm_id = v_firm),
    'working_papers', (select count(*) from working_papers where engagement_id = p_engagement and firm_id = v_firm)
  );
end;
$$;

-- The deletion. Runs in the caller's transaction; if anything is wrong it raises and nothing is deleted.
create function purge_engagement(p_engagement uuid, p_deletion bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_firm uuid := current_firm_id();
  v_eng engagements%rowtype;
  v_years integer;
  v_req retention_deletions%rowtype;
  v_ok retention_deletions%rowtype;
  v_client text;
  v_purge bigint;
  v_counts jsonb := '{}'::jsonb;
  v_keys text[];
  n bigint;
begin
  -- 1. The engagement is this firm's. The caller's firm comes from the transaction, never from an argument.
  if v_firm is null then raise exception 'No firm is set for this transaction.'; end if;
  select * into v_eng from engagements where id = p_engagement and firm_id = v_firm for update;
  if not found then raise exception 'Engagement not found.'; end if;
  -- 2. It is archived: open and merely locked files are never eligible.
  if v_eng.archived_at is null then raise exception 'Only an archived file can be deleted.'; end if;
  -- 3. The firm's own retention period has passed, counted from the day the file was archived, read from the firm's row now.
  select retention_years into v_years from firms where id = v_firm;
  if v_years is null then raise exception 'The firm has not set a retention period, so nothing can be deleted.'; end if;
  if v_eng.archived_at + make_interval(years => v_years) > clock_timestamp() then raise exception 'This file is not yet past the firm''s retention period.'; end if;
  -- 4. The request is for this engagement, is approved by a different partner-level person who typed the client's name, and is neither cancelled nor used.
  select * into v_req from retention_deletions where id = p_deletion and firm_id = v_firm and engagement_id = p_engagement and kind = 'requested';
  if not found then raise exception 'There is no such deletion request for this file.'; end if;
  if exists (select 1 from retention_deletions where request_id = p_deletion and kind = 'cancelled') then raise exception 'This deletion request was cancelled.'; end if;
  select * into v_ok from retention_deletions where request_id = p_deletion and kind = 'approved';
  if not found then raise exception 'This deletion request has not been approved.'; end if;
  if v_ok.actor_id = v_req.actor_id then raise exception 'A request cannot be approved by the person who made it.'; end if;
  if not exists (select 1 from users where id = v_ok.actor_id and firm_id = v_firm and active and role in ('partner', 'admin')) then raise exception 'The approval is not from an active partner-level person.'; end if;
  if exists (select 1 from retention_purges where deletion_id = p_deletion or engagement_id = p_engagement) then raise exception 'This deletion has already been carried out.'; end if;
  select name into v_client from clients where id = v_eng.client_id and firm_id = v_firm;
  if v_client is null or v_ok.confirmed_name is distinct from v_client then raise exception 'The client''s name typed at approval does not match.'; end if;

  -- The tombstone and the file keys first, so the archive guard can see this deletion and so the keys survive a failure after the commit.
  insert into retention_purges (firm_id, engagement_id, client_name, period_start, period_end, archived_at, deletion_id)
    values (v_firm, p_engagement, v_client, v_eng.period_start, v_eng.period_end, v_eng.archived_at, p_deletion) returning id into v_purge;
  select coalesce(array_agg(k), '{}') into v_keys from (
    select storage_key as k from working_papers where engagement_id = p_engagement and firm_id = v_firm
    union select key as k from pending_uploads where engagement_id = p_engagement and firm_id = v_firm
  ) q;
  insert into retention_files (firm_id, purge_id, key) select v_firm, v_purge, unnest(v_keys);

  -- Only the archive guard reads these, and it also requires the tombstone above and that the statement is not run as the application role.
  perform set_config('app.purge', p_engagement::text, true);
  perform set_config('app.purge_deletion', p_deletion::text, true);

  -- Children first. Each count is what was removed.
  delete from client_request_files where engagement_id = p_engagement and firm_id = v_firm; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('client_request_files', n);
  delete from confirmation_files where engagement_id = p_engagement and firm_id = v_firm; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('confirmation_files', n);
  delete from test_schedule_lines where firm_id = v_firm and schedule_id in (select id from test_schedules where engagement_id = p_engagement and firm_id = v_firm); get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('test_schedule_lines', n);
  delete from test_schedules where engagement_id = p_engagement and firm_id = v_firm; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('test_schedules', n);
  delete from journal_lines where firm_id = v_firm and journal_entry_id in (select id from journal_entries where engagement_id = p_engagement and firm_id = v_firm); get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('journal_lines', n);
  delete from journal_entries where engagement_id = p_engagement and firm_id = v_firm; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('journal_entries', n);
  delete from journal_tests where engagement_id = p_engagement and firm_id = v_firm; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('journal_tests', n);
  delete from ledger_lines where engagement_id = p_engagement and firm_id = v_firm; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('ledger_lines', n);
  delete from ledger_entries where engagement_id = p_engagement and firm_id = v_firm; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('ledger_entries', n);
  delete from ledger_imports where engagement_id = p_engagement and firm_id = v_firm; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('ledger_imports', n);
  delete from mappings where firm_id = v_firm and account_id in (select id from accounts where engagement_id = p_engagement and firm_id = v_firm); get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('mappings', n);
  delete from accounts where engagement_id = p_engagement and firm_id = v_firm; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('accounts', n);
  delete from tb_imports where engagement_id = p_engagement and firm_id = v_firm; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('tb_imports', n);
  delete from client_requests where engagement_id = p_engagement and firm_id = v_firm; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('client_requests', n);
  delete from confirmations where engagement_id = p_engagement and firm_id = v_firm; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('confirmations', n);
  delete from working_papers where engagement_id = p_engagement and firm_id = v_firm; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('working_papers', n);
  delete from pending_uploads where engagement_id = p_engagement and firm_id = v_firm; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('pending_uploads', n);
  delete from audit_procedures where engagement_id = p_engagement and firm_id = v_firm; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('audit_procedures', n);
  delete from analytical_explanations where engagement_id = p_engagement and firm_id = v_firm; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('analytical_explanations', n);
  delete from audit_opinions where engagement_id = p_engagement and firm_id = v_firm; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('audit_opinions', n);
  delete from materiality where engagement_id = p_engagement and firm_id = v_firm; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('materiality', n);
  delete from misstatements where engagement_id = p_engagement and firm_id = v_firm; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('misstatements', n);
  delete from note_texts where engagement_id = p_engagement and firm_id = v_firm; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('note_texts', n);
  delete from planning_answers where engagement_id = p_engagement and firm_id = v_firm; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('planning_answers', n);
  delete from review_points where engagement_id = p_engagement and firm_id = v_firm; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('review_points', n);
  delete from risk_approvals where engagement_id = p_engagement and firm_id = v_firm; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('risk_approvals', n);
  delete from risk_assessments where engagement_id = p_engagement and firm_id = v_firm; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('risk_assessments', n);
  delete from sign_offs where engagement_id = p_engagement and firm_id = v_firm; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('sign_offs', n);

  -- A later year's file that was linked to this one as its prior year keeps working: it simply has no prior link now.
  update engagements set prior_engagement_id = null where prior_engagement_id = p_engagement and firm_id = v_firm; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('prior_links_cleared', n);
  delete from engagements where id = p_engagement and firm_id = v_firm; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('engagements', n);
  if n <> 1 then raise exception 'The engagement could not be deleted.'; end if;

  update retention_purges set counts = v_counts where id = v_purge;
  perform set_config('app.purge', '', true);
  perform set_config('app.purge_deletion', '', true);
  return jsonb_build_object('purgeId', v_purge, 'keys', to_jsonb(v_keys), 'counts', v_counts);
end;
$$;

revoke all on function retention_counts(uuid) from public;
revoke all on function purge_engagement(uuid, bigint) from public;
grant execute on function retention_counts(uuid) to app_user;
grant execute on function purge_engagement(uuid, bigint) to app_user;

-- The archive guard (0022), with ONE case added: a delete of an archived row is allowed only inside purge_engagement(). Every other refusal below is
-- exactly as it was. The case needs all of: the row is being deleted as the function's owner (never as the application's roles, so a value set by
-- the application's own session is of no use), the two local settings only the function sets name this engagement and a deletion, and that deletion's
-- tombstone already exists for this engagement.
create or replace function engagements_archive_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.archived_at is not null then
      if current_user not in ('app_user', 'app_auth')
         and current_setting('app.purge', true) = old.id::text
         and exists (
           select 1 from retention_purges p
           where p.engagement_id = old.id and p.firm_id = old.firm_id and p.deletion_id::text = current_setting('app.purge_deletion', true)
         ) then
        return old;
      end if;
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
