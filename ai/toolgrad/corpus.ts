import { createHash } from "node:crypto";
import type { Envelope, Lang, ToolArgs, ToolContext } from "../tools/types";

export type PilotDomain = "elections" | "procurement" | "people" | "municipal";
export type Seed = {
  id: string;
  domain: PilotDomain;
  tool: string;
  args: ToolArgs;
  requiredFacts: string[];
  /** Interpretation requirements, written independently of generated questions. */
  scope: string;
};
export type Evidence = { source: string; sha256: string };
export type Capture = {
  seed: Seed;
  context: ToolContext;
  envelope: Envelope;
  /** Fresh reads only; resolver caches can reuse the corpus-level inputs. */
  evidence: Evidence[];
  elapsedMs: number;
};
export type Corpus = {
  version: 1;
  capturedAt: string;
  commit: string;
  seedHash: string;
  inputs: Evidence[];
  captures: Capture[];
};
export const hash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export const inputInventory = (captures: Capture[]): Evidence[] => [
  ...new Map(
    captures.flatMap((c) => c.evidence).map((e) => [hash(e), e]),
  ).values(),
];

export function verifyCapture(seed: Seed, env: Envelope): void {
  if (env.tool !== seed.tool || env.clarify)
    throw new Error(`${seed.id}: expected an answered ${seed.tool} call`);
  if (!env.title || !env.provenance.length)
    throw new Error(`${seed.id}: missing title or provenance`);
  for (const key of seed.requiredFacts) {
    const value = key
      .split("|")
      .map((k) => env.facts[k])
      .find((v) => v !== undefined);
    if (
      value === undefined ||
      value === "" ||
      (typeof value === "number" && !Number.isFinite(value))
    )
      throw new Error(`${seed.id}: missing usable fact ${key}`);
  }
  if (env.kind === "table" && !env.rows?.length)
    throw new Error(`${seed.id}: empty table`);
  if (
    env.kind === "series" &&
    !env.series?.some((s) => s.points.some((p) => p.y !== null))
  )
    throw new Error(`${seed.id}: empty series`);
}

export function verifyCorpus(corpus: Corpus, seeds: Seed[]): void {
  if (corpus.version !== 1 || corpus.seedHash !== hash(seeds))
    throw new Error(
      "Corpus and seed manifest differ; recapture before generation",
    );
  if (corpus.captures.length !== seeds.length * 2)
    throw new Error("Incomplete bilingual corpus");
  if (hash(corpus.inputs) !== hash(inputInventory(corpus.captures)))
    throw new Error("Input inventory differs from observed reads");
  const seen = new Set<string>();
  for (const c of corpus.captures) {
    const seed = seeds.find((s) => s.id === c.seed.id);
    if (!seed || hash(seed) !== hash(c.seed))
      throw new Error("Unknown or changed seed");
    if (!["bg", "en"].includes(c.context.lang))
      throw new Error("Invalid language");
    const key = `${seed.id}:${c.context.lang}`;
    if (seen.has(key)) throw new Error(`Duplicate capture ${key}`);
    seen.add(key);
    verifyCapture(seed, c.envelope);
    if (
      !c.evidence.length ||
      c.evidence.some((e) => !e.source || !/^[a-f0-9]{64}$/.test(e.sha256))
    )
      throw new Error(`${key}: missing input fingerprints`);
  }
}

export const LANGS: Lang[] = ["bg", "en"];
