import fs from "fs";
import path from "path";
import { test, expect, type APIResponse } from "@playwright/test";

// Per-segment percent-encode (matches scripts/prerender/index.ts:encodeUrlPath).
const enc = (p: string): string =>
  p
    .split("/")
    .map((seg) => (seg ? encodeURIComponent(seg) : seg))
    .join("/");

// The prerender step in `npm run build` reads generated JSON under
// data/<YYYY_MM_DD>/ — most notably national_summary.json — to fill in
// titles, h1s, and the hidden ssg-content body. Those files are produced by
// `npm run data` and are gitignored (`/data/2*/*`), so on a fresh checkout
// with no data run the prerender silently emits empty bodies. Asserting on
// empty content would just produce hundreds of confusing failures, so we skip
// the SEO suite in that case. CI surfaces the skip in the run summary, which
// is the signal that the data pipeline needs to run.
//
// THE DIRECTORY IS THE WHOLE GUARD, so it has to track the prerender's.
// This read `public/<date>/` until 2026-08-03. The election folders moved to
// data/ during the GCS migration — to keep them out of the Firebase deploy;
// see the note at scripts/prerender/dynamicRoutes.ts:3683 and the data/ mount
// in vite.config.ts — and this guard was not moved with them. It was therefore
// false on every machine and in CI from that migration onward, and all 46 SEO
// tests skipped, reported as the ordinary "run the data pipeline" skip. If the
// data root moves again, move this with it.
const DATA_DIR = path.resolve(process.cwd(), "data");
const PREREQ_DATA_PRESENT = (() => {
  if (!fs.existsSync(DATA_DIR)) return false;
  return fs
    .readdirSync(DATA_DIR)
    .filter((d) => /^\d{4}_\d{2}_\d{2}$/.test(d))
    .some((d) =>
      fs.existsSync(path.join(DATA_DIR, d, "national_summary.json")),
    );
})();
const SKIP_REASON =
  "prerender data not generated (no data/<date>/national_summary.json) — run `npm run data` first";

// Sample dynamic identifiers that exist in every recent election dataset.
// If these change, update here — the failure message will point to this file.
const SAMPLE_PARTY = "ГЕРБ-СДС";
const SAMPLE_CANDIDATE = "Бойко Методиев Борисов";
// Judicial bodies — from the `judicial_body` table (db:load:judicial-bodies:pg),
// NOT from an election dataset, so these do not change when a new election
// lands. A court WITH a published workload, a prosecution office (which never
// has one), and a COURT that has none: the three shapes /court/:bodyCode has to
// keep apart.
const SAMPLE_COURT = "sgs";
// Structurally load-less — the ВСС report covers courts, so all 70 prosecution
// offices and all 28 investigation services are. This one will never flip.
const SAMPLE_PROSECUTION = "ap-burgas";
// Load-less by accident of the source: 1 of only 6 such COURTS out of 186. If
// the ВСС ever publishes ВКС's workload, or the loader folds a new court_load
// spelling onto it, the load-less assertion below fails — that is a data change,
// not a bug. `vas` (the other Supreme Court) is the drop-in replacement.
const SAMPLE_LOADLESS_COURT = "vks";

// Pension fund — from the committed КФН archive data/budget/kfn/funds.json. The
// slug is kfnFundSlug(pillar, companyEn), so a company RENAME moves it.
const SAMPLE_FUND = "upf-doverie";

// /court/** is enumerated from Postgres at BUILD time (readSeoCourts degrades to
// [] when the database is down or migration 116 is unapplied), so a checkout
// that built without one has the election data but none of these pages. Skip
// rather than emit seven failures that all mean "run `npm run db:pg:up`". The
// pension family needs no guard — its archive is committed.
const PREREQ_COURTS_PRESENT = fs.existsSync(
  path.resolve(process.cwd(), "dist", "court", "sgs", "index.html"),
);
const SKIP_COURTS =
  "judicial-body prerender absent (no dist/court/**) — Postgres was down at build time, run `npm run db:pg:up` and rebuild";

const HOME_TITLE_BG_PREFIX = "Парламентарни избори";
const HOME_TITLE_EN_PREFIX = "Bulgarian Parliamentary Elections";

type RouteCheck = {
  path: string;
  // Substring expected in <title>. Distinguishes routes from the home page,
  // which would otherwise be the SPA fallback for unprerendered URLs.
  titleIncludes: string;
  // Substring expected in the prerendered <h1>.
  h1Includes?: string;
  // Minimum visible text length inside the hidden <div id="ssg-content">.
  // 0 = body content not asserted (a few sub-tabs intentionally inherit a
  // shorter body). Sub-tabs that should reuse the parent body have non-zero.
  //
  // MIND THE FLOOR: every page's #ssg-content ends with the shared site-index
  // <nav>, which is ~540-560 chars on its own. A value below that cannot fail —
  // it would pass on a completely empty bodyHtml. Set it above the nav (800+)
  // whenever the point is that the page has PROSE.
  minBodyChars?: number;
  // Expected canonical path (after stripping the origin).
  expectedCanonical?: string;
  // Set when this route has a prerendered EN mirror.
  hasEnglishMirror?: boolean;
  // Set when the route's pages only exist if Postgres was up at build time.
  // Skipped rather than failed on a database-less checkout.
  requiresCourts?: boolean;
};

// Routes that previously fell through to /index.html and now have unique
// prerendered HTML. If anything in this table regresses, search engines will
// see duplicate content again — so the suite is intentionally exhaustive.
const ROUTES: RouteCheck[] = [
  // Home — the only route that should canonicalize to "/"
  {
    path: "/",
    titleIncludes: HOME_TITLE_BG_PREFIX,
    h1Includes: "Парламентарни избори",
    minBodyChars: 800,
    expectedCanonical: "/",
    hasEnglishMirror: true,
  },

  // Static landings — were title-only before; now ship indexable bodies.
  {
    path: "/about",
    titleIncludes: "За проекта",
    h1Includes: "За проекта",
    minBodyChars: 800,
    expectedCanonical: "/about",
    hasEnglishMirror: true,
  },
  {
    path: "/sofia",
    titleIncludes: "София — резултати от парламентарните избори",
    h1Includes: "София",
    minBodyChars: 500,
    expectedCanonical: "/sofia",
    hasEnglishMirror: true,
  },
  {
    path: "/financing",
    titleIncludes: "Финансиране на партии",
    h1Includes: "Финансиране",
    minBodyChars: 500,
    expectedCanonical: "/financing",
    hasEnglishMirror: true,
  },
  {
    path: "/simulator",
    titleIncludes: "Симулатор",
    h1Includes: "Симулатор",
    minBodyChars: 500,
    expectedCanonical: "/simulator",
    hasEnglishMirror: true,
  },
  {
    path: "/compare",
    titleIncludes: "Сравнение",
    h1Includes: "Сравнение",
    minBodyChars: 500,
    expectedCanonical: "/compare",
    hasEnglishMirror: true,
  },
  // NOT here, and deliberately: /timeline and /sofia/timeline. The seven
  // standalone timeline screens were retired in f53cea0a93 (2026-05-18), which
  // replaced them with the inline "Консолидирани данни" toggle on every
  // HistoricalTrendsTile and deleted their routes, screens, menu item, sitemap
  // and prerender entries. That commit missed the two RouteCheck entries here,
  // and the skip fixed in fe6f6b63be hid the resulting failures until
  // 2026-08-03. Both URLs now hit the `path="*"` catch-all in src/routes.tsx
  // and render <NotFound />, so prerendering them would ship indexable HTML for
  // a page that 404s on hydration — do not re-add without restoring the routes.

  // Top-level list pages — previously fell through to home.
  {
    path: "/parties",
    titleIncludes: "Партии на парламентарните избори",
    h1Includes: "Всички партии",
    minBodyChars: 300,
    expectedCanonical: "/parties",
    hasEnglishMirror: true,
  },
  {
    path: "/regions",
    titleIncludes: "Резултати по области",
    h1Includes: "по области",
    minBodyChars: 250,
    expectedCanonical: "/regions",
    hasEnglishMirror: true,
  },
  {
    path: "/preferences",
    titleIncludes: "Преференциален вот",
    h1Includes: "Преференциален вот",
    minBodyChars: 400,
    expectedCanonical: "/preferences",
  },
  {
    path: "/flash-memory",
    titleIncludes: "Машинно гласуване",
    h1Includes: "Машинно гласуване",
    minBodyChars: 400,
    expectedCanonical: "/flash-memory",
  },
  {
    path: "/recount",
    titleIncludes: "Повторно преброяване",
    h1Includes: "Повторно преброяване",
    minBodyChars: 250,
    expectedCanonical: "/recount",
  },

  // Sofia sub-tabs — reuse the parent body, but each must have its own title.
  {
    path: "/sofia/parties",
    titleIncludes: "София — по партии",
    minBodyChars: 500,
    expectedCanonical: "/sofia/parties",
    hasEnglishMirror: true,
  },
  {
    path: "/sofia/preferences",
    titleIncludes: "София — преференции",
    minBodyChars: 500,
    expectedCanonical: "/sofia/preferences",
    hasEnglishMirror: true,
  },
  {
    path: "/sofia/flash-memory",
    titleIncludes: "София — машинно гласуване",
    minBodyChars: 500,
    expectedCanonical: "/sofia/flash-memory",
    hasEnglishMirror: true,
  },
  {
    path: "/sofia/recount",
    titleIncludes: "София — повторно преброяване",
    minBodyChars: 500,
    expectedCanonical: "/sofia/recount",
    hasEnglishMirror: true,
  },
  // /sofia/timeline is absent for the same reason as /timeline — see above.

  // /reports/{scope}/{report} pages — were 404→home before this commit.
  {
    path: "/reports/section/concentrated",
    titleIncludes: "Концентриран вот по секции",
    h1Includes: "Концентриран вот",
    minBodyChars: 200,
    expectedCanonical: "/reports/section/concentrated",
  },
  {
    path: "/reports/section/turnout",
    titleIncludes: "Избирателна активност по секции",
    h1Includes: "Избирателна активност",
    minBodyChars: 200,
    expectedCanonical: "/reports/section/turnout",
  },
  {
    path: "/reports/section/recount",
    titleIncludes: "Повторно преброяване по секции",
    h1Includes: "Повторно преброяване",
    minBodyChars: 200,
    expectedCanonical: "/reports/section/recount",
  },
  {
    path: "/reports/section/problem_sections",
    titleIncludes: "Проблемни секции",
    h1Includes: "Проблемни секции",
    minBodyChars: 300,
    expectedCanonical: "/reports/section/problem_sections",
  },
  {
    path: "/reports/municipality/turnout",
    titleIncludes: "Избирателна активност по общини",
    h1Includes: "Избирателна активност",
    minBodyChars: 200,
    expectedCanonical: "/reports/municipality/turnout",
  },
  {
    path: "/reports/municipality/concentrated",
    titleIncludes: "Концентриран вот по общини",
    h1Includes: "Концентриран вот",
    minBodyChars: 200,
    expectedCanonical: "/reports/municipality/concentrated",
  },
  {
    path: "/reports/settlement/turnout",
    titleIncludes: "Избирателна активност по населени места",
    h1Includes: "Избирателна активност",
    minBodyChars: 200,
    expectedCanonical: "/reports/settlement/turnout",
  },
  {
    path: "/reports/settlement/flash_memory",
    titleIncludes: "Машинно гласуване по населени места",
    h1Includes: "Машинно гласуване",
    minBodyChars: 200,
    expectedCanonical: "/reports/settlement/flash_memory",
  },

  // Polls
  {
    path: "/polls",
    titleIncludes: "Социологически проучвания",
    h1Includes: "Социологически проучвания",
    minBodyChars: 200,
    expectedCanonical: "/polls",
  },

  // Sample dynamic routes — high-value SEO targets.
  {
    path: `/party/${enc(SAMPLE_PARTY)}`,
    titleIncludes: SAMPLE_PARTY,
    h1Includes: SAMPLE_PARTY,
    minBodyChars: 500,
    expectedCanonical: `/party/${enc(SAMPLE_PARTY)}`,
    hasEnglishMirror: true,
  },
  {
    path: `/party/${enc(SAMPLE_PARTY)}/regions`,
    titleIncludes: SAMPLE_PARTY,
    h1Includes: SAMPLE_PARTY,
    minBodyChars: 500,
    expectedCanonical: `/party/${enc(SAMPLE_PARTY)}/regions`,
    hasEnglishMirror: true,
  },
  {
    path: `/candidate/${enc(SAMPLE_CANDIDATE)}`,
    titleIncludes: SAMPLE_CANDIDATE,
    h1Includes: SAMPLE_CANDIDATE,
    minBodyChars: 100,
    expectedCanonical: `/candidate/${enc(SAMPLE_CANDIDATE)}`,
  },
  // Revenue-agency packs — prerendered from INSTITUTION_PACKS (nap / customs).
  // Their /awarder/:eik routes were previously SPA-only (homepage soft-dup).
  {
    path: "/awarder/131063188",
    titleIncludes: "НАП",
    h1Includes: "Национална агенция за приходите",
    minBodyChars: 200,
    expectedCanonical: "/awarder/131063188",
    hasEnglishMirror: true,
  },
  {
    path: "/awarder/000627597",
    titleIncludes: "Митници",
    h1Includes: "Митници",
    minBodyChars: 200,
    expectedCanonical: "/awarder/000627597",
    hasEnglishMirror: true,
  },
  // Licensed excise-warehouse register — a standalone staticPage (Recipe A).
  {
    path: "/customs/warehouses",
    titleIncludes: "складодържатели",
    h1Includes: "Лицензирани акцизни складодържатели",
    minBodyChars: 200,
    expectedCanonical: "/customs/warehouses",
    hasEnglishMirror: true,
  },

  // Judicial bodies (/court/:bodyCode) — THREE samples, not one, because the
  // family's whole risk is in the DEGRADED page and one sample would never see
  // it. `court_load` covers 180 of 284 bodies, so:
  //   * SAMPLE_COURT      — a court WITH a workload series (the happy path);
  //   * SAMPLE_PROSECUTION — kind='prosecution', no court_load row at all;
  //   * SAMPLE_LOADLESS_COURT — a COURT with no court_load row, which is the
  //     case that shipped a self-contradicting sentence ("the statistics cover
  //     the courts") onto both Supreme Courts.
  {
    path: `/court/${SAMPLE_COURT}`,
    titleIncludes: "Софийски градски съд — натовареност",
    h1Includes: "Софийски градски съд — натовареност",
    minBodyChars: 800,
    expectedCanonical: `/court/${SAMPLE_COURT}`,
    hasEnglishMirror: true,
    requiresCourts: true,
  },
  {
    path: `/court/${SAMPLE_PROSECUTION}`,
    titleIncludes: "Апелативна прокуратура — Бургас",
    h1Includes: "Апелативна прокуратура — Бургас",
    minBodyChars: 800,
    expectedCanonical: `/court/${SAMPLE_PROSECUTION}`,
    hasEnglishMirror: true,
    requiresCourts: true,
  },
  {
    path: `/court/${SAMPLE_LOADLESS_COURT}`,
    titleIncludes: "Върховен касационен съд",
    h1Includes: "Върховен касационен съд",
    minBodyChars: 800,
    expectedCanonical: `/court/${SAMPLE_LOADLESS_COURT}`,
    hasEnglishMirror: true,
    requiresCourts: true,
  },

  // Private pension funds (/pension-fund/:slug) — file-backed off the committed
  // КФН archive rather than Postgres, so this is the one of the two new
  // families a database-less checkout still builds.
  {
    path: `/pension-fund/${SAMPLE_FUND}`,
    titleIncludes: "УПФ „Доверие“ — нетни активи",
    h1Includes: "УПФ „Доверие“ — нетни активи",
    minBodyChars: 800,
    expectedCanonical: `/pension-fund/${SAMPLE_FUND}`,
    hasEnglishMirror: true,
  },
];

// English mirrors that must serve the EN prerender (not the EN home fallback).
const EN_ROUTES: RouteCheck[] = [
  {
    path: "/en",
    titleIncludes: HOME_TITLE_EN_PREFIX,
    minBodyChars: 500,
    expectedCanonical: "/en",
  },
  {
    path: "/en/about",
    titleIncludes: "About",
    h1Includes: "About electionsbg.com",
    minBodyChars: 500,
    expectedCanonical: "/en/about",
  },
  {
    path: "/en/sofia",
    titleIncludes: "Sofia",
    h1Includes: "Sofia",
    minBodyChars: 500,
    expectedCanonical: "/en/sofia",
  },
  {
    path: "/en/sofia/parties",
    titleIncludes: "Sofia — by party",
    minBodyChars: 500,
    expectedCanonical: "/en/sofia/parties",
  },
  {
    path: "/en/parties",
    titleIncludes: "Parties — Bulgarian Parliamentary Election",
    h1Includes: "All parties",
    minBodyChars: 200,
    expectedCanonical: "/en/parties",
  },
  {
    path: "/en/regions",
    titleIncludes: "Results by Region",
    h1Includes: "Results by region",
    minBodyChars: 200,
    expectedCanonical: "/en/regions",
  },
  {
    path: `/en/party/${enc(SAMPLE_PARTY)}`,
    titleIncludes: SAMPLE_PARTY,
    h1Includes: SAMPLE_PARTY,
    minBodyChars: 500,
    expectedCanonical: `/en/party/${enc(SAMPLE_PARTY)}`,
  },
  {
    path: `/en/party/${enc(SAMPLE_PARTY)}/regions`,
    titleIncludes: SAMPLE_PARTY,
    h1Includes: SAMPLE_PARTY,
    minBodyChars: 500,
    expectedCanonical: `/en/party/${enc(SAMPLE_PARTY)}/regions`,
  },
  // The EN mirrors of the two new families. Body and court names stay Cyrillic
  // — there is no official English register for either — so the title assertion
  // is on the proper noun and the ENGLISH furniture around it is what proves
  // this is not the EN homepage fallback.
  {
    path: `/en/court/${SAMPLE_PROSECUTION}`,
    titleIncludes: "Апелативна прокуратура — Бургас — caseload",
    h1Includes: "Апелативна прокуратура — Бургас — caseload",
    minBodyChars: 800,
    expectedCanonical: `/en/court/${SAMPLE_PROSECUTION}`,
    requiresCourts: true,
  },
  {
    path: `/en/pension-fund/${SAMPLE_FUND}`,
    titleIncludes: 'UPF "Doverie" — net assets',
    h1Includes: 'UPF "Doverie" — net assets',
    minBodyChars: 800,
    expectedCanonical: `/en/pension-fund/${SAMPLE_FUND}`,
  },
];

// Match the canonical the prerender step writes — origin + percent-encoded path.
const ORIGIN = "https://electionsbg.com";

const fetchOk = async (
  request: { get(url: string): Promise<APIResponse> },
  path: string,
): Promise<{ status: number; body: string }> => {
  const res = await request.get(path);
  // With `trailingSlash: false` Firebase serves dist/foo/index.html at /foo
  // directly and 301s /foo/ back to it. The request fixture follows redirects
  // by default; we just need the final body.
  return { status: res.status(), body: await res.text() };
};

// Pull a single attribute from a tag. The back-reference \1 captures the
// opening quote so apostrophes embedded in double-quoted values (e.g.
// "Sofia's three districts") survive the match instead of truncating it.
const readAttr = (tagSource: string, attr: string): string => {
  const re = new RegExp(`${attr}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i");
  return re.exec(tagSource)?.[2] ?? "";
};

// Find a tag (including its attributes) where one attribute equals a target
// value — used to disambiguate among meta/link tags by their `name`/
// `property`/`rel` discriminator.
const findTag = (
  html: string,
  tagName: string,
  selectorAttr: string,
  selectorValue: string,
): string => {
  const re = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  for (const match of html.matchAll(re)) {
    if (readAttr(match[0], selectorAttr) === selectorValue) return match[0];
  }
  return "";
};

// The emitter HTML-escapes <title> and every meta content, so the raw source
// carries `&quot;` where the reader sees `"`. Decode the handful of entities it
// can produce, so an expectation is written the way the page reads rather than
// the way it is serialised. (`UPF "Doverie"` is the case that forced this — a
// straight-quoted proper noun in a title.)
const decodeEntities = (v: string): string =>
  v
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

const extract = (html: string) => {
  const title = decodeEntities(
    /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "",
  );
  const h1Match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const h1 = h1Match ? h1Match[1].replace(/<[^>]+>/g, "").trim() : "";
  const ssg =
    /<div[^>]+id=["']ssg-content["'][^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1] ??
    "";
  const ssgText = ssg
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const canonical = readAttr(findTag(html, "link", "rel", "canonical"), "href");
  const ogTitle = readAttr(
    findTag(html, "meta", "property", "og:title"),
    "content",
  );
  const ogImage = readAttr(
    findTag(html, "meta", "property", "og:image"),
    "content",
  );
  const ogUrl = readAttr(
    findTag(html, "meta", "property", "og:url"),
    "content",
  );
  const description = decodeEntities(
    readAttr(findTag(html, "meta", "name", "description"), "content"),
  );
  const hreflangs: string[] = [];
  const hreflangHrefs: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = readAttr(m[0], "rel");
    if (rel !== "alternate") continue;
    const lang = readAttr(m[0], "hreflang");
    if (lang) hreflangs.push(lang);
    const href = readAttr(m[0], "href");
    if (href) hreflangHrefs.push(href);
  }
  const jsonLdBlocks = Array.from(
    html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ).map((m) => m[1].trim());
  return {
    title,
    canonical,
    h1,
    ssgText,
    ogTitle,
    ogImage,
    ogUrl,
    description,
    hreflangs,
    hreflangHrefs,
    jsonLdBlocks,
  };
};

/** The `@type` of every JSON-LD block on a page. */
const jsonLdTypes = (body: string): unknown[] =>
  extract(body).jsonLdBlocks.map(
    (b) => (JSON.parse(b) as Record<string, unknown>)["@type"],
  );

const runRouteCheck = (route: RouteCheck) => {
  test(`prerender: ${route.path}`, async ({ request }) => {
    test.skip(
      route.requiresCourts === true && !PREREQ_COURTS_PRESENT,
      SKIP_COURTS,
    );
    const { status, body } = await fetchOk(request, route.path);
    expect(status, `non-200 status from ${route.path}`).toBe(200);

    const meta = extract(body);

    // Title: present, includes the route-specific phrase, ends with site
    // suffix. Catches routes that fall back to the home title.
    expect(meta.title, `<title> on ${route.path}`).toContain(
      route.titleIncludes,
    );
    expect(
      meta.title,
      `<title> missing site suffix on ${route.path}`,
    ).toContain("electionsbg.com");

    // Canonical is the most reliable signal that the prerender file (not the
    // SPA fallback) was served.
    if (route.expectedCanonical) {
      expect(meta.canonical, `canonical on ${route.path}`).toBe(
        ORIGIN + route.expectedCanonical,
      );
    }

    // OG tags must match the title and be present at all.
    expect(meta.ogTitle, `og:title on ${route.path}`).toBeTruthy();
    expect(meta.ogImage, `og:image on ${route.path}`).toMatch(/^https?:\/\//);
    expect(meta.ogUrl, `og:url on ${route.path}`).toBeTruthy();
    expect(
      meta.description.length,
      `description on ${route.path}`,
    ).toBeGreaterThan(30);

    // hreflang block is always emitted — at minimum bg + x-default.
    expect(meta.hreflangs, `hreflang on ${route.path}`).toContain("bg");
    expect(meta.hreflangs, `hreflang on ${route.path}`).toContain("x-default");
    if (route.hasEnglishMirror) {
      expect(meta.hreflangs, `hreflang en on ${route.path}`).toContain("en");
    }

    // JSON-LD should parse — bad escaping breaks rich-result eligibility.
    expect(
      meta.jsonLdBlocks.length,
      `JSON-LD count on ${route.path}`,
    ).toBeGreaterThanOrEqual(1);
    for (const block of meta.jsonLdBlocks) {
      expect(
        () => JSON.parse(block),
        `JSON-LD parse on ${route.path}`,
      ).not.toThrow();
    }

    // H1 — when set, must be present in the prerendered body. (Some sub-tab
    // routes intentionally inherit the parent body's H1, so the assertion
    // is on substring rather than exact match.)
    if (route.h1Includes) {
      expect(meta.h1, `<h1> on ${route.path}`).toContain(route.h1Includes);
    }

    // Visible body content — verifies the ssg-content div is non-empty.
    if (route.minBodyChars) {
      expect(
        meta.ssgText.length,
        `ssg-content body length on ${route.path}`,
      ).toBeGreaterThanOrEqual(route.minBodyChars);
    }
  });
};

test.describe("prerender: Bulgarian routes", () => {
  test.skip(!PREREQ_DATA_PRESENT, SKIP_REASON);
  for (const r of ROUTES) runRouteCheck(r);
});

test.describe("prerender: English mirrors", () => {
  test.skip(!PREREQ_DATA_PRESENT, SKIP_REASON);
  for (const r of EN_ROUTES) runRouteCheck(r);
});

// Cross-cutting checks that don't fit the per-route table.
test.describe("prerender: cross-cutting", () => {
  test.skip(!PREREQ_DATA_PRESENT, SKIP_REASON);
  test("home page declares 3 JSON-LD blocks (WebSite + Organization + Dataset)", async ({
    request,
  }) => {
    const { body } = await fetchOk(request, "/");
    const { jsonLdBlocks } = extract(body);
    expect(jsonLdBlocks.length).toBe(3);
    const types = jsonLdBlocks
      .map((b) => JSON.parse(b))
      .map((j: { "@type": string }) => j["@type"]);
    expect(types).toEqual(
      expect.arrayContaining(["WebSite", "Organization", "Dataset"]),
    );
  });

  // The home modulepreload guard used to be duplicated here. Bundle shape is
  // not an SEO invariant, and the copy drifted — it never gained vendor-flow
  // or vendor-editor while the perf suite's list was ratcheted twice, so it
  // read as coverage while asserting a strict subset. tests/perf.spec.ts owns
  // it now, alongside the entry-static-import and chunk-cycle gates that
  // explain why the preload list alone is not sufficient.

  test("trailing-slash redirect: /about/ → /about", async ({ request }) => {
    // Hosting runs `trailingSlash: false`, so the SLASH form is the redirect
    // and the bare form serves the prerender. This used to assert the opposite
    // direction, which is what let every canonical point at a 301 for so long.
    // maxRedirects: 0 disables follow so we can see the 301 directly.
    const res = await request.get("/about/", { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(res.headers()["location"]).toMatch(/\/about$/);
  });

  // The defect this suite missed for the whole life of the prerender step: a
  // canonical (and og:url, and every hreflang) that is itself a 301. Asserting
  // the STRING is right is not enough — the URL has to serve 200 on its own.
  // Covers a static hub, a nested sub-tab, the BG root and the EN root, since
  // the roots are the two cases the slash rule treats specially.
  // `routePath`, not `path` — the node path module is imported at the top of
  // this file and a loop variable named `path` shadows it.
  // Two hubs, the BG and EN roots (the slash rule's two special cases), and one
  // member of each family §11 added — the two newest URL builders in the repo,
  // and the ones with no other no-slash gate.
  for (const routePath of [
    "/governance",
    "/parliament/cohesion",
    "/",
    "/en",
    `/court/${SAMPLE_COURT}`,
    `/pension-fund/${SAMPLE_FUND}`,
  ]) {
    test(`canonical/og:url/hreflang do not redirect: ${routePath}`, async ({
      request,
    }) => {
      const { body } = await fetchOk(request, routePath);
      const meta = extract(body);
      const urls = new Set(
        [meta.canonical, meta.ogUrl, ...meta.hreflangHrefs].filter(
          (u): u is string => Boolean(u),
        ),
      );
      expect(
        urls.size,
        `no self-referential URLs on ${routePath}`,
      ).toBeGreaterThan(0);
      for (const url of urls) {
        const res = await request.get(url.replace(ORIGIN, ""), {
          maxRedirects: 0,
        });
        expect(
          res.status(),
          `${url} (declared on ${routePath}) must not redirect`,
        ).toBe(200);
      }
    });
  }

  test("party page emits Dataset JSON-LD with declared distribution links", async ({
    request,
  }) => {
    const { body } = await fetchOk(request, `/party/${enc(SAMPLE_PARTY)}`);
    const { jsonLdBlocks } = extract(body);
    const datasetBlock = jsonLdBlocks
      .map((b) => JSON.parse(b) as Record<string, unknown>)
      .find((j) => j["@type"] === "Dataset");
    expect(datasetBlock, "no Dataset JSON-LD on party page").toBeTruthy();
    expect(
      (datasetBlock!.distribution as Array<unknown> | undefined)?.length,
      "Dataset.distribution missing",
    ).toBeGreaterThanOrEqual(1);
  });

  test("English mirror declares both bg and en hreflang alternates", async ({
    request,
  }) => {
    const { body } = await fetchOk(request, `/en/party/${enc(SAMPLE_PARTY)}`);
    const { hreflangs } = extract(body);
    expect(new Set(hreflangs)).toEqual(new Set(["bg", "en", "x-default"]));
  });

  test("sitemap_index.xml lists shard files", async ({ request }) => {
    const res = await request.get("/sitemap_index.xml");
    expect(res.status()).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("<sitemapindex");
    expect(xml).toMatch(/sitemap_static\.xml/);
    expect(xml).toMatch(/sitemap_parties\.xml/);
    // The two families §11 added get their own shards rather than the `static`
    // catch-all, so an absent shard here is the whole family missing.
    expect(xml).toMatch(/sitemap_judiciary\.xml/);
    expect(xml).toMatch(/sitemap_pensions\.xml/);
  });

  // The degraded /court body is the reason three courts are sampled above
  // rather than one. The two absences below are shape-identical in the payload
  // and must NOT share copy: one is a fact about the ВСС's statistic, the other
  // would be a false claim about a court that has a workload series.
  test("a prosecution office names the exclusion; a load-less COURT does not", async ({
    request,
  }) => {
    const prosecution = await fetchOk(request, `/court/${SAMPLE_PROSECUTION}`);
    expect(extract(prosecution.body).ssgText).toContain(
      "статистиката обхваща съдилищата",
    );

    // ВКС is a court with no court_load row. Telling it the statistic covers
    // the courts is self-contradicting — and it shipped that way once.
    const court = await fetchOk(request, `/court/${SAMPLE_LOADLESS_COURT}`);
    const text = extract(court.body).ssgText;
    expect(text).not.toContain("статистиката обхваща съдилищата");
    expect(text).toContain("ВСС не публикува натовареност за този съд");
  });

  test("a court WITH a workload series states its figures, not an absence", async ({
    request,
  }) => {
    const { body } = await fetchOk(request, `/court/${SAMPLE_COURT}`);
    const text = extract(body).ssgText;
    expect(text).not.toContain("не публикува натовареност");
    // The prose is the AIO surface, so it has to carry the NUMBERS rather than
    // be a nav stub — a rate per judge per month and the year it is from.
    expect(text).toMatch(/дела на месец/);
    expect(text).toMatch(/\d{4} г\./);
  });

  test("the new families emit GovernmentOrganization / Organization JSON-LD", async ({
    request,
  }) => {
    const court = await fetchOk(request, `/court/${SAMPLE_COURT}`);
    // GovernmentOrganization, not plain Organization: it is what lets an answer
    // engine tell a court from a company of the same name.
    expect(jsonLdTypes(court.body)).toContain("GovernmentOrganization");
    expect(jsonLdTypes(court.body)).toContain("FAQPage");

    const fund = await fetchOk(request, `/pension-fund/${SAMPLE_FUND}`);
    expect(jsonLdTypes(fund.body)).toContain("Organization");
    expect(jsonLdTypes(fund.body)).toContain("FAQPage");
  });

  test("an unknown body or fund mints no page and falls through to the shell", async ({
    request,
  }) => {
    for (const p of ["/court/not-a-real-body", "/pension-fund/upf-nonesuch"]) {
      // The real invariant: both builders map over their source, so no dist
      // file may exist for a slug the source does not contain. Asserting on the
      // served TITLE instead would be unfalsifiable — hosting's `**` rewrite
      // serves the SPA shell, whose title is baked in and cannot echo a path.
      expect(
        fs.existsSync(
          path.resolve(process.cwd(), "dist", p.slice(1), "index.html"),
        ),
        `a page was prerendered for the unknown slug ${p}`,
      ).toBe(false);

      // And what hosting serves is that shell, proved by its own canonical —
      // so a future rewrite that synthesised a per-path page would fail here.
      const { status, body } = await fetchOk(request, p);
      expect(status, `unknown path ${p}`).toBe(200);
      expect(
        extract(body).canonical,
        `${p} must fall through to the shell`,
      ).toBe(`${ORIGIN}/`);
    }
  });

  // TEST-002: the fund family's own degraded/edge sentence. The share is
  // computed within the fund TYPE (УПФ/ППФ/ДПФ/ДПФПС), and pillar 2 is
  // УПФ + ППФ together — wording it as a pillar share put the sole ДПФПС at
  // 100% of a pillar it holds 1.2% of.
  test("a fund's share sentence is scoped to its TYPE, not its pillar", async ({
    request,
  }) => {
    const { body } = await fetchOk(request, `/pension-fund/${SAMPLE_FUND}`);
    const text = extract(body).ssgText;
    expect(text).toMatch(/от активите на фондовете от вид/);
    expect(text).not.toContain("от активите на стълба");
    // The largest УПФ is nowhere near its whole type, let alone its pillar.
    expect(text).not.toMatch(/Това е 100[.,]0%/);
  });

  test("robots.txt references the sitemap", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    const txt = await res.text();
    expect(txt.toLowerCase()).toMatch(/sitemap:/);
  });
});
