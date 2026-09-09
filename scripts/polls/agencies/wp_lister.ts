// Shared plumbing for the five agencies that publish through WordPress's REST
// API (Тренд, Сова Харис, Мяра, Global Metrics, Gallup) — one fetch helper,
// one post→Publication mapper, one category-name resolver. A per-agency file
// stays a handful of lines naming its own endpoint and title rule.

import { fetchText } from "../../watch/fingerprint";
import { decodeEntities } from "../../lib/html";
import type { Publication } from "./types";

// WordPress's REST API is unauthenticated and rate-limit-free for these
// sites (measured), but every one of them has blocked the bare Node UA on at
// least one endpoint in this repo's other ingests — a browser UA is what the
// rest of scripts/polls/ already sends (scrape_polls.ts's HEADERS).
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export interface WpPost {
  id: number;
  date: string; // site-local ISO, no timezone suffix — e.g. "2026-04-16T10:54:45"
  link: string;
  title: { rendered: string };
}

export interface WpCategory {
  id: number;
  name: string;
}

/**
 * GET a WordPress REST endpoint as JSON, over a browser UA.
 *
 * Never PDFs or post bodies — this is the listing fetch only, matching the
 * "one request per source" watcher rule (docs/plans/polls-agency-watchers-v1.md
 * decision 4).
 */
export const fetchWpJson = async <T>(url: string): Promise<T> => {
  const text = await fetchText(url, { headers: { "User-Agent": UA } });
  if (text === null) throw new Error(`empty response: ${url}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `non-JSON response from ${url} (site may be down or blocking): ${text.slice(0, 120)}`,
    );
  }
};

export const wpPostToPublication = (p: WpPost): Publication => ({
  id: p.id,
  url: p.link,
  // WordPress serves HTML entities inside JSON string fields ("&#8211;" etc.)
  // — `decodeEntities` (scripts/lib/html.ts) already covers every numeric
  // entity (its `&#(\d+);`/`&#x…;` fallback) plus `&amp;`/`&nbsp;`/the quote
  // set, so a private copy here would only be narrower.
  title: decodeEntities(p.title.rendered),
  publishedAt: p.date ? p.date.slice(0, 10) : null,
  kind: "html",
  attachments: [],
});

/**
 * Resolve category NAMES to ids by querying `/categories` fresh — for a
 * category set that changes shape year to year (Sova Harris's "Проекти
 * <year>" / "Прогнозни <year>"), a hardcoded id list goes stale every
 * January. Unmatched names are silently dropped (a category that has not
 * been created yet contributes no posts, which is correct — not an error).
 */
export const resolveCategoryIds = async (
  site: string,
  names: string[],
): Promise<number[]> => {
  const cats = await fetchWpJson<WpCategory[]>(
    `${site}/wp-json/wp/v2/categories?per_page=100&_fields=id,name`,
  );
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  return cats.filter((c) => wanted.has(c.name.toLowerCase())).map((c) => c.id);
};

/**
 * List posts (or a custom post type) from `${site}/wp-json/wp/v2/<postType>`,
 * newest first, mapped to `Publication`. `categories`/`after`/`before` are
 * forwarded as WP REST collection params when given.
 */
export const listWpPosts = async (
  site: string,
  opts: {
    postType?: string;
    categories?: number[];
    limit?: number;
    after?: string;
    before?: string;
  } = {},
): Promise<Publication[]> => {
  const postType = opts.postType ?? "posts";
  const params = new URLSearchParams({
    per_page: String(opts.limit ?? 25),
    _fields: "id,date,link,title",
  });
  if (opts.categories?.length)
    params.set("categories", opts.categories.join(","));
  if (opts.after) params.set("after", `${opts.after}T00:00:00`);
  if (opts.before) params.set("before", `${opts.before}T23:59:59`);
  const posts = await fetchWpJson<WpPost[]>(
    `${site}/wp-json/wp/v2/${postType}?${params.toString()}`,
  );
  return posts.map(wpPostToPublication);
};

/**
 * The shared shape of most `isElectoral` rules: a lowercased-substring match
 * against a term list. Used where an agency's rule is exactly this (Trend,
 * Global Metrics, Gallup); Sova Harris adds an exit-poll exclusion and Мяра's
 * whole population is already electoral-scoped, so neither uses it.
 */
export const titleContainsAny =
  (terms: string[]) =>
  (p: Publication): boolean => {
    const title = p.title.toLowerCase();
    return terms.some((t) => title.includes(t));
  };
