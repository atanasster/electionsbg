// Offline precompute of tool-doc embeddings for the in-browser semantic retriever
// (ai/llm/semanticRetrieve.ts). Embeds every registry tool's doc text with the
// SAME model + prefix the browser uses for queries, so the two share one space.
// Re-run whenever the tool registry changes (descriptions / examples / new tools):
//
//   npx tsx ai/llm/buildToolVectors.ts        → ai/llm/tool_vectors.json
//
// This is a Node script (excluded from ai/tsconfig.json). The output JSON is a
// lazy chunk imported by semanticRetrieve.ts only when the constrained router runs.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "@huggingface/transformers";
import { TOOLS } from "../tools/registry";
import {
  EMBED_DTYPE,
  EMBED_MODEL,
  docPrefix,
  toolDocText,
} from "./semanticRetrieve";

const ROUND = 5; // decimals — shrinks the JSON ~2× with no measurable recall loss

const main = async () => {
  console.error(
    `embedding ${TOOLS.length} tool docs via ${EMBED_MODEL} @ ${EMBED_DTYPE}…`,
  );
  const pipe = await pipeline("feature-extraction", EMBED_MODEL, {
    dtype: EMBED_DTYPE,
  });
  const names = TOOLS.map((t) => t.name);
  const texts = names.map((n) => docPrefix(toolDocText(n)));

  const vectors: { name: string; v: number[] }[] = [];
  let dim = 0;
  for (let i = 0; i < texts.length; i += 32) {
    const batch = texts.slice(i, i + 32);
    const t = await pipe(batch, { pooling: "mean", normalize: true });
    dim = t.dims[t.dims.length - 1];
    const data = t.data as Float32Array;
    batch.forEach((_, r) => {
      const row = Array.from(data.slice(r * dim, (r + 1) * dim)).map(
        (x) => +x.toFixed(ROUND),
      );
      vectors.push({ name: names[i + r], v: row });
    });
  }

  const out = join(process.cwd(), "ai/llm/tool_vectors.json");
  writeFileSync(
    out,
    JSON.stringify({ model: EMBED_MODEL, dtype: EMBED_DTYPE, dim, vectors }),
  );
  console.error(`wrote ${out}: ${vectors.length} vectors, dim ${dim}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
