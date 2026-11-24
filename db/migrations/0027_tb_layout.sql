-- Trial balance columns, remembered per client.
--
-- clients.tb_layout holds the heading text for each role (account code, account name, debit, credit, balance, prior year), the columns they were in and
-- the heading row, from the last import that read the client's file. The next upload for any engagement of that client tries these headings first,
-- then the automatic detection, then asks. tb_layout_updated_at says when it was saved. tb_imports.layout records what each import used and how it
-- was found (remembered, detected or chosen), so the page can say so.
--
-- Additive only and safe for db:setup-hosted on the live database: three nullable columns with no default (metadata only, no table rewrite). Existing
-- rows read null, which means "nothing remembered": every upload then behaves exactly as it did. The old code never reads or writes any of it.
alter table clients add column tb_layout jsonb;
alter table clients add column tb_layout_updated_at timestamptz;
alter table tb_imports add column layout jsonb;
