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
import { stripComments } from "@/../scripts/lib/strip_comments";
// The walk itself lives in scripts/lib/module_graph.ts, shared with
// scripts/i18n/bundle_reachability.test.ts — see that module's header for why
// the two gates must ask the same question.
import {
  CODE,
  EDGE,
  REPO_ROOT as ROOT,
  SRC_DIR as SRC,
  chainTo as chainToIn,
  walk,
} from "@/../scripts/lib/module_graph";

/** The two sector registries. Each names a family of lazy packs, so each is a
 *  door to the same ~20 reference-data modules — and the fix that closed the
 *  first door left the second one standing for a while. Guarding only the one
 *  that happened to break is how the next instance stays invisible. */
const REGISTRIES = [
  "screens/components/procurement/sectorPacks.tsx",
  "screens/sector/sectorDashboards.ts",
];

/** Seeded into the forbidden set beside the registries, because after the fix
 *  NEITHER registry names it any more: `roadsAwarder` exists precisely so they
 *  can take API_EIK without it. It is the largest module in the set (31 KB, and
 *  cpvSectors + awarderModel behind it), so dropping it from the gate the
 *  moment it stopped being imported would retire the guard at the exact point
 *  it started working. Its own deps come along via the closure below. */
const ENGINES = ["lib/roadAttributes.ts"];

/** The whole point of the fix: an import-free module a nav surface may name. */
const EXEMPT = ["lib/roadsAwarder.ts"];

/** A module with no runtime export contributes no bytes — `data/budget/types.ts`
 *  is 111 KB of interfaces that erase to nothing — so naming one in the
 *  forbidden set would be a failure a reader cannot act on. */
const hasRuntimeCode = (file: string) => {
  const code = stripComments(fs.readFileSync(file, "utf8"));
  return /^\s*export\s+(?:default|const|let|var|class|\*|\{|(?:async\s+)?function)/m.test(
    code,
  );
};

const chainTo = (file: string, importedBy: Map<string, string>) =>
  chainToIn(file, importedBy);

describe("the entry chunk's static import graph", () => {
  const { seen, importedBy } = walk([path.join(SRC, "main.tsx")]);
  const rel = [...seen].map((f) => path.relative(ROOT, f));

  // DERIVED, not listed. The predecessor was a naming-convention regex —
  // `\w+ReferenceData` plus four hardcoded escapes from that convention, which
  // is what a convention that does not hold looks like — and it was scoped to
  // src/lib/, so `@/data/agri/constants` sat outside it entirely. A hand-kept
  // list needs someone to remember a new sector, which is the failure mode this
  // file exists to remove. Taking the registries' own closure means a pack is
  // covered the day it is added.
  const forbidden = [
    ...walk([...REGISTRIES, ...ENGINES].map((p) => path.join(SRC, p))).seen,
  ].filter(
    (f) =>
      !EXEMPT.some((e) => f === path.join(SRC, e)) &&
      !REGISTRIES.some((r) => f === path.join(SRC, r)) &&
      CODE.test(f) &&
      hasRuntimeCode(f),
  );

  // Non-vacuity, both halves. Every assertion below is "X is absent from the
  // graph", which an empty graph — or an empty forbidden set — satisfies
  // perfectly, so a resolver or regex that quietly stopped matching would turn
  // this file green rather than red. The forbidden half is new and matters
  // more, since it is now derived: one bad path and the gate guards nothing.
  it("finds the shell it is supposed to be measuring", () => {
    expect(rel).toContain("src/routes.tsx");
    expect(rel).toContain("src/layout/header/Header.tsx");
    expect(rel.length).toBeGreaterThan(50);
  });

  it("derives a forbidden set that actually names the sector modules", () => {
    const names = forbidden.map((f) => path.relative(ROOT, f));
    expect(names.length).toBeGreaterThan(15);
    expect(names).toContain("src/lib/roadAttributes.ts");
    expect(names).toContain("src/lib/cpvSectors.ts"); // via the closure
    expect(names).toContain("src/data/agri/constants.ts"); // outside src/lib
    expect(names).not.toContain("src/lib/roadsAwarder.ts");
  });

  it.each(REGISTRIES)("does not reach %s", (relPath) => {
    const registry = path.join(SRC, relPath);
    expect(
      seen.has(registry),
      `${relPath} is a static import of the entry chunk:\n  ${chainTo(
        registry,
        importedBy,
      )}\n\nTake the constant from an import-free module (see @/lib/roadsAwarder).`,
    ).toBe(false);
  });

  it("does not reach anything those registries name", () => {
    const leaked = forbidden.filter((f) => seen.has(f));
    expect(
      leaked.map((f) => path.relative(ROOT, f)),
      leaked.map((f) => chainTo(f, importedBy)).join("\n\n"),
    ).toEqual([]);
  });

  // The lazy boundary is the thing the walk must not cross, and the required
  // `from` clause is the only thing enforcing it. Relaxing it would pull every
  // lazy route into the graph — loudly, but this says so directly.
  it("does not treat a dynamic import as a static edge", () => {
    for (const code of [
      'const C = lazy(() => import("./sectorPacks"));',
      'const m = await import("./sectorPacks");',
    ]) {
      EDGE.lastIndex = 0;
      expect([...code.matchAll(EDGE)]).toEqual([]);
    }
  });
});
