// Regression suite: prompt -> expected response, across every tool/dataset.
// Run: npm run ai:test   (npx tsx ai/tests/regression.ts)
//
// Each case asserts two things end to end against the REAL data files:
//   1. the deterministic router maps the prompt to the expected tool
//   2. running that tool returns the expected envelope — golden values where the
//      data is stable (election results, census), structural checks (kind / row
//      counts / fact presence) where it's volatile (assets, polls, latest poll).
// A data refresh or a routing change that breaks an expectation fails loudly.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { route } from "../orchestrator/router";
import { setFetcher } from "../tools/dataClient";
import { runTool } from "../tools/registry";
import type { Envelope, EnvelopeKind, Lang, ToolContext } from "../tools/types";

setFetcher(async (path: string) => {
  const rel = path.startsWith("/") ? path.slice(1) : path;
  return JSON.parse(await readFile(join(process.cwd(), "data", rel), "utf8"));
});

const LATEST = "2026_04_19";

type FactExp = string | RegExp | { num: number };
type Case = {
  q: string;
  lang?: Lang;
  election?: string;
  tool: string | null; // null => router should decline (no tool)
  kind?: EnvelopeKind;
  minRows?: number;
  facts?: Record<string, FactExp>;
};

// stripped-digits compare so "51 881" / "51 881" / 51 all equal 51881
const digits = (v: unknown): string => String(v).replace(/[^\d]/g, "");
const norm = (v: unknown): string => String(v).replace(/[\s ]/g, "");

const matchFact = (actual: unknown, exp: FactExp): boolean => {
  if (exp instanceof RegExp) return exp.test(String(actual));
  if (typeof exp === "object") return digits(actual) === String(exp.num);
  return norm(actual).toLowerCase().includes(norm(exp).toLowerCase());
};

const CASES: Case[] = [
  // ---- parliamentary elections ----------------------------------------------
  {
    q: "Какъв е процентът машинно гласуване в последните 7 избора?",
    tool: "machineVoteSeries",
    kind: "series",
    facts: { elections_count: { num: 7 } },
  },
  {
    q: "machine voting in the last 7 elections",
    lang: "en",
    tool: "machineVoteSeries",
    facts: { elections_count: { num: 7 } },
  },
  {
    q: "Как се променя избирателната активност през годините?",
    tool: "turnoutSeries",
    kind: "series",
  },
  {
    q: "Какви са резултатите от последните избори?",
    tool: "nationalResults",
    kind: "table",
    minRows: 5,
  },
  {
    q: "Колко гласа взе ГЕРБ?",
    tool: "partyResult",
    kind: "scalar",
    facts: { party: "ГЕРБ", pct: /\d/ },
  },
  {
    q: "Как се представя ГЕРБ през годините?",
    tool: "partyTimeline",
    kind: "series",
    facts: { appearances: { num: 12 } },
  },
  {
    // a person name -> candidate preferential results, NOT national results
    q: "резултатите за Божидар Божанов",
    tool: "candidateResult",
    facts: { name: "Божанов" },
  },
  {
    q: "Какъв беше делът на машинното гласуване през 2023?",
    tool: "machineVoteShare",
    facts: { machine_share: /58/ },
  },
  {
    q: "Каква беше активността през 2023?",
    tool: "turnout",
    facts: { turnout: /\d/ },
  },
  {
    q: "Сравни изборите от 2022 и 2024",
    tool: "compareElections",
    kind: "table",
    minRows: 4,
  },
  {
    // bare compare, no explicit year -> default to the two most recent elections
    q: "сравни изборите последните 5 години",
    tool: "compareElections",
    kind: "table",
    minRows: 4,
  },
  {
    // compare phrasing but a party is named -> party-over-time, not compareElections
    q: "сравни изборите последните 5 години за ГЕРБ",
    tool: "partyTimeline",
    kind: "series",
  },
  {
    q: "Къде е силна ГЕРБ?",
    tool: "regionBreakdown",
    kind: "table",
    facts: { strongest: "Ловеч" },
  },
  {
    q: "Имаше ли нередности на последните избори?",
    tool: "electionAnomalies",
    facts: { problem_sections: { num: 138 } },
  },
  {
    q: "Как се променя активността в Хасково?",
    tool: "regionHistory",
    kind: "series",
    facts: { oblast: "Хасково" },
  },
  {
    q: "Къде отидоха гласовете на последните избори?",
    tool: "voteTransitions",
    kind: "table",
    minRows: 1,
  },
  // ---- polls -----------------------------------------------------------------
  {
    q: "Коя социологическа агенция е най-точна?",
    tool: "pollAccuracy",
    kind: "table",
    facts: { most_accurate: "Алфа", best_grade: "A+" },
  },
  {
    q: "Колко е точна Алфа Рисърч?",
    tool: "agencyProfile",
    kind: "scalar",
    facts: { grade: "A+" },
  },
  {
    q: "Какво показват последните проучвания?",
    tool: "latestPolls",
    kind: "table",
    facts: { leader: /%/ },
  },
  { q: "Какво би станало ако изборите бяха сега?", tool: "latestPolls" },
  // ---- local elections -------------------------------------------------------
  {
    q: "Кой спечели общинските съвети?",
    tool: "localCouncilVoteShare",
    kind: "table",
    facts: { leader: "ГЕРБ" },
  },
  {
    q: "Колко кмета спечели ГЕРБ на местните избори?",
    tool: "localMayorsWon",
    facts: { leader: "ГЕРБ" },
  },
  {
    q: "Кой е кметът на Пловдив?",
    tool: "localMunicipality",
    kind: "scalar",
    facts: { mayor: "Костадин" },
  },
  {
    q: "Кои бяха кандидатите за кмет на Варна?",
    tool: "localMayorRace",
    kind: "table",
    facts: { winner: "Коцев" },
  },
  {
    q: "Какъв е общинският съвет на Бургас?",
    tool: "localCouncil",
    kind: "table",
    facts: { total_seats: { num: 51 } },
  },
  {
    q: "Има ли частични местни избори?",
    tool: "chmiEvents",
    kind: "table",
    facts: { total: { num: 379 } },
  },
  // ---- fiscal ----------------------------------------------------------------
  {
    q: "Какъв е държавният бюджет?",
    tool: "budgetOverview",
    kind: "table",
    minRows: 4,
  },
  {
    q: "За какво се харчи бюджетът?",
    tool: "budgetByFunction",
    kind: "table",
    minRows: 5,
  },
  {
    q: "Покажи изпълнението на бюджета по месеци",
    tool: "budgetExecution",
    kind: "series",
  },
  {
    q: "Какъв е бюджетът на Министерството на транспорта?",
    tool: "ministryBudget",
    facts: { ministry: "транспорт" },
  },
  {
    q: "Кои са най-големите инвестиционни проекти?",
    tool: "investmentProjects",
    kind: "table",
    facts: { project_count: { num: 3065 } },
  },
  {
    q: "Колко са обществените поръчки?",
    tool: "procurementTotals",
    facts: { contracts: /\d/ },
  },
  {
    q: "Колко обществени поръчки има в Русе?",
    tool: "procurementBySettlement",
    facts: { total: /€/ },
  },
  {
    q: "Кой получава най-много европейски средства?",
    tool: "fundsOverview",
    kind: "table",
    minRows: 5,
  },
  {
    q: "Какви са последните емисии на държавен дълг?",
    tool: "govDebt",
    kind: "table",
    minRows: 1,
    facts: { total_recent: /€/ },
  },
  {
    q: "Колко харчи НОИ за пенсии?",
    tool: "noiFunds",
    facts: { year: /20\d\d/ },
  },
  // ---- budget slices: a specific function/category, not the whole budget ------
  {
    // pensions phrased "в бюджета" must NOT return the whole-budget overview
    q: "какъв е процентът на пенсиите в бюджета?",
    tool: "noiFunds",
    facts: { year: /20\d\d/ },
  },
  {
    q: "колко пари отиват за здравеопазване?",
    tool: "budgetFunction",
    kind: "series",
    facts: { function: "Здраве", share_of_budget: /%/ },
  },
  {
    q: "разходи за отбрана",
    tool: "budgetFunction",
    kind: "series",
    facts: { function: "Отбрана", share_of_budget: /%/ },
  },
  {
    q: "колко за образование?",
    tool: "budgetFunction",
    kind: "series",
    facts: { function: "Образование" },
  },
  {
    q: "разходи за социална защита",
    tool: "budgetFunction",
    kind: "series",
    facts: { function: "Социална" },
  },
  {
    q: "defence spending",
    lang: "en",
    tool: "budgetFunction",
    kind: "series",
    facts: { function: "Defence" },
  },
  // whole-budget questions still hit the overview / functional table
  {
    q: "какъв е държавният бюджет?",
    tool: "budgetOverview",
    kind: "table",
    minRows: 4,
  },
  // ---- people ----------------------------------------------------------------
  {
    q: "Кои са правителствата от 2005?",
    tool: "governments",
    kind: "table",
    minRows: 5,
  },
  {
    q: "Кои депутати са най-богати?",
    tool: "mpAssetsTop",
    kind: "table",
    facts: { richest: "Пеевски" },
  },
  {
    q: "Кои депутати имат най-много фирмени връзки?",
    tool: "mpConnectionsTop",
    facts: { most_connected: "Михайлов" },
  },
  {
    q: "Кои министри са най-богати?",
    tool: "officialsAssetsTop",
    kind: "table",
    minRows: 1,
  },
  {
    q: "Партиите подават ли финансови отчети навреме?",
    tool: "financingOverview",
    facts: { distinct_parties: { num: 236 } },
  },
  // ---- indicators ------------------------------------------------------------
  {
    q: "Каква е инфлацията?",
    tool: "macroIndicator",
    kind: "series",
    facts: { indicator: "нфлация" },
  },
  { q: "Как е икономиката?", tool: "macroOverview", kind: "table", minRows: 3 },
  {
    q: "Покажи показателите за управление",
    tool: "macroByCategory",
    kind: "table",
    minRows: 3,
  },
  {
    q: "Каква е безработицата в Сливен?",
    tool: "subnationalIndicator",
    kind: "series",
    facts: { place: "Сливен" },
  },
  {
    q: "Какъв е БВП на човек във Варна?",
    tool: "regionIndicator",
    kind: "series",
    facts: { oblast: "Варна" },
  },
  {
    q: "Колко прозрачна е община Русе?",
    tool: "transparencyScore",
    facts: { composite: /\d/ },
  },
  {
    q: "Какви са данъците в Пловдив?",
    tool: "localTaxes",
    kind: "table",
    minRows: 1,
    facts: { place: "Пловдив" },
  },
  // ---- place ("my area") -----------------------------------------------------
  {
    q: "Разкажи ми за Габрово",
    tool: "governanceProfile",
    kind: "scalar",
    facts: { population: { num: 51881 } },
  },
  {
    q: "Колко жители има Видин?",
    tool: "census",
    facts: { population: { num: 47847 } },
  },
  {
    q: "Какво е регистрираното население на Габрово?",
    tool: "graoPopulation",
    facts: { permanent: { num: 57970 } },
  },
  {
    q: "Какъв е въздухът в Перник?",
    tool: "airQuality",
    kind: "table",
    minRows: 1,
  },
  {
    q: "Какво реши общинският съвет на Русе?",
    tool: "councilResolutions",
    kind: "table",
    minRows: 1,
  },
  {
    q: "Колко гора има в България?",
    tool: "landUse",
    kind: "table",
    minRows: 5,
  },
  // ---- routing robustness: phrasings that previously mis-routed (esp. under a
  //      weak model) — compare/results must never become machine-voting --------
  {
    q: "сравни последните избори",
    tool: "compareElections",
    kind: "table",
    minRows: 4,
  },
  {
    q: "сравни изборите през последните години",
    tool: "compareElections",
    kind: "table",
    minRows: 4,
  },
  {
    q: "compare the last elections",
    lang: "en",
    tool: "compareElections",
    kind: "table",
    minRows: 4,
  },
  {
    q: "сравни 2021 и 2023",
    tool: "compareElections",
    kind: "table",
    minRows: 4,
  },
  // general "results / what happened / overview" -> nationalResults, never machine
  {
    q: "какво стана на изборите",
    tool: "nationalResults",
    kind: "table",
    minRows: 5,
  },
  {
    q: "обобщи последните избори",
    tool: "nationalResults",
    kind: "table",
    minRows: 5,
  },
  {
    q: "покажи резултатите",
    tool: "nationalResults",
    kind: "table",
    minRows: 5,
  },
  {
    q: "election results",
    lang: "en",
    tool: "nationalResults",
    kind: "table",
    minRows: 5,
  },
  {
    q: "election overview",
    lang: "en",
    tool: "nationalResults",
    kind: "table",
    minRows: 5,
  },
  {
    q: "who won the latest election",
    lang: "en",
    tool: "nationalResults",
    kind: "table",
    minRows: 5,
  },
  // election-topic catch-all -> sensible default (results), not a decline
  {
    q: "изборите ме интересуват",
    tool: "nationalResults",
    kind: "table",
    minRows: 5,
  },
  // machine voting ONLY when explicitly asked
  {
    q: "машинно гласуване 2023",
    tool: "machineVoteShare",
    facts: { machine_share: /\d/ },
  },
  {
    q: "машинно гласуване през годините",
    tool: "machineVoteSeries",
    kind: "series",
  },
  {
    q: "machine voting over time",
    lang: "en",
    tool: "machineVoteSeries",
    kind: "series",
  },
  // turnout disambiguation
  {
    q: "turnout in 2021",
    lang: "en",
    tool: "turnout",
    facts: { turnout: /\d/ },
  },
  { q: "избирателна активност", tool: "turnoutSeries", kind: "series" },
  // party phrasings
  {
    q: "колко гласа взе БСП",
    tool: "partyResult",
    kind: "scalar",
    facts: { party: "БСП" },
  },
  {
    q: "как се представя ДПС през годините",
    tool: "partyTimeline",
    kind: "series",
  },
  // ---- negative --------------------------------------------------------------
  { q: "времето е хубаво днес", tool: null },
  { q: "разкажи ми виц", tool: null },
];

let failures = 0;
const fail = (q: string, msg: string) => {
  failures += 1;
  console.error(`  ✗ "${q}"\n      ${msg}`);
};

const run = async () => {
  for (const c of CASES) {
    const ctx: ToolContext = {
      lang: c.lang ?? "bg",
      election: c.election ?? LATEST,
    };
    const r = route(c.q, ctx);
    const got = r?.tool ?? null;
    if (got !== c.tool) {
      fail(c.q, `routed to ${got ?? "(none)"}, expected ${c.tool ?? "(none)"}`);
      continue;
    }
    if (c.tool === null) continue; // negative case routed correctly
    let env: Envelope;
    try {
      env = (await runTool(r!.tool, r!.args, ctx)) as Envelope;
    } catch (e) {
      fail(c.q, `tool threw: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (c.kind && env.kind !== c.kind) {
      fail(c.q, `kind ${env.kind}, expected ${c.kind}`);
      continue;
    }
    if (c.minRows != null) {
      const n = env.rows?.length ?? env.series?.[0]?.points.length ?? 0;
      if (n < c.minRows) {
        fail(c.q, `${n} rows/points, expected >= ${c.minRows}`);
        continue;
      }
    }
    for (const [k, exp] of Object.entries(c.facts ?? {})) {
      if (!(k in env.facts) || !matchFact(env.facts[k], exp)) {
        fail(
          c.q,
          `fact "${k}"=${JSON.stringify(env.facts[k])} did not match ${exp}`,
        );
      }
    }
  }

  const passed = CASES.length - failures;
  console.log(
    `\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — ${passed}/${CASES.length} regression cases`,
  );
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
