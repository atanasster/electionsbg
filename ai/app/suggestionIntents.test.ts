import { describe, expect, it } from "vitest";
import { SUGGESTIONS } from "./suggestions";
import { toChatQuestionIntent } from "./questionAdapter";
import { route } from "../orchestrator/router";

describe("clickable question intents", () => {
  for (const suggestion of SUGGESTIONS) {
    it(`resolves ${suggestion.bg} in both languages`, () => {
      const bg = toChatQuestionIntent(
        suggestion.questionId,
        "bg",
        suggestion.parameters,
      );
      const en = toChatQuestionIntent(
        suggestion.questionId,
        "en",
        suggestion.parameters,
      );
      expect(bg.tool).toBe(en.tool);
      if (suggestion.parameters)
        for (const [key, value] of Object.entries(suggestion.parameters)) {
          expect(bg.args[key]).toEqual(value);
          expect(en.args[key]).toEqual(value);
        }
    });
  }
});

it.each([
  [
    "What public contracts does Metropolitan win?",
    "contractSearch",
    { company: "What public contracts does Metropolitan win?" },
  ],
  [
    "What public contracts does Metro win?",
    "contractSearch",
    { company: "121644736" },
  ],
  [
    "Какви обществени поръчки печели Метро?",
    "contractSearch",
    { company: "121644736" },
  ],
  [
    "ГЕРБ-СДС by municipality in Plovdiv",
    "municipalityBreakdown",
    { party: "герб-сдс", oblast: "PDV" },
  ],
  [
    "How has ГЕРБ-СДС done over the years?",
    "partyTimeline",
    { party: "герб-сдс" },
  ],
  [
    "Were there irregularities in the latest election?",
    "electionAnomalies",
    {},
  ],
  ["Who wins the diaspora vote over recent years?", "diasporaVoteTrend", {}],
  ["Are the cohesion funds absorbed?", "cohesionAbsorption", {}],
  ["EU funds by oblast", "regionalInvestment", {}],
  ["Европейски средства по области", "regionalInvestment", {}],
  [
    "GDP per capita by oblast",
    "rankPlaces",
    { indicator: "gdp per capita by oblast", n: 20 },
  ],
  [
    "БВП на човек по области",
    "rankPlaces",
    { indicator: "gdp per capita by oblast", n: 20 },
  ],
])("preserves the meaning of %s", (text, tool, args) => {
  expect(route(text as string, { lang: "en", election: "2026_04_19" })).toEqual(
    { tool, args },
  );
});
