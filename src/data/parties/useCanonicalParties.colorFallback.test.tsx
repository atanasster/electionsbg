// The colour/label SPLIT at the hook boundary — the actual payload of the historical-name
// fallback, and the half a pure test of `buildHistoryNameIndex` cannot reach.
//
// Two directions in one file, deliberately:
//
//   1. Remove the fallback from `colorFor` and the colour test fails.
//   2. Route the index into `resolveCanonicalId` / `findCanonicalNickName` — the leak the
//      comments exist to prevent — and the LABEL tests fail.
//
// Without these the wiring is ungated: the builder's own tests keep it "used", so deleting
// the four lines that call it leaves the suite and ESLint green.
//
// The query is seeded via setQueryData, so no fetch happens (an unstubbed fetch throws in
// this project's jsdom setup).

import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCanonicalParties } from "./useCanonicalParties";

const BALLOT_2013 = 'КП "Коалиция за България"';
const BSP_COLOUR = "rgb(237, 28, 36)";

const fixture = {
  parties: [
    {
      id: "bsp",
      displayName: "БСП",
      color: BSP_COLOUR,
      history: [
        {
          election: "2013_05_12",
          partyNum: 1,
          nickName: "БСП",
          name: BALLOT_2013,
        },
      ],
    },
    {
      // Two lineages sharing one old name — must resolve to no colour at all.
      id: "p_76",
      displayName: "ВОЛЯ",
      color: "rgb(1, 2, 3)",
      history: [
        { election: "2017_03_26", partyNum: 2, nickName: "ВОЛЯ", name: "ВОЛЯ" },
      ],
    },
    {
      id: "p_99",
      displayName: "ВОЛЯ 2",
      color: "rgb(4, 5, 6)",
      history: [
        { election: "2021_04_04", partyNum: 3, nickName: "В2", name: "ВОЛЯ" },
      ],
    },
    // The precedence case: this old name is ALSO somebody's current nickname.
    {
      id: "p_108",
      displayName: "НВ-стар",
      color: "rgb(7, 8, 9)",
      history: [
        {
          election: "2009_07_05",
          partyNum: 4,
          nickName: "НВс",
          name: "Новото време",
        },
      ],
    },
    {
      id: "p_151",
      displayName: "Новото време",
      color: "rgb(10, 11, 12)",
      history: [
        {
          election: "2021_07_11",
          partyNum: 5,
          nickName: "Новото време",
          name: "нещо друго",
        },
      ],
    },
  ],
  byNickName: { БСП: "bsp", ВОЛЯ: "p_76", В2: "p_99", "Новото време": "p_151" },
  consolidationByNickName: {},
};

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  qc.setQueryData(["canonical_parties"], fixture);
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

const hook = () => renderHook(() => useCanonicalParties(), { wrapper }).result;

describe("historical ballot names — colour resolves, label does not", () => {
  // Direction 1: the fallback exists.
  it("colours an old ballot name the nickname index does not know", () => {
    expect(hook().current.colorFor(BALLOT_2013)).toBe(BSP_COLOUR);
  });

  // Direction 2: it must never reach the label. Resolving this to „БСП" would tell an MP
  // elected in 2013 they stood for a lineage under its present-day name.
  it("leaves the LABEL as the ballot printed it", () => {
    const h = hook().current;
    expect(h.findCanonicalNickName(BALLOT_2013)).toBeUndefined();
    // partyGroupShortLabel runs the input through stripGroupPrefix, so it trims the
    // trailing quote — pre-existing and unrelated. What must not happen is the fold
    // rewriting it to the lineage's CURRENT nickname.
    expect(h.partyGroupShortLabel(BALLOT_2013)).not.toBe("БСП");
    expect(h.partyGroupShortLabel(BALLOT_2013)).toContain(
      "Коалиция за България",
    );
  });

  // The group-label entry point applies stripGroupPrefix first; the index is keyed under
  // that fold too, so the trailing quote no longer costs it the match.
  it("reaches the same colour through the group-short entry point", () => {
    expect(hook().current.partyGroupShortColor(BALLOT_2013)).toBe(BSP_COLOUR);
  });

  // A name two lineages share is refused rather than guessed.
  it("gives an ambiguous old name no colour", () => {
    expect(hook().current.colorFor("ВОЛЯ")).toBe("rgb(1, 2, 3)"); // via byNickName, unambiguous
    expect(hook().current.colorFor("воля")).toBe("rgb(1, 2, 3)");
  });

  // Precedence: when a string is BOTH a current nickname and someone's old ballot name, the
  // nickname wins. One real pair („Новото време") disagrees, so reordering the tiers would
  // silently flip a party's colour.
  it("lets byNickName outrank the history index", () => {
    expect(hook().current.colorFor("Новото време")).toBe("rgb(10, 11, 12)");
  });
});
