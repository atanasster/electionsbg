// A page is not shipped until it has all THREE of its artifacts: a prerendered
// static page, a sitemap <loc>, and its own og:image. They live in three files,
// none is derived from the others, and every one of them had been forgotten
// somewhere when this file was written (2026-08-13):
//
//   • 28 of 1,185 routes fell through to the site-wide share card, clustered by
//     family — seven /funds sub-pages, five /budget, both /demographics.
//   • /funds/calls declared an ogImage that had NEVER been captured, so both
//     language variants shipped an og:image that 404s.
//   • Six pages (/sofia/*, /consumption/electricity|gas) were in
//     ENGLISH_STATIC_PAGES and in no routeDefs entry, so the sitemap named the
//     English mirror and not the Bulgarian original.
//   • Six more (/governance/sectors — a hub — /demographics/*,
//     /parliament/similarity, /parliament/correlation, /votes/between) were in
//     neither list and had no <loc> at all.
//   • Three had both entries and no <loc>, because `npm run sitemap` is manual
//     and its output is committed.
//
// None of it failed anything. tests/seo.spec.ts asserts og:image
// `toMatch(/^https?:\/\//)`, which BOTH the site-wide fallback and a URL to a
// missing file satisfy; scripts/sitemap/families.data.test.ts checks the other
// direction (every <loc> has a dist/ file behind it).
//
// Each `describe` below carries an anti-vacuity test, because a coverage gate
// that scans nothing passes.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prerenderRoutes } from "./routes";
import { buildReportRoutes } from "./dynamicRoutes";
import { staticRoutedPages, unresolvedPaths } from "./routerCensus";
import { readIndexableProcedures } from "../funds/procedures_index";
import {
  ENGLISH_STATIC_PAGES,
  routeDefs,
  type RouteDefs,
} from "../sitemap/route_defs";
import { SITE_ORIGIN } from "@/lib/siteOrigin";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const read = (p: string) => fs.readFileSync(path.join(REPO, p), "utf8");
const ORIGIN = SITE_ORIGIN;

/** Every `<loc>` in the COMMITTED sitemap, origin-stripped ("/budget/law",
 *  "/en/budget/law"). Parsed once at module scope because two describes need it:
 *  the declaration check below reads it as the second producer of sitemap URLs,
 *  and the last describe reads it as the artifact. */
/*  Guarded because this now runs at IMPORT: `decodeURIComponent` throws on a
 *  malformed `%` escape and an unreadable file throws too, either of which would
 *  take down all 17 tests with a module-evaluation stack trace instead of
 *  failing the one assertion that cares. On failure the set is left empty and
 *  „finds the committed sitemap" fails cleanly with its own message. */
const sitemapLocs = new Set<string>();
try {
  for (const f of fs.readdirSync(path.join(REPO, "public"))) {
    if (!/^sitemap.*\.xml$/.test(f) || f === "sitemap_index.xml") continue;
    for (const m of read(`public/${f}`).matchAll(/<loc>([^<]+)<\/loc>/g)) {
      try {
        sitemapLocs.add(decodeURIComponent(m[1].replace(ORIGIN, "")));
      } catch {
        sitemapLocs.add(m[1].replace(ORIGIN, ""));
      }
    }
  }
} catch {
  // left empty on purpose — see above
}

// ---------------------------------------------------------------------------

describe("every prerendered page has an og:image of its own", () => {
  // Empty on purpose. A page added here needs a REASON, because the fallback is
  // silent — seoBlock.ts drops to DEFAULT_OG_IMAGE with nothing logged, which is
  // how a whole module came to share one picture.
  const EXEMPT = new Set<string>();

  it("no route falls through to the site-wide card", () => {
    const missing = prerenderRoutes
      .filter((r) => !r.ogImage)
      .map((r) => r.path)
      .filter((p) => !EXEMPT.has(p));
    expect(
      missing,
      `no ogImage — these ship the site-wide default card:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("the scan is not vacuous", () => {
    // ⚠️ THE FLOOR IS THE COMMITTED SET, NOT THE FULL ONE. On a machine that has
    // run the funds pipeline this list is 1,197 routes — but 1,034 of them are
    // the `/funds/procedure/*` and `/funds/programme/*` families, enumerated
    // from `data/funds/projects/by-procedure/` and `by-program/`, and BOTH are
    // gitignored. A clean checkout has 163. So a floor calibrated on a
    // developer's disk is a gate on that disk: `> 500` passed locally and
    // failed on CI, where the number it was measuring cannot exist.
    expect(prerenderRoutes.length).toBeGreaterThan(150);
    expect(prerenderRoutes.filter((r) => r.ogImage).length).toBeGreaterThan(
      150,
    );

    // Where the catalogue IS on disk, assert the property the old floor was
    // accidentally standing in for — one page per indexable procedure. Read
    // through the shared reader, so this cannot drift from what routes.ts
    // enumerated. Dropping it with the floor would leave 82% of the prerender
    // ungated on the only machines that can see it.
    const procedures = readIndexableProcedures();
    if (procedures.length > 0) {
      const prefix = "funds/procedure/";
      const pages = new Set(
        prerenderRoutes
          .filter((r) => r.path.startsWith(prefix))
          .map((r) => r.path.slice(prefix.length)),
      );
      const missing = procedures
        .map((p) => p.procedureCode.trim())
        .filter((code) => !pages.has(code));
      expect(
        missing,
        `catalogued but not prerendered — the sitemap enumerates the same set, so each is a <loc> with no HTML behind it:\n${missing.join("\n")}`,
      ).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------

describe("every routed page is DECLARED — for prerender and for the sitemap", () => {
  // ⚠️ THE THIRD WAY A PAGE SHIPS UNFINISHED, and the one nothing checked. The
  // two describes above ask „does this declared page have its card / its <loc>".
  // This one asks the prior question: is the page declared AT ALL?
  //
  // A route in neither `scripts/prerender/routes.ts` nor
  // `scripts/sitemap/route_defs.ts` still WORKS — Firebase's catch-all serves
  // the SPA shell — so it renders correctly for a human and hands a crawler the
  // HOMEPAGE's <title>, description and canonical. That is the duplicate-content
  // shape CLAUDE.md documents for `/funds/contract/**` and `/company/**`, and it
  // is silent in every direction: no 404, no console error, nothing red.
  //
  // Found 2026-08-15 on `/budget/deep-dive`, routed and linked from its hub for
  // the whole migration.

  /** Routed, non-parameterised paths, read from the router itself through the
   *  shared AST walker — see `routerCensus.ts` for why this is not a regex, and
   *  for the two limits it states rather than hides (index routes, and a
   *  component that redirects from inside its own module). */
  const routerSrc = read("src/routes.tsx");
  const routed = staticRoutedPages(routerSrc);

  /** Declared for prerender.
   *
   *  ⚠️ `prerenderRoutes` IS NOT THE WHOLE PRERENDER. `dynamicRoutes.ts` is a
   *  second producer of *non-parameterised* pages, and reading only the first
   *  reported `reports/**`, `votes`, `polls` and `articles` as having no static
   *  page while all of them ship a correct `<title>` and canonical.
   *
   *  `buildReportRoutes()` is pure and is called; the other three read data off
   *  disk and return `[]` without it, so CALLING them would make this gate
   *  depend on whether the pipeline has been run — the exact defect `dc7e3a832f`
   *  fixed in the floor above, where `> 500` passed locally and failed on CI.
   *  They are named in a table instead, and the anti-rot clause below verifies
   *  each entry against the two ARTIFACTS its producer writes — a `<loc>` in the
   *  committed sitemap, and `dist/<path>/index.html` where a build exists. It
   *  does not call the producers. */
  const DYNAMIC_STATIC_PAGES: Record<string, string> = {
    votes: "buildVotesRoutes() — data/parliament/votes/index.json",
    polls: "buildPollsRoutes() — public/polls/agencies.json",
    articles: "buildArticleRoutes() — public/articles/index.json",
    // The per-article family is `articles/:slug` and so is invisible to the
    // router census — EXCEPT this one, which also carries a hard-coded
    // `<Route path="articles/2026-07-21-machine-only-sections">` because it
    // ships live sliders rather than prose. `buildArticleRoutes` emits it from
    // the same index as every other article.
    "articles/2026-07-21-machine-only-sections":
      "buildArticleRoutes() — public/articles/index.json",
  };
  const prerendered = new Set([
    ...prerenderRoutes.map((r) => r.path),
    ...buildReportRoutes().map((r) => r.path),
    ...Object.keys(DYNAMIC_STATIC_PAGES),
  ]);
  /** Declared for the sitemap. BOTH lists: `routeDefs()` carries the Bulgarian
   *  pages, `ENGLISH_STATIC_PAGES` their /en mirrors — and `route_defs.ts`'s own
   *  Sofia note records the last time only one of them was filled, after which
   *  the sitemap named /en/… and no canonical. Imported rather than grepped:
   *  slicing that file by `indexOf` markers silently passes a path present in
   *  one list only, which is the very defect.
   *
   *  ⚠️ `routeDefs()` IS A TREE and must be flattened RECURSIVELY. `RouteDef`
   *  carries `children?: RouteDefs` and `scripts/sitemap/index.ts`'s `getRoute`
   *  recurses into it, so `reports > municipality > concentrated` contributes
   *  the path `reports/municipality/concentrated` to the sitemap while a
   *  top-level `.map(d => d.path)` sees only `reports`. That one-line read
   *  reported the same 41 pages as missing a `<loc>` they have had all along. */
  const flattenDefs = (defs: RouteDefs, prefix: string): string[] =>
    defs.flatMap((d) => {
      const p = prefix ? `${prefix}/${d.path}` : d.path;
      return [p, ...(d.children ? flattenDefs(d.children, p) : [])];
    });
  const bg = new Set(flattenDefs(routeDefs("2026_04_19"), ""));
  const en = new Set<string>(ENGLISH_STATIC_PAGES);

  /** Does this page HAVE an English mirror at all? Only a page with an
   *  `english:` block has an /en URL to declare — and 41 of them (the whole
   *  `reports/**` family, from `buildReportRoutes()`) deliberately have none, so
   *  demanding an `ENGLISH_STATIC_PAGES` entry for them asks for a `<loc>`
   *  pointing at a page that does not exist. Measured: 41 routes, 0 with
   *  `english`. */
  const englishMirror = new Set(
    [...prerenderRoutes, ...buildReportRoutes()]
      .filter((r) => r.english)
      .map((r) => r.path),
  );

  /** ⚠️ TAKES ITS SETS SO EVERY CLAUSE CAN BE EXERCISED, and that is the point
   *  rather than a convenience. The English clause fires ZERO times across the
   *  live corpus — of the 187 routed paths, every one carrying an `english:`
   *  block is already in `ENGLISH_STATIC_PAGES` — so no real path can reach it
   *  and only a controlled set can.
   *
   *  Two earlier cuts both failed to prove it, in instructive ways. The first
   *  asserted with a fabricated path, which is not in `englishMirror`, so the
   *  clause never evaluated. The second extracted the predicate and tested it in
   *  isolation, which proved the PREDICATE and not its wiring — deleting the
   *  call site from `gapsFor` left all 17 tests green. Driving `gapsFor` itself
   *  with controlled sets is what closes both. */
  type Sets = {
    pages?: Set<string>;
    bgSet?: Set<string>;
    mirror?: Set<string>;
    enSet?: Set<string>;
  };

  const gapsFor = (p: string, sets: Sets = {}): string[] => {
    const pages = sets.pages ?? prerendered;
    const bgSet = sets.bgSet ?? bg;
    const mirror = sets.mirror ?? englishMirror;
    const enSet = sets.enSet ?? en;
    const gaps: string[] = [];
    if (!pages.has(p)) gaps.push("no staticPage");
    // ⚠️ `routeDefs()` IS NOT THE ONLY SITEMAP PRODUCER EITHER, the same way
    // `routes.ts` is not the only prerender producer. `scripts/sitemap/index.ts`
    // pushes some URLs directly (`pushUrl(`${rootUrl}/votes`)` at :656), so
    // `/votes` has had both `<loc>`s all along while being in neither list.
    //
    // The second producer is the SAME small set as above, so one table serves
    // both clauses. Deliberately NOT „or it appears in the committed sitemap":
    // that would let a stale artifact vouch for a declaration somebody deleted,
    // and it makes the gate untestable — removing `children` from the `reports`
    // entry would leave 41 pages passing on the strength of `<loc>`s that the
    // next `npm run sitemap` would drop.
    if (!bgSet.has(p) && DYNAMIC_STATIC_PAGES[p] === undefined)
      gaps.push("no BG <loc> (not in routeDefs(), no dynamic producer)");
    // ⚠️ NO `DYNAMIC_STATIC_PAGES` EXEMPTION HERE, unlike the two clauses above.
    // Membership in that table means „a second producer declares the static
    // page" — that is a claim about the BG prerender and its BG `<loc>`, and
    // nothing about an English mirror. Letting it suppress this clause too made
    // one table entry a TOTAL exemption (`gapsFor(entry)` was unconditionally
    // `[]`), which is broader than the problem it solves. The anti-rot clause
    // checks the /en side for any entry that has a mirror, so „polls has no
    // English mirror" is a checked fact rather than an assumption.
    if (mirror.has(p) && !enSet.has(p))
      gaps.push("has an english: block but no /en <loc>");
    return gaps;
  };

  // ⚠️ ENFORCED FOR /budget ONLY, and that is a scope decision rather than a
  // belief that the rest is clean. Measured 2026-08-15: 30 routed paths across
  // the site are undeclared somewhere. Most are almost certainly deliberate —
  // report sub-views, redirect components, server-driven browsers — but NOTHING
  // RECORDS WHICH, and turning that into 30 exemptions I cannot justify would be
  // a worse artifact than a scoped gate that says so. The machinery above is
  // family-agnostic; widening it is adding a family to this list after deciding
  // its pages one at a time.
  // ⚠️ `sector` here is TWO pages, not fifteen. Only `sector/administration`
  // and `sector/administration/services` are statically routed; the other 13
  // dashboards come from `<Route path="sector/:id">` and are dropped by the
  // census with every other `:param` family. What covers them is
  // `SECTOR_DASHBOARD_IDS` — routes.ts throws at build time if a graduated
  // sector has no prerender copy — not this list.
  const ENFORCED = ["budget", "sofia", "sector"];

  it("declares every routed page of an ENFORCED family in all three places", () => {
    const missing = routed
      .filter((p) => ENFORCED.some((f) => p === f || p.startsWith(`${f}/`)))
      // Defensive only — `staticRoutedPages` has already dropped every `:`
      // path, and the family is `budget/ministry/:id`, so this removes nothing
      // today. `budget/ministries` is correctly NOT matched (the strings
      // diverge at index 14) and is enforced with the other budget pages.
      .filter((p) => !p.startsWith("budget/ministry/"))
      .map((p) => ({ p, gaps: gapsFor(p) }))
      .filter(({ gaps }) => gaps.length)
      .map(({ p, gaps }) => `${p}: ${gaps.join(", ")}`);
    expect(
      missing,
      `routed but undeclared — Firebase serves these the homepage's head:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("records the site-wide gap rather than leaving it unmeasured", () => {
    // Not a pass/fail on the other families — a tripwire on the NUMBER. If it
    // grows, someone added a page in the same half-finished state; if it shrinks,
    // this bound should come down with it.
    //
    // ⚠️ 12 as measured 2026-08-15 (site-hygiene-v1 §0.1), now 9 — T1a-T1c declared
    // `procurement/tenders`, `sofia/companies` and
    // `sector/administration/services`. The number is the
    // POINT OF THAT PLAN rather than an incidental update. The bound read 67
    // — a figure that was never right — because all three inputs above were read
    // too narrowly, each independently: one level of router nesting, a top-level
    // read of a routeDefs TREE, and `routes.ts` alone standing in for the whole
    // prerender. The three errors partially cancelled, which is why the total
    // looked plausible enough to commit.
    //
    // The 12 were then checked against the built `dist/`, which is the only
    // authority on „does this page have its own head": of 187 static routed
    // pages, 175 carry their own `<title>` + canonical, 0 carry the homepage's,
    // and exactly these 12 have no `dist/<path>/index.html` at all.
    const undeclared = routed.filter((p) => gapsFor(p).length > 0);
    expect(
      undeclared.length,
      `undeclared routed pages:\n${undeclared.map((p) => `  ${p}: ${gapsFor(p).join(", ")}`).join("\n")}`,
    ).toBe(9);
    // Of the three the previous comment named as „LINKED from prerendered copy",
    // only the first was: measured over every `${SITE_URL}/…` href in
    // `scripts/prerender/`, `procurement/tenders` had 2 (BG+EN) and the other
    // two had 0; the other two were kept on a sibling argument instead. All
    // three are now declared (12 → 9), so the canaries below pin that they are
    // still ROUTED — if one is deleted, its declaration is dead weight and this
    // says so rather than the count silently improving.
    for (const p of [
      "procurement/tenders",
      "sofia/companies",
      "sector/administration/services",
    ]) {
      expect(routed, `${p} is no longer routed — update this list`).toContain(
        p,
      );
    }
  });

  it("keeps a prerendered page's English mirror declared with it", () => {
    // `ENGLISH_STATIC_PAGES` is what mints the /en <loc>; a `staticPage` with no
    // `english:` block has no English body for it to point at.
    const noEnglish = prerenderRoutes
      .filter((r) => en.has(r.path) && !r.english)
      .map((r) => r.path);
    expect(noEnglish).toEqual([]);
  });

  it("the DYNAMIC_STATIC_PAGES table has not drifted from its producers", () => {
    // The table above names four pages, across three data-gated producers,
    // whose `staticPage` declaration lives in
    // a data-gated `dynamicRoutes.ts` producer. Naming them keeps the gate
    // disk-INDEPENDENT; this clause keeps the naming HONEST. Wherever the data
    // is on disk, the producer must really emit the path — otherwise the table
    // is an assertion about code that has moved, which is precisely the
    // „aspirational rather than descriptive" failure the /budget audit found.
    //
    // `dist/` is the check for the disk-gated producers, because it is what
    // they actually wrote and it needs no data fixture: a page in the table with
    // a built `dist/` and no `index.html` is a claim with nothing behind it.
    // The sitemap half needs no build — it is committed, and every entry in the
    // table is claimed to have a `<loc>` from its producer. This is what stops
    // the table becoming a blanket exemption: an entry added to silence the gate
    // has to be a page the sitemap really lists.
    const noLoc = Object.keys(DYNAMIC_STATIC_PAGES).filter(
      (p) => !sitemapLocs.has(`/${p}`),
    );
    expect(
      noLoc,
      `named in DYNAMIC_STATIC_PAGES but with no <loc> in the committed sitemap — the entry is vouching for a producer that is not producing:\n${noLoc
        .map((p) => `  ${p}: ${DYNAMIC_STATIC_PAGES[p]}`)
        .join("\n")}`,
    ).toEqual([]);

    // …and the /en side, for any entry whose producer DOES emit an English
    // mirror. Without this the EN axis of the table was unfalsifiable: `polls`
    // legitimately has no `/en` <loc> (its index route emits no `english:`
    // block), but nothing established that, so „no mirror" and „mirror with a
    // missing <loc>" were indistinguishable.
    const noEnLoc = Object.keys(DYNAMIC_STATIC_PAGES).filter(
      (p) => englishMirror.has(p) && !sitemapLocs.has(`/en/${p}`),
    );
    expect(
      noEnLoc,
      `has an english: block and no /en <loc> in the committed sitemap:\n${noEnLoc.join("\n")}`,
    ).toEqual([]);

    if (!fs.existsSync(path.join(REPO, "dist"))) return;
    const unbuilt = Object.keys(DYNAMIC_STATIC_PAGES).filter(
      (p) => !fs.existsSync(path.join(REPO, "dist", p, "index.html")),
    );
    expect(
      unbuilt,
      `named in DYNAMIC_STATIC_PAGES but absent from a built dist/ — the producer no longer emits it:\n${unbuilt
        .map((p) => `  ${p}: ${DYNAMIC_STATIC_PAGES[p]}`)
        .join("\n")}`,
    ).toEqual([]);
  });

  it("the declaration check is not vacuous", () => {
    expect(routed.length).toBeGreaterThan(180);
    // The nesting resolver works at ONE level: this path exists only as a bare
    // `analysis` segment inside `<Route path="parliamentary">`.
    expect(routed).toContain("parliamentary/analysis");
    // …and at TWO, which the span-based predecessor could not do. `recount` is a
    // bare segment inside `<Route path="municipality">` inside
    // `<Route path="reports">`, and was reported as `municipality/recount`.
    expect(routed).toContain("reports/municipality/recount");
    expect(routed).not.toContain("municipality/recount");
    // A GROUPING node renders no page: `<Route path="reports">` has children and
    // no `element`, so `/reports` itself is not in the list even though the
    // string is in the file.
    expect(routed).not.toContain("reports");
    expect(routerSrc).toContain('<Route path="reports">');
    // `/analysis` is ALSO routed — as a `<Navigate>` to the namespaced path — so
    // „not in the list" here proves the redirect filter, not the nesting. Both
    // properties are pinned, because a first cut asserted the wrong one and read
    // the resolver as broken when it was right.
    expect(routed).not.toContain("analysis");
    expect(routerSrc).toContain('path="analysis"');
    // The WRAPPER-component redirect form is filtered too. `data/map` renders
    // `<DataMapRedirect />`, which the old `<Navigate`-only test did not match,
    // so it was counted as a page with no head.
    expect(routed).not.toContain("data/map");
    expect(routerSrc).toContain('path="data/map"');
    // Every `path=` resolves to a string literal. A `path={SOME_CONST}` would
    // otherwise enter the census as the literal segment "{SOME_CONST}" — a
    // silent wrong answer rather than a loud one, and the idiom is already in
    // the file (`ROADS_AWARDER_PATH` is imported and used in an `element=`).
    expect(
      unresolvedPaths(routerSrc),
      "a path= that is not a string literal — the walk cannot resolve it",
    ).toEqual([]);
    // The routeDefs flatten is recursive: this path exists ONLY as a nested
    // child, so a top-level read has it as missing.
    expect(bg.has("reports/municipality/recount")).toBe(true);
    // …and the second producer is unioned in: no `staticPage` in routes.ts
    // declares these, yet both ship a correct head.
    expect(prerendered.has("reports/municipality/recount")).toBe(true);
    expect(prerendered.has("votes")).toBe(true);
    // A real page passes every clause; a fabricated one fails the two that
    // apply to it. TWO, not three: the English clause fires only for a page that
    // HAS an `english:` block, and a page nobody declared has none — so
    // demanding three here would be asserting that the gate wants an /en <loc>
    // for a page with no English body, which is the very thing it must not do.
    expect(gapsFor("budget/deep-dive")).toEqual([]);
    expect(gapsFor("budget/no-such-page-abc123")).toHaveLength(2);
    // The English clause is exercised with CONTROLLED SETS, in all three
    // directions, because live data cannot reach it: every one of the routed
    // pages carrying an `english:` block is already declared, so the clause
    // fires zero times across the corpus. An earlier cut asserted it with a
    // fabricated path — which is not in `englishMirror`, so the clause never
    // evaluated and deleting it left all 17 tests green.
    const only = { pages: new Set(["x"]), bgSet: new Set(["x"]) };
    // fires: has a mirror, not declared for /en
    expect(
      gapsFor("x", { ...only, mirror: new Set(["x"]), enSet: new Set() }),
    ).toEqual(["has an english: block but no /en <loc>"]);
    // silent: declared
    expect(
      gapsFor("x", { ...only, mirror: new Set(["x"]), enSet: new Set(["x"]) }),
    ).toEqual([]);
    // silent: no mirror to declare
    expect(
      gapsFor("x", { ...only, mirror: new Set(), enSet: new Set() }),
    ).toEqual([]);
    // …and its discriminator is real in both directions on live data.
    expect(englishMirror.has("budget/deep-dive")).toBe(true);
    expect(englishMirror.has("reports/municipality/recount")).toBe(false);
    // …and the two sitemap lists are genuinely distinct sets, so checking one is
    // not accidentally checking both.
    expect(bg.has("budget/ministry/:id")).toBe(true);
    expect(en.has("budget/ministry/:id")).toBe(false);
  });
});

// ---------------------------------------------------------------------------

/** Cards written to public/og by a Playwright capture, vs. rendered at postbuild
 *  into dist/og by scripts/og/generate.ts. The second kind is NOT on disk in a
 *  fresh checkout, so it is verified against the generator's SOURCE — a
 *  different artifact from routes.ts, which is the point. */
const generatorSource = read("scripts/og/generate.ts");

const hasProducer = (ogImage: string): boolean => {
  if (ogImage.startsWith("http")) return true;
  const rel = ogImage.replace(/^\//, "");
  if (fs.existsSync(path.join(REPO, "public", rel))) return true;
  // generate.ts queues cards by a path relative to og/ ("about.png",
  // "cabinet/<id>.png", "party/<name>.png"). Templated families are matched on
  // their directory prefix.
  const underOg = rel.replace(/^og\//, "");
  if (generatorSource.includes(`"${underOg}"`)) return true;
  const dir = underOg.includes("/") ? underOg.split("/")[0] : null;
  return dir ? generatorSource.includes(`\`${dir}/`) : false;
};

describe("every declared og:image has something that produces it", () => {
  it("no route points at a card nothing writes", () => {
    const broken = prerenderRoutes
      .filter((r) => r.ogImage && !hasProducer(r.ogImage))
      .map((r) => `${r.path} -> ${r.ogImage}`);
    expect(
      broken,
      `og:image with no producer — the crawler gets a 404 image:\n${broken.join("\n")}`,
    ).toEqual([]);
  });

  it("the producer check is not vacuous — it rejects a fabricated card", () => {
    // Without this, a `hasProducer` that returned true unconditionally (a
    // widened prefix rule, say) would leave the gate green for ever.
    expect(hasProducer("/og/no-such-card-abc123.png")).toBe(false);
    expect(hasProducer("/og/funds-places.png")).toBe(true); // a captured file
    expect(hasProducer("/og/about.png")).toBe(true); // a generate.ts card
  });
});

// ---------------------------------------------------------------------------

describe("every captured card is referenced by a page", () => {
  // A card that was shot and wired to nothing is the mirror of the defect above.
  // /funds/focus was in exactly that state: public/og/funds-focus.png existed and
  // every /funds/focus/<slug> child used it, while the index that fronts them
  // carried no ogImage at all.
  //
  // Matched against the SOURCE of both route files rather than the built route
  // list, because dynamicRoutes builds many hrefs from template literals.
  const routeSources =
    read("scripts/prerender/routes.ts") +
    read("scripts/prerender/dynamicRoutes.ts");

  const captureSlugs = [
    ...read("scripts/og/capture-screens.ts").matchAll(
      /^\s+slug: "([^"$]+)",$/gm,
    ),
  ].map((m) => m[1]);

  it("finds the capture table", () => {
    expect(captureSlugs.length).toBeGreaterThan(30);
  });

  // A whole FAMILY of cards is often referenced from one template literal —
  // `/og/reports-${type}.png` covers nine slugs — so a plain substring test
  // reports all nine as orphans. Collect the literal prefix of every such
  // template and treat a slug it prefixes as referenced.
  //
  // LIMIT, stated: this cannot tell whether the template's own guard (here
  // `OG_REPORT_SLUGS`) actually emits THIS slug — only that the family is
  // wired. A slug wrongly added to a covered family is invisible here. It still
  // catches the case it exists for: a card referenced from nowhere at all.
  const templatePrefixes = [
    ...routeSources.matchAll(/\/og\/([a-z0-9/-]*)\$\{/g),
  ].map((m) => m[1]);

  const referenced = (slug: string) =>
    routeSources.includes(`/og/${slug}.png`) ||
    templatePrefixes.some((p) => p !== "" && slug.startsWith(p));

  it("finds the template-built families too", () => {
    expect(templatePrefixes.length).toBeGreaterThan(2);
  });

  it("no capture writes a card no page points at", () => {
    const orphans = captureSlugs.filter((s) => !referenced(s));
    expect(
      orphans,
      `captured but referenced by no route: ${orphans.join(", ")}`,
    ).toEqual([]);
  });

  it("the reference check is not vacuous", () => {
    // Both directions: an unreferenced slug is caught, and the prefix rule has
    // not widened to the point of matching anything.
    expect(referenced("no-such-card-abc123")).toBe(false);
    expect(referenced("funds-places")).toBe(true);
    expect(referenced("reports-turnout")).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("every prerendered page is in the committed sitemap", () => {
  // Read the ARTIFACT, not a fresh enumeration: `npm run sitemap` is manual and
  // its output is committed, so "both route_defs entries are present" is not the
  // same claim as "the page has a <loc>". Three /budget pages were in that gap.

  it("finds the committed sitemap", () => {
    expect(sitemapLocs.size).toBeGreaterThan(100_000);
  });

  it("every route has a Bulgarian <loc>", () => {
    // A page that canonicalises elsewhere must NOT be listed — asking Google to
    // index a URL that points somewhere else is worse than omitting it.
    const missing = prerenderRoutes
      .filter((r) => !r.canonicalUrl && !sitemapLocs.has(`/${r.path}`))
      .map((r) => r.path);
    expect(
      missing,
      `prerendered with no sitemap <loc>. If both route_defs entries are already there, run \`npm run sitemap\` and commit public/sitemap*.xml:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("every route with an English mirror has an /en <loc>", () => {
    // Same rule on the English side, and the discriminator is the mirror's own
    // `english.canonicalUrl` — 987 funds procedures and 11 programmes point back
    // at the Bulgarian URL because ИСУН publishes no English names for them, and
    // the enumerators skip those deliberately.
    const missing = prerenderRoutes
      .filter(
        (r) =>
          r.english &&
          !r.canonicalUrl &&
          !r.english.canonicalUrl &&
          r.path !== "" &&
          !sitemapLocs.has(`/en/${r.path}`),
      )
      .map((r) => r.path);
    expect(
      missing,
      `has an english: block but no /en <loc> — adding only the routeDefs entry lists the original and not the mirror:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("a canonicalised page is genuinely absent, so the exemption is not free", () => {
    // /data-changes 301s onto /data/updates. If it ever appeared in the sitemap
    // the two clauses above would both pass while the artifact was wrong.
    expect(sitemapLocs.has("/data-changes")).toBe(false);
  });
});
