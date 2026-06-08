// One-off audit: how many already-committed JSON files carry an acronym
// that the OLD normaliser mangled (title-cased) but the FIXED normaliser
// preserves. Read-only — writes nothing.
//
// Method: for every file the two renormalise commits touched, take the
// FAITHFUL pre-normalise version from git (the ingest output, before any
// casing pass), run it through the FIXED pipeline, and compare each
// name/label field against the CURRENT on-disk value. A field counts as
// "mangled" when the letters are identical case-insensitively (so it is a
// pure casing diff, not a re-ingested data change) AND the fixed output
// differs from what is on disk now.
//
// Run: npx tsx scripts/lib/__audit_mangling.ts
import { execSync } from "node:child_process";
import {
  normaliseOrgName,
  repairTitleCasedAcronym,
  stripDefiniteArticle,
  sentenceCaseLabel,
} from "./normalize_name";

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
const LABEL_FIELDS = new Set(["labelBg"]);
const DEFINITE_ARTICLE_FIELDS = new Set(["unitName", "nameBg"]);

const FIRST_PASS = "3d1cba595"; // cross-tree normalisation (older)
const SECOND_PASS = "ddce07c4b"; // 2-3 letter brand acronym pass (newer)

const namePipe = (v: string, key: string): string => {
  if (LABEL_FIELDS.has(key)) return sentenceCaseLabel(v);
  let out = repairTitleCasedAcronym(normaliseOrgName(v));
  if (DEFINITE_ARTICLE_FIELDS.has(key)) out = stripDefiniteArticle(out);
  return out;
};

// True iff a and b are identical except for letter case — same length, and
// every char is equal or a case-variant. This excludes re-ingest noise
// (whitespace collapse, punctuation edits, corrected text) and keeps only
// pure casing diffs, which is what a mangle is.
const sameModuloCase = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ca = a[i];
    const cb = b[i];
    if (ca === cb) continue;
    if (ca.toLowerCase() !== cb.toLowerCase()) return false;
  }
  return true;
};

// Collect name/label field (key,value) pairs in document order.
const collect = (
  value: unknown,
  parentKey: string | undefined,
  acc: Array<{ key: string; value: string }>,
): void => {
  if (typeof value === "string") {
    if (
      parentKey &&
      (NAME_FIELDS.has(parentKey) || LABEL_FIELDS.has(parentKey))
    )
      acc.push({ key: parentKey, value });
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collect(v, parentKey, acc);
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      collect(v, k, acc);
  }
};

const gitFiles = (commit: string): string[] =>
  execSync(`git show ${commit} --name-only --pretty=format: 2>/dev/null`, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  })
    .split("\n")
    .filter((l) => l.startsWith("data/") && l.endsWith(".json"));

const showJson = (commit: string, file: string): unknown | null => {
  try {
    const raw = execSync(`git show ${commit}:${file} 2>/dev/null`, {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const readDiskJson = (file: string): unknown | null => {
  try {
    return JSON.parse(
      execSync(`cat ${file} 2>/dev/null`, {
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
      }),
    );
  } catch {
    return null;
  }
};

const first = new Set(gitFiles(FIRST_PASS));
const second = new Set(gitFiles(SECOND_PASS));
const allFiles = new Set<string>([...first, ...second]);

interface TreeStat {
  mangledFiles: number;
  mangledFields: number;
  structureSkipped: number;
  examples: string[];
}
const treeOf = (f: string): string => {
  const m = f.match(/^data\/budget\/capital_programs/);
  if (m) return "data/budget/capital_programs";
  return f.split("/").slice(0, 2).join("/");
};

const stats = new Map<string, TreeStat>();
const stat = (t: string): TreeStat => {
  let s = stats.get(t);
  if (!s) {
    s = {
      mangledFiles: 0,
      mangledFields: 0,
      structureSkipped: 0,
      examples: [],
    };
    stats.set(t, s);
  }
  return s;
};

let scanned = 0;
let derivedSkipped = 0;
for (const file of allFiles) {
  // Derived / re-joined files (political_links, rankings, graphs) reorder
  // their entries between faithful and current, so the document-order zip
  // below would misalign. Exclude them — they regenerate from the primary
  // shards anyway, so they are not an independent mangling source.
  if (file.includes("/derived/") || file.includes("/by-eik/")) {
    derivedSkipped += 1;
    continue;
  }
  const base = first.has(file) ? `${FIRST_PASS}~1` : `${SECOND_PASS}~1`;
  let faithful = showJson(base, file);
  if (faithful === null && first.has(file))
    faithful = showJson(`${SECOND_PASS}~1`, file); // fall back
  if (faithful === null) continue; // file didn't exist pre-normalise
  const current = readDiskJson(file);
  if (current === null) continue; // deleted since
  scanned += 1;

  const fa: Array<{ key: string; value: string }> = [];
  const cu: Array<{ key: string; value: string }> = [];
  collect(faithful, undefined, fa);
  collect(current, undefined, cu);

  const t = treeOf(file);
  const s = stat(t);
  if (fa.length !== cu.length) {
    s.structureSkipped += 1; // re-ingested / schema drift — can't zip safely
    continue;
  }
  let fileMangled = 0;
  for (let i = 0; i < fa.length; i++) {
    const f = fa[i].value;
    const c = cu[i].value;
    if (!sameModuloCase(f, c)) continue; // not a pure casing diff (re-ingest)
    const fixed = namePipe(f, fa[i].key);
    if (fixed !== c) {
      fileMangled += 1;
      s.mangledFields += 1;
      if (s.examples.length < 4)
        s.examples.push(`${file}\n     on-disk: ${c}\n     fixed:   ${fixed}`);
    }
  }
  if (fileMangled > 0) s.mangledFiles += 1;
}

console.log(
  `Scanned ${scanned} files that existed before the normalise passes.\n`,
);
let totalFiles = 0;
let totalFields = 0;
for (const [t, s] of [...stats].sort(
  (a, b) => b[1].mangledFiles - a[1].mangledFiles,
)) {
  totalFiles += s.mangledFiles;
  totalFields += s.mangledFields;
  console.log(
    `${t.padEnd(34)} ${String(s.mangledFiles).padStart(4)} files  ${String(
      s.mangledFields,
    ).padStart(6)} fields  (${s.structureSkipped} re-ingested/skip)`,
  );
}
console.log(
  `\nTOTAL: ${totalFiles} mangled files, ${totalFields} mangled fields ` +
    `(${derivedSkipped} derived/by-eik files excluded from zip).\n`,
);
console.log("Sample corrections:");
for (const [, s] of stats)
  for (const ex of s.examples) console.log("  • " + ex);
