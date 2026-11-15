-- External confirmations: a request sent to a third party (a bank, a customer, a supplier, a related party, a lawyer) for the
-- balance or information they hold, the reply, the difference from the books and how it was explained, or the alternative work
-- done when no reply came.
--
-- It belongs to an audited engagement. A confirmation has a preparer and a reviewer like a test schedule: contributors holds
-- everyone who has changed its substance, and a reviewer must differ from all of them where the firm has another reviewer.
-- Reply files are the engagement's existing working papers, linked through confirmation_files; the composite keys tie a linked file
-- to the same firm and engagement (a foreign key check does not go through row-level security).
create table confirmations (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  engagement_id uuid not null,
  seq integer not null check (seq > 0),
  reference text not null,
  kind text not null check (kind in ('bank', 'receivable', 'payable', 'related_party', 'legal', 'other')),
  -- An audit area code; the application checks it against the methodology areas.
  area_code text not null,
  party_name text not null check (char_length(party_name) between 1 and 200),
  contact text check (char_length(contact) <= 500),
  account_ref text check (char_length(account_ref) <= 100),
  -- Signed, as the client's books show it for that party.
  book_balance_minor bigint not null default 0,
  sent_on date,
  reminders date[] not null default '{}' check (cardinality(reminders) <= 5),
  reply text check (reply in ('agreed', 'differs', 'no_reply')),
  replied_on date,
  confirmed_balance_minor bigint,
  reconciliation text check (char_length(reconciliation) <= 4000),
  alternative_procedures text check (char_length(alternative_procedures) <= 4000),
  -- What the reply said beyond the amount.
  reply_note text check (char_length(reply_note) <= 2000),
  prepared_by uuid references users(id),
  prepared_at timestamptz,
  contributors uuid[] not null default '{}',
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  rolled_from_id uuid,
  created_by uuid not null references users(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (engagement_id, seq),
  unique (engagement_id, reference),
  unique (firm_id, id),
  unique (firm_id, engagement_id, id),
  foreign key (firm_id, engagement_id) references engagements (firm_id, id),
  foreign key (firm_id, rolled_from_id) references confirmations (firm_id, id) on delete set null (rolled_from_id),
  check (reply is null or sent_on is not null),
  check (replied_on is null or (sent_on is not null and replied_on >= sent_on)),
  -- Written with coalesce: a check that is NULL passes, so without it a null reply would let a reply date through.
  check ((coalesce(reply, '') in ('agreed', 'differs')) = (replied_on is not null)),
  check ((coalesce(reply, '') in ('agreed', 'differs')) = (confirmed_balance_minor is not null)),
  check (reply is not null or reply_note is null),
  check (reply is distinct from 'agreed' or confirmed_balance_minor = book_balance_minor),
  check (reply is distinct from 'differs' or confirmed_balance_minor <> book_balance_minor),
  check ((prepared_by is null) = (prepared_at is null)),
  check ((reviewed_by is null) = (reviewed_at is null)),
  check (reviewed_by is null or prepared_by is not null),
  check (prepared_by is null or reply is not null)
);
-- A prior-year confirmation is brought forward at most once into any one engagement.
create unique index confirmations_rolled_from on confirmations (engagement_id, rolled_from_id) where rolled_from_id is not null;
create index confirmations_engagement on confirmations (engagement_id, area_code, seq);

create table confirmation_files (
  firm_id uuid not null references firms(id),
  engagement_id uuid not null,
  confirmation_id uuid not null,
  working_paper_id uuid not null,
  linked_by uuid not null references users(id),
  linked_at timestamptz not null default clock_timestamp(),
  primary key (confirmation_id, working_paper_id),
  foreign key (firm_id, engagement_id, confirmation_id) references confirmations (firm_id, engagement_id, id) on delete cascade,
  foreign key (firm_id, engagement_id, working_paper_id) references working_papers (firm_id, engagement_id, id)
);
create index confirmation_files_paper on confirmation_files (working_paper_id);

alter table confirmations enable row level security;
alter table confirmation_files enable row level security;
create policy tenant on confirmations using (firm_id = current_firm_id()) with check (firm_id = current_firm_id());
create policy tenant on confirmation_files using (firm_id = current_firm_id()) with check (firm_id = current_firm_id());

grant select, insert, update, delete on confirmations to app_user;
grant select, insert, delete on confirmation_files to app_user;
