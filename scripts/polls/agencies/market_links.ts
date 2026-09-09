// Маркет ЛИНКС (marketlinks.bg) — custom PHP CMS, no JSON API. The listing
// (`/bg/news.html`) is ~12 items with no pagination beyond what is already on
// the page. Each item ships THREE anchors to the same href (a date-only one,
// a title-bearing one, and a "Повече" read-more link) — measured 2026-09-05.
// This lister groups by href and picks the title out of the group by
// elimination (neither the bare date nor "Повече").
//
// The party shares themselves are NOT on this page — every listed item links
// ONE PDF from its OWN page, one request deeper than the listing. Per the
// "one request per source" watcher rule, that PDF is resolved by the ingest
// (a later step), not here: `kind` is set to "pdf" because the site's shape
// guarantees it, but `attachments` stays empty.

import * as cheerio from "cheerio";
import { fetchText } from "../../watch/fingerprint";
import { UA } from "./wp_lister";
import type { AgencyLister, ListOpts, Publication } from "./types";

const SITE = "https://www.marketlinks.bg";
const LISTING_URL = `${SITE}/bg/news.html`;

const ITEM_HREF = /\/bg\/news\/[a-z0-9-]+-(\d+)\.html$/i;
const DATE_TEXT = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;

/** "23.07.2026" or "5.7.2026" → "2026-07-05". */
const isoFromDdMmYyyy = (s: string): string | null => {
  const m = DATE_TEXT.exec(s);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
};

/** ISO-date bounds check, both sides inclusive. A publication with no known
 *  date cannot be confirmed in range, so it is excluded rather than guessed
 *  in — the same "never guessed" rule `Publication.publishedAt` documents. */
const inRange = (p: Publication, opts: ListOpts): boolean => {
  if (!opts.after && !opts.before) return true;
  if (!p.publishedAt) return false;
  if (opts.after && p.publishedAt < opts.after) return false;
  if (opts.before && p.publishedAt > opts.before) return false;
  return true;
};

export const listPublications = async (
  opts: ListOpts = {},
): Promise<Publication[]> => {
  const html = await fetchText(LISTING_URL, { headers: { "User-Agent": UA } });
  if (html === null) throw new Error(`empty response: ${LISTING_URL}`);
  const $ = cheerio.load(html);

  const byHref = new Map<string, string[]>();
  $(`a[href*='/bg/news/']`).each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!ITEM_HREF.test(href)) return; // excludes the categoryN.html links
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!text) return;
    const arr = byHref.get(href) ?? [];
    arr.push(text);
    byHref.set(href, arr);
  });

  const out: Publication[] = [];
  for (const [href, texts] of byHref) {
    const m = ITEM_HREF.exec(href)!;
    const id = Number(m[1]);
    const dateText = texts.find((t) => DATE_TEXT.test(t));
    const title = texts.find((t) => t !== dateText && t !== "Повече");
    if (!title) continue; // a group with only the date + "Повече" is not a real item
    out.push({
      id,
      url: href.startsWith("http") ? href : `${SITE}${href}`,
      title,
      publishedAt: dateText ? isoFromDdMmYyyy(dateText) : null,
      kind: "pdf",
      attachments: [],
    });
  }

  out.sort((a, b) => b.id - a.id); // newest first, matching every other lister
  const ranged = out.filter((p) => inRange(p, opts));
  const limit = opts.limit ?? ranged.length;
  return ranged.slice(0, limit);
};

export const isElectoral = (p: Publication): boolean => {
  const title = p.title.toLowerCase();
  return (
    (title.startsWith("обществено") && title.includes("политически")) ||
    title.includes("социално-политическите нагласи")
  );
};

export const marketLinks: AgencyLister = {
  agencyId: "ML",
  listPublications,
  isElectoral,
};
