# External confirmations

A record, on an audited engagement, of each confirmation sent to a third party: who it went to, the balance in the client's books, when it was sent and chased, the reply, any difference and how it was reconciled (or the alternative work done when no reply came), the reply files, and who prepared and reviewed it. It feeds the lock. The page is under the Audit tab (Audit, then External confirmations).

There is no letter generation here, and no suggested procedure wording. The product records what the team did and wrote; it does not write the confirmation or the work.

## What is recorded

- **Who and what:** kind (bank, customer, supplier, related party, lawyer, other), the audit area, the party's name, contact (as typed), an account or code, and the book balance (signed, as the client's books show it for that party).
- **Sending:** the date sent, and up to five reminder dates.
- **Reply:** agreed, differs or no reply. A reply that agrees takes the book balance as the confirmed amount. A reply that differs needs the confirmed amount, which must not equal the book balance (if it does, record agreed). No reply has no date or amount. A reply note holds what the reply said beyond the amount (a bank's note of guarantees or charges, a lawyer's list of claims).
- **Reconciliation** (reply differs) and **alternative procedures** (no reply): free text. Each belongs to one kind of reply, so changing the reply clears the other.
- **Files:** reply files are the engagement's existing working papers, linked here. A linked file cannot be removed from Working papers until it is unlinked.
- **Sign-off:** preparer and reviewer, like a test schedule.

References run CF-1, CF-2 and so on within an engagement. The number after the highest still on the list is used next, so deleting the last one frees its number.

Lawyers' replies: record Agreed when the reply is consistent with what the books show for that matter (the book balance may be 0), or Differs with the lawyer's amount otherwise, and put the detail in the reply note.

## Rules

- Every write needs the engagement open and the audit on, and is written to the audit log. A locked engagement is a read-only view. The audit cannot be turned off once a confirmation exists.
- Any role may add, change and prepare. Only a reviewer or partner may review, withdraw a review, or delete a confirmation that has a reply.
- A confirmation must be sent before a reply, a reminder or a reply date is recorded, and dates are not in the future ("today" is reckoned in Asia/Dubai, as for client requests). A sent date cannot move after an existing reply or reminder. A sent date can be cleared only when there is no reply and no reminder.
- The book balance cannot change while an agreed or differs reply is recorded. Clear the reply first, so an agreed reply can never describe a different balance.
- **Preparing** needs the sent date and a reply, and the reconciliation (differs) or alternative procedures (no reply). **Any change to the substance** (details, dates, reply, text, files) after preparation clears the preparation and records the person as a contributor.
- **Reviewing** needs a prepared confirmation. The reviewer must differ from the preparer and every contributor, unless the firm has no other reviewer; a review by someone who did some of the work is shown as self-reviewed. A reviewed confirmation refuses every change until the review is withdrawn.
- **Lock:** each confirmation not sent, awaiting a reply, with a reply but not prepared, or not reviewed holds up the lock, with a count. Record "no reply" with alternative procedures when a reply will not come.
- The database enforces the reply rules (a reply date, amount or note without a reply, agreed with an unequal amount, differs with an equal one, a reply before it was sent, a review without preparation) and ties a linked file to the same firm and engagement as the confirmation.

## Bring forward

"Bring forward from last year" copies each prior-year confirmation's kind, area, party, contact and account reference, with a zero book balance and no dates, reply or sign-off. The prior engagement must be for the same client. One already brought forward, or whose kind, party name and account reference are already on this engagement (ignoring case and spacing), is skipped. It can be pressed again.

## Download

"Download (Excel)" is an internal workbook: a Confirmations sheet with every column (including difference, reply note, reconciliation, alternative procedures, reminders, file names, preparer, reviewer and self-review) and a Summary sheet by area. Amounts are numbers; text cells are text. It is session- and firm-scoped, audit-logged, and not available when the audit is off.

## Not yet

Confirmations are not yet listed in the working paper index.
