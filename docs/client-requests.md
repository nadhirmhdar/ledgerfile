# Client request list

The list of documents and information the audit team asks the client for on an engagement: who asked, when it is due, whether it has arrived, and which received files answer it.

## Status of the standard wording

**AI draft v0.1: not reviewed, not approved for use on any engagement.**

The wording behind "Add the standard requests" is in `src/domain/client-request-defaults.ts`. An AI model wrote it in plain words as a starting point. It is not taken from any third-party or published checklist. A person at the firm must read and correct it before it is sent to a client, in the same way as the methodology content. The page shows this label next to the button.

## Behaviour

- Works on any open engagement, whether or not the audit is turned on (a compilation job needs a request list too).
- Every role in the firm may add, edit, mark received, mark not applicable, reopen, delete and link files. A locked engagement refuses every change. Every change is written to the audit log.
- References run R-1, R-2 and so on within an engagement. A number is one more than the highest still on the list, so deleting the last request frees its number.
- Overdue means open with a due date before today. A request due today is not overdue yet. Overdue requests are counted within "open".
- Delete is allowed only while a request is open and has no files linked. A received or not applicable request can be reopened and then deleted if no files are linked; both steps are logged.
- "Today" is reckoned in the Asia/Dubai time zone (one constant in `src/domain/client-requests.ts`, to become a firm setting). A request cannot be marked received before the date it was made or on a future date.
- The database ties a linked file to the same firm and engagement as the request (composite keys), not only the application check.
- Files are the engagement's working papers; there is no separate upload. A file linked to a request cannot be removed from Working papers until it is unlinked.
- "Add the standard requests" adds the general requests and those for each audit area with a balance on the trial balance (the same areas the audit pages use). Wording already on the list, in any area, is skipped.
- "Bring forward last year's requests" copies each request from the prior-year engagement (same client only) as open, dated today, with no due date. A request already brought forward, or whose wording is already on the list, is skipped.
- "Download as Excel" gives the sheet to send to the client. It has no internal note column; the note stays in the application.
