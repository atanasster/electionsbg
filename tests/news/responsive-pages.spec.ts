import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const VIEWPORTS = [320, 375, 390, 768, 1024, 1440] as const;

const readBundle = <T>(file: string): T =>
  JSON.parse(fs.readFileSync(path.resolve("news/app-data", file), "utf8")) as T;

const stories = readBundle<{ stories: Array<{ id: string }> }>("stories.json");
const outlets = readBundle<{ outlets: Array<{ domain: string }> }>(
  "outlets.json",
);
const latest = readBundle<{
  articles: Array<{ id: string; domain: string; analysis?: unknown }>;
}>("latest.json");
const evalQueue = readBundle<{
  tasks: Array<{ article_id: string; domain: string }>;
}>("evals/queue.json");

const story = stories.stories[0];
const outlet = outlets.outlets[0];
const article = latest.articles.find((candidate) => candidate.analysis);
const evalTask = evalQueue.tasks[0];

if (!story || !outlet || !article || !evalTask) {
  throw new Error(
    "News responsive tests require representative generated data",
  );
}

const ROUTES = [
  { name: "home", path: "/" },
  { name: "story", path: `/story/${encodeURIComponent(story.id)}` },
  { name: "outlets", path: "/outlets" },
  {
    name: "outlet",
    path: `/outlet/${encodeURIComponent(outlet.domain)}`,
  },
  { name: "topics", path: "/topics" },
  {
    name: "article",
    path: `/article/${encodeURIComponent(article.domain)}/${encodeURIComponent(article.id)}`,
  },
  { name: "methodology", path: "/methodology" },
  { name: "saved", path: "/saved" },
  { name: "about", path: "/about" },
  { name: "corrections", path: "/corrections" },
  { name: "evals", path: "/evals" },
  {
    name: "eval article",
    path: `/evals/article/${encodeURIComponent(evalTask.domain)}/${encodeURIComponent(evalTask.article_id)}`,
  },
  { name: "not found", path: "/responsive-test-not-found" },
] as const;

const settlePage = async (page: Page) => {
  await expect(page.locator("#news-main")).toBeVisible();
  await page
    .locator("#news-main .animate-pulse")
    .first()
    .waitFor({ state: "detached", timeout: 5_000 })
    .catch(() => undefined);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
};

const shellMetrics = (page: Page) =>
  page.evaluate(() => {
    const visibleRects = (selector: string) =>
      [...document.querySelectorAll<HTMLElement>(selector)]
        .filter((element) => getComputedStyle(element).display !== "none")
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            height: rect.height,
          };
        });
    const bounds = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        height: rect.height,
      };
    };

    return {
      document: {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      },
      body: {
        clientWidth: document.body.clientWidth,
        scrollWidth: document.body.scrollWidth,
      },
      main: bounds("#news-main"),
      masthead: bounds(".news-masthead"),
      footerLinks: bounds(".news-footer-links"),
      footerLinkRects: visibleRects(".news-footer-link"),
    };
  });

const expectBoundedTargets = (
  bounds: {
    clientWidth: number;
    scrollWidth: number;
    left: number;
    right: number;
  },
  rects: Array<{ left: number; right: number; top: number; height: number }>,
  minimumHeight: number,
) => {
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth + 1);
  for (const rect of rects) {
    expect(rect.left).toBeGreaterThanOrEqual(bounds.left - 1);
    expect(rect.right).toBeLessThanOrEqual(bounds.right + 1);
    expect(rect.height).toBeGreaterThanOrEqual(minimumHeight);
  }
};

for (const width of VIEWPORTS) {
  test(`all news routes fit the ${width}px viewport`, async ({ page }) => {
    const viewportHeight = width === 375 ? 812 : 900;
    await page.setViewportSize({ width, height: viewportHeight });

    for (const route of ROUTES) {
      await test.step(route.name, async () => {
        await page.goto(route.path);
        await settlePage(page);

        const metrics = await shellMetrics(page);
        expect(
          metrics.document.scrollWidth,
          `${route.path} document overflow at ${width}px`,
        ).toBeLessThanOrEqual(metrics.document.clientWidth + 1);
        expect(
          metrics.body.scrollWidth,
          `${route.path} body overflow at ${width}px`,
        ).toBeLessThanOrEqual(metrics.body.clientWidth + 1);
        expect(metrics.main).not.toBeNull();
        expect(metrics.main!.scrollWidth).toBeLessThanOrEqual(
          metrics.main!.clientWidth + 1,
        );

        expect(metrics.footerLinks).not.toBeNull();
        expectBoundedTargets(
          metrics.footerLinks!,
          metrics.footerLinkRects,
          width < 640 ? 44 : 32,
        );

        if (width < 640) {
          expect(metrics.masthead).not.toBeNull();
          expect(metrics.masthead!.height).toBeLessThanOrEqual(56);
        }

        if (route.path === "/" && width < 1024) {
          await expect(
            page.getByRole("link", { name: "Търсене в новините" }),
          ).toHaveAttribute("href", "/#news-search");
          await expect(
            page.getByRole("button", { name: "Отвори менюто" }),
          ).toBeVisible();
        }

        if (route.path === "/" && width === 375) {
          const firstHeadline = page.locator(".news-story-heading").first();
          await expect(firstHeadline).toBeVisible();
          const firstHeadlineBox = await firstHeadline.boundingBox();
          expect(firstHeadlineBox).not.toBeNull();
          expect(firstHeadlineBox!.y).toBeLessThan(viewportHeight);
        }

        if (route.path === "/" && width < 1024) {
          const mastheadBox = await page
            .locator(".news-masthead")
            .boundingBox();
          const searchLink = page.getByRole("link", {
            name: "Търсене в новините",
          });
          const searchbox = page.getByRole("searchbox", { name: "Търсене" });
          await searchLink.click();
          await expect(searchbox).toBeFocused();
          const searchboxBox = await searchbox.boundingBox();
          expect(mastheadBox).not.toBeNull();
          expect(searchboxBox).not.toBeNull();
          expect(searchboxBox!.y).toBeGreaterThanOrEqual(
            mastheadBox!.y + mastheadBox!.height,
          );
        }
      });
    }
  });
}
