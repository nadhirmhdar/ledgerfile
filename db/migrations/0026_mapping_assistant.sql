-- The mapping assistant: suggestions made inside the app from the firm's own approved mappings (no outside service).
--
-- A new source value, 'assistant' (the check is widened; 'ai' stays allowed so old rows read as they always did), a short plain-language reason for each
-- suggestion, and who accepted a mapping and when (approved_by, approved_at). Rows that already exist keep null for all three: nothing is rewritten,
-- and an approved mapping from before simply has no recorded approver.
--
-- Additive and safe for db:setup-hosted on the live database: three nullable columns (metadata only, no table rewrite) and one check constraint dropped
-- and added again wider, so every existing row still satisfies it. The old code never reads the new columns and never writes 'assistant'.
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'mappings'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%source%' loop
    execute format('alter table mappings drop constraint %I', c.conname);
  end loop;
end $$;
alter table mappings add constraint mappings_source_check check (source in ('prior_year', 'rule', 'ai', 'manual', 'assistant'));
alter table mappings add column reason text check (reason is null or char_length(reason) <= 500);
alter table mappings add column approved_by uuid references users(id);
alter table mappings add column approved_at timestamptz;
