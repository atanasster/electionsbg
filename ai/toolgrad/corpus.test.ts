import { describe, expect, it } from "vitest";
import {
  hash,
  inputInventory,
  verifyCapture,
  verifyCorpus,
  type Corpus,
  type Seed,
} from "./corpus";
import type { Envelope } from "../tools/types";
import { SEEDS } from "./seeds";
import { validateToolArgs } from "../orchestrator/toolSchema";

const seed: Seed = {
  id: "test",
  domain: "elections",
  tool: "turnout",
  args: {},
  requiredFacts: ["turnout"],
  scope: "National turnout",
};
const env: Envelope = {
  tool: "turnout",
  title: "Turnout",
  kind: "scalar",
  viz: "none",
  facts: { turnout: "40.51%" },
  provenance: ["elections.json"],
};
const corpus = (): Corpus => ({
  version: 1,
  capturedAt: "2026-09-11T00:00:00Z",
  commit: "test",
  seedHash: hash([seed]),
  inputs: [{ source: "elections.json", sha256: hash("source") }],
  captures: (["bg", "en"] as const).map((lang) => ({
    seed,
    context: { lang, election: "2023_04_02" },
    envelope: structuredClone(env),
    evidence: [{ source: "elections.json", sha256: hash("source") }],
    elapsedMs: 1,
  })),
});
describe("execution-verified corpus", () => {
  it("keeps earlier resolver reads in the shared inventory for later bilingual calls", () => {
    const c = corpus();
    const place = {
      source: "data/municipalities.json",
      sha256: hash("places"),
    };
    c.captures[0].evidence.push(place);
    c.inputs = inputInventory(c.captures);
    expect(c.captures[1].evidence).not.toContainEqual(place);
    expect(c.inputs).toContainEqual(place);
    expect(() => verifyCorpus(c, [seed])).not.toThrow();
    c.inputs = c.inputs.filter((e) => e.source !== place.source);
    expect(() => verifyCorpus(c, [seed])).toThrow("Input inventory");
  });
  it("rejects an empty/degraded answer, a different tool, and missing provenance", () => {
    expect(() => verifyCapture(seed, { ...env, facts: {} })).toThrow(
      "missing usable fact",
    );
    expect(() =>
      verifyCapture(seed, { ...env, tool: "nationalResults" }),
    ).toThrow("expected an answered");
    expect(() => verifyCapture(seed, { ...env, provenance: [] })).toThrow(
      "provenance",
    );
    expect(() =>
      verifyCapture(seed, { ...env, kind: "table", rows: [] }),
    ).toThrow("empty table");
  });
  it("cannot count clarification as a successful answer", () => {
    expect(() =>
      verifyCapture(seed, {
        ...env,
        clarify: { prompt: "Which?", options: [] },
      }),
    ).toThrow("expected an answered");
  });
  it("requires exactly one execution per language and unchanged seeds", () => {
    expect(() => verifyCorpus(corpus(), [seed])).not.toThrow();
    const duplicate = corpus();
    duplicate.captures[1] = duplicate.captures[0];
    expect(() => verifyCorpus(duplicate, [seed])).toThrow("Duplicate");
    expect(() =>
      verifyCorpus(corpus(), [{ ...seed, args: { election: "2024" } }]),
    ).toThrow("manifest differ");
    const incomplete = corpus();
    incomplete.captures.pop();
    expect(() => verifyCorpus(incomplete, [seed])).toThrow("Incomplete");
  });
  it("covers all four domains with valid tool arguments", () => {
    expect(SEEDS).toHaveLength(24);
    expect(new Set(SEEDS.map((s) => s.id)).size).toBe(24);
    for (const d of ["elections", "procurement", "people", "municipal"])
      expect(SEEDS.filter((s) => s.domain === d)).toHaveLength(6);
    for (const s of SEEDS)
      expect(validateToolArgs(s.tool, s.args), s.id).not.toBeNull();
  });
});
