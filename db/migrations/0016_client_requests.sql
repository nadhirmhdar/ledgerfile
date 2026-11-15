-- The client request list: the documents and information the audit team asks the client for on an engagement, who asked,
-- when it is due, whether it has arrived, and which received files answer it.
--
-- It is kept for any engagement, audited or not: a compilation job needs a request list as much as an audit does. Received
-- files are the engagement's existing working papers (the link table points at them); there is no second upload store.
create table client_requests (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id),
  engagement_id uuid not null,
  -- Running number within the engagement (one more than the highest still on the list) and the reference built from it, such as R-1.
  seq integer not null check (seq > 0),
  reference text not null,
  -- An audit area code (C1 to C16); null for a general request.
  area_code text,
  description text not null check (char_length(btrim(description)) between 1 and 500),
  requested_by uuid not null references users(id),
  requested_on date not null,
  due_on date,
  status text not null default 'open' check (status in ('open', 'received', 'not_applicable')),
  received_on date,
  note text check (note is null or char_length(note) <= 1000),
  -- The request this one was brought forward from, in the prior-year engagement.
  rolled_from_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (engagement_id, seq),
  unique (engagement_id, reference),
  unique (firm_id, id),
  unique (firm_id, engagement_id, id),
  foreign key (firm_id, engagement_id) references engagements (firm_id, id),
  foreign key (firm_id, rolled_from_id) references client_requests (firm_id, id) on delete set null (rolled_from_id),
  check (due_on is null or due_on >= requested_on),
  -- Nothing arrives before it is asked for.
  check (received_on is null or received_on >= requested_on),
  -- A received date goes with the received status and with nothing else.
  check ((status = 'received') = (received_on is not null)),
  -- Not applicable needs the reason.
  check (status <> 'not_applicable' or (note is not null and char_length(btrim(note)) > 0))
);
create index client_requests_engagement on client_requests (engagement_id, seq);

-- A prior-year request is brought forward at most once into any one engagement.
create unique index client_requests_rolled_from on client_requests (engagement_id, rolled_from_id) where rolled_from_id is not null;

-- Which received files answer a request. The application checks the file is on the same engagement, and refuses to remove a
-- file while it is linked here.
-- A linked file must be on the same firm and engagement as the request, which the keys below enforce (a foreign key check does not
-- go through row-level security, so the application check alone would not be enough).
alter table working_papers add unique (firm_id, engagement_id, id);

create table client_request_files (
  firm_id uuid not null references firms(id),
  engagement_id uuid not null,
  request_id uuid not null,
  working_paper_id uuid not null,
  linked_by uuid not null references users(id),
  linked_at timestamptz not null default clock_timestamp(),
  primary key (request_id, working_paper_id),
  foreign key (firm_id, engagement_id, request_id) references client_requests (firm_id, engagement_id, id) on delete cascade,
  foreign key (firm_id, engagement_id, working_paper_id) references working_papers (firm_id, engagement_id, id)
);
create index client_request_files_paper on client_request_files (working_paper_id);

alter table client_requests enable row level security;
alter table client_request_files enable row level security;
create policy tenant on client_requests using (firm_id = current_firm_id()) with check (firm_id = current_firm_id());
create policy tenant on client_request_files using (firm_id = current_firm_id()) with check (firm_id = current_firm_id());

grant select, insert, update, delete on client_requests to app_user;
grant select, insert, delete on client_request_files to app_user;
