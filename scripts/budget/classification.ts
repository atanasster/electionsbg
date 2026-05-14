// Classification registries + the source-code resolver.
//
// The four budget classification dimensions (admin / functional / economic /
// program) are independent systems whose source codes drift year to year. Each
// is a hand-maintained registry of stable node ids, mirroring
// data/canonical_parties.json: a stable `id` with a history[] of per-year
// source codes.
//
// Phase 1 ships the registries EMPTY but structured, plus this resolver, so
// Phase 2 isn't simultaneously inventing the registry format and its first
// consumer. The resolver FAILS LOUD on any code not in the registry for a
// given year — that is the "upstream schema drifted" signal.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { canonicalJson, writeIfChanged } from "./validate";
import type { ClassificationRegistry, CrosswalkOverrides } from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const BUDGET_DIR = path.resolve(__dirname, "../../data/budget");
const CLASSIFICATION_DIR = path.join(BUDGET_DIR, "classification");
const OVERRIDES_FILE = path.join(BUDGET_DIR, "crosswalk-overrides.json");

const REGISTRY_DIMENSIONS = [
  "admin",
  "functional",
  "economic",
  "program",
] as const;
type RegistryDimension = (typeof REGISTRY_DIMENSIONS)[number];

const registryFile = (dimension: RegistryDimension): string =>
  path.join(CLASSIFICATION_DIR, `${dimension}.json`);

// Read one registry. Returns an empty (but valid) registry when the file does
// not exist yet — Phase 1 leaves them empty.
export const loadRegistry = (
  dimension: RegistryDimension,
): ClassificationRegistry => {
  const file = registryFile(dimension);
  if (!fs.existsSync(file)) {
    return { dimension, generatedAt: new Date(0).toISOString(), nodes: [] };
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as ClassificationRegistry;
};

export const loadOverrides = (): CrosswalkOverrides => {
  if (!fs.existsSync(OVERRIDES_FILE)) return { codeRemap: [], factPatch: [] };
  return JSON.parse(
    fs.readFileSync(OVERRIDES_FILE, "utf8"),
  ) as CrosswalkOverrides;
};

// Create the empty-but-structured registry scaffolds + the overrides file if
// they are missing. Idempotent — never overwrites a populated registry.
// Returns the number of files written.
export const ensureScaffolds = (): number => {
  let written = 0;
  for (const dimension of REGISTRY_DIMENSIONS) {
    const file = registryFile(dimension);
    if (fs.existsSync(file)) continue;
    const empty: ClassificationRegistry = {
      dimension,
      generatedAt: new Date(0).toISOString(),
      nodes: [],
    };
    if (writeIfChanged(file, canonicalJson(empty))) written++;
  }
  if (!fs.existsSync(OVERRIDES_FILE)) {
    const empty: CrosswalkOverrides = { codeRemap: [], factPatch: [] };
    if (writeIfChanged(OVERRIDES_FILE, canonicalJson(empty))) written++;
  }
  return written;
};

// Resolve a source code to a stable node id for a given fiscal year. Consulted
// by the Phase 2+ normalizers. Throws — naming dimension, year, code and label
// — when no registry node lists this code for this year, and no override
// remaps it. A silently-dropped ministry corrupts reconciliation totals, so
// this is a hard failure, not a warning.
export const resolveCode = (
  registry: ClassificationRegistry,
  overrides: CrosswalkOverrides,
  fiscalYear: number,
  sourceCode: string,
  sourceLabel: string,
): string => {
  const remap = overrides.codeRemap.find(
    (r) =>
      r.dimension === registry.dimension &&
      r.fiscalYear === fiscalYear &&
      r.sourceCode === sourceCode,
  );
  if (remap) return remap.nodeId;
  for (const node of registry.nodes) {
    if (
      node.history.some(
        (h) => h.fiscalYear === fiscalYear && h.sourceCode === sourceCode,
      )
    ) {
      return node.id;
    }
  }
  throw new Error(
    `classification: unknown ${registry.dimension} code "${sourceCode}" ` +
      `("${sourceLabel}") for fiscal year ${fiscalYear}. ` +
      `Add it to data/budget/classification/${registry.dimension}.json ` +
      `(or data/budget/crosswalk-overrides.json) before continuing.`,
  );
};

export type { RegistryDimension };
export { CLASSIFICATION_DIR, OVERRIDES_FILE };
