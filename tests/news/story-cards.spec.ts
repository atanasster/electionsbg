import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const FIXTURE = "/test-fixtures/story-cards.html";
const VIEWPORTS = [320, 390, 768, 1024, 1440] as const;
const REFERENCE_DIR = path.resolve("docs/references/news-story-cards-v3");

test("story cards preserve responsive, focus and motion contracts", async ({
  page,
}) => {
  await page.goto(FIXTURE);

  for (const width of VIEWPORTS) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".news-story-card")).toHaveCount(5);
    expect(
      await page.evaluate(() => ({
        document: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
      })),
      `${width}px viewport must not scroll horizontally`,
    ).toEqual({ document: width, viewport: width });

    const sourceVisibility = await page
      .locator(".news-story-sources")
      .first()
      .evaluate((source) => ({
        mobile: getComputedStyle(
          source.querySelector(".sm\\:hidden") as Element,
        ).display,
        desktop: getComputedStyle(
          source.querySelector(".hidden.sm\\:inline") as Element,
        ).display,
      }));
    expect(sourceVisibility.mobile === "none").toBe(width >= 640);
    expect(sourceVisibility.desktop === "none").toBe(width < 640);
  }

  // ⚠️ NO HEIGHT ASSERTION HERE, deliberately. This file owns per-card
  // contracts — overflow, focus, motion, dark surfaces. Height is a
  // COMPOSITION property and belongs to `tests/news/home-grid.spec.ts`, which
  // groups cards into rows before comparing them and enforces both bounds that
  // matter: an image-led card at most 1.25x a text card, and no card's content
  // ending more than 32px above its own bottom.
  //
  // Two successive attempts to keep a height guard here were unsound, and the
  // reason generalises. `textCardHeight < imageCardHeight` compared cards that
  // differed in `kind` as well as media, so it measured the spectrum block, not
  // the image. Comparing the SAME story with and without media fixed that and
  // was still wrong: the two fixtures land in different auto-fit grid rows, and
  // a grid stretches cards to their own row's height — so the numbers describe
  // which row a card happens to occupy. Measured 2026-09-02: 246.3px for both
  // cards in row 0 and 264.7px in row 1, including the image-led card being
  // 18.4px SHORTER than the same story without media.

  // Browser zoom to 200% halves a 1440px window to a 720 CSS-pixel reflow
  // viewport. This exercises the same layout contract without depending on a
  // browser-family-specific keyboard shortcut.
  await page.setViewportSize({ width: 720, height: 900 });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
    "200% zoom equivalent must not scroll horizontally",
  ).toBe(true);

  const storyLink = page.locator(".news-story-link").first();
  await storyLink.focus();
  expect(
    await storyLink.evaluate((link) => getComputedStyle(link).boxShadow),
  ).not.toBe("none");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await storyLink.hover();
  const reducedMotion = await page
    .locator(".news-story-card")
    .first()
    .evaluate((card) => ({
      duration: getComputedStyle(card).transitionDuration,
      transform: getComputedStyle(card).transform,
    }));
  expect(
    reducedMotion.duration
      .split(",")
      .every((duration) => Number.parseFloat(duration) <= 0.00001),
  ).toBe(true);
  expect(reducedMotion.transform).toBe("none");

  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto(`${FIXTURE}?dark`);
  const darkSurfaces = await page.evaluate(() => ({
    shell: getComputedStyle(document.querySelector(".news-shell")!)
      .backgroundColor,
    card: getComputedStyle(document.querySelector(".news-story-card")!)
      .backgroundColor,
  }));
  expect(darkSurfaces.shell).not.toBe(darkSurfaces.card);
});

test("reference cards remain captureable", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(FIXTURE);
  const references = [
    "image-led-multi-source",
    "image-led-single-source",
    "text-first-multi-source",
    "text-only-same-story",
    "long-content-fallback-source",
  ] as const;

  for (const name of references) {
    const card = page.getByTestId(name).locator(".news-story-card");
    await expect(card).toBeVisible();
    if (process.env.UPDATE_NEWS_CARD_REFS === "1") {
      await fs.mkdir(REFERENCE_DIR, { recursive: true });
      await card.screenshot({ path: path.join(REFERENCE_DIR, `${name}.png`) });
    }
  }
});
