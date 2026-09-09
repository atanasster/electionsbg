import { beforeAll, describe, expect, it } from "vitest";
import { clearDataCache, setFetcher } from "./dataClient";
import { mpLoyalty, voteSearch } from "./parliament";
import type { ToolContext } from "./types";

const ctx = { lang: "en", election: "2024_10_27" } as ToolContext;

beforeAll(() => {
  clearDataCache();
  setFetcher(async (path) => {
    if (path === "/parliament/votes/index.json")
      return {
        ns: "52",
        mpProfileByNs: {
          "51": { mpNames: { "1": "ИВАН ИВАНОВ" } },
          "52": { mpNames: { "2": "ПЕТЪР ПЕТРОВ" } },
        },
      };
    if (path === "/parliament/votes/derived/loyalty.json")
      return {
        byNs: {
          "51": {
            entries: [
              { mpId: 1, partyShort: "X", votesCast: 10, loyaltyPct: 0.9 },
            ],
          },
          "52": {
            entries: [
              { mpId: 2, partyShort: "Y", votesCast: 20, loyaltyPct: 0.8 },
            ],
          },
        },
      };
    if (path === "/parliament/votes/derived/topic_index.json")
      return {
        byNs: {
          "51": {
            entries: [
              {
                date: "2024-01-01",
                title: "Закон за държавния бюджет",
                topic: "budget",
                tally: { yes: 100, no: 50, abstain: 10 },
                outcome: "passed",
                contestScore: 0.4,
              },
            ],
          },
          "52": { entries: [] },
        },
      };
    throw new Error(`unexpected ${path}`);
  });
});

describe("historical parliament scope", () => {
  it("uses the explicitly selected assembly for roll-call aggregates", async () => {
    const answer = await mpLoyalty({ ns: 51 }, ctx);
    expect(answer.facts.ns).toBe("51");
    expect(answer.rows?.[0].mp).toBe("Иван Иванов");
  });

  it("maps a common English topic to the Bulgarian vote index", async () => {
    const answer = await voteSearch(
      { query: "How did parliament vote on the budget?", ns: 51 },
      ctx,
    );
    expect(answer.facts.ns).toBe("51");
    expect(answer.rows?.[0].title).toContain("бюджет");
  });

  it("does not replace an unavailable requested assembly with current data", async () => {
    const answer = await mpLoyalty({ ns: 50 }, ctx);
    expect(answer.rows).toBeUndefined();
    expect(answer.facts.ns).toBe("50");
    expect(answer.title).toContain("50th");
  });
});
