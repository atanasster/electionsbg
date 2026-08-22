// Which translation keys may leave the core corpus, and for which route.
//
// Every page downloads the core corpus before it can paint, so the corpus is a
// byte budget shared by the whole site (tests/perf.spec.ts). A DEFERRED BUNDLE
// (src/locales/bundles.ts) is a slice of it that ships with a route group
// instead — legitimate only when no other route can ask for those keys, since a
// key whose bundle is not loaded renders as its own identifier at a 200.
//
// This is the analysis that decides that, and it is used twice: by
// scripts/i18n/split_bundles.ts to MOVE the keys, and by
// scripts/i18n/bundle_reachability.test.ts to keep the decision true as the app
// changes. One module, so a screen that starts naming a bundled key cannot pass
// the gate and fail the reader.
//
// It is BIASED TOWARD CORE in every ambiguous case, because the two errors are
// not symmetric: keeping a key in core costs bytes, deferring one wrongly
// renders `budget_hub_title` where a heading belongs. Anything named outside
// src/, named by a module no route statically reaches, or reachable from the
// shell or from an untagged route stays in core.
//
// ⚠️ TEST FILES ARE NOT OWNERS. A budget screen's test names every key it
// asserts on and ships to nobody; counting it would put the whole bundle back
// in core. They are excluded here and only here — key_usage.ts still reads them,
// because a key a test names is a key whose deletion should fail loudly.
import fs from "node:fs";
import path from "node:path";
import {
  builtKeyPatterns,
  scanFiles,
  readDataJson,
  loadCorpus,
} from "./key_usage";
import { REPO_ROOT, walk, type WalkOptions } from "../lib/module_graph";

/** CLDR plural categories, plus i18next's ordinal forms — the same set
 *  key_usage.ts uses. A plural form is never written down at a call site, so it
 *  inherits its base's owners. */
const PLURAL_SUFFIX = /_(?:ordinal_)?(?:zero|one|two|few|many|other)$/;

export interface RouteEntry {
  /** Absolute path of the screen module the route lazy-imports. */
  file: string;
  /** The bundle it declares via withBundle(), or null for a plain lazy(). */
  bundle: string | null;
}

/** Both route shapes in src/routes.tsx. `withBundle` is the tagged one; the
 *  bare `lazy` is every other route, and it matters just as much — an untagged
 *  route that can reach a key is exactly what forces that key to stay in core. */
const TAGGED_ROUTE =
  /withBundle\(\s*["']([a-z]+)["']\s*,\s*\(\)\s*=>\s*import\(\s*["']([^"']+)["']/g;
const PLAIN_ROUTE =
  /\blazy\(\s*(?:async\s*)?\(\)\s*=>\s*import\(\s*["']([^"']+)["']/g;

const SPEC_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  "/index.ts",
  "/index.tsx",
];

const resolveRouteSpec = (
  spec: string,
  from: string,
  srcDir: string,
): string | null => {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(srcDir, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const s of SPEC_SUFFIXES) {
    if (fs.existsSync(base + s) && fs.statSync(base + s).isFile())
      return base + s;
  }
  return null;
};

export const readRouteEntries = (root = REPO_ROOT): RouteEntry[] => {
  const routesFile = path.join(root, "src", "routes.tsx");
  const text = fs.readFileSync(routesFile, "utf8");
  const srcDir = path.join(root, "src");
  const byFile = new Map<string, RouteEntry>();
  const add = (spec: string, bundle: string | null) => {
    const file = resolveRouteSpec(spec, routesFile, srcDir);
    if (!file) return;
    const prev = byFile.get(file);
    // A screen reachable as BOTH a tagged and an untagged route is untagged for
    // this analysis: the untagged path would render it with no bundle loaded.
    if (prev) {
      if (prev.bundle !== bundle) prev.bundle = null;
      return;
    }
    byFile.set(file, { file, bundle });
  };
  for (const m of text.matchAll(TAGGED_ROUTE)) add(m[2], m[1]);
  // A withBundle() call contains a lazy-shaped import too, so this second pass
  // would re-add the same file as untagged — add() keeps the first entry per
  // file and the tagged pass ran first.
  for (const m of text.matchAll(PLAIN_ROUTE)) {
    if (byFile.has(resolveRouteSpec(m[1], routesFile, srcDir) ?? "")) continue;
    add(m[1], null);
  }
  return [...byFile.values()];
};

interface OwnerFile {
  abs: string;
  rel: string;
  /** Under src/ — everything else can name a key but never renders it, so it
   *  forces the key to core. */
  inSrc: boolean;
  text: string;
  patterns: RegExp[];
}

/** Corpus keys a file NAMES, indexed rather than searched.
 *
 *  The direct question — "does this file contain this key?" — is 6.3k keys x
 *  3.4k files of substring search, which is minutes. This inverts it: one pass
 *  over each file's identifier runs, emitting the run and every underscore-
 *  aligned prefix and suffix of it, so `budget_muni_transfer` in a SQL string
 *  still claims the key `budget_muni`. That is every real occurrence and it is
 *  not a proof — an unaligned substring match would be missed — so a key this
 *  index says is deferrable is re-checked EXACTLY against the text outside its
 *  routes before it may leave core. Missing an owner INSIDE the bundle is
 *  harmless: the key simply stays in core. */
const TOKEN = /[a-z][a-z0-9_]{2,}/g;

const namedKeys = (file: OwnerFile, keys: Set<string>): Set<string> => {
  const out = new Set<string>();
  for (const m of file.text.matchAll(TOKEN)) {
    const tok = m[0];
    if (keys.has(tok)) out.add(tok);
    let i = tok.indexOf("_");
    while (i !== -1) {
      const head = tok.slice(0, i);
      const tail = tok.slice(i + 1);
      if (keys.has(head)) out.add(head);
      if (keys.has(tail)) out.add(tail);
      i = tok.indexOf("_", i + 1);
    }
  }
  for (const p of file.patterns) {
    for (const k of keys) if (p.test(k)) out.add(k);
  }
  return out;
};

export type KeyVerdict = {
  bundle: string | null;
  reason: string;
  entries: string[];
};

export interface BundleAnalysis {
  /** key -> verdict. Every key handed in appears exactly once. */
  verdicts: Map<string, KeyVerdict>;
  /** bundle -> its keys, in corpus order. */
  byBundle: Map<string, string[]>;
  routeEntries: RouteEntry[];
  shellSize: number;
}

export const analyzeBundles = (
  keys: string[],
  root = REPO_ROOT,
  /** Route list override, for the gate's mutation check — untagging a route
   *  must move its keys back to core, and an assertion that cannot demonstrate
   *  that is satisfied by an analysis which has stopped tagging anything. */
  entriesOverride?: RouteEntry[],
): BundleAnalysis => {
  const srcDir = path.join(root, "src");
  const files: OwnerFile[] = [
    ...scanFiles(root).filter((f) => !f.isTest),
    ...readDataJson(root),
  ].map((f) => ({
    abs: path.join(root, f.path),
    rel: f.path,
    inSrc: f.path.startsWith("src/"),
    text: f.text,
    // A generated artifact may NAME a key, never widen the rules — the same
    // asymmetry key_usage.ts applies to data/.
    patterns: f.path.startsWith("data/") ? [] : builtKeyPatterns(f.text),
  }));

  const keySet = new Set(keys);
  const owners = new Map<string, OwnerFile[]>();
  for (const f of files) {
    for (const k of namedKeys(f, keySet)) {
      if (!owners.has(k)) owners.set(k, []);
      owners.get(k)!.push(f);
    }
  }

  // DYNAMIC EDGES COUNT HERE, unlike in src/entryGraph.test.ts. A screen that
  // lazy-loads a tile still RENDERS that tile, so the tile's keys are reachable
  // from that screen's route — following only static imports would leave such a
  // tile in no closure at all and, if it happened to sit inside a bundle's own
  // subtree, let its keys be deferred while an untagged screen renders them.
  // src/routes.tsx is excluded because its dynamic imports ARE the route
  // entries: each is walked separately and carries its own tag, and following
  // them from the shell would collapse all 305 routes into one closure.
  const wide: WalkOptions = {
    dynamic: true,
    dynamicExcept: new Set([path.join(srcDir, "routes.tsx")]),
  };
  const shell = walk([path.join(srcDir, "main.tsx")], srcDir, wide).seen;
  const routeEntries = entriesOverride ?? readRouteEntries(root);
  const closures = routeEntries.map((e) => ({
    entry: e,
    seen: walk([e.file], srcDir, wide).seen,
  }));

  // Per bundle: the modules ONLY its own routes reach, and the exact text of
  // every other file in the repo.
  //
  // This is what makes the verdict a proof rather than a consequence of the
  // index above. `allowed` subtracts the shell AND every other route's closure,
  // so a module shared with anything else lands in `outside` and its text is
  // scanned for the key with plain `includes`. Two things follow, and both
  // matter more than they look:
  //   - the route parser does not have to be COMPLETE. A route shape it fails
  //     to recognise leaves that route's modules outside every closure, hence
  //     in `outside`, hence forcing its keys to core.
  //   - the index does not have to be EXACT. It can only fail to notice an
  //     owner, and every file it could have missed is in `outside` too.
  const bundles = [...new Set(routeEntries.map((r) => r.bundle))].filter(
    (b): b is string => b !== null,
  );
  const outside = new Map<string, { text: string; patterns: RegExp[] }>();
  for (const b of bundles) {
    const elsewhere = new Set<string>(shell);
    for (const c of closures) {
      if (c.entry.bundle === b) continue;
      for (const f of c.seen) elsewhere.add(f);
    }
    const allowed = new Set<string>();
    for (const c of closures) {
      if (c.entry.bundle !== b) continue;
      for (const f of c.seen) if (!elsewhere.has(f)) allowed.add(f);
    }
    const out = files.filter((f) => !allowed.has(f.abs));
    outside.set(b, {
      text: out.map((f) => f.text).join("\n"),
      patterns: out.flatMap((f) => f.patterns),
    });
  }

  const verdicts = new Map<string, KeyVerdict>();
  const byBundle = new Map<string, string[]>();

  for (const key of keys) {
    let found = owners.get(key) ?? [];
    if (!found.length) {
      const base = key.replace(PLURAL_SUFFIX, "");
      if (base !== key) found = owners.get(base) ?? [];
    }
    const entriesOf = (fs_: OwnerFile[]) =>
      closures.filter((c) => fs_.some((o) => c.seen.has(o.abs)));
    const core = (reason: string, entries: string[] = []) =>
      verdicts.set(key, { bundle: null, reason, entries });

    if (!found.length) {
      core("no call site names it");
      continue;
    }
    const foreign = found.find((o) => !o.inSrc);
    if (foreign) {
      core(`named outside src/ (${foreign.rel})`);
      continue;
    }
    const shellOwner = found.find((o) => shell.has(o.abs));
    if (shellOwner) {
      core(`reachable from the shell (${shellOwner.rel})`);
      continue;
    }
    const hit = entriesOf(found);
    const entries = hit.map((c) => path.relative(srcDir, c.entry.file)).sort();
    if (!hit.length) {
      core("no route reaches its call sites");
      continue;
    }
    const tags = new Set(hit.map((c) => c.entry.bundle));
    const only = tags.size === 1 ? [...tags][0] : null;
    if (!only) {
      core(
        tags.has(null)
          ? "also reachable from a route with no bundle"
          : "reachable from routes in different bundles",
        entries,
      );
      continue;
    }
    // The index is aligned-token; this is the exact check that makes the
    // verdict a proof. Anything outside the bundle's own modules that contains
    // the key as a raw substring — or builds it — sends it back to core.
    const out = outside.get(only)!;
    if (out.text.includes(key) || out.patterns.some((p) => p.test(key))) {
      core("named outside its own routes (exact scan)", entries);
      continue;
    }
    verdicts.set(key, { bundle: only, reason: "exclusive", entries });
    if (!byBundle.has(only)) byBundle.set(only, []);
    byBundle.get(only)!.push(key);
  }
  return { verdicts, byBundle, routeEntries, shellSize: shell.size };
};

export { loadCorpus };
