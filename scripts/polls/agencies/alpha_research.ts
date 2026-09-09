// Алфа Рисърч (alpharesearch.bg) — custom CMS, no JSON API. The blog listing
// (`/blog/?page=N`) paginates 12 posts per page with NO date anywhere in the
// card (title, "for more" link only) — measured 2026-09-05 and re-confirmed
// while building this file — so `publishedAt` is always null here; the
// ingest fills it from the post body.
//
// ⚠️ THE SITE CARRIES INJECTED SEO SPAM — casino/gambling links to unrelated
// domains (`*.go.id` and similar) scattered across every listing page,
// several per page. They are always ABSOLUTE URLs to a foreign domain, while
// every real post link is `/post/<id>-<slug>.html` — relative, or absolute
// under alpharesearch.bg. The selector below requires BOTH "/post/" in the
// href AND the alpharesearch.bg origin (for an absolute href), which a spam
// link with a coincidental "/post/" segment in its own path could not
// satisfy.

import * as cheerio from "cheerio";
import { fetchText } from "../../watch/fingerprint";
import { UA, isExitPollTitle } from "./wp_lister";
import type { AgencyLister, ListOpts, Publication } from "./types";

const SITE = "https://alpharesearch.bg";
const POSTS_PER_PAGE = 12;
const MAX_PAGES_PER_CALL = 6; // 72 posts — comfortably covers any backlog walk

/** True for a link this repo will treat as Alpha Research's own — the spam
 *  gate. A relative `/post/...` href, or an absolute one whose origin is
 *  exactly `alpharesearch.bg`. */
const isOwnPostLink = (href: string): boolean => {
  if (href.startsWith("/post/")) return true;
  try {
    const u = new URL(href, SITE);
    return u.hostname === "alpharesearch.bg" && u.pathname.startsWith("/post/");
  } catch {
    return false;
  }
};

/** `/post/1052-obshtestveni-naglasi-…` → 1052. */
const idFromHref = (href: string): number | null => {
  const m = /\/post\/(\d+)-/.exec(href);
  return m ? Number(m[1]) : null;
};

const fetchListingPage = async (page: number): Promise<Publication[]> => {
  const html = await fetchText(`${SITE}/blog/?page=${page}`, {
    headers: { "User-Agent": UA },
  });
  if (html === null)
    throw new Error(`empty response: ${SITE}/blog/?page=${page}`);
  const $ = cheerio.load(html);
  const byId = new Map<number, Publication>();
  $("#content a[href*='/post/']").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!isOwnPostLink(href)) return;
    const id = idFromHref(href);
    if (id === null || byId.has(id)) return;
    // The anchor itself wraps an image with no text; the title lives in the
    // nearest heading inside the same card.
    const card = $(el).closest("div,article,li");
    const title = card
      .find("h1,h2,h3,h4,h5")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    if (!title) return;
    const url = href.startsWith("http") ? href : `${SITE}${href}`;
    byId.set(id, {
      id,
      url,
      title,
      publishedAt: null,
      kind: "html",
      attachments: [],
    });
  });
  return [...byId.values()];
};

export const listPublications = async (
  opts: ListOpts = {},
): Promise<Publication[]> => {
  const limit = opts.limit ?? POSTS_PER_PAGE;
  const seen = new Map<number, Publication>();
  for (let page = 1; page <= MAX_PAGES_PER_CALL && seen.size < limit; page++) {
    const pagePubs = await fetchListingPage(page);
    if (pagePubs.length === 0) break; // past the last page
    const before = seen.size;
    for (const p of pagePubs) seen.set(p.id, p);
    // An out-of-range `?page=N` that the site clamps to its last page
    // (rather than returning empty) would otherwise loop re-fetching the
    // same posts up to MAX_PAGES_PER_CALL; a page contributing no new id
    // is the same "past the last page" signal as an empty one.
    if (seen.size === before) break;
  }
  return [...seen.values()].slice(0, limit);
};

const ELECTORAL_TERMS = ["електорал", "избор", "партии", "президент"];

export const isElectoral = (p: Publication): boolean => {
  // Shared with Trend/Global Metrics/Gallup/Sova Harris (wp_lister.ts) — a
  // bare "избор" substring here is even broader than Trend's "избори" (it
  // also matches "изборен", "изборник", ...), so this is exposed to the
  // SAME exit-poll false positive decision 17 forbids: measured live on
  // Trend, "Профил на избирателя (екзит пол от изборите …)" false-matched
  // on the bare substring alone before this guard existed anywhere.
  if (isExitPollTitle(p.title)) return false;
  const title = p.title.toLowerCase();
  if (!title.includes("нагласи")) return false;
  return ELECTORAL_TERMS.some((t) => title.includes(t));
};

export const alphaResearch: AgencyLister = {
  agencyId: "AR",
  listPublications,
  isElectoral,
};
