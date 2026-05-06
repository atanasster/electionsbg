// Capture every screenshot used by the MP business-connections article.
// Run once after a connections-data refresh to keep the article images in
// sync with the live UI:
//
//   npx tsx scripts/capture-mp-connections-tile.ts
//
// Requires the Vite dev server running on http://localhost:5173.
//
// Each shot is keyed off a unique element on the page (a heading text or a
// data-testid) so layout reshuffles don't silently capture the wrong card.
// Locale is forced to English via localStorage so labels in the screenshots
// match the English copy of the article.
import { chromium, Page, BrowserContext, Locator } from "playwright";
import path from "path";

const OUT_DIR = path.resolve("public/articles/images/connections");
const BASE = "http://localhost:5173";

type Shot = {
  /** Output filename (under OUT_DIR). */
  file: string;
  /** Path to navigate to before the shot. */
  url: string;
  /** What to capture: a card by its heading regex, the full viewport, or a
   * specific locator. The card mode walks up to the nearest `rounded-xl`
   * ancestor so the whole tile/card is in the shot. */
  capture:
    | { kind: "card-by-heading"; heading: RegExp }
    | { kind: "viewport" }
    | { kind: "locator"; selector: string };
  /** Optional setup steps (e.g. toggle a checkbox) that run after the page
   * settles but before the screenshot is taken. */
  setup?: (page: Page) => Promise<void>;
  /** How many ms to wait after navigation before capturing — d3-force charts
   * need ~3.5s for the simulation to look stable. Defaults to 800ms. */
  settleMs?: number;
};

const SHOTS: Shot[] = [
  {
    file: "01-dashboard-tile.png",
    url: "/",
    capture: {
      // Match by the tile's "All companies →" footer link — that combination
      // of card title + footer is unique to the StatCard. Matching only the
      // title would also pick up the related-analysis card whose article
      // title also contains "MP business connections".
      kind: "locator",
      selector:
        "div.rounded-xl:has-text('MP business connections'):has-text('All companies')",
    },
    settleMs: 1500,
  },
  {
    file: "02-sofia-region-tile.png",
    url: "/sofia",
    capture: {
      kind: "locator",
      selector: "div.rounded-xl:has-text('Most connected MPs in region')",
    },
    settleMs: 1500,
  },
  {
    file: "03-candidate-declarations.png",
    url: `/candidate/${encodeURIComponent("Димитър Георгиев Найденов")}`,
    // The card heading on the candidate page is "Business interests" (the
    // article calls the section "Financial declarations" editorially).
    capture: {
      kind: "card-by-heading",
      heading: /Business interests|Бизнес интереси/,
    },
    settleMs: 1500,
  },
  {
    file: "04-candidate-management.png",
    url: `/candidate/${encodeURIComponent("Димитър Георгиев Найденов")}`,
    capture: {
      kind: "card-by-heading",
      heading: /Management roles|Управленски роли/,
    },
    settleMs: 1500,
  },
  {
    file: "05-candidate-mini-graph.png",
    url: `/candidate/${encodeURIComponent("Димитър Георгиев Димитров")}`,
    capture: {
      kind: "card-by-heading",
      heading: /Connections to other MPs|Връзки с други депутати/,
    },
    settleMs: 3500,
  },
  {
    file: "06-orbital-default.png",
    url: "/connections?ns=52",
    capture: {
      kind: "card-by-heading",
      heading: /Explore graph|Разглеждане на графа/,
    },
    settleMs: 3500,
  },
  {
    file: "07-orbital-cluster-by-party.png",
    url: "/connections?ns=52",
    capture: {
      kind: "card-by-heading",
      heading: /Explore graph|Разглеждане на графа/,
    },
    setup: async (page) => {
      await toggleCheckbox(page, /Cluster by party|Групирай по партия/);
    },
    settleMs: 4500,
  },
  {
    file: "08-orbital-largest-component.png",
    url: "/connections?ns=52",
    capture: {
      kind: "card-by-heading",
      heading: /Explore graph|Разглеждане на графа/,
    },
    setup: async (page) => {
      await toggleCheckbox(
        page,
        /Largest component only|Само най-големия компонент/,
      );
    },
    settleMs: 4500,
  },
  {
    file: "09-all-companies.png",
    url: "/mp/companies",
    capture: { kind: "viewport" },
    settleMs: 1500,
  },
  {
    file: "10-company-detail.png",
    url: `/mp/company/${encodeURIComponent("ПиВи-Квантум-ООД")}`,
    capture: { kind: "viewport" },
    settleMs: 1500,
  },
  {
    file: "11-orbital-pathfind-attempt.png",
    url: `/candidate/${encodeURIComponent("Рашид Мехмедов Узунов")}`,
    capture: { kind: "viewport" },
    settleMs: 2500,
  },
];

const toggleCheckbox = async (page: Page, label: RegExp): Promise<void> => {
  // The orbital filters are <label> wrappers around an <input type=checkbox>.
  // Match by text and click through to the label so React picks it up.
  const lbl = page.locator("label").filter({ hasText: label }).first();
  await lbl.waitFor({ state: "visible", timeout: 10_000 });
  await lbl.click();
};

const captureCardByHeading = async (
  page: Page,
  heading: RegExp,
): Promise<Locator> => {
  // Dashboard tiles render their title inside a <span> (not a heading), and
  // connections-page cards render theirs inside an <h3>. We match against
  // the smallest rounded-xl ancestor whose subtree contains the heading
  // text — that ancestor is the StatCard or Card itself in both cases.
  const card = page
    .locator("div.rounded-xl")
    .filter({ hasText: heading })
    .last();
  await card.waitFor({ state: "visible", timeout: 30_000 });
  return card;
};

const runShot = async (context: BrowserContext, shot: Shot): Promise<void> => {
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.log(`[browser ${msg.type()}] ${shot.file}:`, msg.text());
    }
  });
  const url = `${BASE}${shot.url}`;
  console.log(`→ ${shot.file}: ${url}`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
  // The site nav is position:fixed and otherwise overlaps element
  // screenshots taken near the top of the page. Inject the hide rule after
  // navigation so it survives the SPA's CSS reset.
  await page.addStyleTag({
    content: "nav.fixed{display:none!important;}",
  });
  await page.waitForTimeout(shot.settleMs ?? 800);

  if (shot.setup) {
    await shot.setup(page);
    // Give the canvas time to react to the toggle.
    await page.waitForTimeout(shot.settleMs ?? 800);
  }

  const out = path.join(OUT_DIR, shot.file);
  if (shot.capture.kind === "card-by-heading") {
    const card = await captureCardByHeading(page, shot.capture.heading);
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await card.screenshot({ path: out });
  } else if (shot.capture.kind === "locator") {
    // `.last()` picks the deepest matching node — useful when nested
    // ancestors share the rounded-xl class. Without this we'd capture the
    // wrapping section rather than the specific tile.
    const loc = page.locator(shot.capture.selector).last();
    await loc.waitFor({ state: "visible", timeout: 30_000 });
    await loc.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await loc.screenshot({ path: out });
  } else {
    await page.screenshot({ path: out });
  }
  console.log(`  wrote ${out}`);
  await page.close();
};

const main = async (): Promise<void> => {
  const arg = (process.argv[2] || "").trim();
  // Filter to a subset of shots when the user passes a comma-separated list
  // of filenames or numeric prefixes ("01,02" or "06,07,08"). Useful for
  // iterating on a single image without rerunning the whole batch.
  const filter = arg
    ? new Set(
        arg
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      )
    : null;
  const todo = filter
    ? SHOTS.filter((s) => {
        const prefix = s.file.split("-")[0];
        return filter.has(s.file) || filter.has(prefix);
      })
    : SHOTS;

  if (todo.length === 0) {
    console.error(`No shots match filter "${arg}". Available:`);
    for (const s of SHOTS) console.error(`  ${s.file}`);
    process.exit(1);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
    deviceScaleFactor: 2,
    locale: "en-US",
  });
  await context.addInitScript(() => {
    localStorage.setItem("language", "en");
  });

  for (const shot of todo) {
    try {
      await runShot(context, shot);
    } catch (err) {
      console.error(`✗ ${shot.file} failed:`, err);
    }
  }

  await browser.close();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
