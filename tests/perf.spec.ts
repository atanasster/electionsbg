import { test, expect } from "@playwright/test";

// Performance regression checks. These don't try to assert real-world Web
// Vitals (localhost timings are too fast to be representative) — they assert
// on the structural decisions that drive CWV: how much JS gets pulled before
// LCP, total HTML size of the prerendered shell, and that long-task
// generators stay below a sane budget on the home page.

const HOME_HTML_MAX_BYTES = 14_000;
// We trimmed the eagerly-modulepreloaded chunk count from 9 → 6 by stripping
// vendor-pdf, vendor-charts, vendor-leaflet, vendor-markdown. 7 leaves a
// little headroom (e.g. for adding back vendor-charts intentionally) before
// the test starts complaining.
const HOME_MODULEPRELOAD_MAX = 7;

test.describe("performance", () => {
  test("home HTML is under size budget", async ({ request }) => {
    const res = await request.get("/");
    const html = await res.text();
    expect(html.length).toBeLessThan(HOME_HTML_MAX_BYTES);
  });

  test("home page modulepreload count is under budget", async ({ request }) => {
    const res = await request.get("/");
    const html = await res.text();
    const preloads = Array.from(
      html.matchAll(
        /<link[^>]+rel=["']modulepreload["'][^>]+href=["']([^"']+)["']/gi,
      ),
    ).map((m) => m[1]);
    expect(
      preloads.length,
      `modulepreload list: ${preloads.join("\n")}`,
    ).toBeLessThanOrEqual(HOME_MODULEPRELOAD_MAX);
  });

  test("home page does not eagerly preload heavy route-only chunks", async ({
    request,
  }) => {
    const res = await request.get("/");
    const html = await res.text();
    const preloads = Array.from(
      html.matchAll(
        /<link[^>]+rel=["']modulepreload["'][^>]+href=["']([^"']+)["']/gi,
      ),
    ).map((m) => m[1]);
    // Each of these adds 100KB+ gzip and is only used by lazy-loaded screens.
    for (const banned of [
      "vendor-pdf",
      "vendor-charts",
      "vendor-leaflet",
      "vendor-markdown",
      "exportToPDF-",
    ]) {
      expect(
        preloads.find((p) => p.includes(banned)),
        `unexpected modulepreload: ${banned}`,
      ).toBeUndefined();
    }
  });

  test("LCP fires within 4s on localhost (smoke)", async ({ page }) => {
    // 4s is generous; localhost should be under 1s. The point is to catch
    // regressions where LCP stops firing entirely (e.g. a new render-blocking
    // resource breaks the paint pipeline).
    await page.goto("/", { waitUntil: "networkidle" });
    const lcp = await page.evaluate(
      () =>
        new Promise<number | null>((resolve) => {
          let last: number | null = null;
          // Buffered observer surfaces entries that fired before the
          // observer was created, so on a fully-loaded `networkidle` page
          // the entries are already in the queue.
          new PerformanceObserver((list) => {
            const entries = list.getEntries();
            if (entries.length) {
              last = entries[entries.length - 1].startTime;
            }
          }).observe({ type: "largest-contentful-paint", buffered: true });
          // Poll for up to 6s in case the worker is contending with other
          // parallel tests on the firebase emulator. Resolve as soon as we
          // have any LCP entry.
          const start = Date.now();
          const tick = () => {
            if (last !== null) return resolve(last);
            if (Date.now() - start > 6000) return resolve(last);
            setTimeout(tick, 100);
          };
          tick();
        }),
    );
    expect(lcp, "LCP did not fire").not.toBeNull();
    expect(lcp!).toBeLessThan(4000);
  });

  // CLS gate: every route must stay in the CWV "good" range (< 0.1). Each
  // entry is a (path, label) tuple — we use the path as the test name suffix
  // so a regression points directly at which route broke. Use realistic
  // sample IDs (real party / municipality codes from the latest election).
  // If these IDs change in a future election, update them — failure msgs
  // make the source obvious.
  const CLS_ROUTES: Array<{ path: string; label: string }> = [
    { path: "/", label: "home" },
    { path: "/sofia", label: "sofia" },
    { path: "/parties", label: "parties" },
    { path: "/regions", label: "regions" },
    { path: "/timeline", label: "timeline" },
    { path: "/simulator", label: "simulator" },
    { path: "/compare", label: "compare" },
    { path: "/polls", label: "polls" },
    { path: "/about", label: "about" },
    {
      path: "/party/%D0%93%D0%95%D0%A0%D0%91-%D0%A1%D0%94%D0%A1",
      label: "party detail",
    },
    { path: "/municipality/SOF", label: "municipality detail" },
    { path: "/reports/section/turnout", label: "report — section turnout" },
    {
      path: "/reports/section/concentrated",
      label: "report — section concentrated",
    },
    {
      path: "/reports/municipality/turnout",
      label: "report — municipality turnout",
    },
  ];

  for (const { path, label } of CLS_ROUTES) {
    test(`CLS stays under 0.1 — ${label} (${path})`, async ({ page }) => {
      await page.goto(path, { waitUntil: "networkidle" });
      const cls = await page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            let total = 0;
            new PerformanceObserver((list) => {
              for (const e of list.getEntries() as PerformanceEntry[] &
                {
                  hadRecentInput?: boolean;
                  value?: number;
                }[]) {
                const ls = e as PerformanceEntry & {
                  hadRecentInput?: boolean;
                  value?: number;
                };
                if (!ls.hadRecentInput && typeof ls.value === "number") {
                  total += ls.value;
                }
              }
            }).observe({ type: "layout-shift", buffered: true });
            setTimeout(() => resolve(total), 1500);
          }),
      );
      expect(cls, `CLS=${cls.toFixed(4)} on ${path}`).toBeLessThan(0.1);
    });
  }

  test("no individual blocking resource is too large", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const oversized = await page.evaluate(() => {
      const entries = performance.getEntriesByType(
        "resource",
      ) as PerformanceResourceTiming[];
      const blockingTypes = new Set(["script", "css", "link"]);
      return entries
        .filter((e) => blockingTypes.has(e.initiatorType))
        .filter((e) => (e.encodedBodySize ?? e.decodedBodySize ?? 0) > 600_000)
        .map((e) => ({
          name: e.name,
          encoded: e.encodedBodySize,
          decoded: e.decodedBodySize,
        }));
    });
    expect(oversized, JSON.stringify(oversized, null, 2)).toEqual([]);
  });
});
