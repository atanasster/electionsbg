// The static import graph over the SOURCES, in milliseconds.
//
// Two gates need the same walk and must not drift apart:
//   - src/entryGraph.test.ts — what may be a static import of the entry chunk;
//   - scripts/i18n/bundle_reachability.test.ts — which routes can reach a
//     module, and therefore which translation keys a deferred locale bundle
//     may hold.
//
// The second is the reason this moved out of the first. A key is deferrable
// only if EVERY module that names it sits behind the routes that load the
// bundle, so the two questions are one walk asked from different seeds — and a
// resolver that quietly stopped following an alias would make the entry gate
// green and the bundle gate WRONG, which ships raw keys.
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./strip_comments";

/** Both gates run under vitest from the repo root, which is also what
 *  scripts/i18n/key_usage.ts assumes. Kept as a call rather than a constant so
 *  a future fixture tree can point the walk somewhere else. */
export const REPO_ROOT = process.cwd();
export const SRC_DIR = path.join(REPO_ROOT, "src");

const EXTS = [".ts", ".tsx", ".js", ".jsx", ".json", ".css"];

/** Source files that carry runtime code. `.json` and `.css` are graph NODES
 *  (they can be imported) but never have edges of their own. */
export const CODE = /\.(ts|tsx|js|jsx)$/;

export const resolveSpec = (
  spec: string,
  from: string,
  srcDir = SRC_DIR,
): string | null => {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(srcDir, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null; // bare specifier — node_modules, a vendor-* chunk's problem
  for (const suffix of ["", ...EXTS, ...EXTS.map((e) => `/index${e}`)]) {
    const p = base + suffix;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
};

// `import type` / `export type` STATEMENTS are erased before Rollup sees them
// and are excluded here. Inline `{ type X }` specifiers are erased too but ARE
// counted — deliberately, because separating them needs a specifier parser and
// the error is in the safe direction: a type-only import of a forbidden module
// fails the entry gate rather than passing it, and over-attributes an owner in
// the bundle gate, which keeps a key in core.
//
// A bare `import(...)` is the lazy boundary both gates are about and must not
// match — hence the required `from` clause (or a side-effect `import "…"`),
// which a call expression never has. Asserted in src/entryGraph.test.ts, since
// relaxing it would swallow every lazy route.
export const EDGE =
  /(?:^|[\s;}])import\s+(?!type\b)(?:[^'"();]*?\s+from\s+)?["']([^"']+)["']|(?:^|[\s;}])export\s+(?!type\b)(?:\*|\{[^}]*\})\s+from\s+["']([^"']+)["']/g;

/** Comments are not edges, in either direction — and the second direction is
 *  the one that costs something. A comment that DISCUSSES a forbidden import
 *  (routes.tsx and sectorPacks.tsx both carry one) reads as a phantom edge and
 *  fails loudly; a trailing comment INSIDE an import's braces steals the match
 *  from the real specifier and the gate passes while the edge it exists to
 *  catch is present:
 *
 *    import {
 *      a, // from "./x"
 *    } from "./sectorPacks";      -> matched "./x", missed "./sectorPacks"
 *
 *  `trailing` is what closes that, and is safe here for a reason that does not
 *  generalise — see scripts/lib/strip_comments.ts. */
/** Edges are a pure function of the file on disk, and the bundle analysis asks
 *  for the same file from up to 305 route closures. Cached for the process. */
const staticCache = new Map<string, string[]>();
const dynamicCache = new Map<string, string[]>();

export const edgesOf = (file: string, srcDir = SRC_DIR): string[] => {
  const hit = staticCache.get(file);
  if (hit) return hit;
  const out = readStaticEdges(file, srcDir);
  staticCache.set(file, out);
  return out;
};

const readStaticEdges = (file: string, srcDir: string): string[] =>
  [
    ...stripComments(fs.readFileSync(file, "utf8"), {
      trailing: true,
    }).matchAll(EDGE),
  ]
    .map((m) => resolveSpec(m[1] ?? m[2], file, srcDir))
    .filter((p): p is string => p !== null);

/** A dynamic `import("…")`. NOT an edge for the entry-chunk question — it is
 *  precisely the boundary that gate is about — but it IS one for the locale
 *  bundles: a screen that lazy-loads a tile still renders that tile, so the
 *  tile's translation keys are reachable from that screen's route. */
export const DYNAMIC_EDGE = /\bimport\(\s*["']([^"']+)["']/g;

export const dynamicEdgesOf = (file: string, srcDir = SRC_DIR): string[] => {
  const hit = dynamicCache.get(file);
  if (hit) return hit;
  const out = readDynamicEdges(file, srcDir);
  dynamicCache.set(file, out);
  return out;
};

const readDynamicEdges = (file: string, srcDir: string): string[] =>
  [
    ...stripComments(fs.readFileSync(file, "utf8"), {
      trailing: true,
    }).matchAll(DYNAMIC_EDGE),
  ]
    .map((m) => resolveSpec(m[1], file, srcDir))
    .filter((p): p is string => p !== null);

export interface WalkOptions {
  /** Follow dynamic `import()` as well as static imports. */
  dynamic?: boolean;
  /** Files whose DYNAMIC edges are not followed even when `dynamic` is set.
   *  src/routes.tsx is the one that matters: its dynamic imports are the route
   *  entries themselves, each of which is walked separately and carries its own
   *  bundle tag, so following them from here would collapse every route into
   *  one closure and make nothing deferrable. */
  dynamicExcept?: Set<string>;
}

export interface Walk {
  /** Every module reachable from the seeds without crossing a lazy boundary. */
  seen: Set<string>;
  /** dep -> the module that pulled it in, for a readable failure. */
  importedBy: Map<string, string>;
}

/** Static closure of `seeds`. Dynamic `import()` is NOT an edge, so the walk
 *  stops at every lazy boundary — which is exactly what makes "this module is
 *  only reachable from route X" a meaningful statement. */
export const walk = (
  seeds: string[],
  srcDir = SRC_DIR,
  options: WalkOptions = {},
): Walk => {
  const importedBy = new Map<string, string>();
  const seen = new Set(seeds);
  const stack = [...seeds];
  while (stack.length) {
    const file = stack.pop()!;
    if (!CODE.test(file)) continue;
    const deps = edgesOf(file, srcDir);
    if (options.dynamic && !options.dynamicExcept?.has(file)) {
      deps.push(...dynamicEdgesOf(file, srcDir));
    }
    for (const dep of deps) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      importedBy.set(dep, file);
      stack.push(dep);
    }
  }
  return { seen, importedBy };
};

export const chainTo = (
  file: string,
  importedBy: Map<string, string>,
  root = REPO_ROOT,
): string => {
  const chain: string[] = [];
  let cur: string | undefined = file;
  while (cur) {
    chain.push(path.relative(root, cur));
    cur = importedBy.get(cur);
  }
  return chain.reverse().join("\n  -> ");
};
