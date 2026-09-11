import { PRODUCT_DEFAULTS } from "./productDefaults";
// M3 — prompts for the model provider: tool selection + narration.

import { TOOLS } from "../tools/registry";
import type { Envelope, Lang } from "../tools/types";

// Names and parameter contracts are separate: parentheses in a tool name are invalid.
// Include the descriptions/closed values the real validator requires.
const toolCatalogue = (lang: Lang): string =>
  TOOLS.map((t) => {
    const params = t.params
      .map((p) =>
        [
          p.name,
          p.required ? "required" : "optional",
          p.type,
          p.values ? `values=${JSON.stringify(p.values)}` : "",
          p.min != null ? `min=${p.min}` : "",
          p.max != null ? `max=${p.max}` : "",
          p.default != null ? `default=${JSON.stringify(p.default)}` : "",
          p.description[lang],
        ]
          .filter(Boolean)
          .join("; "),
      )
      .join(" | ");
    return `- ${t.name} — ${t.description[lang]}${params ? `\n  args: ${params}` : ""}`;
  }).join("\n");

// Curated few-shot examples spanning the arg patterns (party, election, place,
// oblast, count, series, ministry, agency, indicator).
const FEW_SHOT: { q: string; call: string }[] = [
  {
    q: "What's the machine-voting % in the last 7 elections?",
    call: '{"tool":"machineVoteSeries","args":{"n":7}}',
  },
  {
    q: "Колко гласа взе ГЕРБ?",
    call: '{"tool":"partyResult","args":{"party":"ГЕРБ"}}',
  },
  {
    q: "Кой е кметът на Пловдив?",
    call: '{"tool":"localMunicipality","args":{"place":"Пловдив"}}',
  },
  {
    q: "Where is GERB strongest?",
    call: '{"tool":"regionBreakdown","args":{"party":"GERB"}}',
  },
  {
    q: "Каква е инфлацията?",
    call: '{"tool":"macroIndicator","args":{"indicator":"инфлация"}}',
  },
  {
    q: "Какъв е държавният бюджет?",
    call: '{"tool":"budgetOverview","args":{}}',
  },
  {
    q: "Какви са данъците в Русе?",
    call: '{"tool":"localTaxes","args":{"place":"Русе"}}',
  },
  {
    q: "Колко е точна Алфа Рисърч?",
    call: '{"tool":"agencyProfile","args":{"agency":"Алфа Рисърч"}}',
  },
  {
    q: "Compare the October 2022 and October 2024 elections",
    call: '{"tool":"compareElections","args":{"a":"2022_10_02","b":"2024_10_27"}}',
  },
  {
    q: "What was turnout in 2023?",
    call: '{"tool":"turnout","args":{"election":"2023"}}',
  },
  {
    q: "Разкажи ми за Габрово",
    call: '{"tool":"governanceProfile","args":{"place":"Габрово"}}',
  },
];

// Leaner system prompt for *training* (M5): catalogue + instruction, no few-shot
// — a fine-tuned model learns the mapping and doesn't need the exemplars.
export const buildToolTrainSystemPrompt = (lang: Lang): string =>
  [
    "You are the intent router for a Bulgarian elections & governance assistant.",
    'Output a single JSON object {"tool": <name>, "args": {...}} choosing one tool from the catalogue. JSON only.',
    "",
    "A calendar year is not a rolling duration. For turnout during a named year use turnout(election=year), never turnoutSeries(years=1). years means a rolling window ending at the latest election. Ranking tools only support their declared metric codes: EU money per resident uses regionalInvestment; basket/GDP uses basketAffordability. If the metric is unsupported, abstain.",
    PRODUCT_DEFAULTS,
    "Tools:",
    toolCatalogue(lang),
  ].join("\n");

export const buildToolSystemPrompt = (lang: Lang): string => {
  const shots = FEW_SHOT.map((s) => `Q: ${s.q}\nA: ${s.call}`).join("\n");
  return [
    "You are the intent router for a Bulgarian elections & governance assistant.",
    'Pick at most ONE tool that directly answers the user\'s question and output a single JSON object {"tool": <name>, "args": {...}}.',
    'If the request is outside the catalogue, asks for an unsupported action (send, buy, delete), or lacks a required entity that context cannot resolve, output {"tool":null,"args":{}}. Never substitute an unrelated tool. The tools cover Bulgarian civic data, not foreign elections.',
    'Use the exact bare tool name, without parentheses. Put ALL parameters inside "args", never at the top level. Use the declared parameter names, types, bounds and exact case-sensitive values. Do not translate enum codes. Omit unspecified optional parameters; do not invent a required entity.',
    "Only use tool names from the catalogue. Put the relevant entity (party, place, oblast, election — a year like 2023 or a YYYY_MM_DD date, indicator, agency, ministry) in args. Always include the election when the question names a year; omit it only when no specific election is meant. Use {} when no args are needed. Output JSON only — no prose.",
    'If a conversation is included, route the line labelled the current question; use the earlier turns only to resolve references in it (an ellipsis, a pronoun, "the same", "that one", a carried-over place or party).',
    "",
    "Preserve the previous tool's explicit arguments on an elliptical follow-up. A party result followed by a city uses municipalityResults with BOTH party and place; an explicit province uses regionResults with party and oblast. Do not drop the party. A bare year is a year scope: never invent a month or date, especially 2021 or 2024. A new complete question may change topic and must not inherit unrelated filters.",
    "A calendar year is not a rolling duration. For turnout during a named year use turnout(election=year), never turnoutSeries(years=1). years means a rolling window ending at the latest election. Ranking tools only support their declared metric codes: EU money per resident uses regionalInvestment; basket/GDP uses basketAffordability. If the metric is unsupported, abstain.",
    PRODUCT_DEFAULTS,
    "Tools:",
    toolCatalogue(lang),
    "",
    "Examples:",
    shots,
  ].join("\n");
};

// Narration: the model gets ONLY the tool's facts and must not invent numbers.
// The model's value over the template is INTERPRETATION — it should surface the
// pattern (the trend, the turning point, the extreme, a comparison), not restate
// the same headline the template already produces. Every answer is the longer,
// interpretive paragraph — we always let the model use its full capabilities
// rather than gating elaboration behind a toggle.
// `context` (optional) is a one-line gist of the PREVIOUS answer, so the prose
// can read as part of a thread ("higher than GERB's 25.3% above") instead of a
// cold restatement. It is phrasing only: the grounding guard below still binds
// every number to the CURRENT facts, never to the conversation.
export const buildNarrationPrompt = (
  env: Envelope,
  lang: Lang,
  context?: string,
): { system: string; user: string } => {
  const language = lang === "bg" ? "Bulgarian" : "English";
  const script = lang === "bg" ? "Cyrillic" : "Latin";
  const length =
    "Write one short paragraph of 1–4 sentences. State the supported finding and, only when the facts support it, a direct comparison. Sparse facts deserve a short answer; do not add an interpretation just to fill a sentence quota.";
  return {
    system: [
      `You MUST write your entire answer in ${language} (${script} script) only.`,
      `Do not use any other language. Explain the civic data in ${language}.`,
      length,
      "Use ONLY the provided facts. Preserve which entity, year, unit and measure each value belongs to. Write quantities in digits as supplied. Never calculate or introduce a difference, ratio, percentage-point change, total or net amount unless that result is explicitly a provided fact, including numbers written in words. You may compare supplied values as higher/lower or rose/fell, without new arithmetic.",
      context
        ? "You may briefly connect this to the previous answer for continuity, but every number MUST come from the Facts below — never reuse or recompute a figure mentioned earlier in the conversation."
        : "",
      "Do not infer motives, interest, trust, causes or consequences from a numerical pattern. Do not call a risk level high, low, minimal or severe without an explicit benchmark/classification in the facts. A count alone supplies no denominator or threshold. Preserve declared versus audited assets, awarded versus paid amounts, and screening signals versus findings of wrongdoing. Missing data is unknown, never zero. If table rows are not supplied as facts, do not claim to know their values.",
      "Use readable labels in the requested language; never emit raw field keys, source table identifiers or filenames. Proper names must retain a consistent spelling. A municipality record is not an individual transfer. Party-vote totals are not all cast ballots or turnout denominators: turnout uses registered voters. Do not supply a year when the facts do not provide one.",
      "Be neutral and specific. Summarize the supported values without adding an interpretation. Do not add a preamble like 'Based on the data'.",
    ]
      .filter(Boolean)
      .join(" "),
    user: [
      context ? `Conversation context: ${context}` : "",
      `Title: ${env.title}`,
      `Facts (JSON): ${JSON.stringify(env.facts)}`,
      `Source: ${env.provenance.join(", ")}`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
};
