// Verify the PRODUCTION semantic retriever module (ai/llm/semanticRetrieve.ts)
// against the shipped tool_vectors.json: recompute recall on the rules-declined
// residual through the real code path (should reproduce the ~87%@8 measured via
// the standalone /tmp harness) + spot-check the cases lexical missed 100%.
//
//   npx tsx ai/m0/finetune/verify_semantic.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { retrieveToolNamesSemantic } from "../../llm/semanticRetrieve";

const { queries } = JSON.parse(
  readFileSync(
    join(process.cwd(), "ai/m0/finetune/recall_export.json"),
    "utf8",
  ),
) as {
  queries: { tool: string; lang: string; query: string; declined: boolean }[];
};

const KS = [1, 3, 5, 8];

const main = async () => {
  const declined = queries.filter((q) => q.declined);
  const hit: Record<number, number> = Object.fromEntries(KS.map((k) => [k, 0]));
  console.error(
    `scoring ${declined.length} declined queries through the production module…`,
  );
  for (const q of declined) {
    const names = await retrieveToolNamesSemantic(q.query, 8);
    const rank = names.indexOf(q.tool);
    for (const k of KS) if (rank >= 0 && rank < k) hit[k]++;
  }
  const pct = (n: number) => `${((100 * n) / declined.length).toFixed(1)}%`;
  console.log(
    `\n=== production semanticRetrieve on ${declined.length} declined queries ===`,
  );
  console.log(
    `  recall@1 ${pct(hit[1])}   @3 ${pct(hit[3])}   @5 ${pct(hit[5])}   @8 ${pct(hit[8])}`,
  );
  console.log(
    `  (standalone /tmp harness measured: @5 79% @8 87% — should match)`,
  );

  console.log(
    `\n  Spot-check tools lexical missed 100% (correct tool should appear):`,
  );
  for (const t of [
    "municipalityResults",
    "settlementResults",
    "agencyPolls",
    "macroIndicator",
  ]) {
    const q = queries.find((x) => x.tool === t && x.lang === "en");
    if (!q) continue;
    const names = await retrieveToolNamesSemantic(q.query, 8);
    const at = names.indexOf(t);
    console.log(
      `    "${q.query}"\n      → rank ${at < 0 ? "MISS" : at} | top: ${names.slice(0, 5).join(", ")}`,
    );
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
