// Tool retrieval for the constrained small-model router (experimental).
//
// The fc-eval ladder (see /evals) showed an untuned FunctionGemma-270M can route
// at all ONLY when (a) the prompt fits the 512-token window — i.e. a FEW
// candidate tools, not all ~107 — and (b) decoding is constrained to those
// candidates' names. This module is the (a): a cheap, deterministic top-k
// retriever over the registry (tool name + description + example phrasings,
// EN+BG) so the provider can hand the model a small candidate set instead of the
// whole registry. Built on fuse.js (already a dependency; same engine as the
// entity resolver in ai/tools/resolve.ts).

import Fuse from "fuse.js";
import { TOOLS, TOOLS_BY_NAME } from "../tools/registry";

type Row = { name: string; haystack: string };

let index: Fuse<Row> | null = null;
const getIndex = (): Fuse<Row> => {
  if (index) return index;
  const rows: Row[] = TOOLS.map((t) => ({
    name: t.name,
    haystack: [
      t.name,
      t.description.en,
      t.description.bg,
      ...(t.examples ?? []).flatMap((e) => [e.en, e.bg]),
    ].join(" "),
  }));
  index = new Fuse(rows, {
    keys: ["haystack", "name"],
    threshold: 0.6,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });
  return index;
};

// Top-k tool names most relevant to the question. Always returns exactly k names
// (pads deterministically from the registry if fuse finds fewer) so the
// candidate set — and thus the grammar enum — is a stable size.
export const retrieveToolNames = (question: string, k: number): string[] => {
  const out: string[] = [];
  for (const hit of getIndex().search(question)) {
    if (out.length >= k) break;
    out.push(hit.item.name);
  }
  if (out.length < k) {
    for (const t of TOOLS) {
      if (out.length >= k) break;
      if (!out.includes(t.name)) out.push(t.name);
    }
  }
  return out.slice(0, k);
};

// Resolve names → registry tools (skips any unknown name defensively).
export const retrieveTools = (question: string, k: number) =>
  retrieveToolNames(question, k)
    .map((n) => TOOLS_BY_NAME[n])
    .filter(Boolean);
