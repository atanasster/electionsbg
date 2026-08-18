// What may be a STATIC import of the entry chunk.
//
// Every module reachable from main.tsx without crossing a lazy()/import()
// boundary lands in the entry chunk, which every page downloads before it can
// paint. tests/perf.spec.ts holds the resulting byte budget, but only after a
// full `vite build` — and a budget cannot say WHICH edge grew it. This walks
// the same graph over the sources, in milliseconds, and names the chain.
//
// The shape it exists to catch: a nav surface importing ONE constant from a
// module that names a family of lazy components. routes.tsx took
// ROADS_AWARDER_PATH from sectorPacks for the /procurement/roads redirect, and
// that single edge put the pack registry plus ~20 reference-data modules
// (kultura, transport, social, security, the roads engine, cpvSectors …,
// ~265 KB of source) into the entry chunk — for one string. Nothing about the
// packs stopped being lazy; only the module that names them leaked.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const EXTS = [".ts", ".tsx", ".js", ".jsx", ".json", ".css"];

const resolveSpec = (spec: string, from: string): string | null => {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null; // bare specifier — node_modules, a vendor-* chunk's problem
  for (const suffix of ["", ...EXTS, ...EXTS.map((e) => `/index${e}`)]) {
    const p = base + suffix;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
};

// `import type` / `export type` are erased before Rollup sees them, so they are
// not edges. A bare `import(...)` is the lazy boundary this gate is about and
// must not match either — hence the required `from` clause (or a side-effect
// `import "…"`), which a call expression never has.
const EDGE =
  /(?:^|[\s;}])import\s+(?!type\b)(?:[^'"();]*?\s+from\s+)?["']([^"']+)["']|(?:^|[\s;}])export\s+(?!type\b)(?:\*|\{[^}]*\})\s+from\s+["']([^"']+)["']/g;

/** Static closure of main.tsx, each module mapped to the one that pulled it. */
const walkEntryGraph = () => {
  const entry = path.join(SRC, "main.tsx");
  const importedBy = new Map<string, string>();
  const seen = new Set([entry]);
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;
    for (const m of fs.readFileSync(file, "utf8").matchAll(EDGE)) {
      const dep = resolveSpec(m[1] ?? m[2], file);
      if (!dep || seen.has(dep)) continue;
      seen.add(dep);
      importedBy.set(dep, file);
      stack.push(dep);
    }
  }
  return { seen, importedBy };
};

const chainTo = (file: string, importedBy: Map<string, string>) => {
  const chain: string[] = [];
  let cur: string | undefined = file;
  while (cur) {
    chain.push(path.relative(ROOT, cur));
    cur = importedBy.get(cur);
  }
  return chain.reverse().join("\n  -> ");
};

describe("the entry chunk's static import graph", () => {
  const { seen, importedBy } = walkEntryGraph();
  const rel = [...seen].map((f) => path.relative(ROOT, f));

  // Non-vacuity. Every assertion below is "X is absent from the graph", and an
  // empty graph satisfies all of them — so a resolver or regex that quietly
  // stops matching would turn this file green rather than red. routes.tsx and
  // the header are unconditionally part of the shell.
  it("finds the shell it is supposed to be measuring", () => {
    expect(rel).toContain("src/routes.tsx");
    expect(rel).toContain("src/layout/header/Header.tsx");
    expect(rel.length).toBeGreaterThan(50);
  });

  it("does not reach the sector-pack registry", () => {
    const registry = path.join(
      SRC,
      "screens/components/procurement/sectorPacks.tsx",
    );
    expect(
      seen.has(registry),
      `sectorPacks is a static import of the entry chunk again:\n  ${chainTo(
        registry,
        importedBy,
      )}\n\nTake the constant from an import-free module (see @/lib/roadsAwarder).`,
    ).toBe(false);
  });

  // The registry is one door to them; a screen-level constant import is
  // another. These modules are per-sector EIK allowlists and label tables —
  // tens of KB that only their own route reads.
  it("does not reach a sector reference-data module", () => {
    const leaked = rel.filter((f) =>
      /^src\/lib\/(\w+ReferenceData|roadAttributes|cpvSectors|awarderModel|noiBenchmarks|monBenchmarks)\.ts$/.test(
        f,
      ),
    );
    expect(
      leaked,
      leaked.map((f) => chainTo(path.join(ROOT, f), importedBy)).join("\n\n"),
    ).toEqual([]);
  });
});
