import { defineConfig, devices } from "@playwright/test";

// Tests run against the Firebase Hosting emulator so that prerendered HTML
// files at /about/index.html, /party/X/index.html etc. are served exactly as
// they will be in production. Vite preview can't replicate Firebase's static
// + rewrite priority, so SEO assertions there would be misleading.
const BASE_URL = "http://127.0.0.1:5002";

export default defineConfig({
  testDir: "./tests",
  // Tests are independent — every spec brings up its own request/page.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    // Don't retry redirects automatically in seo tests — we assert on them.
    extraHTTPHeaders: { "User-Agent": "playwright-electionsbg-tests" },
  },

  webServer: {
    // Requires a built dist/. Run `npm run build` before `npm test` (or use
    // npm run test:build which chains them).
    command: "firebase emulators:start --only hosting --project elections-bg",
    url: `${BASE_URL}/`,
    reuseExistingServer: !process.env.CI,
    // First-run cold start can take a while if firebase pulls config.
    timeout: 90_000,
    // Silence per-request hosting logs from the reporter — too noisy when
    // running 44 SEO checks against a static emulator.
    stdout: "ignore",
    stderr: "pipe",
  },

  projects: [
    // Static-HTML / SEO assertions. No browser — uses the request fixture.
    {
      name: "seo",
      testMatch: /seo\.spec\.ts$/,
    },
    // Modulepreload + resource-size assertions. Chromium for performance APIs.
    {
      name: "perf",
      testMatch: /perf\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
    // Full UI rendering — same spec runs at desktop and mobile viewports.
    {
      name: "desktop",
      testMatch: /ui\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Pixel 7 uses Chromium under the hood, so we don't need to install
      // WebKit. Real iOS-rendering differences are out of scope for these
      // smoke tests; the goal is to catch responsive-layout regressions at a
      // small viewport.
      name: "mobile",
      testMatch: /ui\.spec\.ts$/,
      use: { ...devices["Pixel 7"] },
    },
  ],
});
