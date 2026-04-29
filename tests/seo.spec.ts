import { test, expect, type APIResponse } from "@playwright/test";

// Per-segment percent-encode (matches scripts/prerender/index.ts:encodeUrlPath).
const enc = (p: string): string =>
  p
    .split("/")
    .map((seg) => (seg ? encodeURIComponent(seg) : seg))
    .join("/");

// Sample dynamic identifiers that exist in every recent election dataset.
// If these change, update here — the failure message will point to this file.
const SAMPLE_PARTY = "ГЕРБ-СДС";
const SAMPLE_CANDIDATE = "Бойко Методиев Борисов";

const HOME_TITLE_BG_PREFIX = "Парламентарни избори в България";
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
  minBodyChars?: number;
  // Expected canonical path (after stripping the origin).
  expectedCanonical?: string;
  // Set when this route has a prerendered EN mirror.
  hasEnglishMirror?: boolean;
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
    titleIncludes: "Резултати в София",
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
  {
    path: "/timeline",
    titleIncludes: "Възход и падение",
    h1Includes: "Възход и падение",
    minBodyChars: 500,
    expectedCanonical: "/timeline",
    hasEnglishMirror: true,
  },

  // Top-level list pages — previously fell through to home.
  {
    path: "/parties",
    titleIncludes: "Всички партии",
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
  {
    path: "/sofia/timeline",
    titleIncludes: "София — времева линия",
    minBodyChars: 500,
    expectedCanonical: "/sofia/timeline",
    hasEnglishMirror: true,
  },

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
];

// English mirrors that must serve the EN prerender (not the EN home fallback).
const EN_ROUTES: RouteCheck[] = [
  {
    path: "/en/",
    titleIncludes: HOME_TITLE_EN_PREFIX,
    minBodyChars: 500,
    expectedCanonical: "/en/",
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
    titleIncludes: "All Parties",
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
];

// Match the canonical the prerender step writes — origin + percent-encoded path.
const ORIGIN = "https://electionsbg.com";

const fetchOk = async (
  request: { get(url: string): Promise<APIResponse> },
  path: string,
): Promise<{ status: number; body: string }> => {
  const res = await request.get(path);
  // Firebase 301-redirects /foo to /foo/ to serve dist/foo/index.html. The
  // request fixture follows redirects by default; we just need the final body.
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

const extract = (html: string) => {
  const title = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
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
  const description = readAttr(
    findTag(html, "meta", "name", "description"),
    "content",
  );
  const hreflangs: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = readAttr(m[0], "rel");
    if (rel !== "alternate") continue;
    const lang = readAttr(m[0], "hreflang");
    if (lang) hreflangs.push(lang);
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
    jsonLdBlocks,
  };
};

const runRouteCheck = (route: RouteCheck) => {
  test(`prerender: ${route.path}`, async ({ request }) => {
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
  for (const r of ROUTES) runRouteCheck(r);
});

test.describe("prerender: English mirrors", () => {
  for (const r of EN_ROUTES) runRouteCheck(r);
});

// Cross-cutting checks that don't fit the per-route table.
test.describe("prerender: cross-cutting", () => {
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

  test("home page does NOT eagerly preload pdf/charts/leaflet/markdown vendors", async ({
    request,
  }) => {
    const { body } = await fetchOk(request, "/");
    const preloads = Array.from(
      body.matchAll(
        /<link[^>]+rel=["']modulepreload["'][^>]+href=["']([^"']+)["']/gi,
      ),
    ).map((m) => m[1]);
    for (const banned of [
      "vendor-pdf",
      "vendor-charts",
      "vendor-leaflet",
      "vendor-markdown",
      "exportToPDF-",
    ]) {
      expect(
        preloads.some((p) => p.includes(banned)),
        `${banned} should not be modulepreloaded — wastes ~1MB of JS on landing`,
      ).toBe(false);
    }
  });

  test("trailing-slash redirect: /about → /about/", async ({ request }) => {
    // maxRedirects: 0 disables follow so we can see the 301 directly.
    const res = await request.get("/about", { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(res.headers()["location"]).toMatch(/\/about\/?$/);
  });

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
  });

  test("robots.txt references the sitemap", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    const txt = await res.text();
    expect(txt.toLowerCase()).toMatch(/sitemap:/);
  });
});
