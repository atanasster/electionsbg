// The /subsidies module's SOURCE-level gates — plan §10, the clauses that can be decided by
// reading the tree rather than by querying Postgres. The figure clauses live in
// `scripts/db/tests/agri_hub_stats.data.test.ts` and `agri_scope_years.data.test.ts`; the
// registry's own shape in
// `subsidiesRegistry.test.ts`; the scenes in `subsidiesScenes.test.tsx`; the scope contract in
// `src/screens/components/scopeContract.test.ts`.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// EVERY CLAUSE HERE IS A DEFECT THAT SHIPPED, in this module or in the one it was modelled on:
//
//   • a band-3 `to` carrying a `#fragment` — three /funds KPI cards targeted
//     #top-beneficiaries, #money-flow and #absorption, a later rework moved all three onto
//     their own pages, and every one of those links silently did nothing when clicked.
//   • a routed /subsidies page that no tile points at — the orphan the hub exists to prevent.
//   • a file left in the module that nothing imports — the sediment of a half-finished move.
//   • the hub re-acquiring the 407 KB oblast GeoJSON, which is the entire point of the rework.
//   • „физически лица" attached to a figure whose basis is `eik IS NULL` — €345.9m of named
//     companies and municipalities published as individuals (§4.3; the plan says €385.5m,
//     which is an earlier measurement the cache has since moved past).
//   • the prerendered bodyHtml listing sections that moved to sub-pages (§8.1) — the only
//     version of the page a crawler that runs no JS ever sees.
//   • a page on SectorBreadcrumb, whose trail names a parent that does not contain it (§7a).
// ═══════════════════════════════════════════════════════════════════════════════════════════

import { describe, expect, it } from "vitest";
import { readFileSync, globSync } from "node:fs";
import { join } from "node:path";
import { SUBSIDIES_BANDS } from "./subsidiesRegistry";

const REPO = join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(join(REPO, f), "utf8");

const TILES = SUBSIDIES_BANDS.flatMap((b) => b.tiles);
const routes = read("src/routes.tsx");
const hub = read("src/screens/SubsidiesDashboardScreen.tsx");

/** Comments stripped. Every NEGATIVE assertion below runs against this rather than the raw
 *  file: the comments explaining why a literal is wrong necessarily QUOTE that literal
 *  („the plan said €447.2m", „8 964 300 ÷ 3.00"), so a raw-text check fires on the prose that
 *  documents the fix. The same mistake was in scopeContract.test.ts and shipped there. */
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // TRAILING comments too, not only whole-line ones — a `// …€443.1m…` after code is the
    // same false positive, and the first cut left it in.
    .replace(/(^|[^:"'\\])\/\/.*$/gm, "$1");
const hubCode = stripComments(hub);

/** `tileMetric`'s body — where every figure on the hub is chosen. A money literal ANYWHERE in
 *  here is a figure that stopped tracking its source, whatever it is formatted as. */
const tileMetricBody = (() => {
  const i = hubCode.indexOf("const tileMetric");
  return hubCode.slice(
    i,
    hubCode.indexOf("\nexport const SubsidiesDashboardScreen", i),
  );
})();

/** Every `<Route path="subsidies…">` the app registers, as a leading-slash path. */
const routedSubsidiesPages = [
  ...routes.matchAll(/path="(subsidies(?:\/[a-z-]+)?)"/g),
].map((m) => `/${m[1]}`);

/** The module's own source files (screens, registry, scenes, search), tests excluded. */
const MODULE_FILES = globSync("src/screens/subsidies/*.{ts,tsx}", {
  cwd: REPO,
}).filter((f) => !f.includes(".test."));

describe("destinations", () => {
  it("carries no fragment link", () => {
    // The /funds class. A `#section` target is the link that rots when the destination is
    // reorganised, and NOTHING type-checks it — the anchor simply stops existing and the
    // click becomes a no-op. Band 3's rail tile is the standing temptation: /sector/transport
    // has an `id="rail-subsidy"` and pointing at it would be one character.
    const withFragment = TILES.filter((t) => t.to.includes("#"));
    expect(withFragment.map((t) => `${t.id} → ${t.to}`)).toEqual([]);
  });

  it("points at every routed /subsidies page", () => {
    // The orphan clause. A page with a route, a prerender entry and a sitemap <loc> that no
    // tile links to is reachable only by typing the URL.
    expect(routedSubsidiesPages.length).toBeGreaterThan(8);
    const linked = new Set(TILES.map((t) => t.to));
    const orphans = routedSubsidiesPages.filter(
      (p) => p !== "/subsidies" && !linked.has(p),
    );
    expect(
      orphans,
      "routed but on no tile — reachable only by typing the URL",
    ).toEqual([]);
  });
});

describe("the module leaves no sediment", () => {
  it("every file in src/screens/subsidies/ is imported by something", () => {
    // The WHOLE tree, not a hand-picked corpus. The first cut concatenated routes.tsx, the
    // hub and the module's own files, and reported `subsidiesSearch.ts` as an orphan because
    // its importer — SubsidiesSearchBox.tsx — sits one directory up. An orphan check whose
    // corpus is chosen by hand answers a question about the corpus, not about the tree.
    // `src/` AND `scripts/` — a module file imported only by a build script (a prerender
    // producer, an og capture) is not an orphan, and scanning `src/` alone would report it
    // as one. Tests are excluded so a file kept alive ONLY by its own test still fails.
    const all = [
      ...globSync("src/**/*.{ts,tsx}", { cwd: REPO }),
      ...globSync("scripts/**/*.{ts,tsx}", { cwd: REPO }),
    ]
      .filter((f) => !f.includes(".test."))
      .map(read)
      .join("\n");
    const orphans = MODULE_FILES.filter((f) => {
      const stem = f
        .split("/")
        .pop()!
        .replace(/\.tsx?$/, "");
      // BOTH import forms. The screens reach routes.tsx through React Router's LAZY form —
      // `lazy(() => import("./screens/subsidies/Foo"))` — which is a call, not a `from`
      // clause, so a `from`-only regex reported all eight screens as orphans. The registry,
      // scenes and search module use the static form from their siblings.
      // `import type` counts too — it is still a reference, and a file used only for its
      // types is not sediment.
      return !new RegExp(
        `(?:from|import\\(|import type[^"]*from)\\s*"[^"]*${stem}"`,
      ).test(all);
    });
    expect(
      orphans,
      "nothing imports these — the residue of a half-finished move",
    ).toEqual([]);
  });
});

describe("the payload win is not quietly given back", () => {
  it("the hub does not load the oblast choropleth", () => {
    // 407 KB of GeoJSON that every visitor downloaded to see a thumbnail. Moving it to
    // /subsidies/places was step 3 and the single largest reason the rework exists; a future
    // tile that renders a map preview on the hub would undo it with nothing failing.
    expect(hubCode).not.toMatch(/AgriOblastMap|regions_map/);
  });
});

describe("no money figure is labelled with a basis it does not have", () => {
  it("never says „физически лица“ beside a no-ЕИК figure", () => {
    // §4.3's correction. „Без ЕИК" is NOT „физическо лице": €345.9m of that money carries an
    // unmistakable company or municipality name, and that is a FLOOR (the matching is on
    // explicit legal-form markers, so a company spelled without one is missed).
    //
    // THE FIRST CUT CHECKED ONLY THE INLINE TERNARY, and so missed both surfaces the label
    // can actually reach today: the i18n VALUE behind `subsidies_m_no_eik` (the hub's caption
    // is `t(...)`, so the string lives in the locale files, which were not even in the
    // corpus) and `agriLabel.noEik(bg)` were the module to add one. Both are checked now.
    const offenders: string[] = [];

    // 1. The locale VALUES the no-ЕИК keys resolve to.
    for (const loc of ["bg", "en"]) {
      const dict = JSON.parse(
        read(`src/locales/${loc}/translation.json`),
      ) as Record<string, string>;
      for (const [k, v] of Object.entries(dict)) {
        if (!/no_eik|untraceable/.test(k)) continue;
        // The tile TITLE and DESC may say it — /subsidies/untraceable's own description
        // exists to deny the equivalence. What may not is a metric CAPTION (`_m_`), which
        // sits directly under the number.
        if (/_m_/.test(k) && /физически лица|natural person/i.test(v))
          offenders.push(`${loc}:${k} = ${v}`);
      }
    }

    // 2. Any rendered label in the module, whichever form it takes.
    for (const f of [
      ...MODULE_FILES,
      "src/screens/SubsidiesDashboardScreen.tsx",
    ]) {
      const src = stripComments(read(f));
      for (const m of src.matchAll(
        /(?:label|metricCaption)=\{[^}]*физически лица[^}]*\}/g,
      ))
        offenders.push(`${f}: ${m[0].slice(0, 70)}`);
      // …and the shared-label form, should the module ever grow one.
      if (/agriLabel\.noEik/.test(src)) {
        const labels = read("src/data/agri/labels.ts");
        if (/noEik[^\n]*физически лица/.test(labels))
          offenders.push("labels.ts: agriLabel.noEik says физически лица");
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the untraceable page states the correction rather than assuming it", () => {
    // Not vacuous-by-absence: the page must actively say the two are different, because a
    // reader's default reading of „no ЕИК" IS „an individual".
    const page = read("src/screens/subsidies/SubsidiesUntraceableScreen.tsx");
    expect(page).toMatch(/не приемайте|does not mean/i);
    expect(page).toMatch(/физическо лице|natural person/i);
  });
});

describe("the prerendered body describes the page that exists", () => {
  const routesTs = read("scripts/prerender/routes.ts");
  const entry = (() => {
    const i = routesTs.indexOf('path: "subsidies",');
    return routesTs.slice(i, routesTs.indexOf("staticPage({", i + 10));
  })();

  it("names no section that moved to a sub-page", () => {
    // §8.1. The old body was a table of contents for the inline dashboard — „Накратко ·
    // Концентрация · По схема · По област · По година · Най-големи получатели". Every one of
    // those is now a separate page, and this is the only version of /subsidies a crawler
    // running no JS ever sees, so leaving it was worse than a stub: a confident description
    // of content that is not there.
    //
    // „Накратко" and „По година" are the two with no page of their own — the first was the
    // KPI strip, the second the trend chart — so their presence is the sharpest signal that
    // the body was not rewritten.
    expect(entry).not.toMatch(/<strong>Накратко<\/strong>/);
    expect(entry).not.toMatch(/<strong>По година<\/strong>/);
    expect(entry).not.toMatch(/<strong>At a glance<\/strong>/);
  });

  it("links the sub-pages it describes", () => {
    // The positive half: a body that merely dropped the stale list would pass the clause
    // above while telling a crawler nothing.
    for (const slug of [
      "recipients",
      "schemes",
      "places",
      "untraceable",
      "concentration",
      "political",
      "cross-programme",
      "browse",
      "coverage",
    ]) {
      expect(entry, `the body does not link /subsidies/${slug}`).toContain(
        `/subsidies/${slug}`,
      );
      expect(
        entry,
        `the EN body does not link /en/subsidies/${slug}`,
      ).toContain(`/en/subsidies/${slug}`);
    }
  });
});

describe("band 3 reads its sources, never a literal", () => {
  // §10's „a constant that goes stale at a 200". The MUNICIPAL figure is covered in Postgres
  // (agri_hub_stats.data.test.ts asserts the cross-stream block against budget_muni_transfer);
  // the other three are read in this screen from JSON and constants, so they are checked here.
  //
  // Two of the three would already have shipped stale as literals: the plan specified
  // €4.56bn/2025 for municipal (now €4.93bn/2026) and €447.2m/2026 for rail (the destination
  // shows €443.1m/2025, anchoring on the newest year with a RIDERSHIP figure).

  it("takes the rail total from the destination's own hook", () => {
    // `useRailSubsidy().latest.total`, not a re-derivation from rail_subsidy.json. Two earlier
    // drafts summed the components by hand; the second still differed from the hook at an
    // all-null year (0 vs null), which would print „€0 за железници".
    // Against the STRIPPED copy: `useRailSubsidy` is named in this file's own header comment
    // on the hub, so a raw-text check stays green after the hook is deleted.
    expect(hubCode).toContain("useRailSubsidy");
    expect(hubCode).toMatch(/rail\.latest\?\.total/);
    // …and NO money literal anywhere in `tileMetric`, whatever its formatting. The first cut
    // of this clause matched a FORMATTED figure („443 млн") and so missed `eur(443100000)` —
    // the form a literal actually takes in code. Six digits or more, allowing the four-digit
    // years and the small integers (caps, indices) that legitimately appear.
    const literals = [...tileMetricBody.matchAll(/\b\d[\d_]{5,}\b/g)].map(
      (m) => m[0],
    );
    expect(
      literals,
      "a money literal in tileMetric — every figure must come from its source",
    ).toEqual([]);
  });

  it("takes the film figures from the culture overview, scoped", () => {
    expect(hubCode).toContain("useCultureOverview");
    // From `byYear` for a pinned year — the unscoped total disagreed with /culture on eight
    // of the ten scopes (€94.9m/944 against €8.24m/84 at y:2024).
    expect(hubCode).toMatch(/culture\?\.byYear/);
  });

  it("does not restate the per-vote rate as prose beside the derived figure", () => {
    // Live when review found it: the metric is PARTY_SUBSIDY_VOTES x PARTY_SUBSIDY_RATE_EUR
    // while the second figure spelled „гласа × 3,00 €" as a literal. The rate already moved
    // once inside 2026 (€4.09 → €3.00 on 30.04), which is the file's own warning — so the
    // next change leaves a tile whose two halves disagree by construction.
    expect(tileMetricBody).not.toMatch(/3[,.]00\s*€|€3\.00/);
  });

  it("takes the party figure from the two constants, never from the budget envelope", () => {
    // ЗДБРБ-2026 чл. 13 ал. 4 says „до 8 964,3 хил. евро", but чл. 63 sets TWO rates inside
    // the one year over TWO vote bases, so 8 964 300 ÷ 3.00 = 2 988 100 is a vote count from
    // no election that ever happened. bgTaxPolicy.ts carries the same warning.
    expect(hubCode).toContain("PARTY_SUBSIDY_VOTES");
    expect(hubCode).toContain("PARTY_SUBSIDY_RATE_EUR");
    expect(hubCode, "the run-rate is hardcoded instead of derived").not.toMatch(
      /9[._,]?3\d{5}|8[._ ]?964/,
    );
  });

  it("every band-3 caption names its period", () => {
    // The band's own rule: four streams on four cadences, never summed, each saying which
    // window it is for. The party tile was the one that named none — and both its inputs
    // moved inside 2026, so an undated €9.31m is a run-rate no calendar year equals.
    // Against `tileMetricBody`, NOT the whole file. `railYear` and `filmFirstYear` also
    // appear in the `Band3` interface and in the useMemo that fills it, so a caption that
    // dropped its year left both names in the file and the clause green — measured.
    expect(tileMetricBody).toContain("PARTY_SUBSIDY_SINCE");
    expect(tileMetricBody).toMatch(/muniTransferYear/);
    expect(tileMetricBody).toMatch(/railYear/);
    expect(tileMetricBody).toMatch(/filmFirstYear/);
  });
});

describe("navigation", () => {
  const pages = [
    "src/screens/SubsidiesDashboardScreen.tsx",
    ...MODULE_FILES.filter((f) => f.includes("Screen.tsx")),
    "src/screens/dev/SubsidiesBrowserDbScreen.tsx",
    "src/screens/dev/FarmDetailScreen.tsx",
  ];

  it("finds the module's pages at all", () => {
    expect(pages.length).toBeGreaterThan(9);
  });

  it("every page hangs off /subsidies, and none uses SectorBreadcrumb", () => {
    // §7a. SectorBreadcrumb's trail is „Управление › Обществени поръчки › Държавни сектори ›
    // X" — /subsidies is in none of those: it is absent from sectorRegistry.ts, CAP subsidies
    // are not procurement, and the component has no section slot, so a sub-page using it
    // loses the one crumb it needs.
    for (const f of pages) {
      const src = read(f);
      expect(src, `${f} still imports SectorBreadcrumb`).not.toMatch(
        /import \{[^}]*SectorBreadcrumb[^}]*\} from/,
      );
      expect(src, `${f} has no breadcrumb`).toContain("<GovernanceBreadcrumb");
      expect(src, `${f}'s breadcrumb does not point at the hub`).toContain(
        'sectionTo="/subsidies"',
      );
    }
  });
});
