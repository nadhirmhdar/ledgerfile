-- Editable notes text: the wording of a passage in the notes to the financial statements, written by a person.
--
-- Append-only. Every save, restore and "go back to the generated wording" is a new row with the next version for that engagement and passage; nothing is
-- ever updated or deleted (the application role may only select and insert), so the history is the table. The current text of a passage is its highest
-- version. A version with is_generated set is the marker for "back to the generated wording": it has no paragraphs and the statements use the generated
-- words again.
--
-- note_key names a passage without depending on note numbers: general, basis, policies (the introduction to the policies), policy:<slug> and group:<CODE>.
-- paragraphs is a JSON array of strings; the server checks the count and length, the table checks the shape.
--
-- Additive and safe for db:setup-hosted on the live database: one new table with its policy, an index and grants. The old code never reads it, and an
-- engagement with no rows simply keeps the generated wording. The migration number is 0032 because 0031 belongs to the engagement team change; the
-- runner applies files in name order and only checks the newest name, so a gap is safe.
create table note_texts (
  id bigint generated always as identity primary key,
  firm_id uuid not null references firms(id),
  engagement_id uuid not null,
  note_key text not null check (note_key ~ '^(general|basis|policies|policy:[a-z0-9-]{1,80}|group:[A-Z0-9_]{1,40})$'),
  version integer not null check (version >= 1),
  paragraphs jsonb not null check (jsonb_typeof(paragraphs) = 'array' and jsonb_array_length(paragraphs) <= 20),
  is_generated boolean not null default false,
  written_by uuid not null references users(id),
  written_at timestamptz not null default clock_timestamp(),
  unique (engagement_id, note_key, version),
  check (not is_generated or jsonb_array_length(paragraphs) = 0),
  foreign key (firm_id, engagement_id) references engagements (firm_id, id)
);

alter table note_texts enable row level security;
create policy tenant on note_texts using (firm_id = current_firm_id()) with check (firm_id = current_firm_id());
grant select, insert on note_texts to app_user;
