// Coverage for the ingest-time party reconciliation. A name that fails to
// resolve here is baked into the bundle as `primaryCanonicalId: null` and
// then renders on /local/chmi as raw CIK text with no party link — the
// failure is invisible (a 200 with a plausible-looking label), so the
// normalisation rules get a test rather than a spot check.

import { describe, expect, it } from "vitest";
import { CanonicalPartiesIndex } from "@/data/parties/canonicalPartyTypes";
import { buildByNickNameLower, resolveLocalParty } from "./local_coalitions";

// Minimal stand-in for canonical_parties.json: the two lineages the
// prefix-variant cases below resolve to, plus one two-member coalition so
// the splitter path stays exercised.
const canonical = {
  parties: [
    {
      id: "p_22",
      displayName: "ПнЗ",
      color: "#0a0",
      history: [
        {
          election: "2026_04_19",
          nickName: "ПнЗ",
          name: "Партия на ЗЕЛЕНИТЕ",
        },
      ],
    },
    {
      id: "p_16",
      displayName: "ДПС",
      color: "#00a",
      history: [{ election: "2026_04_19", nickName: "ДПС", name: "ДПС" }],
    },
  ],
  byNickName: { ПнЗ: "p_22", ДПС: "p_16" },
} as unknown as CanonicalPartiesIndex;

const byNickNameLower = buildByNickNameLower(canonical);
const resolve = (raw: string) =>
  resolveLocalParty(raw, byNickNameLower, [], []);

describe("resolveLocalParty — party-form prefixes", () => {
  // CIK spells the same abbreviation several ways across cycles. Each row is
  // a form observed in the local-elections corpus; before the dotted and
  // quote-adjacent forms were handled, the first two resolved to null while
  // the plain forms resolved fine — so one party's chip appeared on some
  // cycles and not others.
  it.each([
    ["п.п. Партия на ЗЕЛЕНИТЕ", "p_22"], // 2026_06_14_chmi
    ["ПП Партия на ЗЕЛЕНИТЕ", "p_22"],
    ["Партия на ЗЕЛЕНИТЕ", "p_22"], // 2024 cycles — resolved before the fix
    ['ПП"ДПС"', "p_16"], // no space, quote against the prefix
    ['ПП "ДПС"', "p_16"],
    ["ПП ДПС", "p_16"],
    ["ДПС", "p_16"],
  ])("resolves %j to %s", (raw, expected) => {
    const r = resolve(raw);
    expect(r.primaryCanonicalId).toBe(expected);
    expect(r.unmatchedFragments).toEqual([]);
  });

  it("does not eat a prefix-shaped run that is part of the name", () => {
    // The separator must be whitespace or a quote, so "ППхх" is not a
    // stripped "ПП" — it stays whole and reports itself unmatched.
    expect(resolve("ППДПС").primaryCanonicalId).toBeNull();
  });

  it("still buckets initiative committees as independent", () => {
    const r = resolve("Инициативен комитет за издигане на Иван Иванов");
    expect(r.isIndependent).toBe(true);
    expect(r.primaryCanonicalId).toBe("independent");
  });

  it("reports unmatched fragments instead of guessing", () => {
    const r = resolve("Местна коалиция ДПС - Няма такава партия");
    expect(r.primaryCanonicalId).toBe("p_16");
    expect(r.unmatchedFragments).toEqual(["Няма такава партия"]);
  });
});
