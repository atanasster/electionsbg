// Types + fetcher for the static bundles produced by
// news/scripts/build_app_data.py. Development serves /news-data/ directly;
// production may follow a revalidated manifest to one immutable hourly tree.

import { useEffect, useState } from "react";
import { isPermittedHomeImageStatus } from "./imageRightsPolicy";

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

const CONFIGURED_BASE: string = (
  import.meta.env.VITE_NEWS_DATA_BASE_URL || "/news-data"
).replace(/\/$/, "");
const USE_PUBLICATION_MANIFEST = Boolean(
  import.meta.env.VITE_NEWS_DATA_BASE_URL,
);

export const DATA_REFRESH_MS = 5 * 60 * 1_000;
export const PUBLICATION_POLL_MS = 60 * 1_000;
const MANIFEST_REFRESH_MS = PUBLICATION_POLL_MS;
const FAILED_MANIFEST_RETRY_MS = 15 * 1_000;
const PUBLICATION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export interface NewsPublicationManifest {
  version: 1;
  run_id: string;
  generated_at: string;
  data_base: string;
  home_health_ready: true;
  bundle: {
    sha256: string;
    files: number;
    bytes: number;
    inventory: Array<{ path: string; bytes: number; sha256: string }>;
  };
}

const parsePublicationManifest = (value: unknown): NewsPublicationManifest => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("publication manifest: root must be an object");
  }
  const row = value as Record<string, unknown>;
  const runId = row.run_id;
  const bundle = row.bundle as Record<string, unknown> | undefined;
  const inventory = bundle?.inventory;
  const validInventory =
    Array.isArray(inventory) &&
    inventory.length === bundle?.files &&
    inventory.every((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item))
        return false;
      const file = item as Record<string, unknown>;
      return (
        typeof file.path === "string" &&
        /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+\.json$/.test(file.path) &&
        Number.isInteger(file.bytes) &&
        (file.bytes as number) >= 0 &&
        typeof file.sha256 === "string" &&
        /^[a-f0-9]{64}$/.test(file.sha256)
      );
    });
  const inventoryPaths = validInventory
    ? (inventory as Array<{ path: string }>).map((item) => item.path)
    : [];
  if (
    row.version !== 1 ||
    typeof runId !== "string" ||
    !PUBLICATION_ID.test(runId) ||
    row.data_base !== `versions/${runId}` ||
    typeof row.generated_at !== "string" ||
    !ISO_INSTANT.test(row.generated_at) ||
    !Number.isFinite(Date.parse(row.generated_at)) ||
    row.home_health_ready !== true ||
    !bundle ||
    typeof bundle.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(bundle.sha256) ||
    !Number.isInteger(bundle.files) ||
    (bundle.files as number) < 1 ||
    !Number.isInteger(bundle.bytes) ||
    (bundle.bytes as number) < 1 ||
    !validInventory ||
    new Set(inventoryPaths).size !== inventoryPaths.length ||
    (inventory as Array<{ bytes: number }>).reduce(
      (total, item) => total + item.bytes,
      0,
    ) !== bundle.bytes
  ) {
    throw new Error("publication manifest: invalid or unsafe release pointer");
  }
  return row as unknown as NewsPublicationManifest;
};

type DataCacheEntry = { promise: Promise<unknown>; expiresAt: number };

/**
 * Version-aware JSON client used by the production app and directly by tests.
 * A stable manifest is the only mutable object. Every bundle URL below it is
 * immutable, so a reader can never observe half of an hourly upload.
 */
export const createDataClient = (
  base: string,
  options: {
    usePublicationManifest?: boolean;
    now?: () => number;
    fetcher?: typeof fetch;
  } = {},
) => {
  const root = base.replace(/\/$/, "");
  const useManifest = options.usePublicationManifest ?? true;
  const now = options.now ?? Date.now;
  const fetcher = options.fetcher ?? fetch;
  const dataCache = new Map<string, DataCacheEntry>();
  let activeManifest: NewsPublicationManifest | null = null;
  let manifestExpiresAt = 0;
  let manifestPromise: Promise<NewsPublicationManifest> | null = null;

  const resolveBase = async (): Promise<string> => {
    if (!useManifest) return root;
    const instant = now();
    if (activeManifest && instant < manifestExpiresAt) {
      return `${root}/${activeManifest.data_base}`;
    }
    if (!manifestPromise) {
      manifestPromise = fetcher(`${root}/manifest.json`, {
        cache: "no-store",
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`manifest.json: HTTP ${response.status}`);
          }
          const next = parsePublicationManifest(await response.json());
          if (activeManifest?.run_id !== next.run_id) dataCache.clear();
          activeManifest = next;
          manifestExpiresAt = now() + MANIFEST_REFRESH_MS;
          return next;
        })
        .catch((error: unknown) => {
          // A warm reader stays on the last complete immutable version when
          // the pointer cannot be refreshed. Cold readers fail closed.
          if (activeManifest) {
            manifestExpiresAt = now() + FAILED_MANIFEST_RETRY_MS;
            return activeManifest;
          }
          throw error;
        })
        .finally(() => {
          manifestPromise = null;
        });
    }
    const manifest = await manifestPromise;
    return `${root}/${manifest.data_base}`;
  };

  const fetchData = async <T>(path: string): Promise<T> => {
    const resolvedBase = await resolveBase();
    const key = `${resolvedBase}${path}`;
    const instant = now();
    let entry = dataCache.get(key);
    if (!entry || entry.expiresAt <= instant) {
      const promise = fetcher(key, { cache: "force-cache" }).then(
        (response) => {
          if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
          return response.json();
        },
      );
      entry = { promise, expiresAt: instant + DATA_REFRESH_MS };
      dataCache.set(key, entry);
      promise.catch(() => {
        if (dataCache.get(key)?.promise === promise) dataCache.delete(key);
      });
    }
    return entry.promise as Promise<T>;
  };

  return { fetchData };
};

const defaultDataClient = createDataClient(CONFIGURED_BASE, {
  usePublicationManifest: USE_PUBLICATION_MANIFEST,
});

export function fetchData<T>(path: string): Promise<T> {
  return defaultDataClient.fetchData<T>(path);
}

// Minimal data hook — one fetch in flight per version + path. Mounted screens
// poll the release pointer every minute and when a backgrounded tab is shown.

export const useDataWithClient = <T>(
  path: string | null,
  client: Pick<ReturnType<typeof createDataClient>, "fetchData">,
) => {
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
    let requestSequence = 0;
    const load = (initial: boolean) => {
      const request = ++requestSequence;
      if (initial) {
        setState((prev) => ({ data: prev.data, error: null, loading: true }));
      }
      client
        .fetchData<T>(path)
        .then((data) => {
          if (live && request === requestSequence) {
            setState({ data, error: null, loading: false });
          }
        })
        .catch((error: unknown) => {
          // Keep the last good bundle on a failed refresh — consumers can still
          // render it next to the error flag instead of blanking.
          if (live && request === requestSequence)
            setState((prev) => ({
              data: prev.data,
              error: error instanceof Error ? error : new Error(String(error)),
              loading: false,
            }));
        });
    };
    load(true);
    const interval = window.setInterval(() => load(false), PUBLICATION_POLL_MS);
    const refreshVisible = () => {
      if (document.visibilityState === "visible") load(false);
    };
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      live = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [client, path]);

  return state;
};

export const useData = <T>(path: string | null) =>
  useDataWithClient<T>(path, defaultDataClient);

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
export interface HomeMergeProposal {
  keeper_story_id: string;
  matched_story_id: string;
  candidate_story_id: string;
  confidence: "high";
  shared_title_tokens: string[];
  shared_entities: string[];
  shared_places: string[];
  title_jaccard: number;
  published_gap_hours: number;
  topic: [string, string | null] | null;
}

export interface HomeHealth {
  version: 1;
  default_days: 1 | 7;
  thresholds: {
    stories_for_24h_default: number;
    maximum_implicit_days: 7;
    newest_story_max_hours: 24;
  };
  counts: Record<string, number>;
  default_age_hours: {
    newest_hours: number | null;
    median_hours: number | null;
    oldest_hours: number | null;
  };
  default_payload: Array<{
    id: string;
    title_bg: string | null;
    last_published: string | null;
    age_hours: number;
    comparison: boolean;
    image_eligible: boolean;
  }>;
  checks: Record<string, boolean>;
  ready: boolean;
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isHomeMergeProposal = (value: unknown): value is HomeMergeProposal => {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<HomeMergeProposal>;
  const validTopic =
    item.topic === null ||
    (Array.isArray(item.topic) &&
      item.topic.length === 2 &&
      typeof item.topic[0] === "string" &&
      (item.topic[1] === null || typeof item.topic[1] === "string"));
  return (
    Boolean(item.keeper_story_id?.trim()) &&
    Boolean(item.matched_story_id?.trim()) &&
    Boolean(item.candidate_story_id?.trim()) &&
    item.confidence === "high" &&
    isStringArray(item.shared_title_tokens) &&
    isStringArray(item.shared_entities) &&
    isStringArray(item.shared_places) &&
    typeof item.title_jaccard === "number" &&
    Number.isFinite(item.title_jaccard) &&
    item.title_jaccard >= 0 &&
    item.title_jaccard <= 1 &&
    typeof item.published_gap_hours === "number" &&
    Number.isFinite(item.published_gap_hours) &&
    item.published_gap_hours >= 0 &&
    item.published_gap_hours <= 48 &&
    validTopic
  );
};

const HOME_HEALTH_COUNTS = [
  "recent_raw",
  "recent_analyzed",
  "recent_story_linked",
  "recent_image_cleared",
  "selected_unique_events",
  "selected_within_24h",
  "default_visible",
  "default_comparisons",
  "default_image_eligible",
  "merge_proposals",
] as const;

const HOME_HEALTH_CHECKS = [
  "selected_payload_not_empty",
  "has_story_within_24h",
  "default_window_at_most_7_days",
  "default_payload_not_empty",
  "selected_story_ids_unique",
  "default_story_ids_unique",
  "default_oldest_within_window",
  "no_future_story_timestamps",
  "every_default_story_has_analyzed_article",
] as const;

const isNullableAge = (value: unknown): value is number | null =>
  value === null ||
  (typeof value === "number" && Number.isFinite(value) && value >= 0);

const isHomeHealth = (value: unknown): value is HomeHealth => {
  if (!isPlainRecord(value)) return false;
  const health = value as Partial<HomeHealth>;
  if (
    !isPlainRecord(health.thresholds) ||
    !isPlainRecord(health.counts) ||
    !isPlainRecord(health.default_age_hours) ||
    !isPlainRecord(health.checks)
  )
    return false;
  const thresholds = health.thresholds as unknown as Record<string, unknown>;
  const counts = health.counts as Record<string, unknown>;
  const ages = health.default_age_hours as unknown as Record<string, unknown>;
  const checks = health.checks as Record<string, unknown>;
  const requiredChecksAreTrue = HOME_HEALTH_CHECKS.every(
    (key) => checks[key] === true,
  );
  return (
    health.version === 1 &&
    (health.default_days === 1 || health.default_days === 7) &&
    thresholds.stories_for_24h_default === 6 &&
    thresholds.maximum_implicit_days === 7 &&
    thresholds.newest_story_max_hours === 24 &&
    HOME_HEALTH_COUNTS.every(
      (key) => Number.isInteger(counts[key]) && Number(counts[key]) >= 0,
    ) &&
    isNullableAge(ages.newest_hours) &&
    isNullableAge(ages.median_hours) &&
    isNullableAge(ages.oldest_hours) &&
    HOME_HEALTH_CHECKS.every((key) => typeof checks[key] === "boolean") &&
    Array.isArray(health.default_payload) &&
    health.default_payload.every(
      (item) =>
        Boolean(item?.id?.trim()) &&
        typeof item.age_hours === "number" &&
        Number.isFinite(item.age_hours) &&
        item.age_hours >= 0 &&
        (item.title_bg === null || typeof item.title_bg === "string") &&
        (item.last_published === null ||
          typeof item.last_published === "string") &&
        typeof item.comparison === "boolean" &&
        typeof item.image_eligible === "boolean",
    ) &&
    health.default_payload.length === counts.default_visible &&
    new Set(health.default_payload.map((item) => item.id)).size ===
      health.default_payload.length &&
    typeof health.ready === "boolean" &&
    health.ready === requiredChecksAreTrue
  );
};

export interface HomeBundle {
  version: 3;
  generated_at: string;
  eligibility: "published_recent_analyzed_with_cleared_images_only";
  window_days: number;
  event_dedupe: "conservative_title_entity_v1";
  merge_proposals: HomeMergeProposal[];
  home_health: HomeHealth;
  articles: ArticleRecord[];
  stories: HomeStory[];
}

export const isHomeBundle = (value: unknown): value is HomeBundle => {
  if (!value || typeof value !== "object") return false;
  const bundle = value as Partial<HomeBundle>;
  return (
    bundle.version === 3 &&
    bundle.eligibility ===
      "published_recent_analyzed_with_cleared_images_only" &&
    bundle.event_dedupe === "conservative_title_entity_v1" &&
    Array.isArray(bundle.merge_proposals) &&
    bundle.merge_proposals.every(isHomeMergeProposal) &&
    isHomeHealth(bundle.home_health) &&
    Array.isArray(bundle.articles) &&
    Array.isArray(bundle.stories) &&
    bundle.articles.every(
      (article) =>
        Boolean(article.analysis) &&
        (article.image_rights?.display_home === true
          ? Boolean(article.image) &&
            isPermittedHomeImageStatus(article.image_rights.status)
          : article.image == null),
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
