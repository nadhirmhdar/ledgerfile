# Trial balance export shapes

What LedgerFile reads when a firm uploads a trial balance exported from an accounting system, and how sure we are of each shape. Every row has an invented fixture in `tests/fixtures/tb-shapes/` and a test in `tests/tb-shapes.test.ts`; the fixtures are not vendor files and hold no real data.

## How a file is read

1. What the person chose, then the headings remembered for the client, then plain detection (the heading words it has always known), then the recogniser (`src/domain/tb-recognise.ts`), then the chooser.
2. The recogniser reads every sheet, the heading (one or two rows), the role of each column, and the rows below: it skips headings, group lines, totals and subtotals, and takes the closing balance, never opening or movement.
3. It is high, medium or low in confidence. Low means ask: the chooser opens filled in, and nothing is imported.
4. Plain detection is overruled only when it reads a file that balances but the recogniser, not unsure, reads different closing balances (the case of an export with opening, movement and closing columns, where the movement columns balance too).

## The shapes

"Source" is how the shape was established. **Vendor documentation** here means a vendor page describing the report in prose: it confirmed what the columns mean, not the exact heading strings, so the headings are still **UNVERIFIED**. **From memory, UNVERIFIED** means no source was found: the shape is what we remember the system exporting. **Third-party** means descriptions by someone other than the vendor.

| System | Shape (columns, heading style, totals, hierarchy) | Source | A real sample from the owner would confirm |
|---|---|---|---|
| Tally Prime | Title rows; "Particulars" with "Closing Balance" over Debit and Credit (two-row heading); group lines carrying their group totals with ledgers indented below; Grand Total | Vendor documentation: <https://help.tallysolutions.com/tally-prime/accounting-financial-reports/trial-balance-tally/> (group-wise view by default, ledger-wise on F5, opening balance optional) | the exact heading words, the indent in the saved file, whether Dr/Cr markers appear, the group totals |
| Tally ERP 9 | Title rows; Particulars, Debit, Credit, ledgers flat; Grand Total | From memory, UNVERIFIED | everything: the headings, whether it is grouped or flat, the total row |
| Zoho Books | Title and basis rows; Account, Account Code, Debit, Credit; section headings (Assets, Liabilities...); Total | Vendor documentation: <https://www.zoho.com/in/books/kb/reports/can-i-view-the-trial-balance-report-with-opening-and-closing-balances.html> (each account once in debit or credit, totals at the bottom, opening and closing columns optional) | the heading strings, whether sections appear, the optional opening and closing columns |
| QuickBooks Online | Title rows; **no word over the account column**; Debit, Credit with $ amounts; TOTAL | From memory, UNVERIFIED (Intuit's help pages found do not show the columns) | the blank first heading, the currency marks, the total row, indentation of sub-accounts |
| QuickBooks Desktop | A date ("Dec 31, 25") over Debit and Credit (two-row heading); accounts as "1000 · Name"; blank first heading; TOTAL | From memory, UNVERIFIED | the date heading, the middle-dot separator, indented sub-accounts |
| Xero | Account with the code in brackets ("Sales (200)"); Debit, Credit (the month) then Debit - YTD, Credit - YTD (the balance); Total | Third-party descriptions (Debit, Credit, Debit YTD, Credit YTD), UNVERIFIED | the exact headings, which pair is the balance, the sign of the YTD figures |
| Sage 50 (UK) | N/C, Name, Debit, Credit; "Totals:" | From memory, UNVERIFIED | the headings (N/C, Name), the totals line |
| Sage 300 | Account Number, Account Description, Beginning Balance, Debits, Credits, Ending Balance; negatives in brackets | From memory, UNVERIFIED | the column set, whether it is signed or in Dr/Cr columns |
| Sage Intacct | Account No, Account Title, Debit, Credit, Adj Debit, Adj Credit | Vendor documentation: <https://www.intacct.com/ia/docs/en_AU/help_action/Reporting/General_Ledger_reports/Trial_balance/about-trial-balance-rpt.htm> (Debit, Credit, Adj Debit, Adj Credit) | whether Debit and Credit are before or after the adjustments, and which pair is the balance wanted. **Today it asks (low confidence): the adjusting columns are not guessed.** |
| SAP Business One | Code, Name, O.B., Debit, Credit, Accu.Debit, Accu.Credit, Balance (signed) | Vendor documentation for the balance: <https://help.sap.com/saphelp_sbo92/helpdata/en/45/1a32dcb3ca29efe10000000a114a6b/content.htm> (debit minus credit plus the opening balance; opening balance column optional). Headings: a third-party tutorial, UNVERIFIED | the headings, the foreign-currency columns, how the sign is shown |
| Odoo | Account as "1010 Bank"; Initial Balance, Debit, Credit, End Balance; Total | Third-party descriptions (version-dependent: newer versions show Initial and End Balance as one net column), UNVERIFIED | the version, whether Initial and End are split into Debit and Credit |
| Dynamics 365 Business Central | Two-row heading: Net Change and Balance, each over Debit and Credit; No., Name | Vendor documentation: <https://learn.microsoft.com/en-au/Dynamics365/business-central/reports/report-4405> ("Trial Balance Excel": debit and credit columns for net change and balance) | the exact headings and whether it is two rows in the sheet |
| Dynamics NAV | No., Name, Net Change Debit, Net Change Credit, Balance Debit, Balance Credit (one heading row) | From memory, UNVERIFIED | the headings, whether they are one row or two |
| Dynamics GP | Account Number "000-1100-00", Description, Beginning Balance, Debit, Credit, Net Change, Ending Balance | From memory, UNVERIFIED | the column set and the account number format |
| Dynamics AX / Finance and Operations (added) | Main account, Name, Opening balance, Debit, Credit, Balance | From memory, UNVERIFIED | the column set |
| NetSuite | Account as "1010 Cash : Operating Bank" (parent : child); Debit, Credit; parent lines with a "Total - ..." line; Total | Vendor documentation: <https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1520986.html> (Debit/Credit view with separate columns, a Total view with one) | the account format, the total lines, the single-column Total view |
| Focus | Account Name, Debit Balance, Credit Balance; Grand Total | From memory, UNVERIFIED | the headings, any group lines |
| MYOB | Account No. "1-1100", Account Name, Debits, Credits; "Total Debits and Credits" | From memory, UNVERIFIED | the headings and the total line |
| Wave | Account Name, Debit (AED), Credit (AED); section lines (Assets, Liabilities & Credit Cards, Equity, Income, Expenses); Totals | From memory, UNVERIFIED | the section lines and the currency in the headings |
| FreshBooks | Account, Account Type, Debit, Credit; Total (the type column is text, not Dr/Cr) | From memory, UNVERIFIED | the column set |
| Busy | Name of Account, Opening Balance, Debit, Credit, Closing Balance; amounts with a Dr or Cr suffix; Grand Total | From memory, UNVERIFIED | the suffix, the group lines, the headings |
| Peachtree | Account ID, Account Description, Debit Amt, Credit Amt; Total | From memory, UNVERIFIED | the headings |
| ERPNext (added) | Account as "1000 - Cash - ABC" (the company's abbreviation last); Opening (Dr), Opening (Cr), Debit, Credit, Closing (Dr), Closing (Cr); Total | From memory, UNVERIFIED (the column set is remembered with some confidence) | the account format, the order of the pairs |
| Generic | Code, Name, Debit, Credit | Not a system | nothing |

**Counts:** 24 shapes. Six rest on vendor documentation (Tally Prime, Zoho Books, Sage Intacct, SAP Business One, Dynamics 365 Business Central, NetSuite), two on third-party descriptions (Xero, Odoo), fifteen on memory alone, and one is the generic layout.

**Added beyond the list:** Dynamics AX / Finance and Operations and ERPNext, because both are common in the Gulf and have a distinct shape (a "Main account" number; an Opening, Debit, Credit, Closing set in Dr and Cr pairs). Epicor, Acumatica and Al Ameen are not covered: no shape could be established for them, and inventing one would be a guess.

## What the shapes taught the recogniser

Fixed in this slice, each with a test:

- A title or company line above the heading was taken for the top row of a two-row heading (it added a false "the heading spans two rows" and could have misread the heading). A two-row heading now needs the upper row to be a heading too.
- A heading with nothing over the account column (QuickBooks) was not found; the account column is now found from its cells.
- A year-to-date pair beside a month's Debit and Credit (Xero) was a "duplicate column" and asked; YTD now marks the closing set and the plain pair is the period's movement.
- An opening balance with a Balance column and a Debit and Credit pair (SAP Business One, Dynamics AX) was read from the Debit and Credit; those are now movement.
- "Balance Debit" and "Balance Credit" (NAV), "Debit Amt" (Peachtree), "Debits" and "Credits" (MYOB), "N/C" (Sage), "Account ID", "Main account", "Name of Account", and the middle dot between a code and a name (QuickBooks Desktop) were not known.
- Adjusting columns (Sage Intacct) are never guessed: they make the reading low confidence, so the chooser opens.
- **Plain detection misread exports with opening, movement and closing columns** (Dynamics GP and AX, Odoo, SAP Business One, ERPNext): it took the Debit and Credit columns, which are the period's movement and balance too, so the file imported with the wrong figures and no warning. The upload now prefers the recogniser's reading when it is not unsure and reads different closing balances. Files both read the same way are untouched.

## Not covered

Old binary `.xls` files are still refused (a reader would be a new dependency). Account names in Arabic pass through as text; only header words are matched in Arabic.
