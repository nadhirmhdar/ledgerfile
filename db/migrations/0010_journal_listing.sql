-- The client's own journal listing, imported for testing journal entries (management override).
-- Separate from journal_entries, which holds the engagement team's adjusting entries.

create table ledger_imports (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  engagement_id uuid not null,
  file_name text not null,
  line_count int not null,
  entry_count int not null,
  imported_by uuid not null references users(id),
  imported_at timestamptz not null default now(),
  unique (firm_id, id),
  foreign key (firm_id, engagement_id) references engagements (firm_id, id)
);

create table ledger_lines (
  id bigserial primary key,
  firm_id uuid not null references firms(id),
  engagement_id uuid not null,
  import_id uuid not null,
  entry_no text not null,
  entry_date date not null,
  posted_by text,
  description text,
  account_code text not null,
  account_name text,
  amount_minor bigint not null,
  foreign key (firm_id, import_id) references ledger_imports (firm_id, id) on delete cascade
);
create index ledger_lines_entry on ledger_lines (engagement_id, entry_no);

-- One row per entry in the listing, with the risk characteristics found at import.
create table ledger_entries (
  id bigserial primary key,
  firm_id uuid not null references firms(id),
  engagement_id uuid not null,
  import_id uuid not null,
  entry_no text not null,
  entry_date date not null,
  posted_by text,
  description text,
  total_minor bigint not null,
  line_count int not null,
  -- Comma-separated flag codes; empty when the entry shows none.
  flags text not null default '',
  unique (engagement_id, entry_no),
  foreign key (firm_id, import_id) references ledger_imports (firm_id, id) on delete cascade
);

-- An entry chosen for testing, and the conclusion once it has been tested.
create table journal_tests (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  engagement_id uuid not null,
  entry_no text not null,
  -- The flags the entry showed when it was selected, kept even if the listing is later replaced.
  flags text not null,
  work_done text,
  conclusion text,
  selected_by uuid not null references users(id),
  selected_at timestamptz not null default now(),
  tested_by uuid references users(id),
  tested_at timestamptz,
  unique (engagement_id, entry_no),
  foreign key (firm_id, engagement_id) references engagements (firm_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['ledger_imports', 'ledger_lines', 'ledger_entries', 'journal_tests']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant on %I using (firm_id = current_firm_id()) with check (firm_id = current_firm_id())', t);
  end loop;
end $$;

grant select, insert, delete on ledger_imports, ledger_lines, ledger_entries to app_user;
grant usage on sequence ledger_lines_id_seq, ledger_entries_id_seq to app_user;
grant select, insert, update, delete on journal_tests to app_user;
