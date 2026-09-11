import {
  setFetcher,
  setDbFetcher,
  clearDataCache,
} from "../../tools/dataClient";
import type { Envelope } from "../../tools/types";
// Invented numerical inputs; geographic names/codes only identify scope.
export const FIXTURE_INPUTS = {
  municipalities: [
    {
      obshtina: "PDV22",
      name: "Пловдив",
      name_en: "Plovdiv",
      oblast: "PDV-00",
      nuts3: "BG421",
      ekatte: "56784",
    },
    {
      obshtina: "VAR06",
      name: "Варна",
      name_en: "Varna",
      oblast: "VAR",
      nuts3: "BG331",
      ekatte: "10135",
    },
  ],
  city: { votes: [180, 120], registered: 1000, voters: 320 },
  province: { votes: [720, 480], registered: 4000, voters: 1600 },
  varna: { votes: [90, 110], registered: 500, voters: 210 },
  national: { votes: [6000, 4000] },
  transfers: {
    2021: [56000, 14000],
    2022: [60000, 15000],
    2024: [76000, 19000],
  },
  taxes: { plovdiv: 2.6, varna: 1.8, average: 2.2 },
};
const vote = (v: { votes: number[]; registered: number; voters: number }) => ({
  votes: v.votes.map((totalVotes, i) => ({ partyNum: i + 1, totalVotes })),
  protocol: { numRegisteredVoters: v.registered, totalActualVoters: v.voters },
});
export function installFixtures(): string[] {
  const requests: string[] = [];
  clearDataCache();
  setFetcher(async (path) => {
    requests.push(path);
    if (path === "/municipalities.json") return FIXTURE_INPUTS.municipalities;
    if (path.endsWith("/national_summary.json"))
      return {
        parties: [
          {
            partyNum: 1,
            nickName: "Партия А",
            totalVotes: 6000,
            pct: 60,
            seats: 144,
            passedThreshold: true,
          },
          {
            partyNum: 2,
            nickName: "Партия Б",
            totalVotes: 4000,
            pct: 40,
            seats: 96,
            passedThreshold: true,
          },
        ],
      };
    if (path.endsWith("/region_votes.json"))
      return [
        { key: "PDV", results: vote(FIXTURE_INPUTS.province) },
        { key: "PDV-00", results: vote(FIXTURE_INPUTS.city) },
        { key: "VAR", results: vote(FIXTURE_INPUTS.varna) },
      ];
    if (path.includes("/municipalities/by/"))
      return [
        { obshtina: "PDV22", results: vote(FIXTURE_INPUTS.city) },
        { obshtina: "VAR06", results: vote(FIXTURE_INPUTS.varna) },
      ];
    if (path === "/budget/municipal_transfers/index.json")
      return {
        years: Object.entries(FIXTURE_INPUTS.transfers).map(([year, v]) => ({
          fiscalYear: Number(year),
          grandTotalEur: v[0] + v[1],
          municipalityCount: 2,
        })),
      };
    const transfer = path.match(
      /^\/budget\/municipal_transfers\/(2021|2022|2024)\/totals.json$/,
    );
    if (transfer) {
      const year = Number(transfer[1]) as keyof typeof FIXTURE_INPUTS.transfers;
      const amounts = FIXTURE_INPUTS.transfers[year];
      return {
        fiscalYear: year,
        totals: {
          delegated: { amountEur: amounts[0] },
          equalization: { amountEur: amounts[1] },
        },
      };
    }
    if (path === "/local_taxes/index.json")
      return {
        indicators: [
          {
            key: "property",
            label: { bg: "Имотен данък", en: "Property tax" },
            unit: "%",
          },
        ],
        nationalAverages: { property: 2.2 },
      };
    if (
      path === "/local_taxes/PDV22.json" ||
      path === "/local_taxes/VAR06.json"
    )
      return {
        ipi: {
          property: {
            latestValue: path.includes("PDV22") ? 2.6 : 1.8,
            nationalRank: 1,
          },
        },
      };
    throw new Error(`No fictional fixture for ${path}`);
  });
  setDbFetcher(async (route, params) => {
    requests.push(`${route}?${JSON.stringify(params)}`);
    if (route !== "budget-municipal")
      throw new Error(`No fictional DB fixture for ${route}`);
    const fy = Number(params.fy);
    if (![2021, 2022, 2024].includes(fy))
      throw new Error("Unfrozen fiscal year");
    const sum = fy === 2024 ? 95000 : fy === 2022 ? 75000 : 70000;
    return {
      fiscalYear: fy,
      rows: [
        {
          nameBg: "Примерна община А",
          nameEn: "Example municipality A",
          totalEur: sum - 7000,
        },
        {
          nameBg: "Примерна община Б",
          nameEn: "Example municipality B",
          totalEur: 7000,
        },
      ],
    };
  });
  return requests;
}
// Independent expected quantities, not snapshots of tool-generated answers.
export function verifyFixtureAnswer(env: Envelope, tool: string): void {
  if (env.tool !== tool || env.clarify)
    throw new Error("Unexpected fixture tool or clarification");
  if (tool === "municipalityResults" || tool === "regionResults") {
    const province = tool === "regionResults";
    const varna =
      JSON.stringify(env.facts).includes("Varna") ||
      JSON.stringify(env.facts).includes("Варна");
    const count = province ? 1200 : varna ? 200 : 300;
    if (
      env.kind === "table" &&
      env.rows?.reduce((n, r) => n + Number(r.votes), 0) !== count
    )
      throw new Error("Wrong fixture vote total");
    if (
      env.kind === "scalar" &&
      !String(env.facts.turnout).includes(province ? "40" : varna ? "42" : "32")
    )
      throw new Error("Wrong fixture turnout");
  }
  if (
    tool === "nationalResults" &&
    env.rows?.reduce((n, r) => n + Number(r.votes), 0) !== 10000
  )
    throw new Error("Wrong national fixture total");
  if (
    ["municipalTransfers", "budgetMunicipalTransfers"].includes(tool) &&
    env.rows?.length !== 2
  )
    throw new Error("Missing transfer breakdown");
  if (
    tool === "localTaxes" &&
    (env.rows?.length !== 1 || env.rows[0].avg !== "2.2 %")
  )
    throw new Error("Wrong tax comparison");
}
