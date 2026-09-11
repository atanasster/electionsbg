import type { ReleaseCase } from "./cases";
// New targeted probes authored after the 7/8 confirmation result. Freeze these
// before their calls; they are not a replacement for the original holdout.
export const FOLLOWUP_CASES: ReleaseCase[] = [
  {
    id: "followup-city-2024",
    group: "conversation",
    split: "confirmation",
    bg: "А същото за община Варна?",
    en: "And the same in Varna municipality?",
    tool: "municipalityResults",
    args: { place: ["Варна", "Varna"], election: ["2024_10_27"] },
    prev: {
      tool: "regionResults",
      args: { oblast: "PDV", election: "2024_10_27" },
    },
    rubric:
      "Explicit municipality overrides previous province; retain the election, use Varna fixture votes and correct turnout denominator; fluent labels and no invented quantities.",
  },
  {
    id: "followup-province-2024",
    group: "conversation",
    split: "confirmation",
    bg: "А същото за област Пловдив?",
    en: "And the same in the province of Plovdiv?",
    tool: "regionResults",
    args: { oblast: ["PDV", "Пловдив", "Plovdiv"], election: ["2024_10_27"] },
    prev: {
      tool: "municipalityResults",
      args: { place: "Варна", election: "2024_10_27" },
    },
    rubric:
      "Explicit province overrides previous city; retain the election, use province fixture votes and correct turnout denominator; fluent labels and no invented quantities.",
  },
];
