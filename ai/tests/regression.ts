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
import { STARTERS } from "../app/starters";
import { SUGGESTIONS } from "../app/suggestions";
import { route } from "../orchestrator/router";
import { siteLinks } from "../render/links";
import { setFetcher } from "../tools/dataClient";
import { runTool } from "../tools/registry";
import type {
  Envelope,
  EnvelopeKind,
  GeoLevel,
  GeoMode,
  Lang,
  ToolContext,
} from "../tools/types";

setFetcher(async (path: string) => {
  const rel = path.startsWith("/") ? path.slice(1) : path;
  return JSON.parse(await readFile(join(process.cwd(), "data", rel), "utf8"));
});

const LATEST = "2026_04_19";
const SITE = "https://electionsbg.com";

type FactExp = string | RegExp | { num: number };
// Expected map overlay on a response. `false` asserts there is NO map. The deep
// "do the area codes join to the geojson" check lives in ai/tools/geo.harness.ts;
// here we lock that the PROMPT routes to a map of the right shape.
type GeoExp = {
  level: GeoLevel;
  mode?: GeoMode;
  joinKey?: "nuts3" | "nuts4" | "ekatte";
  minAreas?: number;
};
type Case = {
  q: string;
  lang?: Lang;
  election?: string;
  tool: string | null; // null => router should decline (no tool)
  kind?: EnvelopeKind;
  minRows?: number;
  facts?: Record<string, FactExp>;
  geo?: GeoExp | false;
  // assert the tool returned an ask-the-user disambiguation chooser (a name
  // matched several entities) with at least this many options.
  clarify?: { minOptions: number };
  // EXACT set of "Виж в сайта" links siteLinks() must emit for this answer,
  // as path portions (origin stripped). Order-independent. Catches a missing
  // deep link, a wrong entity code, AND an extra/duplicate link. Single-entity
  // tools should deep-link to that entity's own page (see ai/render/links.ts);
  // aggregates keep the generic section page.
  links?: string[];
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
    // "7 years" is a DATE window, not 7 elections: it covers since 2019, which
    // holds 8 elections (the 2021-04-04 election the 7-elections slice drops).
    q: "Какъв е процентът машинно гласуване в последните 7 години?",
    tool: "machineVoteSeries",
    kind: "series",
    facts: { window_years: { num: 7 }, elections_count: { num: 8 } },
  },
  {
    q: "turnout over the last 10 years",
    lang: "en",
    tool: "turnoutSeries",
    kind: "series",
    facts: { window_years: { num: 10 } },
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
    // every national-results answer carries a winner-per-oblast map
    geo: {
      level: "oblast",
      mode: "choropleth",
      joinKey: "nuts3",
      minAreas: 25,
    },
  },
  {
    // the "by region" intent (the hero map card) -> per-region winners list
    // (one row per oblast + the leading party) + the winner oblast map
    q: "Покажи резултатите по области.",
    tool: "regionWinners",
    kind: "table",
    minRows: 25,
    facts: { leading_party: /\S/, regions: { num: 32 } },
    geo: {
      level: "oblast",
      mode: "choropleth",
      joinKey: "nuts3",
      minAreas: 25,
    },
  },
  {
    q: "Show the results by region.",
    lang: "en",
    tool: "regionWinners",
    kind: "table",
    minRows: 25,
    geo: { level: "oblast", joinKey: "nuts3", minAreas: 25 },
  },
  {
    // explicit "which party won in each region" -> the same per-region winners
    q: "Коя партия спечели във всяка област?",
    tool: "regionWinners",
    kind: "table",
    minRows: 25,
  },
  {
    // bare multi-election year routed end-to-end -> combined results table
    // (party rows × one column per ballot)
    q: "Какви са резултатите от изборите 2024?",
    tool: "nationalResults",
    kind: "table",
    minRows: 2,
    facts: { year: /2024/, elections_count: { num: 2 } },
  },
  {
    // seats-per-party "in parliament" -> hemicycle (kind table + viz hemicycle),
    // NOT a roll-call or national-results table
    q: "Колко места има всяка партия в парламента?",
    tool: "parliamentSeats",
    kind: "table",
    minRows: 4,
    facts: { total_seats: { num: 240 }, majority: { num: 121 } },
  },
  {
    q: "How many seats does each party hold in parliament?",
    lang: "en",
    tool: "parliamentSeats",
    kind: "table",
    facts: { total_seats: { num: 240 }, parties_seated: { num: 5 } },
  },
  {
    // a trend cue ("последните 5 години") turns the same seats question into a
    // multi-election line chart, NOT the single-election hemicycle. "Last 5
    // years" is a date window covering 7 ballots since 2021-04-19.
    q: "Колко места има всяка партия в парламента последните 5 години?",
    tool: "seatsHistory",
    kind: "series",
    facts: {
      window_years: { num: 5 },
      elections_count: { num: 7 },
      parties_shown: { num: 8 },
    },
  },
  {
    q: "How have seats per party changed over time?",
    lang: "en",
    tool: "seatsHistory",
    kind: "series",
    facts: { parties_shown: { num: 8 } },
  },
  {
    // diaspora trend (abroad МИР 32) — cross-election leader line, NOT the
    // single-election snapshot
    q: "Кой печели гласа в чужбина последните години?",
    tool: "diasporaVoteTrend",
    kind: "series",
    facts: { most_frequent_winner: /\S/ },
  },
  {
    // wasted-votes share over elections — single trend line
    q: "Как се променят прахосаните гласове през годините?",
    tool: "wastedVotesTrend",
    kind: "series",
    facts: { latest: /%/ },
  },
  {
    // council vote share across the 5 local cycles (2007–2023), parties
    // consolidated across the older cycles' local: ids
    q: "Как се променя вотът за общинските съвети през годините?",
    tool: "localCouncilTrend",
    kind: "series",
    facts: { cycles: { num: 5 }, leader: /\S/ },
  },
  {
    q: "How have mayoralties per party changed across cycles?",
    lang: "en",
    tool: "localMayorsTrend",
    kind: "series",
    facts: { cycles: { num: 5 } },
  },
  {
    // state revenue/spending across completed fiscal years
    q: "Как се променя бюджетът през годините?",
    tool: "budgetTrend",
    kind: "series",
    facts: { years: { num: 5 } },
  },
  {
    q: "Колко гласа взе ГЕРБ?",
    tool: "partyResult",
    kind: "scalar",
    facts: { party: "ГЕРБ", pct: /\d/ },
  },
  {
    // EN latin party token must resolve to the Cyrillic record via matchParty's
    // romanization (otherwise "no party matched gerb")
    q: "How many votes did GERB get?",
    lang: "en",
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
    // single candidate -> their own /candidate page (c-{partyNum}-{slug}), not
    // the homepage it used to fall back to
    links: ["/candidate/c-7-bozhidar-plamenov-bozhanov?elections=2026_04_19"],
  },
  // ---- party name mistaken for a candidate (candidateResult -> partyResult) --
  // A party/coalition whose name isn't a hardcoded router token ("Синя
  // България") is two-or-three capitalized words, so the offline router takes it
  // for a person name and routes to the candidate tool. With no such candidate,
  // candidateResult must fall back to that election's party roster instead of
  // dead-ending on "candidate not found". These lock: the fallback fires across
  // phrasings / parties / languages / elections; and — critically — it does NOT
  // over-fire (a genuine non-candidate person name, or a party absent from the
  // selected election, still declines as a candidate rather than being coerced
  // into the wrong party).
  {
    q: "какви са резултатите на Синя България?",
    tool: "candidateResult",
    kind: "scalar",
    facts: { party: "СБ" },
  },
  {
    // a different "results of X" phrasing resolves the same party
    q: "Колко гласа взе Синя България?",
    tool: "candidateResult",
    kind: "scalar",
    facts: { party: "СБ" },
  },
  {
    // EN framing, party kept in Cyrillic — matchParty romanizes both sides
    q: "How many votes did Синя България get?",
    lang: "en",
    tool: "candidateResult",
    kind: "scalar",
    facts: { party: "СБ" },
  },
  {
    // a second, larger party reached only via the fallback (not a router token)
    q: "Колко гласа взе Прогресивна България?",
    tool: "candidateResult",
    kind: "scalar",
    facts: { party: "ПрБ" },
  },
  {
    // a historical party in its own election (not the latest) — the fallback
    // resolves against the SELECTED election's roster
    q: "Колко гласа взе Партия Атака?",
    election: "2009_07_05",
    tool: "candidateResult",
    kind: "scalar",
    facts: { party: "Атака" },
  },
  {
    // NOT a party and NOT a candidate -> must stay a clean candidate "not found"
    // (the `търсене` fact only exists on candidateResult's decline), never
    // coerced into some fuzzily-matched party
    q: "Колко гласа взе Иван Несъществуващ?",
    tool: "candidateResult",
    kind: "scalar",
    facts: { търсене: "Несъществуващ" },
  },
  {
    // election-scoping: "Синя България" didn't run in 2017, so the fallback
    // finds no party and the candidate "not found" stands (no cross-election leak)
    q: "какви са резултатите на Синя България?",
    election: "2017_03_26",
    tool: "candidateResult",
    kind: "scalar",
    facts: { търсене: "Синя" },
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
    // a party's regional strength shades every oblast by its share (ramp)
    geo: {
      level: "oblast",
      mode: "choropleth",
      joinKey: "nuts3",
      minAreas: 25,
    },
  },
  {
    // drill-down: a party by municipality within one oblast → muni ramp map
    q: "ГЕРБ по общини във Варна",
    tool: "municipalityBreakdown",
    kind: "table",
    geo: {
      level: "municipality",
      mode: "choropleth",
      joinKey: "nuts4",
      minAreas: 5,
    },
  },
  {
    // drill-down: a party by settlement within one município → settlement ramp.
    // "в община Варна" must NOT divert to the municipality rule.
    q: "ГЕРБ по населени места в община Варна",
    tool: "settlementBreakdown",
    kind: "table",
    geo: {
      level: "settlement",
      mode: "choropleth",
      joinKey: "ekatte",
      minAreas: 2,
    },
  },
  // ---- party-BLIND drill-down winners (municipality / settlement / section) --
  // Each lists every area at that level + its LEADING party. These are the
  // counterparts to the party-scoped *Breakdown tools above; a party-less
  // "results by <level> in X" used to fall through to nationalResults (or, for
  // the EN word "municipality", got hijacked to the local-elections dashboard).
  // -- municipalityWinners --
  {
    // canonical: winners list + winner muni map. The mixed-winner golden (ДПС
    // leads 4 munis, ГЕРБ-СДС 1) locks that a NON-leading party is surfaced
    // correctly — not just the national winner painted everywhere.
    q: "Покажи резултатите по общини в Благоевград",
    tool: "municipalityWinners",
    kind: "table",
    minRows: 14,
    facts: {
      oblast: "Благоевград",
      leading_party: "ПрБ",
      ДПС: { num: 4 },
      "ГЕРБ-СДС": { num: 1 },
    },
    geo: {
      level: "municipality",
      mode: "choropleth",
      joinKey: "nuts4",
      minAreas: 14,
    },
  },
  {
    // EN: "municipality" must NOT divert to localMunicipality (the 2023 local
    // dashboard) — the bug this whole family fixes.
    q: "show the results by municipality in Blagoevgrad",
    lang: "en",
    tool: "municipalityWinners",
    kind: "table",
    minRows: 14,
    facts: { oblast: "Blagoevgrad" },
    geo: { level: "municipality", mode: "choropleth", joinKey: "nuts4" },
  },
  {
    // "коя партия спечели във всяка община" phrasing, different oblast
    q: "Коя партия спечели във всяка община в Бургас?",
    tool: "municipalityWinners",
    kind: "table",
    minRows: 8,
    facts: { oblast: "Бургас" },
  },
  {
    // EN "won in each municipality" phrasing
    q: "which party won in each municipality of Burgas?",
    lang: "en",
    tool: "municipalityWinners",
    kind: "table",
    facts: { oblast: "Burgas" },
  },
  {
    // "по общини в област Варна" names two levels -> the finer one (municipality),
    // NOT regionWinners (the "област" keyword must not win over "общини")
    q: "резултати по общини в област Варна",
    tool: "municipalityWinners",
    kind: "table",
    facts: { oblast: "Варна" },
  },
  {
    // unknown oblast -> graceful scalar (no crash, no wrong tool)
    q: "резултати по общини в Несъществуевоград",
    tool: "municipalityWinners",
    kind: "scalar",
    geo: false,
  },
  // -- settlementWinners --
  {
    // canonical: winners list + winner settlement map
    q: "Покажи резултатите по населени места в община Самоков",
    tool: "settlementWinners",
    kind: "table",
    minRows: 20,
    facts: { place: "Самоков", leading_party: "ПрБ" },
    geo: {
      level: "settlement",
      mode: "choropleth",
      joinKey: "ekatte",
      minAreas: 20,
    },
  },
  {
    q: "show the results by settlement in Bansko",
    lang: "en",
    tool: "settlementWinners",
    kind: "table",
    minRows: 3,
    facts: { place: "Bansko" },
    geo: { level: "settlement", mode: "choropleth", joinKey: "ekatte" },
  },
  {
    // "по села" phrasing also routes to settlementWinners
    q: "кой спечели по села в община Самоков",
    tool: "settlementWinners",
    kind: "table",
    minRows: 20,
  },
  {
    // EN "village" phrasing — and the trailing "municipality" must NOT divert it
    // to municipalityWinners (settlement level is checked first)
    q: "which party won in each village of Samokov municipality?",
    lang: "en",
    tool: "settlementWinners",
    kind: "table",
  },
  // -- sectionWinners (no map: sections have no choropleth polygon) --
  {
    // scoped to the named SETTLEMENT (гр.Банско = 13 sections), not the whole
    // município; carries no geo overlay
    q: "Покажи резултатите по секции в Банско",
    tool: "sectionWinners",
    kind: "table",
    minRows: 13,
    facts: { sections: { num: 13 }, leading_party: "ПрБ" },
    geo: false,
  },
  {
    q: "show the results by polling station in Bansko",
    lang: "en",
    tool: "sectionWinners",
    kind: "table",
    minRows: 13,
    geo: false,
  },
  {
    // "избирателни секции" phrasing also routes to sectionWinners
    q: "резултати по избирателни секции в Банско",
    tool: "sectionWinners",
    kind: "table",
    minRows: 13,
  },
  {
    // Sofia has no single section bundle (its МИР shards aren't in the nuts3->file
    // map) -> graceful scalar, not a crash
    q: "Покажи резултатите по секции в София",
    tool: "sectionWinners",
    kind: "scalar",
    geo: false,
  },
  // -- sectionResults / sectionHistory (ONE station by its 9-digit id) ----------
  // The reported bug: "резултатите в секция 050900092" took the id for a place
  // name and declined. A 9-digit id must route to the single-section tools BEFORE
  // the place extractor / year detector touch it. Golden against с.Иново (VID09),
  // which votes in every parliamentary election since 2009.
  {
    q: "резултатите в секция 050900092",
    tool: "sectionResults",
    kind: "table",
    minRows: 2,
    facts: {
      section: "050900092",
      settlement: "Иново",
      region: "Видин",
      winner: /\(/,
    },
    // a single section is a located point -> a settlement-level locator
    geo: { level: "settlement", mode: "locator", joinKey: "ekatte" },
    // single station -> its own /section/{id} page, pinned to this election
    links: ["/section/050900092?elections=2026_04_19"],
  },
  {
    q: "How did section 050900092 vote?",
    lang: "en",
    tool: "sectionResults",
    kind: "table",
    minRows: 2,
    facts: { section: "050900092", region: "Vidin" },
  },
  {
    // a year scopes the section to that election (single-election year 2023)
    q: "резултати в секция 050900092 през 2023",
    tool: "sectionResults",
    kind: "table",
    facts: { section: "050900092", election: "2023" },
  },
  {
    // an explicit trend cue -> the cross-election vote-share history (line series)
    q: "как е гласувала секция 050900092 през годините?",
    tool: "sectionHistory",
    kind: "series",
    facts: {
      section: "050900092",
      elections_count: { num: 12 },
      most_frequent_winner: /\(/,
    },
    geo: false,
  },
  {
    q: "trend for section 050900092",
    lang: "en",
    tool: "sectionHistory",
    kind: "series",
    facts: { section: "050900092" },
  },
  {
    // a 9-digit id with no matching station -> graceful "no data" scalar
    q: "резултати в секция 059999999",
    tool: "sectionResults",
    kind: "scalar",
    geo: false,
  },
  // -- sectionRiskHistory (ONE station's risk SCREENING rap sheet + membership) --
  // A risk cue beside a 9-digit id routes to the risk lens (band per election +
  // problem-neighborhood / persistent-cluster membership), NOT the vote-share
  // trend. Golden against 162202002 (Stolipinovo) — a flagged problem section
  // AND a 13-election persistent cluster.
  {
    q: "историята на риска за секция 162202002",
    tool: "sectionRiskHistory",
    kind: "table",
    minRows: 13,
    facts: {
      section: "162202002",
      elections_count: { num: 13 },
      problem_neighborhood: /Столипиново/,
      persistent_cluster: /13/,
    },
  },
  {
    q: "is section 162202002 a problem section or in a cluster",
    lang: "en",
    tool: "sectionRiskHistory",
    kind: "table",
    facts: {
      section: "162202002",
      problem_neighborhood: /Stolipinovo/,
      persistent_cluster: /13/,
    },
  },
  {
    // a risk cue must NOT steal a plain vote-history query: "през годините"
    // with no risk word still resolves to the vote-share trend.
    q: "как е гласувала секция 162202002 през годините",
    tool: "sectionHistory",
    kind: "series",
  },
  // -- settlementResults / settlementHistory (ONE settlement by name) -----------
  // The reported bug: "резултатите в с. Иново" took the village for nothing and
  // fell through to national results. The "с." / "гр." marker (or "village/town
  // of") flags ONE settlement. Golden against с. Иново (VID09), 291 valid votes in
  // 2026; it carries a settlement-level locator (no choropleth — a single point).
  {
    q: "Резултатите в с. Иново",
    tool: "settlementResults",
    kind: "table",
    minRows: 2,
    facts: {
      settlement: "Иново",
      region: "Видин",
      total_votes: { num: 291 },
      leading_party: /\S/,
    },
    geo: { level: "settlement", mode: "locator", joinKey: "ekatte" },
    // single settlement -> its own /sections/{ekatte} dashboard (the reported
    // bug: it used to point at the /regions overview), pinned to this election
    links: ["/sections/32754?elections=2026_04_19"],
  },
  {
    q: "Results in the village of Inovo",
    lang: "en",
    tool: "settlementResults",
    kind: "table",
    minRows: 2,
    facts: { settlement: "Inovo", region: "Vidin" },
    geo: { level: "settlement", mode: "locator", joinKey: "ekatte" },
  },
  {
    // the natural "how did X vote" phrasing (no "результат" word) routes via the
    // vote cue + the "гр." marker — to гр. Банско (BLG01), not a winners list
    q: "Как гласува гр. Банско?",
    tool: "settlementResults",
    kind: "table",
    minRows: 2,
    facts: { settlement: "Банско" },
  },
  {
    // a trend cue -> that settlement's cross-election vote-share history (a line
    // series). "last 5 years" is a date window covering 7 ballots since 2021-04-19.
    q: "Резултатите в с. Иново за последните 5 години",
    tool: "settlementHistory",
    kind: "series",
    facts: {
      settlement: "Иново",
      window_years: { num: 5 },
      elections_count: { num: 7 },
    },
    geo: { level: "settlement", mode: "locator", joinKey: "ekatte" },
  },
  {
    q: "Results in the village of Inovo over the last 5 years",
    lang: "en",
    tool: "settlementHistory",
    kind: "series",
    facts: { settlement: "Inovo", window_years: { num: 5 } },
  },
  {
    // a settlement marker + a "по села" AGGREGATION cue must stay settlementWinners
    // (the by-settlement list), NOT the single-settlement tool
    q: "резултати по села в община Самоков",
    tool: "settlementWinners",
    kind: "table",
    minRows: 20,
    // an aggregate (many settlements) keeps the generic overview, NOT a deep link
    links: ["/regions?elections=2026_04_19"],
  },
  // -- disambiguation: a genuinely ambiguous name pops the ask-the-user chooser -
  // "Баня" names a town + several villages across different общини; "Бяла" names
  // two municipalities. The tool returns a chooser instead of silently picking
  // one (the runner also re-runs every option to prove each pin resolves cleanly).
  // A UNIQUE name (с. Иново above) still answers directly — no chooser.
  {
    q: "Резултатите в с. Баня",
    tool: "settlementResults",
    kind: "scalar",
    clarify: { minOptions: 4 },
  },
  {
    // the cross-election history of the same ambiguous name also clarifies
    q: "Резултатите в с. Баня за последните 5 години",
    tool: "settlementHistory",
    kind: "scalar",
    clarify: { minOptions: 4 },
  },
  {
    // a duplicate município name ("Бяла" = Русе + Варна) -> municipality chooser
    q: "Кой е кметът на Бяла?",
    tool: "localMunicipality",
    kind: "scalar",
    clarify: { minOptions: 2 },
  },
  {
    // distinct people sharing an exact candidate name (three "Георги Иванов
    // Георгиев" across different parties) -> a by-party chooser; each pick pins a
    // partyNum and resolves to one person (the runner re-runs every option). A
    // unique full name still answers directly (e.g. "Божидар Божанов" above), so
    // the chooser doesn't over-fire on a precise name.
    q: "Резултатите за Георги Иванов Георгиев",
    tool: "candidateResult",
    kind: "scalar",
    clarify: { minOptions: 2 },
  },
  // -- municipalityResults / regionResults / Sofia-city / abroad (ONE area) -----
  // "резултатите в община X" used to list the whole oblast (municipalityWinners);
  // "...в област X" gave the national list (regionWinners); "...в София" fell to
  // nationalResults. The singular "община"/"област" qualifier (no по/by/each) now
  // routes to the area's OWN party table; Sofia city sums its 3 МИР; abroad keeps
  // diasporaVote. Golden vs 2026: Пловдив-муни 152802, Варна-МИР 199654, София-град
  // 618206 (= S23+S24+S25), each with a locator map.
  {
    q: "резултатите в община Пловдив",
    tool: "municipalityResults",
    kind: "table",
    minRows: 2,
    facts: {
      municipality: "Пловдив",
      total_votes: { num: 152802 },
      leading_party: /\S/,
    },
    geo: { level: "municipality", mode: "locator", joinKey: "nuts4" },
    // single município -> its own /settlement/{obshtina} dashboard, not /regions
    links: ["/settlement/PDV22?elections=2026_04_19"],
  },
  {
    q: "Results in Plovdiv municipality",
    lang: "en",
    tool: "municipalityResults",
    kind: "table",
    minRows: 2,
    facts: { municipality: "Plovdiv" },
    geo: { level: "municipality", mode: "locator", joinKey: "nuts4" },
    // same deep link in EN — the code comes from the locator, not language
    links: ["/settlement/PDV22?elections=2026_04_19"],
  },
  {
    // a historical election scopes the deep link: the "Виж в сайта" link must
    // carry ?elections=<that election>, never default to the latest
    q: "резултатите в община Пловдив 2009",
    tool: "municipalityResults",
    kind: "table",
    minRows: 2,
    facts: { municipality: "Пловдив" },
    links: ["/settlement/PDV22?elections=2009_07_05"],
  },
  {
    q: "резултатите в община Пловдив за последните 5 години",
    tool: "municipalityHistory",
    kind: "series",
    facts: {
      municipality: "Пловдив",
      window_years: { num: 5 },
      elections_count: { num: 7 },
    },
    geo: { level: "municipality", mode: "locator", joinKey: "nuts4" },
    links: ["/settlement/PDV22"],
  },
  {
    q: "резултатите в област Варна",
    tool: "regionResults",
    kind: "table",
    minRows: 2,
    facts: {
      region: "Варна",
      total_votes: { num: 199654 },
      leading_party: /\S/,
    },
    geo: { level: "oblast", mode: "locator", joinKey: "nuts3" },
    // single oblast -> its own region dashboard (lives at /municipality/{code}),
    // not the /regions overview; pinned to this election
    links: ["/municipality/VAR?elections=2026_04_19"],
  },
  {
    q: "Results in Varna region",
    lang: "en",
    tool: "regionResults",
    kind: "table",
    minRows: 2,
    facts: { region: "Varna" },
    geo: { level: "oblast", mode: "locator", joinKey: "nuts3" },
    links: ["/municipality/VAR?elections=2026_04_19"],
  },
  {
    q: "резултатите в област Варна за последните 5 години",
    tool: "regionResultsTrend",
    kind: "series",
    facts: {
      region: "Варна",
      window_years: { num: 5 },
      elections_count: { num: 7 },
    },
    links: ["/municipality/VAR"],
  },
  {
    // Sofia city = the three city МИР summed (618206 in 2026), NOT one МИР nor
    // nationalResults; the locator highlights all three
    q: "резултатите в София",
    tool: "regionResults",
    kind: "table",
    minRows: 2,
    facts: { region: "София", total_votes: { num: 618206 } },
    geo: { level: "oblast", mode: "locator", joinKey: "nuts3" },
    // Sofia-city = 3 МИР summed, no single page -> the deep-link guard keeps the
    // /regions overview (must NOT link to /municipality/S23)
    links: ["/regions?elections=2026_04_19"],
  },
  {
    q: "Results in Sofia",
    lang: "en",
    tool: "regionResults",
    kind: "table",
    minRows: 2,
    facts: { region: "Sofia" },
  },
  {
    q: "резултатите в София за последните 5 години",
    tool: "regionResultsTrend",
    kind: "series",
    facts: { region: "София", window_years: { num: 5 } },
  },
  {
    // abroad (МИР 32) keeps its dedicated diaspora tools — the natural "results
    // abroad" phrasing must reach them (snapshot + trend)
    q: "резултатите в чужбина",
    tool: "diasporaVote",
    kind: "table",
    minRows: 1,
    facts: { leader: /%/ },
  },
  {
    q: "резултатите в чужбина за последните 5 години",
    tool: "diasporaVoteTrend",
    kind: "series",
  },
  {
    // a singular qualifier with a "по" AGGREGATION cue still lists the tier
    // (municipalityWinners), not the single area
    q: "резултати по общини в Пловдив",
    tool: "municipalityWinners",
    kind: "table",
    minRows: 2,
  },
  // -- disambiguation: the winners guard must NOT steal these --
  {
    // a PARTY is named -> the party-scoped breakdown, not the winners list
    q: "ГЕРБ по общини в Благоевград",
    tool: "municipalityBreakdown",
    kind: "table",
    facts: { party: "ГЕРБ-СДС" },
  },
  {
    // a local signal ("общински съвет") -> the local-council tool, not winners
    q: "резултати за общинския съвет на Варна",
    tool: "localCouncil",
  },
  {
    // EN party-map: the router extracts the latin token "gerb"; matchParty
    // romanizes both sides so it resolves to the Cyrillic-only record (ГЕРБ-СДС)
    // and the oblast share map renders (regression for the latin-token fix).
    q: "Where is GERB strongest?",
    lang: "en",
    tool: "regionBreakdown",
    geo: {
      level: "oblast",
      mode: "choropleth",
      joinKey: "nuts3",
      minAreas: 25,
    },
  },
  {
    q: "Имаше ли нередности на последните избори?",
    tool: "electionAnomalies",
    facts: { problem_sections: { num: 138 } },
  },
  {
    // a per-party flash-memory question must answer about parties, NOT fall
    // through to the generic anomalies counter
    q: "кои партии загубиха най-много от липсваща флаш памет",
    tool: "flashMemoryByParty",
    kind: "table",
    minRows: 1,
    facts: { biggest_loser: /\(/ },
  },
  {
    q: "which parties lost the most from missing flash memory",
    lang: "en",
    tool: "flashMemoryByParty",
    kind: "table",
    minRows: 1,
  },
  {
    // machine-vote share BY PARTY -> per-party tool, not the party-blind national
    // machine-share metric
    q: "кои партии гласуват най-много машинно",
    tool: "machineVoteByParty",
    kind: "table",
    minRows: 2,
    facts: { most_machine: /%/ },
  },
  {
    // EN "vs" must not be read as a two-election comparison here
    q: "machine vs paper voting by party",
    lang: "en",
    tool: "machineVoteByParty",
    kind: "table",
    minRows: 2,
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
    // single agency -> its own /polls/{agencyId} page (+ the polls overview),
    // matching its agencyPolls / agencyAccuracyHistory siblings
    links: ["/polls/AR", "/polls"],
  },
  {
    q: "Какво показват последните проучвания?",
    tool: "latestPolls",
    kind: "table",
    facts: { leader: /%/ },
  },
  { q: "Какво би станало ако изборите бяха сега?", tool: "latestPolls" },
  // poll-history trend — the query that used to fall through to a candidate
  // lookup ("Маркет Линкс not found"); now plots the agency's poll trajectory.
  {
    q: "история на проучванията на Маркет Линкс",
    tool: "agencyPolls",
    kind: "series",
    facts: { agency: "Маркет" },
  },
  // per-agency accuracy trend (vs the single-snapshot agencyProfile).
  {
    q: "Как се променя точността на Алфа Рисърч през годините?",
    tool: "agencyAccuracyHistory",
    kind: "series",
    facts: { agency: "Алфа" },
  },
  // comparative accuracy trend across agencies.
  {
    q: "Как се променя точността на агенциите през годините?",
    tool: "accuracyTrend",
    kind: "series",
    facts: { most_accurate: "Алфа" },
  },
  // agency resolution fix: the 2-letter abbr "АР" (Алфа Рисърч) used to
  // substring-hit inside "маркет" and steal this query — now resolves to ML
  // (mean error 1.67 pp, not Alpha's 1.6 pp).
  {
    q: "Колко е точна Маркет Линкс?",
    tool: "agencyProfile",
    kind: "scalar",
    facts: { mean_error: "1.67" },
  },
  // ---- local elections -------------------------------------------------------
  {
    q: "Кой спечели общинските съвети?",
    tool: "localCouncilVoteShare",
    kind: "table",
    facts: { leader: "ГЕРБ" },
  },
  {
    // a named year selects that local cycle — previously the router dropped the
    // year and resolveLocalCycle silently answered for the latest (2023) cycle.
    q: "Кой спечели общинските съвети през 2019?",
    tool: "localCouncilVoteShare",
    kind: "table",
    facts: { cycle: "2019" },
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
    // single município local answer -> /local/{cycle}/{obshtina}, not the cycle
    // landing it used to fall back to
    links: ["/local/2023_10_29_mi/PDV22"],
  },
  {
    // Sofia: the synthetic "SOF" bundle the geo channel couldn't reach -> now
    // resolves via the obshtina_id fact (regression for the Sofia local gap)
    q: "Кой е кметът на София?",
    tool: "localMunicipality",
    kind: "scalar",
    facts: { mayor: "Терзиев" },
    links: ["/local/2023_10_29_mi/SOF"],
  },
  {
    q: "Кои бяха кандидатите за кмет на Варна?",
    tool: "localMayorRace",
    kind: "table",
    facts: { winner: "Коцев" },
    links: ["/local/2023_10_29_mi/VAR06/mayor"],
  },
  {
    // per-município council -> hemicycle (kind table + viz hemicycle); 51 seats
    // -> majority 26, no single-party majority
    q: "Какъв е общинският съвет на Бургас?",
    tool: "localCouncil",
    kind: "table",
    facts: { total_seats: { num: 51 }, majority: { num: 26 } },
    links: ["/local/2023_10_29_mi/BGS04/council"],
  },
  {
    q: "Има ли частични местни избори?",
    tool: "chmiEvents",
    kind: "table",
    facts: { total: { num: 379 } },
    // the extraordinary-elections feed -> its dedicated page, not the cycle landing
    links: ["/local/chmi"],
  },
  // ---- local: mayors over cycles + place comparison --------------------------
  {
    q: "Кои са последните кметове на София?",
    tool: "localMayorHistory",
    kind: "table",
    minRows: 4,
    facts: { latest_mayor: "Терзиев" },
    // cross-cycle -> Sofia's latest-cycle local dashboard (synthetic SOF bundle;
    // the geo channel couldn't reach SOF — this locks the fact-channel fix)
    links: ["/local/2023_10_29_mi/SOF"],
  },
  {
    q: "Сравни Варна и Бургас",
    tool: "comparePlaces",
    kind: "table",
    minRows: 3,
    facts: { a: "Варна", b: "Бургас" },
  },
  {
    q: "compare Plovdiv and Varna",
    lang: "en",
    tool: "comparePlaces",
    kind: "table",
    minRows: 3,
  },
  {
    // Sofia районs (districts) — sub-municipal mayors
    q: "Кои са районните кметове на София?",
    tool: "localSubMayors",
    kind: "table",
    minRows: 20,
    facts: { level: "районни" },
    // the marquee Sofia query -> Sofia's local dashboard (SOF), not the landing
    links: ["/local/2023_10_29_mi/SOF"],
  },
  {
    // a regular município's settlement (kmetstvo) mayors
    q: "Кметове на кметствата в Асеновград",
    tool: "localSubMayors",
    kind: "table",
    minRows: 10,
    facts: { place: "Асеновград" },
    links: ["/local/2023_10_29_mi/PDV01"],
  },
  {
    // oblast-wide mayors-by-party rollup (canonicalised across the province)
    q: "Колко кметове спечели всяка партия в област Пловдив?",
    tool: "localOblastMayors",
    kind: "table",
    minRows: 4,
    facts: { oblast: "Пловдив", leader: "БСП-ОЛ" },
  },
  {
    q: "mayors won by party in Varna province",
    lang: "en",
    tool: "localOblastMayors",
    kind: "table",
    minRows: 3,
    facts: { leader: "ГЕРБ-СДС" },
  },
  // ---- fiscal ----------------------------------------------------------------
  {
    q: "Какъв е държавният бюджет?",
    tool: "budgetOverview",
    kind: "table",
    minRows: 4,
  },
  {
    // a named fiscal year selects that year's execution (router -> args.year)
    q: "Какъв е държавният бюджет за 2022?",
    tool: "budgetOverview",
    kind: "table",
    facts: { year: { num: 2022 } },
  },
  {
    q: "За какво се харчи бюджетът?",
    tool: "budgetByFunction",
    kind: "table",
    minRows: 5,
  },
  {
    // year selection on the functional breakdown
    q: "За какво се харчи бюджетът през 2021?",
    tool: "budgetByFunction",
    kind: "table",
    facts: { year: { num: 2021 } },
  },
  {
    // year selection on a single function slice
    q: "Колко се отделя за здравеопазване през 2022?",
    tool: "budgetFunction",
    kind: "series",
    facts: { year: { num: 2022 }, function: "Здравеопазв" },
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
  // ---- tax-policy what-if (the /budget/simulator scoring engine) --------------
  // The golden Δs are PARITY values: the same scenario on /budget/simulator
  // shows the same headline (the tool mirrors the component's scenario +
  // dynamicScenario math over the same policy_baseline.json). The screen's
  // default is the DYNAMIC estimate, so delta_per_year pins the dynamic
  // headline and delta_static the static counterpart. The deep link carries
  // the simulator's own query-string params, so the answer opens pre-set.
  {
    q: "Какво става, ако ДДС стане 22%?",
    tool: "simulateTaxChange",
    kind: "scalar",
    facts: {
      change: "ДДС 22%",
      delta_per_year: /\+723/,
      delta_static: /\+887/,
      share_of_gdp: /%/,
    },
    links: ["/budget/simulator?dds=22", "/budget"],
  },
  {
    q: "What if income tax goes to 15%?",
    lang: "en",
    tool: "simulateTaxChange",
    kind: "scalar",
    facts: {
      change: "income tax 15%",
      delta_per_year: /\+€1\.6B/,
      delta_static: /\+€1\.9B/,
    },
    links: ["/budget/simulator?pit=15", "/budget"],
  },
  {
    // cost-of-policy framing with no amount -> the МРЗ preset (€620/mo),
    // employment-only by construction (the flat rate itself is unchanged)
    q: "Колко струва необлагаем минимум?",
    tool: "simulateTaxChange",
    kind: "scalar",
    facts: { change: /620/, delta_per_year: /−1,7/, delta_static: /−1,9/ },
    links: ["/budget/simulator?nm=620", "/budget"],
  },
  {
    // VAT category regime change (храни -> намалена ставка 9%)
    q: "Какво става, ако ДДС върху храните стане 9%?",
    tool: "simulateTaxChange",
    kind: "scalar",
    facts: { change: "Храни", delta_per_year: /−1,2/, delta_static: /−1,4/ },
    links: ["/budget/simulator?food=reduced", "/budget"],
  },
  {
    // МОД-cap removal — carries the Pareto-tail uncertainty band
    q: "What happens if we remove the social security cap?",
    lang: "en",
    tool: "simulateTaxChange",
    kind: "scalar",
    facts: {
      delta_per_year: /\+€794M/,
      delta_static: /\+€1\.1B/,
      range: /…/,
    },
    links: ["/budget/simulator?nocap=1", "/budget"],
  },
  // expenditure levers — Δ is on the budget BALANCE (positive = improves),
  // parity with the same scenario on /budget/simulator
  {
    q: "Какво става, ако пенсиите се индексират само по инфлация?",
    tool: "simulateTaxChange",
    kind: "scalar",
    facts: {
      change: "индексация на пенсиите с 100% тежест на инфлацията",
      delta_per_year: /\+470/,
      delta_static: /\+479/,
    },
    links: ["/budget/simulator?pw=100", "/budget"],
  },
  {
    q: "Ковид добавката да не се индексира",
    tool: "simulateTaxChange",
    kind: "scalar",
    facts: {
      change: "ковид добавката не се индексира",
      delta_per_year: /\+55/,
      delta_static: /\+56/,
    },
    links: ["/budget/simulator?ks=0", "/budget"],
  },
  {
    // the vacancy honesty note: most of a 10% cut falls on vacant positions
    q: "Съкращаване на администрацията с 10%",
    tool: "simulateTaxChange",
    kind: "scalar",
    facts: {
      change: "администрация −10%",
      delta_per_year: /\+30/,
      note: /незаети/,
    },
    links: ["/budget/simulator?adm=10", "/budget"],
  },
  {
    q: "Freeze the minimum wage",
    lang: "en",
    tool: "simulateTaxChange",
    kind: "scalar",
    facts: { change: "minimum wage frozen", delta_per_year: /−€279M/ },
    links: ["/budget/simulator?mrz=1", "/budget"],
  },
  // Phase-5 levers — same balance convention, simulator parity
  {
    // defense %-of-GDP target (NATO definition), tenths in the deep link
    q: "Какво става, ако отбраната стане 3% от БВП?",
    tool: "simulateTaxChange",
    kind: "scalar",
    facts: {
      change: "отбрана 3.0% от БВП",
      delta_per_year: /−1,1/,
      delta_static: /−1,2/,
      note: /НАТО/,
    },
    links: ["/budget/simulator?def=30", "/budget"],
  },
  {
    q: "Заплатите в публичния сектор +5%",
    tool: "simulateTaxChange",
    kind: "scalar",
    facts: {
      change: "заплати в публичния сектор 5%",
      // Net of the mechanical labour-tax feedback (~30.6% of indexed pay
      // returns as PIT+SSC) — consistent with the administration-cut lever.
      delta_per_year: /−96/,
      delta_static: /−98/,
    },
    links: ["/budget/simulator?wi=5", "/budget"],
  },
  {
    // cash effect scales by the historical execution rate (the note)
    q: "Капиталовите разходи -10%",
    tool: "simulateTaxChange",
    kind: "scalar",
    facts: {
      change: "капиталов план -10%",
      delta_per_year: /\+182/,
      delta_static: /\+185/,
      note: /изпълняемост/,
    },
    links: ["/budget/simulator?kap=-10", "/budget"],
  },
  {
    q: "Държавните служители да си плащат осигуровките",
    tool: "simulateTaxChange",
    kind: "scalar",
    facts: {
      change: "държавните служители плащат осигуровките си",
      // Full КСО чл. 6, ал. 5 scope: administration + judiciary + defense &
      // security (132,862 people across the two НОИ SOD-2024 categories).
      delta_per_year: /\+249/,
      delta_static: /\+254/,
    },
    links: ["/budget/simulator?ssp=1", "/budget"],
  },
  {
    q: "Здравната вноска +1 пункт",
    tool: "simulateTaxChange",
    kind: "scalar",
    facts: {
      change: "здравна вноска +1 п.п.",
      // Net of the employee-share PIT deductibility offset (~4% of the gross).
      delta_per_year: /\+249/,
      delta_static: /\+302/,
    },
    links: ["/budget/simulator?hp=1", "/budget"],
  },
  // June-2026 consolidation-debate levers — simulator parity (dynamic headline)
  {
    // the dynamic figure credits the returning mothers' PIT+SSC (recapture)
    q: "Съкращаване на майчинството до 1 година",
    tool: "simulateTaxChange",
    kind: "scalar",
    facts: {
      change: "майчинство: втората година отпада",
      delta_per_year: /\+215/,
      delta_static: /\+154/,
      note: /върнал/,
    },
    links: ["/budget/simulator?mat=0", "/budget"],
  },
  {
    // teachers' 125% peg — static net of the labour-tax feedback
    q: "Учителските заплати на 125% от средната",
    tool: "simulateTaxChange",
    kind: "scalar",
    facts: {
      change: "учителски заплати → 125% от средната",
      delta_per_year: /−140/,
      delta_static: /−143/,
    },
    links: ["/budget/simulator?tp=125", "/budget"],
  },
  {
    q: "Минималната пенсия на 400 €",
    tool: "simulateTaxChange",
    kind: "scalar",
    facts: {
      change: "минимална пенсия → €400/мес.",
      delta_per_year: /−945/,
      delta_static: /−963/,
    },
    links: ["/budget/simulator?mp=400", "/budget"],
  },
  {
    q: "Замразяване на депутатските заплати",
    tool: "simulateTaxChange",
    kind: "scalar",
    facts: {
      change: "замразени депутатски заплати",
      delta_per_year: /\+2 млн/,
    },
    links: ["/budget/simulator?mpf=1", "/budget"],
  },
  {
    q: "Премахване на партийните субсидии",
    tool: "simulateTaxChange",
    kind: "scalar",
    facts: {
      change: "без партийни субсидии",
      delta_per_year: /\+[89] млн/,
    },
    links: ["/budget/simulator?psub=0", "/budget"],
  },
  // excise levers (commit 5790a3372) — revenue side; the dynamic headline leads
  // and the static central rides as a fact. Fuel/tobacco/alcohol = % change to
  // the existing rate; wine = introduced at €X/hl from €0.
  {
    // flagship: tobacco bends into the Laffer turn — the dynamic figure
    // (≈+498M) is well below the static +861M as illicit-market substitution
    // erodes the gain (the note explains it)
    q: "Вдигане на акциза върху цигарите с 40%",
    tool: "simulateTaxChange",
    kind: "scalar",
    facts: {
      change: "акциз върху тютюна +40%",
      delta_per_year: /\+498/,
      delta_static: /\+861/,
      note: /Лафер/,
    },
    links: ["/budget/simulator?exct=40", "/budget"],
  },
  {
    // fuel is inelastic -> only a small behavioral haircut (≈+€111M vs +€144M)
    q: "Raise the fuel excise by 10%",
    lang: "en",
    tool: "simulateTaxChange",
    kind: "scalar",
    facts: {
      change: "fuel excise +10%",
      delta_per_year: /\+€111M/,
      delta_static: /\+€144M/,
    },
    links: ["/budget/simulator?excf=10", "/budget"],
  },
  {
    // wine is INTRODUCED from €0 in €/hl -> the home-production leakage note
    q: "Акциз върху виното 48 €/хл",
    tool: "simulateTaxChange",
    kind: "scalar",
    facts: {
      change: /вино/,
      delta_per_year: /\+33/,
      delta_static: /\+45/,
      note: /домашно/,
    },
    links: ["/budget/simulator?winex=48", "/budget"],
  },
  // gambling ЗХ GGR fee (commit ebc14cb16) — revenue side; a level lever, not a
  // % change. 40% = +€107M static; the dynamic headline (+€59M after Tier-2)
  // leads as licensed play migrates offshore (a strong Laffer case).
  {
    q: "Данъкът върху хазарта да стане 40%",
    tool: "simulateTaxChange",
    kind: "scalar",
    facts: {
      change: /хазарт/,
      delta_per_year: /\+59/,
      delta_static: /\+107/,
      note: /Лафер/,
    },
    links: ["/budget/simulator?haz=40", "/budget"],
  },
  {
    // guard: a bare definitional "колко са акцизите" is NOT a what-if — it
    // routes to the budget overview (excise is a revenue line), not the simulator
    q: "Колко са акцизите?",
    tool: "budgetOverview",
  },
  {
    // guard: a bare definitional gambling read is NOT a what-if either — it
    // routes to the budget overview (gambling is a revenue line)
    q: "Колко са приходите от хазарт?",
    tool: "budgetOverview",
  },
  {
    // guard: a price "колко струва" question is NOT a tax what-if (and vice
    // versa the simulator never steals the retail-price tool)
    q: "Колко струва млякото в Пловдив?",
    tool: "settlementPrices",
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
    // "which PARTY" (not which MP) -> per-party rollup
    q: "коя партия има най-богати депутати",
    tool: "mpAssetsByParty",
    kind: "table",
    minRows: 2,
    facts: { richest_party: /\(/ },
  },
  {
    // declines today (no "депутат" keyword) -> must now route to the party rollup
    q: "кои партии имат най-много бизнес връзки",
    tool: "mpConnectionsByParty",
    kind: "table",
    minRows: 2,
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
  {
    // a named year pins the indicator's as-of point (still draws the full trend)
    q: "Каква беше инфлацията през 2019?",
    tool: "macroIndicator",
    kind: "series",
    facts: { latest_period: /2019/ },
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
    // per-município indicator pinned to a year
    q: "Каква беше безработицата в Сливен през 2019?",
    tool: "subnationalIndicator",
    kind: "series",
    facts: { place: "Сливен", latest_year: { num: 2019 } },
  },
  {
    q: "Какъв е БВП на човек във Варна?",
    tool: "regionIndicator",
    kind: "series",
    facts: { oblast: "Варна" },
  },
  {
    // per-oblast indicator pinned to a year
    q: "Какъв беше БВП на човек във Варна през 2020?",
    tool: "regionIndicator",
    kind: "series",
    facts: { oblast: "Варна", latest_year: { num: 2020 } },
  },
  // ---- ranking across a tier (slice the whole level, not one place) ----------
  {
    q: "кои общини са с най-висока безработица?",
    tool: "rankPlaces",
    kind: "table",
    facts: { indicator: "безработица", order: "най-високи", level: "общини" },
  },
  {
    q: "коя област е с най-висок БВП на човек?",
    tool: "rankPlaces",
    kind: "table",
    facts: { level: "области" },
  },
  {
    q: "топ 5 области по нетна миграция",
    tool: "rankPlaces",
    kind: "table",
    minRows: 5,
    facts: { level: "области" },
  },
  {
    q: "коя е най-прозрачната община?",
    tool: "rankPlaces",
    kind: "table",
    facts: { indicator: "Прозрачност" },
  },
  {
    q: "кои общини са с най-нисък среден успех на матурите?",
    tool: "rankPlaces",
    kind: "table",
    facts: { order: "най-ниски" },
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
    // as-of year re-anchors the year-aware slices (local cycle + indicators) —
    // the 2019 mayor/turnout/unemployment, not the latest
    q: "Разкажи ми за Габрово през 2019",
    tool: "governanceProfile",
    kind: "scalar",
    facts: { local_turnout: /\(2019\)/, unemployment: /\(2019\)/ },
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
    // -> Ruse's governance page (mounts the council tile), not /governance
    links: ["/governance/RSE27"],
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
  // turnout disambiguation: 2021 held 3 elections, so a bare year fans out into
  // one combined comparison (a bar per ballot) instead of silently picking Nov.
  {
    q: "turnout in 2021",
    lang: "en",
    tool: "turnout",
    kind: "series",
    minRows: 3,
    facts: { year: /2021/, elections_count: { num: 3 } },
  },
  {
    // a month NAME pins one ballot of a multi-election year via the keyword
    // router's detectMonth — must resolve to that ballot, NOT fan out
    q: "Каква беше активността през юли 2021?",
    tool: "turnout",
    kind: "scalar",
    facts: { turnout: /\d/, election: "2021" },
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
  // ---- election integrity & anomalies ----------------------------------------
  {
    q: "Как гласуват ромските квартали?",
    tool: "problemSections",
    kind: "table",
    facts: { neighborhoods: { num: 8 } },
  },
  {
    q: "Има ли контролиран вот?",
    tool: "problemSections",
    kind: "table",
    minRows: 1,
  },
  {
    // a trend cue ("последните 5 години") turns the Roma-vote question into the
    // cross-election leader trend, NOT the single-election snapshot. The 5-year
    // date window (cutoff 2021_04_19) covers 7 parliamentary ballots.
    q: "Коя партия спечели ромските гласове последните 5 години?",
    tool: "romaVoteTrend",
    kind: "series",
    facts: { window_years: { num: 5 }, elections_count: { num: 7 } },
  },
  {
    q: "How does the Roma vote change over time?",
    lang: "en",
    tool: "romaVoteTrend",
    kind: "series",
    facts: { most_frequent_winner: /\S/ },
  },
  {
    // the composite headline index (0–100 + 10 components: 5 integrity + 5
    // context), NOT the per-section band table. Locks all the headline facts.
    q: "Какъв е индексът на изборния риск?",
    tool: "riskIndex",
    kind: "table",
    minRows: 10,
    facts: {
      index: /^\d{1,3}$/,
      band: /\S/,
      integrity_components: /^\d\/\d$/,
      context_score: /\d/,
      top_integrity: /\(\d+\)/,
    },
  },
  {
    q: "What is the election risk index?",
    lang: "en",
    tool: "riskIndex",
    kind: "table",
    minRows: 10,
    facts: { index: /^\d{1,3}$/, band: /\S/ },
  },
  // "оценка"/"score" framing also reaches the composite index
  {
    q: "Каква е оценката за изборния риск?",
    tool: "riskIndex",
    kind: "table",
    minRows: 10,
    facts: { index: /\d/ },
  },
  {
    q: "What's the election risk score?",
    lang: "en",
    tool: "riskIndex",
    kind: "table",
    minRows: 10,
    facts: { index: /\d/ },
  },
  // the section-band screening view stays on riskScore (the section/critical
  // cue wins over the composite index, even when "индекс"/"риск" is present)
  { q: "Колко критични секции има?", tool: "riskScore", kind: "table" },
  {
    q: "How many critical sections?",
    lang: "en",
    tool: "riskScore",
    kind: "table",
  },
  {
    q: "Покажи секциите по ниво на риск",
    tool: "riskScore",
    kind: "table",
    minRows: 4,
    facts: { critical: /\d/ },
  },
  {
    // names BOTH "индекс на изборния риск" AND "по секции" → the section view
    // wins (most-specific cue), so this must NOT grab the composite index
    q: "Какъв е индексът на изборния риск по секции?",
    tool: "riskScore",
    kind: "table",
  },
  {
    q: "Има ли клъстери на изборния риск?",
    tool: "riskClusters",
    kind: "table",
    minRows: 1,
    facts: { clusters: /\d/ },
  },
  {
    // "which party is in the riskiest sections" -> the party-grounded clusters
    // tool, not the party-blind risk-band index
    q: "коя партия е в най-рисковите секции",
    tool: "riskClusters",
    kind: "table",
    minRows: 1,
  },
  {
    q: "Кои места са с устойчив изборен риск?",
    tool: "clusterPersistence",
    kind: "table",
    minRows: 1,
    facts: { loci: /\d/ },
  },
  {
    q: "Какво показва тестът на Бенфорд?",
    tool: "benfordAnomalies",
    kind: "table",
    minRows: 1,
    facts: { parties_tested: /\d/ },
  },
  {
    q: "Benford test for the latest election",
    lang: "en",
    tool: "benfordAnomalies",
    kind: "table",
  },
  {
    q: "Колко гласове са прахосани под прага?",
    tool: "wastedVotes",
    kind: "table",
    minRows: 1,
    facts: { national_share: /%/ },
  },
  { q: "wasted votes", lang: "en", tool: "wastedVotes", kind: "table" },
  {
    // "which party wasted the most" -> per-party ranking (previously declined:
    // "прахоса" didn't match "прахосан")
    q: "коя партия прахоса най-много гласове",
    tool: "wastedVotesByParty",
    kind: "table",
    minRows: 2,
    facts: { top_wasted: /\(/ },
  },
  {
    q: "which party wasted the most votes",
    lang: "en",
    tool: "wastedVotesByParty",
    kind: "table",
    minRows: 2,
  },
  {
    // recount-by-party: only 2024-10-27 has recount data (region_votes.original)
    q: "кои партии загубиха от преброяване наново",
    election: "2024_10_27",
    tool: "recountByParty",
    kind: "table",
    minRows: 2,
    facts: { biggest_loser: /\(/ },
  },
  {
    // a cycle WITHOUT a recount -> honest no-recount scalar, still routed here
    q: "кои партии загубиха от преброяване наново",
    tool: "recountByParty",
    kind: "scalar",
  },
  {
    q: "Кои населени места са съмнителни?",
    tool: "suspiciousSettlements",
    kind: "table",
    minRows: 3,
    facts: { concentrated: /\d/ },
  },
  {
    q: "Как гласува диаспората?",
    tool: "diasporaVote",
    kind: "table",
    minRows: 1,
    facts: { leader: /%/ },
  },
  {
    q: "How did the diaspora vote?",
    lang: "en",
    tool: "diasporaVote",
    kind: "table",
  },
  {
    q: "Колко избиратели запазиха своя вот?",
    tool: "voterPersistence",
    kind: "table",
    minRows: 1,
    facts: { national_stay_rate: /%/ },
  },
  // ---- demographics (census correlations) ------------------------------------
  {
    q: "Кой гласува за Възраждане?",
    tool: "partyDemographics",
    kind: "table",
    minRows: 1,
    facts: { party: "Възраждане" },
  },
  {
    q: "Демографски профил на ДПС",
    tool: "partyDemographics",
    kind: "table",
    facts: { party: "ДПС" },
  },
  {
    q: "Какво разделя гласоподавателите?",
    tool: "demographicCleavages",
    kind: "table",
    minRows: 1,
    facts: { most_divisive: /\(/ },
  },
  // ---- parliament roll-call --------------------------------------------------
  {
    q: "Кои депутати са най-лоялни?",
    tool: "mpLoyalty",
    kind: "table",
    minRows: 1,
    facts: { ns: "52", most_loyal: /%/ },
  },
  {
    q: "which MPs are most loyal?",
    lang: "en",
    tool: "mpLoyalty",
    kind: "table",
  },
  {
    q: "Кои депутати отсъстват най-много?",
    tool: "mpAttendance",
    kind: "table",
    minRows: 1,
    facts: { worst_attendance: /%/ },
  },
  {
    q: "Коя група гласува най-единно?",
    tool: "factionCohesion",
    kind: "table",
    minRows: 1,
    facts: { most_cohesive: /%/ },
  },
  {
    q: "Как гласува Бойко Борисов в парламента?",
    tool: "mpVotingProfile",
    kind: "scalar",
    facts: { name: "Борисов" },
    // single MP -> their own /candidate/mp-{id} page, not the /votes overview
    links: ["/candidate/mp-5186"],
  },
  {
    q: "Кой гласува като Асен Василев?",
    tool: "mpSimilarity",
    kind: "table",
    minRows: 1,
    facts: { mp: "Василев" },
    // single MP -> their similarity ranking page, not the /votes overview
    links: ["/parliament/similarity/3606"],
  },
  {
    // EN-spelled MP name resolves against the Cyrillic roster via romanization
    q: "who votes like Asen Vasilev?",
    lang: "en",
    tool: "mpSimilarity",
    kind: "table",
    minRows: 1,
    facts: { mp: "Василев" },
    links: ["/parliament/similarity/3606"],
  },
  {
    q: "How does Boyko Borisov vote in parliament?",
    lang: "en",
    tool: "mpVotingProfile",
    kind: "scalar",
    facts: { name: "Борисов" },
    links: ["/candidate/mp-5186"],
  },
  {
    q: "Как гласува парламентът за бюджета?",
    tool: "voteSearch",
    kind: "table",
    minRows: 1,
    facts: { matches: /\d/ },
  },
  {
    q: "Кои са най-оспорваните гласувания?",
    tool: "voteSearch",
    kind: "table",
    minRows: 1,
  },
  // ---- MPs of a party (roster) ----------------------------------------------
  // The headline fix: "ПП" must resolve to Продължаваме Промяната and list its
  // MPs BY NAME — NOT substring-match the "ПП" (= политическа партия) prefix of
  // an unrelated party's full name (the partyResult bug) and NOT report bare
  // vote stats. minRows floors lock a non-empty roster without pinning the exact
  // (re-scrape-volatile) member count; `group` regex locks the resolved group.
  {
    q: "кои са депутатите от ПП?",
    tool: "partyMps",
    kind: "table",
    minRows: 10,
    facts: { group: /Продължаваме Промяната/, count: /\d/, members: /, / },
  },
  {
    // "депутатите на X" phrasing + a different group
    q: "депутатите на ДПС",
    tool: "partyMps",
    kind: "table",
    minRows: 10,
    facts: { group: /ДПС/ },
  },
  {
    // "народните представители на X" phrasing + the ДБ acronym must resolve to
    // Демократична България (acronym alias), not the catch-all
    q: "народните представители на ДБ",
    tool: "partyMps",
    kind: "table",
    minRows: 10,
    facts: { group: /Демократична България/ },
  },
  {
    // single-word group name (no acronym path) still resolves
    q: "кои са депутатите от Възраждане?",
    tool: "partyMps",
    kind: "table",
    minRows: 5,
    facts: { group: /ВЪЗРАЖДАНЕ/ },
  },
  {
    // hyphen token vs en-dash label: "ГЕРБ-СДС" must match "ГЕРБ – СДС" via the
    // dash-normalized alias (a bare "ГЕРБ" only matched by substring, masking
    // this). Asserts a TABLE, not the not-found scalar.
    q: "кои са депутатите от ГЕРБ-СДС?",
    tool: "partyMps",
    kind: "table",
    minRows: 20,
    facts: { group: /ГЕРБ/ },
  },
  // EN phrasings — the latin token romanizes to the Cyrillic group via matchParty
  {
    q: "MPs from GERB",
    lang: "en",
    tool: "partyMps",
    kind: "table",
    minRows: 20,
    facts: { group: /ГЕРБ/, ns: /National Assembly/ },
  },
  {
    q: "who are the MPs of DPS",
    lang: "en",
    tool: "partyMps",
    kind: "table",
    minRows: 10,
    facts: { group: /ДПС/ },
  },
  {
    // sentence-initial "MPs" (no leading space) + EN dash token
    q: "GERB-SDS MPs",
    lang: "en",
    tool: "partyMps",
    kind: "table",
    minRows: 20,
    facts: { group: /ГЕРБ/ },
  },
  {
    // a party that isn't a distinct roster group (folded into the catch-all) ->
    // graceful not-found scalar that lists the groups that DO resolve
    q: "кои са депутатите от БСП?",
    tool: "partyMps",
    kind: "scalar",
    facts: { available: /Продължаваме Промяната/ },
  },
  // ---- partyMps DISAMBIGUATION (the rule must not steal neighbouring intents) -
  {
    // votes, not a roster
    q: "колко гласа взе ГЕРБ?",
    tool: "partyResult",
    kind: "scalar",
    facts: { party: "ГЕРБ" },
  },
  {
    // seats count for a named party stays partyResult (not partyMps/seats)
    q: "колко места има ГЕРБ?",
    tool: "partyResult",
    kind: "scalar",
    facts: { party: "ГЕРБ" },
  },
  {
    // party + "депутат" + a WEALTH framing -> assets ranking, not the roster
    q: "кои депутати от ГЕРБ са най-богати?",
    tool: "mpAssetsTop",
  },
  {
    // party + "депутат" + a CONNECTIONS framing -> connections ranking
    q: "кои депутати от ДПС имат най-много фирмени връзки?",
    tool: "mpConnectionsTop",
  },
  {
    // a loyalty question (no party) stays roll-call loyalty
    q: "кои депутати са най-лоялни?",
    tool: "mpLoyalty",
    kind: "table",
  },
  // ---- schools ---------------------------------------------------------------
  {
    q: "Кои са най-добрите училища в Пловдив?",
    tool: "schoolScores",
    kind: "table",
    minRows: 1,
    facts: { place: "Пловдив" },
  },
  {
    q: "best schools in Plovdiv",
    lang: "en",
    tool: "schoolScores",
    kind: "table",
  },
  // ---- a specific election year for a new tool -------------------------------
  { q: "индекс на риска 2023", tool: "riskIndex", kind: "table" },
  // ---- BORDER CASES: disambiguation between new and existing tools -----------
  // "Roma in X" (count) -> census, NOT the problem-sections feature
  {
    q: "колко роми има във Видин",
    tool: "census",
    facts: { population: /\d/ },
  },
  // "проблемни секции" -> the anomaly counter, NOT the Roma-neighbourhood tool
  {
    q: "проблемни секции на последните избори",
    tool: "electionAnomalies",
    facts: { problem_sections: /\d/ },
  },
  // "кой гласува за X" (a party) -> demographics; "колко гласа взе X" -> result
  { q: "кой гласува за ГЕРБ", tool: "partyDemographics", kind: "table" },
  {
    q: "колко гласа взе ГЕРБ",
    tool: "partyResult",
    kind: "scalar",
    facts: { party: "ГЕРБ" },
  },
  // a named MP "in parliament" -> roll-call profile; bare name -> preferences
  {
    q: "как гласува Бойко Борисов в парламента",
    tool: "mpVotingProfile",
    kind: "scalar",
  },
  {
    q: "резултатите за Бойко Борисов",
    tool: "candidateResult",
    facts: { name: "Борисов" },
  },
  // "училища в X" -> per-school scores; bare "матура в X" -> municipal average
  {
    q: "най-добрите училища в Сливен",
    tool: "schoolScores",
    kind: "table",
  },
  {
    q: "среден успех на матурите в Сливен",
    tool: "subnationalIndicator",
    kind: "series",
    facts: { place: "Сливен" },
  },
  // ---- BORDER CASES: graceful failure on unknown entities --------------------
  {
    // unknown município -> localMunicipality declines cleanly (scalar, no mayor)
    q: "Кой е кметът на Несъществуевоград?",
    tool: "localMunicipality",
    kind: "scalar",
  },
  {
    q: "Колко жители има Несъществуевоград?",
    tool: "census",
    kind: "scalar",
  },
  {
    q: "Как гласува Иван Несъществуващ в парламента?",
    tool: "mpVotingProfile",
    kind: "scalar",
  },
  {
    q: "Кои са най-добрите училища в Несъществуевоград?",
    tool: "schoolScores",
    kind: "scalar",
  },
  {
    // oldest election (2005) has no prior -> voterPersistence declines cleanly
    q: "Колко избиратели запазиха своя вот?",
    election: "2005_06_25",
    tool: "voterPersistence",
    kind: "scalar",
  },
  {
    // a vote-search term that matches no title -> graceful "not found" scalar
    q: "как гласува парламентът за еднорози",
    tool: "voteSearch",
    kind: "scalar",
  },
  // ---- negative --------------------------------------------------------------
  { q: "времето е хубаво днес", tool: null },
  { q: "разкажи ми виц", tool: null },
  { q: "колко е 2 плюс 2", tool: null },
  { q: "рецепта за баница", tool: null },
  { q: "what's the weather like today?", lang: "en", tool: null },
  { q: "tell me a story about dragons", lang: "en", tool: null },

  // ---- map-overlay coverage --------------------------------------------------
  // Lock the prompt→map contract for every map MODE × LEVEL: a routing change
  // must not silently drop (or wrongly add) a map. The deep "do the area codes
  // join the geojson" check is ai/tools/geo.harness.ts's job; here we only assert
  // the overlay's shape. (nationalResults + regionBreakdown + municipality/
  // settlementBreakdown geo are asserted on their primary cases above.)
  // choropleths
  {
    q: "коя област е с най-висок БВП на човек?",
    tool: "rankPlaces",
    geo: {
      level: "oblast",
      mode: "choropleth",
      joinKey: "nuts3",
      minAreas: 20,
    },
  },
  {
    q: "кои общини са с най-висока безработица?",
    tool: "rankPlaces",
    geo: {
      level: "municipality",
      mode: "choropleth",
      joinKey: "nuts4",
      minAreas: 100,
    },
  },
  {
    // LISI covers only ~27 oblast centres, but it's still a nation-muni map
    q: "коя е най-прозрачната община?",
    tool: "rankPlaces",
    geo: {
      level: "municipality",
      mode: "choropleth",
      joinKey: "nuts4",
      minAreas: 20,
    },
  },
  {
    // local mayors-won → each município filled with its elected mayor's colour
    q: "Колко кметове спечели всяка партия в област Пловдив?",
    tool: "localOblastMayors",
    geo: {
      level: "municipality",
      mode: "choropleth",
      joinKey: "nuts4",
      minAreas: 5,
    },
  },
  // oblast locators (single-area highlight)
  {
    q: "Как се променя активността в Хасково?",
    tool: "regionHistory",
    geo: { level: "oblast", mode: "locator", joinKey: "nuts3" },
  },
  {
    q: "Какъв е БВП на човек във Варна?",
    tool: "regionIndicator",
    geo: { level: "oblast", mode: "locator", joinKey: "nuts3" },
  },
  // municipality locators (per-place answers across every place domain)
  {
    q: "Каква е безработицата в Сливен?",
    tool: "subnationalIndicator",
    geo: { level: "municipality", mode: "locator", joinKey: "nuts4" },
  },
  {
    q: "Разкажи ми за Габрово",
    tool: "governanceProfile",
    geo: { level: "municipality", mode: "locator", joinKey: "nuts4" },
  },
  {
    q: "Колко жители има Видин?",
    tool: "census",
    geo: { level: "municipality", mode: "locator", joinKey: "nuts4" },
  },
  {
    q: "Колко прозрачна е община Русе?",
    tool: "transparencyScore",
    geo: { level: "municipality", mode: "locator", joinKey: "nuts4" },
  },
  {
    q: "Какви са данъците в Пловдив?",
    tool: "localTaxes",
    geo: { level: "municipality", mode: "locator", joinKey: "nuts4" },
  },
  {
    q: "Кои са най-добрите училища в Пловдив?",
    tool: "schoolScores",
    geo: { level: "municipality", mode: "locator", joinKey: "nuts4" },
  },
  {
    q: "Какъв е въздухът в Перник?",
    tool: "airQuality",
    geo: { level: "municipality", mode: "locator", joinKey: "nuts4" },
  },
  {
    q: "Какво е регистрираното население на Габрово?",
    tool: "graoPopulation",
    geo: { level: "municipality", mode: "locator", joinKey: "nuts4" },
  },
  {
    q: "Какво реши общинският съвет на Русе?",
    tool: "councilResolutions",
    geo: { level: "municipality", mode: "locator", joinKey: "nuts4" },
  },
  {
    q: "Кой е кметът на Пловдив?",
    tool: "localMunicipality",
    geo: { level: "municipality", mode: "locator", joinKey: "nuts4" },
  },
  {
    q: "Кои бяха кандидатите за кмет на Варна?",
    tool: "localMayorRace",
    geo: { level: "municipality", mode: "locator", joinKey: "nuts4" },
  },
  {
    // hemicycle answer that ALSO carries a locator map
    q: "Какъв е общинският съвет на Бургас?",
    tool: "localCouncil",
    geo: { level: "municipality", mode: "locator", joinKey: "nuts4" },
  },
  // settlement locator
  {
    q: "Колко обществени поръчки има в Русе?",
    tool: "procurementBySettlement",
    geo: { level: "settlement", mode: "locator", joinKey: "ekatte" },
  },
  // ---- consumption: basket affordability + basket vs official inflation -----
  {
    q: "Къде е най-достъпна кошницата спрямо доходите?",
    tool: "basketAffordability",
    kind: "table",
    minRows: 5,
    facts: { most_affordable: /€|€\d|\d/ },
    geo: { level: "oblast", mode: "choropleth", joinKey: "nuts3" },
  },
  {
    q: "What is purchasing power by oblast?",
    lang: "en",
    tool: "basketAffordability",
    kind: "table",
    minRows: 5,
  },
  {
    q: "Каква е достъпността на кошницата във Варна?",
    tool: "basketAffordability",
    kind: "scalar",
    facts: { place: "Варна", affordability_rank: /\d/ },
    geo: { level: "oblast", mode: "locator", joinKey: "nuts3" },
  },
  {
    q: "Изпреварва ли кошницата официалната инфлация?",
    tool: "basketVsInflation",
    kind: "table",
    minRows: 3,
    facts: { basket_change_since_euro: /%/ },
  },
  {
    q: "The basket vs HICP inflation",
    lang: "en",
    tool: "basketVsInflation",
    kind: "table",
  },
  // guard: a bare inflation question still routes to the macro read, not the
  // basket-vs-inflation comparison (which needs an explicit basket cue).
  { q: "Каква е инфлацията?", tool: "macroIndicator" },
  // negatives — these answers must carry NO map
  { q: "Колко гора има в България?", tool: "landUse", geo: false },
  { q: "Какъв е държавният бюджет?", tool: "budgetOverview", geo: false },
  { q: "Кои депутати са най-богати?", tool: "mpAssetsTop", geo: false },
  {
    q: "Кой е кметът на Несъществуевоград?",
    tool: "localMunicipality",
    geo: false,
  },
];

// Raw-arg cases: the LLM router emits {tool, args} directly and can't know the
// exact ballot date, so it passes a bare year / loose date as `election`. These
// run the tool with those raw args (bypassing the keyword router, which would
// have pre-resolved the year) to assert resolveElection maps them to the right
// election rather than silently falling back to the selected one.
type ArgCase = {
  label: string;
  tool: string;
  args: Record<string, unknown>;
  election?: string; // the SELECTED election (the wrong-fallback target)
  facts: Record<string, FactExp>;
};
const ARG_CASES: ArgCase[] = [
  {
    // the reported bug: "turnout in 2023" under the cloud model answered for the
    // selected 2026 election. A bare year must resolve to that year's election.
    label: 'turnout election:"2023" (selected 2026)',
    tool: "turnout",
    args: { election: "2023" },
    election: "2026_04_19",
    facts: { election: "2023", turnout: { num: 4051 } },
  },
  {
    // a loose hyphenated date the model might emit
    label: 'turnout election:"2024-06-09"',
    tool: "turnout",
    args: { election: "2024-06-09" },
    election: "2026_04_19",
    facts: { election: "2024" },
  },
  {
    // multi-election year + a month disambiguates to the right ballot
    label: 'turnout election:"2021_07" -> July 2021',
    tool: "turnout",
    args: { election: "2021_07" },
    election: "2026_04_19",
    facts: { election: "2021" },
  },
  {
    // bare 2021 (3 elections) -> combined comparison across the year's ballots
    // (a scalar metric fans out into a bar series), not the newest alone.
    label: 'turnout election:"2021" -> combined 2021',
    tool: "turnout",
    args: { election: "2021" },
    election: "2026_04_19",
    facts: { year: /2021/, elections_count: { num: 3 } },
  },
  {
    // national results keyed by a bare year (same resolver, different tool)
    label: 'nationalResults election:"2022"',
    tool: "nationalResults",
    args: { election: "2022" },
    election: "2026_04_19",
    facts: { election: "2022" },
  },
  {
    // bare multi-election year on a TABLE tool -> aligned comparison table
    // (party rows × one votes column per ballot)
    label: 'nationalResults election:"2024" -> combined 2024',
    tool: "nationalResults",
    args: { election: "2024" },
    election: "2026_04_19",
    facts: { year: /2024/, elections_count: { num: 2 } },
  },
  {
    // LOCAL: a bare year resolves to that year's cycle (2015 -> 2015_10_25_mi),
    // not the latest — mirrors resolveElection for the municipal data tree.
    label: 'localCouncilVoteShare cycle:"2015"',
    tool: "localCouncilVoteShare",
    args: { cycle: "2015" },
    facts: { cycle: "2015" },
  },
  {
    // a disambiguation pick re-arrives as an "ekatte:<code>" pin in the place arg
    // — the resolver decodes it straight to that one settlement (гр. Баня, the
    // town in Карлово), so the answer is unambiguous (no chooser).
    label: 'settlementResults place:"ekatte:02720" -> the town гр. Баня',
    tool: "settlementResults",
    args: { place: "ekatte:02720" },
    facts: { settlement: /Баня/, total_votes: /\d/ },
  },
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
    if (c.clarify) {
      const opts = env.clarify?.options ?? [];
      if (!env.clarify) {
        fail(c.q, "expected a disambiguation chooser, got none");
        continue;
      }
      if (opts.length < c.clarify.minOptions) {
        fail(
          c.q,
          `${opts.length} chooser options, expected >= ${c.clarify.minOptions}`,
        );
        continue;
      }
      // every option must re-run to a single, unambiguous answer (the pin works)
      const bad = await Promise.all(
        opts.map(async (o) => {
          try {
            const re = await runTool(o.tool, o.args, ctx);
            return re.clarify ? o.label : null;
          } catch (e) {
            return `${o.label} (threw: ${e instanceof Error ? e.message : e})`;
          }
        }),
      );
      const failed = bad.filter(Boolean);
      if (failed.length)
        fail(
          c.q,
          `chooser option(s) did not resolve cleanly: ${failed.join("; ")}`,
        );
      continue;
    }
    for (const [k, exp] of Object.entries(c.facts ?? {})) {
      if (!(k in env.facts) || !matchFact(env.facts[k], exp)) {
        fail(
          c.q,
          `fact "${k}"=${JSON.stringify(env.facts[k])} did not match ${exp}`,
        );
      }
    }
    if (c.geo === false) {
      if (env.geo)
        fail(c.q, `expected no map, got ${env.geo.level}/${env.geo.mode}`);
    } else if (c.geo) {
      const g = env.geo;
      if (!g) {
        fail(c.q, `expected a ${c.geo.level} map overlay, got none`);
      } else {
        if (g.level !== c.geo.level)
          fail(c.q, `geo level ${g.level}, expected ${c.geo.level}`);
        if (c.geo.mode && g.mode !== c.geo.mode)
          fail(c.q, `geo mode ${g.mode}, expected ${c.geo.mode}`);
        if (c.geo.joinKey && g.joinKey !== c.geo.joinKey)
          fail(c.q, `geo joinKey ${g.joinKey}, expected ${c.geo.joinKey}`);
        if (c.geo.minAreas != null && (g.areas?.length ?? 0) < c.geo.minAreas)
          fail(
            c.q,
            `geo ${g.areas?.length ?? 0} areas, expected >= ${c.geo.minAreas}`,
          );
      }
    }
    if (c.links) {
      const got = siteLinks(env)
        .map((l) => l.href.replace(SITE, ""))
        .sort();
      const want = [...c.links].sort();
      if (got.length !== want.length || got.some((h, i) => h !== want[i]))
        fail(
          c.q,
          `site links ${JSON.stringify(got)} did not match ${JSON.stringify(want)}`,
        );
    }
  }

  // LLM-router arg resolution (bare year / loose date), bypassing the keyword
  // router so we exercise resolveElection on the raw shape the model emits.
  for (const c of ARG_CASES) {
    const ctx: ToolContext = {
      lang: "bg",
      election: c.election ?? LATEST,
    };
    let env: Envelope;
    try {
      env = (await runTool(c.tool, c.args, ctx)) as Envelope;
    } catch (e) {
      fail(
        c.label,
        `tool threw: ${e instanceof Error ? e.message : String(e)}`,
      );
      continue;
    }
    for (const [k, exp] of Object.entries(c.facts)) {
      if (!(k in env.facts) || !matchFact(env.facts[k], exp)) {
        fail(
          c.label,
          `fact "${k}"=${JSON.stringify(env.facts[k])} did not match ${exp}`,
        );
      }
    }
  }

  // Starter chips + autocomplete suggestions promise the user a working query:
  // every one MUST route to a real tool in BOTH languages. A dead-end (route ->
  // null) would render a chip the user can click that then declines. This guards
  // the whole bank at once, so adding a starter/suggestion that doesn't route
  // fails here instead of shipping a broken chip.
  let promptChecks = 0;
  const POOL: { src: string; bg: string; en: string }[] = [
    ...STARTERS.map((s) => ({ src: "starter", ...s })),
    ...SUGGESTIONS.map((s) => ({ src: "suggestion", ...s })),
  ];
  for (const p of POOL) {
    for (const lang of ["bg", "en"] as const) {
      promptChecks += 1;
      const ctx: ToolContext = { lang, election: LATEST };
      if (!route(p[lang], ctx))
        fail(`${p.src} (${lang}): ${p[lang]}`, "routed to (none)");
    }
  }

  const total = CASES.length + ARG_CASES.length + promptChecks;
  const passed = total - failures;
  console.log(
    `\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — ${passed}/${total} regression cases (incl. ${promptChecks} starter/suggestion routing checks)`,
  );
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
