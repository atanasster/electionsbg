// Delete translation keys no call site can ask for.
//
// Dry-run by default; `--apply` rewrites both corpora. Both languages are
// pruned with the SAME key set — the two files are key-for-key parallel, and a
// per-language prune would silently make one language's UI a different shape
// from the other's.
//
// Not a routine step and deliberately not in any chain: it deletes translated
// copy, so it wants a human reading the list. `scripts/i18n/key_usage.test.ts`
// is the standing half — it fails when dead keys accumulate again, which is
// what makes running this a decision rather than a chore.
//
// Usage:
//   npx tsx scripts/i18n/prune_translations.ts            # report
//   npx tsx scripts/i18n/prune_translations.ts --apply
import fs from "node:fs";
import { analyzeKeyUsage, loadCorpus, CORPUS_PATH } from "./key_usage";

const LANGS = ["bg", "en"] as const;
const apply = process.argv.includes("--apply");

const bg = loadCorpus("bg");
const en = loadCorpus("en");

// Parity first. The analysis runs over ONE key list, so a corpus that has
// drifted would have its extra keys silently exempted from the prune.
const onlyBg = Object.keys(bg).filter((k) => !(k in en));
const onlyEn = Object.keys(en).filter((k) => !(k in bg));
if (onlyBg.length || onlyEn.length) {
  console.warn(
    `corpora are not key-for-key parallel — bg-only ${onlyBg.length}, en-only ${onlyEn.length}. ` +
      `Pruning the intersection only.`,
  );
  if (onlyBg.length) console.warn("  bg only: " + onlyBg.join(", "));
  if (onlyEn.length) console.warn("  en only: " + onlyEn.join(", "));
}

const usage = analyzeKeyUsage(Object.keys(bg));
const dead = new Set(usage.unused.filter((k) => k in bg && k in en));

console.log(
  `${Object.keys(bg).length} keys · ${usage.literal.size} named · ` +
    `${usage.built.size} built · ${usage.plural.size} plural · ${dead.size} dead`,
);
for (const k of [...dead].sort()) {
  console.log(`  - ${k}  ${JSON.stringify(bg[k]).slice(0, 70)}`);
}

if (!dead.size) {
  console.log("nothing to prune");
  process.exit(0);
}

for (const lang of LANGS) {
  const corpus = lang === "bg" ? bg : en;
  const kept: Record<string, string> = {};
  // Rebuild in the file's own order rather than sorting: the corpus is grouped
  // by feature, and re-sorting it would turn a 460-line deletion into a
  // 6,584-line rewrite that no reviewer can read.
  for (const [k, v] of Object.entries(corpus)) if (!dead.has(k)) kept[k] = v;
  const out = JSON.stringify(kept, null, 2) + "\n";
  const path = CORPUS_PATH(lang);
  if (apply) {
    fs.writeFileSync(path, out);
    console.log(
      `${lang}: ${Object.keys(corpus).length} -> ${Object.keys(kept).length} keys written`,
    );
  } else {
    console.log(
      `${lang}: would write ${Object.keys(kept).length} keys (${Object.keys(corpus).length - Object.keys(kept).length} removed)`,
    );
  }
}

if (!apply) console.log("\ndry run — pass --apply to write");
