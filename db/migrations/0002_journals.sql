-- Adjusting and reclassification journal entries posted by the engagement team.
-- These sit on top of the imported trial balance: adjusted balance = TB balance + journal lines.

-- Entry numbers are never reused, even after a deletion, so references in the file stay unambiguous.
alter table engagements add column last_journal_number int not null default 0;

create table journal_entries (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  engagement_id uuid not null,
  number int not null,
  type text not null check (type in ('adjusting', 'reclassification')),
  description text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (engagement_id, number),
  unique (firm_id, id),
  foreign key (firm_id, engagement_id) references engagements (firm_id, id)
);

-- Signed minor units: debit positive, credit negative. Lines of one entry sum to zero.
create table journal_lines (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  journal_entry_id uuid not null,
  account_id uuid not null,
  amount_minor bigint not null check (amount_minor <> 0),
  foreign key (firm_id, journal_entry_id) references journal_entries (firm_id, id) on delete cascade,
  -- No cascade from accounts: a trial balance cannot be replaced while journals refer to it.
  foreign key (firm_id, account_id) references accounts (firm_id, id)
);

alter table journal_entries enable row level security;
create policy tenant on journal_entries using (firm_id = current_firm_id()) with check (firm_id = current_firm_id());
alter table journal_lines enable row level security;
create policy tenant on journal_lines using (firm_id = current_firm_id()) with check (firm_id = current_firm_id());

grant select, insert, update, delete on journal_entries, journal_lines to app_user;
