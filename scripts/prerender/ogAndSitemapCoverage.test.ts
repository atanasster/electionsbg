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
import { execFileSync, execSync } from "node:child_process";
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
  };

  /** HubHead call sites that are NOT module front pages, so they ship no hub card. */
  const SUB_PAGE_HEADS = [
    "src/screens/dev/ContractsBrowserDbScreen.tsx",
    // The four /culture/funds source pages share ONE screen. They are sub-pages
    // of the culture module, not module front pages, so they ship no HUB card —
    // they carry their own per-arm og capture entries instead
    // (`culture-funds-<arm>` in scripts/og/capture-screens.ts).
    "src/screens/culture/CultureFundsSourceScreen.tsx",
    // /governance/declarations is a sub-hub OF the governance module — it sits under
    // /governance, which owns the module card. So it ships no HUB card and carries its
    // own og capture entry instead (`governance-declarations` in
    // scripts/og/capture-screens.ts).
    "src/screens/governance/GovernanceDeclarationsScreen.tsx",
  ];

  /** Hubs whose card does not yet frame the head, with the reason. A real debt, named so the
   *  list shrinks rather than the rule. */
  const NOT_YET: Record<string, string> = {};

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
    for (const slug of Object.keys(HUB_CAPTURES)) {
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
    for (const slug of Object.keys(HUB_CAPTURES)) {
      if (NOT_YET[slug]) continue;
      const entry = entryFor(slug) ?? "";
      expect(
        /viewport:\s*OG_CLIP_VIEWPORT/.test(entry),
        `${slug}: uses a hand-written viewport instead of OG_CLIP_VIEWPORT`,
      ).toBe(true);
      checked.push(slug);
    }
    // The same floor its sibling above carries. Without it, an exemption list that grew to
    // cover every hub would leave this clause asserting nothing while still reading green —
    // and `NOT_YET` is empty today, which is exactly when the floor is free to add.
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
    for (const slug of Object.keys(HUB_CAPTURES)) {
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
    const FIGURES: Record<string, string> = {
      budget: "src/screens/budget/budgetHubFigures.ts",
      funds: "src/screens/funds/fundsHubFigures.ts",
      consumption: "src/screens/consumption/consumptionHubFigures.ts",
      subsidies: "src/screens/subsidies/subsidiesHubFigures.ts",
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
    const CURRENT_DESPITE: Record<string, string> = {
      // 2026-08-26 — verified by re-running `capture-screens.ts <slug>`: all five produced
      // files identical to the committed ones, because the only source change since was
      // HubHead's `data-kpi-cell` marker.
      parliament: "HubHead's data-kpi-cell marker does not render",
      procurement: "HubHead's data-kpi-cell marker does not render",
      governance: "HubHead's data-kpi-cell marker does not render",
      budget: "HubHead's data-kpi-cell marker does not render",
      consumption: "HubHead's data-kpi-cell marker does not render",
    };

    const stale: string[] = [];
    for (const [slug, screen] of Object.entries(HUB_CAPTURES)) {
      if (CURRENT_DESPITE[slug]) continue;
      const card = at(`public/og/${slug}.png`);
      const page = at(screen);
      expect(card, `no commit found for public/og/${slug}.png`).toBeGreaterThan(
        0,
      );
      expect(page, `no commit found for ${screen}`).toBeGreaterThan(0);
      const extra = FIGURES[slug];
      const extraAt = extra ? at(extra) : 0;
      if (extra)
        expect(extraAt, `no commit found for ${extra}`).toBeGreaterThan(0);
      const sources: [string, number][] = [
        [screen, page],
        [HEAD, headAt],
        ...(extra ? ([[extra, extraAt]] as [string, number][]) : []),
      ];
      const [src, newest] = sources.reduce((a, b) => (b[1] > a[1] ? b : a));
      if (card < newest)
        stale.push(
          `${slug}: card ${new Date(card * 1000).toISOString().slice(0, 10)} < ` +
            `${src} ${new Date(newest * 1000).toISOString().slice(0, 10)}`,
        );
    }
    // Non-vacuity: an exemption list that grew to cover every card would leave this
    // asserting nothing while still reading green.
    expect(
      Object.keys(HUB_CAPTURES).length - Object.keys(CURRENT_DESPITE).length,
      "every hub card is exempted — this clause now checks nothing",
    ).toBeGreaterThan(1);
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

    const known = new Set([...Object.values(HUB_CAPTURES), ...SUB_PAGE_HEADS]);
    const unlisted = screens.filter((f) => !known.has(f));
    expect(
      unlisted,
      `these render a HubHead but are in neither HUB_CAPTURES nor SUB_PAGE_HEADS — decide ` +
        `which, so the card gate can see them: ${unlisted.join(", ")}`,
    ).toEqual([]);
  });

  it("every mapped screen still renders a head, and every exemption still earns it", () => {
    for (const [slug, file] of Object.entries(HUB_CAPTURES))
      expect(
        /<HubHead\b/.test(stripJsxComments(read(file))),
        `${slug} is mapped to ${file}, which no longer renders a HubHead`,
      ).toBe(true);
    // ⚠ EMPTY TODAY, so this loop runs zero times — deliberately kept rather than deleted.
    // `NOT_YET` is the documented mechanism for the next hub that cannot yet frame its head,
    // and a typed map with a live validation loop is what stops the next person adding an
    // exemption with no reason. If it is still empty a year from now, delete both.
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
