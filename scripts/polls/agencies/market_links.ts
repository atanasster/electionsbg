// Market Links archive cards expose dates, titles and publication links.

import * as cheerio from "cheerio";
import { fetchText } from "../../watch/fingerprint";
import { UA, isExitPollTitle } from "./wp_lister";
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

const readPage = async (
  url: string,
): Promise<{ publications: Publication[]; pages: string[] }> => {
  const html = await fetchText(url, { headers: { "User-Agent": UA } });
  if (html === null) throw new Error(`empty response: ${url}`);
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

  const pages = $("a[href]")
    .toArray()
    .flatMap((el) => {
      try {
        const link = new URL($(el).attr("href")!, SITE);
        return link.origin === SITE &&
          /^\/bg\/news-p\d+\.html$/.test(link.pathname)
          ? [link.href]
          : [];
      } catch {
        return [];
      }
    });
  return { publications: out, pages };
};

export const listPublications = async (
  opts: ListOpts = {},
): Promise<Publication[]> => {
  const archive = opts.archive || !!opts.after || !!opts.before;
  const pending = [LISTING_URL];
  const visited = new Set<string>();
  const publications = new Map<number, Publication>();
  while (pending.length) {
    const url = pending.shift()!;
    if (visited.has(url)) continue;
    if (visited.size >= 200)
      throw new Error("Market Links archive exceeded 200 pages");
    visited.add(url);
    const page = await readPage(url);
    for (const p of page.publications) publications.set(p.id, p);
    if (archive) pending.push(...page.pages.filter((p) => !visited.has(p)));
  }
  return [...publications.values()]
    .filter((p) => inRange(p, opts))
    .sort((a, b) => b.id - a.id)
    .slice(0, opts.limit);
};

export const isElectoral = (p: Publication): boolean => {
  if (isExitPollTitle(p.title)) return false;
  const title = p.title.toLowerCase();
  return (
    (title.startsWith("обществено") && title.includes("политически")) ||
    title.includes("социално-политическите нагласи") ||
    /президент|електорал|парламент|избор|националн.*проучване|контролиран вот|политическ.*(?:фрагментация|разделение)|обществен консенсус/u.test(
      title,
    )
  );
};

export const marketLinks: AgencyLister = {
  agencyId: "ML",
  listPublications,
  isElectoral,
};
