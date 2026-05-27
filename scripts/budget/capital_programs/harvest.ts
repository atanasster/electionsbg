// Headless-browser harvester for município capital programme URLs.
//
// Many общини publish budget appendices on JS-rendered SPA portals
// (Joomla / Drupal / WP-with-loaders) where curl + grep returns nothing
// useful. This script spins up headless Chromium via Playwright, waits
// for the page to hydrate, then extracts all <a> hrefs from the rendered
// DOM. It filters by Cyrillic / Latin keywords matching capital-programme
// terminology and prints a tabular report.
//
// Usage:
//   npx tsx scripts/budget/capital_programs/harvest.ts [muniSlug...]
//
// With no args, runs against the catalogue of deferred Tier-2 общини
// (see CANDIDATES below). With one or more muniSlug args, runs only
// those (e.g. `npx tsx ... harvest.ts smolyan vidin`).
//
// Output is intentionally a human-readable report — the operator picks
// the URL they want, downloads it into raw_data/budget/capital_programs/
// and runs the existing OCR + rollup pipeline.

import { chromium, Page } from "@playwright/test";

interface Candidate {
  slug: string; // município short name (used in CLI args)
  obshtinaCode: string; // Bulgarian obshtina code (SLV20, etc.)
  urls: string[]; // budget-portal URLs to render
  // The keyword regex isn't município-specific (we always look for
  // капитал/разчет/приложение matches), but per-candidate notes help
  // the operator know which page is most likely to hold the URL.
  notes?: string;
}

const CANDIDATES: Candidate[] = [
  {
    slug: "smolyan",
    obshtinaCode: "SML02",
    urls: [
      "https://www.smolyan.bg/bg/menu/content/byudzhet",
      "https://www.smolyan.bg/bg/menu/content/4274",
    ],
    notes:
      "Bъдгет 2025 published Jan 2025; PDFs in /media/content_files/file/2024/Бюджет 2025/",
  },
  {
    slug: "yambol",
    obshtinaCode: "YBL26",
    urls: [
      "https://yambol.bg/byudzhet-finansi",
      "https://yambol.bg/byudzhet",
      "https://yambol.bg/obshtestveno-dopitvane-budjet-25",
    ],
    notes: "Opaque-hash upload URLs like /uploads/<UPPER-HEX>",
  },
  {
    slug: "vidin",
    obshtinaCode: "VID22",
    urls: ["https://vidin.bg/", "https://vidin.bg/byudzhet"],
  },
  {
    slug: "targovishte",
    obshtinaCode: "TGV35",
    urls: ["https://targovishte.bg/", "https://targovishte.bg/byudzhet"],
  },
  {
    slug: "lovech",
    obshtinaCode: "LOV43",
    urls: ["https://lovech.bg/bg/byudzhet"],
  },
  {
    slug: "kyustendil",
    obshtinaCode: "KNL38",
    urls: ["https://kyustendil.bg/byudzhet"],
    notes: "Joomla jdownloads plugin — URLs are /index.php?...&id=NNN",
  },
  {
    slug: "haskovo",
    obshtinaCode: "HSK10",
    urls: ["https://haskovo.bg/bg/byudzhet", "https://haskovo.bg/"],
  },
  {
    slug: "shumen",
    obshtinaCode: "SHU30",
    urls: ["https://www.shumen.bg/bg/byudzhet/2025"],
    notes:
      "Already partially probed — has /uploads/deinosti/budjet/25XX.pdf pattern",
  },
  {
    slug: "gabrovo",
    obshtinaCode: "GAB17",
    urls: ["https://gabrovo.bg/bg/budget", "https://gabrovo.bg/byudzhet"],
  },
  {
    slug: "razgrad",
    obshtinaCode: "RGD22",
    urls: ["https://razgrad.bg/", "https://razgrad.bg/byudzhet"],
  },
  {
    slug: "blagoevgrad",
    obshtinaCode: "BLG02",
    urls: ["https://blagoevgrad.bg/category/449/biudjet-2025"],
    notes: "Documents under admin.blagoevgrad.bg/ckeditor_assets/attachments/",
  },
  {
    slug: "veliko_tarnovo",
    obshtinaCode: "VTR04",
    urls: [
      "https://www.veliko-tarnovo.bg/bg/ikonomika-i-finansi/byudzhet/",
      "https://savet.veliko-tarnovo.bg/",
    ],
  },
];

const KEYWORD_RE =
  /капитал|kapital|razchet|разчет|приложение|prilozenie|prilojenie/i;

const renderAndExtract = async (
  page: Page,
  url: string,
): Promise<Array<{ href: string; text: string }>> => {
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    // Give late-loading widgets a beat to render budget links.
    await page.waitForTimeout(2000);
  } catch (e) {
    console.warn(`  [warn] ${url} — ${(e as Error).message.slice(0, 80)}`);
    return [];
  }
  const links = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    return anchors.map((a) => ({
      href: (a as HTMLAnchorElement).href,
      text: (a as HTMLAnchorElement).textContent?.trim().slice(0, 120) ?? "",
    }));
  });
  return links;
};

const main = async () => {
  const args = process.argv.slice(2);
  const targets =
    args.length > 0
      ? CANDIDATES.filter((c) => args.includes(c.slug))
      : CANDIDATES;

  if (targets.length === 0) {
    console.log(
      `No matching candidates. Known slugs: ${CANDIDATES.map((c) => c.slug).join(", ")}`,
    );
    process.exit(1);
  }

  console.log(
    `[harvest] launching headless Chromium for ${targets.length} municipality candidate(s)`,
  );
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "bg-BG",
  });
  const page = await context.newPage();

  for (const muni of targets) {
    console.log(`\n=== ${muni.slug} (${muni.obshtinaCode}) ===`);
    if (muni.notes) console.log(`  note: ${muni.notes}`);

    const seen = new Map<string, string>(); // href → text
    for (const url of muni.urls) {
      console.log(`  fetching: ${url}`);
      const links = await renderAndExtract(page, url);
      console.log(`    rendered → ${links.length} anchors`);
      for (const { href, text } of links) {
        if (!KEYWORD_RE.test(href) && !KEYWORD_RE.test(text)) continue;
        if (!/\.(pdf|xlsx|xls|doc|docx|zip)(\?|$)/i.test(href)) continue;
        if (seen.has(href)) continue;
        seen.set(href, text);
      }
    }

    if (seen.size === 0) {
      console.log(`  → no capital-keyword document links found`);
      continue;
    }
    console.log(`  → ${seen.size} candidate document(s):`);
    let i = 1;
    for (const [href, text] of seen) {
      console.log(`    ${i++}. ${text || "(no anchor text)"}`);
      console.log(`       ${href}`);
    }
  }

  await browser.close();
  console.log("\n[harvest] done");
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
