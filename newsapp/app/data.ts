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
  /**
   * Prose fields the build refused to publish, as field → reason code.
   *
   * ⚠️ ABSENT when nothing was withheld, never an empty object: „we published
   * everything" and „we checked nothing" must not be the same value. The only
   * code today is `altered_name` — a summary repeating a person's name the
   * article does not spell that way, which the build withholds rather than
   * corrects (news/scripts/build_app_data.py).
   */
  withheld?: Record<string, string>;
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
  /** name → link, for the entity strings that earned one. */
  entity_links?: Record<string, EntityLink>;
  /**
   * Resolved, linkable entities — the SIBLING of `entities`, never a
   * replacement.
   *
   * ⚠️ `undefined` and `[]` are DIFFERENT and must render differently.
   * `undefined` means the record predates mention extraction (every one of
   * the 365 analyses on disk today); `[]` means the extractor ran and found
   * nobody. A component that treats the first as the second publishes „this
   * article mentions nobody" about the entire corpus.
   */
  mentions?: Mention[];
  party_tones: { party: string; tone: Tone }[] | null;
  topics: TopicRef[] | null;
  quality: { verdict: QualityVerdict | null; notes: string | null } | null;
  site_relevant: boolean | null;
  model: string | null;
  analyzed_at: string | null;
}

export type ImageRightsStatus =
  | "publisher_permission"
  | "licensed"
  | "cc"
  | "public_domain"
  | "official_reuse_policy"
  | "unknown"
  | "blocked";

/**
 * The reviewed basis for displaying one article image.
 *
 * This is deliberately separate from `Outlet.hotlink_ok`: delivery success
 * is not permission. Absence means the image has not been reviewed. Unknown
 * and blocked decisions may remain as review metadata, but `display_home`
 * must be false for both.
 */
export interface ImageRights {
  status: ImageRightsStatus;
  creator: string | null;
  credit_text: string;
  credit_url: string;
  licence_name: string | null;
  licence_url: string | null;
  source_url: string;
  checked_at: string;
  display_home: boolean;
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
  /** The outlet-declared lead image URL. Presence is neither usability nor permission. */
  image: string | null;
  /** Absent until a human/process has recorded the display basis. */
  image_rights?: ImageRights | null;
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
  /**
   * Prose fields the build refused to publish, as field → reason code.
   *
   * ⚠️ ABSENT when nothing was withheld, never an empty object: „we published
   * everything" and „we checked nothing" must not be the same value. The only
   * code today is `altered_name` — a summary repeating a person's name the
   * article does not spell that way, which the build withholds rather than
   * corrects (news/scripts/build_app_data.py).
   */
  withheld?: Record<string, string>;
  first_published: string | null;
  last_published: string | null;
  topics: TopicRef[];
  related_story_ids: string[];
  entities: Entities;
  /** name → link, for the entity strings that earned one. */
  entity_links?: Record<string, EntityLink>;
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

/** The deliberately compact story contract serialized in home.json. */
export type HomeStory = Pick<
  Story,
  | "id"
  | "title_bg"
  | "title_en"
  | "summary_bg"
  | "summary_en"
  | "last_published"
  | "topics"
  | "aggregates"
>;

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
   * Whether this outlet's CDN serves an image to OUR referer.
   *
   * ⚠️ TRI-STATE. `false` means the outlet answered 403 — skip straight to
   * the logo tile, because re-asking on every card is pointless and rude.
   * `null` means never probed, and must still be tried: a wrong `false`
   * permanently suppresses images an outlet is happy to serve, while a wrong
   * `true` costs one request the onError fallback already handles.
   */
  hotlink_ok: boolean | null;
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
  /**
   * Measurable conduct, as COUNTS beside their denominators.
   *
   * ⚠️ Never pre-divided. `updated_known` is 2.7% of the corpus today, so an
   * edit RATE computed against `articles` would be a near-zero number that
   * reads as a finding. The consumer decides whether a base is big enough.
   */
  conduct: OutletConduct;
}

export interface OutletConduct {
  /** Every stored article from this outlet. */
  articles: number;
  with_author: number;
  /** Articles whose page published a modification date at all. */
  updated_known: number;
  /** Of those, the ones edited after publication. */
  edited_after_publication: number;
}

/**
 * Articles that actually POSITION an outlet, before its spectrum is drawn.
 *
 * ⚠️ Counted over the labels the bar draws, which EXCLUDE `not_applicable` —
 * and not_applicable is the majority verdict in this corpus. Gating on
 * `analyzed_count` instead was wrong for every outlet it passed: 24chasa.bg
 * clears 100 analysed of which ALL 100 are not_applicable, so it rendered an
 * empty strip captioned "no analysed articles" — about an outlet with a
 * hundred of them — while bgdnes.bg drew a full-width bar from 2 positioned
 * articles out of 70. That second case is the exact "Blitz.bg is 2 of 96"
 * lie the floor exists to prevent, wearing a large analysed count.
 *
 * ⚠️ Any value between 10 and 50 selects the SAME outlets today — measured
 * 2026-08-26, no outlet sits between 11 and 49 positioned articles. So the
 * exact number is not yet a judgement call; it becomes one when the analysed
 * set grows. 30 is where the 95% interval on a proportion narrows to ±18
 * points.
 */
export const SPECTRUM_MIN_ANALYSED = 30;

/** How many of an outlet's articles carry a position on this axis. */
export const positionedCount = (
  counts: Partial<Record<string, number>>,
): number =>
  Object.entries(counts).reduce(
    (n, [label, c]) => (label === "not_applicable" ? n : n + (c ?? 0)),
    0,
  );

/**
 * Whether a distribution may be drawn for this outlet on this axis.
 *
 * ⚠️ THE ONE DEFINITION, beside its threshold. `/outlets` and `/outlet` both
 * ask it, and they were briefly two copies — which is how a directory comes
 * to show a bar for an outlet whose own page refuses to draw one.
 */
export const hasSpectrum = (counts: Partial<Record<string, number>>): boolean =>
  positionedCount(counts) >= SPECTRUM_MIN_ANALYSED;

export interface AxisSpread {
  /**
   * Population standard deviation of the positioned verdicts on a -2..+2
   * scale. 0 = every outlet in the same bucket; 2 = split between the two
   * extremes. Null when fewer than two articles carry a position.
   *
   * ⚠️ ORDINAL, not categorical. „strong_progressive vs progressive" is a
   * near miss (0.5) where „strong_progressive vs strong_conservative" is a
   * real disagreement (2.0); entropy scores those the same.
   */
  spread: number | null;
  /** Articles carrying a position on this axis — never inferred from the total. */
  n: number;
  /** Whether `n` clears TOPIC_MIN_POSITIONED. */
  enough: boolean;
}

/** Singular on purpose: a mention is one thing. See MentionBasis. */
export type MentionKind =
  | "person"
  | "party"
  | "institution"
  | "company"
  | "place";

/**
 * How the mention came to carry — or not carry — an id.
 *
 * ⚠️⚠️ THERE IS NO VALUE MEANING "we picked the highest-ranked candidate",
 * and one must never be added. Bulgarian newsrooms write two-part names while
 * the identity layer stores three: of 17 corpus names tested, ZERO matched
 * exactly and every one matched ambiguously when folded (Борисов 7
 * candidates, Радев 15, Цветан Василев 21). Rank-picking is right for one and
 * wrong for another, and the output looks identical either way.
 *
 * `ambiguous_refused` and `not_in_gazetteer` are KEPT and COUNTED so that
 * „we found no link" is never rendered as „nobody was mentioned".
 */
export type MentionBasis =
  | "gazetteer_exact"
  | "coref_resolved"
  | "ambiguous_refused"
  | "not_in_gazetteer";

/** What the entity is doing in the story — which decides whether to link. */
export type MentionRole = "subject" | "source" | "mention";

export interface Mention {
  kind: MentionKind;
  /** The string AS WRITTEN in the article, never the roster's spelling. */
  surface: string;
  basis: MentionBasis;
  /**
   * ⚠️ NULL on both refusal bases, enforced server-side. A link is a claim
   * about a named individual; only `gazetteer_exact` and `coref_resolved`
   * have earned one.
   */
  id: string | null;
  role: MentionRole;
  /** Present on `ambiguous_refused`: the entries that matched, ≥2. */
  candidates?: string[];
}

/**
 * Whether a mention may be rendered as a link — THE one definition.
 *
 * Two copies is how a story page comes to link a name that the article page
 * refuses to, about the same person.
 */
export const isLinkableMention = (m: Mention): boolean =>
  // ⚠️ TRIMMED. `Boolean("  ")` is true, so a whitespace id would render as
  // a link to `/person/%20%20`. The server rejects that shape, which is
  // precisely why the client must not depend on it having done so — one bad
  // record should cost a missing link, never a wrong one.
  Boolean(m.id?.trim()) &&
  (m.basis === "gazetteer_exact" || m.basis === "coref_resolved");

/**
 * A resolved entity, and where it lives on the MAIN site.
 *
 * ⚠️ Present only for a name the gazetteer matched outright OR a
 * hand-verified, model-classified entity override, against a route
 * electionsbg.com actually serves. Overrides never enter the free-text
 * resolver. A name that did not resolve is ABSENT from the map rather than
 * present with a null href — a renderer would happily turn a null into a
 * dead link.
 *
 * ⚠️ `canonical` must be SHOWN. All eight people this resolves today matched
 * on a two-part form, which is how newsrooms write them and is unique among
 * public figures — but the reader is the last check on whether we picked the
 * right person, and they can only perform it if they can see who we picked.
 */
export interface EntityLink {
  kind: "person" | "party" | "institution" | "company" | "place";
  id: string;
  /** The registry's own spelling — „Иван Маркос Христанов" for „Иван Христанов". */
  canonical: string;
  /** How strong the surface was as evidence. See FORM_KINDS. */
  form_kind: string;
  /** Absolute: the news app is a different origin from electionsbg.com. */
  href: string;
}

export interface TaxonomyCategory {
  id: string;
  label: { bg: string; en: string };
  route: string | null;
  article_count: number;
  story_count: number;
  /**
   * Articles whose PRIMARY topic is this one.
   *
   * ⚠️ NOT `article_count`, and the gap is not rounding: „Управление и
   * кабинет" is tagged on 7 articles and is the main subject of 0. Only
   * primary articles carry a verdict into the distributions below, so a
   * `primary_count` of 0 means „nobody wrote about this" — a different fact
   * from „nobody took a position", which is what a shortfall line says.
   */
  primary_count: number;
  /** Distinct outlets whose PRIMARY topic here is this one. */
  outlet_count: number;
  leaning: Partial<Record<Leaning, number>>;
  russia_stance: Partial<Record<RussiaStance, number>>;
  spread: { leaning: AxisSpread; russia_stance: AxisSpread };
  subcategories: {
    id: string;
    label: { bg: string; en: string };
    /**
     * A main-site page that IS this subcategory, or null.
     *
     * ⚠️ Most are null, and that is a refusal rather than a gap — see
     * news/topics.json. A chip pointing at a page about something adjacent
     * is worse than a chip that is not a link, which is the same rule
     * `entity_links` follows for names.
     */
    route: string | null;
    article_count: number;
  }[];
}

/**
 * Positioned articles a topic needs before its spread is published.
 *
 * ⚠️ NOT the same question as `positionedCount(counts)` beside it. That one
 * counts what the BAR draws (everything except not_applicable); this floor is
 * measured against `AxisSpread.n`, which counts what the SPREAD was computed
 * over (everything on the -2..+2 scale). They agree today and would diverge
 * the moment a label reached a bundle without a position — which the builder
 * now refuses, and which its own gate asserts.
 *
 * ⚠️ Measured 2026-08-26, NO topic clears this — the best is foreign-policy
 * with 15 positioned on the Russia axis and 4 on the political one. So the
 * screen ships with the measure DEFINED and every topic reported as short.
 * That is the honest state: a "most divisive topics" ranking computed over
 * n=4 would be decoration with a number attached.
 *
 * ⚠️ WRITTEN TWICE, in two languages — the server withholds the spread below
 * this and the client withholds the number. A client floor of 30 against a
 * server floor of 20 would render a spread the page's own caption calls
 * insufficient, or withhold one it had already published. They are pinned
 * together by `test_the_floor_is_the_same_number_the_client_uses` in
 * news/scripts/test_build_app_data.py, which reads this literal out of this
 * file, so moving it needs the constant to stay greppable here.
 */
export const TOPIC_MIN_POSITIONED = 20;

/**
 * Which axis a topic's disagreement should be read on — the one carrying more
 * positioned articles.
 *
 * ⚠️ Chosen PER TOPIC, not fixed. Ukraine splits on the Russia axis and the
 * budget on the political one; forcing every topic onto one axis renders the
 * wrong disagreement, or none.
 */
export const dominantAxis = (
  c: Pick<TaxonomyCategory, "spread">,
): "leaning" | "russia_stance" =>
  c.spread.russia_stance.n > c.spread.leaning.n ? "russia_stance" : "leaning";

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
export interface HomeBundle {
  version: 1;
  generated_at: string;
  eligibility: "published_recent_analyzed_and_image_rights_cleared";
  window_days: number;
  articles: ArticleRecord[];
  stories: HomeStory[];
}

export const isHomeBundle = (value: unknown): value is HomeBundle => {
  if (!value || typeof value !== "object") return false;
  const bundle = value as Partial<HomeBundle>;
  return (
    bundle.version === 1 &&
    bundle.eligibility ===
      "published_recent_analyzed_and_image_rights_cleared" &&
    Array.isArray(bundle.articles) &&
    Array.isArray(bundle.stories) &&
    bundle.articles.every(
      (article) =>
        Boolean(article.analysis) &&
        article.image_rights?.display_home === true &&
        article.image_rights.status !== "unknown" &&
        article.image_rights.status !== "blocked",
    )
  );
};

export const useHome = () => {
  const state = useData<unknown>("/home.json");
  if (state.data && !isHomeBundle(state.data)) {
    return {
      ...state,
      data: null,
      error: new Error("Невалиден договор на началния фийд"),
      loading: false,
    };
  }
  return { ...state, data: state.data as HomeBundle | null };
};
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
