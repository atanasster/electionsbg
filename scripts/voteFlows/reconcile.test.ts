import { describe, expect, it } from "vitest";
import { buildPartyNumToCanonical } from "./reconcile";
import { CanonicalPartiesIndex } from "@/data/parties/canonicalPartyTypes";
import { PartyInfo } from "@/data/dataTypes";

// Minimal canonical fixture covering the three Peevski/Dogan lineages that the
// flow alias touches, plus one unrelated party as a control.
const canonical: CanonicalPartiesIndex = {
  parties: [
    {
      id: "p_10",
      displayName: "АПС",
      color: "#000",
      history: [
        { election: "2024_10_27", partyNum: 13, nickName: "АПС" },
        { election: "2026_04_19", partyNum: 11, nickName: "АПС" },
      ],
    },
    {
      id: "p_16",
      displayName: "ДПС",
      color: "#000",
      history: [
        { election: "2024_06_09", partyNum: 28, nickName: "ДПС" },
        { election: "2026_04_19", partyNum: 17, nickName: "ДПС" },
      ],
    },
    {
      id: "p_29",
      displayName: "ДПС-НН",
      color: "#000",
      history: [{ election: "2024_10_27", partyNum: 8, nickName: "ДПС-НН" }],
    },
  ],
  byNickName: { "АПС": "p_10", "ДПС": "p_16", "ДПС-НН": "p_29" },
  consolidationByNickName: {},
};

const party = (number: number, nickName: string): PartyInfo => ({
  number,
  name: nickName,
  nickName,
  color: "#000",
});

describe("buildPartyNumToCanonical — flow alias", () => {
  it("folds Peevski's Oct-2024 ДПС-НН (p_29) into the continuous ДПС node (p_16)", () => {
    const map = buildPartyNumToCanonical(
      canonical,
      [party(8, "ДПС-НН"), party(13, "АПС")],
      "2024_10_27",
    );
    // #8 resolves to p_29 in canonical history, but the flow alias rewrites it
    // to p_16 so Peevski's party is one node across the 2024→2026 transition.
    expect(map.get(8)).toBe("p_16");
    // Dogan's АПS is untouched — it keeps its own stable lineage.
    expect(map.get(13)).toBe("p_10");
  });

  it("aliases through the byNickName fallback too (party absent from history)", () => {
    // A cik row whose number is not in any lineage history falls back to
    // byNickName; that path must alias as well, or the ghost node returns.
    const map = buildPartyNumToCanonical(
      canonical,
      [party(99, "ДПС-НН")],
      "2099_01_01",
    );
    expect(map.get(99)).toBe("p_16");
  });

  it("leaves the 2026 ДПС mapped to p_16, so from/to share one id", () => {
    const map = buildPartyNumToCanonical(
      canonical,
      [party(17, "ДПС")],
      "2026_04_19",
    );
    expect(map.get(17)).toBe("p_16");
  });
});
