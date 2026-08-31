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
import {
  ANALYSIS_BAND,
  REPORTS_BAND,
} from "@/screens/analysis/analysisHubFigures";
// The two hubs whose head figures come from a GIT-TRACKED payload. Imported so the
// card-figure fingerprint below is derived by the SAME pure functions the page renders
// through — a projection written out by hand here would be a second opinion about what
// the card shows, and would drift from it silently.
import {
  sectorsHubEvidence,
  sectorsHubKpis,
} from "@/screens/governance/sectorsHubFigures";
import { BAND_INDICATORS } from "@/screens/indicators/indicatorsHubFigures";
import { MAYOR_PAY_BAND_CELLS } from "@/screens/governance/mayorPayHubFigures";
import { KPI_REGISTRY } from "@/screens/indicators/indicatorsRegistry";
import { pickAtOrBefore } from "@/data/macro/kpiSelectors";
import elections from "@/data/json/elections.json";
import fs from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { stripJsxComments } from "../../src/ux/infographic/stripJsxComments";
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
import { reportSkip } from "../lib/report_skip";
import { assertCommitted } from "../lib/assert_committed";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const read = (p: string) => fs.readFileSync(path.join(REPO, p), "utf8");
const ORIGIN = SITE_ORIGIN;

// The three GIT-TRACKED payloads the card-FIGURE clause below projects onto what each card
// shows — the only hub figures a tracked file can move.
//
// ⚠️ THE REASON HAS CHANGED, AND THE OLD ONE IS WHY THIS LINE IS WORTH READING. Until
// 2026-08-31 these three were SOURCES of the card-freshness clause, which stands down on a
// shallow clone — and CI has one (`actions/checkout@v6` is depth 1) — so its per-path
// `no commit found for …` expectation was the only place their presence was ever
// established, and absence was invisible on exactly the run that mattered. That clause no
// longer names them at all. The fingerprint clause `read()`s all three UNCONDITIONALLY and
// does not stand down, so a missing file is now a plain ENOENT rather than a silent pass.
//
// It is kept regardless: an ENOENT mid-clause names the file and nothing else, while these
// are committed, so a missing one is a broken working copy rather than a supported state —
// and saying so by name is the whole point of scripts/lib/assert_committed.ts.
assertCommitted(
  "data/macro.json",
  "data/macro_peers.json",
  "data/procurement/derived/sector_stats.json",
);

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
    // The /council HUB is emitted by buildCouncilRoutes() rather than declared
    // in routes.ts, because its whole argument is a COVERAGE figure ("16 of
    // 265", "5 publish named votes") and routes.ts is a static module with no
    // database. A literal there is the /funds/calls "2 от 6" trap with a
    // crawler's cache in front of it. The per-council pages (/council/:code)
    // are parameterised and so invisible to the router census, like every
    // other :param family.
    council: "buildCouncilRoutes() — Postgres via seo_councils.ts",
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

  /** ⚠️ THE EIGHT ROUTED PAGES THAT LEGITIMATELY HAVE NO STATIC PAGE, each with
   *  the reason — the shape §11 of budget-hub-v1 asks for („a row that names no
   *  file is better than a row that names the wrong one").
   *
   *  An entry here is a DECISION, not a silencer. It says: this page is routed,
   *  a human can use it, and it should NOT be prerendered or listed in the
   *  sitemap. Two of the eight are marked UNDECIDED rather than given a reason,
   *  because they need a call this gate is not the place to make — recording the
   *  question is honest; inventing a reason is the „aspirational rather than
   *  descriptive" failure the /budget audit found.
   *
   *  A page whose reason is „browser-local" must ALSO tell a crawler so. All
   *  four such pages call `useNoindex()`; without it the exemption asserts
   *  something no robots directive backs. */
  const NO_STATIC_PAGE: Record<string, string> = {
    // ── browser-local: the content lives in localStorage, so there is nothing
    //    stable to index and every reader's page differs.
    following: "browser-local watchlist feed; useNoindex()",
    "procurement/watchlist": "browser-local watchlist; useNoindex()",
    "procurement/projects": "browser-local saved project files; useNoindex()",
    // ── a query BUILDER. Note the noindex here is CONDITIONAL and does not
    //    cover this bare path: ProjectFileScreen noindexes a RESOLVED DIY file
    //    (`shouldNoindex = !!spec`) so one reader's search cannot read as a
    //    Наясно editorial finding, and its own comment says „The empty on-ramp
    //    stays indexable". What exempts the bare path is that it is an empty
    //    form — no query, no content — not a robots directive.
    "procurement/project":
      "empty query-builder on-ramp; a RESOLVED file noindexes itself, this path has no content",
    // ── an entry point, not a destination. /my-area resolves the reader's place
    //    and forwards into /governance/:id, which is prerendered per place.
    "my-area": "place-resolver on-ramp; its destinations are prerendered",
    // ── a developer tool.
    // ⚠️ NOT „a developer tool" — the screen's own first line says „Public SQL
    //    browser" and Footer.tsx:36 links it from EVERY page. It is exempt
    //    because a query console has no stable content to index, which is the
    //    same reason as the three above, and it carries the same useNoindex().
    db: "public SQL console; content is whatever the reader typed; useNoindex()",

    // ── ⚠️ UNDECIDED — routed, undeclared, and not exempt on merit. It needs a
    //    decision from the module that owns it, which is not a hygiene call.
    //    Listed so the tripwire has a stable floor without implying anybody
    //    signed it off. It suppresses nothing today: `consumption` is not in
    //    ENFORCED. (`procurement/overview` was the second entry here and is now
    //    DECLARED instead — review found it is the /procurement hub's first
    //    tile, so „unlinked" was false and exempting it would have hidden the
    //    one procurement page that most needed a head.)
    "consumption/basket":
      "UNDECIDED: the only /consumption sub-page not declared, and its eleven siblings are — but /consumption is an in-flight module (project_consumption_view), so declaring a page there may conflict with work in progress",
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

  // ⚠️ ENFORCED IS FIVE FAMILIES NOW, and the machinery is family-agnostic —
  // widening it is adding a family here after deciding its pages one at a time.
  // It stood at /budget alone because „30 routed paths are undeclared somewhere"
  // was true and nothing recorded WHICH, so a list of exemptions nobody could
  // justify would have been the worse artifact. NO_STATIC_PAGE above is that
  // record, which is what let the other four families join.
  // ⚠️ `sector` here is TWO pages, not fifteen. Only `sector/administration`
  // and `sector/administration/services` are statically routed; the other 13
  // dashboards come from `<Route path="sector/:id">` and are dropped by the
  // census with every other `:param` family. What covers them is
  // `SECTOR_DASHBOARD_IDS` — routes.ts throws at build time if a graduated
  // sector has no prerender copy — not this list.

  const ENFORCED = [
    "budget",
    "sofia",
    "sector",
    "subsidies",
    // `procurement` could only join once T2 wrote NO_STATIC_PAGE: four of its
    // routed paths are not meant to be prerendered at all, and before the table
    // existed there was nowhere to say so. Enforcement now means „a NEW
    // /procurement page is declared, or its absence is a recorded decision" —
    // which is the property worth having.
    "procurement",
  ];

  it("declares every routed page of an ENFORCED family in all three places", () => {
    const missing = routed
      .filter((p) => ENFORCED.some((f) => p === f || p.startsWith(`${f}/`)))
      // Defensive only — `staticRoutedPages` has already dropped every `:`
      // path, and the family is `budget/ministry/:id`, so this removes nothing
      // today. `budget/ministries` is correctly NOT matched (the strings
      // diverge at index 14) and is enforced with the other budget pages.
      .filter((p) => !p.startsWith("budget/ministry/"))
      // A page with a recorded reason for having no static page is not a gap.
      // The „accounts for every undeclared page" clause is what stops this
      // becoming a silencer: every key here must still BE undeclared, and every
      // undeclared page must still have a key.
      .filter((p) => NO_STATIC_PAGE[p] === undefined)
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
    // ⚠️ 12 as measured 2026-08-15 (site-hygiene-v1 §0.1), now 7 — T1a-T1d + T2 declared
    // `procurement/tenders`, `sofia/companies` and
    // `sector/administration/services` and `subsidies/browse`. The number is the
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
    ).toBe(7);
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

  it("accounts for every undeclared page — the table is the whole list", () => {
    // The tripwire below is a NUMBER; this is the names behind it. Together they
    // say „these eight, and nothing else". A ninth undeclared page fails here
    // with its own path rather than as an off-by-one on a count.
    const undeclared = routed.filter((p) => gapsFor(p).length > 0);
    const unexplained = undeclared.filter(
      (p) => NO_STATIC_PAGE[p] === undefined,
    );
    expect(
      unexplained,
      `routed, undeclared and with no entry in NO_STATIC_PAGE — decide it, then add it there with its reason:\n${unexplained.join("\n")}`,
    ).toEqual([]);
    // …and the converse: an entry for a page that is no longer undeclared is
    // dead weight that would hide the next one.
    const stale = Object.keys(NO_STATIC_PAGE).filter(
      (p) => !undeclared.includes(p),
    );
    expect(
      stale,
      `in NO_STATIC_PAGE but no longer undeclared — drop the entry:\n${stale.join("\n")}`,
    ).toEqual([]);
  });

  it("keeps every exempt page out of INDEXABLE reach", () => {
    // ⚠️ THE CLAUSE THAT WOULD HAVE CAUGHT BOTH OF T2's FALSE REASONS, and the
    // reason it exists. A page is safe to leave undeclared only if a crawler is
    // not walked into it — otherwise „no static page" means „the homepage's
    // <title> and canonical, served to whoever followed that link".
    //
    // Two rows failed this when it was written. `procurement/overview` was
    // exempted as „a second, UNLINKED overview" while being the /procurement
    // hub's FIRST TILE (ProcurementScreen.tsx:50) — it is now declared instead.
    // `db` was exempted as „a developer tool" while Footer.tsx:36 links it from
    // every page on the site — it now carries useNoindex(), which is the other
    // way to satisfy this.
    //
    // The rule: an exempt page must EITHER tell crawlers not to index it, OR not
    // be linked from anywhere they reach. Prerendered bodies are checked because
    // that is the copy a non-JS crawler reads; the site chrome is checked
    // because it is on every page.
    const NOINDEXED = new Set([
      "following",
      "procurement/watchlist",
      "procurement/projects",
      "db",
    ]);
    const prerenderSrc =
      read("scripts/prerender/routes.ts") +
      read("scripts/prerender/dynamicRoutes.ts");
    const chrome = fs
      .readdirSync(path.join(REPO, "src/layout"))
      .filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))
      .map((f) => read(`src/layout/${f}`))
      .join("\n");
    const reachable = Object.keys(NO_STATIC_PAGE)
      .filter((p) => !NOINDEXED.has(p))
      .filter(
        (p) =>
          prerenderSrc.includes(`SITE_URL}/${p}"`) ||
          chrome.includes(`"/${p}"`),
      );
    expect(
      reachable,
      `exempt from the declaration gate, NOT noindexed, and linked from copy a crawler reaches — declare it or noindex it:\n${reachable.join("\n")}`,
    ).toEqual([]);
  });

  it("makes every browser-local exemption true with a noindex", () => {
    // An exemption reading „nothing stable to index" is a claim
    // about what a crawler is told. Before T2, two of these pages said it in a
    // comment and set nothing — and FollowingScreen's header asserted it while
    // the call sat one file away. The durable guard is not prerendering the
    // route; this is the belt.
    const SCREENS: Record<string, string> = {
      following: "src/screens/person/FollowingScreen.tsx",
      "procurement/watchlist": "src/screens/ProcurementWatchlistScreen.tsx",
      "procurement/projects":
        "src/screens/procurement/MyProjectFilesScreen.tsx",
    };
    const missing = Object.entries(SCREENS)
      .filter(([, file]) => !read(file).includes("useNoindex()"))
      .map(([p, file]) => `${p} -> ${file}`);
    expect(
      missing,
      `exempt as „browser-local" but nothing tells a crawler so — call useNoindex():\n${missing.join("\n")}`,
    ).toEqual([]);
    // ProjectFileScreen sets the meta inline (conditionally, so useNoindex() does
    // not fit) — assert the mechanism it actually uses.
    expect(read("src/screens/procurement/ProjectFileScreen.tsx")).toContain(
      '"noindex, follow"',
    );
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

  it("nor does any scripts/og/screenshot_*.ts family script", () => {
    // ⚠ THE CLAUSE ABOVE READS `capture-screens.ts` AND NOTHING ELSE, and that blind spot is
    // why three orphan cards — procurement-settlement-{sofia,plovdiv,varna} — sat in
    // public/og/ from 2026-05-27, shot for pages that referenced them nowhere. The whole
    // `/procurement/settlement/*` family had no `ogImage` at all and fell through to the
    // site-wide default, so the cards that would have served it were written and ignored.
    //
    // Measured across all family scripts the day that was fixed: 15 cards written, 3
    // orphaned, all three in the one file. So this checks the ORPHAN property over the other
    // writers rather than demanding they migrate — the migration is worth doing for framing
    // reasons (each clips {x:0, y:0} with the site header still in the DOM), but that is a
    // separate change and this gate should not hold it hostage.
    const scripts = fs
      .readdirSync(path.join(REPO, "scripts/og"))
      .filter((f) => /^screenshot_.*\.ts$/.test(f));
    const orphans: string[] = [];
    let cards = 0;
    let families = 0;
    for (const f of scripts) {
      const src = fs.readFileSync(path.join(REPO, "scripts/og", f), "utf8");
      if (!/public\/og|OG_DIR/.test(src)) continue;
      // ⚠ NOT QUOTE-ADJACENT. `screenshot_regional.ts` and `screenshot_transport.ts` build the
      // path as `path.resolve(…, "public/og/sector-regional.png")`, so a `["\'`]…\.png` match
      // finds nothing in them — while the `public/og` guard above passes and makes them LOOK
      // scanned. Measured: that shape hid 2 of 10 writers and 2 of 15 cards, and the first
      // draft of this comment quoted the blind-spotted total (13) as if it were the real one.
      const named = new Set<string>();
      for (const m of src.matchAll(/([a-z0-9-]+)\.png/g)) named.add(m[1]);
      for (const slug of named) {
        cards++;
        if (!referenced(slug)) orphans.push(`${f}: ${slug}`);
      }
      // `file: \`sector-${id}.png\`` — a family WITHIN a family, so the card name is a
      // prefix and not a slug. Kept WITH its trailing dash: dropping it yields „sector",
      // which never satisfies `startsWith("sector-")` and reported a false orphan against a
      // family that is correctly wired. Matched against the route side's own template
      // prefixes rather than through `referenced`, which expects a whole slug.
      for (const m of src.matchAll(/["'`]([a-z0-9-]+-)\$\{/g)) {
        cards++;
        families++;
        const prefix = m[1];
        if (!templatePrefixes.some((tp) => tp === prefix))
          orphans.push(`${f}: ${prefix}\${…} family`);
      }
    }
    // Non-vacuity: these scripts still exist and still write cards, so a scan finding none
    // means the extraction stopped matching, not that the problem went away.
    expect(cards, "no family-script cards found — has the spec shape changed?").toBeGreaterThan(5); // prettier-ignore
    // A SECOND floor, for the template branch specifically. Measured: deleting that branch
    // outright left this test green, because the named-card count alone cleared the floor
    // above — so the long comment beside it was defending a branch nothing protected.
    expect(
      families,
      "no `prefix-${…}` card family found — the template branch is no longer matching",
    ).toBeGreaterThan(0);
    expect(
      orphans,
      `written by a family script and referenced by no route: ${orphans.join(", ")}`,
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

// ─── a hub's share card frames its HEAD ──────────────────────────────────────
//
// §5.3's rule for a hub changed when `HubHead` arrived. The old advice — "not the KPI row and
// not the page header" — was right about a header that carried a centred muted title and
// nothing else. A head is the opposite: labelled corpus figures with their bases, over a
// ranked list. It IS the page's argument in one frame, and it is what a reader on Facebook
// sees before deciding whether to click.
//
// Measured 2026-08-25: /parliament's card was captured on 14 August, anchored on the tile-grid
// wrapper, and showed a session strip and three tile fronts with NO NUMBER ON IT — a share
// card for a roll-call module that published no figure. /procurement's and /governance's were
// the same shape. Nothing failed, because `tests/seo.spec.ts` only asserts the og:image URL is
// absolute.
describe("a hub's og capture anchors on its head", () => {
  const CAPTURES = stripJsxComments(read("scripts/og/capture-screens.ts"));

  /** Every module front page that renders a `HubHead`, and the screen that renders it.
   *
   *  ⚠ BOTH HALVES ARE ASSERTED, and the first draft of this gate asserted neither usefully:
   *  it grepped for HubHead screens, DISCARDED the result, and looped over a hard-coded pair
   *  — so it checked two slugs, and reverting /governance's anchor passed it. A gate that
   *  cannot see its subject is this file's own recurring failure.
   *
   *  A plain grep cannot replace this map, either: it returns a comment-only match and
   *  `ContractsBrowserDbScreen`, which is a genuine HubHead on a SUB-PAGE and has no hub card.
   *  So the map is explicit and the clauses below make it impossible to leave stale. */
  const HUB_CAPTURES: Record<string, string> = {
    parliament: "src/screens/ParliamentHubScreen.tsx",
    procurement: "src/screens/ProcurementScreen.tsx",
    governance: "src/screens/GovernanceScreen.tsx",
    funds: "src/screens/FundsScreen.tsx",
    budget: "src/screens/budget/BudgetHubScreen.tsx",
    consumption: "src/screens/ConsumptionScreen.tsx",
    subsidies: "src/screens/SubsidiesDashboardScreen.tsx",
    "culture-hub": "src/screens/culture/CultureHubScreen.tsx",
    "governance-sectors": "src/screens/governance/GovernanceSectorsScreen.tsx",
    indicators: "src/screens/indicators/IndicatorsLandingScreen.tsx",
    prices: "src/screens/PricesScreen.tsx",
    "analysis-hub": "src/screens/analysis/AnalysisHubScreen.tsx",
    "reports-hub": "src/screens/reports/hub/ReportsHubScreen.tsx",
  };

  /** Sub-page heads that DO ship a card, slug → the screen behind it.
   *
   *  ⚠️ THE FRESHNESS CLAUSE BELOW USED TO SEE ONLY `HUB_CAPTURES`, so a sub-page card was
   *  exempt from it purely by being a sub-page — which is backwards: the exemption exists
   *  because these pages have no HUB card, not because their card may go stale. A card
   *  showing a head that has since changed is the same defect wherever the page sits.
   *
   *  The other two SUB_PAGE_HEADS members are absent as OPEN WORK, not as decisions against
   *  them — a slug→screen map expresses both perfectly well (four `culture-funds-<arm>`
   *  slugs all naming `CultureFundsSourceScreen` is a legal `Record`, and every consumer
   *  here is keyed by slug). Adding them puts their cards under the freshness rule too. */
  const SUB_PAGE_CAPTURES: Record<string, string> = {
    "governance-declarations":
      "src/screens/governance/GovernanceDeclarationsScreen.tsx",
    // ⚠️ JOINED 2026-08-31, AND THE ROUTE IT TOOK IS THE POINT. The screen adopted a
    // `HubHead` on 2026-08-28 (fc4fb81bf8) and landed in NEITHER map, which is exactly what
    // the „every HubHead screen is named" clause below exists to catch — it caught it. The
    // decision that clause demands is head-card or not, and this is a head card: unlike
    // `/persons` and `/companies` in SUB_PAGE_HEADS, whose value really is their ROWS, this
    // page is a RANKING, and its head states what the ranking measures (coverage 249/259,
    // the base year, and the two medians, each with a basis). „Челопеч is top" without those
    // four is a bar chart with no unit.
    //
    // ⚠️ AND THE CHOICE IS LOAD-BEARING RATHER THAN TIDY, which is the part worth keeping.
    // Under SUB_PAGE_HEADS this card would have been covered by `SIZED_CARDS`' dimension
    // check ALONE — and the stale 2026-08-25 PNG passed that at 2400x1260 while depicting a
    // bar chart the screen no longer renders. Here it also picks up the head-anchor, the
    // viewport and the FRESHNESS clauses, and it is the last of those that turns the next
    // such staleness into a red run instead of a card nobody re-shoots.
    "governance-mayor-pay":
      "src/screens/governance/GovernanceMayorPayScreen.tsx",
  };

  /** Committed cards that are NOT hub heads and still must be the corpus's size.
   *
   *  ⚠️ THE DIMENSION CLAUSE IS THE ONE CLAUSE THAT READS THE OUTPUT rather than the config,
   *  so a card leaving `HUB_CAPTURES` must not leave IT. `/og/culture.png` did exactly that
   *  on 2026-08-26 when the hub moved to its own `culture-hub` slug — and that file is still
   *  the og:image for /culture/subsidies and /culture/films, is shot at the DEFAULT viewport
   *  rather than
   *  `OG_CLIP_VIEWPORT`, and is therefore the exact shape this clause's own comment warns
   *  gets clamped to a short card. */
  const SIZED_CARDS = ["culture", "persons", "official-companies"];

  /** Every card whose page is a HubHead — module front pages and sub-pages alike. The
   *  clauses below are claims about the CARD (its anchor, viewport, size, freshness), and a
   *  sub-page's card is a card, so all of them read this rather than HUB_CAPTURES. */
  const HEAD_CAPTURES: Record<string, string> = {
    ...HUB_CAPTURES,
    ...SUB_PAGE_CAPTURES,
  };

  /** HubHead call sites that are NOT module front pages.
   *
   *  ⚠️ „SO THEY SHIP NO HUB CARD" WAS THIS LIST'S WHOLE DEFINITION AND IS NOW TRUE OF ONLY
   *  SOME OF IT. `ContractsBrowserDbScreen` and `CultureFundsSourceScreen` ship no card of
   *  their own at all; the two REGISTRY BROWSERS below ship one and it is simply not a HEAD
   *  card. What the members share is that no clause about a head's card applies to them — not
   *  that no card exists — so the ones that do have a card are named in `SIZED_CARDS` instead,
   *  which is the one clause here that reads the PNG rather than the config. */
  const SUB_PAGE_HEADS = [
    "src/screens/dev/ContractsBrowserDbScreen.tsx",
    // ⚠️ THE TWO REGISTRY BROWSERS SHIP A CARD, AND IT IS NOT A HEAD CARD. /persons and
    // /companies each have their own capture (`persons`, `official-companies`) — so they are
    // not here for want of one — but both ANCHOR ON THE TABLE SECTION rather than the head,
    // deliberately: what is worth sharing from a register is the ROWS. Listing them under
    // SUB_PAGE_CAPTURES puts them under this file's head-framing, head-viewport and
    // head-freshness clauses, all three of which are claims about a card that DEPICTS A HEAD
    // and all three of which they then fail by design. (Measured: doing so turned three green
    // clauses red at once — „anchors on something other than the head" ×2, a hand-written
    // viewport, and two cards older than their screens.)
    //
    // Neither is a module front page either: both sit under /governance.
    "src/screens/persons/PersonsBrowserScreen.tsx",
    "src/screens/dev/CompaniesBrowseDbScreen.tsx",
    // The four /culture/funds source pages share ONE screen. They are sub-pages
    // of the culture module, not module front pages, so they ship no HUB card —
    // they carry their own per-arm og capture entries instead
    // (`culture-funds-<arm>` in scripts/og/capture-screens.ts).
    "src/screens/culture/CultureFundsSourceScreen.tsx",
  ];

  /** Hubs whose card does not yet frame the head, with the reason. A real debt, named so the
   *  list shrinks rather than the rule. */
  const NOT_YET: Record<string, string> = {
    // ⚠️ PAID OFF 2026-08-31, and it was the one shape a re-shoot could NOT fix: /prices had
    // no capture entry at all, because its card came from a bespoke
    // `scripts/og/screenshot_prices.ts` that clipped a blind {0,0,1200,630} from the page
    // top. It now has a real entry anchored on `[data-hub-head]`, and that script is deleted.
    //
    // ⚠️ PAID OFF 2026-08-27, within the same run that booked them — `analysis-hub` and
    // `reports-hub` were re-anchored on `[data-hub-head]` and re-shot, the
    // `governance-sectors` / `indicators` treatment. Both were the cheap kind: the card was
    // already shot from the right page and only the anchor was wrong.
    //
    // Emptied on 2026-08-26 after being used THREE times that day and paid off every time
    // within a commit — which is the pattern this map is for.
    //
    //   `culture` — /culture had a head and no card of its own: `/og/culture.png` is shot
    //   from /culture/subsidies and was shared by SIX routes, so the hub's card depicted
    //   the film dashboard, 13% of the money the hub exists to put in proportion. Paid by
    //   a new `culture-hub` slug.
    //
    //   `governance-sectors` — the card WAS shot from this page; only the anchor was the
    //   tile grid, so it led with tile fronts and cut the band and the aside. Paid by
    //   re-anchoring on `[data-hub-head]` and re-shooting.
    //
    //   `indicators` — the same shape a third time, and the sharpest case: its card
    //   anchored on the hand-rolled KPI grid that the head's four cells were promoted OUT
    //   of, so the card led with the eight tiles the page deliberately does not lead with.
    //   Paid the same way.
    //
    // All three are gone rather than left behind as stale exemptions. The distinction
    // between the FIRST and the other two is the part worth keeping: `culture` needed a
    // whole new card and could never have been cleared by a re-shoot, because its card was
    // shot from a different page. The other two needed only a new anchor.
  };

  /** One capture entry's text, by slug. */
  const entryFor = (slug: string): string | null => {
    const at = CAPTURES.indexOf(`slug: "${slug}"`);
    if (at === -1) return null;
    const next = CAPTURES.indexOf('slug: "', at + `slug: "${slug}"`.length);
    return CAPTURES.slice(at, next === -1 ? undefined : next);
  };

  it("every hub's capture frames its head", () => {
    const checked: string[] = [];
    const offenders: string[] = [];
    for (const slug of Object.keys(HEAD_CAPTURES)) {
      if (NOT_YET[slug]) continue;
      const entry = entryFor(slug);
      if (!entry) {
        offenders.push(`${slug}: no capture entry`);
        continue;
      }
      if (!/anchor:\s*"\[data-hub-head\]"/.test(entry))
        offenders.push(`${slug}: anchors on something other than the head`);
      checked.push(slug);
    }
    // Non-vacuity: if the exemption list ever swallowed the map this would check nothing.
    expect(checked.length, "no hub card was checked").toBeGreaterThan(1);
    expect(
      offenders,
      `hub cards not framing their head: ${offenders.join("; ")}`,
    ).toEqual([]);
  });

  it("a hub's capture clips at OG_CLIP_VIEWPORT, so the card is not silently shrunk", () => {
    const checked: string[] = [];
    // Playwright CLAMPS the clip to the viewport, so a width below OG_W (1200) emits a
    // smaller card with nothing failing — measured, a hand-picked 1180 gave 2360×1260 where
    // the corpus norm is 2400, and two of these three had been 2400 the day before.
    for (const slug of Object.keys(HEAD_CAPTURES)) {
      if (NOT_YET[slug]) continue;
      const entry = entryFor(slug) ?? "";
      expect(
        /viewport:\s*OG_CLIP_VIEWPORT/.test(entry),
        `${slug}: uses a hand-written viewport instead of OG_CLIP_VIEWPORT`,
      ).toBe(true);
      checked.push(slug);
    }
    // The same floor its sibling above carries. Without it, an exemption list that grew to
    // cover every hub would leave this clause asserting nothing while still reading green.
    // `NOT_YET` is empty again today, which is exactly when the floor is free to add.
    expect(checked.length, "no hub viewport was checked").toBeGreaterThan(1);
  });

  it("every hub card is the corpus's size, read from the PNG itself", () => {
    // ⚠ THE CLAUSES ABOVE READ THE CONFIG; this one reads the OUTPUT. That gap shipped a
    // defect earlier the same day: a hand-picked `viewport.width: 1180` is below OG_W (1200),
    // Playwright CLAMPS the clip to the viewport, and three cards were written at 2360×1260
    // against a corpus norm of 2400 — with the config looking deliberate and every
    // config-reading assertion green.
    //
    // PNG dimensions come from the IHDR chunk: bytes 16-23 of the file, big-endian width then
    // height. No image library needed, and nothing here decodes pixels — this asserts the
    // frame, not the picture. Looking at the picture is still a human step (§10).
    const dims = (rel: string) => {
      const b = fs.readFileSync(path.join(REPO, rel));
      return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    };
    // SIZED_CARDS too — see its docstring: this is the one clause that reads the file, so a
    // card leaving HEAD_CAPTURES must not fall out of it.
    for (const slug of [...Object.keys(HEAD_CAPTURES), ...SIZED_CARDS]) {
      const rel = `public/og/${slug}.png`;
      expect(
        fs.existsSync(path.join(REPO, rel)),
        `${rel} is referenced by a capture entry but not on disk`,
      ).toBe(true);
      const { w, h } = dims(rel);
      expect(
        `${w}x${h}`,
        `${rel} is ${w}x${h} — a viewport narrower than OG_W silently clamps the clip`,
      ).toBe("2400x1260");
    }
  });

  it("no hub card is older than the page it depicts", (ctx) => {
    // ⚠ THE DEFECT THE ANCHOR CLAUSES CANNOT SEE. /funds' card was correctly configured for
    // months and simply never re-shot: committed 2026-05-27, it depicted a layout the module
    // no longer had — a centred title, a StatCard strip and a choropleth, all since removed —
    // and every figure on it was stale, the paid total by 11% and the MP-linked count by 40%.
    // Nothing failed. `tests/seo.spec.ts` asserts only that the og:image URL is absolute, and
    // the clauses above read the capture CONFIG, which was not the thing that was wrong.
    //
    // ⚠ WHAT THIS CANNOT SEE, so nobody reads green as more than it is: FIGURE staleness. All
    // four heads draw from `/api/db` or a generated blob, so a corpus reload moves every
    // number on every card and touches no tracked file. That same card was ALSO 11% low on
    // paid funds and 40% low on MP-linked companies, and this clause would have said nothing
    // about it. Green here means „the card is at least as new as the code that draws it" —
    // never „the numbers are current".
    //
    // COMMIT time, not mtime: a checkout rewrites every mtime to the checkout instant, so an
    // mtime comparison is noise in CI and meaningless locally after a branch switch.
    // `execFileSync` with an argv array, not a shell string. These paths are internal
    // constants today, but `JSON.stringify` is JSON quoting rather than SHELL quoting — a
    // path containing `$(…)` would execute — and the argv form needs no quoting at all.
    const at = (rel: string) =>
      Number(
        execFileSync("git", ["log", "-1", "--format=%ct", "--", rel], {
          encoding: "utf8",
        }).trim(),
      );

    // ⚠ SHALLOW CLONES MAKE THIS VACUOUS, and CI has one: `actions/checkout@v6` defaults to
    // fetch-depth 1, so `git log -1` returns the SAME commit for every path and every
    // comparison passes. Skipped with a distinct reason rather than passing — „there is no
    // history here" must never read as „the cards are current".
    const shallow =
      execSync("git rev-parse --is-shallow-repository", {
        encoding: "utf8",
      }).trim() === "true";
    // ⚠ `ctx.skip`, NOT an `expect(shallow).toBe(true)`. That was the first draft and it is a
    // TAUTOLOGY on a variable just proven true: it can never fail, so the reason is never
    // rendered and vitest prints „✓ passed" — a clause that never runs in CI reporting as one
    // that did. Measured under this repo's vitest: the assertion form prints ✓, this prints
    // „↓ skipped [shallow clone …]". The file's whole doctrine is that a skip must say why.
    if (shallow) {
      reportSkip(
        import.meta.url,
        "shallow clone — card freshness unverifiable",
      );
      return ctx.skip();
    }

    // The head COMPONENT counts too, not only the screen. Excluding it was the first draft's
    // trade — „a shared-component edit reddens all four at once, and a gate that annoys people
    // gets deleted" — but that is a forecast, and the measurement contradicts its urgency:
    // HubHead's last commit is hours older than all four cards, so folding it in reddens ZERO
    // of four today. A hole left open against a hypothetical cost is the wrong way round.
    const HEAD = "src/ux/infographic/HubHead.tsx";
    const headAt = at(HEAD);
    expect(headAt, `no commit found for ${HEAD}`).toBeGreaterThan(0);

    // ⚠ AND THE FIGURE BUILDER, where the hub has one. Two hubs build their band and their
    // aside in a SEPARATE module — extracted precisely so gates could see them
    // (`budgetHubFigures.ts`'s header: „a band built inline is unreachable from
    // hubHead.gates.test.ts") — and those files own every value, label, basis and evidence
    // row the card shows. Without this, a change moving every number on the budget card
    // reddens nothing. PER-HUB rather than global, so an unrelated hub is not reddened by a
    // sibling's edit; the same measurement the HubHead line above rests on applies here too:
    // folding both in reddens zero additional cards today.
    // ⚠️⚠️ CODE ONLY — A DATA PAYLOAD IS NOT A SOURCE HERE, AND PUTTING ONE BACK IS THE
    // DEFECT THIS SPLIT EXISTS TO END. `indicators` and `governance-sectors` used to name
    // their git-tracked payloads (data/macro.json, data/macro_peers.json,
    // data/procurement/derived/sector_stats.json) beside their figures modules. A COMMIT
    // TIME is a fair proxy for „was the card drawn from this code"; it is a terrible one
    // for „does the card still show this payload's numbers", because these files are
    // rewritten by the DAILY watcher and the card renders them at one compact decimal.
    //
    // Measured 2026-08-31 by re-deriving the rendered band from every committed vintage:
    // data/macro.json moved 20 times in 21 days and moved a band figure ONCE (the
    // 2026-08-14 Eurostat quarter); sector_stats.json moved 20 times and moved the card 4
    // times, all on 2026-08-13 and all structural. Since both heads shipped on 2026-08-26,
    // 0 of 7 payload commits moved either card — and the two PNGs on disk still hash to the
    // md5s recorded when they were last verified. The clause was red on every one of them.
    //
    // Worse, the escape hatch inverted: `NON_RENDERING_SOURCE` is sha-pinned so it EXPIRES
    // on the next commit of the file, which is right for a rare code change and turns a
    // daily payload into a recurring manual chore (re-shoot twice, compare md5, write a
    // paragraph, bump the sha). Commit 1d540ee2bd is that chore, paid once already.
    //
    // ⚠️ AND THE ASYMMETRY WAS AN ACCIDENT OF STORAGE, NOT A PROPERTY OF THE CARD. Six of
    // the eight head cards draw from `/api/db` hub-stats blobs, so no tracked file moves
    // when their numbers do and they were under NO figure rule at all — see this clause's
    // own „WHAT THIS CANNOT SEE" note. Only these two were held to a stricter standard,
    // purely because their payload happens to be committed JSON.
    //
    // Figure staleness is now checked properly, by the RENDERED FINGERPRINT clause below —
    // which is silent on a refresh that moves nothing visible and fires exactly on the one
    // that does.
    const FIGURES: Record<string, string | string[]> = {
      budget: "src/screens/budget/budgetHubFigures.ts",
      funds: "src/screens/funds/fundsHubFigures.ts",
      consumption: "src/screens/consumption/consumptionHubFigures.ts",
      // ⚠️ ADDED WITH THE `NOT_YET` REMOVAL, and it has to be: dropping that entry is what
      // puts /prices under the freshness clause for the first time, and without this the
      // clause watches the SCREEN while every value, every basis, the note and every rail
      // row live in the figures module beside it.
      prices: "src/screens/prices/pricesHubFigures.ts",
      subsidies: "src/screens/subsidies/subsidiesHubFigures.ts",
      "culture-hub": "src/screens/culture/cultureHubFigures.ts",
      indicators: "src/screens/indicators/indicatorsHubFigures.ts",
      "governance-sectors": "src/screens/governance/sectorsHubFigures.ts",
      "governance-declarations":
        "src/screens/governance/declarationsHubFigures.ts",
      // ⚠️ TWO PATHS, AND THE SECOND IS NOT A FIGURES MODULE. The re-anchored crop is 630 px
      // and this head is ~336 of it, so the card ALSO shows the filter bar and the first two
      // ranked rows (Челопеч €84 524, Чавдар €68 192). That ordering comes from
      // `applyMayorPayFilter`'s comparator — including its „not on file sorts LAST in both
      // directions" rule, which that module's own header records as having already been a
      // bug once. Without the second path a change to it moves what the card shows and
      // reddens nothing.
      //
      // The cost is stated rather than hidden: most edits to the filter module do not touch
      // the DEFAULT view, so this will occasionally demand a re-shoot that changes no pixel.
      // That is the right way round — the alternative is a card that silently stops matching
      // its own page — and `NON_RENDERING_SOURCE` is where such a case gets named and
      // verified rather than waved through.
      "governance-mayor-pay": [
        "src/screens/governance/mayorPayHubFigures.ts",
        "src/screens/governance/mayorPayFilters.ts",
      ],
    };

    /** Cards that PREDATE a source and are nonetheless current, each with the reason.
     *
     *  ⚠️ WHY THIS ESCAPE HATCH HAS TO EXIST. The clause compares commit TIMES, which is a
     *  proxy for „was the card drawn from this code" — and it cannot tell a rendering change
     *  from a non-rendering one. `HubHead` gained `data-kpi-cell` (an attribute a gate reads
     *  and a reader never sees), which reddened five cards that re-shoot to BYTE-IDENTICAL
     *  files. With no exemption the only ways to clear that are fake churn or deleting the
     *  clause, and both are worse than a named claim.
     *
     *  ⚠️ THE CLAIM IS CHECKABLE, WHICH IS WHAT MAKES IT SAFE: re-run the capture and the
     *  bytes must not move. An entry that no longer reproduces is a stale exemption and the
     *  clause below fails on it — it is not a permanent excuse. Remove an entry the moment
     *  its card is re-shot for any real reason. */
    /** A SOURCE whose current commit changed nothing any card draws, so it may not make a
     *  card stale. Keyed by path → the exact commit sha that was verified.
     *
     *  ⚠️ SOURCE-SCOPED, NOT SLUG-SCOPED, AND THAT IS THE WHOLE POINT. This was a
     *  `Record<slug, reason>` consulted as `if (CURRENT_DESPITE[slug]) continue`, which
     *  exempted the card from EVERY source — so a slug listed here for a HubHead edit was
     *  also silently excused from its own screen and its own figures module. Measured
     *  2026-08-26: six of eight cards were exempted that way and all eight were stale
     *  against `HubHead.tsx` AND NOTHING ELSE, so the guard read „2 cards checked" while
     *  zero cards were being checked against a rendering change.
     *
     *  ⚠️ THE SHA IS LOAD-BEARING — it is what makes the exemption EXPIRE. A reason alone
     *  would excuse `HubHead.tsx` for ever, including the next edit that does move a pixel.
     *  When the file is committed again the sha stops matching, every card goes stale, and
     *  the clause fires until somebody re-shoots or re-verifies. That is the correct
     *  default: a card is presumed stale until a human has looked.
     *
     *  ⚠️ VERIFY BY RE-SHOOTING, never by reading the diff. The check that earns an entry
     *  here is `npx tsx scripts/og/capture-screens.ts <slug>` producing a byte-identical
     *  file (compare md5). „This looks like it only changes hrefs" is how a rendering change
     *  gets waved through. */
    const NON_RENDERING_SOURCE: Record<string, { sha: string; why: string }> = {
      [HEAD]: {
        sha: "cf9c4f957bc0fcd12af033034c81fc32f4cc9118",
        why:
          "useHeadHref switched from a `?`-split to `parsePath` — it alters the hrefs the " +
          "head builds and draws nothing. Verified: re-shooting governance-declarations " +
          "produced an identical md5 (4738a7bb9af3358ef031ccfc828ea401).",
      },
      // ⚠️ THE TWO DATA ENTRIES THAT USED TO SIT HERE ARE GONE, and deliberately not
      // replaced. `data/macro.json`, `data/macro_peers.json` and
      // `data/procurement/derived/sector_stats.json` each needed an entry re-verified on
      // every daily refresh, because a sha-pinned exemption expires the next time its file
      // is committed — the correct default for a rare code change, and a treadmill for a
      // payload the watcher rewrites nightly. Those three are no longer SOURCES for this
      // clause at all (see FIGURES above); their staleness is checked by the fingerprint
      // clause below, which compares what the card SHOWS rather than when a file moved.
      //
      // The remaining kind is the one this map was built for: CODE that draws nothing.
    };
    const shaOf = (rel: string) =>
      execFileSync("git", ["log", "-1", "--format=%H", "--", rel], {
        encoding: "utf8",
      }).trim();
    /** True while the recorded verification still describes the file's current state. */
    const exempt = (rel: string): boolean => {
      const e = NON_RENDERING_SOURCE[rel];
      return !!e && e.sha === shaOf(rel);
    };

    const stale: string[] = [];
    for (const [slug, screen] of Object.entries(HEAD_CAPTURES)) {
      // ⚠️ NOT_YET SKIPS THIS CLAUSE TOO, and that is a correctness point rather than
      // convenience: a card that does not depict this screen cannot have its freshness
      // judged against it, so the comparison would report stale for ever and re-shooting
      // could never clear it — the shot page has not changed. That was `culture`'s exact
      // state on 2026-08-26, when its card was shot from /culture/subsidies; the fix is
      // always a card of the hub's own head, never a permanent exemption.
      if (NOT_YET[slug]) continue;
      const card = at(`public/og/${slug}.png`);
      const page = at(screen);
      expect(card, `no commit found for public/og/${slug}.png`).toBeGreaterThan(
        0,
      );
      expect(page, `no commit found for ${screen}`).toBeGreaterThan(0);
      const extras =
        FIGURES[slug] === undefined
          ? []
          : Array.isArray(FIGURES[slug])
            ? FIGURES[slug]
            : [FIGURES[slug] as string];
      const extraPairs: [string, number][] = extras.map((rel) => {
        const t = at(rel);
        expect(t, `no commit found for ${rel}`).toBeGreaterThan(0);
        return [rel, t];
      });
      const sources: [string, number][] = (
        [[screen, page], [HEAD, headAt], ...extraPairs] as [string, number][]
      ).filter(([rel]) => !exempt(rel));
      // Every source exempted — nothing left to compare this card against, which must not
      // read as „current". Cannot happen while `screen` is never exemptible, and asserted
      // rather than assumed.
      expect(
        sources.length,
        `${slug}: every source is exempted, so its card is checked against nothing`,
      ).toBeGreaterThan(0);
      const [src, newest] = sources.reduce((a, b) => (b[1] > a[1] ? b : a));
      if (card < newest)
        stale.push(
          `${slug}: card ${new Date(card * 1000).toISOString().slice(0, 10)} < ` +
            `${src} ${new Date(newest * 1000).toISOString().slice(0, 10)}`,
        );
    }
    // Non-vacuity: an exemption list that grew to cover every card would leave this
    // asserting nothing while still reading green.
    // ⚠️ COUNTS CARDS ACTUALLY COMPARED, not entries minus an exemption list. The old form
    // subtracted slug exemptions, so it reported „2 checked" in a state where every card was
    // exempted from the only source that had moved — the arithmetic was right and the claim
    // was false. With source-scoped exemptions every card is compared against at least its
    // own screen, so this is simply the map size.
    expect(
      Object.keys(HEAD_CAPTURES).length - Object.keys(NOT_YET).length,
      "no card is being compared — this clause now checks nothing",
    ).toBeGreaterThan(1);

    // The two maps must not share a slug: the freshness loop would then compare one card
    // twice, and the count above would over-report in the UNSAFE direction.
    for (const slug of Object.keys(SUB_PAGE_CAPTURES))
      expect(
        HUB_CAPTURES[slug],
        `${slug} is in both HUB_CAPTURES and SUB_PAGE_CAPTURES`,
      ).toBeUndefined();
    expect(
      stale,
      `these cards predate the page they show — re-shoot with ` +
        `\`npx tsx scripts/og/capture-screens.ts ${stale
          .map((l) => l.split(":")[0])
          .join(
            " ",
          )}\` (dev server up), then LOOK at the PNG: ${stale.join("; ")}`,
    ).toEqual([]);
  });

  // ─── the figure half: what the card SHOWS, not when a file moved ───────────────────
  //
  // ⚠️ THIS IS THE CLAUSE THE ONE ABOVE SAYS IT CANNOT BE. Its „WHAT THIS CANNOT SEE" note
  // is explicit that a commit-time comparison means „the card is at least as new as the
  // code that draws it" and never „the numbers are current" — and for the six `/api/db`
  // heads that remains true, because their figures move with no tracked file and nothing
  // here can reach them. For the TWO hubs whose payload IS committed, it can: re-derive
  // what the card shows straight from that payload, through the page's own pure functions,
  // and compare it to what was recorded when the card was last shot.
  //
  // ⚠️ THE POINT IS THE ROUNDING, AND IT IS WHY A COMMIT TIME CANNOT DO THIS JOB. The band
  // renders compact euro at ONE decimal — „€29,6 млрд." — so its granularity is ~0.34% of
  // the total while a daily self-heal moves it 0.004–0.03%. Measured 2026-08-31 over 20
  // committed vintages of each payload: macro.json moved a band figure ONCE (a new Eurostat
  // quarter), sector_stats.json four times (all structural, all on one day). Roughly 40
  // publishes to 1 real move. A fingerprint is silent on the other 39 and fires on the one,
  // which a commit time cannot distinguish — and the sectors total is currently 8.6M EUR
  // (0.029%, ~4-7 daily self-heals) from crossing into „€29,7 млрд.", so the real move is
  // days away and would have arrived as the 40th identical false alarm.
  //
  // ⚠️ DERIVED THROUGH THE PAGE'S OWN FUNCTIONS, never re-implemented. `sectorsHubKpis` and
  // `sectorsHubEvidence` ARE what /governance/sectors renders; the indicators projection
  // walks `KPI_REGISTRY[key].format` and `pickAtOrBefore` exactly as
  // `IndicatorsLandingScreen` builds `bandPoints`. A hand-written projection would be a
  // second opinion about what the card shows and would drift from it with nothing failing —
  // the same defect this file's `declared_label`-style consolidation notes warn about.
  //
  // ⚠️ IT FAILS SAFE. The fingerprint is recorded HERE rather than written by the capture
  // script, so re-shooting a card without updating the constant leaves the clause RED — a
  // card is presumed stale until a human has looked, which is `NON_RENDERING_SOURCE`'s rule
  // one level up. (Having `capture-screens.ts` emit a sidecar beside each PNG would make
  // the record automatic and is the better end state; it is not done here because a partial
  // re-shoot writes a partial sidecar, and that needs its own design.)

  /** The card is shot at the DEFAULT election, so the band resolves against that quarter.
   *  Derived from the corpus rather than written down: a new election legitimately moves
   *  every cell, and the fingerprint should move with it. */
  const latestElectionAsOf = (): { year: number; quarter: 1 | 2 | 3 | 4 } => {
    const names = (elections as Array<{ name: string }>)
      .map((e) => e.name)
      .filter((n) => /^\d{4}_\d{2}_\d{2}$/.test(n))
      .sort();
    const latest = names[names.length - 1];
    const [y, m] = latest.split("_").map(Number);
    return {
      year: y,
      quarter: (Math.floor((m - 1) / 3) + 1) as 1 | 2 | 3 | 4,
    };
  };

  /** Renders the i18n key plus its interpolations, so a basis whose COUNT or YEAR moved
   *  shows up in the fingerprint. The translations themselves are code, not data, and are
   *  covered by the commit-time clause above. */
  const stubT = (k: string, o?: Record<string, unknown>) =>
    o ? [k, ...Object.values(o).map(String)].join(":") : k;

  /** `Intl` groups digits with U+00A0 and U+202F („133 275", „€29,6 млрд."), which are
   *  invisible in a diff and untypeable in the recorded literal below — so a human updating
   *  a fingerprint after a re-shoot would produce a string that looks identical and compares
   *  unequal, for ever. Folded to a plain space: the distinction is an `Intl` formatting
   *  artifact, never a figure moving, and this constant has to be maintainable BY HAND. */
  const typeable = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

  /** The scope key the sectors payload should be projected at, READ OUT OF THE CAPTURE
   *  ENTRY rather than pinned here.
   *
   *  ⚠️ THE COUPLING IS THE POINT. `sector_stats.json` is keyed by scope (30 of them), and
   *  the card is shot at whatever `routePath` says. Hard-coding `all` while the entry says
   *  `?pscope=ns` would validate the full-corpus numbers against a card showing the
   *  parliament window — a GREEN gate asserting the wrong scope, which is the „one scope's
   *  figures under another scope's caption" defect the hub rules name explicitly.
   *
   *  ⚠️ AN ENTRY WITH NO EXPLICIT `pscope` IS REFUSED, not defaulted. The page's own default
   *  is `ns:<latest election>`, so guessing it here would be a second opinion about a
   *  default that lives in `useScope` — and guessing wrong is silent. */
  const sectorsScopeKey = (): string => {
    const entry = entryFor("governance-sectors") ?? "";
    const m = /[?&]pscope=([^"&\s]+)/.exec(entry);
    expect(
      m?.[1],
      "the governance-sectors capture no longer pins an explicit ?pscope — this projection " +
        "cannot know which of the 30 scope keys the card shows, so it must not guess",
    ).toBeTruthy();
    return m![1];
  };

  /** /governance/sectors — the band's four cells and the evidence rail, at the scope its
   *  capture entry pins. */
  const sectorsFigures = (): string => {
    const key = sectorsScopeKey();
    const payload = JSON.parse(
      read("data/procurement/derived/sector_stats.json"),
    );
    const stats = payload[key];
    expect(
      stats,
      `sector_stats.json carries no "${key}" scope — the capture entry and the payload ` +
        "disagree about which window this card shows",
    ).toBeTruthy();
    // `period` is undefined on the all-corpus scope BY DESIGN (`scopeProcurementPeriod`
    // returns none), which is the branch the card is shot on.
    const kpis = sectorsHubKpis(
      stats,
      "bg",
      undefined,
      stubT,
      (id) => id,
      (id) => `/sector/${id}`,
      "/procurement?pscope=all",
    );
    const rail = sectorsHubEvidence(
      stats,
      "bg",
      stubT,
      (id) => id,
      (id) => `/sector/${id}`,
    );
    return typeable(
      [
        ...kpis.map((k) => `${k.label}=${k.value} [${k.basis}]`),
        "|",
        ...(rail?.rows ?? []).map((r) => `${r.id}=${r.value}`),
      ].join(" "),
    );
  };

  /** /indicators — the band's four cells and the peer rail's ranks, mirroring
   *  `IndicatorsLandingScreen`'s `bandPoints` and `peerRanks`. */
  const indicatorsFigures = (): string => {
    // ⚠️ THE SAME COUPLING, one page over: `latestElectionAsOf()` is the right anchor only
    // while the capture carries no `?elections=`. It does not today; pinned so that adding
    // one fails here rather than silently fingerprinting a different quarter than the card.
    expect(
      entryFor("indicators") ?? "",
      "the indicators capture now pins an election — latestElectionAsOf() is no longer the " +
        "asOf this card resolves against",
    ).not.toContain("elections=");
    const macro = JSON.parse(read("data/macro.json"));
    const peers = JSON.parse(read("data/macro_peers.json"));
    const asOf = latestElectionAsOf();
    const band: string[] = [];
    const rail: string[] = [];
    for (const key of BAND_INDICATORS) {
      const entry = KPI_REGISTRY[key];
      const meta = macro.indicators?.[key];
      const point = pickAtOrBefore(macro.series?.[key], asOf);
      // A withheld cell is part of the card's shape, so it is RECORDED rather than
      // skipped — a series losing its last point would otherwise shorten the band with
      // the fingerprint unchanged.
      if (!entry || !meta || !point) {
        band.push(`${key}=withheld`);
        continue;
      }
      // ⚠️ `titleBg` IS IN HERE FOR A REASON — it is the one payload-driven string the card
      // renders that an earlier cut of this projection dropped, and dropping it was the
      // COARSE direction (a missed real change, not a false alarm). The card prints it
      // twice per indicator: as the KPI cell's label and as the peer-rail row's label. A
      // refresh that re-words a series title moves eight visible strings, and without this
      // the fingerprint would be silent about all eight — the exact failure this clause
      // exists to end, one field over.
      band.push(
        `${key}=${entry.format(point.value)} [${meta.titleBg} · ${meta.unitLabelBg} · ${point.period}]`,
      );
      // The rail row renders only when the distribution's period matches the figure's —
      // the screen's own strict compare, restated because the screen resolves it inline.
      const dist = peers.indicators?.[key]?.latestDistribution;
      if (!dist || !point.period || !dist.period) continue;
      if (dist.period !== point.period) continue;
      if (!dist.rank || !dist.total) continue;
      rail.push(`${key}=${dist.rank}/${dist.total}`);
    }
    return typeable([...band, "|", ...rail].join(" "));
  };

  /** slug → the projection, the payloads behind it, and what the CARD ON DISK shows.
   *
   *  ⚠️ THE `figures` STRING IS THE RECORD OF A HUMAN HAVING LOOKED. Update it only
   *  together with a re-shoot of that card — never to make a red clause green, which is
   *  the one move that turns this into a rubber stamp. The remedy the failure prints is a
   *  re-shoot for exactly that reason. */
  const CARD_FIGURES: Record<
    string,
    {
      payloads: string[];
      project: () => string;
      figures: string;
      shot: string;
      /** md5 of the PNG as recorded. See the clause below for why BOTH this and `shot`
       *  are asserted — they catch opposite halves of the same dishonesty. */
      md5: string;
    }
  > = {
    "governance-sectors": {
      payloads: ["data/procurement/derived/sector_stats.json"],
      project: sectorsFigures,
      md5: "710f562634292854e9ea1b609e62dfcb",
      // NOT re-shot, and that is the result rather than an omission: this projection is
      // BYTE-IDENTICAL at the card's own commit (6b1e0d3381) and at HEAD, across five
      // intervening payload refreshes. The old clause reddened this card on every one of
      // them. Measured headroom 2026-08-31: the procurement total is €8.6m (0.029%) below
      // the boundary into „€29,7 млрд.", i.e. ~4-7 more daily self-heals — so this entry is
      // expected to fire soon, for real, and that firing is the clause working.
      shot: "2026-08-26",
      figures:
        "sectors_kpi_procurement=€29,6 млрд. [sectors_kpi_procurement_basis:4] " +
        "defense=€2,6 млрд. [sectors_kpi_budget_basis:2026] " +
        "pension=€11,1 млрд. [sectors_kpi_payout_basis:2024] " +
        "administration=133 275 [sectors_kpi_headcount_basis:2025] " +
        "| energy=€10,3 млрд. roads=€8,8 млрд. transport=€7,3 млрд. water=€3,3 млрд.",
    },
    indicators: {
      payloads: ["data/macro.json", "data/macro_peers.json"],
      project: indicatorsFigures,
      md5: "aaf81b9466e0a20767031c4198ee0e48",
      // ⚠️ RE-SHOT 2026-08-31, AND THIS CLAUSE IS WHY — the first real thing it found. The
      // 2026-08-26 card carried „Растеж на реалния БВП · 7 от 22" on its peer rail; more
      // member states have since reported 2026-Q2, so Bulgaria's growth rank is 8 of 24.
      // Everything else on the card was unchanged, which is exactly why the commit-time
      // clause could not surface it: both payloads had ALSO moved on 08-27, 08-28, 08-29
      // and 08-30 without touching a pixel, so the one commit that mattered arrived as the
      // fifth identical false alarm and was cleared by a sha bump like the other four.
      shot: "2026-08-31",
      figures:
        "gdpGrowth=2.7% [Растеж на реалния БВП · % спрямо същия период предходна " +
        "година (реален, SCA) · 2026-Q2] " +
        "inflation=5.8% [Инфлация (ХИПЦ) · % спрямо предходната година (ХИПЦ, " +
        "тримес. ср.) · 2026-Q2] " +
        "unemployment=3.0% [Безработица · % от активното население (сезонно " +
        "изгладено) · 2026-Q1] " +
        "govDebt=28.5% [Брутен държавен дълг · % от БВП · 2026-Q1] " +
        "| gdpGrowth=8/24 inflation=26/27 unemployment=1/27 govDebt=3/27",
    },
  };

  it("no hub card shows a figure its payload has since moved", () => {
    const moved: string[] = [];
    const checked: string[] = [];
    // ⚠️ `shot` AND `md5` ARE BOTH ASSERTED, AND NEITHER IS REDUNDANT — they catch OPPOSITE
    // halves of the same dishonesty, which is why the obvious "just pick one" is wrong:
    //
    //   • `md5` catches a card RE-SHOT WITHOUT BEING RECORDED — the bytes moved and the
    //     fingerprint beside them did not, so the record has quietly stopped describing the
    //     file. It reads the PNG, so it works everywhere, CI included.
    //   • `shot` catches the RUBBER STAMP, which is the failure this clause invites: a red
    //     run cleared by pasting the `payload now` line from the output into `figures`, with
    //     no PNG re-shot and no human looking. md5 is BLIND to that — the card did not change
    //     — and only "was the card committed at least as recently as the date its own record
    //     claims" can see it.
    //
    // That is `NON_RENDERING_SOURCE`'s doctrine one level up: a claim is safe when it
    // EXPIRES on its own, not when its docblock asks nicely.
    //
    // ⚠️ THE `shot` HALF STANDS DOWN ON A SHALLOW CLONE, and CI has one — `git log -1` then
    // returns the same commit for every path. Skipped with a distinct reason rather than
    // passing, but only that half: `md5` runs regardless, so the clause never checks nothing.
    const shallow =
      execSync("git rev-parse --is-shallow-repository", {
        encoding: "utf8",
      }).trim() === "true";
    if (shallow)
      reportSkip(
        import.meta.url,
        "shallow clone — the `shot` half of card-figure provenance is unverifiable",
      );
    for (const [slug, spec] of Object.entries(CARD_FIGURES)) {
      if (NOT_YET[slug]) continue;
      const rel = `public/og/${slug}.png`;
      expect(
        createHash("md5")
          .update(fs.readFileSync(path.join(REPO, rel)))
          .digest("hex"),
        `${rel} has been re-shot since its figures were recorded — re-derive the ` +
          "fingerprint and update `figures`, `shot` and `md5` together",
      ).toBe(spec.md5);
      if (!shallow) {
        const cardAt =
          Number(
            execFileSync("git", ["log", "-1", "--format=%ct", "--", rel], {
              encoding: "utf8",
            }).trim(),
          ) * 1000;
        expect(cardAt, `no commit found for ${rel}`).toBeGreaterThan(0);
        expect(
          cardAt,
          `${slug}: \`shot\` claims ${spec.shot} but ${rel} was last committed ` +
            `${new Date(cardAt).toISOString().slice(0, 10)} — the record was updated ` +
            "without re-shooting the card, which is the one move that makes this clause a " +
            "rubber stamp",
        ).toBeGreaterThanOrEqual(Date.parse(spec.shot));
      }
      const now = spec.project();
      // Non-vacuity per projection: one that started returning nothing — a payload shape
      // change, a renamed scope key — would otherwise match a recorded empty string and
      // report every card as current for ever.
      expect(
        now.replace(/[|\s]/g, "").length,
        `${slug}: the projection produced nothing — the payload's shape has changed, so ` +
          "this card is no longer being checked against anything",
      ).toBeGreaterThan(20);
      if (now !== spec.figures)
        moved.push(
          `${slug}:\n     card (${spec.shot}) ${spec.figures}\n     payload now  ${now}`,
        );
      checked.push(slug);
    }
    // ⚠️ COUNTS THE CARDS ACTUALLY CHECKED, not the map's size. The first cut asserted
    // `Object.keys(CARD_FIGURES).length > 1` — the size of the DECLARATION — so putting both
    // slugs in `NOT_YET` would have left this checking zero cards and reading green. That is
    // the arithmetic-right/claim-false shape the freshness clause's own non-vacuity note
    // records having shipped once; both siblings above count `checked`.
    expect(
      checked.length,
      "no card's figures are being checked",
    ).toBeGreaterThan(1);
    expect(
      moved,
      `these cards show figures the committed payload has since moved — re-shoot with ` +
        `\`npx tsx scripts/og/capture-screens.ts ${moved
          .map((l) => l.split(":")[0])
          .join(
            " ",
          )}\` (dev server up), LOOK at the PNG, then update \`figures\` and ` +
        `\`shot\` here to match:\n  ${moved.join("\n  ")}`,
    ).toEqual([]);
  });

  /** Cards whose wait must assert a cell COUNT — because the band can render SHORT, or to
   *  pin an all-or-nothing band against a later „simplification".
   *
   *  ⚠️ THE SECOND HALF OF THAT SENTENCE ARRIVED WITH `governance-mayor-pay`, and for one
   *  commit the docstring did not: the map said „cards whose head can render short" while
   *  its newest member opens by saying it is not one. A map whose contract disagrees with
   *  its contents can only be resolved by reading an entry-level comment, which is how the
   *  member after next gets classified wrong.
   *
   *  ⚠️ NOTHING ELSE IN THIS FILE LOOKS AT `waitFor`, so a later „simplification" to
   *  `waitFor: "[data-hub-head]"` passes every other clause here and silently restores the
   *  defect both of these entries exist to prevent: a partially-rendered band resolving the
   *  wait, the runner overwriting a good card with a short one, and reporting success.
   *
   *  Both members can legitimately be short — `/governance/sectors` on 12 of 30 scope keys
   *  (a band cell is withheld when its basis has no publishable sector) and `/indicators` on
   *  1 of 13 elections (`unemployment` starts 2009-Q1 against 2005-Q1 for the rest). Naming
   *  a cell cannot express that; only a sibling chain asserts LENGTH.
   *
   *  ⚠️ THE COUNT IS PER ENTRY, NOT A CONSTANT FOUR. `/parliamentary/reports` is a TWO-cell
   *  band — its registry carries a `statId` for `risk` and `turnout` only — so a fixed
   *  four-cell rule would demand a chain that never resolves, and every capture of a
   *  correctly-rendering page would time out. This was a `hops < 3` literal until
   *  2026-08-27, when the two-cell hub arrived. */
  const COUNTED_WAITS: Record<string, number> = {
    "governance-sectors": 4,
    indicators: 4,
    // ⚠️ HERE THE COUNT IS EXACT, NOT A FLOOR. The two literals above can legitimately
    // render short and the chain is what stops a short card being shot; this band is
    // all-or-nothing — either the ranking loaded or it did not — so it renders 4 or 0.
    //
    // ⚠️ AND IT IS DERIVED, because this band IS a declared array and so falls under the
    // rule the two entries below state rather than the exception the two above take. It
    // was a hand-written `4` for one commit, which fails in the ugly direction: drop to
    // three cells and THIS clause stays green (`hops >= cells - 1`) while the capture
    // SELECTOR still demands four siblings and never resolves — `captureOne` throws, the
    // runner keeps the PREVIOUS card, and the only signal is a line of stderr.
    "governance-mayor-pay": MAYOR_PAY_BAND_CELLS,
    // ⚠️ DERIVED FROM THE BANDS THEMSELVES, not restated. A literal `2` here is a second
    // copy of `REPORTS_BAND.length`, so adding a third stat to that array would leave the
    // wait demanding two, this clause asserting two, every test green — and a SHORT band
    // shot and reported as success, which is the exact defect this clause exists to prevent,
    // reached without touching it. The other two entries are numbers because their bands are
    // built from a payload rather than a declared array.
    "analysis-hub": ANALYSIS_BAND.length,
    "reports-hub": REPORTS_BAND.length,
  };

  it("a head that can render short waits on a cell COUNT, not a selector", () => {
    const offenders: string[] = [];
    for (const [slug, cells] of Object.entries(COUNTED_WAITS)) {
      const entry = entryFor(slug);
      if (!entry) {
        offenders.push(`${slug}: no capture entry`);
        continue;
      }
      // N cells means N-1 `~` hops between `[data-kpi-cell]` selectors.
      const hops = (entry.match(/\[data-kpi-cell\]\s*~/g) ?? []).length;
      if (hops < cells - 1)
        offenders.push(
          `${slug}: waits on ${hops + 1} cell(s) of ${cells}, so a short band resolves it`,
        );
    }
    expect(
      offenders,
      `these cards can be overwritten by a short band: ${offenders.join("; ")}`,
    ).toEqual([]);
    // Non-vacuity: the list is real and every member has an entry to check.
    expect(Object.keys(COUNTED_WAITS).length).toBeGreaterThan(1);
  });

  it("the map names every HubHead screen, so a new hub cannot slip past", () => {
    const screens = execSync("grep -rl 'HubHead' src/screens --include=*.tsx", {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean)
      // ⚠️ TESTS ARE NOT SCREENS. `stripJsxComments` removes comments, not STRING literals,
      // so a test whose assertion message reads „is `evidence` still passed to <HubHead>?"
      // matched the call-site filter and was demanded as a hub — which it can never be.
      .filter((f) => !f.includes(".test."))
      // A screen that only MENTIONS HubHead in prose is not a call site.
      .filter((f) => /<HubHead\b/.test(stripJsxComments(read(f))));
    expect(screens.length, "no screen renders HubHead").toBeGreaterThan(2);

    const known = new Set([
      ...Object.values(HUB_CAPTURES),
      ...Object.values(SUB_PAGE_CAPTURES),
      ...SUB_PAGE_HEADS,
    ]);
    const unlisted = screens.filter((f) => !known.has(f));
    expect(
      unlisted,
      `these render a HubHead but are in neither HUB_CAPTURES nor SUB_PAGE_HEADS — decide ` +
        `which, so the card gate can see them: ${unlisted.join(", ")}`,
    ).toEqual([]);
  });

  it("every mapped screen still renders a head, and every exemption still earns it", () => {
    for (const [slug, file] of Object.entries(HEAD_CAPTURES))
      expect(
        /<HubHead\b/.test(stripJsxComments(read(file))),
        `${slug} is mapped to ${file}, which no longer renders a HubHead`,
      ).toBe(true);
    // ⚠ EMPTY AGAIN, so this loop runs zero times — and it has now earned its keep THREE
    // times, all on 2026-08-26, each entry paid off within a commit (see NOT_YET's own
    // comment for which, and for the one that differed). `NOT_YET` is the
    // documented mechanism for a hub that cannot yet frame its head, and a typed map with a
    // live validation loop is what stops the next person adding an exemption with no reason.
    // Do NOT delete it for being empty: emptiness is the healthy state, and the entry that
    // used it was paid off within a day rather than lingering.
    for (const slug of Object.keys(NOT_YET)) {
      expect(
        HUB_CAPTURES,
        `${slug} is exempted but is not a hub — drop the entry`,
      ).toHaveProperty(slug);
      expect(NOT_YET[slug].length, `${slug} needs a reason`).toBeGreaterThan(
        20,
      );
    }
  });
});

// ---------------------------------------------------------------------------

describe("the /culture/funds bodies quote no figure", () => {
  // ⚠️ WHY THIS FILE AND NOT A DATA TEST. These five bodies (the parent and its
  // four source arms) describe figures that live in `hub_stats.json`, which the
  // PRERENDER DOES NOT READ — so anything numeric here is a frozen string beside
  // a page whose every rendered figure self-updates, and the two drift with
  // nothing red. `culture_hub_figures.data.test.ts` guards the blob and never
  // opens routes.ts; `cultureFundSources.test.ts` guards the registry's chart
  // notes and never opens it either. Nothing looked at the bodies.
  //
  // It shipped: „един проект" / „one listed project" in four places, four lines
  // below the banner forbidding exactly that — and a spelled-out count is a
  // figure. That one is `eikExactProjects − eikExactAlsoByName`, the value
  // `eikNameMissed()` exists to derive ONCE, and a frozen body cannot express
  // its other two branches (at zero the claim inverts; with the field missing
  // from the blob nothing may be said at all).
  const CULTURE_FUNDS_PATHS = [
    "culture/funds",
    "culture/funds/isun-eik",
    "culture/funds/isun-name",
    "culture/funds/interreg",
    "culture/funds/dfz",
  ];

  /** Cardinals, Bulgarian and English. */
  const CARDINAL =
    "един|една|едно|два|две|три|четири|пет|шест|седем|осем|девет|десет|единайсет|единадесет|дванайсет|дванадесет|петнайсет|петнадесет|шестнайсет|шестнадесет|двайсет|двадесет|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|sixteen|twenty";

  /** What these four arms COUNT — the nouns whose tallies live in
   *  `hub_stats.json` and are derived on the page. */
  const COUNTED =
    "проект|проекта|проекти|плащане|плащания|участие|участия|институция|институции|получател|получатели|бенефициент|бенефициенти|projects?|payments?|participations?|institutions?|recipients?|beneficiaries";

  /** A cardinal DIRECTLY QUALIFYING one of those nouns — „един проект", „one
   *  listed project", „три плащания".
   *
   *  ⚠️ THIS IS A RULE, NOT AN EXEMPTION LIST, and the first cut was the other
   *  way round: it refused every cardinal anywhere in the prose and then grew
   *  carve-outs for „one row is …", „mostly one programme", „to this one",
   *  „One organisation can be spelled two ways" — four in a row, with more
   *  coming, which is a gate turning into a list of the things it does not
   *  check. What these pages COUNT is projects, payments, participations,
   *  institutions and recipients; a programme, an instrument or an organisation
   *  appearing after „one" in a sentence is grammar, not a tally. Up to three
   *  words may sit between („one EIK-listed project"), which is the shape the
   *  defect actually took. */
  //  ⚠️ `\b` IS ASCII-ONLY AND NEVER MATCHES BESIDE A CYRILLIC LETTER, so the
  //  first cut of this regex silently missed „един проект" — the very string it
  //  was written for — while matching the English one and looking correct. Use
  //  the Unicode-aware lookarounds with the `u` flag. This trap is documented
  //  repo-wide (see the subcontracting parser's „(Да|Не)" boundary note).
  const NOT_LETTER = "(?![\\p{L}\\p{N}])";
  const NOT_LETTER_BEFORE = "(?<![\\p{L}\\p{N}])";
  //  ONE structural exclusion, and it is a different sentence rather than an
  //  exception to this one: „един РЕД е …" / „one ROW is …" DEFINES what a row
  //  is, which every body carries by design — it is the basis statement the last
  //  test in this block requires. „Един ред тук е проект" says a row is a
  //  project; it counts nothing.
  //  ⚠️ And the SAME ASCII trap one level down: `ред\b` does not fire either,
  //  because `д` is not an ASCII word character. The boundary has to be the
  //  Unicode lookahead here too.
  const ROW_DEFINITION = `(?!\\s+(ред|row)${NOT_LETTER})`;
  const COUNTED_CARDINAL = new RegExp(
    `${NOT_LETTER_BEFORE}(${CARDINAL})${NOT_LETTER}${ROW_DEFINITION}` +
      `(?:\\s+[\\p{L}-]+){0,3}\\s+` +
      `${NOT_LETTER_BEFORE}(${COUNTED})${NOT_LETTER}`,
    "iu",
  );

  const bodiesFor = (path: string): [string, string][] => {
    const r = prerenderRoutes.find((x) => x.path === path);
    if (!r) return [];
    const out: [string, string][] = [[`${path} (bg)`, r.bodyHtml ?? ""]];
    if (r.english?.bodyHtml) out.push([`${path} (en)`, r.english.bodyHtml]);
    return out;
  };

  it("every /culture/funds body exists in both languages", () => {
    // Non-vacuity: the loops below are green over an empty list.
    for (const p of CULTURE_FUNDS_PATHS)
      expect(bodiesFor(p).length, `${p} has no prerendered body`).toBe(2);
  });

  it("no body quotes a euro figure, a percentage or a digit run", () => {
    for (const p of CULTURE_FUNDS_PATHS)
      for (const [name, html] of bodiesFor(p)) {
        // Strip hrefs — a URL may legitimately carry digits (none do today).
        const prose = html.replace(/href="[^"]*"/g, "");
        expect(prose, `${name} quotes a euro figure`).not.toMatch(/€/);
        expect(prose, `${name} quotes a percentage`).not.toMatch(/\d\s*%/);
        // A run of digits is a corpus figure. Scheme codes („321 и 322") are
        // stable programme identifiers rather than measurements, and the ИСУН
        // programme codes are names — both are allowed by the exemption below.
        // ⚠️ Strip the surrounding punctuation before testing: „ИСУН 2020,"
        // matches as „2020, " and would fail an exemption list of bare numbers.
        const digits = (prose.match(/\b\d[\d\s.,]*\b/g) ?? [])
          .map((d) => d.replace(/[^\d]/g, ""))
          // Register and programme NAMES, not measurements: „ИСУН 2020" is what
          // the register is called, and 321/322 are scheme codes. Neither moves
          // with the corpus, which is the whole test.
          .filter((d) => !/^(321|322|2020|2014|2021|2027|1420|2127)$/.test(d));
        expect(
          digits,
          `${name} quotes the figure(s) ${digits.join(", ")}`,
        ).toEqual([]);
      }
  });

  it("no body spells out a count of the rows it describes", () => {
    // The form the defect took: „един проект от списъка по ЕИК няма културна
    // дума" — a count of ROWS IN A SET, four lines under a banner forbidding
    // figures. It is `eikExactProjects − eikExactAlsoByName`, the value
    // `eikNameMissed()` exists to derive ONCE, and a frozen body cannot express
    // its other two branches (at zero the claim inverts; with the field missing
    // from the blob nothing may be said at all).
    for (const p of CULTURE_FUNDS_PATHS)
      for (const [name, html] of bodiesFor(p)) {
        const m = html.replace(/href="[^"]*"/g, "").match(COUNTED_CARDINAL);
        expect(
          m?.[0] ?? null,
          `${name} spells out a count („${m?.[0]}") — it is a corpus figure the ` +
            `prerender cannot refresh, and the page beside it derives the same ` +
            `number from the blob`,
        ).toBeNull();
      }
  });

  it("that rule still fires — it is not a regex that matches nothing", () => {
    // §13: a scanner whose pattern never matches is green for ever, and this one
    // was rewritten from a broad refusal into a narrow rule, which is exactly
    // when a pattern quietly stops matching. These are the shapes it must catch,
    // and the ones it must let through.
    for (const bad of [
      "един проект от списъка по ЕИК няма културна дума",
      "one EIK-listed project carries no culture word",
      "три плащания",
      "two participations",
    ])
      expect(bad, `the rule missed „${bad}"`).toMatch(COUNTED_CARDINAL);
    for (const ok of [
      "One row here is an ИСУН project",
      "mostly one programme (the RRF)",
      "One organisation can be spelled two ways",
      "their figures do not add to this one",
      "предимно по една програма",
    ])
      expect(ok, `the rule wrongly refuses „${ok}"`).not.toMatch(
        COUNTED_CARDINAL,
      );
  });

  it("every source body states its own basis and its own limit", () => {
    // A crawler — and a reader arriving from one — never sees the parent's
    // „these do not sum" sentence, so each arm carries the rule itself.
    for (const p of CULTURE_FUNDS_PATHS.slice(1)) {
      const [[, bg], [, en]] = bodiesFor(p);
      expect(bg, `${p} (bg) states no limit`).toMatch(/НЕ отговаря/);
      expect(en, `${p} (en) states no limit`).toMatch(/does NOT answer/);
      // Case-insensitive: the parent shouts it („НЕ се събират") and the arms
      // say it in running prose („не се събират с този").
      expect(bg, `${p} (bg) does not say the arms do not sum`).toMatch(
        /не се събират/i,
      );
      // Case-insensitive on both sides: the parent shouts it and the arms say
      // it in running prose.
      expect(en, `${p} (en) does not say the arms do not sum`).toMatch(
        /do not add|does not add/i,
      );
    }
  });
});
