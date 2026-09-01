// Home COMPOSITION gate — how cards of different kinds compose into a page.
//
// `story-cards.spec.ts` proves an individual card is sound. This proves the
// page is: row geometry, section fill, and the agreement of DOM, visual and
// focus order. v3 could be correct at card level while the shipped page looked
// broken precisely because nothing measured this layer.
//
// ⚠️ THE OBVIOUS ASSERTION IS THE WRONG ONE. "Card tops and bottoms align
// within one CSS pixel" is satisfied by stretching every card to its row — the
// option the plan rejects as cosmetic, because it moves the blank band from
// between the cards to inside them. So this file measures BOTH sides:
//
//   rowVoid      = row bottom - card bottom      → catches today's defect
//   contentSlack = card bottom - content bottom  → catches the stretch "fix"
//
// A layout can only satisfy both by making an image-led card and a text card
// close to the same height, which is what the side-thumbnail anatomy is for.
//
// Every check here is an ENFORCED bound. Five of them were written as
// `test.fail()` while the defects were live — measured 2026-09-01, a 336px row
// void on `today`, 110px of intra-card slack on `all-images`, a 2.33x height
// ratio, three sections reserving tracks they had no card for, and 7 inverted
// headline positions. Playwright fails a `test.fail()` test that starts
// passing, so the side-thumbnail commit was forced to remove each annotation
// rather than being able to leave one rotting.
//
// ⚠️ Keep that mechanism in mind before adding a new one: `test.fail()` checks
// THAT a test fails, never WHY. A 404 fixture, a renamed class, a NaN
// comparison, a hung wait or a dead dev server all satisfy it exactly as a real
// defect does. `open()` asserting which scenario rendered and how many cards it
// holds is what makes that survivable, and it earns its keep whether or not any
// annotation is currently in use.

import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import {
  EXPECTED_CARDS,
  MIXED_KIND_SCENARIOS,
  SCENARIO_NAMES as SCENARIOS,
  type ScenarioName,
} from "../../newsapp/test-fixtures/home-grid.scenarios";

const FIXTURE = "/test-fixtures/home-grid.html";
const VIEWPORTS = [320, 390, 768, 1024, 1440] as const;
const REFERENCE_DIR = path.resolve(
  "docs/references/news-home-editorial-grid-v4",
);

/** Card padding is 1rem, so ~17px of slack is structural. 32 leaves headroom. */
const SLACK_PX = 32;
/** A thumbnail may enrich a card; it may not inflate the page. */
const MAX_HEIGHT_RATIO = 1.25;
/** Largest vertical gap allowed BETWEEN a card's content blocks. */
const INTERIOR_GAP_PX = 200;
/** Rows are grouped by tolerance, not equality — see `rowsOf`. */
const ROW_EPSILON_PX = 4;

interface CardMetric {
  section: string;
  index: number;
  top: number;
  left: number;
  bottom: number;
  height: number;
  contentBottom: number;
  /** Largest vertical gap between two consecutive content blocks. */
  largestGap: number;
  /**
   * Whether the card renders an image BLOCK — not whether a photo loaded.
   * `ArticleImage` emits a <figure> on every rung of its fallback ladder,
   * including the monogram. In `compact` this is false for every card:
   * `StoryCard` gates the block on `!compact`, so compact is a zero-image
   * scenario whatever the fixture's `imageAt` says.
   */
  hasImageBlock: boolean;
}

const open = async (page: Page, scenario: ScenarioName, width = 1440) => {
  await page.setViewportSize({ width, height: 1200 });
  await page.goto(`${FIXTURE}?scenario=${scenario}`);
  await expect(page.locator(".news-story-card").first()).toBeVisible();
  // Prove which page we are on BEFORE measuring it. The fixture refuses an
  // unknown name, but a scenario renamed on one side only would still leave
  // the spec asking for a page that no longer exists — and `test.fail()`
  // cannot tell a missing scenario from the documented defect.
  await expect(page.locator("[data-fixture-scenario]")).toHaveAttribute(
    "data-fixture-scenario",
    scenario,
  );
  await expect(page.locator(".news-story-card")).toHaveCount(
    EXPECTED_CARDS[scenario],
  );
  // No image wait: `ArticleImage` renders into a fixed `aspect-[16/10]` box, so
  // row geometry does not depend on decode. Measured 2026-09-01, every fixture
  // image is already `complete` at this point anyway — and a wait on a lazily
  // loaded image below the fold would never resolve, which `test.fail()` would
  // then absorb as the expected failure.
};

/**
 * Cards inside a fixture section. The LEAD is deliberately excluded: it is a
 * different anatomy (a 5-column media/body split, not a grid cell), so its
 * height is not comparable to a story card's and it belongs to no row. The
 * headline-order check does include it, because reading order spans the page.
 */
const cardMetrics = (page: Page): Promise<CardMetric[]> =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>("[data-fixture-section]"),
    ].flatMap((grid) =>
      [...grid.querySelectorAll<HTMLElement>(".news-story-card")].map(
        (card, index) => {
          const rect = card.getBoundingClientRect();
          const body = card.querySelector(".news-card-body");
          // The LAST element child is the real bottom of the rendered content.
          // No fallback to `body` itself: it is `flex-1`, so it stretches with
          // the card and would report the card's own bottom — making the
          // stretch "fix" look perfect, which is the exact failure this metric
          // exists to catch. NaN fails loudly instead.
          const last = body?.lastElementChild;
          // Consecutive rendered blocks, in VISUAL order — the figure is
          // `display: contents`, so its image and caption are separate grid
          // items placed away from their DOM position.
          const boxes = [...(body?.children ?? [])]
            .flatMap((child) =>
              child.tagName === "FIGURE" ? [...child.children] : [child],
            )
            .map((child) => child.getBoundingClientRect())
            .filter((box) => box.height > 0)
            .sort((a, b) => a.top - b.top);
          const largestGap = boxes
            .slice(1)
            .reduce(
              (worst, box, index) =>
                Math.max(worst, box.top - boxes[index].bottom),
              0,
            );
          return {
            largestGap,
            section: grid.dataset.fixtureSection ?? "",
            index,
            top: rect.top,
            left: rect.left,
            bottom: rect.bottom,
            height: rect.height,
            contentBottom: last
              ? last.getBoundingClientRect().bottom
              : Number.NaN,
            hasImageBlock: card.querySelector("figure") !== null,
          };
        },
      ),
    ),
  );

/**
 * Group a section's cards into visual rows. Tolerance, not equality: two cards
 * in one row whose tops differ by a subpixel would otherwise become two
 * single-card rows, for which the void is 0 — passing the check vacuously, and
 * under `test.fail()` reporting "the layout is fixed" when it is not.
 */
const rowsOf = (cards: CardMetric[]): CardMetric[][] => {
  const rows: CardMetric[][] = [];
  for (const card of [...cards].sort((a, b) => a.top - b.top)) {
    const row = rows.find(
      (candidate) =>
        candidate[0].section === card.section &&
        Math.abs(candidate[0].top - card.top) <= ROW_EPSILON_PX,
    );
    if (row) row.push(card);
    else rows.push([card]);
  }
  return rows;
};

const trackCount = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-fixture-section]")].map(
      (grid) => ({
        section: grid.dataset.fixtureSection ?? "",
        cards: grid.querySelectorAll(".news-story-card").length,
        // ⚠️ `getComputedStyle` reports USED track sizes, and an auto-fit grid
        // reports a collapsed empty track as `0px` rather than omitting it —
        // so a one-card section reads "1312px 0px". Counting those would
        // report a reserved track that does not exist and no card occupies.
        tracks: getComputedStyle(grid)
          .gridTemplateColumns.split(" ")
          .filter((track) => track && Number.parseFloat(track) > 0).length,
      }),
    ),
  );

test.describe("home composition", () => {
  // Each test walks the whole matrix, and the FIRST navigation of a run pays
  // Vite's cold transform of the fixture's component graph — measured 22.9 s,
  // uncomfortably close to the 30 s default. A timeout is not silently
  // absorbed by `test.fail()` (Playwright reports it as a real failure), so an
  // under-budgeted run goes red for a reason that has nothing to do with the
  // layout.
  test.describe.configure({ timeout: 120_000 });

  // ── Currently failing: the defects this plan exists to fix ──────────────

  test("a section never reserves a track it has no card for", async ({
    page,
  }) => {
    for (const scenario of SCENARIOS) {
      await open(page, scenario);
      for (const grid of await trackCount(page))
        expect(
          grid.tracks,
          `${scenario} · section "${grid.section}" holds ${grid.cards} card(s)`,
        ).toBeLessThanOrEqual(grid.cards);
    }
  });

  test("no card ends far above its own row", async ({ page }) => {
    for (const scenario of SCENARIOS) {
      await open(page, scenario);
      for (const row of rowsOf(await cardMetrics(page))) {
        const rowBottom = Math.max(...row.map((card) => card.bottom));
        for (const card of row)
          expect(
            rowBottom - card.bottom,
            `${scenario} · ${card.section}[${card.index}] leaves a void above the next row`,
          ).toBeLessThanOrEqual(SLACK_PX);
      }
    }
  });

  test("media does not inflate the page", async ({ page }) => {
    // ⚠️ THE PER-CARD RATIO IS SATURATED AND CANNOT BE USED. Every card now
    // stretches to its grid row, so `imageCard.height / textCard.height` is
    // pinned to exactly 1.000 whatever the media does — it would report a
    // perfect score for a full-width 16:10 block returning tomorrow.
    //
    // This measures the same property where nothing confounds it: `today`,
    // `all-images` and `no-images` render the SAME sections with the SAME
    // text and differ only in which cards carry an image. So the height of
    // the standard section is a direct read on what media costs the layout.
    const sectionHeight = async (scenario: ScenarioName) => {
      await open(page, scenario);
      return page
        .locator('[data-fixture-section="standard"]')
        .evaluate((grid) => grid.getBoundingClientRect().height);
    };
    const none = await sectionHeight("no-images");
    for (const scenario of ["today", "all-images"] as const)
      expect(
        (await sectionHeight(scenario)) / none,
        `${scenario}: media must change a card's richness, not the page's height`,
      ).toBeLessThanOrEqual(MAX_HEIGHT_RATIO);
  });

  test("no card's content floats in a void", async ({ page }) => {
    // The guard against "align the bottoms and leave the space inside the
    // card" — the rejected option, which satisfies every bottom-alignment
    // assertion while leaving the page just as sparse.
    //
    // ⚠️ TWO measurements, because either alone is now blind. The residue
    // BELOW the last content block is a structural 17px (the card's own
    // padding) once the footer is bottom-aligned, so on its own it would pass
    // a card carrying a 119px hole higher up — larger than the 110px defect
    // this check was written to catch. The largest INTERIOR gap sees that
    // hole; the residue below still catches a footer that stops floating to
    // the bottom. The interior ceiling is a regression tripwire for the 320px+
    // holes a media block used to produce, not a design target: the gap a
    // bottom-aligned footer absorbs is text variance, deliberately.
    for (const scenario of SCENARIOS) {
      await open(page, scenario);
      for (const card of await cardMetrics(page)) {
        expect(
          card.bottom - card.contentBottom,
          `${scenario} · ${card.section}[${card.index}] stretches past its content`,
        ).toBeLessThanOrEqual(SLACK_PX);
        expect(
          card.largestGap,
          `${scenario} · ${card.section}[${card.index}] leaves a hole between its blocks`,
        ).toBeLessThanOrEqual(INTERIOR_GAP_PX);
      }
    }
  });

  test("headlines are read in the order they are written", async ({ page }) => {
    // A stronger reading of "visual order matches DOM order" than the card
    // check below: what a sighted reader scans is the HEADLINE, and a
    // full-width media block pushes its own headline below the headlines of
    // the text cards beside it.
    //
    // Measured 2026-09-01 on `today`: the image card at standard[1] reads
    // third in a row where the DOM puts it first — 7 inverted positions
    // across 3 rows (standard 1-2, 6-8, 10-11). The side-thumbnail anatomy
    // fixes it by returning every headline to the top of its card.
    for (const scenario of SCENARIOS) {
      await open(page, scenario);
      const links = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(".news-story-link")].map(
          (link) => {
            const rect = link.getBoundingClientRect();
            return {
              href: link.getAttribute("href") ?? "",
              top: rect.top,
              left: rect.left,
            };
          },
        ),
      );
      // ⚠️ BUCKET, then sort on the bucket. A comparator that inspects the
      // tolerance itself is NOT TRANSITIVE — with tops 0, 3 and 6 it calls the
      // first two equal, the last two equal, and the outer pair ordered — and
      // `Array.sort` on a non-transitive comparator gives an
      // implementation-defined result rather than a wrong-but-stable one.
      // The bucketing exists because headlines in one row can differ by a
      // pixel or two when the meta rows above them round differently; measured
      // after the thumbnail landed, the largest real within-row difference is
      // 2px.
      const rowIndex = (top: number) => Math.round(top / (ROW_EPSILON_PX * 2));
      const visual = [...links].sort(
        (a, b) => rowIndex(a.top) - rowIndex(b.top) || a.left - b.left,
      );
      expect(
        visual.map((link) => link.href),
        `${scenario}: headline order must match DOM order`,
      ).toEqual(links.map((link) => link.href));
    }
  });

  // ── Currently passing: protect these while the layout is rebuilt ────────

  test("the matrix still contains rows with both card kinds", async ({
    page,
  }) => {
    // Without this, "no ratio to check" could silently become every scenario
    // and the height-ratio check would assert nothing at all.
    const mixed: ScenarioName[] = [];
    for (const scenario of SCENARIOS) {
      await open(page, scenario);
      const cards = await cardMetrics(page);
      if (
        cards.some((card) => card.hasImageBlock) &&
        cards.some((card) => !card.hasImageBlock)
      )
        mixed.push(scenario);
    }
    expect(mixed).toEqual([...MIXED_KIND_SCENARIOS]);
  });

  test("a text-first card keeps its full width on a narrow phone", async ({
    page,
  }) => {
    // ⚠️ 14 of 16 live stories are text-first, and this is the shape that
    // broke: a narrow-viewport rule once re-declared the base grid AFTER the
    // single-column variant at equal specificity, so a text card got two
    // columns while its areas named one — headline, credit and footer all in a
    // 72px track with 184px empty beside them, at 320px and 360px. Nothing saw
    // it, because `overflow-hidden` plus `min-w-0` CLIP rather than overflow,
    // so the reflow check stayed green. The media column is opt-in now; this
    // is what proves it stays that way.
    for (const width of [320, 360, 390] as const) {
      await open(page, "no-images", width);
      const worst = await page.evaluate(() => {
        const cards = [
          ...document.querySelectorAll<HTMLElement>(".news-card-body"),
        ];
        return Math.min(
          ...cards.map((body) => {
            const headline = body.querySelector(".news-card-headline");
            if (!headline) return 1;
            return (
              headline.getBoundingClientRect().width /
              body.getBoundingClientRect().width
            );
          }),
        );
      });
      // A text card has no media column, so its headline spans the body less
      // the card's own padding — never a fraction of it.
      expect(
        worst,
        `${width}px: headline share of the card body`,
      ).toBeGreaterThan(0.8);
    }
  });

  test("cards are laid out in the order they are written", async ({ page }) => {
    for (const scenario of SCENARIOS) {
      await open(page, scenario);
      const cards = await cardMetrics(page);
      const visual = [...cards].sort(
        (a, b) => a.top - b.top || a.left - b.left,
      );
      expect(
        visual.map((card) => `${card.section}[${card.index}]`),
        `${scenario}: visual order must match DOM order`,
      ).toEqual(cards.map((card) => `${card.section}[${card.index}]`));
    }
  });

  test("the composition reflows without horizontal scroll", async ({
    page,
  }) => {
    for (const scenario of SCENARIOS) {
      for (const width of VIEWPORTS) {
        await open(page, scenario, width);
        expect(
          await page.evaluate(() => ({
            document: document.documentElement.scrollWidth,
            viewport: document.documentElement.clientWidth,
          })),
          `${scenario} at ${width}px must not scroll horizontally`,
        ).toEqual({ document: width, viewport: width });
      }
      // 720 CSS pixels is a 1440px window at 200% zoom.
      await open(page, scenario, 720);
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
        `${scenario} at the 200% zoom equivalent must not scroll horizontally`,
      ).toBe(true);
    }
  });

  test("the composition remains captureable", async ({ page }) => {
    for (const scenario of SCENARIOS) {
      await open(page, scenario);
      if (process.env.UPDATE_NEWS_HOME_REFS === "1") {
        await fs.mkdir(REFERENCE_DIR, { recursive: true });
        await page.screenshot({
          path: path.join(REFERENCE_DIR, `${scenario}-1440.png`),
          fullPage: true,
        });
      }
    }
  });
});
