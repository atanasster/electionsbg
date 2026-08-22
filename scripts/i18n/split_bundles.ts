// Move translation keys between the core corpus and the deferred bundles, to
// match what scripts/i18n/bundles.ts proves about route reachability.
//
// Dry-run by default; `--apply` writes. Idempotent and BIDIRECTIONAL: a key
// that stops being exclusive to its bundle's routes comes back to core, which
// is what makes the gate's failure actionable — it names the key, this fixes
// it, and the two read the same analysis so they cannot disagree.
//
// Deliberately in no chain. Splitting the corpus changes which chunk a string
// ships in, so it wants a measurement afterwards (the per-language brotli
// budgets in tests/perf.spec.ts) rather than to happen silently inside a
// refresh.
import fs from "node:fs";
import path from "node:path";
import { analyzeBundles } from "./bundles";
import { LOCALE_BUNDLES } from "../../src/locales/bundles";
import { REPO_ROOT } from "../lib/module_graph";

const LANGS = ["bg", "en"] as const;
const apply = process.argv.includes("--apply");

const filePath = (lang: string, bundle: string | null) =>
  path.join(REPO_ROOT, "src/locales", lang, `${bundle ?? "translation"}.json`);

const read = (lang: string, bundle: string | null): Record<string, string> => {
  const p = filePath(lang, bundle);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
};

// The corpus is authored as one namespace and only PARTITIONED across files, so
// the union is the corpus. Reading it back per language also catches a file
// that has drifted out of parity on its own.
const union = (lang: string) => {
  const all: Record<string, string> = {};
  for (const b of [null, ...LOCALE_BUNDLES]) Object.assign(all, read(lang, b));
  return all;
};

const bgAll = union("bg");
const analysis = analyzeBundles(Object.keys(bgAll));

let moved = 0;
for (const lang of LANGS) {
  const all = union(lang);
  const out = new Map<string | null, Record<string, string>>();
  for (const b of [null, ...LOCALE_BUNDLES]) out.set(b, {});
  // Corpus order is preserved per destination file, so a re-run produces no
  // diff and a real move is readable.
  for (const [key, value] of Object.entries(all)) {
    const target = analysis.verdicts.get(key)?.bundle ?? null;
    out.get(target)![key] = value;
  }
  for (const b of [null, ...LOCALE_BUNDLES]) {
    const before = read(lang, b);
    const after = out.get(b)!;
    const added = Object.keys(after).filter((k) => !(k in before)).length;
    const removed = Object.keys(before).filter((k) => !(k in after)).length;
    if (added || removed) moved += added + removed;
    console.log(
      `${lang}/${b ?? "translation"}.json: ${Object.keys(after).length} keys` +
        (added || removed ? `  (+${added} / -${removed})` : ""),
    );
    if (apply) {
      fs.writeFileSync(
        filePath(lang, b),
        JSON.stringify(after, null, 2) + "\n",
      );
    }
  }
}

const reasons = new Map<string, number>();
for (const v of analysis.verdicts.values()) {
  if (v.bundle) continue;
  reasons.set(
    v.reason.replace(/ \(.*\)$/, ""),
    (reasons.get(v.reason.replace(/ \(.*\)$/, "")) ?? 0) + 1,
  );
}
console.log(
  `\n${analysis.routeEntries.filter((r) => r.bundle).length}/${analysis.routeEntries.length} routes tagged; ` +
    `${[...analysis.byBundle.values()].reduce((n, k) => n + k.length, 0)} of ${Object.keys(bgAll).length} keys deferred.`,
);
console.log("kept in core because:");
for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(5)}  ${r}`);
}
if (!apply)
  console.log(`\n(dry run — ${moved} key moves; pass --apply to write)`);
