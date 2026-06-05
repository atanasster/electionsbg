// M3 — prompts for the model provider: tool selection + narration.

import { TOOLS } from "../tools/registry";
import type { Envelope, Lang } from "../tools/types";

// A compact catalogue: "name(param1, param2) — description".
const toolCatalogue = (lang: Lang): string =>
  TOOLS.map((t) => {
    const params = t.params.map((p) => p.name).join(", ");
    return `- ${t.name}(${params}) — ${t.description[lang]}`;
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
    q: "Compare the 2022 and 2024 elections",
    call: '{"tool":"compareElections","args":{"a":"2022_10_02","b":"2024_10_27"}}',
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
    "Tools:",
    toolCatalogue(lang),
  ].join("\n");

export const buildToolSystemPrompt = (lang: Lang): string => {
  const shots = FEW_SHOT.map((s) => `Q: ${s.q}\nA: ${s.call}`).join("\n");
  return [
    "You are the intent router for a Bulgarian elections & governance assistant.",
    'Pick exactly ONE tool that best answers the user\'s question and output a single JSON object {"tool": <name>, "args": {...}}.',
    "Only use tool names from the catalogue. Put the relevant entity (party, place, oblast, election date YYYY_MM_DD, indicator, agency, ministry) in args. Use {} when no args are needed. Output JSON only — no prose.",
    "",
    "Tools:",
    toolCatalogue(lang),
    "",
    "Examples:",
    shots,
  ].join("\n");
};

// Narration: the model gets ONLY the tool's facts and must not invent numbers.
export const buildNarrationPrompt = (
  env: Envelope,
  lang: Lang,
): { system: string; user: string } => {
  const language = lang === "bg" ? "Bulgarian" : "English";
  return {
    system: [
      `You explain civic data in ${language}, in 1–2 short sentences.`,
      "Use ONLY the provided facts. Never invent or infer a number that is not in the facts.",
      "Be concise and neutral. Do not restate the whole table — give the headline.",
    ].join(" "),
    user: [
      `Title: ${env.title}`,
      `Facts (JSON): ${JSON.stringify(env.facts)}`,
      `Source: ${env.provenance.join(", ")}`,
    ].join("\n"),
  };
};
