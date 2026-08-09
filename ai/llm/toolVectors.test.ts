// The committed tool-vector artifact must cover the whole registry.
//
// `semanticRetrieve.ts` builds its candidate set from `tool_vectors.json`, so a tool with no vector
// can NEVER be retrieved — and the failure is silent: retrieval simply returns the neighbours that
// do have vectors, which for „има ли отворена програма за X" were the two AWARDED-corpus funds
// tools. The artifact had drifted to 191 entries against a 216-tool registry, with `openCalls` and
// `interregOverview` among the missing, so this is a recurring omission rather than a one-off.
//
// `ai/m0/finetune_functiongemma.md` states the obligation ("Retrain when the registry changes"),
// but a doc is not a gate. Regenerate with `npx tsx ai/llm/buildToolVectors.ts` and commit.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { TOOLS } from "../tools/registry";

const vectors = JSON.parse(
  readFileSync(path.join(__dirname, "tool_vectors.json"), "utf-8"),
) as { vectors: { name: string; v: number[] }[]; dim?: number };

describe("tool_vectors.json covers the registry", () => {
  it("has one vector per registered tool, and no orphans", () => {
    const have = new Set(vectors.vectors.map((v) => v.name));
    const want = new Set(TOOLS.map((t) => t.name));
    const missing = [...want].filter((n) => !have.has(n));
    const orphan = [...have].filter((n) => !want.has(n));
    expect(
      missing,
      `${missing.length} tool(s) have no vector and can never be retrieved — run: npx tsx ai/llm/buildToolVectors.ts`,
    ).toEqual([]);
    expect(
      orphan,
      `${orphan.length} vector(s) name a tool that no longer exists — rebuild the artifact`,
    ).toEqual([]);
  });

  it("every vector has the same dimensionality", () => {
    // A ragged artifact is worse than a missing one: the cosine would silently compare a prefix.
    const dims = new Set(vectors.vectors.map((v) => v.v.length));
    expect(dims.size).toBe(1);
    if (vectors.dim) expect([...dims][0]).toBe(vectors.dim);
  });
});
