import { describe, expect, it } from "vitest";
import { assist, bandOf, normalise, type AssistantAccount, type LearnedExample, type Placement } from "../src/domain/mapping-assistant";
import { CLIENT_A, CLIENT_B, type Row } from "./mapping-assistant-fixture";

const acc = (code: string, name: string, closingMinor = 1000): AssistantAccount => ({ code, name, closingMinor });
const one = (a: AssistantAccount, extra: Partial<Parameters<typeof assist>[0]> = {}): Placement => assist({ accounts: [a], ...extra })[0];
const learned = (rows: [string, string, number, string][]): LearnedExample[] => rows.map(([code, name, closingMinor, groupCode]) => ({ code, name, closingMinor, groupCode }));
const toAccounts = (rows: Row[]): AssistantAccount[] => rows.map(([code, name, closingMinor]) => ({ code, name, closingMinor }));
const examplesFromA = (): LearnedExample[] => CLIENT_A.map(([code, name, closingMinor, groupCode]) => ({ code, name, closingMinor, groupCode: groupCode! }));

describe("reading an account's name", () => {
  it("spells out the abbreviations the table knows", () => {
    expect(normalise("Acc. Dep. - P&M")).toBe("accumulated depreciation p and m");
    expect(normalise("Accum depn - vehicles")).toBe("accumulated depreciation vehicle");
    expect(normalise("Trade a/c payables")).toBe("trade account payable");
    expect(normalise("Prov for doubtful debts")).toBe("provision for doubtful debts");
    expect(normalise("EOSB provision")).toBe("end of service benefits provision");
    expect(normalise("W/O of stock")).toBe("write off of stock");
    expect(normalise("Rent exp")).toBe("rent expense");
    expect(normalise("Accounts pay - trade")).toBe("accounts payable trade");
    expect(normalise("Security dep")).toBe("security deposit");
    expect(normalise("Owner's current")).toBe("owners current");
  });
});

describe("each kind of evidence", () => {
  it("wording: a keyword places an account, and the reason names it", () => {
    const p = one(acc("1530", "Accumulated depreciation - furniture", -30000));
    expect(p).toMatchObject({ kind: "suggest", groupCode: "PPE", band: "medium" });
    expect(p.reason).toContain("Matches 'accumulated depreciation'");
  });

  it("wording: abbreviations count, so Acc dep reads as accumulated depreciation", () => {
    expect(one(acc("1", "Acc dep - plant", -5))).toMatchObject({ kind: "suggest", groupCode: "PPE" });
    expect(one(acc("1", "Prov for doubtful debts", -5))).toMatchObject({ kind: "suggest", groupCode: "TRADEREC" });
  });

  it("wording: a longer keyword of another group wins over one inside it (bank loan is borrowings, not cash)", () => {
    expect(one(acc("1", "Bank loan - term", -5))).toMatchObject({ kind: "suggest", groupCode: "BORROW" });
  });

  it("wording: a keyword that needs more after it does not match at the end of the name", () => {
    expect(one(acc("1", "Owner current account", -5))).toMatchObject({ groupCode: "OWNERCA" });
  });

  it("the firm's examples: the same name, and the reason says how many", () => {
    const ex = learned([["9001", "Gadget reserve", -5, "RESERVES"], ["9002", "gadget  reserve", -9, "RESERVES"]]);
    const p = one(acc("1", "Gadget Reserve", -5), { examples: ex });
    expect(p).toMatchObject({ kind: "suggest", groupCode: "RESERVES", band: "high" });
    expect(p.reason).toContain("Your firm mapped 2 accounts with this name to Reserves");
  });

  it("the firm's examples: a similar name counts for less than the same one", () => {
    const ex = learned([["9001", "Gadget workshop licence fees", 5, "ADMIN"]]);
    const similar = one(acc("1", "Gadget licence fees paid", 5), { examples: ex });
    const same = one(acc("1", "Gadget workshop licence fees", 5), { examples: ex });
    expect(similar).toMatchObject({ kind: "suggest", groupCode: "ADMIN" });
    expect(similar.reason).toContain("similar account");
    expect(same.kind === "suggest" && similar.kind === "suggest" && same.score > similar.score).toBe(true);
  });

  it("the firm's examples with a name nothing else matches place an account the wording alone could not", () => {
    const name = "Quasar vault holdings";
    expect(one(acc("1", name, 5)).kind).toBe("decline");
    expect(one(acc("1", name, 5), { examples: learned([["9", name, 5, "INVEST"]]) })).toMatchObject({ kind: "suggest", groupCode: "INVEST" });
  });

  it("the prior year: the same code keeps last year's group, and says so", () => {
    const p = one(acc("2345", "Quasar vault holdings", 5), { priorYear: new Map([["2345", "INVEST"]]) });
    expect(p).toMatchObject({ kind: "suggest", groupCode: "INVEST", band: "high" });
    expect(p.reason).toContain("The same code was mapped to Investments last year");
  });

  it("code ranges: neighbouring codes in the same trial balance place an account the wording cannot", () => {
    const accounts = [acc("1500", "Leasehold improvements", 5), acc("1510", "Accumulated depreciation - fit-out", -5), acc("1520", "Quasar rig", 5), acc("1530", "Leasehold improvements - phase 2", 5), acc("1540", "Accumulated depreciation - phase 2", -5)];
    const out = assist({ accounts });
    expect(out[2]).toMatchObject({ kind: "suggest", groupCode: "PPE" });
    expect(out[2].reason).toContain("codes either side");
    expect(assist({ accounts: [accounts[2]] })[0].kind).toBe("decline");
  });

  it("code ranges: do not apply to a name with its own clear evidence", () => {
    const out = assist({ accounts: [acc("1500", "Leasehold improvements", 5), acc("1510", "Share capital", -5), acc("1520", "Leasehold improvements - phase 2", 5)] });
    expect(out[1]).toMatchObject({ groupCode: "CAPITAL" });
  });
});

describe("the balance side and contra accounts", () => {
  it("flags a credit balance in an asset group and keeps the suggestion at low", () => {
    const p = one(acc("1", "Software licences", -5000));
    expect(p).toMatchObject({ kind: "suggest", groupCode: "INTANG", band: "low" });
    expect(p.kind === "suggest" && p.score <= 0.59).toBe(true);
    expect(p.reason).toContain("The balance is a credit but Intangible assets is usually a debit: check it.");
  });

  it("flags a debit balance in income", () => {
    const p = one(acc("1", "Contract income", 5000));
    expect(p).toMatchObject({ kind: "suggest", groupCode: "REVENUE", band: "low" });
    expect(p.reason).toContain("usually a credit");
  });

  it("never proposes a flagged suggestion as high, even with every other kind of evidence behind it", () => {
    const ex = learned([["9", "Vehicles", 5, "PPE"], ["8", "Vehicles", 5, "PPE"], ["7", "Vehicles", 5, "PPE"]]);
    const p = one(acc("1", "Vehicles", -9000), { examples: ex, priorYear: new Map([["1", "PPE"]]) });
    expect(p).toMatchObject({ kind: "suggest", band: "low" });
  });

  it("allows a contra account and says so", () => {
    const p = one(acc("1", "Allowance for doubtful debts", -5000));
    expect(p.reason).toContain("A contra account, so the opposite balance is expected.");
    expect(p.reason).not.toContain("check it");
    expect(p.kind === "suggest" && p.band).not.toBe("low");
  });

  it("does not flag a nil balance, or a group that can be either side", () => {
    expect(one(acc("1", "Retained earnings", 5000)).reason).not.toContain("check it");
    expect(one(acc("1", "Software licences", 0)).reason).not.toContain("check it");
  });
});

describe("could not place", () => {
  it("says so when nothing matches, and never guesses", () => {
    const p = one(acc("1", "Suspense account", 3000));
    expect(p).toEqual({ kind: "decline", accountCode: "1", reason: "No wording match and nothing similar your firm has mapped." });
  });

  it("says so when the only evidence is a nearby code", () => {
    const out = assist({ accounts: [acc("1500", "Leasehold improvements", 5), acc("1510", "Quasar rig", 5)] });
    expect(out[1].kind).toBe("decline");
    expect(out[1].reason).toContain("weak hint");
  });

  it("says so when two groups are close, naming both", () => {
    const p = one(acc("1", "Advertising borrowing", 3000));
    expect(p.kind).toBe("decline");
    expect(p.reason).toBe("The evidence is split between General and administrative expenses and Borrowings.");
  });

  it("says so, with the neighbours, when the codes either side disagree", () => {
    const out = assist({ accounts: [acc("1500", "Leasehold improvements", 5), acc("1510", "Quasar rig", 5), acc("1520", "Due from sister company", 5)] });
    expect(out[1].kind).toBe("decline");
    expect(out[1].reason).toContain("neighbours split between Property, plant and equipment and Due from related parties");
  });
});

describe("the same inputs give the same answer", () => {
  it("run twice, and with the accounts and the examples in another order, gives the same placement for every account", () => {
    const accounts = toAccounts(CLIENT_B);
    const examples = examplesFromA();
    const first = assist({ accounts, examples });
    expect(assist({ accounts, examples })).toEqual(first);
    const byCode = (list: Placement[]) => new Map(list.map((p) => [p.accountCode, p]));
    const shuffled = [...accounts].reverse();
    const again = assist({ accounts: shuffled, examples: [...examples].reverse() });
    expect(again.map((p) => p.accountCode)).toEqual(shuffled.map((a) => a.code));
    for (const [code, p] of byCode(first)) expect(byCode(again).get(code), code).toEqual(p);
  });

  it("breaks a tie by group code, the same way every time", () => {
    for (let n = 0; n < 3; n++) expect(one(acc("1", "Advertising borrowing", 3000)).reason).toContain("between General and administrative expenses and Borrowings");
  });

  it("bands are fixed ranges of the score", () => {
    expect([0.8, 0.79, 0.6, 0.59, 0.45].map(bandOf)).toEqual(["high", "medium", "medium", "low", "low"]);
  });
});

describe("how well it does on an invented company, before and after it learns from another's approved mappings", () => {
  // Client B is a different company: other codes, other wording, abbreviations. Client A's approved mappings are what the firm has learned from.
  const measure = (examples: LearnedExample[]) => {
    const out = assist({ accounts: toAccounts(CLIENT_B), examples });
    let correct = 0;
    let high = 0;
    let wrong = 0;
    let declined = 0;
    let rightlyDeclined = 0;
    out.forEach((p, i) => {
      const expected = CLIENT_B[i][3];
      if (p.kind === "decline") {
        declined++;
        if (expected === null) rightlyDeclined++;
      } else if (p.groupCode === expected) {
        correct++;
        if (p.band === "high") high++;
      } else wrong++;
    });
    return { accounts: CLIENT_B.length, placeable: CLIENT_B.filter((r) => r[3] !== null).length, correct, high, wrong, declined, rightlyDeclined };
  };

  it("pins the numbers: a change that lowers them is noticed", () => {
    const before = measure([]);
    const after = measure(examplesFromA());
    // Printed by the PR and the report. Raise these when the assistant gets better; never lower them to make a test pass.
    expect(before).toEqual({ accounts: 54, placeable: 52, correct: 51, high: 2, wrong: 0, declined: 3, rightlyDeclined: 2 });
    expect(after).toEqual({ accounts: 54, placeable: 52, correct: 51, high: 8, wrong: 0, declined: 3, rightlyDeclined: 2 });
    expect(after.correct).toBeGreaterThanOrEqual(before.correct);
    expect(after.high).toBeGreaterThan(before.high);
  });

  it("never places an account wrongly in the fixture, with or without learning", () => {
    expect(measure([]).wrong).toBe(0);
    expect(measure(examplesFromA()).wrong).toBe(0);
  });
});
