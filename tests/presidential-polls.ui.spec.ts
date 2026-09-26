import fs from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { campaignObservations } from "../src/data/presidential/pollHistory";
import type {
  Poll,
  PresidentialPollDetail,
} from "../src/data/polls/pollsTypes";

const dataRoot = path.resolve("data");
const polls: Poll[] = JSON.parse(
  await fs.readFile(
    path.join(dataRoot, "polls/presidential/polls.json"),
    "utf8",
  ),
);
const details: PresidentialPollDetail[] = JSON.parse(
  await fs.readFile(
    path.join(dataRoot, "polls/presidential/polls_details.json"),
    "utf8",
  ),
);
test.beforeEach(async ({ page }) => {
  // Exercise the built client against the reviewed corpus before publication.
  await page.route(
    "https://storage.googleapis.com/data-electionsbg-com/**",
    async (route) => {
      const relative = new URL(route.request().url()).pathname.replace(
        "/data-electionsbg-com/",
        "",
      );
      try {
        await route.fulfill({
          body: await fs.readFile(path.join(dataRoot, relative)),
          contentType: "application/json",
        });
      } catch {
        await route.fulfill({ status: 404, body: "Missing local fixture" });
      }
    },
  );
  await page.route("**/api/db/**", (route) => route.fulfill({ json: {} }));
});

for (const language of ["bg", "en"]) {
  test(`${language}: presidential-only agency, question separation and responsive layout`, async ({
    page,
  }, testInfo) => {
    await page.goto(`${language === "en" ? "/en" : ""}/polls/GM/presidential`);
    const root = page.locator("#root");
    await expect(root.getByRole("heading", { level: 1 })).toContainText(
      language === "bg" ? "Глобал Метрикс" : "Global Metrics",
    );
    await expect(root.locator("article section")).toHaveCount(2);
    await expect(
      root.getByRole("button", { name: "JSON", exact: true }),
    ).toBeVisible();
    expect(await root.innerText()).not.toMatch(/pp_(history|insight|reason)_/);
    for (const theme of ["corporate", "sunset"]) {
      await page.evaluate((theme) => {
        localStorage.setItem("theme", theme);
      }, theme);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(
        root.getByRole("button", { name: "JSON", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`${language}-${theme}.png`),
        fullPage: true,
      });
    }
  });
}

test("filters, chart/table agreement, keyboard access and provenance downloads", async ({
  page,
}, testInfo) => {
  await page.goto(
    "/en/polls/SH/presidential?pollCycle=2021_11_14_pvr&pollRound=1&keep=1",
  );
  const root = page.locator("#root");
  const table = root.getByRole("table", {
    name: "All displayed observations",
    exact: true,
  });
  const expected = campaignObservations(
    polls.filter((p) => p.agencyId === "SH" && p.cycle === "2021_11_14_pvr"),
    details,
    1,
  );
  await expect(table.locator("tbody tr")).toHaveCount(expected.length);
  const campaign = table.locator("..").locator("..");
  for (const theme of ["corporate", "sunset"]) {
    await page.evaluate((theme) => localStorage.setItem("theme", theme), theme);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(campaign.locator(".recharts-scatter-symbol")).toHaveCount(
      expected.length,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await campaign.screenshot({
      path: testInfo.outputPath(`campaign-${theme}.png`),
    });
  }
  for (const observation of expected) {
    const row = table
      .locator("tbody tr")
      .filter({ hasText: observation.date })
      .filter({ hasText: observation.detail.candidateName_bg });
    await expect(row).toContainText(
      observation.detail.support.toFixed(1) + "%",
    );
  }
  const candidate = root.getByLabel("Candidate", { exact: true });
  await candidate.selectOption(expected[0].detail.candidateKey);
  await expect(page).toHaveURL(/pollCandidate=/);
  await page.reload();
  await expect(candidate).toHaveValue(expected[0].detail.candidateKey);
  await candidate.focus();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe(
    "BODY",
  );
  for (const format of ["JSON", "CSV"]) {
    const downloadPromise = page.waitForEvent("download");
    await root.getByRole("button", { name: format, exact: true }).click();
    const download = await downloadPromise;
    const contents = await fs.readFile((await download.path())!, "utf8");
    if (format === "JSON") {
      const exported = JSON.parse(contents);
      expect(exported.round).toBe(1);
      expect(exported.candidate).toBe(expected[0].detail.candidateKey);
      expect(exported.details.length).toBeGreaterThan(0);
      expect(
        exported.details.every(
          (d: PresidentialPollDetail) => d.candidateKey === exported.candidate,
        ),
      ).toBe(true);
      expect(
        exported.polls.every(
          (p: Poll) => p.source.startsWith("https://") && p.agencyId === "SH",
        ),
      ).toBe(true);
    } else {
      expect(contents).toContain("source");
      expect(contents).toContain("question_id");
      expect(contents).toContain("https://");
    }
  }
  await root.getByLabel("Round", { exact: true }).selectOption("2");
  await expect(page).toHaveURL(/pollRound=2/);
  await expect(page).toHaveURL(/keep=1/);
  await expect(
    root.getByRole("table", { name: "Runoff matchup matrix", exact: true }),
  ).toContainText("67.0% / 33.0%");
});

test("election round two and explicit no-coverage state", async ({ page }) => {
  await page.goto("/en/presidential/2016_11_06_pvr?pollRound=2");
  const section = page.locator("#presidential-polls");
  await expect(
    section.getByRole("table", {
      name: "All displayed observations",
      exact: true,
    }),
  ).toContainText("49.6%");
  await expect(section).toContainText("39.1%");
  await expect(section).toContainText("11.3%");
  await page.goto("/en/presidential/2001_11_11_pvr");
  await expect(page.locator("#presidential-polls")).toContainText(
    "No accepted",
  );
  await expect(
    page
      .locator("#presidential-polls summary")
      .filter({ hasText: "Coverage and methodology" }),
  ).toBeVisible();
});

test("failed data fetch offers a working retry", async ({ page }) => {
  let fail = true;
  await page.route("**/polls/presidential/polls.json", async (route) => {
    if (fail) await route.fulfill({ status: 503, body: "Unavailable" });
    else await route.fulfill({ json: polls });
  });
  await page.goto("/en/polls/GM/presidential");
  const retry = page
    .locator("#root")
    .getByRole("button", { name: "Retry", exact: true });
  await expect(retry).toBeVisible({ timeout: 20000 });
  fail = false;
  await retry.click();
  await expect(
    page.locator("#root").getByRole("button", { name: "JSON", exact: true }),
  ).toBeVisible();
});
