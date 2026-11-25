-- The firm's record of adopting the methodology library: which version, what it covered, who and when.
--
-- Append-only. An adoption is a row of kind 'adopted' with the exact statement the partner confirmed; withdrawing it is a new row of kind 'withdrawn' with
-- the reason. The current state is the latest row. Nothing is ever updated or deleted (the application role may only select and insert), so the history
-- is the table.
--
-- library_version is the library's own version; fingerprint is a SHA-256 of the library together with the firm's changes to it (wording edits, hidden
-- procedures, its own procedures) at that moment, so a later change to either shows as "changed since adoption". change_count is how many firm changes
-- the fingerprint covered, to say in words what changed. The server checks every value; the table only keeps them.
--
-- Additive and safe for db:setup-hosted on the live database: one new table with its policy and grants. The old code never reads it, and a firm with no
-- rows is simply "not adopted". The number is 0033 because 0032 belongs to the editable notes change; the runner applies files in name order and only
-- checks the newest name, so a gap is safe.
create table methodology_adoptions (
  id bigint generated always as identity primary key,
  firm_id uuid not null references firms(id),
  kind text not null check (kind in ('adopted', 'withdrawn')),
  library_version text not null check (length(library_version) between 1 and 40),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  change_count integer not null check (change_count >= 0),
  statement text check (statement is null or length(statement) between 1 and 1000),
  note text check (note is null or length(note) between 1 and 1000),
  reason text check (reason is null or length(reason) between 1 and 1000),
  written_by uuid not null references users(id),
  written_at timestamptz not null default clock_timestamp(),
  check ((kind = 'adopted' and statement is not null and reason is null) or (kind = 'withdrawn' and reason is not null and statement is null and note is null))
);
create index methodology_adoptions_firm on methodology_adoptions (firm_id, id desc);

alter table methodology_adoptions enable row level security;
create policy tenant on methodology_adoptions using (firm_id = current_firm_id()) with check (firm_id = current_firm_id());
grant select, insert on methodology_adoptions to app_user;
