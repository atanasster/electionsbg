// TypeSafe (Jev) adapter + CLI for the tool-routing eval.
//
//   TYPESAFE_API_KEY=... npx tsx ai/llm/fcEval.jev.ts            # full registry
//   TYPESAFE_API_KEY=... npx tsx ai/llm/fcEval.jev.ts --k=5      # retrieved candidate set
//
// WHY THIS FILE IS NOT ANOTHER `CompleteFn` ADAPTER (unlike fcEval.cloud.ts):
// Jev has no free-text "complete a chat turn" step. It answers one or more
// TYPED questions (Choice/Score/Noul) against a `state` directly and returns
// a probability distribution + a calibrated `confidence` + exact token usage
// per call. Squeezing that into `CompleteFn`'s raw-string return (designed for
// models that emit JSON prose to be parsed) would throw away the exact numbers
// this eval exists to report — so this harness calls POST /v1/systemone
// directly and keeps the typed response.
//
// TOOL SELECTION is modeled as ONE Choice question per case: `criteria` is the
// tool catalogue (name -> description), plus a "no_tool" option so Function
// Relevance Detection (BFCL's "call nothing") is answerable at all — a Choice
// MUST pick one of its listed options, it cannot abstain on its own.
//
// ARGUMENT / SLOT-FILLING is a SEPARATE, narrower probe (JEV_ARG_CASES below).
// Jev's only answer types are Choice (pick from an enumerated set), Score
// (place on an ordinal rubric) and Noul (yes/no) — see
// docs.typesafe.ai/primitives/choice. There is no primitive that GENERATES a
// free-text value. So an open-vocabulary argument — an arbitrary person's full
// name across ~134k people, a company EIK, a free-text search string, an
// arbitrary ISO date — CANNOT be produced by Jev at all; only a value drawn
// from a candidate list you already enumerated can. JEV_ARG_CASES therefore
// only covers the CLOSED-vocabulary args real tools actually have (election
// window, party, oblast) — it is the ceiling of what Jev can do for slot
// filling, not a simulation of extraction it structurally cannot perform.

import { registrySuite } from "./fcEval.registry";
// The prompt shape is SHARED with the production router (ai/llm/jev.ts) rather
// than restated here: this harness is what produced the accuracy figure that
// lane's header cites, and the claim only holds while the two ask the same way.
import {
  NO_TOOL,
  TOOL_INSTRUCTIONS,
  toolOptionText,
  withNoTool,
} from "./jevPrompt";
import {
  candidateTools,
  type CaseScore,
  type FcCase,
  type FcReport,
  type FcTool,
} from "./fcEval";

export { NO_TOOL };

export const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const MODEL = "jev-latest";
// $ per input token, from docs.typesafe.ai/models (Jev 1.13: $42 / Btok). Output
// tokens are billed at $0 (docs: "Output tokens are free").
export const INPUT_PRICE_PER_TOKEN = 42 / 1_000_000_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};

export type SystemOneResponse = {
  model: string;
  answers: Record<string, ChoiceAnswer>;
  usage: { input_tokens: number; output_tokens: number };
};

type CallOutcome = {
  res: SystemOneResponse | null;
  latencyMs: number;
  error?: string;
};

// POST one systemone request, retrying 429/529 with backoff per the docs'
// "Handling rate limits" guidance (the HTTP path — no SDK dependency here).
export const callSystemOne = async (
  apiKey: string,
  body: unknown,
  opts: { maxRetries?: number } = {},
): Promise<CallOutcome> => {
  const maxRetries = opts.maxRetries ?? 6;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const start = performance.now();
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const latencyMs = performance.now() - start;
      if (res.status === 429 || res.status === 529) {
        const wait = 2000 * (attempt + 1);
        console.error(`  [${res.status}] backing off ${wait / 1000}s…`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        return {
          res: null,
          latencyMs,
          error: `HTTP ${res.status}: ${t.slice(0, 200)}`,
        };
      }
      const data = (await res.json()) as SystemOneResponse;
      return { res: data, latencyMs };
    } catch (e) {
      const wait = 2000 * (attempt + 1);
      console.error(
        `  [fetch error] ${String(e).slice(0, 120)} — retry in ${wait / 1000}s`,
      );
      await sleep(wait);
    }
  }
  return { res: null, latencyMs: 0, error: "gave up after retries" };
};

// ---- 1. tool selection ------------------------------------------------

const toolChoiceCriteria = (tools: FcTool[]): Record<string, string> => {
  const criteria: Record<string, string> = {};
  for (const t of tools)
    criteria[t.name] = toolOptionText(
      t.description,
      Object.keys(t.parameters.properties),
    );
  return withNoTool(criteria);
};

export type ToolSelectionRow = {
  id: string;
  lang: "en" | "bg";
  domain?: string;
  expectedTool: string | null; // null = irrelevance case
  gotTool: string | null;
  confidence: number | null;
  probOfExpected: number | null; // mass Jev put on the RIGHT answer even when it lost
  toolOk: boolean;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  candidateCount: number;
  error?: string;
};

export const runJevToolSelection = async (
  apiKey: string,
  opts: {
    tools?: FcTool[];
    cases?: FcCase[];
    k?: number; // retrieved-candidate-set size; omit for the full registry
    concurrency?: number;
  } = {},
): Promise<ToolSelectionRow[]> => {
  const suite = registrySuite();
  const allTools = opts.tools ?? suite.tools;
  const cases = opts.cases ?? suite.cases;
  const concurrency = Math.max(1, opts.concurrency ?? 8);
  const pick = opts.k
    ? (c: FcCase) => candidateTools(c, allTools, opts.k!)
    : () => allTools;

  const tasks: { c: FcCase; lang: "en" | "bg" }[] = [];
  for (const c of cases)
    for (const lang of ["en", "bg"] as const) tasks.push({ c, lang });
  const rows: ToolSelectionRow[] = new Array(tasks.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= tasks.length) return;
      const { c, lang } = tasks[i];
      const toolsForCase = pick(c);
      const criteria = toolChoiceCriteria(toolsForCase);
      const expected = c.tool ?? NO_TOOL;
      const body = {
        state: c[lang],
        model: MODEL,
        questions: {
          tool: {
            type: "choice",
            instructions: TOOL_INSTRUCTIONS,
            criteria,
          },
        },
      };
      const { res, latencyMs, error } = await callSystemOne(apiKey, body);
      const answer = res?.answers?.tool;
      rows[i] = {
        id: c.id,
        lang,
        domain: c.domain,
        expectedTool: c.tool,
        gotTool: answer?.choice ?? null,
        confidence: answer?.confidence ?? null,
        probOfExpected: answer?.probabilities?.[expected] ?? null,
        toolOk: answer?.choice === expected,
        inputTokens: res?.usage?.input_tokens ?? 0,
        outputTokens: res?.usage?.output_tokens ?? 0,
        latencyMs,
        candidateCount: Object.keys(criteria).length,
        error,
      };
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length || 1) }, worker),
  );
  return rows;
};

// ---- 2. argument selection — CLOSED-vocabulary args only ----------------
// A curated probe, not derived from the registry: each case names a real tool
// param whose value space IS enumerable in this codebase (an election window,
// a party, an oblast), with the FULL real candidate set as Choice options —
// the ceiling of what Jev can do for slot filling. Open-vocabulary args
// (person name, EIK, free-text search, arbitrary date) have no equivalent
// case here on purpose: there is no candidate list to enumerate them from.
export type ArgCase = {
  id: string;
  question: string;
  en: string;
  bg: string;
  candidates: Record<string, string | null>;
  expected: string; // key into candidates
};

export const JEV_ARG_CASES: ArgCase[] = [
  {
    id: "arg_election_window",
    question: "Which election is the user asking about?",
    en: "How did GERB do in the last election?",
    bg: "Как се представи ГЕРБ на последните избори?",
    candidates: {
      "2026_04_19": "The most recent parliamentary election (April 2026).",
      "2024_10_27": "The October 2024 parliamentary election.",
      "2023_04_02": "The April 2023 parliamentary election.",
      all: "Every election in the corpus, not one in particular.",
    },
    expected: "2026_04_19",
  },
  {
    id: "arg_election_named_year",
    question: "Which election year is named?",
    en: "Show the state budget for 2024.",
    bg: "Покажи държавния бюджет за 2024.",
    candidates: {
      "2023": null,
      "2024": null,
      "2025": null,
      "2026": null,
      unspecified: "No year is named.",
    },
    expected: "2024",
  },
  {
    id: "arg_party_gerb",
    question: "Which party is named?",
    en: "What are the declared assets of GERB's MPs?",
    bg: "Какво е декларираното имущество на депутатите от ГЕРБ?",
    candidates: {
      gerb: "ГЕРБ",
      pp_db: "ПП-ДБ",
      dps: "ДПС",
      bsp: "БСП",
      vazrazhdane: "Възраждане",
      none: "No party is named.",
    },
    expected: "gerb",
  },
  {
    id: "arg_oblast_plovdiv",
    question: "Which oblast (region) is named?",
    en: "Which party won each municipality in the Plovdiv region?",
    bg: "Коя партия печели всяка община в област Пловдив?",
    candidates: {
      sofia: "София",
      plovdiv: "Пловдив",
      varna: "Варна",
      burgas: "Бургас",
      none: "No region is named.",
    },
    expected: "plovdiv",
  },
  {
    id: "arg_scope_all_years",
    question: "What time scope does the user want?",
    en: "Show procurement contracts across all years, not just this parliament.",
    bg: "Покажи обществените поръчки за всички години, не само този парламент.",
    candidates: {
      current_parliament: "The current parliamentary term only.",
      all: "The full corpus, every year.",
      one_year: "One specific calendar year.",
    },
    expected: "all",
  },
  {
    id: "arg_no_param_named",
    question: "Which municipality is named?",
    en: "Which municipalities have the highest unemployment?",
    bg: "Кои общини са с най-висока безработица?",
    candidates: {
      sofia: "София",
      plovdiv: "Пловдив",
      varna: "Варна",
      none: "No specific municipality is named — the question is about all of them.",
    },
    expected: "none",
  },
];

export type ArgSelectionRow = {
  id: string;
  lang: "en" | "bg";
  expected: string;
  got: string | null;
  confidence: number | null;
  ok: boolean;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  error?: string;
};

export const runJevArgSelection = async (
  apiKey: string,
  cases: ArgCase[] = JEV_ARG_CASES,
  concurrency = 8,
): Promise<ArgSelectionRow[]> => {
  const tasks: { c: ArgCase; lang: "en" | "bg" }[] = [];
  for (const c of cases)
    for (const lang of ["en", "bg"] as const) tasks.push({ c, lang });
  const rows: ArgSelectionRow[] = new Array(tasks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= tasks.length) return;
      const { c, lang } = tasks[i];
      const body = {
        state: c[lang],
        model: MODEL,
        questions: {
          arg: {
            type: "choice",
            instructions: c.question,
            criteria: c.candidates,
          },
        },
      };
      const { res, latencyMs, error } = await callSystemOne(apiKey, body);
      const answer = res?.answers?.arg;
      rows[i] = {
        id: c.id,
        lang,
        expected: c.expected,
        got: answer?.choice ?? null,
        confidence: answer?.confidence ?? null,
        ok: answer?.choice === c.expected,
        inputTokens: res?.usage?.input_tokens ?? 0,
        outputTokens: res?.usage?.output_tokens ?? 0,
        latencyMs,
        error,
      };
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length || 1) }, worker),
  );
  return rows;
};

// ---- 3. name-mention gate (Noul) — cheap "is a lookup even worth it" signal
// This does NOT extract a name (Noul returns a scalar, never a span). It only
// answers whether the message names a SPECIFIC person or company at all, as a
// gate before running the (already cheap) trigram/fuzzy search. Misspelling
// should not move this answer much — the point is category detection, not
// spelling — which is exactly what the paired clean/misspelled cases probe.
export type NameGateCase = {
  id: string;
  en: string;
  bg: string;
  expected: boolean; // does the message name a specific person/company?
};

export const JEV_NAME_GATE_CASES: NameGateCase[] = [
  {
    id: "gate_person_clean",
    en: "What are the declared assets of Asen Vasilev?",
    bg: "Какви са декларираните активи на Асен Василев?",
    expected: true,
  },
  {
    id: "gate_person_misspelled",
    en: "What are the declared assets of Asen Vasiliev?",
    bg: "Какви са декларираните активи на Асен Василиев?",
    expected: true,
  },
  {
    id: "gate_company_misspelled",
    en: "Show me the government contracts for Lukoyl.",
    bg: "Покажи ми държавните договори на Лукоил.",
    expected: true,
  },
  {
    id: "gate_no_name_party",
    en: "Who are the MPs from PP?",
    bg: "Кои са депутатите от ПП?",
    expected: false, // a party is named, not a specific person/company
  },
  {
    id: "gate_no_name_generic",
    en: "Which municipalities have the highest unemployment?",
    bg: "Кои общини са с най-висока безработица?",
    expected: false,
  },
  {
    id: "gate_no_name_place",
    en: "What is the weather like in Sofia today?",
    bg: "Какво е времето в София днес?",
    expected: false, // Sofia is a place, not a person/company
  },
];

export type NameGateRow = {
  id: string;
  lang: "en" | "bg";
  expected: boolean;
  noul: number | null;
  ok: boolean; // (noul >= 0.5) === expected
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  error?: string;
};

export const runJevNameGate = async (
  apiKey: string,
  cases: NameGateCase[] = JEV_NAME_GATE_CASES,
  concurrency = 8,
): Promise<NameGateRow[]> => {
  const tasks: { c: NameGateCase; lang: "en" | "bg" }[] = [];
  for (const c of cases)
    for (const lang of ["en", "bg"] as const) tasks.push({ c, lang });
  const rows: NameGateRow[] = new Array(tasks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= tasks.length) return;
      const { c, lang } = tasks[i];
      const body = {
        state: c[lang],
        model: MODEL,
        questions: {
          names_someone: {
            type: "noul",
            instructions:
              "Does the message name a SPECIFIC person or company (by name), as opposed to a party, place, or generic category?",
          },
        },
      };
      const { res, latencyMs, error } = await callSystemOne(apiKey, body);
      const noul =
        (res?.answers?.names_someone as unknown as { noul?: number })?.noul ??
        null;
      rows[i] = {
        id: c.id,
        lang,
        expected: c.expected,
        noul,
        ok: noul != null && noul >= 0.5 === c.expected,
        inputTokens: res?.usage?.input_tokens ?? 0,
        outputTokens: res?.usage?.output_tokens ?? 0,
        latencyMs,
        error,
      };
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length || 1) }, worker),
  );
  return rows;
};

// ---- 4. name disambiguation (Choice) — the part that actually earns its
// keep. Simulates the two-stage architecture: YOUR trigram/fuzzy search
// already produced a short candidate list tolerant of the misspelling (that's
// its job); Jev's job is to pick which candidate (if any) the sentence means,
// using context a pure string-distance match can't see. `none_of_these` must
// always be an option — a fuzzy search on a name absent from the registry
// still returns near-miss candidates, and the disambiguator has to be able to
// say none of them is right rather than being forced to pick one.
export type NameDisambigCase = {
  id: string;
  en: string;
  bg: string;
  candidates: Record<string, string | null>;
  expected: string;
};

export const JEV_NAME_DISAMBIG_CASES: NameDisambigCase[] = [
  {
    id: "disambig_mp_misspelled",
    en: "What are the declared assets of Asen Vasiliev?", // typo: -iev, not -ev
    bg: "Какви са декларираните активи на Асен Василиев?",
    candidates: {
      asen_vasilev: "Асен Василев — MP, former Deputy PM and Finance Minister.",
      angel_vasilev: "Ангел Василев — a different MP, similar surname.",
      asen_krastev: "Асен Кръстев — a different MP, same first name.",
      none_of_these: "None of the above is who the message means.",
    },
    expected: "asen_vasilev",
  },
  {
    id: "disambig_company_misspelled",
    en: "Show me the government contracts for Lukoyl.", // typo: transliteration variant
    bg: "Покажи ми държавните договори на Лукоил.", // typo: Лукоил vs Лукойл
    candidates: {
      lukoil_bulgaria: "Лукойл България — the oil refiner/distributor.",
      lufthansa: "Луфтханза — an airline, similar sound in Cyrillic.",
      nord_ltd: "Норд ЕООД — an unrelated small trading company.",
      none_of_these: "None of the above is who the message means.",
    },
    expected: "lukoil_bulgaria",
  },
  {
    id: "disambig_no_real_match",
    en: "What are the declared assets of Zhoro Petkov?", // not a real registered MP
    bg: "Какви са декларираните активи на Жоро Петков?",
    candidates: {
      kiril_petkov: "Кирил Петков — MP, former Prime Minister.",
      petar_petkov: "Петър Петков — a different MP.",
      none_of_these: "None of the above is who the message means.",
    },
    expected: "none_of_these",
  },
  {
    id: "disambig_first_name_only",
    en: "What did Kiril say about the budget?", // first name only, well-known figure
    bg: "Какво каза Кирил за бюджета?",
    candidates: {
      kiril_petkov:
        "Кирил Петков — MP, former Prime Minister, prominent in budget debates.",
      kiril_dimitrov: "Кирил Димитров — a low-profile municipal councillor.",
      none_of_these: "None of the above is who the message means.",
    },
    expected: "kiril_petkov",
  },
];

export type NameDisambigRow = {
  id: string;
  lang: "en" | "bg";
  expected: string;
  got: string | null;
  confidence: number | null;
  ok: boolean;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  error?: string;
};

export const runJevNameDisambiguation = async (
  apiKey: string,
  cases: NameDisambigCase[] = JEV_NAME_DISAMBIG_CASES,
  concurrency = 8,
): Promise<NameDisambigRow[]> => {
  const tasks: { c: NameDisambigCase; lang: "en" | "bg" }[] = [];
  for (const c of cases)
    for (const lang of ["en", "bg"] as const) tasks.push({ c, lang });
  const rows: NameDisambigRow[] = new Array(tasks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= tasks.length) return;
      const { c, lang } = tasks[i];
      const body = {
        state: c[lang],
        model: MODEL,
        questions: {
          who: {
            type: "choice",
            instructions:
              "Which candidate (if any) is the specific person or company the message is asking about? These candidates came from a fuzzy/trigram name search against the message, so some are near-miss spellings or unrelated near-homophones — use the surrounding sentence, not just string similarity, to decide.",
            criteria: c.candidates,
          },
        },
      };
      const { res, latencyMs, error } = await callSystemOne(apiKey, body);
      const answer = res?.answers?.who;
      rows[i] = {
        id: c.id,
        lang,
        expected: c.expected,
        got: answer?.choice ?? null,
        confidence: answer?.confidence ?? null,
        ok: answer?.choice === c.expected,
        inputTokens: res?.usage?.input_tokens ?? 0,
        outputTokens: res?.usage?.output_tokens ?? 0,
        latencyMs,
        error,
      };
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length || 1) }, worker),
  );
  return rows;
};

// ---- convert to the shared FcReport shape (for fcEval.artifact.ts) --------
// Lets a Jev run slot into the same `entry()` builder as the CompleteFn-based
// cloud adapters. `argsOk`/`argScored` are always false here — this run only
// scores tool SELECTION, same as the registry-derived cloud rows; the
// separate arg/gate/disambiguation probes are reported independently, not
// folded into this shape.
export const jevRowsToFcReport = (rows: ToolSelectionRow[]): FcReport => {
  const scores: CaseScore[] = rows.map((r) => ({
    id: r.id,
    lang: r.lang,
    domain: r.domain,
    expectedTool: r.expectedTool,
    gotTool: r.gotTool,
    jsonValid: !r.error,
    toolOk: r.toolOk,
    argsOk: false,
    argScored: false,
    raw: r.gotTool ?? "",
  }));
  const perLang = (lang: "en" | "bg") => {
    const s = scores.filter((x) => x.lang === lang);
    const relevant = s.filter((x) => x.expectedTool !== null);
    const irr = s.filter((x) => x.expectedTool === null);
    return {
      lang,
      n: s.length,
      toolAcc: s.length ? s.filter((x) => x.toolOk).length / s.length : 0,
      argAcc: null,
      jsonValidRate: relevant.length
        ? relevant.filter((x) => x.jsonValid).length / relevant.length
        : 0,
      irrelevanceAcc: irr.length
        ? irr.filter((x) => x.toolOk).length / irr.length
        : null,
    };
  };
  const en = perLang("en");
  const bg = perLang("bg");
  return {
    perLang: { en, bg },
    degradation: { toolAcc: en.toolAcc - bg.toolAcc, argAcc: null },
    scores,
  };
};

// Summary stats (latency/tokens/cost/confidence calibration) that don't fit
// FcReport's shape — kept alongside it so the artifact can attach them to the
// Jev entry without inventing new fields on the shared type other adapters use.
export type JevRunStats = {
  meanLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  meanInputTokens: number;
  meanOutputTokens: number;
  costPerCallUsd: number;
  meanConfidenceCorrect: number;
  meanConfidenceWrong: number;
  candidateCount: number;
};

export const jevRunStats = (rows: ToolSelectionRow[]): JevRunStats => {
  const ok = rows.filter((r) => !r.error);
  const lat = ok.map((r) => r.latencyMs);
  const sorted = [...lat].sort((a, b) => a - b);
  const pct = (p: number) =>
    sorted.length
      ? sorted[
          Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
        ]
      : 0;
  const withExpected = ok.filter(
    (r) => r.expectedTool !== null && r.confidence != null,
  );
  const rightConf = withExpected
    .filter((r) => r.toolOk)
    .map((r) => r.confidence!);
  const wrongConf = withExpected
    .filter((r) => !r.toolOk)
    .map((r) => r.confidence!);
  const mean = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  return {
    meanLatencyMs: mean(lat),
    p50LatencyMs: pct(50),
    p95LatencyMs: pct(95),
    meanInputTokens: mean(ok.map((r) => r.inputTokens)),
    meanOutputTokens: mean(ok.map((r) => r.outputTokens)),
    costPerCallUsd: mean(ok.map((r) => r.inputTokens)) * INPUT_PRICE_PER_TOKEN,
    meanConfidenceCorrect: mean(rightConf),
    meanConfidenceWrong: mean(wrongConf),
    candidateCount: ok[0]?.candidateCount ?? 0,
  };
};

// ---- reporting ------------------------------------------------------------

const pct = (x: number) => `${Math.round(x * 100)}%`;
const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const percentile = (xs: number[], p: number): number => {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[idx];
};

const reportToolSelection = (rows: ToolSelectionRow[], label: string): void => {
  console.log(`\n=== ${label} ===`);
  const errored = rows.filter((r) => r.error);
  if (errored.length) {
    console.log(
      `  ${errored.length}/${rows.length} calls errored (excluded below):`,
    );
    for (const e of errored.slice(0, 5))
      console.log(`    ${e.id}/${e.lang}: ${e.error}`);
  }
  const ok = rows.filter((r) => !r.error);
  for (const lang of ["en", "bg"] as const) {
    const s = ok.filter((r) => r.lang === lang);
    const relevant = s.filter((r) => r.expectedTool !== null);
    const irr = s.filter((r) => r.expectedTool === null);
    const toolAcc = s.length ? s.filter((r) => r.toolOk).length / s.length : 0;
    const irrAcc = irr.length
      ? irr.filter((r) => r.toolOk).length / irr.length
      : null;
    const lat = s.map((r) => r.latencyMs);
    const inTok = s.map((r) => r.inputTokens);
    const outTok = s.map((r) => r.outputTokens);
    console.log(
      `  ${lang.toUpperCase()}  tool ${pct(toolAcc).padStart(4)} (${s.filter((r) => r.toolOk).length}/${s.length})` +
        `  irrelevance ${irrAcc == null ? " n/a" : pct(irrAcc)}` +
        `  relevant-only ${pct(relevant.length ? relevant.filter((r) => r.toolOk).length / relevant.length : 0)}`,
    );
    console.log(
      `       latency mean ${mean(lat).toFixed(0)}ms  p50 ${percentile(lat, 50).toFixed(0)}ms  p95 ${percentile(lat, 95).toFixed(0)}ms`,
    );
    console.log(
      `       tokens  in mean ${mean(inTok).toFixed(0)}  out mean ${mean(outTok).toFixed(1)}  ` +
        `cost/call $${(mean(inTok) * INPUT_PRICE_PER_TOKEN).toFixed(6)}`,
    );
  }
  // Confidence calibration: bucket by confidence, report accuracy per bucket.
  const withConf = ok.filter(
    (r) => r.confidence != null && r.expectedTool !== null,
  );
  const buckets: [number, number][] = [
    [0, 0.5],
    [0.5, 0.7],
    [0.7, 0.9],
    [0.9, 1.01],
  ];
  console.log("  confidence calibration (relevant cases only):");
  for (const [lo, hi] of buckets) {
    const b = withConf.filter((r) => r.confidence! >= lo && r.confidence! < hi);
    if (!b.length) continue;
    console.log(
      `    [${lo.toFixed(1)}-${hi > 1 ? "1.0" : hi.toFixed(1)}) n=${b.length.toString().padStart(3)}  acc=${pct(b.filter((r) => r.toolOk).length / b.length)}`,
    );
  }
  const rightConf = withConf.filter((r) => r.toolOk).map((r) => r.confidence!);
  const wrongConf = withConf.filter((r) => !r.toolOk).map((r) => r.confidence!);
  console.log(
    `  mean confidence — correct: ${mean(rightConf).toFixed(3)} (n=${rightConf.length})  wrong: ${mean(wrongConf).toFixed(3)} (n=${wrongConf.length})`,
  );
};

const reportArgSelection = (rows: ArgSelectionRow[]): void => {
  console.log(
    `\n=== Argument (slot-filling) selection — closed vocabularies only ===`,
  );
  for (const lang of ["en", "bg"] as const) {
    const s = rows.filter((r) => r.lang === lang && !r.error);
    const acc = s.length ? s.filter((r) => r.ok).length / s.length : 0;
    console.log(
      `  ${lang.toUpperCase()}  arg-value acc ${pct(acc)} (${s.filter((r) => r.ok).length}/${s.length})`,
    );
  }
  for (const r of rows) {
    console.log(
      `    ${r.id.padEnd(24)} ${r.lang}  exp=${r.expected.padEnd(18)} got=${(r.got ?? "null").padEnd(18)} ${r.ok ? "OK" : "MISS"}  conf=${r.confidence?.toFixed(2) ?? "n/a"}`,
    );
  }
};

const reportNameGate = (rows: NameGateRow[]): void => {
  console.log(
    `\n=== Name-mention gate (Noul) — "is a fuzzy lookup worth running" ===`,
  );
  for (const lang of ["en", "bg"] as const) {
    const s = rows.filter((r) => r.lang === lang && !r.error);
    const acc = s.length ? s.filter((r) => r.ok).length / s.length : 0;
    console.log(
      `  ${lang.toUpperCase()}  gate acc ${pct(acc)} (${s.filter((r) => r.ok).length}/${s.length})`,
    );
  }
  for (const r of rows) {
    console.log(
      `    ${r.id.padEnd(24)} ${r.lang}  exp=${String(r.expected).padEnd(5)} noul=${r.noul?.toFixed(3) ?? "n/a"}  ${r.ok ? "OK" : "MISS"}`,
    );
  }
  console.log(
    "  NOTE: this only gates whether to run YOUR fuzzy search — it does not extract or locate the name.",
  );
};

const reportNameDisambiguation = (rows: NameDisambigRow[]): void => {
  console.log(
    `\n=== Name disambiguation (Choice over fuzzy-search candidates) ===`,
  );
  for (const lang of ["en", "bg"] as const) {
    const s = rows.filter((r) => r.lang === lang && !r.error);
    const acc = s.length ? s.filter((r) => r.ok).length / s.length : 0;
    console.log(
      `  ${lang.toUpperCase()}  disambig acc ${pct(acc)} (${s.filter((r) => r.ok).length}/${s.length})`,
    );
  }
  for (const r of rows) {
    console.log(
      `    ${r.id.padEnd(28)} ${r.lang}  exp=${r.expected.padEnd(16)} got=${(r.got ?? "null").padEnd(16)} ${r.ok ? "OK" : "MISS"}  conf=${r.confidence?.toFixed(2) ?? "n/a"}`,
    );
  }
};

// ---- CLI --------------------------------------------------------------
const main = async () => {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    console.error("TYPESAFE_API_KEY is required (export it or pass via env).");
    process.exit(1);
  }
  const kArg = process.argv.find((a) => a.startsWith("--k="));
  const k = kArg ? Number(kArg.split("=")[1]) : undefined;
  const suite = registrySuite();
  console.log(
    `\nJev (TypeSafe) tool-routing eval — ${suite.tools.length} tools, ${suite.cases.length} cases` +
      (k
        ? `, retrieved candidate set k=${k}`
        : ", FULL registry as Choice options"),
  );
  const start = Date.now();
  const rows = await runJevToolSelection(apiKey, { k, concurrency: 8 });
  reportToolSelection(
    rows,
    k
      ? `full registry, k=${k} candidates`
      : "full registry, single Choice call",
  );
  console.log(`\n(wall clock: ${((Date.now() - start) / 1000).toFixed(1)}s)`);

  console.log("\nRunning closed-vocabulary argument-selection probe…");
  const argRows = await runJevArgSelection(apiKey);
  reportArgSelection(argRows);

  console.log("\nRunning name-mention gate probe…");
  const gateRows = await runJevNameGate(apiKey);
  reportNameGate(gateRows);

  console.log("\nRunning name-disambiguation probe (misspelling-tolerant)…");
  const disambigRows = await runJevNameDisambiguation(apiKey);
  reportNameDisambiguation(disambigRows);
};

if (process.argv[1] && /fcEval\.jev\.(ts|js)$/.test(process.argv[1])) main();
