import { COMMITMENTS_KEY, EVENTS_KEY, GOING_CONCERN_KEY, RELATED_KEY, TAX_KEY } from "./note-texts";

/**
 * The generated wording of the five standard notes that follow the group notes. Original plain English for this app, written as a starting draft: every
 * fact the app does not know is a [bracketed placeholder] for the preparer, and nothing states a tax rate, a law or a regulator's requirement as fact.
 * Each passage is labelled "Unreviewed draft wording" until a person edits it or a firm default replaces it.
 *
 * The figures that go with the related-party and income tax notes are tables built from the ledger in the statement pack, never from these words.
 */
export const STANDARD_NOTE_WORDING: Record<string, string[]> = {
  [RELATED_KEY]: [
    "[Name each related party and describe how it is related to the entity, for example as a shareholder, a director, key management or another entity under common control.]",
    "The balances with related parties at the reporting date, as shown in the statement of financial position, are set out below. [Describe the transactions with related parties during the year, their terms and conditions, and whether any balance is secured, carries interest or has a fixed repayment date.]",
    "[State whether any amount due from a related party has been written off or provided for, or state that none has.]",
  ],
  [TAX_KEY]: [
    "[State the tax regime that applies to the entity, the tax period, and the rate or rates used to measure the tax for the year.]",
    "The income tax expense for the year and the tax liability at the reporting date, as shown in the statements, are set out below. [Explain how the expense relates to the profit before tax, and describe any deferred tax that has or has not been recognised.]",
  ],
  [COMMITMENTS_KEY]: [
    "[Describe any capital commitments, guarantees and contingent liabilities at the reporting date, or state that there were none.]",
    "[Describe any other commitments the entity has entered into but not yet recognised, for example under leases or purchase contracts, or state that there were none.]",
  ],
  [EVENTS_KEY]: [
    "These financial statements were approved for issue on [date the statements were approved]. [Describe any event after the reporting period that needs to be disclosed, and say whether it is an adjusting or a non-adjusting event, or state that there were none.]",
  ],
  [GOING_CONCERN_KEY]: [
    "[State the preparers' assessment of whether the entity can continue in operation for the foreseeable future, the evidence and plans that support it, and any material uncertainty. Complete this note once that assessment has been made.]",
  ],
};
