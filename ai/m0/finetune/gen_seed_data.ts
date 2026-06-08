// Seed training data for the FunctionGemma-270M fine-tune (see
// ai/m0/finetune_functiongemma.md). Emits ONE row per (tool × language) in the
// FunctionGemma chat format, using each registry tool's first bilingual example
// as the query and a name-level target. This is the SEED layer — the foundation
// the doc's stage-1 expansion builds on:
//   • paraphrase each query 10–20× (Gemini), incl. colloquial BG + entity swaps
//   • add hard negatives (the eval's confused pairs) + irrelevance → "no_tool"
//   • fill `arguments` and validate every call against runTool (drop throwers)
//
//   npx tsx ai/m0/finetune/gen_seed_data.ts            # → ai/m0/finetune/seed_data.jsonl
//
// NOTE: name-only targets here (registry examples carry no annotated args, same
// limitation the eval flagged). Args are added in expansion.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { TOOLS } from "../../tools/registry";

const K = 5; // candidates shown per row (correct + K-1 deterministic distractors)

// Compact native-token declarations — mirror buildCompactUser in fcEval.browser.ts
// so training and inference share the exact prompt shape.
const decl = (name: string, description: string): string =>
  `<start_function_declaration>${JSON.stringify({
    name,
    description: description.slice(0, 60),
  })}<end_function_declaration>`;

const candidates = (correctIdx: number): number[] => {
  const out = [correctIdx];
  for (let i = 1; out.length < Math.min(K, TOOLS.length); i++) {
    out.push((correctIdx + i) % TOOLS.length);
  }
  // stable, non-fixed slot for the correct tool
  const pos = correctIdx % out.length;
  const rest = out.slice(1);
  return [...rest.slice(0, pos), correctIdx, ...rest.slice(pos)];
};

const rows: string[] = [];
TOOLS.forEach((tool, idx) => {
  const ex = tool.examples?.[0];
  if (!ex) return;
  const cand = candidates(idx);
  const decls = cand
    .map((i) => decl(TOOLS[i].name, TOOLS[i].description.en))
    .join("\n");
  for (const lang of ["en", "bg"] as const) {
    rows.push(
      JSON.stringify({
        messages: [{ role: "user", content: `${decls}\n${ex[lang]}` }],
        target: `<start_function_call>${JSON.stringify({ name: tool.name })}<end_function_call>`,
        tool: tool.name,
        lang,
        domain: tool.domain,
      }),
    );
  }
});

const out = join(process.cwd(), "ai/m0/finetune/seed_data.jsonl");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, rows.join("\n") + "\n");
console.error(
  `wrote ${out}\n  ${rows.length} seed rows from ${TOOLS.length} tools (EN+BG)`,
);
