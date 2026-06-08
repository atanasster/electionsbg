// One-off repair: restore ALL-CAPS casing to Bulgarian institutional
// acronyms that an OCR / extraction step (Gemini Vision, some CMS XLSX
// exports) left mis-cased in committed capital-programme project names —
// "Цнстплуи" → "ЦНСТПЛУИ", "Гпче" → "ГПЧЕ", "сопф" → "СОПФ", "Тп и смр" →
// "ТП и СМР". Unlike the shared-renormalise mangling (handled by
// __unmangle_names.ts), this casing was baked in by the muni's OWN parser
// (OCR passthrough, or sofia's normalizeName allowlist gap) and there is no
// faithful git version to restore from — so we apply the curated, case-
// insensitive `restoreAcronyms` directly to the on-disk `name` fields.
//
// SURGICAL: only whole-token curated acronyms change; settlement names,
// proper nouns and every other word keep their committed casing. Re-running
// the muni parsers was rejected because the OCR passthrough reintroduces
// shouted settlement names ("ЖИНЗИФОВО") the committed data had already
// cleaned.
//
// Manual backfill — NOT wired into any watcher. The parsers (kardzhali,
// velingrad, sofia_2022) now call restoreAcronyms at ingest, and sofia.ts's
// allowlist was extended, so future ingests stay clean.
// Run: npx tsx scripts/budget/capital_programs/__restore_acronyms_inplace.ts
import { readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { restoreAcronyms } from "../../lib/normalize_name";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(
  dirname(__filename),
  "../../../data/budget/capital_programs",
);

const changes = new Map<string, number>(); // distinct "before→after" → count
let filesChanged = 0;
let fieldsChanged = 0;

const fix = (
  value: unknown,
  key: string | undefined,
  ctr: { n: number },
): unknown => {
  if (typeof value === "string") {
    if (key === "name") {
      const out = restoreAcronyms(value);
      if (out !== value) {
        ctr.n++;
        // record distinct token-level changes for review
        const A = value.split(/(\s+)/);
        const B = out.split(/(\s+)/);
        for (let i = 0; i < A.length; i++)
          if (A[i] !== B[i]) {
            const k = `${A[i]} → ${B[i]}`;
            changes.set(k, (changes.get(k) ?? 0) + 1);
          }
        return out;
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => fix(v, key, ctr));
  if (value && typeof value === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      o[k] = fix(v, k, ctr);
    return o;
  }
  return value;
};

const walk = (dir: string): void => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    if (
      !entry.endsWith(".json") ||
      entry.endsWith("-tile.json") ||
      entry === "index.json"
    )
      continue;
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(full, "utf8"));
    } catch {
      continue;
    }
    const ctr = { n: 0 };
    const fixed = fix(data, undefined, ctr);
    if (ctr.n > 0) {
      writeFileSync(full, JSON.stringify(fixed, null, 2) + "\n", "utf8");
      filesChanged++;
      fieldsChanged += ctr.n;
      console.log(`  ${full.replace(ROOT + "/", "")}: ${ctr.n} field(s)`);
    }
  }
};

walk(ROOT);
console.log(
  `\n✓ restored acronyms in ${fieldsChanged} name fields across ${filesChanged} files`,
);
console.log("\nDistinct token changes (review for false positives):");
for (const [k, n] of [...changes.entries()].sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(n).padStart(4)}×  ${k}`);
