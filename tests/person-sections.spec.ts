// Smoke coverage for the DB-backed person surfaces (audit gap D3).
//
// These sections all SELF-HIDE when their endpoint returns no data, so a broken fetch or a
// thrown render is indistinguishable from "this person has nothing to show" — the exact
// failure the component tests can't see end-to-end. The Firebase hosting emulator runs with
// `--only hosting:main`, and it does NOT 404 an un-emulated function rewrite — it proxies
// /api/db/** to the DEPLOYED function. So a test that does not stub is making live production
// calls (~11 s on a cold start). We mock the endpoints with page.route and assert
// the render path both ways: data present → the section renders; data absent → it self-hides
// while the page still boots. Section presence is checked by DashboardSection's stable DOM
// id, not localized copy.
//
// Since 034ff0b32e the PAGE is in that same position: firebase.json rewrites `/person/*` to
// the `db` function, so the emulator forwards the navigation itself to the deployed one. See
// serveLocalShell below for why that is fatal here rather than merely slow.

import { test, expect, type Page } from "@playwright/test";

const PROFILE = {
  slug: "e2e-person",
  name: "Тестов Човек",
  namesakeRisk: 0,
  isPublicFigure: true,
  facets: [],
  roles: [],
  companies: [],
  ngos: [],
  procuredEur: 0,
  fundsEur: 0,
  subsidiesEur: 0,
  sanctions: [],
  ds: [],
  regulators: [],
  aliases: [],
};

const STAKE = [
  {
    eik: "112028994",
    companyName: "РАДИО СОТ",
    declaredName: "РАДИО СОТ ООД",
    shareSize: "1",
    firstYear: 2020,
    lastYear: 2021,
    contractCount: 5,
    totalEur: 900000,
    whileDeclaredCount: 2,
    whileDeclaredEur: 66000,
  },
];

const COHORT = {
  cohort: "mp",
  year: 2021,
  netEur: 845131,
  peers: 564,
  medianEur: 55576,
  percentile: 97,
};

const WEALTH = {
  slug: "e2e-person",
  series: [
    {
      year: 2020,
      assetsEur: 100000,
      debtsEur: 0,
      netEur: 100000,
      incomeEur: 50000,
      filings: 1,
      tier: "mp",
      byCategory: {},
    },
    {
      year: 2021,
      assetsEur: 200000,
      debtsEur: 0,
      netEur: 200000,
      incomeEur: 60000,
      filings: 1,
      tier: "mp",
      byCategory: {},
    },
  ],
  markers: [],
};

const FILINGS = [
  {
    slug: "ivan-a",
    name: "Иван Тест",
    year: 2018,
    fiscalYear: 2018,
    declarationType: "Annualy",
    institution: "Тест агенция",
    positionTitle: null,
    firstSeen: "2026-07-24",
    filedAt: "2019-03-01",
    sourceUrl: "https://register.cacbg.bg/e2e-a.xml",
  },
];

// Intercept every /api/db call. `overrides` gives the endpoints under test their payload;
// everything else returns [] — which the object-shaped hooks read as "no data" and self-hide,
// so unrelated sections don't interfere.
async function mockDb(page: Page, overrides: Record<string, unknown>) {
  await page.route("**/api/db/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/db/",
      "",
    );
    const body = path in overrides ? overrides[path] : [];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

// Serve the LOCAL shell for a /person navigation — what the emulator's `**` fallback did
// before the `/person/*` rewrite existed.
//
// Without this the emulator proxies the navigation to the DEPLOYED function, which answers
// with PRODUCTION's SPA shell. That shell names production's /assets/index-<hash>.js and a
// freshly built dist/ has a different hash — so the entry bundle is missing. It does not even
// 404: /assets/** falls through hosting's `**` rewrite to index.html, so the module script is
// served 200 as text/html and the browser refuses it on MIME. NO JS runs at all.
//
// The failure is quiet in the worst way. A refused module script raises no uncaught exception,
// so `pageerror` never fires, the errs assertions below stay empty, and every locator simply
// times out against a blank page — the symptom reads as "the section did not render" rather
// than "the app never started". Measured 2026-08-08: the emulator served /person/e2e-person
// with production's index-Bm_mdOqi.js while the local dist/ was index-DPgK6LaA.js.
//
// It is also unstable rather than merely broken: the hashes coincide for exactly as long as
// the deployed bundle matches the local build, so the suite would go green on a checkout of
// whatever was last deployed and red again on the next source change.
//
// Nothing about the function's real behaviour is lost by stubbing it: whether it 301s a
// retired slug or serves the shell is held by functions/person_redirect.test.js, and the
// rewrite's shape by scripts/deploy/firebase_person_rewrite.test.ts. What is under test here
// is what the SPA renders once it boots.
async function serveLocalShell(page: Page) {
  await page.route("**/person/**", async (route) => {
    // Only the navigation; anything else under /person/ goes to its normal handler.
    if (route.request().resourceType() !== "document") return route.fallback();
    // page.request is not itself intercepted, so this cannot recurse.
    const shell = await page.request.get("/");
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: await shell.text(),
    });
  });
}

const pageErrors = (page: Page): string[] => {
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  return errs;
};

test.describe("person declaration sections (D3 smoke)", () => {
  test("render when their endpoint returns data", async ({ page }) => {
    const errs = pageErrors(page);
    await serveLocalShell(page);
    await mockDb(page, {
      "person-profile": PROFILE,
      "person-stake-procurement": STAKE,
      "person-cohort-benchmark": COHORT,
      "person-wealth": WEALTH,
    });
    await page.goto("/person/e2e-person", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("Тестов Човек").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator("#person-stakes")).toBeVisible();
    await expect(page.locator("#person-cohort")).toBeVisible();
    await expect(page.locator("#person-wealth")).toBeVisible();
    expect(errs, errs.join("\n")).toEqual([]);
  });

  test("self-hide when their endpoint returns nothing, page still boots", async ({
    page,
  }) => {
    const errs = pageErrors(page);
    await serveLocalShell(page);
    await mockDb(page, { "person-profile": PROFILE }); // sections default to []
    await page.goto("/person/e2e-person", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("Тестов Човек").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator("#person-stakes")).toHaveCount(0);
    await expect(page.locator("#person-cohort")).toHaveCount(0);
    await expect(page.locator("#person-wealth")).toHaveCount(0);
    expect(errs, errs.join("\n")).toEqual([]);
  });
});

test.describe("/following (D3 smoke)", () => {
  test("renders the site-wide feed when new-filings returns rows", async ({
    page,
  }) => {
    const errs = pageErrors(page);
    await mockDb(page, { "new-filings": FILINGS });
    await page.goto("/following", { waitUntil: "domcontentloaded" });

    await expect(page.locator("#person-events")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole("link", { name: "Иван Тест" }).first(),
    ).toBeVisible();
    expect(errs, errs.join("\n")).toEqual([]);
  });

  test("shows the empty state without throwing when new-filings is empty", async ({
    page,
  }) => {
    const errs = pageErrors(page);
    await mockDb(page, { "new-filings": [] });
    await page.goto("/following", { waitUntil: "domcontentloaded" });

    // The page boots and the site-wide section header renders even with no rows.
    await expect(page.locator("#person-events")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("link", { name: "Иван Тест" })).toHaveCount(0);
    expect(errs, errs.join("\n")).toEqual([]);
  });
});

// A candidacy ROLE does not guarantee an electoral RESULTS row: a roster-only candidacy has
// none, and for a few minutes neither does anybody while person_election_stats is reloaded on
// Cloud SQL. The electoral block reserves ~1450px with a skeleton whenever the person holds a
// candidacy, so that case ends with the reservation collapsing — and every section already
// painted below it jumps up by that much (0.32 measured on /candidate/… in CI, 3x the perf
// budget; 0.26 in this fixture). The dashboard therefore holds the sections below unmounted
// until the block is decided, so the reserved space collapses under nothing.
test.describe("electoral block (CLS)", () => {
  const CANDIDATE_PROFILE = {
    ...PROFILE,
    facets: ["candidate"],
    roles: [
      {
        source: "candidate",
        facet: "candidate",
        sourceLabel: "ЦИК",
        role: "candidate",
        ref: "2024_10_27:c-4-testov-chovek",
        placeKind: null,
        placeCode: null,
        placeLabel: null,
        placeLabelEn: null,
        judicialKind: null,
        confidence: "high",
      },
    ],
    // Rendered straight from the profile, i.e. ON SCREEN while the electoral fetch is still in
    // flight — this is the section that jumped when the reservation collapsed.
    companies: [
      {
        eik: "112028994",
        name: "ТЕСТ КОМПАНИЯ",
        legalForm: "ЕООД",
        seat: "София",
        status: "active",
        roles: ["manager"],
        procuredEur: 0,
        contracts: 0,
        fundsEur: 0,
        fundsPaidEur: 0,
        fundProjects: 0,
        subsidiesEur: 0,
      },
    ],
  };

  test("a candidacy with no results does not collapse the page", async ({
    page,
  }) => {
    await serveLocalShell(page);
    await page.route("**/api/db/**", async (route) => {
      const path = new URL(route.request().url()).pathname.replace(
        "/api/db/",
        "",
      );
      // Land well after first paint, so the reserved block is really on screen before it goes.
      if (path === "person-elections")
        await new Promise((r) => setTimeout(r, 700));
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          path === "person-profile" ? CANDIDATE_PROFILE : [],
        ),
      });
    });
    await page.goto("/person/e2e-person", { waitUntil: "commit" });

    const cls = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let total = 0;
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) {
              const ls = e as PerformanceEntry & {
                hadRecentInput?: boolean;
                value?: number;
              };
              if (!ls.hadRecentInput && typeof ls.value === "number")
                total += ls.value;
            }
          }).observe({ type: "layout-shift", buffered: true });
          setTimeout(() => resolve(total), 2500);
        }),
    );

    // The block itself is gone (no results) and the sections below it did arrive.
    await expect(page.locator("#person-electoral")).toHaveCount(0);
    await expect(page.locator("#person-business")).toBeVisible();
    expect(cls, `CLS=${cls.toFixed(4)}`).toBeLessThan(0.1);
  });
});
