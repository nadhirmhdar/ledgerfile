import { describe, expect, it } from "vitest";
import { lettersSentence, misstatementSentence } from "../src/ui/letters-view";

describe("lettersSentence", () => {
  it("is short when there is nothing to list", () => {
    expect(lettersSentence([])).toBe("Two letters to download as Word documents.");
  });
  it("adds the misstatements the representation letter lists, in the singular and the plural", () => {
    expect(lettersSentence([4500000])).toBe("Two letters to download as Word documents. The representation letter lists 1 uncorrected misstatement, net 45,000.00.");
    expect(lettersSentence([100000, 250000])).toBe("Two letters to download as Word documents. The representation letter lists 2 uncorrected misstatements, net 3,500.00.");
  });
});

describe("misstatementSentence", () => {
  it("says there are none", () => {
    expect(misstatementSentence([])).toBe("No uncorrected misstatements are recorded, so the letter will say there are none.");
  });
  it("counts one or several, with no (s)", () => {
    expect(misstatementSentence([4500000])).toBe("1 uncorrected misstatement, net 45,000.00, will be listed in a schedule attached to the letter.");
    expect(misstatementSentence([100000, -40000, 5000])).toBe("3 uncorrected misstatements, net 650.00, will be listed in a schedule attached to the letter.");
  });
});
