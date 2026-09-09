import { afterEach, describe, expect, it } from "vitest";
import { airQuality } from "./placeData";
import { budgetOverview } from "./fiscal";
import { municipalityBreakdown } from "./electionDepth";
import { clearDataCache, setFetcher } from "./dataClient";
import type { ToolContext } from "./types";

const bg = { lang: "bg", election: "2024_10_27" } as ToolContext;

describe("answer meaning", () => {
  afterEach(() => clearDataCache());

  it("keeps an absent PM10 reading unknown and states the quarterly period", async () => {
    setFetcher(async (path) => {
      if (path === "/air/index.json")
        return {
          snapshotAsOf: "2026-03-31",
          note: "quarterly source",
          pollutants: {
            pm10: { bg: "ФПЧ10", en: "PM10", unit: "µg/m³", euLimit: 50 },
          },
          stations: [
            {
              id: "missing",
              name: "София - тест",
              obshtina: "SOF00",
              latestReadings: { pm25: 12 },
            },
          ],
        };
      throw new Error(`unexpected ${path}`);
    });
    const answer = await airQuality({ place: "София" }, bg);
    expect(answer.rows?.[0].pm10).toBeNull();
    expect(answer.facts.worst_pm10).toBe("няма данни");
    expect(answer.facts.threshold_comparison).toContain("неизвестно");
    expect(answer.facts.observation_period).toBe("2026-03-31");
    expect(answer.title).toContain("тримесечието");
  });

  it("carries the outgoing EU contribution in the budget reconciliation", async () => {
    setFetcher(async (path) => {
      if (path === "/budget/index.json")
        return {
          fiscalYears: [
            {
              fiscalYear: 2025,
              complete: true,
              actual: {
                revenue: { amountEur: 100 },
                expenditure: { amountEur: 80 },
                euContribution: { amountEur: 5 },
                balance: { amountEur: 15 },
              },
            },
          ],
        };
      throw new Error(`unexpected ${path}`);
    });
    const answer = await budgetOverview({}, bg);
    expect(answer.rows?.map((r) => r.metric)).toContain(
      "Принос към бюджета на ЕС",
    );
    expect(answer.facts.eu_contribution).toBeDefined();
    expect(answer.facts.reconciliation).toContain("принос към бюджета на ЕС");
    expect(answer.facts.basis).toBe("изпълнение на държавния бюджет");
  });

  it("describes a municipality breakdown at its actual geographic grain", async () => {
    setFetcher(async (path) => {
      if (path === "/2024_10_27/national_summary.json")
        return { parties: [{ partyNum: 1, nickName: "ГЕРБ" }] };
      if (path === "/2024_10_27/municipalities/by/VAR.json")
        return [
          {
            obshtina: "VAR06",
            results: {
              votes: [
                { partyNum: 1, totalVotes: 60 },
                { partyNum: 2, totalVotes: 40 },
              ],
            },
          },
        ];
      if (path === "/municipalities.json")
        return [
          {
            ekatte: "10135",
            name: "Варна",
            name_en: "Varna",
            obshtina: "VAR06",
            nuts3: "BG331",
            oblast: "VAR",
          },
        ];
      throw new Error(`unexpected ${path}`);
    });
    const answer = await municipalityBreakdown(
      { party: "ГЕРБ", oblast: "Варна" },
      bg,
    );
    expect(answer.facts.geography).toContain("общини в Варна");
    expect(answer.facts.geography).toContain("Чужбина не е част");
  });
});
