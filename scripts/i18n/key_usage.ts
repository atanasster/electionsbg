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
import { stripComments as sharedStripComments } from "../lib/strip_comments";
import { LOCALE_BUNDLES } from "../../src/locales/bundles";

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

/** Not call sites: this analysis and the prune script that drives it. Matched
 *  with POSIX separators on both sides — `path.join` yields `scripts\\i18n` on
 *  Windows, where a raw endsWith would never fire and this directory's own
 *  prefix examples would be read as call sites, keeping every family it
 *  discusses alive. */
const SKIP_DIRS = ["scripts/i18n"];
const posix = (p: string) => p.split(path.sep).join("/");

/** Shallow, because data/ holds ~hundreds of thousands of generated files and
 *  none of the deep ones carries an i18n key. */
export const SCAN_DATA_JSON = "data";

/** CLDR plural categories, plus i18next's ordinal forms. */
const PLURAL_SUFFIX = /_(?:ordinal_)?(?:zero|one|two|few|many|other)$/;

const CODE = /\.(ts|tsx|js|jsx|mjs)$/;
const TEST = /\.(test|spec|harness)\.(ts|tsx|js|jsx|mjs)$/;

export interface ScannedFile {
  /** Repo-relative, POSIX separators. */
  path: string;
  text: string;
  /** Tests may NAME a key but must never contribute a PATTERN — see buildScan. */
  isTest: boolean;
}

const readCode = (
  dir: string,
  root: string,
  out: ScannedFile[],
): ScannedFile[] => {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      // The corpora themselves are not call sites — every key "appears" there.
      const skip =
        e.name === "locales" ||
        e.name === "node_modules" ||
        // Dot-directories are somebody else's dependencies, not call sites.
        // `ai/m0/.venv` is a Python virtualenv inside a scanned tree and put 33
        // vendor JS files into the corpus: their string literals can widen
        // PREFIX_LITERAL and keep a dead key alive, which makes the verdict a
        // function of a developer's working tree rather than of tracked code.
        e.name.startsWith(".") ||
        SKIP_DIRS.some((d) => posix(p).endsWith(d));
      if (!skip) readCode(p, root, out);
    } else if (CODE.test(e.name)) {
      out.push({
        path: posix(path.relative(root, p)),
        text: fs.readFileSync(p, "utf8"),
        isTest: TEST.test(e.name),
      });
    }
  }
  return out;
};

/** Every file either gate treats as a call site, read once. Shared with
 *  scripts/i18n/bundles.ts, which asks the same question per FILE rather than
 *  over the concatenation — so the two cannot disagree about what a call site
 *  is. */
export const scanFiles = (root = process.cwd()): ScannedFile[] => {
  const out: ScannedFile[] = [];
  for (const d of SCAN_DIRS) readCode(path.join(root, d), root, out);
  return out;
};

/** Shallow, because data/ holds ~hundreds of thousands of generated files and
 *  none of the deep ones carries an i18n key. A generated artifact may NAME a
 *  key, never widen the rules — so these are read as text and never scanned for
 *  patterns. */
export const readDataJson = (root = process.cwd()): ScannedFile[] => {
  const dir = path.join(root, SCAN_DATA_JSON);
  const out: ScannedFile[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith(".json")) {
      out.push({
        path: posix(path.join(SCAN_DATA_JSON, e.name)),
        text: fs.readFileSync(path.join(dir, e.name), "utf8"),
        isTest: false,
      });
    }
  }
  return out;
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Line-owning comments only — never the `trailing` form. A key literal
 *  routinely shares a line with a string that contains `//`, and stripping from
 *  there ate PersonProfileScreen's `pp_reg_seat_${seat}` template and reported
 *  15 live keys as dead. `src/entryGraph.test.ts` opts in because an import
 *  statement cannot share a line with a URL; this scan is the counter-example
 *  that made the option a parameter. Rules and their arms: scripts/lib. */
const stripComments = (code: string) => sharedStripComments(code);

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

interface Scan {
  patterns: RegExp[];
  withData: string;
}

const buildScan = (root: string): Scan => {
  const files = scanFiles(root);
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
  return {
    patterns: builtKeyPatterns(
      files
        .filter((f) => !f.isTest)
        .map((f) => f.text)
        .join("\n"),
    ),
    withData: [...files, ...readDataJson(root)].map((f) => f.text).join("\n"),
  };
};

/** The scan is deterministic per root and costs ~33.6 MB of reads; the four
 *  discrimination tests call analyzeKeyUsage five times between them. Cached by
 *  root rather than globally so a future test can point it at a fixture tree. */
const scanCache = new Map<string, Scan>();

export const analyzeKeyUsage = (
  keys: string[],
  root = process.cwd(),
): KeyUsage => {
  const scan = scanCache.get(root) ?? buildScan(root);
  scanCache.set(root, scan);
  const { patterns, withData } = scan;
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

/** The corpus is authored as ONE flat namespace and only PARTITIONED across
 *  files — core plus one per deferred bundle (src/locales/bundles.ts) — so
 *  every question this module answers is asked of the union. Reading only
 *  translation.json would report all ~1.1k bundled keys as dead the day the
 *  split landed, and the prune would then delete them. */
export const CORPUS_PATHS = (lang: "bg" | "en", root = process.cwd()) => [
  path.join(root, `src/locales/${lang}/translation.json`),
  ...LOCALE_BUNDLES.map((b) =>
    path.join(root, `src/locales/${lang}/${b}.json`),
  ),
];

export const loadCorpus = (
  lang: "bg" | "en",
  root = process.cwd(),
): Record<string, string> => {
  const all: Record<string, string> = {};
  for (const p of CORPUS_PATHS(lang, root)) {
    if (fs.existsSync(p))
      Object.assign(all, JSON.parse(fs.readFileSync(p, "utf8")));
  }
  return all;
};
