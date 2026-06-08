// One-off repair: restore faithful source casing to capital-programme
// project `name` (and `labelBg`) fields that the cross-tree
// `__renormalise_inplace.ts` casing passes (commits 3d1cba595 + ddce07c4b)
// mangled — title-casing embedded acronyms like ПМС→Пмс, ГПЧЕ→Гпче, УОС→уос,
// ЦГЧ→Цгч, ОР→Ор, АЗ→Аз. These `name` fields are free-text PROJECT
// DESCRIPTIONS, so their canonical form is simply the parser's faithful
// source casing (which lives unchanged in the pre-normalise git version —
// the per-município parsers never call the shared org-name normaliser).
//
// Mechanism: for each primary `{year}/{muni}.json`, diff the current file's
// name/label fields against the pre-normalise git version in document order
// and, where they differ ONLY by letter case, restore the faithful value.
// Numbers / structure are never touched. After running, regenerate the tile
// sidecars with __shrink_for_tile.ts.
//
// EXCLUDED:
//   - sofia*.json   — own dedicated normalizeName() (commit 1043add0e); its
//                     acronym gaps (e.g. СОПФ→сопф) are a separate concern.
//   - vidin*.json   — already re-parsed from source (commit f7d2ad989).
//
// This is a manual backfill — NOT wired into any watcher.
// Run: npx tsx scripts/budget/capital_programs/__unmangle_names.ts
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const NAME_FIELDS = new Set(["name", "labelBg"]);
const FIRST_PASS = "3d1cba595";
const SECOND_PASS = "ddce07c4b";
const PREFIX = "data/budget/capital_programs/";

const sameModuloCase = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (a[i].toLowerCase() !== b[i].toLowerCase()) return false;
  }
  return true;
};

const gitFiles = (commit: string): string[] =>
  execSync(`git show ${commit} --name-only --pretty=format:`, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  })
    .split("\n")
    .filter(
      (l) =>
        l.startsWith(PREFIX) &&
        l.endsWith(".json") &&
        !l.endsWith("-tile.json") &&
        !/\/(sofia|vidin)\.json$/.test(l),
    );

const showText = (ref: string): string | null => {
  try {
    return execSync(`git show ${ref}`, {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch {
    return null;
  }
};

// Collect name/label string values in document order.
const collect = (value: unknown, key: string | undefined, acc: string[]) => {
  if (typeof value === "string") {
    if (key && NAME_FIELDS.has(key)) acc.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collect(v, key, acc);
    return;
  }
  if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      collect(v, k, acc);
};

// Walk a parsed object, replacing each name/label field (in document order)
// with the next faithful value when it is a pure casing variant.
const restore = (
  value: unknown,
  key: string | undefined,
  faithful: string[],
  cursor: { i: number; changed: number },
): unknown => {
  if (typeof value === "string") {
    if (key && NAME_FIELDS.has(key)) {
      const f = faithful[cursor.i++];
      if (f !== undefined && f !== value && sameModuloCase(f, value)) {
        cursor.changed++;
        return f;
      }
    }
    return value;
  }
  if (Array.isArray(value))
    return value.map((v) => restore(v, key, faithful, cursor));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      out[k] = restore(v, k, faithful, cursor);
    return out;
  }
  return value;
};

const first = new Set(gitFiles(FIRST_PASS));
const second = new Set(gitFiles(SECOND_PASS));
const allFiles = [...new Set([...first, ...second])].sort();

let filesChanged = 0;
let fieldsChanged = 0;
for (const file of allFiles) {
  const base = first.has(file) ? `${FIRST_PASS}~1` : `${SECOND_PASS}~1`;
  const faithfulRaw = showText(`${base}:${file}`);
  if (faithfulRaw === null) continue; // didn't exist pre-normalise
  let faithful: unknown;
  let current: unknown;
  try {
    faithful = JSON.parse(faithfulRaw);
    current = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    console.warn(`  ! parse failed, skipping ${file}`);
    continue;
  }
  const faithfulNames: string[] = [];
  const currentNames: string[] = [];
  collect(faithful, undefined, faithfulNames);
  collect(current, undefined, currentNames);
  if (faithfulNames.length !== currentNames.length) {
    console.warn(
      `  ! field-count mismatch (${faithfulNames.length} vs ${currentNames.length}), skipping ${file}`,
    );
    continue;
  }
  const cursor = { i: 0, changed: 0 };
  const fixed = restore(current, undefined, faithfulNames, cursor);
  if (cursor.changed > 0) {
    writeFileSync(file, JSON.stringify(fixed, null, 2) + "\n", "utf8");
    filesChanged++;
    fieldsChanged += cursor.changed;
    console.log(`  ${file.replace(PREFIX, "")}: ${cursor.changed} field(s)`);
  }
}
console.log(
  `\n✓ restored ${fieldsChanged} mangled name fields across ${filesChanged} files`,
);
