// Derive the eval suite from the REAL tool registry (ai/tools/registry.ts).
//
// The point of the benchmark is to verify tool calling when ALL registered tools
// are in play — the realistic task — not a hand-picked sample. So the catalogue
// and the cases come straight from the registry, which means the suite covers
// every tool and auto-tracks new ones (no more going stale).
//
//   tools → FcTool[]  (name, domain, English description, params)
//   cases → FcCase[]  from each tool's first bilingual `example` (EN+BG); the
//           expected tool is that tool. Tool SELECTION is the metric — the
//           registry examples don't annotate argument values, so args aren't
//           scored here (argAcc reports n/a). A couple of irrelevance probes
//           keep "call nothing" (BFCL Function Relevance Detection) measured.
//
// Imports the registry (node + browser both fine — the chat app already bundles
// it, and the node harnesses already import it under tsx).

import { TOOLS } from "../tools/registry";
import type { FcCase, FcTool } from "./fcEval";

// Registry param `type` values that are genuinely numeric; everything else is a
// string as far as the tool-list prompt is concerned (exact types don't affect
// tool SELECTION, the metric here).
const NUMERIC_PARAM_TYPES = new Set(["year", "n"]);

export const registryTools = (): FcTool[] =>
  TOOLS.map((t) => ({
    name: t.name,
    domain: t.domain,
    description: t.description.en,
    parameters: {
      type: "object" as const,
      properties: Object.fromEntries(
        t.params.map((p) => [
          p.name,
          {
            type: NUMERIC_PARAM_TYPES.has(p.type)
              ? ("integer" as const)
              : ("string" as const),
            description: p.description.en,
          },
        ]),
      ),
      required: t.params.filter((p) => p.required).map((p) => p.name),
    },
  }));

export const registryCases = (): FcCase[] =>
  TOOLS.flatMap((t) => {
    const ex = t.examples[0];
    return ex
      ? [
          {
            id: t.name,
            tool: t.name,
            domain: t.domain,
            args: {},
            en: ex.en,
            bg: ex.bg,
          },
        ]
      : [];
  });

// A few off-topic probes so Function Relevance Detection ("call nothing") is
// still measured against the full registry.
export const IRRELEVANCE_CASES: FcCase[] = [
  {
    id: "irrelevant_weather",
    tool: null,
    args: {},
    en: "What is the weather like in Sofia today?",
    bg: "Какво е времето в София днес?",
  },
  {
    id: "irrelevant_recipe",
    tool: null,
    args: {},
    en: "Give me a recipe for banitsa.",
    bg: "Дай ми рецепта за баница.",
  },
];

export const registrySuite = (): { tools: FcTool[]; cases: FcCase[] } => ({
  tools: registryTools(),
  cases: [...registryCases(), ...IRRELEVANCE_CASES],
});
