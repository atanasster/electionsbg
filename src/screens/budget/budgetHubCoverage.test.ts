// Structural coverage for the /budget module (plan §11).
//
// The clause this file owns is „no unimported file in src/screens/budget/" —
// the /funds step-8 lesson: a half-finished move leaves a screen behind that
// nobody renders, nobody deletes, and the next reader takes for live code. It
// went unwritten through T5-T9, which added 27 files to this directory.
//
// The sibling clause, „every /budget/* sub-page is a hub destination", lives in
// `budgetHubRegistry.test.ts` as „fronts every /budget sub-page the router
// serves" — named here so a reader of §11 can find it rather than concluding it
// is missing too.
//
// ⚠️ A FALSE GREEN HERE IS THE DANGEROUS DIRECTION, and the first cut had two.
// Both are guarded below and both are proved still-guarded by the self-check at
// the foot of the file.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, normalize } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

/** Strip line comments FIRST, then block comments — INCLUDING trailing ones.
 *
 *  Load-bearing rather than tidy: a commented-out
 *  `lazy(() => import("@/screens/budget/X"))` left behind by the very
 *  half-finished move this gate exists to catch would otherwise mark X alive.
 *  That is the `/funds` step-8 shape exactly.
 *
 *  ⚠️ THE ORDER IS NOT COSMETIC. `routes.tsx:105` carries
 *  „// … Backed by /api/sql/* (the Vite plugin in dev …" — a block-comment
 *  OPENER inside a line comment. Stripping blocks first runs from there to the
 *  next `*&#47;` and swallows 15 of the router's lazy imports, which reported 31
 *  live files as dead. Line-first leaves all 15. The self-check below pins it.
 *
 *  Known limitation, stated rather than hidden: a `//` inside a STRING (a URL)
 *  truncates the rest of that line. No import in this repo shares a line with a
 *  URL literal, and the self-check would catch it if one ever did. */
const stripComments = (text: string): string =>
  text.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

/** Resolve an import specifier to a file on disk, or null for a package. */
const resolveSpec = (fromFile: string, spec: string): string | null => {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith("."))
    base = normalize(join(dirname(fromFile), spec));
  else return null;
  for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    if (existsSync(base + ext)) return base + ext;
  }
  return existsSync(base) ? base : null;
};

const listSources = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !e.name.includes(".test."))
        out.push(p);
    }
  };
  walk(SRC);
  return out;
};

/**
 * The reachable set, from the router down.
 *
 * Two properties are what make this mean anything:
 *
 *  * **Comments are stripped first** (see `stripComments`).
 *  * **`import type` does NOT count.** A type-only import is erased at build
 *    time and creates no runtime edge, so a dead screen whose props interface
 *    is imported by a live one would otherwise pass. 519 files in `src/` use
 *    type-only imports, so this is not a corner.
 *
 * Both forms of import are followed — static `from "…"` and the
 * `lazy(() => import("…"))` the router uses for every screen. Missing the
 * second makes literally every routed screen look unreachable, which is what a
 * first cut of this analysis reported.
 */
let cached: Set<string> | null = null;
const reachable = (): Set<string> => {
  if (cached) return cached;
  const files = listSources();
  const known = new Set(files);
  const edges = new Map<string, Set<string>>();
  for (const f of files) {
    const text = stripComments(readFileSync(f, "utf8"));
    const specs = [
      // `import type X from` / `import { type X }` are excluded: the negative
      // lookahead drops the statement form, and a mixed `import { type A, B }`
      // still has a runtime edge for B, so it is correctly kept.
      ...[
        ...text.matchAll(
          /(?:^|\n)\s*import\s+(?!type\s)[^;]*?from\s+"([^"]+)"/g,
        ),
      ],
      ...[...text.matchAll(/(?:^|\n)\s*export\s+[^;]*?from\s+"([^"]+)"/g)],
      ...[...text.matchAll(/import\(\s*"([^"]+)"\s*\)/g)],
    ].map((m) => m[1]);
    const out = new Set<string>();
    for (const s of specs) {
      const t = resolveSpec(f, s);
      if (t && known.has(t)) out.add(t);
    }
    edges.set(f, out);
  }
  const roots = files.filter((f) => /\/(routes|main|App)\.tsx$/.test(f));
  expect(
    roots.length,
    "no entry points found — the walk is broken",
  ).toBeGreaterThan(0);
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const t of edges.get(f) ?? []) stack.push(t);
  }
  cached = seen;
  return seen;
};

const deadIn = (rel: string): string[] => {
  const seen = reachable();
  const dir = join(SRC, rel);
  return readdirSync(dir)
    .filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))
    .filter((f) => !seen.has(join(dir, f)));
};

describe("no sediment in the budget module", () => {
  it("renders every file in src/screens/budget/ from a route", () => {
    expect(deadIn("screens/budget")).toEqual([]);
  });

  it("keeps every LEGACY tile reachable too, or deleted", () => {
    // `src/screens/components/budget/` holds 39 non-test files (measured
    // 2026-08-15, site-hygiene-v1 §0.9 — this comment said „26" and understated
    // it by 13). They are alive on purpose — `/budget/deep-dive` still serves
    // the Sankey and its five drilldowns, which none of the fourteen sub-pages
    // reproduces — and `routes.tsx` says so at the lazy import. This gate exists
    // so that whenever that page IS retired, the tiles do not quietly become
    // unreachable files instead of a deletion.
    //
    // ⚠️ „THE LEGACY TILES" IS NOT ONE UNIT OF WORK, which is the thing to know
    // before acting on this gate. Running the walk below twice — once from the
    // router, once with the `routes.tsx → screens/BudgetScreen.tsx` edge severed
    // — puts only **17** of the 39 behind `/budget/deep-dive` alone; the other
    // **22** (`BudgetTaxCalculator`, `BudgetPolicySimulator` and its four policy
    // components, `BudgetSummaryTile`, `BudgetPeerComparisonTile`,
    // `BudgetRevenueCompositionTile`, `budgetFormat.ts`, …) are load-bearing for
    // the migrated sub-pages. So retiring the deep dive would delete 18 files
    // (the 17 plus `BudgetScreen.tsx`), not this directory.
    expect(deadIn("screens/components/budget")).toEqual([]);
  });

  it("pins the legacy-tile count the comment above states", () => {
    // ⚠️ THE COMMENT ABOVE IS THE PRODUCT HERE, and the assertion beside it —
    // `deadIn(...) === []` — is insensitive to the count, which is exactly how
    // „26" survived the directory growing to 39. Pin the number so the prose
    // cannot drift again without something going red.
    const legacy = readdirSync(join(SRC, "screens/components/budget")).filter(
      (f) => /\.tsx?$/.test(f) && !f.includes(".test."),
    );
    expect(
      legacy.length,
      "the comment above states 39 files (17 deep-dive-only + 22 shared) — re-derive BOTH halves before changing this, by running the reachability walk with the routes.tsx → BudgetScreen.tsx edge severed",
    ).toBe(39);
  });

  it("does not count a COMMENTED-OUT import as an edge", () => {
    // False-GREEN #1, proved rather than asserted: without `stripComments`, a
    // dead file mentioned only inside a comment passes.
    const withComment = stripComments(
      `// const X = lazy(() => import("@/screens/budget/Ghost"));\n` +
        `/* import("@/screens/budget/Ghost2"); */\n` +
        `const Y = 1; // import("@/screens/budget/Ghost3");\n`,
    );
    expect(withComment).not.toMatch(/Ghost/);
  });

  it("does not count an `import type` as an edge", () => {
    // False-GREEN #2. A type-only import is erased at build time, so a dead
    // screen whose props interface a live file imports would otherwise pass.
    const re = /(?:^|\n)\s*import\s+(?!type\s)[^;]*?from\s+"([^"]+)"/g;
    const sample =
      `import type { A } from "@/a";\n` +
      `import { B } from "@/b";\n` +
      `import { type C, D } from "@/c";\n`;
    const hits = [...sample.matchAll(re)].map((m) => m[1]);
    expect(hits).not.toContain("@/a");
    expect(hits).toContain("@/b");
    // A MIXED import still carries a runtime edge for `D`, so it stays.
    expect(hits).toContain("@/c");
  });

  it("does not let the comment strip eat the router's real imports", () => {
    // ⚠️ THE SELF-CHECK THAT MATTERS. A stripper that removes too much makes
    // this whole file report live code as dead — loud, but it also invites the
    // next person to "fix" it by loosening the gate. `routes.tsx` carries a
    // block-comment opener INSIDE a line comment (`/api/sql/*`), which cost 15
    // lazy imports when blocks were stripped first.
    const raw = readFileSync(join(SRC, "routes.tsx"), "utf8");
    const budgetImports = (t: string) =>
      [...t.matchAll(/import\(\s*"[^"]*budget[^"]*"\s*\)/g)].length;
    expect(budgetImports(stripComments(raw))).toBe(budgetImports(raw));
    expect(budgetImports(raw)).toBeGreaterThan(10);
  });

  it("actually discriminates — an unrouted file is reported", () => {
    const seen = reachable();
    expect(seen.has(join(SRC, "screens/budget/BudgetHubScreen.tsx"))).toBe(
      true,
    );
    expect(
      seen.has(join(SRC, "screens/budget/__definitely_not_a_file.tsx")),
    ).toBe(false);
  });
});
