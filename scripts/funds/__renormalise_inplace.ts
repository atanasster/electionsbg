// One-time in-place re-normalisation of organisation names in already-
// written JSON shards. Used after each new ingest seam adopts the shared
// `normaliseOrgName` so we don't need to re-download multi-MB XLSX exports
// just to canonicalise casing — the function is idempotent, so a future
// real ingest run won't churn the disk.
//
// Covers (one root at a time, configurable via NAME_FIELDS):
//   data/funds/                  beneficiary + programme + project names
//   data/procurement/            awarder + contractor names
//   data/parliament/             companies-index displayName
//   data/financing/              party names
//   data/budget/                 ministry unit names (with -то article stripped)
//
// Run with:
//   npx tsx scripts/funds/__renormalise_inplace.ts
//   npx tsx scripts/funds/__renormalise_inplace.ts --root data/procurement
//   npx tsx scripts/funds/__renormalise_inplace.ts --all

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  normaliseOrgName,
  stripDefiniteArticle,
  sentenceCaseLabel,
} from "../lib/normalize_name";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

// Field names whose string value is an org name we should normalise.
const NAME_FIELDS = new Set([
  "name",
  "beneficiaryName",
  "programName",
  "top1Name",
  "displayName",
  "companyName",
  "awarderName",
  "contractorName",
  "partyName",
  "institution",
  "unitName",
  "nameBg",
]);

// Label fields use the section-aware variant (preserves leading Roman /
// Arabic numerals like "I." or "1.2").
const LABEL_FIELDS = new Set(["labelBg"]);

// Field that needs the definite-article stripped in addition to the org
// normaliser — budget law's "Министерството на ..." form. The strip is
// idempotent on names that don't match the pattern, so it's safe to apply
// to `nameBg` across trees even though the article only appears on the
// budget side.
const DEFINITE_ARTICLE_FIELDS = new Set(["unitName", "nameBg"]);

// Roots that get visited. Order matters only for log output.
const ROOTS = [
  "data/funds",
  "data/procurement",
  "data/parliament",
  "data/financing",
  "data/budget",
];

// Directories to skip — gitignored bulk shards plus editorial sources.
const SKIP_PATHS = new Set<string>([
  path.join(REPO_ROOT, "data/funds/beneficiaries-by-eik"),
  path.join(REPO_ROOT, "data/funds/projects/by-eik"),
  path.join(REPO_ROOT, "data/funds/themes.json"),
  path.join(REPO_ROOT, "data/parliament/declarations"), // huge, raw upstream text
  path.join(REPO_ROOT, "data/parliament/index.json"), // MP roster, handled by parliament scrape
]);

let changed = 0;
let walked = 0;

const normaliseInPlace = (
  value: unknown,
  parentKey?: string,
): { value: unknown; changed: boolean } => {
  if (typeof value === "string") {
    if (parentKey && NAME_FIELDS.has(parentKey)) {
      let out = normaliseOrgName(value);
      if (DEFINITE_ARTICLE_FIELDS.has(parentKey))
        out = stripDefiniteArticle(out);
      if (out !== value) return { value: out, changed: true };
    } else if (parentKey && LABEL_FIELDS.has(parentKey)) {
      const out = sentenceCaseLabel(value);
      if (out !== value) return { value: out, changed: true };
    }
    return { value, changed: false };
  }
  if (Array.isArray(value)) {
    let anyChanged = false;
    const out = value.map((v) => {
      const r = normaliseInPlace(v, parentKey);
      if (r.changed) anyChanged = true;
      return r.value;
    });
    return { value: anyChanged ? out : value, changed: anyChanged };
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    let anyChanged = false;
    for (const [k, v] of Object.entries(obj)) {
      const r = normaliseInPlace(v, k);
      if (r.changed) anyChanged = true;
      out[k] = r.value;
    }
    return { value: anyChanged ? out : value, changed: anyChanged };
  }
  return { value, changed: false };
};

const walk = (dir: string): void => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (SKIP_PATHS.has(full)) continue;
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!entry.name.endsWith(".json")) continue;
    walked += 1;
    let raw: string;
    try {
      raw = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const result = normaliseInPlace(parsed);
    if (!result.changed) continue;
    const out = JSON.stringify(result.value, null, 2) + "\n";
    fs.writeFileSync(full, out);
    changed += 1;
    if (changed % 200 === 0) {
      console.log(`  … re-normalised ${changed} files`);
    }
  }
};

// CLI: positional --root overrides which subset to walk; default walks
// every root listed in ROOTS.
const argv = process.argv.slice(2);
const rootArgIdx = argv.indexOf("--root");
const rootsToWalk =
  rootArgIdx >= 0 && argv[rootArgIdx + 1]
    ? [argv[rootArgIdx + 1]]
    : argv.includes("--funds-only")
      ? ["data/funds"]
      : ROOTS;

for (const rel of rootsToWalk) {
  const abs = path.resolve(REPO_ROOT, rel);
  if (!fs.existsSync(abs)) {
    console.log(`  · skipping ${rel} — directory missing`);
    continue;
  }
  const before = changed;
  console.log(`→ ${rel}`);
  walk(abs);
  console.log(`  ${changed - before} file(s) re-written in ${rel}`);
}
console.log(`✓ walked ${walked} JSON files, re-wrote ${changed}`);
