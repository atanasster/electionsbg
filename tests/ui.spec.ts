import fs from "fs";
import path from "path";
import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";
import { TICK_MAX_CHARS } from "../src/screens/budget/budgetFunctionalBars";
import { MAYOR_PAY_BAND_CELLS } from "../src/screens/governance/mayorPayHubFigures";
import { stripJsxComments } from "../src/ux/infographic/stripJsxComments";

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
  /** How many rows the evidence aside must carry, where the head has one.
   *
   *  ⚠️ FOR THE SAME REASON `cells` EXISTS, ONE COLUMN OVER: a ceiling cannot tell „the rail
   *  fits" from „the rail is gone". Deleting /parliamentary/analysis' aside takes the head
   *  404 → 320, comfortably INSIDE its budget, with this whole gate green — and on that hub
   *  the aside is what drives the height, so the ceiling is measuring mostly it. Optional
   *  because most entries here predate the field; a head with no aside simply omits it. */
  asideRows?: number;
}[] = [
  // The GLOBAL HOME: identity + deck + a full HubSearch + a 4-cell band. No scope control
  // and no evidence aside, which is why it sits just under /parliament (443) rather than
  // with /funds and /consumption, whose search slot is a whole TILE.
  //
  // 270 before the finder landed, 455 after — the growth was predicted and is the trade the
  // box exists for: this is a hub of hubs, so a reader who already knows their subject would
  // otherwise have to guess which of eight tiles contains the page that contains it.
  //
  // `cells: 4` is the half that matters: a head that lost its band entirely would be
  // comfortably INSIDE any ceiling. If this trips, check for a fifth cell or a second line
  // in the note before trimming the basis captions — they are what keep four percentages
  // from four datasets from reading as one scale.
  { path: "/", maxPx: 520, measured: 455, cells: 4 },
  // The cross-kind ELECTIONS entry. Identity + deck + a scope row + a full HubSearch + a
  // 4-cell band, and no evidence aside — so it sits with /funds rather than with /governance:
  // its search slot is a card, not an input line.
  //
  // ⚠ `cells: 4` IS THE HALF THAT MATTERS, and on this head more than most. Its last two cells
  // are WITHHELD rather than zeroed when a protocol cannot be read, so a band that lost them
  // would be a 2-cell head comfortably INSIDE any ceiling — the exact blind spot this field was
  // invented for. If it trips at 4, check whether a cycle stopped resolving before trimming
  // anything.
  { path: "/elections", maxPx: 580, measured: 513, cells: 4 },
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
  // ⚠️ If this trips, do NOT shorten the band's captions first. One of them is a load-bearing
  // sentence rather than a label: the declaration cell's „не е мярка за спазване на закона" is
  // the only thing standing between „С декларация 15%" and an accusation against ~10.7k village
  // mayors who were never required to file. Check for a fifth cell instead.
  //
  // ⚠️ AND THE BUDGET IS MEASURED WITH NO `?q`, which is now the only state that HAS a band.
  // The three rate cells are facet-derived and `/api/db/facets` has no free-text parameter, so
  // under a search they went on describing the filtered corpus while „Лица" moved — captioning
  // them „ПО ФИЛТРИТЕ, НЕ ПО ТЪРСЕНЕТО" did not fix it, and the band (with the evidence aside
  // and the mix bar) is withheld whole instead. So a `?q` path added here asserts 0 cells, not
  // 4. See `personsKpiBasis.ts`.
  //
  // 469 px measured 2026-08-26 at 1280 — identity + deck + scope + a full search field with its
  // hint and example chips + a 4-cell band, with the evidence aside beside the identity column
  // at `lg` rather than under it. ~19% slack, the same band as its neighbours.
  { path: "/persons", maxPx: 560, measured: 469, cells: 4 },
  // The sibling registry browser, and the same shape: identity + deck + a full search field
  // with its hint and example chips + a 3-cell band + an evidence aside. Measured 457 px at the
  // 1280 viewport this project uses (`xl` matches — 1265 is clientWidth after the scrollbar).
  //
  // ⚠️ THREE CELLS, NOT FOUR, AND THAT IS THE LANDING'S OWN RULE. The budget is measured where
  // a reader arrives — with no query and no filter, so no table — and nothing issues a `sum`
  // aggregate without one. `companiesKpis` therefore withholds the money cell rather than
  // holding the whole band in skeletons, which `companiesKpiBasis.test.ts` asserts explicitly.
  // Four is what /companies shows once a table is up. Declaring 4 here is a gate that cannot
  // pass, which is how this entry was first written.
  //
  // ⚠️⚠️ THIS ENTRY GOES RED UNTIL MIGRATION 188 REACHES CLOUD SQL, and that is a real outage
  // rather than a test problem. Measured 2026-08-26: `/companies` serves 200 HTML on production
  // while every `companies` request to `/api/db` returns **500** — `company_browse_table` has
  // never been built there (`ngos` and `persons` on the same route return 200). The `companies`
  // DbDataTable resource has no `missingMigration` degrade, so the band stays in skeletons,
  // which carry no `data-kpi-cell` at all and this asserts 0 ≠ 3. The suite forwards
  // un-emulated function routes to the deployed backend, so a local run sees prod's answer.
  //
  // NOT skipped, deliberately: „the migration has not landed yet" must not read as „the head is
  // within budget". The fix is the operator action CLAUDE.md names — 188's only CREATE path is
  // `npm run db:load:declarations:pg:cloud -- --resolve`, followed by `db:load:graph:pg:cloud`,
  // `db:load:tr-company-place:pg:cloud` and `db:load:pg:cloud` for its three denormalized
  // sources.
  //
  // ⚠️ TWO OF THE THREE CAPTIONS ARE LOAD-BEARING SENTENCES, NOT LABELS, and if the CEILING
  // trips they are the last thing to shorten. „включително заличени вписвания" is the only
  // thing making 17 675 a true PRESENT-TENSE sentence — 2,105 of them reach the set solely
  // through filings that have all been withdrawn — and once a table is up „към фирми в
  // Търговския регистър" is the only thing standing between €76,1 млрд. and a claim about the
  // €118,1 млрд. `company_public_money` actually holds. Check for a fourth cell, or for the
  // deck growing a clause, before touching either.
  { path: "/companies", maxPx: 560, measured: 457, cells: 3 },
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
  // Identity + deck + a full search box + a 4-cell band + a three-clause note + an
  // evidence aside. No scope control — the hub has no `?pscope`. The aside sits beside the
  // identity column at `lg`, so it does not drive the height; the note's wrap does.
  //
  // ⚠️ THE NOTE IS THE LONGEST IN THE TREE AND MUST NOT BE TRIMMED IF THIS TRIPS. The four
  // cells are euro figures in one row on four DIFFERENT bases — a fiscal year beside three
  // decade-long accumulations — and their sum (~€637m) describes nothing. The sentence
  // saying they do not add is the page's central claim, older than the band; check for a
  // fifth cell instead.
  //
  // ⚠️ AND IF THE COUNT COMES IN UNDER 4, IT IS NOT A CODE CHANGE. This is the only
  // entry here whose cell count depends on BUCKET-SYNCED optional fields: `budget` and
  // `films` ship in data/culture/derived/hub_stats.json via `bucket:sync`, a different
  // command from `npm run deploy`, so a deployed blob minted before those fields exist
  // yields a two-cell band. Run `bucket:sync` for `culture/derived/`. That this fails at
  // all is a bonus — it doubles as a bucket-freshness gate.
  // 483 with the band alone; 495 once the evidence aside landed.
  { path: "/culture", maxPx: 560, measured: 495, cells: 4 },
  // Identity + deck + a scope control + a 4-cell band + a note + an evidence aside, and no
  // search slot (the grid is nineteen tiles, which is a list a reader scans rather than
  // searches).
  //
  // ⚠️ THE NOTE AND THE ASIDE'S BASIS ARE THE POINT OF THIS HEAD, not trim-able padding. The
  // four cells sit on four INCOMMENSURABLE bases — tender € in a window, one year's adopted
  // budget, one year's actual payout, and a headcount — so a band is exactly where a reader
  // adds them, and only the first is a sum at all. The aside's basis is the other half: four
  // rows on a nineteen-sector page read as „these are the big ones" without the clause
  // saying the rest are absent by MEASURE, not by size (Пенсии is larger than every row).
  //
  // ⚠️ IF THIS TRIPS, IT IS THE ASIDE, not a fifth cell — the aside is what drives the height
  // here, because there is no search slot filling the identity column beside it. Check
  // whether its basis grew a clause before touching the band.
  //
  // 357 with the band alone; 476 once the aside landed — its basis line is three clauses,
  // and unlike the sibling hubs it is the aside rather than the band that drives the height
  // here, because there is no search slot to fill the identity column.
  { path: "/governance/sectors", maxPx: 540, measured: 476, cells: 4 },
  // Identity + deck + a 4-cell band + a note + an evidence aside, and no scope control and
  // no search slot — the `?elections` selector in the site header is what moves these
  // figures, so the head carries no pill of its own.
  //
  // ⚠️ THE NOTE IS THE POINT, not trim-able padding. The four cells are percentages of FOUR
  // DIFFERENT THINGS on TWO different quarters — growth against the same quarter a year
  // earlier, inflation against the previous year, unemployment of the active population,
  // debt of GDP — so a row of them reads as one scale and is not. If this trips, check for a
  // fifth cell before touching the sentence.
  //
  // ⚠️ LOOSER THAN MOST (17.6% slack against a ~15% median), and deliberately: it
  // is the only entry whose height depends on a BUCKET-SYNCED STRING rather than on code.
  // Each basis is the indicator's own `unitLabel` from data/macro.json — „% спрямо същия
  // период предходна година (реален, SCA)" is the longest today — so a re-worded unit from
  // Eurostat wraps a cell without a line of source changing. Tighten this only after
  // measuring against the current payload.
  //
  // 311 with the band alone; 459 once the peer-rank aside landed — it has no search slot to
  // fill the identity column beside it, so unlike the sibling hubs the ASIDE drives the
  // height here.
  { path: "/indicators", maxPx: 540, measured: 459, cells: 4 },
  // Identity + deck + a 4-cell band + a note, and no scope control, no search slot and no
  // evidence aside. Like /indicators the `?elections` selector in the site header is what
  // moves these figures, so the head carries no pill of its own.
  //
  // ⚠️ THE NARROWEST BAND HEAD IN THE TREE, and the captions are why it is not narrower
  // still. Two of the four cells are claims about ELECTORAL INTEGRITY — „6" sections in the
  // risk score's critical band and „4" parties off the Benford curve — and each basis
  // carries what the figure is NOT: „места, които заслужават поглед, не установени
  // нарушения" and „тестът бракува и чисти данни, затова това НЕ е доказателство за
  // фалшификация". The second is the destination page's own caveat; without it a band cell
  // makes a stronger claim about named parties than the page it links to does. If this
  // trips, check for a fifth cell — never shorten those two.
  //
  // ⚠️ AND THE RISK BASIS MUST NOT SAY „процедурни". That word names the party-blind
  // SUB-score in this repo, while the figure is the composite over both signal families —
  // see analysisHubFigures.ts's header and risk_score.ts's circularity warning.
  //
  // ⚠️ `cells: 4` IS THE DEFAULT ELECTION'S COUNT, not a constant. A cell is withheld when
  // the selected cycle's payload lacks that stat, and that is not hypothetical:
  // data/2005_06_25/analysis_stats.json carries no `persistence`, so that cycle is 3. This
  // gate runs on the latest election, which carries all four — so if the count comes in
  // short, check whether the `?elections` default moved before looking for a code change.
  //
  // 320 with the band alone; 404 once the evidence rail landed. ⚠️ THE RAIL DRIVES THE
  // HEIGHT HERE, unlike the sibling hubs: there is no search slot filling the identity
  // column beside it at `lg`, so the aside stacks. Measured 2026-08-26 at 1280 (1265
  // clientWidth after the scrollbar).
  //
  // ⚠️ IF THIS TRIPS, IT IS THE RAIL'S BASIS, not a fifth cell — and that basis is the one
  // sentence saying a risk BAND is a screen for review rather than a finding. Without it
  // three rows reading „Висок 297" assert 297 places where something happened.
  {
    path: "/parliamentary/analysis",
    maxPx: 470,
    measured: 404,
    cells: 4,
    asideRows: 3,
  },
  // The sibling hub, sharing one band module and one note with /parliamentary/analysis.
  //
  // ⚠️ TWO CELLS, NOT FOUR, AND THAT IS THIS HUB'S OWN SIZE — declaring 4 is a gate that
  // cannot pass. The band is built from THIS hub's registry, and only `risk` and `turnout`
  // have a headline number at all; padding it from the analysis payload would be a band
  // describing a different page. `risk` also points at /risk-score here and /risk-analysis
  // there, which is why the destinations are not in the shared module.
  //
  // ⚠️ 319 px, EIGHT MORE THAN the four-cell hub's — a two-cell band is not a shorter head.
  // Its deck runs three lines to the analyses hub's two, and the deck's third line is the
  // „а където изборът има такива данни" clause, which is there because both the recount and
  // the machine-memory families are `requires`-gated: measured over the 13 parliamentary
  // cycles, `hasRecount` is true on ONE (2024_10_27) and false on the default 2026_04_19,
  // and `hasSuemg` on seven. Without the clause the deck names a report family that is not
  // on the page a reader lands on. Measured 2026-08-26 at 1280.
  // 319 with the band alone; 379 once the rail landed — shorter than its sibling only
  // because its deck wraps differently, not because a two-cell band is a shorter head.
  {
    path: "/parliamentary/reports",
    maxPx: 435,
    measured: 379,
    cells: 2,
    asideRows: 3,
  },
  // Identity + deck + a 4-cell band + a two-clause note, plus an evidence rail of the four
  // cheapest oblasts. No scope control — the corpus is one continuous daily series, not a
  // windowed one — and, since 2026-09-07, NO search slot either.
  //
  // ⚠️ THE SEARCH TILE IS GONE, AND THAT IS WHY THIS NO LONGER SITS WITH /funds AND /budget.
  // It rendered the SAME `ConsumptionSearchTile` as the /consumption hub one click above it,
  // over the same corpus — a duplicate rather than a second entry point — so „колко струва X"
  // is now answered once, there. `PricesScreen.test.tsx` asserts the page carries no input at
  // all, so re-adding it loose above the grid trips a gate rather than this ceiling.
  //
  // ⚠️ IF THIS TRIPS, DO NOT SHORTEN THE NOTE. Its second clause — „това не е официалната
  // инфлация на НСИ" — is the single most likely misreading of this page: the sibling
  // /consumption band prints the official food rate at +3,8% against this basket's −1,0%,
  // and every other disclaimer saying so is far below the fold. Check for a fifth cell, or
  // for a basis growing a clause, first.
  //
  // ⚠️ THE RAIL STILL DOES NOT DRIVE THE HEIGHT, unlike /governance/sectors and /indicators:
  // the identity column beside it is taller than the four rows even without the search tile.
  // At 428 the aside is 246 of it, so the ceiling below is the identity column's.
  //
  // 508 px with a sentence title; 492 once it shortened to „Цените след еврото"; 442 once the
  // search tile left; 428 once the rail's basis dropped its coverage clause and went from
  // four 11px lines to three. Measured 2026-09-07 at 1280. (EN is 414 — the clause wraps
  // shorter there — but this ceiling is read on the BG path, which is the taller one.)
  { path: "/prices", maxPx: 495, measured: 428, cells: 4, asideRows: 4 },
  // A RANKING, and a third shape again: identity + freshness + deck + a full search field +
  // a 4-cell band + a one-line note, with NO scope control (the page has no `?pscope` — its
  // window is whatever year each mayor last filed for) and NO evidence rail (the ranked
  // table below IS the list, the /procurement/contracts argument).
  //
  // ⚠️ IT SHIPPED WITH NO ENTRY HERE AT ALL. The head landed on 2026-08-28 (fc4fb81bf8) and
  // this list had no completeness gate, so for three days the page had no ceiling, no
  // rendered `cells` assertion and no rendered one-h1 check while every test in this file
  // was green. `every HubHead screen has a height budget` below is what closes that, and
  // `HUB_HEAD_SCREENS` under it is what lets that clause name the screen behind a path.
  //
  // ⚠️ `cells` IS `MAYOR_PAY_BAND_CELLS`, NOT A LITERAL 4. The band is a declared array, so
  // its size is read from the module that declares it — the rule `COUNTED_WAITS` in
  // scripts/prerender/ogAndSitemapCoverage.test.ts follows for the same band. A hand-copied
  // 4 here would keep this gate green through a drop to three cells, which is exactly the
  // direction `mayorPayHubFigures.ts`'s header records the og gate already failed in.
  //
  // ⚠️ THE BAND IS ALL-OR-NOTHING (`mayorPayHubKpis` returns four cells or none), so a count
  // of 0 means „the corpus did not load", never „a cell was withheld" — unlike /companies
  // and /persons above, whose counts are the landing's own size. Its source is a DEPLOYED
  // function route (`/api/db/mayor-pay-ranking`, migration 186), which the hosting emulator
  // forwards, so this entry also goes red if that migration ever leaves Cloud SQL — the
  // /companies-and-188 shape, and red is the right answer there too.
  //
  // ⚠️ IF THIS TRIPS, CHECK FOR A FIFTH CELL BEFORE TOUCHING THE NOTE. The note is one
  // sentence — that the rows can span filing years — and it is the only thing on the page
  // saying so; `mayorPayHubFigures.ts`'s header records that its FIRST sentence was already
  // cut, for restating the band's own coverage cell, so what is left is the residue rather
  // than padding. The band's captions are the next-least trimmable: „последните налични
  // декларации" and the per-1000-residents basis are what keep four figures on three bases
  // from reading as one scale, and none of them is a salary.
  //
  // 375 px measured 2026-08-31 at 1280 (the desktop project's viewport) against a built
  // dist/ on the hosting emulator, with the band loaded — `KpiCellSkeleton` carries no
  // `data-kpi-cell`, so the 4 above is the real band and not a reserved slot. ~17% slack,
  // the band its neighbours sit in, and the second-narrowest head in the tree after
  // /procurement/contracts — the rail and the scope pill are both absent.
  {
    path: "/governance/mayor-pay",
    maxPx: 440,
    measured: 375,
    cells: MAYOR_PAY_BAND_CELLS,
  },
];

/** The screen behind each budgeted path, so the completeness clause below can ask „does
 *  every HubHead screen have a budget?" — a question the paths alone cannot answer.
 *
 *  Kept beside the list rather than as a field ON each entry so the entries keep their
 *  reasoning unbroken; the clause asserts the two key sets are IDENTICAL, so neither can
 *  gain a member without the other. */
const HUB_HEAD_SCREENS: Record<string, string> = {
  "/": "src/screens/HomeDashboardScreen.tsx",
  "/governance": "src/screens/GovernanceScreen.tsx",
  "/procurement": "src/screens/ProcurementScreen.tsx",
  "/funds": "src/screens/FundsScreen.tsx",
  "/procurement/contracts": "src/screens/dev/ContractsBrowserDbScreen.tsx",
  "/parliament": "src/screens/ParliamentHubScreen.tsx",
  "/budget": "src/screens/budget/BudgetHubScreen.tsx",
  "/consumption": "src/screens/ConsumptionScreen.tsx",
  "/subsidies": "src/screens/SubsidiesDashboardScreen.tsx",
  "/persons": "src/screens/persons/PersonsBrowserScreen.tsx",
  "/companies": "src/screens/dev/CompaniesBrowseDbScreen.tsx",
  "/prices": "src/screens/PricesScreen.tsx",
  "/governance/declarations":
    "src/screens/governance/GovernanceDeclarationsScreen.tsx",
  "/governance/mayor-pay":
    "src/screens/governance/GovernanceMayorPayScreen.tsx",
  "/culture": "src/screens/culture/CultureHubScreen.tsx",
  "/governance/sectors": "src/screens/governance/GovernanceSectorsScreen.tsx",
  "/indicators": "src/screens/indicators/IndicatorsLandingScreen.tsx",
  "/parliamentary/analysis": "src/screens/analysis/AnalysisHubScreen.tsx",
  "/parliamentary/reports": "src/screens/reports/hub/ReportsHubScreen.tsx",
};

/** HubHead call sites with no height budget, and why. A real debt, named so that the LIST
 *  shrinks rather than the rule — the `NOT_YET` idiom from
 *  scripts/prerender/ogAndSitemapCoverage.test.ts. */
const NO_BUDGET: Record<string, string> = {
  // Four routes (/culture/funds/:arm) behind one screen, so a budget here pins one arm and
  // says nothing about the other three. Open work rather than a decision against it: the
  // honest form is four entries, one per arm, which is four measurements nobody has taken.
  "src/screens/culture/CultureFundsSourceScreen.tsx":
    "one screen behind four parameterised routes — a budget would pin one arm",
};

/** Every `<HubHead` call site under src/screens, comment-stripped so a screen that merely
 *  MENTIONS the component in prose is not counted, and `.test.tsx` dropped because a string
 *  literal in an assertion message survives the stripper. Both filters are the ones
 *  scripts/prerender/ogAndSitemapCoverage.test.ts records having needed. */
const headScreens = (): string[] => {
  const root = path.resolve(process.cwd(), "src/screens");
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".tsx") && !e.name.includes(".test.")) {
        if (/<HubHead\b/.test(stripJsxComments(fs.readFileSync(full, "utf8"))))
          out.push(path.relative(process.cwd(), full));
      }
    }
  };
  walk(root);
  return out.sort();
};

test.describe("hub head — the §3.0 height budget", () => {
  // Desktop only: the budget is stated at `lg`, and on Pixel 7 the same head is legitimately
  // taller because every column stacks.
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) < 1024,
    "the budget is a claim about the lg layout",
  );

  for (const { path, maxPx, measured, cells, asideRows } of HUB_HEAD_BUDGETS) {
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
      // …and so is the rail, where one is declared. A deleted aside SHRINKS the head, so the
      // ceiling above passes on exactly the regression it looks like it would catch.
      if (asideRows !== undefined)
        await expect(
          head.locator("aside a[href]"),
          `${path}: the evidence rail rendered the wrong number of rows`,
        ).toHaveCount(asideRows + 1); // the rows plus the rail's own action link
    });
  }

  // A STATIC clause, and it lives here rather than in hubHead.gates.test.ts because it reads
  // the budget list DIRECTLY — putting it there would mean parsing this array back out of
  // this file's source, the „a gate that can no longer see its subject" shape that file's own
  // header warns about. Sitting inside this describe means it runs once, on the desktop
  // project; nothing about it is a claim about the `lg` layout.
  test("every HubHead screen has a height budget", () => {
    const screens = headScreens();
    // Non-vacuity: a renamed component or a broken walk would otherwise pass on nothing.
    expect(screens.length, "no screen renders HubHead").toBeGreaterThan(2);

    const known = new Set([
      ...Object.values(HUB_HEAD_SCREENS),
      ...Object.keys(NO_BUDGET),
    ]);
    const unlisted = screens.filter((f) => !known.has(f));
    expect(
      unlisted,
      `these render a HubHead and have no §3.0 height budget — give each one an entry, or ` +
        `NO_BUDGET it with a reason: ${unlisted.join(", ")}`,
    ).toEqual([]);

    // …and no mapping or exemption outlives the screen it names. A renamed file would
    // otherwise sit here for ever, exempting nothing.
    for (const [p, f] of Object.entries(HUB_HEAD_SCREENS))
      expect(
        screens,
        `${p} is mapped to ${f}, which renders no HubHead`,
      ).toContain(f);
    for (const f of Object.keys(NO_BUDGET))
      expect(
        screens,
        `${f} is exempted from a budget it no longer needs`,
      ).toContain(f);

    // …and the map and the budgets describe the same set of pages, so neither can gain a
    // member alone.
    expect(
      Object.keys(HUB_HEAD_SCREENS).sort(),
      "HUB_HEAD_SCREENS and HUB_HEAD_BUDGETS name different pages",
    ).toEqual(HUB_HEAD_BUDGETS.map((b) => b.path).sort());
  });

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
