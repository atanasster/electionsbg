// Smoke coverage for the DB-backed person surfaces (audit gap D3).
//
// These sections all SELF-HIDE when their endpoint returns no data, so a broken fetch or a
// thrown render is indistinguishable from "this person has nothing to show" — the exact
// failure the component tests can't see end-to-end. The Firebase hosting emulator serves the
// static build with no /api/db backend, so we mock the endpoints with page.route and assert
// the render path both ways: data present → the section renders; data absent → it self-hides
// while the page still boots. Section presence is checked by DashboardSection's stable DOM
// id, not localized copy.

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

const pageErrors = (page: Page): string[] => {
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  return errs;
};

test.describe("person declaration sections (D3 smoke)", () => {
  test("render when their endpoint returns data", async ({ page }) => {
    const errs = pageErrors(page);
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
