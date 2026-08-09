// Band 5's two tiles. Every case here is a SENTENCE the band must not be able to say.
//
// This band is where a reader looks for their own place, so its failure modes are about
// attributing a figure to the wrong one, or presenting an absence as a fact:
//
//   1. A DEFAULT PLACE. Silently answering for Sofia when nobody chose a place is a wrong answer
//      that looks like a right one.
//   2. A FAILED FETCH RENDERED AS „0 €". „We could not load it" and „this municipality received
//      nothing" are different facts and only one of them is evidenced.
//   3. A LAST PLACE INVENTED FOR THE BIGGEST RECIPIENT. Столична община has no ГРАО city EKATTE,
//      so it has no per-capita rank on either arm — rendering `rank` as 0/256 would be the most
//      wrong possible statement about the largest recipient in the country.
//   4. A LINK TO A ROUTE THAT DOES NOT EXIST. This band is navigation; a 404 is its whole failure.

import { describe, expect, it, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import bg from "@/locales/bg/translation.json";
import type { FundsMuniCombined } from "@/data/funds/types";

const state = vi.hoisted(() => ({
  anchorId: null as string | null,
  lastKey: null as string | null,
  area: null as unknown,
  muni: {
    data: null as FundsMuniCombined | null,
    isError: false,
    isPending: false,
  },
  programmes: {
    data: null as {
      byProgram: { programCode: string; programName: string }[];
    } | null,
    isError: false,
    isPending: false,
  },
}));

vi.mock("@/data/area/areaAnchor", async (orig) => ({
  ...(await orig<typeof import("@/data/area/areaAnchor")>()),
  useAreaAnchor: () => (state.anchorId ? { id: state.anchorId } : null),
}));
vi.mock("@/data/area/useAreaResolver", () => ({
  useAreaResolver: () => state.area,
}));
vi.mock("@/data/municipalities/useMunicipalities", () => ({
  // The tile resolves a settlement anchor's obshtina CODE to its name. Stubbed so the test does
  // not pull the ~980 KB municipalities file, and so the settlement case can assert that the
  // MUNICIPALITY is what gets named.
  useMunicipalities: () => ({
    findMunicipality: (code?: string | null) =>
      code === "BLG52" ? { name: "Петрич", obshtina: "BLG52" } : undefined,
  }),
}));
vi.mock("@/data/funds/useFundsMuniCombined", () => ({
  useFundsMuniCombined: (key?: string) => {
    // Recorded, because the KEY is half of what this tile has to get right: the funds corpus
    // folds Sofia's районы onto one city key while the governance hub does not.
    state.lastKey = key ?? null;
    return state.muni;
  },
}));
vi.mock("@/data/funds/useFundsProjectsIndex", () => ({
  useFundsProjectsIndex: () => state.programmes,
}));

const { MyMunicipalityTile, MySectorTile } = await import("./ForYouTiles");

// The SHIPPED bundle. Without it `t()` returns the key, which is truthy — so `t(k) || "fallback"`
// never fires and every assertion below would be checking „funds_foryou_muni".
beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: "bg",
    fallbackLng: "bg",
    resources: { bg: { translation: bg } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
});

const muni = (over: Partial<FundsMuniCombined> = {}): FundsMuniCombined => ({
  obshtina: "BLG52",
  population: 10_000,
  isunEur: 8_000_000,
  interregEur: 2_000_000,
  totalEur: 10_000_000,
  interregPartnerCount: 3,
  interregOperationCount: 2,
  perCapitaEur: 1000,
  perCapitaEurIsun: 800,
  rank: 42 as number | null,
  rankBefore: 60 as number | null,
  rankDelta: 18 as number | null,
  cohortSize: 256,
  oblastCode: "BLG",
  oblastRank: 3,
  oblastRankBefore: 5,
  oblastRankDelta: 2,
  oblastCohortSize: 14,
  ...over,
});

const asMunicipality = (obshtina: string, name: string) => ({
  kind: "municipality" as const,
  id: obshtina,
  obshtina,
  oblast: obshtina.slice(0, 3),
  municipality: { name },
});

const draw = (node: React.ReactElement) =>
  render(<MemoryRouter>{node}</MemoryRouter>);

describe("MyMunicipalityTile", () => {
  it("asks the reader to pick a place rather than DEFAULTING to one", () => {
    // A default place is a wrong answer that looks like a right one, and nothing on the card
    // would tell the reader it is not theirs.
    state.anchorId = null;
    state.area = null;
    state.muni = { data: null, isError: false, isPending: false };
    draw(<MyMunicipalityTile />);
    expect(screen.getByText(/Изберете населено място/)).toBeTruthy();
    expect(screen.queryByText(/€/)).toBeNull();
  });

  it("shows the combined ИСУН + Interreg figure and names the basis", () => {
    state.anchorId = "BLG52";
    state.area = asMunicipality("BLG52", "Петрич");
    state.muni = { data: muni(), isError: false, isPending: false };
    draw(<MyMunicipalityTile />);
    expect(screen.getByText("Петрич")).toBeTruthy();
    // The basis must be stated, and stated PER ARM: „EU money" is two different numbers
    // depending on whether Interreg is counted (the gap lands on exactly these border
    // municipalities), and the two arms are not even the same quantity — ИСУН publishes signed
    // contracts while 139's Interreg column is a partner's published budget.
    expect(screen.getByText(/подписани договори/)).toBeTruthy();
    expect(screen.getByText(/публикуван бюджет/)).toBeTruthy();
    expect(screen.getByText(/От тях по Interreg/)).toBeTruthy();
  });

  it("does NOT name the Interreg arm when the municipality has none", () => {
    // Otherwise every inland municipality carries a „from which Interreg: €0" line implying a
    // programme it is not eligible for.
    state.anchorId = "SFO00";
    state.area = asMunicipality("SFO00", "Своге");
    state.muni = {
      data: muni({ interregEur: 0 }),
      isError: false,
      isPending: false,
    };
    draw(<MyMunicipalityTile />);
    expect(screen.queryByText(/От тях по Interreg/)).toBeNull();
  });

  it("REJECTS a failed fetch — it must not read as „received nothing”", () => {
    state.anchorId = "BLG52";
    state.area = asMunicipality("BLG52", "Петрич");
    state.muni = { data: null, isError: true, isPending: false };
    draw(<MyMunicipalityTile />);
    expect(screen.getByText(/не се заредиха/)).toBeTruthy();
    expect(screen.queryByText(/0\s*€/)).toBeNull();
  });

  it("says „not ranked” rather than inventing a rank for a cohort non-member", () => {
    // Столична община has no ГРАО city EKATTE, so no per-capita figure on either arm. A `0`
    // rendered as „0/256" would give the country's largest recipient last place.
    state.anchorId = "SOF00";
    state.area = asMunicipality("SOF00", "Столична");
    state.muni = {
      data: muni({ rank: null, cohortSize: 256 }),
      isError: false,
      isPending: false,
    };
    draw(<MyMunicipalityTile />);
    // The whole LINE must be absent, not merely one rendering of it: an `!== undefined` test
    // passes a null straight through and prints „null/256", which no „0/256" assertion catches.
    expect(screen.queryByText(/На глава от населението/)).toBeNull();
    expect(screen.queryByText(/\/256/)).toBeNull();
    // …and the not-ranked sentence takes its place, so the card still says something.
    expect(screen.getByText(/не е в класацията/)).toBeTruthy();
  });

  it("a NULL payload is „no published figure”, never „not ranked” and never a loading state", () => {
    // `!data` is three different things — the fetch in flight, a database without migration 139
    // (whose route degrades to null at a 200), and a municipality with no row. Asserting „not
    // ranked" for all three was a claim on every cold load.
    state.anchorId = "SOF00";
    state.area = asMunicipality("SOF00", "Столична");
    state.muni = { data: null, isError: false, isPending: false };
    draw(<MyMunicipalityTile />);
    expect(screen.getByText(/Няма публикувана сума/)).toBeTruthy();
    expect(screen.queryByText(/не е в класацията/)).toBeNull();
  });

  it("says it is LOADING while the fetch is in flight", () => {
    state.anchorId = "BLG52";
    state.area = asMunicipality("BLG52", "Петрич");
    state.muni = { data: null, isError: false, isPending: true };
    draw(<MyMunicipalityTile />);
    expect(screen.getByText(/Зарежда се/)).toBeTruthy();
  });

  it("names the MUNICIPALITY, not the settlement, above a municipal figure", () => {
    // THE wrong-place test. The common anchor shape is a settlement, and the money below is a
    // municipal total: naming the village in bold reads as „с. Микрево received €10m", a claim
    // about the wrong place that nothing on the card corrects.
    state.anchorId = "24367";
    state.area = {
      kind: "settlement" as const,
      id: "24367",
      ekatte: "24367",
      obshtina: "BLG52",
      oblast: "BLG",
      settlement: { name: "Микрево", obshtina: "BLG52" },
    };
    state.muni = { data: muni(), isError: false, isPending: false };
    const { container } = draw(<MyMunicipalityTile />);
    // The card's own title is an <h3>; the place label is the div beneath it.
    const label = container.querySelector("div.text-sm.font-medium");
    expect(label?.textContent).toBe("Петрич");
    // The settlement is still shown — as context, in the smaller line, where it belongs.
    expect(screen.getByText(/Микрево/)).toBeTruthy();
  });

  it("falls back to the CODE, never the settlement name, when the municipality is unresolved", () => {
    // The municipalities file loads asynchronously, so there is a window where the code cannot
    // be resolved to a name. Falling back to the settlement's name there would re-introduce the
    // wrong-place attribution for exactly as long as the fetch takes — an intermittent bug, the
    // hardest kind to see. An unlovely code is the honest placeholder.
    state.anchorId = "24367";
    state.area = {
      kind: "settlement" as const,
      id: "24367",
      ekatte: "24367",
      obshtina: "KRZ99", // not in the mocked municipalities
      oblast: "KRZ",
      settlement: { name: "Микрево", obshtina: "KRZ99" },
    };
    state.muni = { data: muni(), isError: false, isPending: false };
    const { container } = draw(<MyMunicipalityTile />);
    const label = container.querySelector("div.text-sm.font-medium");
    expect(label?.textContent).toBe("KRZ99");
    expect(label?.textContent).not.toBe("Микрево");
  });

  it("uses the CITY funds key for a Sofia район but keeps the район in its links", () => {
    // Two different keys, and conflating them is a real bug this test caught. The funds corpus
    // is published at city grain, so the figure has to come from S22 (the key
    // MyAreaProjectsMapTile already established — a different one would give the same place two
    // totals on two pages). The governance hub DOES serve район grain, so following the funds
    // key there would send a reader who chose Средец to the whole-city dashboard.
    state.anchorId = "S2410";
    state.area = asMunicipality("S2410", "Средец");
    state.muni = { data: muni(), isError: false, isPending: false };
    const { container } = draw(<MyMunicipalityTile />);
    // The FIGURE comes from the city key…
    expect(state.lastKey).toBe("S22");
    // …and the LINK keeps the район. Asserting only the link left the fold untested.
    const hrefs = [...container.querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toContain("/governance/S2410");
    expect(hrefs).not.toContain("/governance/S22");
  });

  it("renders the pick-a-place invitation for an anchor the route cannot serve", () => {
    // Пловдив/Варна район ids are synthesized by the resolver and have no funds key at all. The
    // route's regex rejects them, so sending one produced a 400, a retry and a permanent error
    // card on a page that simply has no figure to show.
    state.anchorId = "PDV22-01";
    state.area = asMunicipality("PDV22-01", "Централен");
    state.muni = { data: null, isError: false, isPending: false };
    draw(<MyMunicipalityTile />);
    expect(screen.getByText(/Изберете населено място/)).toBeTruthy();
    // Nothing is sent at all — the 400/retry/error-card chain starts with the request.
    expect(state.lastKey).toBeNull();
  });

  it("links to routes that exist", () => {
    // The band IS navigation, so a 404 is its whole failure. `/funds/place/:code` does not
    // exist; `/governance/:id` and `/funds/calls` do.
    state.anchorId = "BLG52";
    state.area = asMunicipality("BLG52", "Петрич");
    state.muni = { data: muni(), isError: false, isPending: false };
    const { container } = draw(<MyMunicipalityTile />);
    const hrefs = [...container.querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toContain("/governance/BLG52");
    expect(hrefs).toContain("/funds/calls");
    expect(hrefs.some((h) => h?.startsWith("/funds/place/"))).toBe(false);
  });
});

describe("MySectorTile", () => {
  const programmes = [
    { programCode: "BG16RFPR001", programName: "Конкурентоспособност" },
    { programCode: "BG05SFPR001", programName: "Образование" },
    { programCode: "BG14MFPR001", programName: "Морско дело" },
    { programCode: "BG16FFPR002", programName: "Околна среда" },
    { programCode: "BG06RDNP001", programName: "Развитие на селските райони" },
    {
      programCode: "BG05SFPR002",
      programName: "Развитие на човешките ресурси",
    },
  ];

  it("lists programmes as LINKS, capped so it stays an entry point", () => {
    // Band 3 already ranks programmes. Repeating the full leaderboard here would make this band
    // read as offcuts of the one above it.
    state.programmes = {
      data: { byProgram: programmes },
      isError: false,
      isPending: false,
    };
    const { container } = draw(<MySectorTile />);
    const links = [
      ...container.querySelectorAll('a[href^="/funds/programme/"]'),
    ];
    expect(links).toHaveLength(5);
    expect(links[0].getAttribute("href")).toBe("/funds/programme/BG16RFPR001");
  });

  it("shows no MONEY — this is a jump-off, not a fourth ranking", () => {
    state.programmes = {
      data: { byProgram: programmes },
      isError: false,
      isPending: false,
    };
    const { container } = draw(<MySectorTile />);
    expect(container.textContent).not.toMatch(/€/);
  });

  it("degrades to a stated failure rather than an empty card", () => {
    state.programmes = { data: null, isError: true, isPending: false };
    draw(<MySectorTile />);
    expect(screen.getByText(/не се заредиха/)).toBeTruthy();
  });

  it("distinguishes an EMPTY corpus from a failed fetch", () => {
    // These were one branch and one sentence („could not load"), which was a falsehood in the
    // empty case and — because the same branch caught `isPending` — on every cold render.
    state.programmes = {
      data: { byProgram: [] },
      isError: false,
      isPending: false,
    };
    draw(<MySectorTile />);
    expect(screen.getByText(/Няма програми/)).toBeTruthy();
    expect(screen.queryByText(/не се заредиха/)).toBeNull();
  });

  it("says it is LOADING while the fetch is in flight", () => {
    state.programmes = { data: null, isError: false, isPending: true };
    draw(<MySectorTile />);
    expect(screen.getByText(/Зарежда се/)).toBeTruthy();
    expect(screen.queryByText(/не се заредиха/)).toBeNull();
  });
});
