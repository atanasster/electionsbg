import fs from "fs";
import path from "path";
import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";
import { TICK_MAX_CHARS } from "../src/screens/budget/budgetFunctionalBars";

// Same routes as seo.spec, but here we boot the SPA and verify it actually
// renders without runtime errors at desktop and mobile viewports. The same
// spec runs under two projects (Desktop Chrome + Pixel 7) — see
// playwright.config.ts.

const SAMPLE_PARTY = "ГЕРБ-СДС";
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

// True iff the data pipeline has been run (public/<date>/national_summary.json
// exists). Tests that assert on per-party / per-candidate content depend on
// that data being present, so they're gated on this. Smoke tests that only
// require the SPA to mount don't need the gate. See seo.spec.ts for the same
// pattern with more detail.
const PARTY_DATA_PRESENT = (() => {
  const publicDir = path.resolve(process.cwd(), "public");
  if (!fs.existsSync(publicDir)) return false;
  return fs
    .readdirSync(publicDir)
    .filter((d) => /^\d{4}_\d{2}_\d{2}$/.test(d))
    .some((d) =>
      fs.existsSync(path.join(publicDir, d, "national_summary.json")),
    );
})();

// Routes hit by the navigation smoke tests. These are the screens users
// actually click into from the menu, plus a couple of the deep prerendered
// targets we recently added.
const NAV_ROUTES = [
  { path: "/", name: "Home" },
  { path: "/sofia", name: "Sofia" },
  { path: "/parties", name: "All parties" },
  { path: "/regions", name: "All regions" },
  { path: "/timeline", name: "Timeline" },
  { path: "/simulator", name: "Simulator" },
  { path: "/compare", name: "Compare" },
  { path: "/polls", name: "Polls" },
  { path: "/about", name: "About" },
  { path: `/party/${enc(SAMPLE_PARTY)}`, name: "Party detail" },
  { path: "/reports/section/concentrated", name: "Section concentrated" },
];

// Helper: collect console errors and failed responses across a navigation.
type NavCollector = {
  errors: string[];
  failedRequests: string[];
};

const startCollecting = (page: Page): NavCollector => {
  const c: NavCollector = { errors: [], failedRequests: [] };
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") c.errors.push(msg.text());
  });
  page.on("pageerror", (err) => c.errors.push(err.message));
  page.on("response", (res) => {
    // Localhost-only — ignore failures on third-party CDNs (fonts, GA) since
    // they may be blocked in CI.
    const url = res.url();
    if (!url.startsWith("http://127.0.0.1")) return;
    if (res.status() >= 400) {
      c.failedRequests.push(`${res.status()} ${url}`);
    }
  });
  return c;
};

// Skip noise we know about and don't want to gate CI on. Add specific patterns
// here rather than swallowing all errors.
const IGNORED_ERROR_PATTERNS: RegExp[] = [
  // Google Analytics is blocked on localhost / in CI runs.
  /google-analytics\.com/,
  /googletagmanager\.com/,
  // OSM tile fetches are best-effort.
  /tile\.openstreetmap\.org/,
];

const filterErrors = (errs: string[]) =>
  errs.filter((e) => !IGNORED_ERROR_PATTERNS.some((re) => re.test(e)));

// The prerendered HTML ships a hidden <div id="ssg-content"> with an <h1>
// inside for crawlers. We scope all "is the live UI rendered" assertions to
// #root so we don't accidentally match the hidden prerender shell.
//
// We also filter to *visible* headings: some chrome that renders before the
// page content carries its own heading but is hidden at small viewports — e.g.
// the desktop-only CommunityCtaStrip (`hidden lg:flex`, with an <h2>). Under
// the mobile project that <h2> is the first `#root :is(h1, h2)` in the DOM but
// is display:none, so a plain `.first()` resolves to a hidden element and
// toBeVisible() times out. Filtering to visible picks the first heading that's
// actually on screen, which is what "the live UI rendered" really means.
const liveHeading = (page: Page) =>
  page.locator("#root :is(h1, h2)").filter({ visible: true }).first();

test.describe("UI rendering", () => {
  test("home page boots and shows the dashboard heading", async ({ page }) => {
    const c = startCollecting(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // The runtime SPA replaces the hidden #ssg-content with the live root.
    // We assert on the live heading inside #root.
    await expect(liveHeading(page)).toBeVisible({ timeout: 10_000 });
    // Title settles after i18n loads — give it a moment to update from the
    // prerendered title to the runtime BG/EN title.
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveTitle(/electionsbg|Избори/i);

    expect(filterErrors(c.errors), "console errors during home load").toEqual(
      [],
    );
  });

  test("no horizontal overflow at viewport width", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const overflow = await page.evaluate(() => {
      const docW = document.documentElement.scrollWidth;
      const viewW = document.documentElement.clientWidth;
      return { docW, viewW, hasOverflow: docW > viewW + 1 };
    });
    expect(
      overflow.hasOverflow,
      `horizontal overflow: doc=${overflow.docW} viewport=${overflow.viewW}`,
    ).toBe(false);
  });

  test("viewport meta has width=device-width, initial-scale=1", async ({
    page,
  }) => {
    await page.goto("/");
    const content = await page
      .locator('meta[name="viewport"]')
      .getAttribute("content");
    expect(content).toContain("width=device-width");
    expect(content).toContain("initial-scale=1");
  });

  test("current election date is rendered somewhere on the home page", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    // The date appears in multiple places (header switcher, dashboard
    // heading). We don't care which element — only that the SPA mounted with
    // a real election context. The shape "DD/MM/YYYY" is locale-stable.
    const datePresent = await page.evaluate(() =>
      /\d{2}\/\d{2}\/\d{4}/.test(document.body.innerText),
    );
    expect(datePresent).toBe(true);
  });

  test("client-side routing: home → /parties → /timeline updates the URL", async ({
    page,
  }) => {
    const c = startCollecting(page);
    await page.goto("/", { waitUntil: "networkidle" });

    await page.goto("/parties", { waitUntil: "domcontentloaded" });
    // Firebase 301-redirects /parties → /parties/ to serve the prerendered
    // file; allow either form.
    await expect(page).toHaveURL(/\/parties\/?$/);
    await expect(liveHeading(page)).toBeVisible();

    await page.goto("/timeline", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/timeline\/?$/);

    expect(filterErrors(c.errors), "console errors during navigation").toEqual(
      [],
    );
  });

  test("404-style URL falls back to the SPA without throwing", async ({
    page,
  }) => {
    const c = startCollecting(page);
    await page.goto("/this-route-does-not-exist", {
      waitUntil: "domcontentloaded",
    });
    // Either the SPA's NotFound screen or the home content is acceptable —
    // the requirement is just "no runtime crash".
    await expect(page.locator("body")).toBeVisible();
    expect(filterErrors(c.errors)).toEqual([]);
  });

  // Boot every major route and assert: no console errors, no 4xx/5xx on
  // localhost, and at least one heading is rendered. This is the "all routes
  // smoke test" — the equivalent of the previous manual sweep.
  for (const route of NAV_ROUTES) {
    test(`route boots cleanly: ${route.path}`, async ({ page }) => {
      const c = startCollecting(page);
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      // Wait for at least one live heading to mount — proves React hydrated.
      await expect(liveHeading(page)).toBeVisible({ timeout: 10_000 });
      // Allow async data fetches to settle.
      await page.waitForLoadState("networkidle");

      const errs = filterErrors(c.errors);
      expect(
        errs,
        `console errors at ${route.path}: ${errs.join("\n")}`,
      ).toEqual([]);
      expect(
        c.failedRequests,
        `failed local requests at ${route.path}: ${c.failedRequests.join("\n")}`,
      ).toEqual([]);
    });
  }

  test("party detail page renders the party label as a heading", async ({
    page,
  }) => {
    test.skip(
      !PARTY_DATA_PRESENT,
      "party data not generated — run `npm run data` first",
    );
    await page.goto(`/party/${enc(SAMPLE_PARTY)}`, {
      waitUntil: "networkidle",
    });
    // The runtime page should display the party name somewhere as a heading.
    const h1Text = await page
      .locator("#root :is(h1, h2, h3)")
      .first()
      .innerText({ timeout: 10_000 });
    expect(h1Text).toContain(SAMPLE_PARTY.split("-")[0]); // "ГЕРБ"
  });

  // src/App.tsx skips Google Analytics when navigator.webdriver is true so
  // CI runs don't pollute the GA realtime dashboard. If that guard ever
  // regresses (or Playwright stops reporting webdriver), this test will
  // catch it before the dashboard does.
  test("Google Analytics is not contacted from automation", async ({
    page,
  }) => {
    const gaHits: string[] = [];
    page.on("request", (req) => {
      const u = req.url();
      if (
        u.includes("google-analytics.com") ||
        u.includes("googletagmanager.com")
      )
        gaHits.push(u);
    });
    await page.goto("/", { waitUntil: "networkidle" });
    // App.tsx defers init via requestIdleCallback / 2s setTimeout fallback —
    // wait past that window so a regression actually has a chance to fire.
    await page.waitForTimeout(2500);
    expect(
      await page.evaluate(() => navigator.webdriver),
      "Playwright should report navigator.webdriver=true — guard depends on it",
    ).toBe(true);
    expect(
      gaHits,
      `GA was contacted from a webdriver-controlled browser:\n${gaHits.join("\n")}`,
    ).toEqual([]);
  });
});

test.describe("UI: theme and layout", () => {
  test("dark/light: prefers-color-scheme=dark renders without errors", async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();
    const c = startCollecting(page);
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(liveHeading(page)).toBeVisible();
    expect(filterErrors(c.errors)).toEqual([]);
    await context.close();
  });
});

// ── Charts, at a REAL viewport ───────────────────────────────────────────────
//
// ⚠️ THE ONLY PLACE THESE ARE CHECKED AT ALL. `ResponsiveContainer` renders
// NOTHING at width 0, and a headless DOM reports exactly that, so a Vitest
// component test cannot see a chart — every budget chart is unit-tested at its
// DATA layer for that reason (budget-hub-v1 T9.1 says so explicitly). Which
// means "does it paint, with the right marks, without clipping its labels or
// dragging the page sideways" had no gate anywhere, on four live pages.
//
// Playwright has a real viewport, and this spec already runs under two projects
// (Desktop Chrome 1280 + Pixel 7 412), so one file buys both.
//
// Found by writing it: /budget/personnel dragged the page 139px sideways from an
// sr-only <table> (CSS width on a table is a minimum, so it laid out at 490px) —
// invisible to every data-layer test.
//
// ⚠️ STUBBED, and that is what makes this a RENDER gate rather than a
// production-uptime gate. firebase.json rewrites /api/db/** to the deployed
// function and the emulator FORWARDS it, so unstubbed these four pages test
// whether Cloud SQL is up — /budget/functional needs two chained prod
// round-trips and dies if either blinks. The fixture is a real capture of all
// six endpoints, so the shapes are the app's own; refresh it by re-recording
// against a dev server if a payload changes.
const BUDGET_CHART_FIXTURE = JSON.parse(
  fs.readFileSync(
    path.resolve(process.cwd(), "tests/fixtures/budget-charts.json"),
    "utf8",
  ),
) as Record<string, unknown>;

/** Serve every /api/db/** call from the capture, keyed path-first then
 *  path+query, so a route that changes its params still resolves. A miss is an
 *  explicit 404 rather than `[]`: an empty body renders an empty chart, which is
 *  exactly the state these tests exist to distinguish from a broken one. */
const usedFixtureKeys = new Set<string>();

const stubBudgetApi = async (page: Page) => {
  await page.route("**/api/db/**", async (route) => {
    const u = new URL(route.request().url());
    const withQuery = u.pathname.replace("/api/db/", "") + u.search;
    const bare = u.pathname.replace("/api/db/", "");
    // ⚠️ EXACT MATCH FIRST, and the ordering is a bug fix rather than tidiness.
    // With the three conditions OR'd into one `find`, specificity was decided by
    // JSON key order: the bare `budget-series` matched a request for
    // `budget-series?series=revenue`, so /budget/revenue was served the
    // 300-point ALL-series payload and rendered the `balance` series
    // (−€2.24bn…) where revenue (+€15.8bn…) belongs — an overflow assertion
    // measuring a layout production cannot produce, with the revenue key left
    // unreachable behind it.
    const key =
      withQuery in BUDGET_CHART_FIXTURE
        ? withQuery
        : bare in BUDGET_CHART_FIXTURE
          ? bare
          : Object.keys(BUDGET_CHART_FIXTURE).find(
              (k) => k.split("?")[0] === bare,
            );
    if (!key) {
      await route.fulfill({ status: 404, body: "no fixture for " + withQuery });
      return;
    }
    usedFixtureKeys.add(key);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(BUDGET_CHART_FIXTURE[key]),
    });
  });
};

const CHART_PAGES: { path: string; name: string; bars?: number }[] = [
  // Ten COFOG functions, one bar each — the T9.1 clause. The count is the
  // assertion: the defect that step fixed was bars scaled to the LARGEST share
  // rather than the whole, and a chart that silently drops its tail reads as a
  // shorter list, not as a broken one. Stable against the fixture; against live
  // data it would move with the default fiscal year.
  { path: "/budget/functional", name: "COFOG functions", bars: 10 },
  { path: "/budget/execution", name: "Execution" },
  { path: "/budget/personnel", name: "Personnel" },
  // A donut: no axis, no bars. Surface only.
  { path: "/budget/revenue", name: "Revenue composition" },
];

test.describe("Charts render at a real viewport", () => {
  test.beforeEach(async ({ page }) => {
    await stubBudgetApi(page);
  });

  test("the chart selectors are not vacuous", async ({ page }) => {
    // ⚠️ GUARDS THE FAILURE MODE THIS WHOLE DESCRIBE IS EXPOSED TO: at width 0
    // every assertion below passes trivially, because "no surface" and "no
    // marks" are indistinguishable from "not measured". If a config change ever
    // gives this project a zero-width viewport, this fails first and loudly
    // rather than the suite going green while checking nothing.
    const size = page.viewportSize();
    expect(
      size,
      "no viewport — every chart assertion is vacuous",
    ).not.toBeNull();
    expect(size!.width).toBeGreaterThan(300);
    await page.goto("/budget/functional", { waitUntil: "domcontentloaded" });
    const surface = page.locator(".recharts-surface").first();
    await expect(surface).toBeVisible({ timeout: 20_000 });
    const box = await surface.boundingBox();
    expect(
      box,
      "the surface has no box — ResponsiveContainer measured 0",
    ).not.toBeNull();
    expect(
      box!.width,
      "a zero-width surface means nothing below is real",
    ).toBeGreaterThan(100);
    // …and the y-axis ticks this file asserts about actually exist, so the
    // clipping clause below cannot pass on an empty NodeList.
    await expect(page.locator(".recharts-yAxis text")).not.toHaveCount(0);
  });

  for (const { path: route, name, bars } of CHART_PAGES) {
    test(`${name} paints a chart`, async ({ page }) => {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      const surface = page.locator(".recharts-surface").first();
      await expect(surface, `${route} rendered no chart`).toBeVisible({
        timeout: 20_000,
      });
      const box = await surface.boundingBox();
      expect(box!.width, `${route}: zero-width chart`).toBeGreaterThan(100);
      if (bars !== undefined) {
        // Scoped to the bar layer: `.recharts-rectangle` is ALSO the class on a
        // BarChart's hover cursor, so an unscoped count can move with a stray
        // pointer event.
        await expect(
          page.locator(".recharts-bar-rectangle"),
          `${route}: expected ${bars} bars — a chart that drops its tail reads as a shorter list, not as a broken one`,
        ).toHaveCount(bars, { timeout: 20_000 });
      }
    });

    test(`${name} does not overflow the viewport`, async ({ page }) => {
      // The pre-existing version of this covered "/" ONLY, which is why the
      // personnel overflow shipped. Per page, under both projects — so 412px
      // (Pixel 7) is where it bites.
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.locator(".recharts-surface").first()).toBeVisible({
        timeout: 20_000,
      });
      const o = await page.evaluate(() => {
        const de = document.documentElement;
        return { doc: de.scrollWidth, view: de.clientWidth };
      });
      expect(
        o.doc,
        `${route}: horizontal overflow — doc=${o.doc} viewport=${o.view}`,
      ).toBeLessThanOrEqual(o.view + 1);
    });
  }

  test("every captured endpoint is still requested", async ({ page }) => {
    // ⚠️ THE ONLY THING TYING THE FIXTURE TO REALITY. A capture rots quietly: a
    // renamed field is caught by accident (the hook nulls out and the chart
    // vanishes), but an added query param, a changed unit or an eleventh COFOG
    // division is not. This at least fails when a key stops being asked for —
    // which is what a route rename looks like, and what left
    // `budget-series?series=revenue` unreachable behind a looser matcher.
    //
    // It walks all four pages in one test because `usedFixtureKeys` is
    // module-scoped and each test gets a fresh page.
    for (const { path: route } of CHART_PAGES) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.locator(".recharts-surface").first()).toBeVisible({
        timeout: 20_000,
      });
    }
    const unused = Object.keys(BUDGET_CHART_FIXTURE).filter(
      (k) => !usedFixtureKeys.has(k),
    );
    expect(
      unused,
      `captured but never requested — the fixture has drifted from the routes, or a looser matcher is shadowing these:\n${unused.join("\n")}`,
    ).toEqual([]);
  });

  test("no category tick is cut off", async ({ page }) => {
    // ⚠️ ASSERTS A LENGTH BOUND, NOT `truncateTick`, and that distinction is the
    // whole clause. Three cuts of this were wrong before it worked:
    //
    //  1. „ellipsised AND title-less" — but T9.1's defect was „Жилищно
    //     строителство и благоустройство", 38 characters rendered UNTRUNCATED.
    //     Recharts neither wraps nor ellipsises a category tick, so the <text>
    //     ran to a negative x and the SVG's `overflow: hidden` cut it. There is
    //     no ellipsis in that failure, so the clause checked the second half of
    //     the fix while the first half was the bug.
    //  2. A bounding-box check. The tick is right-anchored and extends LEFT into
    //     the axis gutter, so „inside the surface" depends on the layout width
    //     the run happens to have — it fired on labels that render correctly.
    //  3. Comparing the rendered text against `truncateTick(full)`, IMPORTED
    //     from the component. That is the trap: reverting truncateTick to the
    //     identity moves both sides of the comparison together and the test
    //     stays green. Measured — mutation A passed 10/10.
    //
    // The bound does not move with the implementation: whatever shortens the
    // label, what reaches the axis must fit it.
    await page.goto("/budget/functional", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".recharts-surface").first()).toBeVisible({
      timeout: 20_000,
    });
    const ticks = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".recharts-yAxis text")).map(
        (t) => ({
          full: t.querySelector("title")?.textContent ?? "",
          shown: Array.from(t.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent ?? "")
            .join(""),
        }),
      ),
    );
    expect(
      ticks.length,
      "no y-axis ticks — this clause scanned nothing",
    ).toBeGreaterThan(0);
    const bad: string[] = [];
    for (const t of ticks) {
      // An empty \`shown\` makes every branch below false-by-construction — and
      // \`full.startsWith("")\` is true, so even the mismatch branch stays quiet.
      // That is exactly what a move to <tspan> (Recharts' own default markup,
      // and what „wrap instead of truncate" produces) would do.
      if (!t.shown) {
        bad.push(
          "a tick renders no direct text — did the label move into a <tspan>?",
        );
        continue;
      }
      if (t.shown.length > TICK_MAX_CHARS)
        bad.push(
          `${t.shown.length} chars on a ${TICK_MAX_CHARS}-char axis: „${t.shown}"`,
        );
      // Shortened, and the full string recoverable nowhere.
      if (!t.full) bad.push(`no <title>: „${t.shown}"`);
      else if (
        t.shown !== t.full &&
        !t.full.startsWith(t.shown.replace(/…$/, ""))
      )
        bad.push(`<title> „${t.full}" is not the source of „${t.shown}"`);
    }
    expect(
      bad,
      `a category tick a reader cannot read in full:\n${bad.join("\n")}`,
    ).toEqual([]);
    // …and the rule is doing something on this data, so the bound is not green
    // for want of anything long enough to shorten.
    expect(
      ticks.some((t) => t.full.length > TICK_MAX_CHARS),
      "no label is long enough to shorten — the clause proves nothing here",
    ).toBe(true);
  });
});
