// EN/BG function-calling evaluation harness for the Наясно AI chat.
//
// PURPOSE: measure how much a model's tool-calling degrades when the SAME
// request is asked in Bulgarian vs English — the cross-cutting question the
// deep-research pass flagged as unmeasured. It is deliberately model-agnostic:
// it builds prompts, parses tool calls, and scores them, but the actual token
// generation is injected as a `complete()` function. That lets the SAME cases
// run against:
//   • FunctionGemma / any web-llm model in the browser (WebGPU), and
//   • a cloud model (OpenRouter) from a node harness — just pass a different
//     `complete`.
//
// This file is PURE (no web-llm, no React, no DOM, no `@/` imports) so it loads
// equally under tsx/node and in the Vite browser bundle.
//
// The tool set mirrors REAL registry tools (ai/tools/*) — English function
// names + param keys (matching FunctionGemma's training distribution), with the
// query language as the ONLY variable. A later axis can localise the tool
// DESCRIPTIONS to Bulgarian to test the bilingual-schema hypothesis; v1 keeps
// descriptions English so the lone independent variable is the user's language.

export type FcParam = {
  type: "string" | "integer" | "number" | "boolean";
  description: string;
};

export type FcTool = {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, FcParam>;
    required: string[];
  };
};

// A paired case: one intent, expressed in EN and BG, with the expected tool and
// the expected argument tokens. `tool: null` is an irrelevance case (the model
// should call NOTHING — BFCL's Function Relevance Detection). `args` maps an
// expected param key to the acceptable value tokens (case/space-insensitive
// containment, so "GERB" matches "ГЕРБ"→romanised or a longer official name).
export type FcCase = {
  id: string;
  tool: string | null;
  args: Record<string, string[]>;
  en: string;
  bg: string;
};

// ---- the tool catalogue (10 real tools + distractors for select-among-many) --
export const FC_TOOLS: FcTool[] = [
  {
    name: "get_national_results",
    description:
      "Get the national party vote results for a parliamentary election.",
    parameters: {
      type: "object",
      properties: {
        election: {
          type: "string",
          description: "Election date or year, e.g. '2024' or 'last'.",
        },
      },
      required: ["election"],
    },
  },
  {
    name: "get_turnout",
    description: "Get voter turnout for a parliamentary election.",
    parameters: {
      type: "object",
      properties: {
        election: {
          type: "string",
          description: "Election date or year, e.g. '2023'.",
        },
      },
      required: ["election"],
    },
  },
  {
    name: "get_party_result",
    description:
      "Get a single party's vote share/result in a parliamentary election.",
    parameters: {
      type: "object",
      properties: {
        party: {
          type: "string",
          description: "Party name or abbreviation, e.g. 'GERB'.",
        },
        election: { type: "string", description: "Election date or year." },
      },
      required: ["party"],
    },
  },
  {
    name: "get_party_by_region",
    description: "Get a party's results broken down by region (oblast).",
    parameters: {
      type: "object",
      properties: {
        party: { type: "string", description: "Party name or abbreviation." },
        region: {
          type: "string",
          description: "Oblast (region) name, e.g. 'Plovdiv'.",
        },
      },
      required: ["party", "region"],
    },
  },
  {
    name: "get_municipality_winners",
    description: "List the leading party in each municipality of a region.",
    parameters: {
      type: "object",
      properties: {
        region: { type: "string", description: "Oblast (region) name." },
      },
      required: ["region"],
    },
  },
  {
    name: "get_mp_assets",
    description: "Get the declared assets/wealth of a member of parliament.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Full name of the MP." },
      },
      required: ["name"],
    },
  },
  {
    name: "get_party_mps",
    description: "List the members of parliament belonging to a party group.",
    parameters: {
      type: "object",
      properties: {
        party: { type: "string", description: "Party name or abbreviation." },
      },
      required: ["party"],
    },
  },
  {
    name: "get_budget_overview",
    description: "Get the Bulgarian state budget overview for a fiscal year.",
    parameters: {
      type: "object",
      properties: {
        year: { type: "integer", description: "Fiscal year, e.g. 2024." },
      },
      required: ["year"],
    },
  },
  {
    name: "get_unemployment_by_municipality",
    description: "Get registered unemployment ranked by municipality.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_poll_accuracy",
    description:
      "Get which polling agency was most accurate vs the election result.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  // ---- distractors: increase the tool count so selection is non-trivial -----
  {
    name: "get_machine_vote_share",
    description: "Get the share of votes cast on voting machines.",
    parameters: {
      type: "object",
      properties: {
        election: { type: "string", description: "Election date or year." },
      },
      required: ["election"],
    },
  },
  {
    name: "get_local_council",
    description: "Get the municipal council composition for a municipality.",
    parameters: {
      type: "object",
      properties: {
        municipality: { type: "string", description: "Municipality name." },
      },
      required: ["municipality"],
    },
  },
];

// ---- the paired EN/BG cases ------------------------------------------------
export const FC_CASES: FcCase[] = [
  {
    id: "national_results_last",
    tool: "get_national_results",
    args: { election: ["last", "2026", "април", "latest", "последн"] },
    en: "What were the results of the last election?",
    bg: "Какви са резултатите от последните избори?",
  },
  {
    id: "turnout_2023",
    tool: "get_turnout",
    args: { election: ["2023"] },
    en: "What was the voter turnout in 2023?",
    bg: "Каква беше избирателната активност през 2023?",
  },
  {
    id: "party_result_gerb",
    tool: "get_party_result",
    args: { party: ["gerb", "герб"] },
    en: "How did GERB do in the last election?",
    bg: "Как се представи ГЕРБ на последните избори?",
  },
  {
    id: "party_by_region_pp_plovdiv",
    tool: "get_party_by_region",
    args: { party: ["pp", "пп"], region: ["plovdiv", "пловдив"] },
    en: "Show PP results by region in Plovdiv.",
    bg: "Покажи резултатите на ПП по общини в Пловдив.",
  },
  {
    id: "muni_winners_varna",
    tool: "get_municipality_winners",
    args: { region: ["varna", "варна"] },
    en: "Which party won each municipality in Varna?",
    bg: "Коя партия печели всяка община във Варна?",
  },
  {
    id: "mp_assets_vasilev",
    tool: "get_mp_assets",
    args: { name: ["vasilev", "василев", "asen", "асен"] },
    en: "What are the declared assets of Asen Vasilev?",
    bg: "Какво е имуществото на Асен Василев?",
  },
  {
    id: "party_mps_pp",
    tool: "get_party_mps",
    args: { party: ["pp", "пп"] },
    en: "Who are the MPs from PP?",
    bg: "Кои са депутатите от ПП?",
  },
  {
    id: "budget_2024",
    tool: "get_budget_overview",
    args: { year: ["2024"] },
    en: "Show the state budget for 2024.",
    bg: "Покажи държавния бюджет за 2024.",
  },
  {
    id: "unemployment_munis",
    tool: "get_unemployment_by_municipality",
    args: {},
    en: "Which municipalities have the highest unemployment?",
    bg: "Кои общини са с най-висока безработица?",
  },
  {
    id: "poll_accuracy",
    tool: "get_poll_accuracy",
    args: {},
    en: "Which polling agency is the most accurate?",
    bg: "Коя социологическа агенция е най-точна?",
  },
  {
    id: "irrelevant_weather",
    tool: null,
    args: {},
    en: "What is the weather like in Sofia today?",
    bg: "Какво е времето в София днес?",
  },
];

// ---- prompt building (FunctionGemma native format) -------------------------
// FunctionGemma expects each tool as a <start_function_declaration>{json}
// <end_function_declaration> block, then the user query, in the user turn. The
// web-llm chat template wraps this in <start_of_turn>user…<end_of_turn>.
export const buildFunctionGemmaUser = (
  tools: FcTool[],
  query: string,
): string => {
  const decls = tools
    .map(
      (t) =>
        `<start_function_declaration>${JSON.stringify(t)}<end_function_declaration>`,
    )
    .join("\n");
  return `${decls}\n${query}`;
};

// JSON-mode system prompt — mirrors how the production cloud router actually
// selects tools (a tool list + "reply with JSON {name,arguments}"), so a cloud
// eval measures the real routing path, not the OpenAI tools API. Pair with
// response_format:{type:"json_object"}. Language-neutral on purpose: the user
// query (EN or BG) is the only thing that varies.
export const buildJsonToolPrompt = (tools: FcTool[]): string => {
  const list = tools
    .map((t) => {
      const params = Object.entries(t.parameters.properties)
        .map(([k, p]) => `${k} (${p.type})`)
        .join(", ");
      return `- ${t.name}: ${t.description}${params ? ` [params: ${params}]` : ""}`;
    })
    .join("\n");
  return [
    "You are a tool router. Choose the single best tool for the user's request from the list below.",
    'Reply with ONLY a JSON object: {"name": "<tool_name>", "arguments": { ... }}.',
    'If no tool fits the request, reply with {"name": null}.',
    "Do not add any text outside the JSON.",
    "",
    "Tools:",
    list,
  ].join("\n");
};

// ---- parsing a tool call out of raw model output ---------------------------
export type ParsedCall = { name: string; args: Record<string, unknown> } | null;

// Robust to: FunctionGemma's <start_function_call>{…}<end_function_call>, a bare
// JSON object, or an OpenAI-style {tool_calls:[{function:{name,arguments}}]}.
export const parseToolCall = (raw: string): ParsedCall => {
  if (!raw) return null;
  const stripped = raw
    .replace(/<\/?start_function_call>/g, "")
    .replace(/<\/?end_function_call>/g, "")
    .trim();
  const obj = extractJson(stripped) ?? extractJson(raw);
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  // OpenAI tool_calls shape
  const tc = (o.tool_calls as unknown[] | undefined)?.[0] as
    | { function?: { name?: string; arguments?: unknown } }
    | undefined;
  if (tc?.function?.name) {
    let args: Record<string, unknown> = {};
    const a = tc.function.arguments;
    if (typeof a === "string")
      args = (extractJson(a) as Record<string, unknown>) ?? {};
    else if (a && typeof a === "object") args = a as Record<string, unknown>;
    return { name: tc.function.name, args };
  }
  // FunctionGemma / flat shape: {name, <args>...} or {name, parameters|arguments}
  const name = (o.name ?? o.function ?? o.tool) as string | undefined;
  if (!name || typeof name !== "string") return null;
  let args: Record<string, unknown> =
    (o.arguments as Record<string, unknown>) ??
    (o.parameters as Record<string, unknown>) ??
    (o.args as Record<string, unknown>) ??
    {};
  if (!args || typeof args !== "object") args = {};
  // if no nested args object, treat remaining top-level keys as the args
  if (Object.keys(args).length === 0) {
    const rest: Record<string, unknown> = { ...o };
    delete rest.name;
    delete rest.function;
    delete rest.tool;
    args = rest;
  }
  return { name, args };
};

// Find the best JSON object in a string. Robust to chain-of-thought models
// (e.g. Gemma reasons in prose, then emits the tool call as the LAST object):
// scan every balanced top-level {...}, then prefer the LAST one that looks like
// a tool call (has name/tool/function/tool_calls), else the last that parses.
const extractJson = (s: string): unknown => {
  if (!s) return null;
  const objs: unknown[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (s[i] === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          try {
            objs.push(JSON.parse(s.slice(start, i + 1)));
          } catch {
            /* not valid JSON — skip */
          }
          start = -1;
        }
      }
    }
  }
  if (!objs.length) return null;
  const looksTool = (o: unknown) =>
    !!o &&
    typeof o === "object" &&
    ["name", "tool", "function", "tool_calls"].some((k) => k in o);
  for (let i = objs.length - 1; i >= 0; i--)
    if (looksTool(objs[i])) return objs[i];
  return objs[objs.length - 1];
};

// ---- scoring ---------------------------------------------------------------
export type CaseScore = {
  id: string;
  lang: "en" | "bg";
  expectedTool: string | null;
  gotTool: string | null;
  jsonValid: boolean; // a tool call was parsed (or correctly none for irrelevance)
  toolOk: boolean;
  argsOk: boolean; // only meaningful when toolOk && expectedTool != null
  raw: string;
};

const norm = (v: unknown): string =>
  String(v ?? "")
    .toLowerCase()
    .replace(/[\s"'.,]/g, "");

export const scoreCase = (
  c: FcCase,
  lang: "en" | "bg",
  raw: string,
): CaseScore => {
  const parsed = parseToolCall(raw);
  if (c.tool === null) {
    // irrelevance: success == no call emitted
    const ok = parsed === null;
    return {
      id: c.id,
      lang,
      expectedTool: null,
      gotTool: parsed?.name ?? null,
      jsonValid: ok,
      toolOk: ok,
      argsOk: ok,
      raw,
    };
  }
  const gotTool = parsed?.name ?? null;
  const toolOk = norm(gotTool) === norm(c.tool);
  let argsOk = true;
  if (toolOk && parsed) {
    const got = parsed.args ?? {};
    const gotNormByKey: Record<string, string> = {};
    for (const [k, v] of Object.entries(got))
      gotNormByKey[k.toLowerCase()] = norm(v);
    const allGotValues = Object.values(got).map(norm).join("|");
    for (const [key, accepted] of Object.entries(c.args)) {
      const gotVal = gotNormByKey[key.toLowerCase()] ?? allGotValues; // fall back to any value
      const hit = accepted.some((tok) => gotVal.includes(norm(tok)));
      if (!hit) argsOk = false;
    }
  } else {
    argsOk = false;
  }
  return {
    id: c.id,
    lang,
    expectedTool: c.tool,
    gotTool,
    jsonValid: parsed !== null,
    toolOk,
    argsOk,
    raw,
  };
};

// ---- candidate-set selection (realistic two-stage / RAG-over-tools mode) ----
// Small models collapse when ALL tools are crammed in-context (FunctionGemma-270M
// emits garbage with 12 declarations, and a 512-window build traps outright). In
// production the right architecture is to RETRIEVE a few relevant tools first.
// candidateTools() simulates that retrieval cleanly: it returns the correct tool
// + (k-1) DETERMINISTIC distractors (same set for a case's EN and BG variants, so
// language stays the only variable). Irrelevance cases get k distractors, none
// correct. Deterministic (FNV-1a over the case id) — no Math.random (resume-safe).
const fnv1a = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

export const candidateTools = (c: FcCase, all: FcTool[], k = 5): FcTool[] => {
  const correct = all.find((t) => t.name === c.tool) ?? null;
  const others = all.filter((t) => t.name !== c.tool);
  const h = fnv1a(c.id);
  const need = correct ? k - 1 : k;
  const distract: FcTool[] = [];
  for (let i = 0; i < others.length && distract.length < need; i++) {
    distract.push(others[(h + i) % others.length]);
  }
  if (!correct) return distract;
  const pos = h % (distract.length + 1); // hide the correct tool at a stable, non-fixed slot
  return [...distract.slice(0, pos), correct, ...distract.slice(pos)];
};

// ---- runner (model-agnostic) ----------------------------------------------
// `complete(query, tools)` returns the model's raw text for one turn. The caller
// owns the model AND the prompt strategy: a web-llm/FunctionGemma adapter wraps
// the query with buildFunctionGemmaUser(tools, query); a cloud adapter sends
// buildJsonToolPrompt(tools) as the system message + query as the user message.
// Passing (query, tools) — not a pre-built string — lets each adapter format its
// own way while the harness reuses the SAME tool set for a case's EN/BG variants.
export type CompleteFn = (query: string, tools: FcTool[]) => Promise<string>;

export type LangReport = {
  lang: "en" | "bg";
  n: number;
  toolAcc: number; // fraction of cases with the right tool (incl. irrelevance)
  argAcc: number; // fraction of relevant+correct-tool cases with right args
  jsonValidRate: number; // fraction emitting parseable output (relevant cases)
  irrelevanceAcc: number | null; // fraction of irrelevance cases correctly silent
};

export type FcReport = {
  perLang: Record<"en" | "bg", LangReport>;
  degradation: { toolAcc: number; argAcc: number }; // en - bg (positive = bg worse)
  scores: CaseScore[];
};

export const runFcEval = async (
  complete: CompleteFn,
  opts: {
    tools?: FcTool[];
    cases?: FcCase[];
    // Per-case tool set. Defaults to ALL tools; pass `(c, all) => candidateTools(c, all, 5)`
    // for the realistic retrieved-candidate-set mode. The SAME set is reused for
    // a case's EN and BG variants so language is the only variable.
    toolsForCase?: (c: FcCase, all: FcTool[]) => FcTool[];
  } = {},
): Promise<FcReport> => {
  const all = opts.tools ?? FC_TOOLS;
  const cases = opts.cases ?? FC_CASES;
  const pick = opts.toolsForCase ?? (() => all);
  const scores: CaseScore[] = [];
  for (const c of cases) {
    const tools = pick(c, all);
    for (const lang of ["en", "bg"] as const) {
      const raw = await complete(c[lang], tools);
      scores.push(scoreCase(c, lang, raw));
    }
  }
  const perLang = (lang: "en" | "bg"): LangReport => {
    const s = scores.filter((x) => x.lang === lang);
    const relevant = s.filter((x) => x.expectedTool !== null);
    const irr = s.filter((x) => x.expectedTool === null);
    const correctTool = relevant.filter((x) => x.toolOk);
    return {
      lang,
      n: s.length,
      toolAcc: s.length ? s.filter((x) => x.toolOk).length / s.length : 0,
      argAcc: correctTool.length
        ? correctTool.filter((x) => x.argsOk).length / correctTool.length
        : 0,
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
    degradation: {
      toolAcc: en.toolAcc - bg.toolAcc,
      argAcc: en.argAcc - bg.argAcc,
    },
    scores,
  };
};
