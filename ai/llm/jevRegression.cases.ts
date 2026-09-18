// Deterministic case corpora for the Jev (TypeSafe) regression suite.
//
// Two suites, kept SEPARATE because they measure different things and were
// conflated once already (docs/plans/jev-typesafe-eval-v1.md §3):
//
//   1. CLOSED-VOCAB ARGUMENTS — can Jev pick the right value for a tool
//      parameter whose value space is enumerable? Cases are DERIVED from the
//      real committed vocabularies (src/data/json/elections.json, regions.json,
//      and the party list of the latest election), not hand-authored, so the
//      corpus tracks the data and cannot go quietly stale.
//
//   2. NAME DISAMBIGUATION — given a candidate list a fuzzy search produced for
//      a misspelled name, can Jev pick the intended entity (or correctly refuse)?
//      Those cases live in a FROZEN fixture (jevRegression.fixtures/), captured
//      from the live search by jevRegression.capture.ts, because live candidates
//      drift with every corpus reload and a regression suite must not confuse
//      "retrieval changed" with "Jev got worse".
//
// Everything here is pure + offline: no network, no API key, no Postgres. That
// is what lets jevRegression.test.ts guard the corpus in CI for free.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

export type Lang = "en" | "bg";

/** One closed-vocabulary argument case: a question in both languages, the
 *  enumerated candidate set, and the value the question actually names. */
export type ArgCase = {
  id: string;
  /** Which tool parameter this stands for — election / oblast / party / scope. */
  param: string;
  /** What the question asks, per language (the Choice `instructions`). */
  instructions: Record<Lang, string>;
  /** The Choice `criteria` map: option key -> description (or null). */
  candidates: Record<string, string | null>;
  /** Key into `candidates`. The sentinel ("none"/"unspecified") for cases that
   *  deliberately name no value — the false-positive half of the suite. */
  expected: string;
  /** The user-facing question Jev evaluates as `state`. */
  question: Record<Lang, string>;
};

// ---- real vocabularies (committed data, so the corpus is reproducible) -----

type ElectionRow = { name: string };
type RegionRow = { oblast: string; name: string; name_en: string };
type PartyRow = { nickName?: string };

const readJson = <T>(rel: string): T =>
  JSON.parse(readFileSync(join(ROOT, rel), "utf8")) as T;

const BG_MONTHS = [
  "януари",
  "февруари",
  "март",
  "април",
  "май",
  "юни",
  "юли",
  "август",
  "септември",
  "октомври",
  "ноември",
  "декември",
];
const EN_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const monthOf = (electionName: string, lang: Lang): string => {
  const m = Number(electionName.slice(5, 7));
  return (lang === "bg" ? BG_MONTHS : EN_MONTHS)[m - 1] ?? "";
};
const yearOf = (electionName: string): string => electionName.slice(0, 4);

/** Deterministic, evenly-spread subsample — never Math.random, so a re-run
 *  reproduces the same corpus (and so does CI). */
const spread = <T>(xs: T[], n?: number): T[] => {
  if (!n || n >= xs.length) return xs;
  const step = xs.length / n;
  return Array.from({ length: n }, (_, i) => xs[Math.floor(i * step)]);
};

// ---- suite 1: closed-vocabulary arguments ---------------------------------

const electionCases = (): ArgCase[] => {
  const elections = readJson<ElectionRow[]>("src/data/json/elections.json").map(
    (e) => e.name,
  );
  // Every election is a candidate; the question names one of them.
  const candidates: Record<string, string | null> = {};
  for (const name of elections) {
    candidates[name] =
      `The parliamentary election held on ${name.replace(/_/g, "-")}.`;
  }
  candidates.unspecified = "The question does not name a particular election.";

  const cases: ArgCase[] = elections.map((name) => ({
    id: `arg_election_${name}`,
    param: "election",
    instructions: {
      en: "Which election does the question ask about?",
      bg: "За кои избори пита въпросът?",
    },
    candidates,
    expected: name,
    question: {
      en: `What were the results of the ${monthOf(name, "en")} ${yearOf(name)} parliamentary election?`,
      bg: `Какви бяха резултатите от парламентарните избори през ${monthOf(name, "bg")} ${yearOf(name)}?`,
    },
  }));

  // False-positive probes: a question about elections in general names none.
  cases.push({
    id: "arg_election_none_turnout_trend",
    param: "election",
    instructions: {
      en: "Which election does the question ask about?",
      bg: "За кои избори пита въпросът?",
    },
    candidates,
    expected: "unspecified",
    question: {
      en: "How has voter turnout changed across all elections?",
      bg: "Как се променя избирателната активност през всички избори?",
    },
  });
  return cases;
};

const oblastCases = (limit = 20): ArgCase[] => {
  // ⚠️ regions.json carries BOTH the province and its seat city under related
  // codes — `PDV` is "обл. Пловдив" (province) while `PDV-00` is "Пловдив"
  // (the city). The question template below names a REGION, so only the
  // province rows are answerable; including the `-NN` city variants put an
  // unanswerable case in the corpus and scored Jev wrong for picking the
  // province, which was the correct reading. Suite bug, not a model failure —
  // see docs/plans/jev-typesafe-eval-v1.md §7.
  const regions = readJson<RegionRow[]>("src/data/json/regions.json").filter(
    (r) => !/-\d+$/.test(r.oblast),
  );
  const candidates: Record<string, string | null> = {};
  for (const r of regions) candidates[r.oblast] = `${r.name} (${r.name_en})`;
  candidates.none = "The question does not name a particular region.";

  const cases: ArgCase[] = spread(regions, limit).map((r) => ({
    id: `arg_oblast_${r.oblast}`,
    param: "oblast",
    instructions: {
      en: "Which region (oblast) does the question name?",
      bg: "Коя област назовава въпросът?",
    },
    candidates,
    expected: r.oblast,
    question: {
      en: `Which party won each municipality in the ${r.name_en} region?`,
      bg: `Коя партия спечели във всяка община в област ${r.name}?`,
    },
  }));

  cases.push({
    id: "arg_oblast_none_unemployment",
    param: "oblast",
    instructions: {
      en: "Which region (oblast) does the question name?",
      bg: "Коя област назовава въпросът?",
    },
    candidates,
    expected: "none",
    question: {
      en: "Which municipalities have the highest unemployment?",
      bg: "Кои общини са с най-висока безработица?",
    },
  });
  return cases;
};

const partyCases = (limit = 20): ArgCase[] => {
  const elections = readJson<
    { name: string; results?: { votes?: PartyRow[] } }[]
  >("src/data/json/elections.json");
  const votes = elections[0]?.results?.votes ?? [];
  const parties = [
    ...new Set(
      votes.map((v) => (v.nickName ?? "").trim()).filter((n) => n.length >= 2),
    ),
  ].sort();

  const candidates: Record<string, string | null> = {};
  for (const p of parties) candidates[p] = null; // the abbreviation IS the label
  candidates.none = "The question does not name a particular party.";

  const cases: ArgCase[] = spread(parties, limit).map((p) => ({
    id: `arg_party_${p.replace(/[^\p{L}\p{N}]+/gu, "_")}`,
    param: "party",
    instructions: {
      en: "Which party does the question name?",
      bg: "Коя партия назовава въпросът?",
    },
    candidates,
    expected: p,
    question: {
      en: `How many votes did ${p} get in the last election?`,
      bg: `Колко гласа получи ${p} на последните избори?`,
    },
  }));

  cases.push({
    id: "arg_party_none_turnout",
    param: "party",
    instructions: {
      en: "Which party does the question name?",
      bg: "Коя партия назовава въпросът?",
    },
    candidates,
    expected: "none",
    question: {
      en: "What was the overall voter turnout?",
      bg: "Каква беше общата избирателна активност?",
    },
  });
  return cases;
};

// The `?pscope` contract (CLAUDE.md "URL contract"): ns = the selected
// parliament's window, all = the full corpus, y:<year> = one calendar year.
const scopeCases = (): ArgCase[] => {
  const candidates: Record<string, string | null> = {
    current_parliament: "Only the currently selected parliament's time window.",
    all: "The whole corpus, every year on record.",
    one_year: "One specific calendar year.",
  };
  const mk = (
    id: string,
    expected: string,
    en: string,
    bg: string,
  ): ArgCase => ({
    id: `arg_scope_${id}`,
    param: "scope",
    instructions: {
      en: "What time scope does the question ask for?",
      bg: "За какъв времеви обхват пита въпросът?",
    },
    candidates,
    expected,
    question: { en, bg },
  });
  return [
    mk(
      "all_years",
      "all",
      "Show procurement contracts across all years, not just this parliament.",
      "Покажи обществените поръчки за всички години, не само за този парламент.",
    ),
    mk(
      "all_history",
      "all",
      "Give me the entire history of public contracts on record.",
      "Дай ми цялата налична история на обществените поръчки.",
    ),
    mk(
      "one_year_2024",
      "one_year",
      "How much was spent on public contracts in 2024?",
      "Колко са похарчени по обществени поръчки през 2024 г.?",
    ),
    mk(
      "one_year_2022",
      "one_year",
      "Show me only the 2022 contracts.",
      "Покажи ми само договорите от 2022 г.",
    ),
    mk(
      "current_parliament",
      "current_parliament",
      "What has been awarded under the current parliament?",
      "Какво е възложено при настоящия парламент?",
    ),
  ];
};

export const closedVocabCases = (): ArgCase[] => [
  ...electionCases(),
  ...oblastCases(),
  ...partyCases(),
  ...scopeCases(),
];

// ---- suite 2: name disambiguation (frozen fixture) ------------------------

/** One disambiguation case, captured from the live fuzzy search and frozen.
 *  `klass` splits the two things this suite measures, which must never be
 *  averaged into one number:
 *    present — the intended entity IS among the candidates → expected is its key
 *    absent  — retrieval missed it → expected is `none_of_these`, and a wrong
 *              confident pick here is the safety-critical failure mode. */
export type DisambigCase = {
  id: string;
  kind: "person" | "company";
  klass: "present" | "absent";
  /** The correctly-spelled name whose #1 search hit fixed the ground truth. */
  anchorName: string;
  /** The typo actually fed to the fuzzy search and named in the question. */
  typoQuery: string;
  typoKind: string;
  /** Real candidates the live search returned for `typoQuery`, frozen. */
  candidates: Record<string, string>;
  expected: string;
  question: Record<Lang, string>;
  capturedAt: string;
};

export type DisambigFixture = {
  capturedAt: string;
  source: string;
  cases: DisambigCase[];
};

export const FIXTURE_PATH = join(
  HERE,
  "jevRegression.fixtures",
  "disambiguation.json",
);

export const loadDisambigFixture = (): DisambigFixture | null => {
  try {
    return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as DisambigFixture;
  } catch {
    return null;
  }
};

export const NONE_OF_THESE = "none_of_these";

// ---- shared typo generators (also used by the capture step) ---------------
// Deterministic, and deliberately the SAME three shapes measured in
// docs/plans/jev-typesafe-eval-v1.md §4, so suite results stay comparable to
// the retrieval-threshold findings.

export const dropLetter = (name: string): string => {
  const words = name.split(" ");
  if (words.length < 2) return name;
  const target = words[1];
  const idx = Math.floor(target.length / 2);
  words[1] = target.slice(0, idx) + target.slice(idx + 1);
  return words.join(" ");
};

export const transposeLetters = (name: string): string => {
  const words = name.split(" ");
  const wi = words.length - 1;
  const chars = [...words[wi]];
  const idx = Math.floor(chars.length / 2);
  if (idx + 1 >= chars.length) return name;
  [chars[idx], chars[idx + 1]] = [chars[idx + 1], chars[idx]];
  words[wi] = chars.join("");
  return words.join(" ");
};

export const duplicateLetter = (name: string): string => {
  const words = name.split(" ");
  const wi = words.length - 1;
  const chars = [...words[wi]];
  const idx = Math.floor(chars.length / 2);
  chars.splice(idx, 0, chars[idx]);
  words[wi] = chars.join("");
  return words.join(" ");
};

export const TYPO_KINDS: { kind: string; fn: (s: string) => string }[] = [
  { kind: "drop_letter", fn: dropLetter },
  { kind: "transpose_letters", fn: transposeLetters },
  { kind: "duplicate_letter", fn: duplicateLetter },
];

/** Question templates the captured cases are rendered with. Indexed
 *  deterministically by case position so the corpus varies phrasing without
 *  randomness. */
export const PERSON_TEMPLATES: {
  en: (n: string) => string;
  bg: (n: string) => string;
}[] = [
  {
    en: (n) => `What are the declared assets of ${n}?`,
    bg: (n) => `Какви са декларираните активи на ${n}?`,
  },
  {
    en: (n) => `Show me the declarations filed by ${n}.`,
    bg: (n) => `Покажи ми декларациите, подадени от ${n}.`,
  },
  {
    en: (n) => `Which companies is ${n} connected to?`,
    bg: (n) => `С кои фирми е свързан ${n}?`,
  },
];

export const COMPANY_TEMPLATES: {
  en: (n: string) => string;
  bg: (n: string) => string;
}[] = [
  {
    en: (n) => `Show me the public contracts awarded to ${n}.`,
    bg: (n) => `Покажи ми обществените поръчки, спечелени от ${n}.`,
  },
  {
    en: (n) => `How much public money has ${n} received?`,
    bg: (n) => `Колко публични средства е получила ${n}?`,
  },
];
