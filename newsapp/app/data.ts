// Types + fetcher for the static bundles produced by
// news/scripts/build_app_data.py (served from /news-data/ — the vite dev
// middleware in prod shape). One promise cache per path, evicted on rejection
// so a transient failure doesn't pin a rejected promise.

import { useEffect, useState } from "react";

export type Leaning =
  | "strong_progressive"
  | "progressive"
  | "neutral"
  | "conservative"
  | "strong_conservative"
  | "not_applicable";

export type RussiaStance =
  | "strong_pro_russia"
  | "pro_russia"
  | "neutral"
  | "anti_russia"
  | "strong_anti_russia"
  | "not_applicable";

export type AiVerdict = "likely_human" | "unclear" | "likely_ai";

export type QualityVerdict =
  | "ok"
  | "paywall_shell"
  | "client_render_shell"
  | "too_short"
  | "not_bulgarian"
  | "non_article";

export type Tone = "favorable" | "unfavorable" | "neutral" | "mixed";

export interface Entities {
  people: string[];
  parties: string[];
  institutions: string[];
  companies: string[];
  places: string[];
}

export interface TopicRef {
  category: string;
  subcategory: string | null;
  primary: boolean;
}

export interface AnalysisBlock {
  summary_bg: string | null;
  summary_en: string | null;
  leaning: {
    label: Leaning | null;
    confidence: number | null;
    evidence: string | null;
  } | null;
  russia_stance: {
    label: RussiaStance | null;
    confidence: number | null;
    evidence: string | null;
  } | null;
  ai_generated: {
    verdict: AiVerdict | null;
    confidence: number | null;
    signals: string[];
  } | null;
  entities: Entities | null;
  party_tones: { party: string; tone: Tone }[] | null;
  topics: TopicRef[] | null;
  quality: { verdict: QualityVerdict | null; notes: string | null } | null;
  site_relevant: boolean | null;
  model: string | null;
  analyzed_at: string | null;
}

export interface ArticleRecord {
  id: string;
  domain: string;
  title: string | null;
  url: string | null;
  published: string | null;
  author: string | null;
  topic: string | null;
  keywords: string | null;
  /**
   * The outlet's own og:description where there is one (99% of records),
   * falling back to the head of the extracted body. There is no separate
   * "description" — this IS it, renamed on the way into the app.
   */
  excerpt: string | null;
  content_chars: number | null;
  /**
   * The outlet's lead image, HOTLINKED. ⚠️ Present is not the same as usable
   * and the URL cannot tell you which: some outlets put a branding redirector
   * or the author's portrait here, and roughly a quarter refuse a request
   * carrying our referer. Every renderer needs an onError fallback and every
   * rendered image needs a visible credit.
   */
  image: string | null;
  canonical: string | null;
  /** What the page DECLARES, not what it is — two outlets say "en" while publishing Bulgarian. */
  language: string | null;
  updated: string | null;
  /**
   * Breadcrumb section path, article leaf stripped. ⚠️ Carried in
   * articles/<domain>.json only — never in latest.json, which every page
   * downloads. Undefined in the feed rather than null.
   */
  section_path?: string[] | null;
  /** og:image:alt, and only when og:image is the image we stored. Feed-omitted like section_path. */
  image_alt?: string | null;
  story_id: string | null;
  analysis?: AnalysisBlock;
}

export interface StoryMember {
  domain: string;
  article_id: string | null;
  url: string | null;
  title: string | null;
  published: string | null;
  leaning: Leaning | null;
  russia_stance: RussiaStance | null;
  /** When WE first saw it. The scoop measure keys on this, not on `published`. */
  first_seen: string | null;
  /**
   * Hours behind the cluster's earliest sighting. ⚠️ null means we cannot
   * tell — render that as unknown, never as zero. Ties inside
   * SCOOP_TIE_HOURS are shared: the sweep is sequential over ~60 domains, so
   * minutes of spread are our scheduling, not their newsroom.
   */
  scoop_lag_hours: number | null;
  /**
   * ⚠️ A race result, so it needs a race. False for every member of a
   * single-outlet cluster, and false for ALL of them when the spread is
   * inside the tie window — the instrument cannot separate them there, and
   * flagging everyone says nothing while looking like a finding.
   */
  first_here: boolean;
  /**
   * Whether a winner was determinable at all. When false, render the lag (it
   * is true) but never a "first to report" badge.
   */
  scoop_decidable: boolean;
}

export interface Story {
  id: string;
  title_bg: string | null;
  title_en: string | null;
  summary_bg: string | null;
  summary_en: string | null;
  first_published: string | null;
  last_published: string | null;
  topics: TopicRef[];
  related_story_ids: string[];
  entities: Entities;
  aggregates: {
    article_count: number;
    outlet_count: number;
    by_leaning: Partial<Record<Leaning, number>>;
    by_russia_stance: Partial<Record<RussiaStance, number>>;
    by_domain: Record<string, number>;
  };
  blindspot: { side: "left" | "right" } | null;
  members: StoryMember[];
}

export interface OutletOwner {
  name: string;
  /** One of the eight controlled values; null when the cell was blank or unrecognised. */
  category: string | null;
  /** The register page the claim came from. */
  source: string | null;
  /** ISO date the lookup was made. Part of the claim, not metadata. */
  checked: string | null;
}

export interface Outlet {
  domain: string;
  outlet: string;
  /**
   * The outlet's own mark, resolved once into the registry by
   * news/scripts/resolve_outlet_logos.py — hotlinked, never copied. Null for
   * the outlets whose homepage we cannot read (Cloudflare) or must not fetch
   * (bot_refused); render a monogram then, never a broken image.
   */
  logo: string | null;
  /**
   * What a named register said about who owns this outlet, on a stated date.
   *
   * ⚠️ NEVER captioned as beneficial ownership. The Commerce Registry records
   * the REGISTERED owner, which in Bulgarian media is routinely a holding
   * company or an offshore vehicle rather than the person in control — so any
   * surface rendering this must show `source` and `checked` beside `name`.
   *
   * `null` means nobody has looked yet, which is different from "ownership is
   * unknown" and must not render as it.
   */
  owner: OutletOwner | null;
  /**
   * Removed from the registry. Its articles STAY — they were collected in
   * good faith — but it must not be presented as a live source, and two of
   * these asked not to be crawled at all.
   */
  retired: boolean;
  retired_reason: string | null;
  retired_on: string | null;
  rank: number | null;
  tier: string | null;
  type: string | null;
  scope: string | null;
  visits: number | null;
  article_count: number;
  analyzed_count: number;
  leaning: Partial<Record<Leaning, number>>;
  russia_stance: Partial<Record<RussiaStance, number>>;
  ai_generated: Partial<Record<AiVerdict, number>>;
}

export interface TaxonomyCategory {
  id: string;
  label: { bg: string; en: string };
  route: string | null;
  article_count: number;
  story_count: number;
  subcategories: {
    id: string;
    label: { bg: string; en: string };
    article_count: number;
  }[];
}

export interface Stats {
  generated_at: string;
  taxonomy_version: number;
  total_articles: number;
  analyzed_articles: number;
  analyzed_pct: number;
  stories: number;
  domains: number;
  outlets_catalogued: number;
  first_published: string | null;
  last_published: string | null;
  articles_by_domain: Record<string, number>;
}

const BASE: string = import.meta.env.VITE_NEWS_DATA_BASE_URL || "/news-data";

const cache = new Map<string, Promise<unknown>>();

export function fetchData<T>(path: string): Promise<T> {
  let promise = cache.get(path) as Promise<T> | undefined;
  if (!promise) {
    promise = fetch(`${BASE}${path}`).then((res) => {
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
      return res.json() as Promise<T>;
    });
    cache.set(path, promise);
    promise.catch(() => cache.delete(path));
  }
  return promise;
}

// Minimal data hook — one fetch in flight per path thanks to the promise cache
// above, so many components can ask for the same bundle independently.

export const useData = <T>(path: string | null) => {
  const [state, setState] = useState<{
    data: T | null;
    error: Error | null;
    loading: boolean;
  }>({ data: null, error: null, loading: path !== null });

  useEffect(() => {
    if (path === null) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    let live = true;
    setState((prev) => ({ data: prev.data, error: null, loading: true }));
    fetchData<T>(path)
      .then((data) => {
        if (live) setState({ data, error: null, loading: false });
      })
      .catch((error: unknown) => {
        // Keep the last good bundle on a failed refresh — consumers can still
        // render it next to the error flag instead of blanking.
        if (live)
          setState((prev) => ({
            data: prev.data,
            error: error instanceof Error ? error : new Error(String(error)),
            loading: false,
          }));
      });
    return () => {
      live = false;
    };
  }, [path]);

  return state;
};

// ---- typed bundle loaders -------------------------------------------------------
//
// Contract shared by all loaders below: on a failed refresh `data` may be
// non-null alongside `error` (last good bundle kept, see useData) — consumers
// guard the fatal case with `error && !data` and may keep rendering `data`
// otherwise.

export const useStats = () => useData<Stats>("/stats.json");
export const useStories = () =>
  useData<{ generated_at: string; stories: Story[] }>("/stories.json");
export const useLatest = () =>
  useData<{ generated_at: string; articles: ArticleRecord[] }>("/latest.json");
export const useTaxonomy = () =>
  useData<{ version: number; categories: TaxonomyCategory[] }>(
    "/taxonomy.json",
  );
export const useOutlets = () =>
  useData<{ generated_at: string; outlets: Outlet[] }>("/outlets.json");
export const useOutletArticles = (domain: string | null) =>
  useData<{ domain: string; outlet: string; articles: ArticleRecord[] }>(
    domain ? `/articles/${domain}.json` : null,
  );
