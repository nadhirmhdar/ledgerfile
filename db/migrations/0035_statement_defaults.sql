-- The firm's statement defaults: the presentation currency, the rounding and the default wording of the notes, applied to NEW engagements only.
--
-- Firm level (what the firm sets): firms.statement_currency (three capital letters) and firms.statement_unit ('exact' or 'whole'), both nullable with no
-- default, and an append-only firm_note_defaults table (a new version for each change, never an update or delete, so the history is the table). A version
-- with no paragraphs means "use the generated wording". Note keys are PR 76's: general, basis, policies, policy:<slug>.
--
-- Engagement level (a SNAPSHOT taken when an engagement is created): engagements.currency and engagements.statement_unit, nullable, and a nullable
-- note_texts.source ('person' or 'firm_default'; existing rows stay null, which means person). The defaults are copied, never referenced, so a later
-- change to the firm's defaults never alters an existing file, and an engagement created before this migration has none of them (no backfill). The
-- engagement-level values are COLUMNS on engagements rather than a new table, so the retention purge (which deletes the engagement row) already covers them.
--
-- Additive and safe for db:setup-hosted on the live database while an older build is serving: nullable columns and one new table. The application role
-- gets update on the two firm columns only (a partner changes them; the firm row's other columns stay read-only to it).
alter table firms add column statement_currency text check (statement_currency is null or statement_currency ~ '^[A-Z]{3}$');
alter table firms add column statement_unit text check (statement_unit is null or statement_unit in ('exact', 'whole'));
grant update (statement_currency, statement_unit) on firms to app_user;

alter table engagements add column currency text check (currency is null or currency ~ '^[A-Z]{3}$');
alter table engagements add column statement_unit text check (statement_unit is null or statement_unit in ('exact', 'whole'));

alter table note_texts add column source text check (source is null or source in ('person', 'firm_default'));

create table firm_note_defaults (
  id bigint generated always as identity primary key,
  firm_id uuid not null references firms(id),
  note_key text not null check (note_key ~ '^(general|basis|policies|policy:[a-z0-9-]{1,80})$'),
  version integer not null check (version >= 1),
  paragraphs jsonb not null check (jsonb_typeof(paragraphs) = 'array' and jsonb_array_length(paragraphs) <= 20),
  written_by uuid not null references users(id),
  written_at timestamptz not null default clock_timestamp(),
  unique (firm_id, note_key, version)
);

alter table firm_note_defaults enable row level security;
create policy tenant on firm_note_defaults using (firm_id = current_firm_id()) with check (firm_id = current_firm_id());
grant select, insert on firm_note_defaults to app_user;
