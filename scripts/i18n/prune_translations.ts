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
import { pathToFileURL } from "node:url";
import { analyzeKeyUsage, loadCorpus, CORPUS_PATHS } from "./key_usage";

export type Corpus = Record<string, string>;

export interface PrunePlan {
  /** Dead in BOTH corpora — the only keys either file may lose. */
  dead: string[];
  /** Rebuilt corpora, in each file's own order. */
  kept: { bg: Corpus; en: Corpus };
  /** Parity breaks, reported rather than pruned. */
  onlyBg: string[];
  onlyEn: string[];
}

/** The whole decision, as a pure function — the writer below only does IO.
 *
 *  Two properties are load-bearing and neither is visible in a row count:
 *
 *  - The dead set is INTERSECTED with both corpora. The analysis runs over one
 *    key list (bg's), so a key that has drifted out of en must not be deleted
 *    from bg alone on the strength of a verdict the other file never got.
 *  - Each corpus is rebuilt in ITS OWN order, never sorted. The corpus is
 *    grouped by feature, and re-sorting turns a 486-line deletion into a
 *    6,584-line rewrite that no reviewer can read. */
export const planPrune = (
  bg: Corpus,
  en: Corpus,
  unused: string[],
): PrunePlan => {
  const dead = new Set(unused.filter((k) => k in bg && k in en));
  const rebuild = (corpus: Corpus): Corpus => {
    const kept: Corpus = {};
    for (const [k, v] of Object.entries(corpus)) if (!dead.has(k)) kept[k] = v;
    return kept;
  };
  return {
    dead: [...dead],
    kept: { bg: rebuild(bg), en: rebuild(en) },
    onlyBg: Object.keys(bg).filter((k) => !(k in en)),
    onlyEn: Object.keys(en).filter((k) => !(k in bg)),
  };
};

const main = () => {
  const apply = process.argv.includes("--apply");
  const bg = loadCorpus("bg");
  const en = loadCorpus("en");
  const usage = analyzeKeyUsage(Object.keys(bg));
  const plan = planPrune(bg, en, usage.unused);

  // Parity first: a drifted corpus has its extra keys silently exempted from
  // the prune, which is the right behaviour and the wrong thing to do quietly.
  if (plan.onlyBg.length || plan.onlyEn.length) {
    console.warn(
      `corpora are not key-for-key parallel — bg-only ${plan.onlyBg.length}, en-only ${plan.onlyEn.length}. ` +
        `Pruning the intersection only.`,
    );
    if (plan.onlyBg.length)
      console.warn("  bg only: " + plan.onlyBg.join(", "));
    if (plan.onlyEn.length)
      console.warn("  en only: " + plan.onlyEn.join(", "));
  }

  console.log(
    `${Object.keys(bg).length} keys · ${usage.literal.size} named · ` +
      `${usage.built.size} built · ${usage.plural.size} plural · ${plan.dead.length} dead`,
  );
  for (const k of [...plan.dead].sort()) {
    console.log(`  - ${k}  ${JSON.stringify(bg[k]).slice(0, 70)}`);
  }

  if (!plan.dead.length) {
    console.log("nothing to prune");
    return;
  }

  // Per FILE, never as one corpus. The corpus is partitioned across
  // translation.json plus one file per deferred bundle (src/locales/bundles.ts),
  // so writing the kept set to translation.json alone would fold every bundle
  // back into the core chunk — undoing the split and handing the byte budgets
  // back their whole overage, with the key count reconciling perfectly.
  for (const lang of ["bg", "en"] as const) {
    const before = lang === "bg" ? bg : en;
    const kept = plan.kept[lang];
    let written = 0;
    for (const file of CORPUS_PATHS(lang)) {
      if (!fs.existsSync(file)) continue;
      const current: Record<string, string> = JSON.parse(
        fs.readFileSync(file, "utf8"),
      );
      const next = Object.fromEntries(
        Object.entries(current).filter(([k]) => k in kept),
      );
      written += Object.keys(next).length;
      if (apply && Object.keys(next).length !== Object.keys(current).length) {
        fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
      }
    }
    console.log(
      apply
        ? `${lang}: ${Object.keys(before).length} -> ${written} keys written`
        : `${lang}: would write ${written} keys (${Object.keys(before).length - written} removed)`,
    );
  }

  if (!apply) console.log("\ndry run — pass --apply to write");
};

// Importable for its planner without running the CLI — the tests need the
// former and must never trigger the latter.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
