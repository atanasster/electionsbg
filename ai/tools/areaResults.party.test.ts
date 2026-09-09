import { beforeAll, describe, expect, it, vi } from "vitest";
import { setFetcher } from "./dataClient";
import { municipalityResults, regionResults } from "./areaResults";
vi.mock("./place", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./place")>()),
  resolveMunicipality: async () => ({
    obshtina: "PDV22",
    oblast: "PDV",
    name: "Пловдив",
    nameEn: "Plovdiv",
    oblastName: { bg: "Пловдив", en: "Plovdiv" },
  }),
}));
const votes = [
  { partyNum: 1, totalVotes: 75 },
  { partyNum: 2, totalVotes: 25 },
  { partyNum: 3, totalVotes: 0 },
];
const parties = [
  { partyNum: 1, nickName: "БСП" },
  { partyNum: 2, nickName: "ГЕРБ-СДС" },
  { partyNum: 3, nickName: "ИТН" },
];
beforeAll(() =>
  setFetcher(async (path) => {
    if (path.endsWith("national_summary.json")) return { parties };
    if (path.endsWith("region_votes.json"))
      return [
        {
          key: "PDV",
          results: {
            votes,
            protocol: { numRegisteredVoters: 200, totalActualVoters: 100 },
          },
        },
      ];
    if (path.includes("municipalities/by/"))
      return [
        {
          obshtina: "PDV22",
          results: {
            votes,
            protocol: { numRegisteredVoters: 200, totalActualVoters: 100 },
          },
        },
      ];
    throw new Error(`Unexpected fixture request ${path}`);
  }),
);
describe("party-scoped area results", () => {
  it.each([municipalityResults, regionResults])(
    "uses local votes and the full local denominator",
    async (run) => {
      const env = await run(
        { party: "GERB", place: "Пловдив", oblast: "Пловдив" },
        { lang: "en", election: "2024_10_27" },
      );
      expect(env.facts).toMatchObject({
        party: "ГЕРБ-СДС",
        votes: "25",
        pct: "25%",
        total_votes: "100",
      });
      expect(env.facts).not.toHaveProperty("leading_party");
      expect(env.facts).not.toHaveProperty("seats");
    },
  );
  it("computes local turnout using registered voters", async () => {
    const env = await municipalityResults(
      { metric: "turnout", place: "Пловдив" },
      { lang: "en", election: "2024_10_27" },
    );
    expect(env.facts).toMatchObject({
      turnout: "50%",
      registered: "200",
      voters: "100",
    });
    expect(env.facts).not.toHaveProperty("party");
  });
  it("keeps zero votes as zero", async () => {
    const env = await regionResults(
      { party: "ИТН", oblast: "Пловдив" },
      { lang: "en", election: "2024_10_27" },
    );
    expect(env.facts.votes).toBe("0");
  });
  it("does not replace a missing party with all parties", async () => {
    const env = await regionResults(
      { party: "unknown-unlisted-party", oblast: "Пловдив" },
      { lang: "en", election: "2024_10_27" },
    );
    expect(env.title).toContain("No party matched");
    expect(env.facts).not.toHaveProperty("votes");
  });
  it("keeps the existing unfiltered table", async () => {
    const env = await regionResults(
      { oblast: "Пловдив" },
      { lang: "en", election: "2024_10_27" },
    );
    expect(env.rows).toHaveLength(2);
    expect(env.facts.leading_party).toBe("БСП");
  });
});
