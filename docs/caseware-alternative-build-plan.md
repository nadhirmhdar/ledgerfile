# Build Plan: A Cloud Alternative to CaseWare

Working name: **LedgerFile** (placeholder). Drafted 12 November 2026.

## Assumptions

The prompt's bracketed details were left blank, so this plan assumes the following. Change any of them and the affected sections are noted.

| # | Assumption | Affects |
|---|---|---|
| A1 | First market is UAE, then wider GCC | Sections 7, 8, 11 |
| A2 | Target firm has 5-50 staff and 50-500 engagements a year | Sections 4, 11 |
| A3 | Build team is 2 full-stack developers using AI coding tools, plus you as product owner and domain expert | Section 10 |
| A4 | MVP imports Excel/CSV trial balances only; no CaseWare file import | Sections 2, 9 |
| A5 | First reporting framework is IFRS for SMEs; full IFRS follows | Sections 2, 7 |
| A6 | Client data must stay in a UAE cloud region | Sections 4, 6, 8 |
| A7 | No fixed budget or launch date has been set | Section 10 |
| A8 | The audit programme content is drafted with AI and reviewed and approved by you; developers build the engine that runs it | Sections 2, 10, 12 |

**Decided:** the first release includes audit methodology (ISA-based), not accounts preparation alone.

**To verify before relying on it:** CaseWare's current feature list, pricing and export formats are described here from general knowledge, not from a current quote or product documentation. Items marked *(verify)* need checking.

---

## 1. Vision and positioning

**Vision:** take a firm from a client's raw trial balance to signed financial statements in hours, with the software doing the mapping, roll-forward and first draft, and the accountant doing the judgement.

**Positioning:** CaseWare is a powerful desktop-era tool that firms configure heavily and pay for per seat. LedgerFile is browser-based, opinionated, and priced per engagement.

| Workflow | CaseWare today | LedgerFile |
|---|---|---|
| TB import | Manual import, column matching each time *(verify)* | Drag-and-drop; column layout remembered per client |
| Account mapping | Manual, carried forward for existing accounts | Prior-year mapping reused; AI suggests the rest with a confidence score |
| Lead sheets | Generated from mapping | Same, live-updating, with variance flags |
| Adjusting entries | Supported | Supported, with instant flow-through to statements |
| Financial statements | Template-driven, firm-configured | Structured templates; notes drafted by AI for review |
| Roll-forward | Per-file process | One click, or bulk across all clients |
| Review and sign-off | Preparer/reviewer tick marks | Same, plus review points as threaded comments |
| Audit methodology | Template-based programmes and checklists, licensed separately *(verify)* | Built in: materiality, risk assessment, programmes tailored to the assessed risks, misstatement summary, completion and audit report |
| Collaboration | File check-in/out on desktop; Cloud product separate *(verify)* | Real-time, multi-user by default |
| Client requests | Separate portal product *(verify)* | Built-in client portal with query lists |
| Pricing | Per-seat licence *(verify)* | Per engagement, unlimited users |

## 2. MVP scope

**In the MVP**

1. Firm, user and client setup with roles.
2. Engagement creation and one-click roll-forward from the prior year.
3. TB import from Excel/CSV, with current and prior-year balances. Also import of the full journal listing for the period (Excel/CSV), which the audit programme for journal entries and management override needs for its risk filters.
4. Account mapping to a standard grouping structure, with prior-year reuse and AI suggestions.
5. Adjusting and reclassification journal entries.
6. Lead sheets with year-on-year variance.
7. Financial statements under IFRS for SMEs: four primary statements plus standard notes, exported to Word and PDF.
8. Working paper folder: upload files, attach to lead sheets, reference them.
9. Preparer and reviewer sign-off, review points, and file lock on completion.
10. Full audit trail.
11. Audit methodology, as a guided sequence:
    - **Acceptance:** client acceptance and continuance, independence confirmation, engagement letter.
    - **Planning:** materiality calculator (overall, performance, trivial threshold), understanding of the entity, risk assessment by account area and assertion, fraud and going-concern considerations.
    - **Fieldwork:** an audit programme per lead sheet, with procedures selected according to the assessed risks; sample-size calculator; each procedure records work done, evidence and conclusion.
    - **Completion:** summary of misstatements compared against materiality, subsequent events, going concern, management representation letter, completion checklist.
    - **Reporting:** auditor's report generated from the conclusions (unmodified and modified forms), issued with the statements.
    - **Archiving:** file assembly deadline tracked after the report date, then permanent lock.

**What ships as content:** one methodology library for audits of small, non-complex entities, written against the ISAs. Firms can edit procedures and add their own.

**Non-goals for the MVP**

- Group audits, listed-entity requirements and engagement quality review workflow.
- Industry-specific programmes (banking, insurance, construction).
- Consolidations and multi-currency.
- Direct accounting-software integrations.
- CaseWare file import.
- Tax computations (your existing UAE CT and VAT workings stay separate).
- Arabic-language statements.

**Deferred to later phases:** AI note drafting, client portal, integrations, full IFRS, consolidation, group audits, industry programmes, Arabic output.

## 3. User journeys

**Firm admin:** signs up, sets firm branding and statement template defaults, invites staff, assigns roles.

**Preparer**
1. Creates an engagement, or rolls forward last year's.
2. Uploads the TB. The system detects columns and checks that it balances.
3. Reviews mapping: existing accounts are already mapped; new accounts show AI suggestions to accept or change.
4. Completes planning: materiality and the risk assessment. The system builds the audit programmes from the risks assessed.
5. Works through each lead sheet's programme, investigates flagged variances, attaches evidence and records conclusions.
6. Posts adjusting entries; unadjusted items go to the misstatement summary.
7. Opens the draft statements, completes notes, clears validation checks.
8. Completes the completion section and signs off as preparer.

**Reviewer:** opens the engagement dashboard, sees what changed since last year and which procedures are open, raises review points, signs off sections once points are cleared.

**Partner:** approves acceptance and the planning conclusions, reviews the misstatement summary and outstanding points, chooses the audit opinion and gives final sign-off. This produces the signed statements and auditor's report and starts the archiving countdown.

**Client portal user (Phase 2):** receives a query list, uploads documents and answers against each query.

## 4. Architecture

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js (React, TypeScript) | Largest talent pool; good data-grid libraries for TB and lead sheets |
| Backend | Node.js (TypeScript) API in the same repository | One language across the stack suits a two-person team |
| Database | PostgreSQL | Strong relational integrity for ledger data; row-level security for tenant isolation |
| File storage | S3-compatible object storage | Cheap, encrypted, versioned working papers |
| Background jobs | Queue with workers | Imports, AI calls and document generation run off the request path |
| Document output | Server-side Word generation, then PDF conversion | Firms need editable Word as well as PDF |
| Hosting | AWS, UAE region *(verify the services needed are available there)* | Meets A6. Chosen over Azure's UAE region for its wider developer familiarity and managed Postgres; pick Azure instead if target firms want Microsoft 365 sign-in and procurement |
| Auth | Managed identity provider with MFA and SSO | Not worth building in-house |

**Trade-off:** a single modular application over microservices. It is faster to build and operate at this size; split out the document engine later only if load demands.

**Tenancy:** one shared database with a `firm_id` on every table and row-level security enforced in the database, not only in application code. A dedicated-database tier can be offered later to larger firms.

## 5. Data model

| Entity | Key fields | Notes |
|---|---|---|
| Firm | name, branding, plan, region | The tenant |
| User | firm, email, role | Roles: admin, partner, reviewer, preparer |
| Client | firm, legal name, licence no., framework, year-end | |
| Engagement | client, period start/end, status, prior engagement | Links to the previous year for roll-forward |
| TrialBalanceImport | engagement, source file, column layout, imported by/at | Each import is kept, never overwritten |
| Account | engagement, code, name, opening and closing balance | |
| LedgerEntry | engagement, date, posted by, entry number, description, account, debit, credit | The client's own journal listing, imported for journal-entry testing; separate from the auditor's JournalEntry |
| Group | template, code, name, parent, statement line | The standard grouping tree |
| Mapping | account, group, source (prior year / AI / manual), confidence, approved by | |
| JournalEntry + JournalLine | engagement, type (adjusting / reclass), description, account, debit, credit | Must balance to post |
| LeadSheet | engagement, group, status | Computed view over accounts plus journals |
| WorkingPaper | engagement, lead sheet, file reference, version | |
| ReviewPoint | engagement, target, author, text, status | Threaded |
| SignOff | engagement, target, user, role, timestamp | |
| StatementTemplate | firm, framework, version, structure | |
| StatementDraft | engagement, template version, note content, status | |
| MethodologyLibrary | firm (or system default), version, standards basis | Versioned so a past file keeps the methodology it was performed under |
| ProcedureTemplate | library, area, assertion, risk level, text, ISA reference | The reusable content |
| Materiality | engagement, benchmark, percentage, overall, performance, trivial, rationale | Revisions kept |
| Risk | engagement, area, assertion, inherent risk, control risk, significant (yes/no), response | |
| AuditProcedure | engagement, lead sheet, template, risk, work done, conclusion, performed by, evidence links | An instance of a template |
| Misstatement | engagement, description, amount, adjusted (yes/no), journal entry | Feeds the summary against materiality |
| ChecklistResponse | engagement, checklist item, answer, comment | Acceptance, independence, completion |
| AuditReport | engagement, opinion type, key paragraphs, signed by, date | |
| AiSuggestion | engagement, type, input summary, output, model, accepted/edited/rejected, by whom | The AI log |
| AuditLog | firm, user, action, entity, before/after, timestamp | Append-only |

## 6. AI design

| Use | Phase | Data the model sees | Human step |
|---|---|---|---|
| Account mapping suggestions | MVP | Account code, name, balance sign; the grouping list | Preparer accepts or changes each; low-confidence items highlighted |
| Variance and anomaly flags | 2 | Lead sheet balances, two years | Preparer dismisses or documents an explanation |
| Note and disclosure drafting | 2 | Mapped balances, client profile, prior-year note text | Draft shown as tracked suggestion; nothing enters the statements until accepted |
| Client query generation | 2 | Flagged variances, missing support | Preparer edits before sending |
| Risk suggestions at planning | 2 | Mapped balances, variances, client profile | Preparer accepts or rejects each; the risk assessment remains the auditor's judgement and is signed by the partner |
| Review-point suggestions | 3 | Statements, validation results | Reviewer chooses which to raise |

**Model:** Claude models via the API: Claude Haiku 5.5 for mapping (high volume, simple classification) and Claude Sonnet 5.5 for note drafting and review points. Whether these can be called from within a UAE region must be confirmed *(verify)*; if not, firms must consent to processing outside the UAE, or AI features are disabled per firm.

**Rules**
- Numbers in the statements always come from the ledger engine, never from model output. The model writes words, not figures.
- Client names and identifiers are stripped or tokenised before a prompt is sent where the task does not need them.
- Provider terms must confirm no training on customer data.
- Every suggestion is recorded in `AiSuggestion` with its outcome.

**Accuracy testing:** build a test set from 30-50 anonymised historical trial balances with known correct mappings. Target at least 90% of AI mapping suggestions accepted unchanged before launch; track the acceptance rate in production.

**Cost per engagement:** not yet measured. Expected volume is tens of thousands of tokens for a 300-account mapping pass and a few hundred thousand for note drafting. That volume is small enough that AI cost should be minor next to the engagement price, but the actual figure is a Phase 0 deliverable: run the prototype on 10 real trial balances and price the token usage against the published rates.

## 7. Financial statement engine

**Template structure:** a template is structured data, not a Word file with macros. It has statements, each made of lines; each line pulls from one or more groups with a sign rule. Notes are blocks with a table definition, standard wording with placeholders, and an inclusion condition (for example, show the related-party note only if those groups have balances).

**Linking:** TB accounts map to groups, groups feed statement lines and note tables. An adjusting entry changes account balances and everything downstream recalculates instantly. Every figure is clickable back to its lead sheet and accounts.

**Rounding:** balances are held to the fils. Rounding is applied at presentation level, and any rounding difference is pushed to a nominated line per statement, with the amount disclosed to the preparer.

**Validation checks, which block sign-off until cleared**
- Total assets equal equity plus liabilities.
- Profit for the year agrees between the income statement, equity statement and cash flow.
- Closing cash in the cash flow agrees to the balance sheet.
- Every note total agrees to its face line.
- Comparatives agree to last year's signed statements.
- Opening retained earnings equal last year's closing.
- No unmapped accounts; no unbalanced journals.
- Audit file checks: materiality set, every significant risk has a concluded procedure, unadjusted misstatements are below materiality or the opinion is modified, no open review points.

**Output:** Word and PDF with firm branding; Excel export of lead sheets.

## 8. Security, compliance and data residency

- Tenant isolation through database row-level security, tested with automated cross-tenant access tests on every release.
- Encryption in transit and at rest; per-firm storage prefixes.
- MFA required; SSO for larger firms.
- Role-based permissions; locked engagements are read-only.
- Append-only audit log, exportable by the firm.
- Daily backups with point-in-time recovery; restore tested quarterly.
- Data hosted in a UAE region (A6). UAE data protection law and any free-zone regimes (DIFC, ADGM) should be reviewed by a lawyer before launch *(verify)*.
- Retention controls so firms can meet their record-keeping periods.
- Independent penetration test before the first paying customer; ISO 27001 or SOC 2 as a Phase 4 goal, since larger firms will ask for it.

## 9. Migration and onboarding

1. **Firm setup (day 1):** branding, users, template defaults.
2. **Client list import:** from a spreadsheet.
3. **Prior-year data:** for each client, upload last year's final TB from Excel. Most firms can export this from CaseWare *(verify export options)*.
4. **Mapping bootstrap:** AI maps the prior-year TB once; the preparer confirms. From then on, mapping carries forward.
5. **Comparatives check:** the generated prior-year statements are compared with the signed ones, to prove the mapping is right before the current year starts.
6. **Pilot:** 5-10 engagements run in parallel with CaseWare before the firm switches fully.

Past working paper files stay archived in CaseWare; LedgerFile does not import them (A4).

## 10. Roadmap

Effort figures are estimates for the two-developer team in A3.

| Phase | Duration | Delivers | Acceptance criteria |
|---|---|---|---|
| 0. Discovery and design | 4 weeks | Interviews with 5-8 target firms; grouping structure and IFRS for SMEs template designed; audit methodology outline; AI mapping prototype; clickable mock-up | Mapping prototype reaches 85% on test set; 3 firms agree to pilot |
| 1. MVP | 22 weeks | Everything in Section 2. Accounts preparation in weeks 1-14, audit engine in weeks 10-22, with the methodology content written in parallel | A real audit goes from TB to signed statements and auditor's report with no work outside the system; a reviewer from a pilot firm confirms the file would pass their own file review; cross-tenant tests pass |
| 2. AI and client portal | 8 weeks | Note drafting, variance flags, query lists, portal | Drafted notes need edits on under 30% of paragraphs in pilot; a client completes a query list unaided |
| 3. Breadth | 10 weeks | Full IFRS, integrations with Zoho Books, Xero and QuickBooks, consolidation, Arabic output | TB pulled directly from one accounting system; a two-entity consolidation produced |
| 4. Scale | Ongoing | Group audits, industry programmes, engagement quality review, certification, dedicated-database tier, GCC expansion | First firm of 50+ staff onboarded |

**Effort in developer-weeks (two developers):** Phase 0: 8, Phase 1: 44, Phase 2: 16, Phase 3: 20. That is 88 developer-weeks to the end of Phase 3.

**Content effort, separate from development:** the methodology library (programmes for 16 fieldwork areas, the planning and completion checklists, and the report wording) is drafted with AI and reviewed by you. Estimated effort is 3-5 weeks of your review time, spread across Phase 0 and the first half of Phase 1, in place of 8-12 weeks of writing from scratch.

**How the drafting works**
1. Agree the library structure first: areas, assertions, risk levels, and a fixed format for every procedure (tier, assertions, procedure text, evidence expected, ISA reference), with one audit objective per area. AI drafts cite the standard only; paragraph numbers are added at your review.
2. AI drafts one area at a time in that format, in original wording, with a reference for every procedure.
3. You review each area against a checklist: every relevant assertion is covered, procedures respond to the risk level, references are correct, nothing is copied from another firm's or vendor's methodology.
4. Each approved area is version-stamped with your name and the date; only approved content is loaded into the product.
5. Before release, the complete library is tested on two or three past audit files to confirm it would have produced a sufficient file.

AI drafts can cite a wrong ISA paragraph or miss a requirement, so step 3 must check every reference against the standard itself. A second reviewer for the finished library is still recommended, because a single reviewer of AI-drafted content is the weakest point in this approach.

Pilot firms should be using the MVP from about week 26. Total to a sellable product with AI features: roughly eight months.

## 11. Pricing and unit economics

**Model:** per engagement, unlimited users, so firms are not penalised for adding reviewers. Tiers by annual engagement volume, with a small monthly platform minimum.

**Price level:** set after obtaining a current CaseWare quote for a 10-user firm *(verify)*, aiming at around half the equivalent annual cost. Until then, no figure here would be honest.

**Cost to serve per engagement (estimates)**
- Hosting and storage: well under US$1.
- AI: expected to be small; measured in Phase 0 (Section 6).
- Support and onboarding: the real cost in year one; plan for hands-on onboarding of every early firm.

Gross margin should be high provided support is controlled. The larger commercial risk is sales cycle length, not unit cost.

## 12. Risks and open questions

| Risk | Mitigation |
|---|---|
| Firms distrust AI-drafted disclosures | AI writes words only; figures come from the engine; everything needs acceptance and is logged |
| Statement output not flexible enough for partners' preferences | Word export stays fully editable; firm-level template overrides |
| Switching cost from CaseWare | Parallel-run pilot; Excel-based migration; keep CaseWare archive read-only |
| AI not available in a UAE region | Per-firm consent or opt-out; design so the product works fully without AI |
| Incumbent responds on price or features | Compete on speed and simplicity for small firms, where incumbents are weakest |
| Two-person team is a delivery risk | Strict MVP non-goals; managed services for auth, hosting and queues |
| Templates resemble CaseWare's | Design templates from the standards and the firm's own statements, never from CaseWare content |
| Methodology content is deficient, and a customer's audit file fails a regulatory inspection | Your documented review of every AI-drafted area, with each reference checked against the standard; a second reviewer before release; testing on past audit files; versioned library; terms making clear the firm remains responsible for its audit; professional indemnity cover for the product company *(take legal advice)* |
| Standards change (new or revised ISAs) | Named owner for the library; annual update cycle; version stamped on every file |
| Copyright in the standards | Write procedures in your own words with ISA paragraph references; do not reproduce ISA text without checking IFAC's licensing terms *(verify)* |
| Audit scope lengthens the first release by about two months | Ship accounts preparation to pilots at week 18 as an early build while the audit engine is finished |

**Questions for you**
1. Who is building this: you with AI tools, hired developers, or an agency?
2. What budget and launch date are you working to?
3. Who could act as second reviewer of the finished methodology library?
4. Do you have pilot firms in mind besides your own?
5. Should UAE Corporate Tax and VAT workings eventually sit inside the same product?
