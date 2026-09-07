// The place-level map adapters — the claims that would each render as a fine page.
//
// ⚠ EVERY CASE HERE IS A MAP THAT WOULD LOOK RIGHT. A presidential region map coloured by the
// wrong ROUND is a full choropleth of plausible leaders; a local region map coloured by
// mayoralties under a council heading is a full choropleth of real parties; and a município map
// drawn from an unresolved roll-up is 31 named places asserting „няма подадени гласове". None
// of them errors, and none of them is visibly broken.

import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus, enCorpus } from "@/locales/allKeys";

await i18n.use(initReactI18next).init({
  lng: "bg",
  fallbackLng: "bg",
  resources: { bg: { translation: bgCorpus }, en: { translation: enCorpus } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const MAYOR_COLOR = "#aa0000";
const COUNCIL_COLOR = "#0000bb";
const R1_COLOR = "#111111";
const R2_COLOR = "#222222";

const muniGeo = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { nuts4: "SFO46" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [23, 42],
            [24, 42],
            [24, 43],
            [23, 42],
          ],
        ],
      },
    },
  ],
};

vi.mock("@/data/municipalities/useMunicipalitiesMap", () => ({
  useMunicipalitiesMap: () => muniGeo,
}));
vi.mock("@/data/municipalities/useMunicipalities", () => ({
  useMunicipalities: () => ({
    findMunicipality: () => ({ name: "Самоков", name_en: "Samokov" }),
  }),
}));
vi.mock("@/data/settlements/useSettlementsMap", () => ({
  useSettlementsMap: () => undefined,
}));
vi.mock("@/data/settlements/useSettlements", () => ({
  useSettlementsInfo: () => ({ findSettlement: () => undefined }),
}));
vi.mock("@/data/local/useLocalRegion", () => ({
  useLocalRegion: () => ({
    data: {
      municipalities: [
        {
          obshtinaCode: "SFO46",
          name: "Самоков",
          electedMayor: { displayName: "ГЕРБ-СДС", color: MAYOR_COLOR },
          topCouncil: { displayName: "БСП-ОЛ", color: COUNCIL_COLOR, seats: 9 },
        },
      ],
    },
  }),
}));

// One ticket per round, so the fill alone says which round was drawn.
vi.mock("@/data/presidential/useTickets", () => ({
  useTicketsByNumber: () =>
    new Map([
      [1, { number: 1, president: "Първи Кандидат", color: R1_COLOR }],
      [2, { number: 2, president: "Втори Кандидат", color: R2_COLOR }],
    ]),
}));
vi.mock("@/data/presidential/useRoundRollup", async (orig) => {
  const real =
    await orig<typeof import("@/data/presidential/useRoundRollup")>();
  return {
    ...real,
    // ⚠ THE ROUND PICKS THE WINNER, so a component that ignored `round` colours both canvases
    // the same and this file's central case fails.
    useRoundRollup: (_c: string, round: 1 | 2) => ({
      status: "ready",
      rollup: {
        coverage: { basis: "x", sections: 1, excludedSections: 0 },
        entries: [
          {
            key: "SFO46",
            results: { votes: [{ partyNum: round, totalVotes: 100 }] },
          },
        ],
      },
    }),
  };
});

const { LocalRegionChoropleth } =
  await import("@/screens/dashboard/local/LocalRegionChoropleth");
const { PresidentialChildMap } =
  await import("@/screens/presidential/PresidentialChildMap");

/** ⚠ THE FEATURE PATH, NOT THE FIRST PATH. `LocalChoropleth` mounts a Leaflet basemap whose
 *  own `<path>` elements come first in the DOM and carry a tile colour — reading `path` bare
 *  returned `#4C7BE1` and compared it against a party's. A feature is the one with a label. */
const draw = (node: React.ReactNode) => {
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
  return {
    feature: container.querySelector("path[aria-label]"),
    anyPath: container.querySelector("path"),
  };
};

describe("the local region map", () => {
  it("colours by the MAYOR or the COUNCIL, whichever ballot's slot asked", () => {
    // ⚠ `local/region` DECLARES TWO SLOTS THAT RESOLVE TO ONE ADAPTER KEY, because both carry
    // `defaultMode: "winner"`. Without the `ballot` branch the council canvas is filled with
    // mayoralties — a real party, a real colour, the wrong question.
    const { feature: mayor } = draw(
      <LocalRegionChoropleth
        size={[400, 300, 0, 0]}
        cycle="2023_10_29_mi"
        oblast="SFO"
        metric="mayor"
      />,
    );
    expect(mayor?.getAttribute("fill")).toBe(MAYOR_COLOR);
    expect(mayor?.getAttribute("aria-label")).toContain("ГЕРБ-СДС");

    const { feature: council } = draw(
      <LocalRegionChoropleth
        size={[400, 300, 0, 0]}
        cycle="2023_10_29_mi"
        oblast="SFO"
        metric="council"
      />,
    );
    expect(council?.getAttribute("fill")).toBe(COUNCIL_COLOR);
    expect(council?.getAttribute("aria-label")).toContain("БСП-ОЛ");
    // Stated as a difference too, so a fixture whose two colours coincided could not pass.
    expect(mayor?.getAttribute("fill")).not.toBe(council?.getAttribute("fill"));
  });

  it("makes every município keyboard-reachable, not mouse-only", () => {
    // `FeatureMap` derives keyboard access as `!!ariaLabel && !!onClick`, so a map that lost
    // its labels still fills, still tooltips and still navigates — for a mouse.
    const { feature: p } = draw(
      <LocalRegionChoropleth
        size={[400, 300, 0, 0]}
        cycle="2023_10_29_mi"
        oblast="SFO"
        metric="council"
      />,
    );
    expect(p?.getAttribute("tabindex")).toBe("0");
    expect(p?.getAttribute("role")).toBe("button");
  });
});

describe("the presidential child map", () => {
  it("colours each canvas by ITS OWN round", () => {
    // ⚠ THE CASE THIS FILE EXISTS FOR. A presidential place artifact carries two ballots of the
    // same kind — round 1 and the runoff — and both declare a map, so the shell mounts this
    // component twice on one page. The rounds are different electorates (5.7 points apart
    // nationally in 2021) and name different leaders in whole oblasts, so a map that took a
    // single "current" round paints the runoff canvas with round 1's answer.
    const { feature: r1 } = draw(
      <PresidentialChildMap
        cycle="2021_11_14_pvr"
        round={1}
        parentId="SFO"
        grain="municipality"
      />,
    );
    const { feature: r2 } = draw(
      <PresidentialChildMap
        cycle="2021_11_14_pvr"
        round={2}
        parentId="SFO"
        grain="municipality"
      />,
    );
    expect(r1?.getAttribute("fill")).toBe(R1_COLOR);
    expect(r2?.getAttribute("fill")).toBe(R2_COLOR);
    expect(r1?.getAttribute("aria-label")).toContain("Първи Кандидат");
    expect(r2?.getAttribute("aria-label")).toContain("Втори Кандидат");
  });

  it("draws NOTHING until the roll-up has answered", async () => {
    // ⚠ ABSENT IS THE ORDINARY STATE OF THIS CORPUS — `data/*_pvr` is gitignored and has no
    // bucket copy. A place missing from a READY roll-up genuinely cast no votes; one missing
    // because nothing has loaded has not, and painting „няма подадени гласове" across a whole
    // oblast is a false claim about named places rather than a blank map.
    vi.resetModules();
    vi.doMock("@/data/presidential/useRoundRollup", async (orig) => {
      const real =
        await orig<typeof import("@/data/presidential/useRoundRollup")>();
      return { ...real, useRoundRollup: () => ({ status: "loading" }) };
    });
    const { PresidentialChildMap: Pending } =
      await import("@/screens/presidential/PresidentialChildMap");
    const { feature: p, anyPath } = draw(
      <Pending
        cycle="2021_11_14_pvr"
        round={1}
        parentId="SFO"
        grain="municipality"
      />,
    );
    expect(p).toBeNull();
    // …and the map did not mount AT ALL — not merely that its features lost their labels,
    // which would leave a fully-drawn choropleth that a screen reader cannot see.
    expect(anyPath).toBeNull();
    expect(document.body.textContent).not.toContain("няма подадени гласове");
  });
});
