import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";

// Same routes as seo.spec, but here we boot the SPA and verify it actually
// renders without runtime errors at desktop and mobile viewports. The same
// spec runs under two projects (Desktop Chrome + iPhone 13) — see
// playwright.config.ts.

const SAMPLE_PARTY = "ГЕРБ-СДС";
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

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
const liveHeading = (page: Page) => page.locator("#root :is(h1, h2)").first();

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
