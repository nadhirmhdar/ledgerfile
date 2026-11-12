/**
 * Draft accounting policy wording for the notes, for entities reporting under IFRS for SMEs.
 *
 * This is starting wording, not advice: every policy must be reviewed against the entity's
 * facts and the edition of the standard it applies. Text in [square brackets] must be
 * completed or chosen by the preparer. A policy is included only when the entity has a
 * balance in one of its groups, except those marked always.
 */
export interface Policy {
  title: string;
  text: string;
  /** Included when any of these groups has a balance in either year. Empty means always included. */
  groups: string[];
}

export const POLICY_REVIEW_NOTICE =
  "[Draft wording generated from the balances in these statements. Review each policy against the entity's circumstances and the edition of the standard applied, complete the bracketed items, and delete this paragraph.]";

export const POLICIES: Policy[] = [
  {
    title: "Revenue",
    groups: ["REVENUE"],
    text: "Revenue is measured at the consideration received or receivable, net of discounts, returns and value added tax. [Describe when revenue is recognised for each significant revenue stream, for example when goods are delivered and accepted by the customer, or as services are performed.]",
  },
  {
    title: "Property, plant and equipment",
    groups: ["PPE"],
    text: "Property, plant and equipment is stated at cost less accumulated depreciation and any accumulated impairment losses. Cost includes expenditure directly attributable to bringing the asset to the location and condition necessary for its intended use. Depreciation is charged on a straight-line basis over the estimated useful lives of the assets, which are: [list each class and its useful life]. Useful lives, residual values and depreciation methods are reviewed if there is an indication of a significant change since the last reporting date. Gains and losses on disposal are recognised in profit or loss.",
  },
  {
    title: "Intangible assets",
    groups: ["INTANG"],
    text: "Intangible assets acquired separately are stated at cost less accumulated amortisation and any accumulated impairment losses. They are amortised on a straight-line basis over their estimated useful lives of [state the lives]. Expenditure on internally generated intangible items is recognised as an expense when incurred [amend if the entity applies a different permitted treatment].",
  },
  {
    title: "Investments",
    groups: ["INVEST"],
    text: "[Describe the nature of the investments and the measurement basis applied to each: cost less impairment, fair value through profit or loss, or the equity method.]",
  },
  {
    title: "Impairment of non-financial assets",
    groups: ["PPE", "INTANG", "INVENT"],
    text: "At each reporting date, assets are reviewed for any indication that they have suffered an impairment loss. Where there is such an indication, the recoverable amount of the asset is estimated and compared with its carrying amount. If the recoverable amount is lower, the carrying amount is reduced and an impairment loss is recognised immediately in profit or loss.",
  },
  {
    title: "Inventories",
    groups: ["INVENT"],
    text: "Inventories are stated at the lower of cost and estimated selling price less costs to complete and sell. Cost is determined using the [first-in, first-out / weighted average cost] method and includes the purchase price and other costs incurred in bringing the inventories to their present location and condition. Allowance is made for obsolete and slow-moving items.",
  },
  {
    title: "Trade and other receivables",
    groups: ["TRADEREC", "RPREC"],
    text: "Trade and other receivables are recognised initially at the transaction price and are subsequently carried at that amount less any allowance for impairment. At each reporting date the carrying amounts are reviewed to determine whether there is objective evidence that the amounts are not recoverable; if so, an impairment loss is recognised in profit or loss.",
  },
  {
    title: "Cash and cash equivalents",
    groups: ["CASH"],
    text: "Cash and cash equivalents comprise cash in hand, balances with banks and short-term deposits with an original maturity of three months or less.",
  },
  {
    title: "Trade and other payables",
    groups: ["TRADEPAY", "RPPAY"],
    text: "Trade and other payables are obligations to pay for goods or services acquired in the ordinary course of business. They are recognised at the transaction price and are not interest-bearing.",
  },
  {
    title: "Borrowings",
    groups: ["BORROW", "FINCOST"],
    text: "Borrowings are recognised initially at the transaction price and subsequently measured at amortised cost using the effective interest method. Borrowings are classified as current liabilities unless the Company has an unconditional right to defer settlement for at least twelve months after the reporting date. All borrowing costs are recognised as an expense in the period in which they are incurred.",
  },
  {
    title: "Employees' end-of-service benefits",
    groups: ["EOSB"],
    text: "Provision is made for end-of-service benefits due to employees under the applicable labour law, based on their salary and length of service at the reporting date. [State whether the obligation is measured using an actuarial technique or a permitted simplification.]",
  },
  {
    title: "Provisions",
    groups: [],
    text: "Provisions are recognised when the Company has a present obligation as a result of a past event, it is probable that a transfer of economic benefits will be required to settle it, and the amount can be estimated reliably.",
  },
  {
    title: "Taxation",
    groups: ["TAXEXP", "TAXLIAB"],
    text: "Income tax expense represents the sum of current tax and deferred tax. Current tax is based on taxable profit for the year, using tax rates enacted or substantively enacted at the reporting date. Deferred tax is recognised on temporary differences between the carrying amounts of assets and liabilities and their tax bases, to the extent that it is probable that they will affect future taxable profit. [Describe the entity's tax status and any reliefs applied.]",
  },
  {
    title: "Foreign currencies",
    groups: [],
    text: "Transactions in foreign currencies are recorded at the exchange rate at the date of the transaction. Monetary assets and liabilities denominated in foreign currencies are retranslated at the rate at the reporting date. Exchange differences are recognised in profit or loss. [Delete if the entity has no foreign currency transactions.]",
  },
  {
    title: "Significant judgements and sources of estimation uncertainty",
    groups: [],
    text: "[Describe the judgements management has made in applying the accounting policies that have the most significant effect on the amounts recognised, and the key assumptions and other sources of estimation uncertainty, for example useful lives, the allowance for doubtful receivables and the allowance for slow-moving inventories.]",
  },
];

/** The policies that apply to an entity, given which groups have a balance. */
export function applicablePolicies(usedGroups: Set<string>): Policy[] {
  return POLICIES.filter((p) => p.groups.length === 0 || p.groups.some((g) => usedGroups.has(g)));
}
