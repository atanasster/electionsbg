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

// ─── the hub head's height budget ────────────────────────────────────────────
//
// docs/plans/hub-hero-v1.md §3.0 budgets the head at ~420 px at `lg`: "a head that grows past
// that has replaced the problem it fixes." The head exists because /funds put its first
// corpus-level figure at ~2 600 px; a head that swells to a screen and a half is the same
// defect wearing better type.
//
// Every `measured` below is taken at the DESKTOP project's 1280 viewport — the one CI runs —
// rather than at the 1024 `lg` breakpoint where these heads are first designed. The two differ
// by ~10 px and the gate compares against the former, so recording the latter would make a
// future failure read as growth that had not happened.
//
// This lives in Playwright and not in a unit test because it is a claim about LAYOUT. jsdom
// reports 0 for every box, so the gate would pass on a head of any size — the vacuity this
// file's siblings keep re-learning. Each budget below carries the value measured when it was
// set, so a future failure says whether the head grew or the ceiling was always too tight.
const HUB_HEAD_BUDGETS: {
  path: string;
  maxPx: number;
  measured: number;
  /** How many KPI cells the band must carry. ⚠️ A CEILING CANNOT SEE A MISSING BAND: a head
   *  that lost its figures entirely is comfortably INSIDE its budget — measured on
   *  /subsidies, 528 px against a 620 ceiling with `kpis` unwired and every assertion here
   *  green. The height and the count together are what make this gate non-vacuous. */
  cells: number;
}[] = [
  // Eyebrow + h1 + deck + a one-line search + a 4-cell band + the evidence aside.
  { path: "/governance", maxPx: 500, measured: 430, cells: 4 },
  // The same, plus a scope control.
  { path: "/procurement", maxPx: 540, measured: 477, cells: 4 },
  // The widest head in the tree, and deliberately so: its search slot is the whole FundsFinder
  // tile, not an input. That is the trade docs/plans/funds-module-v2.md §5.2 asks for — look-up
  // before read — so the allowance is declared here rather than the head being trimmed.
  { path: "/funds", maxPx: 600, measured: 531, cells: 4 },
  // A registry BROWSER, and the narrowest head in the tree because of it: no search slot (the
  // table owns its own) and no evidence aside (the table is the ranked list), so the head is
  // identity + scope + band and nothing else.
  //
  // ⚠ 360, not 400. At CI's 1280 viewport this head is 304 px, and a 400 ceiling left 96 px
  // of room — enough to quietly acquire the search slot the line above says it deliberately
  // omits, which is the growth this budget exists to catch. 360 is ~18% slack, the same band
  // the three entries above sit in (13% / 10% / 18%). If it ever trips, the question is
  // whether the new thing belongs on the TABLE rather than in the head.
  { path: "/procurement/contracts", maxPx: 360, measured: 304, cells: 4 },
  // Identity + deck + a full HubSearch in the slot + a 4-cell band. The search is why this
  // one is wider than /procurement's: the same trade /funds makes, and for the same reason —
  // a reader who arrives knowing the MP or the bill they want should not have to guess a tile.
  { path: "/parliament", maxPx: 520, measured: 443, cells: 4 },
  // The same shape as /parliament — identity + deck + a full HubSearch + a 4-cell band —
  // plus an evidence aside and a one-line note bridging the band's envelope to the tiles'
  // execution.
  //
  // ⚠ Its captions are the longest in the tree, in BOTH halves, and deliberately so. The
  // band's basis lines („прогнозни разходи по КФП спрямо прогнозен БВП за 2026 г.") are the
  // only thing keeping a forecast from reading as the budget law, and the aside's carries a
  // three-clause disclaimer without which five ministry rows read as a breakdown of the €29,6
  // млрд. directly above them. So the allowance is declared here rather than the words being
  // trimmed — if this trips, check whether a CELL or a ROW was added before shortening the
  // sentences that make the existing ones true.
  //
  // 479 with the band alone; 491 once the aside landed — the aside is 322 px and does not
  // drive the height, since at `lg` it sits beside the identity column rather than under it.
  { path: "/budget", maxPx: 560, measured: 491, cells: 4 },
  // Takes /funds' trade — a whole search TILE in the slot rather than an input — so it
  // sits with /budget and /funds rather than with the compact heads.
  //
  // 545 with the place switcher INSIDE the head; 495 once it moved above, where a
  // cross-view nav belongs (it navigates away rather than governing the band — see the
  // screen's header). The ceiling keeps /funds-like room because the search tile is the
  // half most likely to grow.
  //
  // ⚠️ If this trips, do NOT reach for the captions first: the two basis lines are the
  // only thing keeping „−0,5%" and „+3,8%" from reading as a contradiction.
  { path: "/consumption", maxPx: 600, measured: 495, cells: 4 },
  // Identity + deck + a scope control + a full search box + a 4-cell band + a two-clause
  // note. The band's captions are the longest in the tree after /budget's, and for the same
  // reason: every figure here moves by up to 7× with the scope (€1.59bn on the default year
  // against €11.04bn all-time), so the window is repeated on all four cells rather than
  // stated once and left to be inferred.
  //
  // 554 with the band alone; 570 once the evidence aside landed (the aside sits beside the
  // identity column at `lg`, so it does not drive the height — the caption's extra line does).
  //
  // ⚠️ If this trips, do NOT shorten the captions first — check whether a fifth cell arrived.
  { path: "/subsidies", maxPx: 620, measured: 570, cells: 4 },
  // The SECOND registry browser to take a head, and deliberately NOT shaped like the first.
  //
  // ⚠️ READ /procurement/contracts ABOVE FIRST. Its entry says a browser head omits the search
  // slot because "the table owns its own", and warns that slack in the ceiling is "enough to
  // quietly acquire" one. /persons acquires it ON PURPOSE: the page is search-first — it
  // renders NO table until there is a query, a filter or an explicit „разгледай всички", so the
  // search is the page's primary act rather than the table's accessory. It also carries a scope
  // control and an evidence aside, which is why it sits in the /parliament band rather than the
  // 360 one.
  //
  // ⚠️ If this trips, do NOT shorten the band's captions first. Two of them are load-bearing
  // sentences rather than labels: the declaration cell's „не е мярка за спазване на закона" is
  // the only thing standing between „С декларация 15%" and an accusation against ~10.7k village
  // mayors who were never required to file, and „по филтрите, не по търсенето" is what stops a
  // corpus rate being read as a property of the search results. Check for a fifth cell instead.
  //
  // 469 px measured 2026-08-26 at 1280 — identity + deck + scope + a full search field with its
  // hint and example chips + a 4-cell band, with the evidence aside beside the identity column
  // at `lg` rather than under it. ~19% slack, the same band as its neighbours.
  { path: "/persons", maxPx: 560, measured: 469, cells: 4 },
  // Identity + deck + a two-state scope control + a full search box + a 4-cell band + a
  // one-line note + an evidence aside. The aside sits beside the identity column at `lg`,
  // so it does not drive the height — the note and the wrapped basis line do.
  //
  // ⚠️ THE NOTE IS LOAD-BEARING, NOT DECORATION — do not trim it if this trips. The scope
  // pill sits directly above the band, which is the arrangement that makes a reader assume
  // every figure under it moved; only the MP cell does. Without the note „63 782 публични
  // фигури" reads as a claim about ONE parliament, understating the register by its whole
  // history. Check for a fifth cell instead.
  //
  // 513 with a one-line organisations basis; 525 once that cell gained „целият регистър ·"
  // and wrapped, and unchanged by the evidence aside. Measured in dev at 1280, the same
  // basis the entries above use; a Playwright run against a built dist is authoritative.
  { path: "/governance/declarations", maxPx: 590, measured: 525, cells: 4 },
];

test.describe("hub head — the §3.0 height budget", () => {
  // Desktop only: the budget is stated at `lg`, and on Pixel 7 the same head is legitimately
  // taller because every column stacks.
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) < 1024,
    "the budget is a claim about the lg layout",
  );

  for (const { path, maxPx, measured, cells } of HUB_HEAD_BUDGETS) {
    test(`${path} head fits its budget`, async ({ page }) => {
      await page.goto(path, { waitUntil: "networkidle" });
      const head = page.locator("[data-hub-head]");
      // Non-vacuity: a renamed attribute would otherwise make every budget pass on nothing.
      await expect(head).toHaveCount(1);
      const box = await head.boundingBox();
      expect(box, `${path}: the head has no box`).not.toBeNull();
      const h = Math.round(box!.height);
      expect(
        h,
        `${path} head is ${h}px, over its ${maxPx}px budget (was ${measured}px when set)`,
      ).toBeLessThanOrEqual(maxPx);
      // …and the band is still there. See `cells` for why the ceiling alone is not enough.
      await expect(
        head.locator("[data-kpi-cell]"),
        `${path}: the band rendered the wrong number of cells`,
      ).toHaveCount(cells);
    });
  }

  // One h1 per page is gated statically in hubHead.gates.test.ts, but that gate reads SOURCE.
  // This is the rendered half: a screen could still mount a second heading through a shared
  // component the scan cannot follow.
  test("a hub renders exactly one h1", async ({ page }) => {
    for (const { path } of HUB_HEAD_BUDGETS) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page.locator("h1"), `${path}`).toHaveCount(1);
    }
  });
});
