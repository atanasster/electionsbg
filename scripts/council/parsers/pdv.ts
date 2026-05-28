// Пловдив (PDV01) — WordPress category-listing parser.
//
// Source surface:
//   - Category index: /obs/category/действащи-актове/решения/
//     served by WordPress with 5 entries per page across 1400+ pages
//     (~7000 lifetime decisions). Pagination: /page/<N>/.
//   - Each entry's listing snippet carries the resolution number,
//     protocol/session number, sitting date, and ОТНОСНО title —
//     no drill-in needed.
//   - Per-decision page exists at /obs/действащи-актове/решения/решение-<N>-<dunno>/
//     with the same title fields + a PDF attachment that's typically
//     a scanned image (no text layer). We don't follow these.
//
// CAVEAT (same as Varna/Burgas): no vote tally is exposed on either the
// listing or the per-decision HTML. Plovdiv publishes the decision text
// only — votes are kept in protocols not surfaced on this site. Tally
// + result remain undefined/unknown.
//
// Incremental walk: starts from /page/1/ (newest first), backs up one
// page at a time, stops when a whole page consists of decisions older
// than sinceDate OR when maxProtocols is hit.

import * as cheerio from "cheerio";
import { fetchHtml } from "../lib/fetch";
import type {
  CouncilResolution,
  MuniRecipe,
  MuniScrapeResult,
} from "../lib/types";

const OBSHTINA = "PDV01";
const BASE = "https://plovdiv.bg/";
const CATEGORY_PATH =
  "obs/category/%d0%b4%d0%b5%d0%b9%d1%81%d1%82%d0%b2%d0%b0%d1%89%d0%b8-%d0%b0%d0%ba%d1%82%d0%be%d0%b2%d0%b5/%d1%80%d0%b5%d1%88%d0%b5%d0%bd%d0%b8%d1%8f/";

const categoryPageUrl = (n: number): string =>
  n <= 1 ? `${BASE}${CATEGORY_PATH}` : `${BASE}${CATEGORY_PATH}page/${n}/`;

// One listing entry. The header glob is parseable as:
//   "Р Е Ш Е Н И Е № <N> ВЗЕТО С ПРОТОКОЛ № <P> ОТ <DD.MM.YYYY> г.[ (ПРИЛОЖЕНИЕ)] О Т Н О С Н О : <title>"
// Every glyph + digit is space-separated by the WP renderer, so my
// regex collapses runs of whitespace before parsing.
//
// Title is bounded by the next "Прочети" word (the "Read more" link).
// Each glyph in the all-caps tokens is rendered with optional whitespace
// between letters: "Р Е Ш Е Н И Е", "О Т Н О С Н О", "ПРОТОКОЛ"
// (sometimes spaced, sometimes not). Build a helper that matches a word
// with `\s*` between glyphs.
const spaced = (word: string): string => word.split("").join("\\s*");
const HEADER_RE = new RegExp(
  `${spaced("РЕШЕНИЕ")}\\s*№\\s*((?:\\d\\s*)+).+?${spaced("ПРОТОКОЛ")}\\s*№\\s*((?:\\d\\s*)+).+?${spaced("ОТ")}\\s*((?:\\d\\s*)+\\.\\s*(?:\\d\\s*)+\\.\\s*(?:\\d\\s*)+).+?${spaced("ОТНОСНО")}\\s*:\\s*([\\s\\S]+?)${spaced("Прочети")}`,
  "u",
);

const collapseGlyphs = (raw: string): string => raw.replace(/\s+/g, "");
const collapseSpaces = (raw: string): string => raw.replace(/\s+/g, " ").trim();

const parseDate = (raw: string): string | null => {
  // raw is "30. 04. 20 2 6" or "30.04.2026" — collapse spaces and split.
  const collapsed = raw.replace(/\s+/g, "");
  const m = collapsed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
};

type Entry = {
  number: string;
  session: string;
  date: string;
  title: string;
  sourceUrl: string;
};

const parseListingPage = (html: string): Entry[] => {
  // The category page renders each decision as <article>…</article>; we
  // run the regex against the full HTML's stripped text instead of
  // anchoring to article boundaries since the WP theme adds wrapping
  // divs that vary by version.
  const $ = cheerio.load(html);
  const out: Entry[] = [];
  const seen = new Set<string>();
  // Plovdiv's WordPress theme wraps each decision in
  // <div class="post-NNNNN post type-post status-publish ...">. The
  // generic .post selector matches sidebar widgets too, so anchor on
  // .type-post which only fires on the main loop entries.
  $("div.type-post").each((_: number, art) => {
    const $art = $(art);
    const text = collapseSpaces($art.text());
    const link =
      $art.find(".entry-title a[href]").attr("href") ||
      $art.find("a[href*='/обс/']").attr("href") ||
      $art.find("a[href*='/obs/']").attr("href") ||
      "";
    const m = text.match(HEADER_RE);
    if (!m) return;
    const number = collapseGlyphs(m[1]);
    const session = collapseGlyphs(m[2]);
    const date = parseDate(m[3]);
    if (!date) return;
    const title = m[4].trim();
    if (seen.has(number)) return;
    seen.add(number);
    out.push({
      number,
      session,
      date,
      title,
      sourceUrl: link,
    });
  });
  return out;
};

export const scrapePDV = async (
  _recipe: MuniRecipe,
  opts: {
    sinceYear?: number;
    sinceDate?: string;
    maxProtocols?: number;
  },
): Promise<MuniScrapeResult> => {
  const errors: MuniScrapeResult["errors"] = [];
  const resolutions: CouncilResolution[] = [];

  // For Plovdiv we count "pages walked" rather than "protocols touched"
  // since pages and protocols don't align (5 decisions per page can
  // belong to 1-3 protocols).
  let pagesWalked = 0;
  // Cap pages to avoid runaway scrapes. Per-run cap = maxProtocols (when
  // set) divided by 5, plus 1 buffer, OR a hard ceiling of 25 (~125
  // decisions, equivalent to ~3 months of council activity).
  const maxPages = opts.maxProtocols
    ? Math.min(25, Math.ceil(opts.maxProtocols / 5) + 1)
    : 25;

  const seenNumbers = new Set<string>();
  for (let page = 1; page <= maxPages; page++) {
    let html: string;
    try {
      html = await fetchHtml(categoryPageUrl(page));
    } catch (err) {
      errors.push({
        url: categoryPageUrl(page),
        message: err instanceof Error ? err.message : String(err),
      });
      break;
    }
    const entries = parseListingPage(html);
    if (entries.length === 0) break;
    pagesWalked++;
    let stopAfterThisPage = false;
    let added = 0;
    for (const e of entries) {
      if (seenNumbers.has(e.number)) continue;
      seenNumbers.add(e.number);
      if (opts.sinceYear && parseInt(e.date.slice(0, 4), 10) < opts.sinceYear) {
        stopAfterThisPage = true;
        continue;
      }
      if (opts.sinceDate && e.date <= opts.sinceDate) {
        stopAfterThisPage = true;
        continue;
      }
      resolutions.push({
        id: `${OBSHTINA}-${e.date.slice(0, 4)}-prot${e.session}-r${e.number}`,
        date: e.date,
        session: e.session,
        number: e.number,
        title: e.title || "(no title parsed)",
        result: "unknown",
        sourceUrl: e.sourceUrl,
      });
      added++;
    }
    console.log(`    + page ${page}: ${added}/${entries.length} new`);
    if (stopAfterThisPage) break;
  }

  return {
    obshtinaCode: OBSHTINA,
    resolutions,
    protocolsTouched: pagesWalked,
    errors,
  };
};
