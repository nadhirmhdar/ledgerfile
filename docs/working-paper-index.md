# Working paper index

The file's table of contents: every working paper on an engagement, in file order, with its reference, what it is, who prepared it, who reviewed it and where it stands. It is on the **Index** tab of an engagement, and can be downloaded as Excel.

## Status of the reference scheme

**Default for the firm to confirm.** The scheme below was chosen to fit the references the product already uses and not to renumber any of them. A firm may want different letters or a different order; that is a decision for the firm, and it would be one change in `src/domain/wp-index.ts`.

## How it works

The index is **derived**. Nothing is stored for it, so it cannot fall out of step with the papers. Each entry is read from the record the paper already has: sign-offs, procedures, schedules, uploads and so on. Papers that depend on the audit being turned on appear only when it is on.

## References

| Reference | Paper |
| --- | --- |
| G1 to G5 | General papers: trial balance and mapping (G1), adjusting journals (G2), financial statements (G3), client requests (G4), review and file lock (G5) |
| A1 to A3, B1 to B11, D1 to D9, E1 to E3 | The checklists, under the codes they already have |
| B2.M | The materiality calculation, beside checklist B2 |
| B3.A | Analytical review and ratios, beside checklist B3 |
| B8.R | Risk assessment and the partner's approval of it, beside checklist B8 |
| A3.L, D5.L | The engagement letter and the management representation letter |
| D1.M | The schedule of misstatements |
| C5.L1, C7.L2 | A lead sheet of area C5. One per lead sheet group, numbered by the group's place in the area's fixed list, so the reference does not change when a balance appears or goes |
| C5.P | The audit procedures of area C5 |
| C16.J | Journal entry testing |
| C5-1 | A test schedule of area C5, numbered as the schedules already number themselves |
| C6.CF | The external confirmations of area C6, as one paper: one per area that has any (the individual CF-n references are on the confirmations page). Reviewed when every confirmation is reviewed, Prepared when every one is prepared or reviewed, In progress when any has been sent, otherwise Not started |
| C5-F1 | An uploaded file that the preparer has given a reference |

Sections run: General, Acceptance (A), Planning (B), then areas C1 to C16 in numeric order (C2 before C10), then Completion (D), Reporting (E), then Unfiled. Within an area: lead sheets, procedures, journal testing, schedules, then uploaded files (referenced ones first).

## Status

Not started, In progress, Prepared, Reviewed, Not applicable.

- **Procedures and checklists** use the same rules as the lock. A step is finished once it is no longer open. A finished step needs a review unless it is the partner's own sign-off. An entry is Reviewed when every step that needs a review has one.
- **Lead sheets** are Reviewed once a reviewer has signed. They stay In progress while review points are open.
- **Test schedules** are Prepared when they have a conclusion and no unexplained difference, and Reviewed once a reviewer has reviewed them.
- **The risk assessment** counts the partner's approval as its review only while that approval still stands.

## What the product does not know

Some papers have no preparer, no reviewer, or neither, because the product records none. The index shows what is known and does not invent the rest.

- **Trial balance, adjusting journals, statements, client requests, letters, materiality, analytical review, journal testing, the schedule of misstatements and uploaded files** have no review step. They show as "No review step" and are never counted as waiting for review.
- **The trial balance** has an import date but no importer, and mapping approval records no person.
- **Statements and client requests** are not prepared by a named person, so none is shown.
- **Letters** are produced on demand and not stored. The index shows who last produced each and when, from the audit log. The signed copy is not tracked.
- **Analytical review** shows who wrote the explanations. Re-confirming an explanation is not a review.
- **Adjusting journals and misstatements** with none recorded show Not applicable with the note "None recorded", since nothing needs preparing. That is the index's reading, not a conclusion anyone has reached.

"Still to review" counts only papers that have a review step and are not yet reviewed.

## Uploaded files

Files are listed as they are filed:

- A file that supports a lead sheet is listed in that lead sheet's area.
- A file that supports a procedure is listed where the procedure is: an area, or a checklist's section.
- A file that supports the engagement generally is listed under the area or checklist the preparer chooses on the Working papers tab, or under **Unfiled**.

A preparer may give a file a reference of the form `C5-F1`: an area or checklist code, `-F` and a number. The form is one the application never makes itself, so a typed reference cannot collide with a derived one. A reference has no leading zeros (C5-F1, not C5-F01), is unique within an engagement, starts with the code the file is filed under, is checked by the database as well as the application, is written to the audit log, and is refused on a locked engagement. Only the reference and place can change after upload; the file and its record are untouched.

## Export

"Download index (Excel)" gives one sheet in file order. It is logged. Every cell is written as text, so a file name that begins with `=`, `+`, `-` or `@` is never read as a formula.

## Known limits

- A test schedule's preparer is shown as the person who recorded its conclusion (`prepared_by`), not everyone who contributed.
- The analytical review's preparer includes the writers of explanations that have since lapsed.
- Letters are found by scanning the audit log for the last export of each.
- Open review points raised on the engagement generally (not on a lead sheet) do not affect any entry.
- A review by the person who did the work is noted as "self-reviewed" on lead sheets, procedure and checklist roll-ups and schedules.
