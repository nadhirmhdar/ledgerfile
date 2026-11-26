-- Review point threads: an append-only list of replies on a review point, so an earlier answer is no longer lost when someone answers again.
--
-- What it adds: one table, review_point_replies (select and insert only for the application, row-level security by firm), and a create-or-replace of
-- retention_counts() and purge_engagement() (0034) that ADDS the new table. Every other line of both functions is exactly as 0034 had it; the drift
-- test (tests/retention-drift.test.ts) requires the functions to cover every table that holds engagement data. Safe for db:setup-hosted on the live
-- database while an older build is serving: nothing existing is changed or copied, and the old code never reads the new table.
--
-- NO BACKFILL. A point that already has a single response (review_points.response) keeps it there, and the application shows it as the first
-- reply when it reads the point. review_points.response and responded_by stay, and mean "answered" as before: the application sets them from a
-- reply by someone other than the point's author, and clears them on a reply by the author.

create table review_point_replies (
  id bigint generated always as identity primary key,
  firm_id uuid not null references firms(id),
  engagement_id uuid not null,
  point_id uuid not null references review_points(id),
  author_id uuid not null references users(id),
  body text not null check (length(body) between 2 and 2000),
  -- True only for a response written before threads existed, copied here by the application when the point is first replied to.
  legacy boolean not null default false,
  written_at timestamptz not null default clock_timestamp(),
  foreign key (firm_id, engagement_id) references engagements (firm_id, id)
);
create index review_point_replies_point on review_point_replies (point_id, id);

alter table review_point_replies enable row level security;
create policy tenant on review_point_replies using (firm_id = current_firm_id()) with check (firm_id = current_firm_id());
-- A reply is never changed or removed: the thread is the record.
grant select, insert on review_point_replies to app_user;

-- retention_counts() and purge_engagement() as 0034 defined them, with one line added to each (the review_point_replies line, before review_points).
create or replace function retention_counts(p_engagement uuid) returns jsonb language plpgsql security definer set search_path = public as $$
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
    'review_point_replies', (select count(*) from review_point_replies where engagement_id = p_engagement and firm_id = v_firm),
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

create or replace function purge_engagement(p_engagement uuid, p_deletion bigint) returns jsonb language plpgsql security definer set search_path = public as $$
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
  delete from review_point_replies where engagement_id = p_engagement and firm_id = v_firm; get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('review_point_replies', n);
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
