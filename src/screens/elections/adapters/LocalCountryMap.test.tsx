// The local country map's ONE substantive claim: it is filled by the party leading the oblast's
// COUNCIL VOTE, and not by the party holding the most council SEATS.
//
// ⚠ THE TWO ARE INTERCHANGEABLE AT EVERY LEVEL EXCEPT THE ANSWER. Both arrays sit on the same
// `regions_summary.json` row, both are sorted leader-first, both carry a `canonicalId` and a
// `color`, and a map filled by either renders 29 coloured oblasts with working tooltips and
// working drill-down. What separates them is which party a given oblast is coloured for — in
// 2023, Благоевград and Ямбол — so every fixture here gives the two arrays DIFFERENT leaders
// and asserts on the fill. A fixture where they agreed would pass against either implementation.
//
// ⚠ AND THE MAP MUST NOT BORROW THE SEATS LEADER WHEN THE VOTES ARE ABSENT. A
// `regions_summary.json` written before the field existed — a cached copy, an un-synced bucket
// — has `councilSeats` and no `councilVotes`, and a `??` fallback there would publish the seats
// answer under the votes question on exactly the oblasts where they disagree.

import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import type { LocalRegionsSummaryRow } from "@/data/local/types";

await i18n.use(initReactI18next).init({
  lng: "bg",
  fallbackLng: "bg",
  resources: { bg: { translation: bgCorpus }, en: { translation: enCorpus } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const VOTES_COLOR = "#111111";
const SEATS_COLOR = "#222222";

/** One oblast whose votes leader and seats leader are DIFFERENT parties — the only fixture
 *  shape that can tell the two implementations apart. */
const ROW: LocalRegionsSummaryRow = {
  oblast: "BLG",
  municipalityCount: 14,
  runoffCount: 1,
  totalCouncilSeats: 260,
  turnoutPct: 45,
  topMayor: null,
  topCouncil: {
    canonicalId: "dps",
    displayName: "ДПС",
    color: SEATS_COLOR,
    seats: 71,
  },
  mayorsWon: [],
  councilSeats: [
    { canonicalId: "dps", displayName: "ДПС", color: SEATS_COLOR, seats: 71 },
  ],
  councilVotes: [
    {
      canonicalId: "gerb",
      displayName: "ГЕРБ-СДС",
      color: VOTES_COLOR,
      votes: 24_000,
    },
    {
      canonicalId: "dps",
      displayName: "ДПС",
      color: SEATS_COLOR,
      votes: 21_000,
    },
  ],
};

const regions = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock("@/data/regions/useRegionsMap", () => ({
  useRegionsMap: () => ({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { nuts3: "BLG" },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [23, 41],
              [24, 41],
              [24, 42],
              [23, 41],
            ],
          ],
        },
      },
    ],
  }),
}));
// The Столична-община outline is a separate fetch; absent is a real state and the map keeps
// drawing the other 28 oblasts without it.
vi.mock("@/data/regions/useSofiaObshtinaMap", () => ({
  useSofiaObshtinaMap: () => undefined,
}));
vi.mock("@/data/regions/useRegions", () => ({
  useRegions: () => ({
    findRegion: () => ({
      name: "Благоевград",
      long_name: "Благоевград",
      name_en: "Blagoevgrad",
      long_name_en: "Blagoevgrad",
    }),
  }),
}));
vi.mock("@/data/local/useLocalRegionsSummary", () => ({
  useLocalRegionsSummary: () => ({ data: { regions: regions.current } }),
}));

const { default: LocalCountryMap } = await import("./LocalCountryMap");

const draw = (rows: unknown[], ballot?: string) => {
  regions.current = rows;
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <LocalCountryMap
          cycle="2023_10_29_mi"
          ballot={ballot}
          placeId="BG"
          posture="presentational"
          ariaLabel="карта"
          features={[]}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return container.querySelector("path")!;
};

describe("the local country map", () => {
  it("fills an oblast for its VOTES leader, not its seats leader", () => {
    const path = draw([ROW]);
    expect(path.getAttribute("fill")).toBe(VOTES_COLOR);
    // Stated the other way round too, so the case cannot pass by accident on a shared colour.
    expect(path.getAttribute("fill")).not.toBe(SEATS_COLOR);
  });

  it("names the leader and the basis in the label a screen reader gets", () => {
    // ⚠ THE LABEL IS ALSO WHAT MAKES THE REGION REACHABLE. `FeatureMap` derives keyboard access
    // as `!!ariaLabel && !!onClick`, so a map that lost its labels is not merely unannounced —
    // it is mouse-only, with `tabindex`, `role` and the focus ring all silently gone.
    const path = draw([ROW]);
    const label = path.getAttribute("aria-label") ?? "";
    expect(label).toContain("Благоевград");
    expect(label).toContain("ГЕРБ-СДС");
    expect(label).not.toContain("ДПС");
    // 24,000 of 45,000 — the share is of the oblast's own council vote.
    expect(label).toContain("53,3%");
    expect(path.getAttribute("tabindex")).toBe("0");
    expect(path.getAttribute("role")).toBe("button");
  });

  it("leaves an oblast UNFILLED when the summary predates councilVotes", () => {
    // A `?? councilSeats` fallback would colour this ДПС and label it as a council-vote lead.
    const legacy: LocalRegionsSummaryRow = { ...ROW };
    delete legacy.councilVotes;
    const path = draw([legacy]);
    expect(path.getAttribute("fill")).not.toBe(SEATS_COLOR);
    expect(path.getAttribute("fill")).not.toBe(VOTES_COLOR);
    expect(path.getAttribute("aria-label")).toContain(
      bgCorpus.local_map_council_region_label_empty.replace(
        "{{place}}",
        "Благоевград",
      ),
    );
  });

  it("reads MAYORALTIES when the slot is the mayor ballot", () => {
    // ⚠ `local/country` DECLARES TWO MAP SLOTS THAT RESOLVE TO THIS ONE ADAPTER, because both
    // carry `defaultMode: "winner"`. Only the council ballot is generated today; without the
    // branch a mayor slot would render mayoralty COUNTS under a votes label.
    const path = draw(
      [
        {
          ...ROW,
          mayorsWon: [
            {
              canonicalId: "dps",
              displayName: "ДПС",
              color: SEATS_COLOR,
              count: 8,
            },
          ],
        },
      ],
      "municipality_mayor",
    );
    expect(path.getAttribute("fill")).toBe(SEATS_COLOR);
    expect(path.getAttribute("aria-label")).toContain("ДПС");
  });
});
