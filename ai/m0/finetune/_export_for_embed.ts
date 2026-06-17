// Export tool docs + labeled novel queries (with the rules-declined flag) to a
// flat JSON so a STANDALONE transformers.js script (run from a throwaway temp
// dir, no app dependency) can measure small in-browser embedding-model recall
// without importing the app. Pairs with measure_recall_small.mjs.
//
//   npx tsx ai/m0/finetune/_export_for_embed.ts   # → ai/m0/finetune/recall_export.json

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { route } from "../../orchestrator/router";
import { TOOLS } from "../../tools/registry";
import type { Lang } from "../../tools/types";

const HERE = join(process.cwd(), "ai/m0/finetune");
const ELECTION = "2024_10_27";
const queries: Record<string, { en: string[]; bg: string[] }> = JSON.parse(
  readFileSync(join(HERE, "recall_queries.json"), "utf8"),
);

// raw doc text (same fields the lexical + gemini-semantic rankers use)
const docText = (t: (typeof TOOLS)[number]) =>
  [
    t.name,
    t.description.en,
    t.description.bg,
    ...(t.examples ?? []).flatMap((e) => [e.en, e.bg]),
  ].join(" · ");

const docs = TOOLS.map((t) => ({ name: t.name, text: docText(t) }));
const rows: { tool: string; lang: string; query: string; declined: boolean }[] =
  [];
for (const t of TOOLS) {
  const q = queries[t.name];
  if (!q) continue;
  for (const lang of ["en", "bg"] as const) {
    for (const query of q[lang] ?? []) {
      const declined =
        (route(query, { lang: lang as Lang, election: ELECTION })?.tool ??
          null) === null;
      rows.push({ tool: t.name, lang, query, declined });
    }
  }
}

const out = join(HERE, "recall_export.json");
writeFileSync(out, JSON.stringify({ docs, queries: rows }, null, 2));
console.error(`wrote ${out}: ${docs.length} docs, ${rows.length} queries`);
