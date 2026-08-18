// Which translation keys the app can actually ask for.
//
// The corpus is one flat namespace of ~6.6k keys that every page loads in full
// (src/i18n.ts), so a key nobody calls is wire bytes on the critical path of the
// whole site — it comes out of the per-language budgets in tests/perf.spec.ts.
// This reader is shared by the prune script and its gate, so "unused" means
// exactly one thing in both.
//
// Everything here is BIASED TOWARD KEEPING. Over-keeping costs a few bytes;
// under-keeping renders `pp_role_mayor` where a job title belongs, on a page
// nobody is watching. Hence four ways a key counts as used, three of which
// never spell it out:
//
//  1. it appears as a LITERAL — covers t("x"), and the keys read out of
//     registries (t(tile.titleKey)), since the literal is stored in src;
//  2. it matches an INTERPOLATED TEMPLATE that plausibly builds a key —
//     inside t(), or assigned to a *key*-named variable, which is the shape
//     most call sites use (`const key = `official_role_${role}``);
//  3. it matches a PREFIX literal — `labelWith(t, "pp_role_", role)` hands the
//     family over as a plain string, so any literal ending in `_` opens it;
//  4. it is a PLURAL form of a used base — i18next resolves
//     t("council_n_resolutions", { count }) to _one/_other and neither suffixed
//     key is ever written down.
//
// Rule 2 is deliberately not "every template literal in the codebase". That
// version exists (it was measured) and keeps 800 keys instead of 300, because
// class names, URLs and query keys are templates too: `${x}_title` alone keeps
// every *_title key in the corpus. Widening it is how this analysis stops
// discriminating; the gate asserts it still does.
import fs from "node:fs";
import path from "node:path";

/** Scanned for both literals and built-key patterns.
 *
 *  `ai/` is here because it is none of src/scripts/functions, and a "who reads
 *  this?" sweep that skipped it has already shipped a defect (see the
 *  company-connections retirement in CLAUDE.md).
 *
 *  ALL of `scripts/` is here, not the two subtrees the FE obviously shares with
 *  it, because a key can reach the UI through a DATA ARTIFACT: `scripts/lib/
 *  data-changes.ts` writes `labelKey: "data_changes_link_parliament"` into
 *  data/data-changes.json and the screen renders t(link.labelKey). Scanning
 *  scripts/prerender + scripts/llms only, this analysis called 20 such keys
 *  dead — 12 in that family and 8 `analysis_stat_*_caption` from
 *  scripts/reports. The top-level data/*.json files are read for the same
 *  reason, as the belt to that braces: a hand-maintained artifact has no
 *  producer to grep. */
export const SCAN_DIRS = ["src", "scripts", "ai", "functions"];

/** Not call sites: this analysis and the prune script that drives it. */
const SKIP_DIRS = ["scripts/i18n"];

/** Shallow, because data/ holds ~hundreds of thousands of generated files and
 *  none of the deep ones carries an i18n key. */
export const SCAN_DATA_JSON = "data";

/** CLDR plural categories, plus i18next's ordinal forms. */
const PLURAL_SUFFIX = /_(?:ordinal_)?(?:zero|one|two|few|many|other)$/;

const CODE = /\.(ts|tsx|js|jsx|mjs)$/;
const TEST = /\.(test|spec|harness)\.(ts|tsx|js|jsx|mjs)$/;

const readCode = (
  dir: string,
  out: { all: string[]; runtime: string[] },
): typeof out => {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      // The corpora themselves are not call sites — every key "appears" there.
      const skip =
        e.name === "locales" ||
        e.name === "node_modules" ||
        SKIP_DIRS.some((d) => p.endsWith(d));
      if (!skip) readCode(p, out);
    } else if (CODE.test(e.name)) {
      const text = fs.readFileSync(p, "utf8");
      out.all.push(text);
      if (!TEST.test(e.name)) out.runtime.push(text);
    }
  }
  return out;
};

const readDataJson = (dir: string, out: string[]): string[] => {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith(".json")) {
      out.push(fs.readFileSync(path.join(dir, e.name), "utf8"));
    }
  }
  return out;
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Comments that OWN their line — a banner block or a `//` line — and nothing
 *  else. Both anchors are load-bearing, in the same direction: an unanchored
 *  `//` would take a string's `https://…` and every key literal after it on that
 *  line, and an unanchored block would start at any slash-star inside a string or
 *  a regex and swallow code up to the next star-slash. The second one is not theoretical:
 *  it ate PersonProfileScreen's `pp_reg_seat_${seat}` template and reported 15
 *  live keys as dead. */
const stripComments = (code: string) =>
  code
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");

/** Two shapes, because the call site is often not the construction site:
 *  a template handed straight to t(), and ANY template whose static head is a
 *  key-family prefix — `pp_reg_seat_${seat}`, wherever it is written. Keying the
 *  second rule on the variable name instead (…Key = `…`) was the first cut and
 *  was wrong: PersonProfileScreen writes `const k = `pp_reg_seat_${seat}``, so
 *  15 live keys came out as dead. */
const KEY_TEMPLATES = [
  /\bt\(\s*`([^`]*\$\{[^`]*)`/g,
  /`([a-z][a-z0-9]*(?:_[a-z0-9]+)*_\$\{[^`]*)`/g,
];

/** Any string literal that reads like a key family prefix. */
const PREFIX_LITERAL = /["']([a-z][a-z0-9]*(?:_[a-z0-9]+)*_)["']/g;

/**
 * Patterns for keys the code BUILDS rather than names. `a_${x}_b` becomes
 * /^a_.*_b$/ and `"pp_role_"` becomes /^pp_role_.+$/ — both wider than the key
 * set they were written for, which is the safe direction. A template with no
 * static text at all (`${party}#${item}`, not a corpus key) is skipped rather
 * than turned into /^.*$/.
 */
export const builtKeyPatterns = (rawCode: string): RegExp[] => {
  const code = stripComments(rawCode);
  const pats = new Set<string>();
  for (const re of KEY_TEMPLATES) {
    for (const m of code.matchAll(re)) {
      // Interpolations first, to a character no key contains, so the marker
      // survives regex-escaping of the literal text around it.
      const body = m[1].replace(/\$\{[^}]*\}/g, " ");
      if (!/[a-z]/.test(body.replace(/ /g, ""))) continue;
      pats.add("^" + body.split(" ").map(escape).join(".*") + "$");
    }
  }
  for (const m of code.matchAll(PREFIX_LITERAL)) {
    pats.add("^" + escape(m[1]) + ".+$");
  }
  return [...pats].map((p) => new RegExp(p));
};

export interface KeyUsage {
  /** Named outright somewhere in the code. */
  literal: Set<string>;
  /** Only producible by a template or a prefix, mapped to what produced it. */
  built: Map<string, string>;
  /** A plural form of a key that is itself used. */
  plural: Set<string>;
  /** Neither — no call site can ask for these. */
  unused: string[];
  patternCount: number;
}

export const analyzeKeyUsage = (
  keys: string[],
  root = process.cwd(),
): KeyUsage => {
  const chunks = { all: [] as string[], runtime: [] as string[] };
  for (const d of SCAN_DIRS) readCode(path.join(root, d), chunks);
  // Patterns come from RUNTIME code only — not from tests, and not from data.
  //
  // A test may NAME a key (deleting one then fails, loudly, which is the right
  // way round) but must not contribute a PATTERN: fundsHubCoverage.test.ts
  // asserts over a list of seven module prefixes, and read as call sites those
  // seven literals kept 45 keys alive that no screen renders. A generated
  // artifact is excluded in the other direction — it may name keys, never widen
  // the rules. Comments are stripped for the same reason, and so is this
  // directory: prose that mentions a prefix is not a call site, and a file that
  // scans for prefixes would otherwise keep every family it discusses,
  // including its own examples.
  const patterns = builtKeyPatterns(chunks.runtime.join("\n"));
  const withData = [
    ...chunks.all,
    ...readDataJson(path.join(root, SCAN_DATA_JSON), []),
  ].join("\n");

  const literal = new Set<string>();
  const built = new Map<string, string>();
  const plural = new Set<string>();
  const unused: string[] = [];
  const reachable = (k: string): RegExp | true | null => {
    // A substring test, not a token test: keys are read out of registries, run
    // through helpers and composed into arrays, so the only safe question is
    // whether the string occurs at all.
    if (withData.includes(k)) return true;
    return patterns.find((p) => p.test(k)) ?? null;
  };
  for (const k of keys) {
    const direct = reachable(k);
    if (direct === true) {
      literal.add(k);
      continue;
    }
    if (direct) {
      built.set(k, String(direct));
      continue;
    }
    const base = k.replace(PLURAL_SUFFIX, "");
    if (base !== k && reachable(base)) {
      plural.add(k);
      continue;
    }
    unused.push(k);
  }
  return { literal, built, plural, unused, patternCount: patterns.length };
};

export const CORPUS_PATH = (lang: "bg" | "en", root = process.cwd()) =>
  path.join(root, `src/locales/${lang}/translation.json`);

export const loadCorpus = (
  lang: "bg" | "en",
  root = process.cwd(),
): Record<string, string> =>
  JSON.parse(fs.readFileSync(CORPUS_PATH(lang, root), "utf8"));
