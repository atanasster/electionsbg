// The standing half of the corpus split (scripts/i18n/split_bundles.ts).
//
// A deferred bundle only ships with the routes that declare it, so a key inside
// one is present on those routes and ABSENT everywhere else. i18next has no
// loud failure for that: t("budget_hub_title") renders the literal string
// "budget_hub_title" at a 200. So the moment a component outside the budget
// routes starts naming a budget key — a new tile on /governance, a search item,
// a shared footer — that page ships a raw identifier where a heading belongs,
// and nothing about the build, the typecheck or a row count says so.
//
// This re-derives the split from the route tags in src/routes.tsx and fails if
// the corpus files disagree with it. Failing means one of two things:
//   1. a bundled key is now reachable from somewhere else — run
//      `npx tsx scripts/i18n/split_bundles.ts --apply` to move it back to core,
//      then re-ratchet the budgets in tests/perf.spec.ts;
//   2. the route SHOULD have been tagged — add withBundle("<name>", …) in
//      src/routes.tsx and re-run the splitter.
//
// There is deliberately no allowlist. An exception here is a page rendering
// identifiers, which is the one outcome the whole mechanism exists to prevent.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { analyzeBundles, readRouteEntries } from "./bundles";
import { loadCorpus } from "./key_usage";
import { LOCALE_BUNDLES } from "../../src/locales/bundles";
import { REPO_ROOT, SRC_DIR, chainTo, walk } from "../lib/module_graph";

const readBundleFile = (lang: "bg" | "en", bundle: string) =>
  JSON.parse(
    fs.readFileSync(
      path.join(REPO_ROOT, "src/locales", lang, `${bundle}.json`),
      "utf8",
    ),
  ) as Record<string, string>;

const corpus = loadCorpus("bg");
const analysis = analyzeBundles(Object.keys(corpus));

describe("deferred locale bundles", () => {
  it.each(LOCALE_BUNDLES)(
    "%s holds only keys its own routes can reach",
    (bundle) => {
      const held = Object.keys(readBundleFile("bg", bundle));
      const wrong = held
        .map((key) => ({ key, v: analysis.verdicts.get(key) }))
        .filter((r) => r.v?.bundle !== bundle);
      expect(
        wrong.map(
          (r) =>
            `${r.key} — ${r.v?.reason ?? "not in the corpus"}` +
            (r.v?.entries.length
              ? `\n      routes: ${r.v.entries.join(", ")}`
              : ""),
        ),
        `${wrong.length} key(s) in ${bundle}.json are reachable from outside its routes — see this file's header`,
      ).toEqual([]);
    },
  );

  it("puts every key in exactly one place, and the corpus files agree", () => {
    // The verdicts are computed over the union; this is the round trip. A key
    // the analysis assigns to a bundle but that still sits in translation.json
    // is only wasted bytes, so it is reported rather than failed — the byte
    // budgets in tests/perf.spec.ts are what make it worth acting on.
    for (const lang of ["bg", "en"] as const) {
      for (const bundle of LOCALE_BUNDLES) {
        const bg = Object.keys(readBundleFile("bg", bundle)).sort();
        const other = Object.keys(readBundleFile(lang, bundle)).sort();
        expect(other, `${lang}/${bundle}.json has drifted from bg`).toEqual(bg);
      }
    }
  });

  it("declares an importer and at least one route for every bundle", () => {
    const i18nSrc = fs.readFileSync(path.join(SRC_DIR, "i18n.ts"), "utf8");
    for (const bundle of LOCALE_BUNDLES) {
      for (const lang of ["bg", "en"]) {
        // The literal specifier is what makes Vite emit a chunk per file; a
        // template would silently inline every bundle into the core chunk.
        expect(
          i18nSrc.includes(`import("@/locales/${lang}/${bundle}.json")`),
          `src/i18n.ts has no literal import for ${lang}/${bundle}`,
        ).toBe(true);
      }
      expect(
        analysis.routeEntries.filter((r) => r.bundle === bundle).length,
        `no route declares withBundle("${bundle}")`,
      ).toBeGreaterThan(0);
    }
  });

  it("tags no route with a bundle that does not exist", () => {
    const declared = new Set<string>(LOCALE_BUNDLES);
    const unknown = analysis.routeEntries
      .filter((r) => r.bundle && !declared.has(r.bundle))
      .map((r) => `${path.relative(SRC_DIR, r.file)} -> ${r.bundle}`);
    expect(unknown, "add it to src/locales/bundles.ts").toEqual([]);
  });

  it("keeps the whole-corpus helper out of the app", () => {
    // src/locales/allKeys.ts statically imports every corpus file at once, for
    // the component tests. ANY shipped module that imports it re-inlines all the
    // deferred bundles into whichever chunk that module lands in — the entry if
    // the shell can reach it, one route's chunk otherwise. Neither shows up in
    // the core corpus's byte budget, which is the only thing watching.
    //
    // Reachability rather than a text scan, because the honest rule is "nothing
    // SHIPPED imports it": src/screens/dashboard/testI18n.ts legitimately does,
    // and it is a test helper that no route pulls in — a scan for the specifier
    // would have to special-case it by filename, which is a convention, not a
    // proof.
    const helper = path.join(SRC_DIR, "locales/allKeys.ts");
    const seeds = [
      path.join(SRC_DIR, "main.tsx"),
      ...analysis.routeEntries.map((r) => r.file),
    ];
    const { seen, importedBy } = walk(seeds, SRC_DIR, {
      dynamic: true,
      dynamicExcept: new Set([path.join(SRC_DIR, "routes.tsx")]),
    });
    // Anchor: every assertion here is "the helper is absent", which an empty
    // graph satisfies. 305 routes plus the shell is thousands of modules.
    expect(seen.size).toBeGreaterThan(1_000);
    expect(
      seen.has(helper),
      `src/locales/allKeys.ts is shipped:\n  ${chainTo(helper, importedBy)}`,
    ).toBe(false);
  });
});

// Every assertion above is "the wrong list is empty", which an analysis that
// has stopped seeing routes, owners or the shell satisfies perfectly.
describe("the reachability analysis still discriminates", () => {
  it("sees the routes and the shell it is reasoning about", () => {
    expect(analysis.routeEntries.length).toBeGreaterThan(200);
    expect(
      analysis.routeEntries.filter((r) => r.bundle).length,
    ).toBeGreaterThan(20);
    expect(analysis.shellSize).toBeGreaterThan(50);
  });

  it("defers a non-trivial share of the corpus", () => {
    const deferred = [...analysis.byBundle.values()].reduce(
      (n, keys) => n + keys.length,
      0,
    );
    expect(deferred).toBeGreaterThan(500);
    // …and not all of it: a "bundle" holding the whole corpus would mean the
    // owner attribution has collapsed, and every route would download
    // everything again.
    expect(deferred).toBeLessThan(Object.keys(corpus).length / 2);
  });

  it("moves a bundle's keys back to core when its routes lose the tag", () => {
    // The mutation check. With budget untagged, every key in budget.json must
    // become core — an analysis that had stopped reading the tags would keep
    // assigning them and pass the assertions above unchanged.
    const untagged = readRouteEntries().map((r) =>
      r.bundle === "budget" ? { ...r, bundle: null } : r,
    );
    const mutated = analyzeBundles(Object.keys(corpus), REPO_ROOT, untagged);
    const held = Object.keys(readBundleFile("bg", "budget"));
    expect(held.length).toBeGreaterThan(100);
    expect(
      held.filter((k) => mutated.verdicts.get(k)?.bundle !== null),
    ).toEqual([]);
    // The OTHER bundle is untouched, so this is a tag-scoped effect rather than
    // the analysis having simply stopped classifying anything.
    expect(
      Object.keys(readBundleFile("bg", "methodology")).filter(
        (k) => mutated.verdicts.get(k)?.bundle !== "methodology",
      ),
    ).toEqual([]);
  });

  it("keeps a key in core when the shell can name it", () => {
    // Not a synthetic key: an unknown string has no owner at all and would be
    // called core for the wrong reason. This asserts the SHELL arm specifically.
    const shellKeys = [...analysis.verdicts].filter(([, v]) =>
      v.reason.startsWith("reachable from the shell"),
    );
    expect(shellKeys.length).toBeGreaterThan(20);
    expect(shellKeys.every(([, v]) => v.bundle === null)).toBe(true);
  });
});
