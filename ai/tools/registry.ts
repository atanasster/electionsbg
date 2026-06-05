// The tool registry: the single surface the orchestrator (and the dropdown
// harness) sees. The grammar-constrained LLM picks a tool name + args from here.

import { compareElections, machineVoteShare, turnout } from "./metrics";
import { nationalResults, partyResult } from "./national";
import { partyTimeline } from "./parties";
import { machineVoteSeries, turnoutSeries } from "./series";
import type { ToolArgs, ToolContext, ToolDef } from "./types";

export const TOOLS: ToolDef[] = [
  {
    name: "nationalResults",
    description: {
      bg: "Национални резултати за един избор: гласове, %, мандати по партия.",
      en: "National results for one election: votes, %, seats per party.",
    },
    params: [
      {
        name: "election",
        type: "election",
        description: {
          bg: "Дата на избора (по подразбиране последния).",
          en: "Election date (defaults to the latest).",
        },
      },
    ],
    examples: [
      {
        bg: "Какви са резултатите от последните избори?",
        en: "What were the results of the latest election?",
      },
      { bg: "Покажи резултатите от 2022", en: "Show the 2022 results" },
    ],
    run: nationalResults,
  },
  {
    name: "partyResult",
    description: {
      bg: "Резултатът на една партия за един избор.",
      en: "One party's result in one election.",
    },
    params: [
      {
        name: "party",
        type: "party",
        required: true,
        description: { bg: "Партия", en: "Party" },
      },
      {
        name: "election",
        type: "election",
        description: { bg: "Дата на избора", en: "Election date" },
      },
    ],
    examples: [
      { bg: "Колко гласа взе ГЕРБ?", en: "How many votes did GERB get?" },
      {
        bg: "Какъв е резултатът на ПП-ДБ на последните избори?",
        en: "What was PP-DB's result in the latest election?",
      },
    ],
    run: partyResult,
  },
  {
    name: "machineVoteShare",
    description: {
      bg: "Дял на машинното гласуване за един избор.",
      en: "Machine-voting share for one election.",
    },
    params: [
      {
        name: "election",
        type: "election",
        description: { bg: "Дата на избора", en: "Election date" },
      },
    ],
    examples: [
      {
        bg: "Какъв беше делът на машинното гласуване през 2023?",
        en: "What was the machine-voting share in 2023?",
      },
    ],
    run: machineVoteShare,
  },
  {
    name: "turnout",
    description: {
      bg: "Избирателна активност за един избор.",
      en: "Voter turnout for one election.",
    },
    params: [
      {
        name: "election",
        type: "election",
        description: { bg: "Дата на избора", en: "Election date" },
      },
    ],
    examples: [
      {
        bg: "Каква беше активността на последните избори?",
        en: "What was the turnout in the latest election?",
      },
    ],
    run: turnout,
  },
  {
    name: "compareElections",
    description: {
      bg: "Сравнение на два избора (активност, машинно гласуване, първа партия).",
      en: "Compare two elections (turnout, machine voting, top party).",
    },
    params: [
      {
        name: "a",
        type: "election",
        required: true,
        description: { bg: "Първи избор", en: "First election" },
      },
      {
        name: "b",
        type: "election",
        description: {
          bg: "Втори избор (по подразбиране последния)",
          en: "Second election (defaults to latest)",
        },
      },
    ],
    examples: [
      {
        bg: "Сравни изборите от 2022 и 2024",
        en: "Compare the 2022 and 2024 elections",
      },
    ],
    run: compareElections,
  },
  {
    name: "machineVoteSeries",
    description: {
      bg: "Дял на машинното гласуване през последните N избора (тренд).",
      en: "Machine-voting share across the last N elections (trend).",
    },
    params: [
      {
        name: "n",
        type: "count",
        default: 7,
        description: { bg: "Брой избори", en: "Number of elections" },
      },
    ],
    examples: [
      {
        bg: "Какъв е процентът машинно гласуване в последните 7 избора?",
        en: "What's the machine-voting % in the last 7 elections?",
      },
      { bg: "Тренд на машинния вот", en: "Machine vote trend" },
    ],
    run: machineVoteSeries,
  },
  {
    name: "turnoutSeries",
    description: {
      bg: "Избирателна активност през последните N избора (тренд).",
      en: "Voter turnout across the last N elections (trend).",
    },
    params: [
      {
        name: "n",
        type: "count",
        default: 7,
        description: { bg: "Брой избори", en: "Number of elections" },
      },
    ],
    examples: [
      {
        bg: "Как се променя активността през годините?",
        en: "How has turnout changed over the years?",
      },
    ],
    run: turnoutSeries,
  },
  {
    name: "partyTimeline",
    description: {
      bg: "Дял на една партия през всички избори (с проследяване на преименувания).",
      en: "One party's vote share across all elections (lineage-aware).",
    },
    params: [
      {
        name: "party",
        type: "party",
        required: true,
        description: { bg: "Партия", en: "Party" },
      },
    ],
    examples: [
      {
        bg: "Как се представя ГЕРБ през годините?",
        en: "How has GERB performed over the years?",
      },
      { bg: "Покажи историята на БСП", en: "Show BSP's history" },
    ],
    run: partyTimeline,
  },
];

export const TOOLS_BY_NAME: Record<string, ToolDef> = Object.fromEntries(
  TOOLS.map((t) => [t.name, t]),
);

export const runTool = (name: string, args: ToolArgs, ctx: ToolContext) => {
  const tool = TOOLS_BY_NAME[name];
  if (!tool) throw new Error(`unknown tool: ${name}`);
  return tool.run(args, ctx);
};
