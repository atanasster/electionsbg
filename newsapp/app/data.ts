// Types + fetcher for the static bundles produced by
// news/scripts/build_app_data.py. Development serves /news-data/ directly;
// production may follow a revalidated manifest to one immutable hourly tree.

import { isCaseSlug } from "./caseSlug";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { isPermittedHomeImageStatus } from "./imageRightsPolicy";
import { isMainSiteHref } from "./site";
import {
  applyOverlayToPath,
  OverlayRemovedPath,
  compareRankedRows,
  compareStoryRows,
  mergeStoryIndexRows,
  parseOverlay,
  STORY_ID_SAFE,
  type NewsOverlay,
  type NewsOverlayPointer,
} from "./overlayMerge";
import {
  queryStories,
  QUERY_VERSION,
  type FilterIndex,
  type StoryQuery,
  type StoryQueryResult,
} from "./storyQuery";

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

export interface HumanReviewProvenance {
  status: "accepted" | "needs_revalidation";
  adjudicated_at: string;
  revision: number;
  fields: {
    leaning: "confirmed" | "changed" | "unable_to_judge";
    russia_stance: "confirmed" | "changed" | "unable_to_judge";
    party_tones: "accepted";
  };
  public_explanation: string | null;
}

export type AcceptedFeedbackField =
  | "leaning"
  | "russia_stance"
  | "party_tones"
  | "entity_links"
  | "issue_kinds";

export type AcceptedIssueKind =
  | "missing_analysis"
  | "missing_entity"
  | "wrong_entity_link"
  | "missing_topic"
  | "missing_sector"
  | "other";

export interface EditorialFeedbackProvenance {
  status: "accepted" | "needs_revalidation";
  adjudicated_at: string;
  revision: number;
  fields: AcceptedFeedbackField[];
  /** Reviewed fields whose underlying article or analysis revision changed. */
  needs_revalidation_fields: AcceptedFeedbackField[];
  issue_kinds: AcceptedIssueKind[];
  public_explanation: string | null;
}

export interface ReviewedLink {
  surface: string;
  kind:
    | "person"
    | "party"
    | "institution"
    | "company"
    | "settlement"
    | "sector";
  id: string;
  canonical: string;
  href: string;
}

/**
 * One verbatim span the model cited and the build tried to LOCATE in the
 * exact hashed text it was given. `located: false` means the quote is not
 * in the article — a paraphrase wearing quote marks — and the build has
 * already refused to let it support a label. Offsets are Unicode code
 * points into the snapshot, not UTF-16 units.
 */
export type EvidenceDirection =
  | "favorable"
  | "unfavorable"
  | "progressive"
  | "conservative"
  | "pro_russia"
  | "anti_russia";

export interface EvidenceSpan {
  quote: string;
  field: "title" | "body";
  direction: EvidenceDirection;
  voice: "journalist" | "quoted_speaker" | "unclear";
  speaker?: string;
  located?: boolean;
  start?: number;
  end?: number;
  article_content_hash?: string;
}

/**
 * T4.1b — an axis block under one of two contracts. Legacy: `evidence` is a
 * prose justification (quote OR paraphrase; never checked). v2: `rationale`
 * is the prose and `evidence_spans` the provenance; a positioned label with
 * no located span on its side ships with `label: null` and
 * `withheld_reason`, never as a neutral. `evidence_grounded` says whether
 * the located spans support the label — a fact about provenance only, not
 * a verification of the judgment.
 */
export interface AxisBlock<L extends string> {
  label: L | null;
  confidence: number | null;
  evidence?: string | null;
  rationale?: string | null;
  evidence_spans?: EvidenceSpan[];
  evidence_grounded?: boolean;
  withheld_reason?: "unsupported_evidence" | "gate_unavailable";
}

/**
 * „`rationale` is the marker, not `evidence_spans`" — the one rule for
 * telling a v2 block from a legacy one, shared with `analyze_articles.axis_is_v2`.
 */
export const isV2Axis = <L extends string>(
  b: AxisBlock<L> | null | undefined,
): b is AxisBlock<L> & { rationale: string } =>
  Boolean(b) && b!.rationale != null;

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
  leaning: AxisBlock<Leaning> | null;
  russia_stance: AxisBlock<RussiaStance> | null;
  ai_generated: {
    verdict: AiVerdict | null;
    confidence: number | null;
    signals: string[];
  } | null;
  entities: Entities | null;
  /** name → link, for the entity strings that earned one. */
  entity_links?: Record<string, EntityLink>;
  /** name → the entries it might mean, when they can be honestly offered. */
  entity_candidates?: Record<string, EntityCandidate[]>;
  /** Canonical links accepted through offline editorial review, including sectors. */
  reviewed_links?: ReviewedLink[];
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
  /**
   * T4.0 — the NEWS-PERSON identity decision per person name, a second
   * namespace beside `mentions` with its own review state and version.
   * `news_person_id` is opaque and immutable; `null` means the name stayed
   * unlinked — visible, „not assessed", counted — never that the person
   * was judged. Absent on a record with no person names.
   */
  news_persons?: NewsPersonMention[];
  party_tones: { party: string; tone: Tone }[] | null;
  topics: TopicRef[] | null;
  quality: { verdict: QualityVerdict | null; notes: string | null } | null;
  site_relevant: boolean | null;
  model: string | null;
  analyzed_at: string | null;
  /** Safe public projection; private actors, source IDs and hashes never ship. */
  human_review?: HumanReviewProvenance;
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
/**
 * What the image IS, as opposed to what we may do with it.
 *
 * ⚠️ NOT derivable from `status`. A CC-licensed photograph published in the
 * article is `cc` + `source_photo`; a CC illustration a reviewer chose for the
 * subject is `cc` + `illustration`. The status cannot tell them apart, which
 * is why this is new evidence rather than a relabelling — and why a
 * `source_photo` record must carry `source_article_url` on the outlet's own
 * domain, enforced at build time.
 */
export type ImageRole = "source_photo" | "illustration" | "official_image";

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
  /**
   * ⚠️ NULL MEANS "nobody has stated a role", never "illustration". A caption
   * renders the neutral „Изображение:" label then — it must never fabricate a
   * publisher claim, and it must not silently downgrade a real one either.
   * Absent on a bundle built before the field existed.
   */
  role?: ImageRole | null;
  /** Whether the recorded authority permits adaptation. NULL = not reviewed. */
  crop_allowed?: boolean | null;
  /** Evidence for a `source_photo` role: the outlet's own article. */
  source_article_url?: string | null;
  /**
   * Reviewed focal point as 0-1 fractions, for cropping. Presentation rather
   * than rights, but carried here because it is only meaningful when
   * `crop_allowed` is true — a focal point on a work we may not adapt has
   * nothing to steer.
   */
  focal_x?: number | null;
  focal_y?: number | null;
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
  /** Pre-community-feedback analysis baseline used by the feedback task contract. */
  feedback_analysis_sha256?: string | null;
  /**
   * Whether this article carries an analysis — the boolean the HOME bundle
   * ships in place of the object.
   *
   * ⚠️ `analysis` was 54% of home.json (18,689 of 34,452 gzipped bytes) and
   * `homeHierarchy` read it once, as a truthiness test. The full object is
   * unchanged in `articles/<domain>.json`, which the article page already
   * loads; only the first-paint bundle drops it. Absent on a bundle built
   * before the trim, which is why every reader falls back to `analysis`.
   */
  has_analysis?: boolean;
  analysis?: AnalysisBlock;
  /** Present even when the accepted finding is that analysis is missing. */
  editorial_feedback?: EditorialFeedbackProvenance;
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
  /** name → the entries it might mean, when they can be honestly offered. */
  entity_candidates?: Record<string, EntityCandidate[]>;
  aggregates: {
    article_count: number;
    outlet_count: number;
    by_leaning: Partial<Record<Leaning, number>>;
    by_russia_stance: Partial<Record<RussiaStance, number>>;
    /**
     * T5.2 — distinct outlets holding a POSITIONED label (not
     * `not_applicable`) on each axis. The card's divergence guard counts
     * these, never distinct labels; optional only so a bundle built before
     * the field existed still types, and `aggregateDivergence` then says
     * less rather than more.
     */
    leaning_outlets?: number;
    russia_stance_outlets?: number;
    /** Party label → tone → number of member articles making that tone claim. */
    by_party_tone: Record<string, Partial<Record<Tone, number>>>;
    by_domain: Record<string, number>;
  };
  blindspot: { side: "left" | "right" } | null;
  members: StoryMember[];
  /**
   * The named affairs (казуси) this story belongs to — an EDITORIAL
   * selection by the registry's fixed rule, rolled up from the members
   * that matched (plan T3.3). Absent on stories built before the registry.
   */
  case_ids?: string[];
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

export type NewsPersonBasis =
  | "registry_alias"
  | "ambiguous_registry"
  | "not_in_registry";

export interface NewsPersonMention {
  /** The name as written in the article. */
  surface: string;
  basis: NewsPersonBasis;
  /** `np_<8 hex>` — set only on `registry_alias`. */
  news_person_id: string | null;
  /** Which alias scope resolved it: `global`, `case:<slug>` or `article:<url>`. */
  alias_scope?: string;
  /** Registry version + accepted-alias digest; a treatment must carry it. */
  identity_version?: string;
  /** On `ambiguous_registry`: the identities that collided, ≥2. */
  candidates?: string[];
  /** The dictionary pass's main-site id for this surface, a reviewer's seed. */
  main_site_id?: string;
  name_bg?: string;
  name_en?: string;
  verified_main_site_slug?: string | null;
  /** Always `not_assessed` until T4.3 ships a treatment contract. */
  assessment: "not_assessed";
}

export interface NewsPersonIndexEntry {
  news_person_id: string;
  name_bg: string;
  name_en: string;
  disambiguation_bg: string | null;
  disambiguation_en: string | null;
  identity_sources: {
    url: string;
    domain?: string | null;
    published?: string | null;
  }[];
  aliases: string[];
  verified_main_site_slug: string | null;
  identity_version: string;
  reviewed_at: string | null;
  article_count: number;
}

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
 * the main site actually serves. Overrides never enter the free-text
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
  /**
   * Absolute: the news app is a different origin from the main site.
   *
   * ⚠️ RENDER IT THROUGH `mainSiteUrl`, never raw — a release minted before
   * the rebrand carries the retired host.
   */
  href: string;
}

/**
 * One entry a name MIGHT mean — an offer, never a resolution.
 *
 * ⚠️⚠️ THE DISTINCTION FROM `EntityLink` IS THE WHOLE DESIGN, and a consumer
 * that merges the two sidecars destroys it. An `EntityLink` says „this is who
 * this is"; a candidate says „this name matches several entries and we will
 * not pick". A name is in `entity_links`, or in `entity_candidates`, or in
 * neither — never in both.
 *
 * ⚠️ `detail` is what makes the list a CHOICE. Four entries all reading
 * „Аспарухово" are not one, which is why the gazetteer carries the obshtina
 * and the oblast. It is absent for kinds that have no such label.
 *
 * The server-side gates — one kind, two to five entries, and every candidate
 * servable or none of them — are in `resolve_mentions.entity_candidates`.
 */
export interface EntityCandidate {
  kind: EntityLink["kind"];
  id: string;
  canonical: string;
  detail?: string;
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
  accepted_snapshot_records_sha256: string | null;
  accepted_feedback_records_sha256: string | null;
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
/**
 * A published path inside a version tree: relative, no traversal, `.json`.
 *
 * ⚠️ BACKSLASHES ARE EXCLUDED, and that is not tidiness. The WHATWG URL
 * parser treats `\` as a path separator, so `..\..\secret.json` passes a
 * rule that only guards `/`-separated `..` segments — and `fetch` then
 * resolves it OUTSIDE the pinned `versions/<run_id>/` directory, which is
 * the one confinement this rule exists to provide. Same origin, so not a
 * cross-site hole, but it defeats the version pinning that makes a release
 * immutable.
 *
 * One definition, used by the bundle inventory and by the overlay pointer
 * — the second was a copy of the first, which is how a hole in one becomes
 * a hole in both.
 */
const PUBLISHED_PATH = /^(?!\/)(?!.*(?:^|[/\\])\.\.(?:[/\\]|$))[^\\]+\.json$/;
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export interface NewsPublicationManifest {
  /** v1/v2 are accepted during migration; new releases are v3. */
  version: 1 | 2 | 3;
  run_id: string;
  generated_at: string;
  data_base: string;
  home_health_ready: true;
  accepted_snapshot_records_sha256?: string | null;
  accepted_feedback_records_sha256?: string | null;
  bundle: {
    sha256: string;
    files: number;
    bytes: number;
    inventory: Array<{ path: string; bytes: number; sha256: string }>;
  };
  /**
   * A fast ("hot") release: the same immutable tree, plus one small object
   * carrying what changed since it (§6.5). Absent on an hourly release.
   *
   * ⚠️ THE `run_id` DOES NOT MOVE WHEN THIS DOES, and that is the whole
   * design. `dataCache.clear()` fires only on a `run_id` change, so a hot
   * release leaves every base payload the reader already holds in place
   * and costs one fetch instead of ~2,100. It also means a client that
   * does not understand the field keeps serving the hourly base rather
   * than breaking — which is why this could ship with no manifest version
   * bump and no coordinated deploy.
   */
  overlay?: NewsOverlayPointer;
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
        PUBLISHED_PATH.test(file.path) &&
        Number.isInteger(file.bytes) &&
        (file.bytes as number) >= 0 &&
        typeof file.sha256 === "string" &&
        /^[a-f0-9]{64}$/.test(file.sha256)
      );
    });
  const inventoryPaths = validInventory
    ? (inventory as Array<{ path: string }>).map((item) => item.path)
    : [];
  const validHash = (value: unknown): boolean =>
    value === null ||
    (typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
  const validAcceptedSnapshotHash =
    row.version === 1
      ? row.accepted_snapshot_records_sha256 === undefined
      : (row.version === 2 || row.version === 3) &&
        validHash(row.accepted_snapshot_records_sha256);
  const validAcceptedFeedbackHash =
    row.version === 3
      ? validHash(row.accepted_feedback_records_sha256)
      : row.accepted_feedback_records_sha256 === undefined;
  // ⚠️ A BAD OVERLAY POINTER DROPS THE OVERLAY, NEVER THE MANIFEST. The
  // base it names is a complete, immutable, already-gated release — so
  // refusing the whole pointer would take a reader from "one release
  // behind" to "no data at all", which is strictly worse for a field that
  // is optional by construction. Anything that reaches the overlay itself
  // is still fail-closed (`parseOverlay`); this is only about whether we
  // are willing to go and fetch it.
  const overlay = row.overlay;
  const validOverlay =
    overlay === undefined ||
    (Boolean(overlay) &&
      typeof overlay === "object" &&
      !Array.isArray(overlay) &&
      Number.isInteger((overlay as Record<string, unknown>).seq) &&
      ((overlay as Record<string, unknown>).seq as number) >= 1 &&
      typeof (overlay as Record<string, unknown>).path === "string" &&
      // The same rule the inventory uses — the path is concatenated onto
      // the data base to build a request, so it is not somewhere to be
      // relaxed, and not somewhere to keep a second copy either.
      PUBLISHED_PATH.test(
        (overlay as Record<string, unknown>).path as string,
      ) &&
      Number.isInteger((overlay as Record<string, unknown>).bytes) &&
      ((overlay as Record<string, unknown>).bytes as number) >= 0 &&
      typeof (overlay as Record<string, unknown>).sha256 === "string" &&
      /^[a-f0-9]{64}$/.test(
        (overlay as Record<string, unknown>).sha256 as string,
      ));
  // ⚠️ Not `delete row.overlay` — the returned object is the caller's own
  // parsed JSON, and quietly editing it makes a validator into a mutator.
  const cleaned = validOverlay ? row : { ...row, overlay: undefined };
  if (
    (row.version !== 1 && row.version !== 2 && row.version !== 3) ||
    typeof runId !== "string" ||
    !PUBLICATION_ID.test(runId) ||
    row.data_base !== `versions/${runId}` ||
    typeof row.generated_at !== "string" ||
    !ISO_INSTANT.test(row.generated_at) ||
    !Number.isFinite(Date.parse(row.generated_at)) ||
    row.home_health_ready !== true ||
    !validAcceptedSnapshotHash ||
    !validAcceptedFeedbackHash ||
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
  return cleaned as unknown as NewsPublicationManifest;
};

type DataCacheEntry = { promise: Promise<unknown>; expiresAt: number };

const NOOP = () => {};

/**
 * A failed bundle fetch, carrying the status.
 *
 * ⚠️ The STATUS is the point. With an overlay live, a 404 can mean "this
 * release introduces this file and the base tree predates it", which the
 * overlay answers — while a 5xx means we failed to ask, which it must
 * not. Both arrive as a rejected promise and are indistinguishable once
 * the status is thrown away in a message string.
 */
export class HttpStatusError extends Error {
  readonly status: number;
  constructor(path: string, status: number) {
    super(`${path}: HTTP ${status}`);
    this.status = status;
  }
}

/**
 * A payload whose bytes are not the ones the manifest published.
 *
 * ⚠️⚠️ THE MANIFEST'S HASHES WERE DECORATIVE UNTIL THIS EXISTED. Every
 * release lists `bytes` and `sha256` per file, the uploader's own comments
 * said „which is what readers verify", and nothing in the client verified
 * anything — a truncated object, a CDN serving a mixed body, or a tree
 * tampered with in the bucket would all have parsed as JSON and rendered
 * at a 200. Plan T1.5: „hashes listed in a manifest do not by themselves
 * mean the browser verifies them; define and test integrity verification
 * at publication and consumption boundaries, including overlays."
 *
 * It is thrown, not degraded: a base payload that fails its digest is a
 * FAILURE the consumer already knows how to render, and serving it would
 * be the wrong-answer-at-200 shape. The rejection also evicts it from the
 * promise cache, so the next fetch asks again rather than pinning the bad
 * bytes for the life of the release.
 */
export class IntegrityError extends Error {
  /**
   * ⚠️ PER-FILE ONLY. `bundle.sha256` (the tree digest) and the
   * `accepted_*_records_sha256` provenance hashes are an operator check,
   * not a client one — nothing here verifies the manifest itself.
   */
  readonly path: string;
  constructor(path: string, detail: string) {
    super(`${path}: integrity check failed (${detail})`);
    this.path = path;
  }
}

/** SHA-256 of `bytes`, lower-case hex — the inventory's own encoding. */
export type Digest = (bytes: ArrayBuffer) => Promise<string>;

const hex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

/**
 * The platform digest, or null where there is none.
 *
 * ⚠️ `crypto.subtle` exists only in a SECURE CONTEXT (https, or
 * localhost). Production is https and the dev server is localhost, so a
 * missing implementation is an http://<lan-ip> preview — and there the
 * client serves UNVERIFIED and says so once, rather than refusing every
 * payload. It never pretends: `integrity()` reports which it is doing.
 */
export const platformDigest = (): Digest | null => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== "function") return null;
  return async (bytes) => hex(await subtle.digest("SHA-256", bytes));
};

/**
 * Verify one published object against what the manifest said about it.
 *
 * ⚠️ BYTES FIRST, then the hash. The uploader stores objects gzip with
 * decompressive transcoding, so `bytes` describes the DECODED body — which
 * is what `arrayBuffer()` returns. A length mismatch is caught before the
 * digest is even computed, and named separately, because a truncated
 * transfer and a substituted file are different incidents.
 */
export const verifyPublished = async (
  path: string,
  bytes: ArrayBuffer,
  expected: { bytes: number; sha256: string },
  digest: Digest,
): Promise<void> => {
  if (bytes.byteLength !== expected.bytes)
    throw new IntegrityError(
      path,
      `${bytes.byteLength} bytes, manifest says ${expected.bytes}`,
    );
  const actual = await digest(bytes);
  if (actual !== expected.sha256)
    throw new IntegrityError(path, `sha256 ${actual} != ${expected.sha256}`);
};

const decodeJson = (bytes: ArrayBuffer): unknown =>
  JSON.parse(new TextDecoder().decode(bytes));

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
    /**
     * The SHA-256 used to verify every listed payload; `null` means the
     * platform has none and the client serves unverified (see
     * `platformDigest`). Injectable so a test can prove a mismatch is
     * refused without depending on the environment's WebCrypto.
     */
    digest?: Digest | null;
  } = {},
) => {
  const root = base.replace(/\/$/, "");
  const useManifest = options.usePublicationManifest ?? true;
  const now = options.now ?? Date.now;
  const fetcher = options.fetcher ?? fetch;
  const digest =
    options.digest === undefined ? platformDigest() : options.digest;
  const dataCache = new Map<string, DataCacheEntry>();
  let activeManifest: NewsPublicationManifest | null = null;
  // path → what the manifest promised, rebuilt when the manifest moves.
  let inventory = new Map<string, { bytes: number; sha256: string }>();
  let warnedUnverified = false;
  const verify = async (
    path: string,
    bytes: ArrayBuffer,
    expected: { bytes: number; sha256: string } | undefined,
  ): Promise<void> => {
    if (!expected) return;
    if (!digest) {
      if (!warnedUnverified) {
        warnedUnverified = true;
        console.warn(
          "news data: no SHA-256 implementation in this context — payloads are served UNVERIFIED",
        );
      }
      return;
    }
    await verifyPublished(path, bytes, expected, digest);
  };
  let manifestExpiresAt = 0;
  let manifestPromise: Promise<NewsPublicationManifest> | null = null;

  // The overlay object for the CURRENT manifest, once fetched. Keyed by
  // `${run_id}#${seq}`: an overlay URL is immutable, so a hit is a hit for
  // ever, and the key changing is exactly what must invalidate the merged
  // payloads below without touching the base ones.
  let overlayKey: string | null = null;
  let overlayPromise: Promise<NewsOverlay | null> | null = null;
  const mergedCache = new Map<string, { key: string; value: unknown }>();

  // ⚠️ A SYNCHRONOUS SNAPSHOT AND A SUBSCRIPTION, for the ONE consumer
  // that cannot be served by `fetchData`: the paginated story index.
  // `applyOverlayToPath` refuses to merge an index page, because a page is
  // only meaningful beside its neighbours — so `useStoryList` merges the
  // prefix it has accumulated, and needs both the overlay and a signal
  // that it changed. The signal is the load-bearing half: a base index
  // page is cached, so a poll after a hot release resolves to the SAME
  // object and no React state moves. Without a notification the list
  // screens would simply never see a hot release, which is the quiet kind
  // of broken — everything renders, the data is just old.
  let overlaySnapshot: NewsOverlay | null = null;
  const overlayListeners = new Set<() => void>();
  const publishOverlay = (next: NewsOverlay | null) => {
    if (next === overlaySnapshot) return;
    overlaySnapshot = next;
    for (const listener of overlayListeners) listener();
  };

  /**
   * ⚠️ NEVER REJECTS. A release is usable without its overlay — the base
   * is a complete immutable tree that already passed the publish gate — so
   * a missing, unfetchable or unparseable overlay leaves the reader one
   * release behind rather than with an error. The opposite choice would
   * make a transient 404 on a five-minute-old object break a page that
   * works.
   *
   * ⚠️ RETURNS ITS OWN KEY BESIDE ITS OWN OVERLAY, and that pairing is a
   * correctness rule rather than convenience. The caller awaits this and
   * then files the merged payload under a cache key; reading that key from
   * the shared `overlayKey` AFTER the await lets a slow overlay fetch —
   * one that outlives a 60 s manifest refresh — file a seq-N merge under
   * seq N+1's key. Every later call then serves it, so one hot release
   * silently does not apply, and it self-heals at seq N+2 with nothing
   * ever going red.
   */
  const resolveOverlay = async (
    manifest: NewsPublicationManifest,
  ): Promise<{ key: string; overlay: NewsOverlay | null }> => {
    const pointer = manifest.overlay;
    if (!pointer) {
      overlayKey = null;
      overlayPromise = null;
      publishOverlay(null);
      return { key: "", overlay: null };
    }
    const key = `${manifest.run_id}#${pointer.seq}`;
    if (key !== overlayKey) {
      overlayKey = key;
      overlayPromise = fetcher(
        `${root}/${manifest.data_base}/${pointer.path}`,
        {
          cache: "force-cache",
        },
      )
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`overlay: HTTP ${response.status}`);
          }
          // ⚠️ VERIFIED AGAINST THE POINTER, and a mismatch DROPS the
          // overlay rather than the release: the base is complete and
          // already gated, so the reader stays one hot release behind —
          // loudly, since a corrupt published object is an incident.
          const bytes = await response.arrayBuffer();
          await verify(pointer.path, bytes, pointer);
          return parseOverlay(decodeJson(bytes));
        })
        .catch((error: unknown) => {
          if (error instanceof IntegrityError) console.error(error.message);
          return null;
        });
    }
    const overlay = overlayPromise ? await overlayPromise : null;
    // Only for the overlay that is still current: a slow fetch that lost
    // the race must not publish itself over a newer one.
    if (key === overlayKey) publishOverlay(overlay);
    return { key, overlay };
  };

  const resolveManifest = async (): Promise<NewsPublicationManifest | null> => {
    if (!useManifest) return null;
    const instant = now();
    if (activeManifest && instant < manifestExpiresAt) {
      return activeManifest;
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
          if (activeManifest?.run_id !== next.run_id) {
            inventory = new Map(
              next.bundle.inventory.map((file) => [
                file.path,
                { bytes: file.bytes, sha256: file.sha256 },
              ]),
            );
            dataCache.clear();
            // The merged values belong to the release that was replaced;
            // keeping them would let a payload merged over the PREVIOUS
            // base survive into the next one, which is the one thing a
            // version-scoped cache exists to prevent.
            mergedCache.clear();
          }
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
    return manifestPromise;
  };

  const fetchData = async <T>(path: string): Promise<T> => {
    const manifest = await resolveManifest();
    const resolvedBase = manifest ? `${root}/${manifest.data_base}` : root;
    // The key travels WITH the overlay it names — see `resolveOverlay`.
    const { key: mergeKey, overlay } = manifest
      ? await resolveOverlay(manifest)
      : { key: "", overlay: null };
    const key = `${resolvedBase}${path}`;
    const instant = now();

    // The merged value for this path under this overlay. Held separately
    // from the base payload so that a new overlay invalidates the merge
    // and NOT the download — which is the entire saving.
    const merged = mergedCache.get(key);
    if (overlay && merged && merged.key === mergeKey) {
      return merged.value as T;
    }

    let entry = dataCache.get(key);
    if (!entry || entry.expiresAt <= instant) {
      // ⚠️ WHAT THE MANIFEST PROMISED, READ IN THE SAME FRAME AS `key`. The
      // shared `inventory` is rebuilt on a manifest rollover, and a fetch
      // that started under run-1 can complete after the poll moved to
      // run-2 — read at response time it would be checked against run-2's
      // hash and a valid payload refused with the message the check exists
      // to raise for real.
      const relative = path.replace(/^\//, "");
      const expected = manifest ? inventory.get(relative) : undefined;
      // ⚠️ UNDER A MANIFEST, AN UNLISTED PATH IS NOT IN THE RELEASE. The
      // inventory names every file in the tree (`files` must equal its
      // length), so a base object the manifest does not list is either
      // absent — the 404 the release is stating — or something put there
      // outside the publish, which must not be served as data. A file an
      // overlay introduces reaches the reader through `overlayCanSupply`,
      // never through a base fetch. A manifest-less dev tree has nothing to
      // check against and is served as is.
      const promise = (
        manifest && !expected
          ? Promise.reject(new HttpStatusError(path, 404))
          : fetcher(key, { cache: "force-cache" })
      ).then(async (response) => {
        if (!response.ok) {
          throw new HttpStatusError(path, response.status);
        }
        const bytes = await response.arrayBuffer();
        await verify(relative, bytes, expected);
        return decodeJson(bytes);
      });
      // ⚠️ A VERSIONED URL NEVER EXPIRES ONCE IT HAS ARRIVED, AND THAT IS
      // WHAT MAKES AN OVERLAY WORTH PUBLISHING. `key` contains
      // `versions/<run_id>`, so its content cannot change — re-fetching it
      // can only ever return the identical file. With the old blanket
      // 5-minute expiry a hot release at a 5-minute cadence would
      // re-download the base anyway, on the same schedule, and the overlay
      // would buy exactly nothing while looking like it worked.
      //
      // ⚠️ ON FULFILMENT, not on creation. A fetch that never settles — a
      // hung connection, no response, no rejection — would otherwise be
      // pinned for the life of the release and wedge that one path for
      // every later caller, with no retry and nothing to see it by. The
      // finite window is what lets the next call abandon it; the promise
      // only becomes permanent once there is something permanent to hold.
      // (A rejection needs no window: the `catch` below evicts it.)
      const created: DataCacheEntry = {
        promise,
        expiresAt: instant + DATA_REFRESH_MS,
      };
      entry = created;
      dataCache.set(key, entry);
      if (manifest) {
        promise.then(() => {
          created.expiresAt = Number.POSITIVE_INFINITY;
        }, NOOP);
      }
      promise.catch(() => {
        if (dataCache.get(key)?.promise === promise) dataCache.delete(key);
      });
    }
    if (!overlay) return entry.promise as Promise<T>;

    // ⚠️ A MISSING BASE IS NOT ALWAYS AN ERROR ONCE AN OVERLAY IS LIVE.
    // An outlet or a story appearing for the first time in this release
    // has no file in the base tree, so its fetch 404s — and the overlay
    // is precisely what carries it.
    //
    // ⚠️ 404 AND NOTHING ELSE. Treating ANY rejection as "absent" is the
    // dangerous version: a transient 502 on an outlet that has existed for
    // months would then render — and cache — that outlet as the handful of
    // articles the overlay happens to carry, with no error flag, which
    // reads to a person as "this outlet published three things this year".
    // An absence is a fact the release states; a 502 is our failure to ask.
    const base = await (entry.promise as Promise<unknown>).catch(
      (error: unknown) => {
        if (
          error instanceof HttpStatusError &&
          error.status === 404 &&
          overlayCanSupply(path, overlay)
        ) {
          return null;
        }
        throw error;
      },
    );
    const value = applyOverlayToPath(path, base, overlay);
    mergedCache.set(key, { key: mergeKey, value });
    return value as T;
  };

  return {
    fetchData,
    /**
     * Whether payloads are being verified against the manifest. `"off"`
     * when no manifest is in use (dev tree), `"unverified"` when the
     * platform has no digest, `"verified"` otherwise.
     */
    integrity: (): "verified" | "unverified" | "off" =>
      !useManifest ? "off" : digest ? "verified" : "unverified",
    /** The overlay in force right now, or null. Never fetches. */
    getOverlay: () => overlaySnapshot,
    subscribeOverlay: (listener: () => void) => {
      overlayListeners.add(listener);
      return () => {
        overlayListeners.delete(listener);
      };
    },
  };
};

/**
 * Can the overlay answer this path on its own, with no base file?
 *
 * Only two families can: a per-domain bundle for an outlet this release
 * introduces, and a story detail for a story it introduces. Everything
 * else is a merge INTO something, so an absent base there is a genuine
 * failure and must keep surfacing as one.
 */
const overlayCanSupply = (path: string, overlay: NewsOverlay): boolean => {
  // ⚠️ OWN properties, never `in`. These maps come from parsed JSON, so
  // they carry `Object.prototype` — and `"constructor" in overlay.articles`
  // is true for every overlay ever published. A request for
  // `/articles/constructor.json` would then be answered from the overlay
  // instead of surfacing its 404.
  const has = (map: object, name: string) =>
    Object.prototype.hasOwnProperty.call(map, name);
  const key = path.replace(/^\//, "");
  // A path the overlay carries WHOLE answers a base 404 by construction —
  // `replaced_paths` is how a singleton the base never had (the retired
  // registry on the first hot release after it shipped) reaches a hot
  // reader; overlay_merge.py's carry-whole case 1.
  if (has(overlay.replaced_paths ?? {}, key)) return true;
  const domain = /^articles\/(.+)\.json$/.exec(key);
  if (domain) return has(overlay.articles, domain[1]);
  const story = /^stories\/(.+)\.json$/.exec(key);
  return Boolean(story && has(overlay.story_details, story[1]));
};

const defaultDataClient = createDataClient(CONFIGURED_BASE, {
  usePublicationManifest: USE_PUBLICATION_MANIFEST,
});

export function fetchData<T>(path: string): Promise<T> {
  return defaultDataClient.fetchData<T>(path);
}

// Minimal data hook — one fetch in flight per version + path. Mounted screens
// poll the release pointer every minute while visible, and once when a
// backgrounded tab is shown again.

const unsafeDataCast = <T>(value: unknown): T => value as T;

export const useDataWithClient = <T>(
  path: string | null,
  client: Pick<ReturnType<typeof createDataClient>, "fetchData">,
  parse: (value: unknown) => T = unsafeDataCast,
) => {
  const [state, setState] = useState<{
    data: T | null;
    error: Error | null;
    loading: boolean;
  }>({ data: null, error: null, loading: path !== null });
  // The current path's loader, so a consumer can RETRY a failed fetch in
  // place — the promise cache evicts a rejection, so a retry really asks
  // again — rather than remounting or changing the path to force one.
  const loader = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (path === null) {
      loader.current = null;
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
        .fetchData<unknown>(path)
        .then(parse)
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
    loader.current = () => load(true);
    load(true);
    // A hidden tab does not poll. Every release clears the data cache, so a
    // forgotten background tab re-downloaded every mounted bundle on every
    // release for ever. Nobody reads a hidden tab, so it catches up once, via
    // the visibilitychange handler, when it is shown again. One predicate for
    // both, so the timer and the handler cannot disagree about "visible".
    const isShown = () => document.visibilityState !== "hidden";
    const interval = window.setInterval(() => {
      if (isShown()) load(false);
    }, PUBLICATION_POLL_MS);
    const refreshVisible = () => {
      if (isShown()) load(false);
    };
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      live = false;
      loader.current = null;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [client, parse, path]);

  const reload = useCallback(() => {
    loader.current?.();
  }, []);

  return { ...state, reload };
};

export const useData = <T>(
  path: string | null,
  parse: (value: unknown) => T = unsafeDataCast,
) => useDataWithClient<T>(path, defaultDataClient, parse);

// ---- typed bundle loaders -------------------------------------------------------
//
// Contract shared by all loaders below: on a failed refresh `data` may be
// non-null alongside `error` (last good bundle kept, see useData) — consumers
// guard the fatal case with `error && !data` and may keep rendering `data`
// otherwise.

export const useStats = () => useData<Stats>("/stats.json");

/**
 * The whole story corpus in one request.
 *
 * ⚠️ 1,456 KB gzipped, and it is the largest single object a reader
 * downloads — eleven times the entire hourly publish delta. Prefer the
 * split loaders below: `useStoryDetail` is 1.4 KB, `useStoryList` is 50 KB
 * for the first page. This stays for consumers that genuinely need every
 * story at once, and for a client older than the split.
 */
/**
 * The overlay in force, re-read when it changes.
 *
 * ⚠️ A SUBSCRIPTION, NOT A FETCH, and the subscription is the whole point.
 * `fetchData` refuses to merge an index page, so `useStoryList` does it
 * itself — but a base index page is cached, so after a hot release the
 * poll resolves to the SAME object and no React state moves. Without a
 * notification the list screens would never see a hot release: everything
 * renders, the data is just old, and nothing anywhere says so.
 *
 * `useSyncExternalStore` rather than an effect because the snapshot lives
 * in the data client, outside React, and can change between a render and
 * its commit.
 */
export const useActiveOverlay = (
  client: Pick<
    ReturnType<typeof createDataClient>,
    "getOverlay" | "subscribeOverlay"
  > = defaultDataClient,
): NewsOverlay | null =>
  useSyncExternalStore(
    client.subscribeOverlay,
    client.getOverlay,
    // ⚠️ A server snapshot, even though nothing renders this on the
    // server today: `prerender.ts` is head-only and `main.tsx` uses
    // `createRoot`. Without it the first component to render this hook in
    // any future SSR path throws outright, which is a long way from the
    // change that would cause it. There is no overlay before hydration.
    () => null,
  );

export const useStories = () =>
  useData<{ generated_at: string; stories: Story[] }>("/stories.json");

/**
 * The whole-corpus structured index behind every facet.
 *
 * ⚠️ ONE FETCH FOR THE WHOLE CORPUS, so a predicate sees every story rather
 * than the ≤16 in `home.json` or whatever prefix an outlet page has revealed.
 * ~41 KB gzipped over 3,082 stories; it carries no titles, because adding
 * them measured 288 KB and an inverted index 348 KB against a 13 KB page —
 * see `storyQuery.ts` for what that means for search.
 */
export const useFilterIndex = () =>
  useData<FilterIndex>("/stories/filter-index.json");

/**
 * Observed coverage momentum, stamped once per build (T1.2).
 *
 * ⚠️ „НАЙ-ОТРАЗЯВАНИ", NEVER „MOST POPULAR" — nothing here observes a
 * reader. `outlets` and `articles` are the components a page prints beside
 * the rank so a reader can check a number rather than trust one.
 */
export interface StoryProminence {
  version: number;
  score: number;
  outlets: number;
  articles: number;
  arriving: number;
  age_hours: number | null;
  publication_time_known: boolean;
}

/** One story's row in the paginated index — findable and filterable, small. */
export interface StoryIndexRow {
  id: string;
  title_bg: string | null;
  title_en: string | null;
  topics: TopicRef[];
  first_published: string | null;
  last_published: string | null;
  blindspot?: Story["blindspot"];
  /** How many articles are in the story, without carrying their records. */
  member_count: number;
  /** Which outlets covered it, for an outlet filter. */
  domains: string[];
  /** Absent only on rows an older overlay projected before T1.2. */
  prominence?: StoryProminence;
  /** See `Story.case_ids`. */
  case_ids?: string[];
}

/**
 * The two published orderings of the same corpus. `latest` is
 * `stories/index-N.json` (publication desc), `ranked` is
 * `stories/ranked-N.json` (prominence desc). Every story is on both.
 */
export type StorySort = "latest" | "ranked";

export interface StoryIndexPage {
  generated_at: string;
  /** The instant every row's prominence was scored against. */
  as_of?: string;
  sort?: "latest" | "prominence";
  /**
   * True when a hot overlay upserted rows into a ranked page without
   * re-scoring the corpus — the order is the base's, the membership is not.
   */
  stale_ranking?: boolean;
  page: number;
  pages: number;
  page_size: number;
  total: number;
  stories: StoryIndexRow[];
}

// ⚠️ A story id reaches a URL PATH. The build only ever writes ids matching
// this, and a client that fetched anything else would be constructing a
// request from data — so an id that does not match is refused rather than
// encoded, which is also what the producer does (build_app_data.py).
// IMPORTED, not declared: `overlayMerge.ts` builds its detail-path pattern
// from the same constant, and two copies would let the overlay resolve an
// id this loader refuses to fetch.

export const storyDetailPath = (
  id: string | null | undefined,
): string | null =>
  typeof id === "string" && STORY_ID_SAFE.test(id)
    ? `/stories/${id}.json`
    : null;

/** One cited support: the article and the verbatim words it rests on. */
export interface SynthesisCitation {
  url: string | null;
  domain: string;
  quote: string;
}

/**
 * T5.1 — the cited synthesis. Every item points at member articles and the
 * quoted span the build's gate found in them; agreement among sources is
 * not proof of truth, and `caveat_*` says so beside it.
 */
export interface StorySynthesis {
  rubric_version: string;
  /**
   * The build ships only `ok` (items) and `empty` (the gate kept nothing);
   * `failed`, `single_source` and `would_generate` never leave the cache.
   */
  status: "ok" | "empty" | "failed" | "single_source" | "would_generate";
  generated_at: string;
  outlets: string[];
  synthesis: {
    common: { claim: string; supports: SynthesisCitation[] }[];
    disputed: {
      claim: string;
      positions: (SynthesisCitation & { attributed_to: string })[];
    }[];
    emphasis: (SynthesisCitation & { note: string })[];
  } | null;
  caveat_bg: string | null;
  caveat_en: string | null;
  /** Items the gate refused — reported, never rendered. */
  dropped: number;
}

/**
 * One story, fetched on its own — 1.4 KB against the 1,456 KB bundle.
 *
 * Returns `data: null` for an id the build could never have written, which
 * a caller sees exactly as it sees "no such story".
 */
export const useStoryDetail = (id: string | null | undefined) =>
  useData<{
    generated_at: string;
    story: Story;
    /** Resolved by the build — see `RelatedStoryRow`. */
    related?: RelatedStoryRow[];
    /** Present only when the cache matched this exact membership. */
    synthesis?: StorySynthesis;
  }>(storyDetailPath(id));

/**
 * A related story as the sidebar renders it.
 *
 * ⚠️ Resolved at BUILD time, not in the client, because half of relatedness
 * is reciprocal — stories pointing back at this one — and that is invisible
 * from a single story's record. Resolving it in the client was the one
 * reason StoryScreen needed the entire 1,456 KB corpus.
 */
export interface RelatedStoryRow {
  id: string;
  title_bg: string | null;
  title_en: string | null;
  first_published: string | null;
  outlet_count: number | null;
}

/**
 * Titles for an arbitrary set of saved story ids.
 *
 * ⚠️ THE ONE LOOKUP THE SPLIT DOES NOT ANSWER, which is why this is a
 * hook of its own rather than a call to either loader. A saved id may sit
 * on any index page, so the paginated index cannot answer it without
 * fetching every page; and hooks cannot be called in a loop, so
 * `useStoryDetail` cannot be applied to a list whose length changes. It
 * fetches one ~1.4 KB detail file per id — twenty saves is ~28 KB against
 * the 1,456 KB corpus this replaced, and every story the reader has
 * already opened is already in the cache.
 *
 * ⚠️ A MISSING STORY IS AN ANSWER; A FAILED REQUEST IS NOT, AND THE TWO
 * MUST NOT RENDER THE SAME. Stories merge, so a saved id can stop
 * existing and its file 404s — that is the release stating an absence,
 * and it resolves to `"gone"`. Any OTHER failure is us failing to ask,
 * and it resolves to `"failed"`: offline, or on a 502, a reader must not
 * be told every story they saved has been merged away. This is the same
 * rule `fetchData` applies to the overlay's absent-base arm — "404 and
 * nothing else" — and the first cut of this hook broke it with a bare
 * `catch`.
 *
 * So there are FOUR states, and a caller has to render all four: an id
 * absent from the map is still loading, `"gone"` is retired, `"failed"`
 * is unreachable, and an object is the title.
 */
export const useStoryTitles = (
  ids: readonly string[],
  client: Pick<
    ReturnType<typeof createDataClient>,
    "fetchData"
  > = defaultDataClient,
) => {
  // A stable dependency: the array identity changes on every render of a
  // caller that builds it inline, which would re-fetch for ever.
  const key = ids.join("\u0000");
  const [state, setState] = useState<{
    titles: Map<string, StoryTitleResult>;
    loading: boolean;
  }>({ titles: new Map(), loading: ids.length > 0 });

  useEffect(() => {
    const wanted = key ? key.split("\u0000") : [];
    if (wanted.length === 0) {
      setState({ titles: new Map(), loading: false });
      return;
    }
    let live = true;
    setState((prev) => ({ titles: prev.titles, loading: true }));
    void Promise.all(
      wanted.map(async (id): Promise<[string, StoryTitleResult]> => {
        const path = storyDetailPath(id);
        // An id the producer could never have written names no story, so
        // it is gone rather than unreachable — nothing was asked for.
        if (path === null) return [id, "gone"];
        try {
          const payload = await client.fetchData<{ story: Story }>(path);
          const story = payload?.story;
          return [
            id,
            story
              ? { id, title_bg: story.title_bg, title_en: story.title_en }
              : "gone",
          ];
        } catch (error: unknown) {
          return [id, storyIsGone(error) ? "gone" : "failed"];
        }
      }),
    ).then((rows) => {
      if (live) setState({ titles: new Map(rows), loading: false });
    });
    return () => {
      live = false;
    };
  }, [key, client]);

  return state;
};

export interface StoryTitle {
  id: string;
  title_bg: string | null;
  title_en: string | null;
}

/** A title, a story the release retired, or a request that did not land. */
export type StoryTitleResult = StoryTitle | "gone" | "failed";

/**
 * Does this failure mean the story is not in the release, as opposed to
 * meaning we could not ask?
 *
 * 404 is the release stating an absence. `OverlayRemovedPath` is a hot
 * release stating the same thing about a path it retired. Everything
 * else — offline, DNS, 502, a parse error — is our failure.
 */
export const storyIsGone = (error: unknown): boolean =>
  (error instanceof HttpStatusError && error.status === 404) ||
  error instanceof OverlayRemovedPath;

/**
 * Why a story id the release no longer serves stopped being served.
 *
 * ⚠️ THE READER-FACING HALF OF T1.5's CONTINUITY GATE. A story id, once
 * published, is served by every later release unless the human-owned
 * registry (`news/config/retired_stories.json` → `stories/retired.json`)
 * says why not — the uploader refuses a public release that drops one it
 * does not name. So a 404 on `/story/:id` has exactly two honest readings:
 * „retired, and here is why" or „never published"; a bare „not found"
 * would present a deliberate withdrawal as a broken link.
 */
export interface RetiredStory {
  reason: "withdrawn" | "merged" | "error";
  on: string;
  note: string;
  /** The story that replaced it — `merged` only. */
  target?: string;
}

export const useRetiredStories = (enabled: boolean) =>
  useData<{
    generated_at: string;
    version: number;
    retired: Record<string, RetiredStory>;
  }>(enabled ? "/stories/retired.json" : null);

/** url → story id, so an article page can find its story without the corpus. */
export const useStoriesByUrl = () =>
  useData<{ generated_at: string; stories_by_url: Record<string, string> }>(
    "/stories/by-url.json",
  );

/**
 * ⚠️ TWO VOCABULARIES FOR ONE ORDERING, mapped ONCE. The client names an
 * ordering by its FILE prefix (`ranked-N`); the page names it by its RULE
 * (`sort: "prominence"`). The path builder and the merge's provenance check
 * both read this table, so a page can be refused when it is not the ordering
 * the caller is revealing.
 */
export const PAGE_SORT: Record<
  StorySort,
  NonNullable<StoryIndexPage["sort"]>
> = {
  latest: "latest",
  ranked: "prominence",
};
const PAGE_PREFIX: Record<StorySort, string> = {
  latest: "index",
  ranked: "ranked",
};

export const storyIndexPagePath = (
  page: number | null,
  sort: StorySort = "latest",
): string | null =>
  typeof page === "number" && Number.isInteger(page) && page >= 1
    ? `/stories/${PAGE_PREFIX[sort]}-${page}.json`
    : null;

export const useStoryIndexPage = (
  page: number | null,
  sort: StorySort = "latest",
  client: StoryListClient = defaultDataClient,
) => useDataWithClient<StoryIndexPage>(storyIndexPagePath(page, sort), client);

/** What `useStoryList` needs of a data client — injectable for tests. */
export type StoryListClient = Pick<
  ReturnType<typeof createDataClient>,
  "fetchData" | "getOverlay" | "subscribeOverlay"
>;

/**
 * The story index with progressive reveal: page 1 on mount, more on request.
 *
 * Page 1 is the newest 200 stories (~50 KB gzipped), which is what a list
 * screen needs to paint; `loadMore()` reveals the next page and the rows
 * accumulate in order.
 *
 * ⚠️ The accumulated rows are REPLACED, not appended to, when a release
 * lands. `useData` re-fetches every page on its own poll, so a story that
 * moved between pages would otherwise appear twice — and a story deleted
 * upstream would never leave. Keyed by id and rebuilt from the pages that
 * are currently loaded, so the list is always a view of one vintage.
 */
/**
 * The revealed rows and the count that captions them, from one pass.
 *
 * ⚠️ ONE FUNCTION, TWO OUTPUTS, BECAUSE THEY MUST NOT BE ABLE TO
 * DISAGREE. These were two exported functions and they did: the list
 * injected every story the overlay touched while the count refused to
 * count the ones that sort below the revealed prefix, so a reader could
 * see three rows under the caption "2". Both now derive from the same
 * boundary, computed once.
 *
 * ⚠️ SORTED FROM CONTENT, NOT FROM ARRIVAL. The rows live in a `Map`,
 * which iterates in insertion order — so before this a story that moved
 * to the front between releases kept the position it was first seen at,
 * and the list claimed to be newest-first while quietly not being. The
 * order is the publisher's own (`story_sort_key`), which is also what
 * makes merging an overlay row into the middle of the list meaningful.
 *
 * ⚠️ AND THE MERGE IS OVER THE PREFIX, WHICH IS WHY IT IS HERE AND NOT
 * IN THE DATA CLIENT. `applyOverlayToPath` refuses an index PAGE: pages
 * are slices of one whole-corpus ordering, so a page merged alone
 * duplicates or drops stories at its own boundary — and recomputes its
 * own `total`, so nothing looks wrong. A prefix has no such problem,
 * PROVIDED it stays a prefix: a story the overlay touched on page 5 does
 * not belong in a two-page prefix, and `belongs` below is what keeps it
 * out.
 */
export const storyListView = ({
  revealed,
  overlay,
  baseTotal,
  hasMore,
  sort = "latest",
}: {
  /** The rows fetched from the BASE index, in any order. */
  revealed: StoryIndexRow[];
  overlay: NewsOverlay | null;
  baseTotal: number | null;
  hasMore: boolean;
  /**
   * Which ordering the prefix was revealed in. ⚠️ THE BOUNDARY IS DEFINED BY
   * THE ORDER: a ranked prefix ends at its lowest SCORE, not its oldest
   * date, and confining an overlay story by the wrong key would inject a
   * fresh low-scoring story into a ranked prefix that ends far above it.
   */
  sort?: StorySort;
}): {
  stories: StoryIndexRow[];
  total: number;
  /**
   * Whether the overlay ADDED or REMOVED a row within this prefix — as
   * opposed to merely touching one already there. A ranked list says its
   * order is the base's only when this is true; saying it on every overlay
   * would assert additions that did not happen.
   */
  merged: boolean;
} => {
  const rows = revealed as unknown as Array<Record<string, unknown>>;
  const compare = sort === "ranked" ? compareRankedRows : compareStoryRows;
  if (!overlay) {
    const stories = [...rows].sort(compare) as unknown as StoryIndexRow[];
    return { stories, total: baseTotal ?? stories.length, merged: false };
  }

  const revealedIds = new Set(revealed.map((row) => row.id));
  // The revealed row that sorts LAST under this order — the prefix's edge.
  let edge: Record<string, unknown> | null = null;
  for (const row of rows) {
    if (edge === null || compare(row, edge) > 0) edge = row;
  }
  // Once every page is loaded the prefix IS the corpus, so nothing is out
  // of range and the boundary does not apply.
  const confine = hasMore && edge !== null;
  const belongs = (story: Record<string, unknown>): boolean => {
    const id = story.id;
    if (typeof id === "string" && revealedIds.has(id)) return true;
    return !confine || compare(story, edge as Record<string, unknown>) <= 0;
  };

  const stories = mergeStoryIndexRows(
    rows,
    overlay,
    belongs,
    compare,
  ) as unknown as StoryIndexRow[];

  /**
   * ⚠️ A STORY THE OVERLAY MERELY TOUCHED IS NOT A NEW STORY.
   * `story_details` changes when a story gains a RECIPROCAL `related`
   * link and nothing else about it moves, so counting every entry would
   * inflate the caption on every hot release. What counts is an id that
   * is not already revealed and that `belongs` — i.e. one the merged list
   * above actually added.
   */
  let added = 0;
  for (const [id, detail] of Object.entries(overlay.story_details)) {
    if (revealedIds.has(id)) continue;
    const story = (detail as { story?: Record<string, unknown> }).story ?? {};
    if (belongs(story)) added += 1;
  }
  const removed = overlay.removed_story_ids.filter((id: string) =>
    revealedIds.has(id),
  ).length;
  const merged = added + removed > 0;
  if (baseTotal === null || !hasMore)
    return { stories, total: stories.length, merged };
  return { stories, total: baseTotal + added - removed, merged };
};

export const useStoryList = (
  sort: StorySort = "latest",
  client: StoryListClient = defaultDataClient,
) => {
  const [page, setPage] = useState(1);
  // Rows revealed so far, keyed by id so a story that moved between pages
  // between releases appears once rather than twice.
  const [rows, setRows] = useState<Map<string, StoryIndexRow>>(new Map());
  const [vintage, setVintage] = useState<string | null>(null);
  // ⚠️ The instant the ranking was scored against, off page 1. A browse pins
  // it: two pages ranked against different instants are two rankings.
  const [asOf, setAsOf] = useState<string | null>(null);
  // ⚠️ A SORT CHANGE IS A NEW LIST, never a re-sort of the rows in hand.
  // The rows are a PREFIX of one ordering; re-sorted by another key they
  // are an arbitrary sample of it, presented as its top.
  const [revealedSort, setRevealedSort] = useState(sort);
  useEffect(() => {
    if (revealedSort === sort) return;
    setRows(new Map());
    setVintage(null);
    setAsOf(null);
    setPage(1);
    setRevealedSort(sort);
  }, [sort, revealedSort]);
  // ⚠️ FETCHED BY THE REVEALED SORT, NOT THE REQUESTED ONE. Fetching by the
  // requested sort changes the path one effect BEFORE the reset to page 1,
  // and `fetchData` is a promise cache — a page N of the new ordering seen
  // earlier in the session resolves in microtasks, so it could land in the
  // freshly emptied map ahead of page 1: pages 1 and N, no 2, every count
  // reconciling. The path moves only once the reset has run.
  const current = useStoryIndexPage(page, revealedSort, client);
  const overlay = useActiveOverlay(client);

  useEffect(() => {
    const loaded = current.data;
    if (!loaded) return;
    // A page is merged only into the ordering it was published for — the
    // page's own `sort` is the provenance, and a page from the other
    // ordering is refused rather than mixed in.
    if (loaded.sort !== undefined && loaded.sort !== PAGE_SORT[revealedSort])
      return;
    setRows((prev) => {
      const next = new Map(prev);
      for (const row of loaded.stories) next.set(row.id, row);
      return next;
    });
    setVintage((prev) => prev ?? loaded.generated_at);
    setAsOf((prev) => prev ?? loaded.as_of ?? loaded.generated_at);
  }, [current.data, revealedSort]);

  // ⚠️ A RELEASE IS REPORTED, NOT APPLIED SILENTLY. `useData` re-polls the
  // page currently in view, so after a publish the revealed rows are a
  // mixture of two vintages — newly loaded ones fresh, earlier pages as
  // they were. Resetting would throw away the reader's position mid-scroll;
  // pretending it had not happened would let a story deleted upstream stay
  // on the list for ever. So the mixture is allowed and declared, and the
  // screen can offer a refresh.
  const staleVintage = Boolean(
    vintage && current.data && current.data.generated_at !== vintage,
  );

  const reset = useCallback(() => {
    setRows(new Map());
    setVintage(null);
    setAsOf(null);
    setPage(1);
  }, []);

  const pageCount = current.data?.pages ?? 1;
  const hasMore = page < pageCount;

  const { stories, total, merged } = useMemo(
    () =>
      storyListView({
        revealed: [...rows.values()],
        overlay,
        baseTotal: current.data?.total ?? null,
        hasMore,
        sort: revealedSort,
      }),
    [rows, overlay, current.data?.total, hasMore, revealedSort],
  );
  // ⚠️ The page in hand is the one asked for. After a failed fetch `useData`
  // keeps the PREVIOUS page's data beside `error`, so `current.data.page`
  // lags `page` — and advancing from there would skip the page that never
  // landed, leaving a hole in a list that calls itself a prefix.
  const pageInHand = current.data?.page === page;

  return {
    stories,
    total,
    /** The base vintage the prefix was revealed from (page 1's stamp). */
    vintage,
    /** The ranking instant, for pinning a browse. */
    asOf,
    /** Whether the revealed prefix is in the ordering the caller asked for. */
    sort: revealedSort,
    /**
     * Whether a hot overlay added or removed a row inside the prefix. The
     * publisher's own `stale_ranking` never reaches the client — index pages
     * are always served from the base — so this is derived from the merge.
     */
    merged,
    loading: current.loading,
    // The last good rows survive a failed refresh, matching every other
    // loader here — a consumer guards the fatal case with `error && !rows`.
    error: current.error,
    hasMore,
    /**
     * Reveal the next page — ⚠️ only from a page that actually arrived. A
     * failed page must be retried (`retry`), never stepped over.
     */
    loadMore: useCallback(() => {
      if (!pageInHand) return;
      setPage((n) => (n < pageCount ? n + 1 : n));
    }, [pageCount, pageInHand]),
    /** Ask again for the page that failed, keeping the revealed prefix. */
    retry: current.reload,
    staleVintage,
    reset,
  };
};
/**
 * One query answered over the WHOLE corpus, not over what has downloaded.
 *
 * ⚠️⚠️ THE DISTINCTION EVERY CONSUMER MUST KEEP. `useStoryList` reveals an
 * ordered PREFIX — page 1, then page 2 — so a predicate applied to its rows
 * answers „how many of the ones I have", and every screen that printed that
 * number presented it as „how many there are". This hook answers the second
 * question from `stories/filter-index.json`, which carries every story's
 * window, topics and outlets for the whole corpus.
 *
 * ⚠️ `ready` IS NOT `!loading`, AND CONFLATING THEM REPRODUCES THE DEFECT.
 * Before the index lands, and after a failed fetch, `result.total` is 0 — a
 * number shaped exactly like „this outlet appears in no story". A consumer
 * renders a count only when `ready`, and says „не можахме да преброим" (not
 * „0") when `error` is set. Nothing here degrades a failure to a zero.
 */
export const useGlobalStoryQuery = (
  query: StoryQuery,
): {
  result: StoryQueryResult;
  ready: boolean;
  loading: boolean;
  error: Error | null;
} => {
  const index = useFilterIndex();
  const { category, domain, days, now } = query;
  /**
   * ⚠️ AN UNRECOGNISED CONTRACT IS A FAILURE, NEVER A NARROWER ANSWER. The
   * rows are POSITIONAL, so a v2 that reorders or extends them parses
   * cleanly as v1 and answers wrongly: every facet re-buckets on whatever
   * v2 put at `row[2]`, and `withinDays` rejects the non-ISO value now at
   * `row[1]`, so the whole corpus drops out of every window and the page
   * says „no stories match" at a 200. Refusing it surfaces as `error`,
   * which every consumer already distinguishes from an empty corpus.
   */
  const usable =
    index.data && index.data.query_version === QUERY_VERSION
      ? index.data
      : null;
  const versionError = useMemo(
    () =>
      index.data && !usable
        ? new Error(
            `filter-index query_version ${index.data.query_version} != ${QUERY_VERSION}`,
          )
        : null,
    [index.data, usable],
  );
  const result = useMemo(
    () => queryStories(usable, { category, domain, days, now }),
    [usable, category, domain, days, now],
  );
  return {
    result,
    ready: Boolean(usable),
    loading: index.loading,
    error: index.error ?? versionError,
  };
};

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

const IMAGE_ROLES: readonly string[] = [
  "source_photo",
  "illustration",
  "official_image",
];

/**
 * Defence in depth for the provenance a caption is allowed to render.
 *
 * The build enforces all of this already, so it can only fire on a hand-edited
 * or truncated bundle — which is exactly when it matters, because the caption
 * it feeds names a publisher. Unknown roles are rejected rather than ignored:
 * rendering an unrecognised one as the neutral label would make a typo
 * indistinguishable from a decision.
 *
 * ⚠️ It must not ACCEPT what the build REFUSES. A guard that is merely weaker
 * is not defence in depth — it is a second, more permissive contract that
 * decides what the page renders. The domain check in particular is available
 * here (`ArticleRecord.domain` is on the same record) and was missing from the
 * first cut, so an off-domain `source_article_url` passed the client while the
 * build rejected it.
 */
const isStatedImageRole = (article: ArticleRecord): boolean => {
  const rights = article.image_rights;
  if (!rights) return true;
  const { role, crop_allowed, focal_x, focal_y } = rights;
  const fraction = (value: number | null | undefined) =>
    value === undefined || value === null || (value >= 0 && value <= 1);
  if (!fraction(focal_x) || !fraction(focal_y)) return false;
  // A focal point steers a crop, so it needs adaptation to be PERMITTED.
  if ((focal_x != null || focal_y != null) && crop_allowed !== true)
    return false;
  if (
    crop_allowed !== undefined &&
    crop_allowed !== null &&
    typeof crop_allowed !== "boolean"
  )
    return false;
  if (role === undefined || role === null) return true;
  if (!IMAGE_ROLES.includes(role)) return false;
  if (role !== "source_photo") return true;
  const evidence = rights.source_article_url;
  if (!evidence) return false;
  let host: string;
  try {
    host = new URL(evidence).hostname.toLowerCase();
  } catch {
    return false;
  }
  const domain = article.domain.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
};

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
        Boolean(article.has_analysis ?? article.analysis) &&
        (article.image_rights?.display_home === true
          ? Boolean(article.image) &&
            isPermittedHomeImageStatus(article.image_rights.status)
          : article.image == null) &&
        isStatedImageRole(article),
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
// ---- cases (T3.3) ---------------------------------------------------------------
//
// ⚠️ A CASE IS AN EDITORIAL SELECTION, NEVER A MODEL DECISION. The registry
// (`news/config/cases.json`) is human-owned; the build attaches articles by
// the fixed rule each entry carries and publishes the EVIDENCE beside every
// inclusion. `membership: "review"` means the rule did not earn auto-attach
// against its fixtures — an empty timeline there is „not published", not
// „no coverage", and the page must say which.

/** Reader-facing registry prose is `{bg, en}` — the page renders ONE
 *  language, and an English string under a Bulgarian heading is a defect no
 *  count sees. `load_cases` refuses a monolingual value. */
export type CaseText = { bg: string; en: string };

export interface CaseSource {
  claim: CaseText;
  url: string;
  domain: string;
  published: string;
}

export interface CaseContestedClaim {
  claim: CaseText;
  speaker: CaseText;
  date: string;
  source_url: string;
  response: CaseText | null;
  response_source_url?: string | null;
  note?: CaseText;
}

export interface CaseEvidence {
  basis: "rule" | "override";
  rule_version: number;
  terms: string[];
  /** Participants whose mention counts as naming the affair (`anchor_terms`). */
  anchors?: string[];
  context: string[];
  hits: number | null;
}

export interface CaseTimelineStory {
  story_id: string;
  title_bg: string | null;
  title_en: string | null;
  first_published: string | null;
  last_published: string | null;
  topics: TopicRef[];
  outlets: string[];
  supporting: Array<{
    article_id: string | null;
    domain: string;
    url: string | null;
    published: string | null;
    evidence: CaseEvidence;
  }>;
  /** The story's whole membership — `supporting.length / member_count` is
   *  how much of the story the case actually explains. */
  member_count: number;
}

export interface CaseSummary {
  slug: string;
  name: CaseText;
  description: CaseText;
  opened_on: string;
  membership: "attached" | "review";
  story_count: number;
  article_count: number;
  first_published: string | null;
  last_published: string | null;
  outlets: Record<string, number>;
  rule_version: number;
}

export interface CasePayload extends CaseSummary {
  generated_at: string;
  reviewer: string;
  reviewed_on: string;
  sources: CaseSource[];
  contested: CaseContestedClaim[];
  rule: {
    basis: CaseText;
    required_terms: string[];
    anchor_terms?: string[];
    context_terms: string[];
    excluded_terms: string[];
    min_required_hits?: number;
  };
  namesakes: Array<{ name: string; note: CaseText }>;
  ambiguous_match: "review" | "clear";
  history: Array<{
    date: string;
    rule_version: number;
    by: string;
    change: string;
  }>;
  editorial_note: CaseText;
  verification: {
    ok: boolean;
    reason: "no_fixtures" | "fixtures_failed" | null;
    checked: number;
    failed: Array<Record<string, unknown>>;
  };
  timeline: CaseTimelineStory[];
  framing: {
    by_leaning: Partial<Record<Leaning, number>>;
    by_russia_stance: Partial<Record<RussiaStance, number>>;
    rated: number;
    articles: number;
  };
}

export const caseDetailPath = (
  slug: string | null | undefined,
): string | null => (isCaseSlug(slug) ? `/cases/${slug}.json` : null);

export const useCases = (enabled = true) =>
  useData<{
    generated_at: string;
    version: number;
    editorial_note: { bg: string; en: string };
    cases: CaseSummary[];
  }>(enabled ? "/cases.json" : null);

export const useCase = (slug: string | null | undefined) =>
  useData<CasePayload>(caseDetailPath(slug));

export const useTaxonomy = () =>
  useData<{ version: number; categories: TaxonomyCategory[] }>(
    "/taxonomy.json",
  );
export const useOutlets = () =>
  useData<{ generated_at: string; outlets: Outlet[] }>("/outlets.json");

const exactRecordKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean => {
  const keys = Object.keys(value).sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === [...expected].sort()[index])
  );
};

const validPublicAxis = (
  value: unknown,
): value is NonNullable<AnalysisBlock["leaning"]> => {
  if (!isPlainRecord(value)) return false;
  const confidence = value.confidence;
  return (
    confidence === null ||
    (typeof confidence === "number" &&
      Number.isFinite(confidence) &&
      confidence >= 0 &&
      confidence <= 1)
  );
};

export const isPublicHumanReview = (
  value: unknown,
  analysis: Pick<AnalysisBlock, "leaning" | "russia_stance" | "party_tones">,
): value is HumanReviewProvenance => {
  if (
    !isPlainRecord(value) ||
    !exactRecordKeys(value, [
      "status",
      "adjudicated_at",
      "revision",
      "fields",
      "public_explanation",
    ]) ||
    (value.status !== "accepted" && value.status !== "needs_revalidation") ||
    typeof value.adjudicated_at !== "string" ||
    !Number.isFinite(Date.parse(value.adjudicated_at)) ||
    !Number.isInteger(value.revision) ||
    (value.revision as number) < 1 ||
    (value.public_explanation !== null &&
      typeof value.public_explanation !== "string") ||
    !isPlainRecord(value.fields) ||
    !exactRecordKeys(value.fields, ["leaning", "russia_stance", "party_tones"])
  )
    return false;
  const scalarDispositions = [
    "confirmed",
    "changed",
    "unable_to_judge",
  ] as const;
  if (
    !scalarDispositions.includes(
      value.fields.leaning as (typeof scalarDispositions)[number],
    ) ||
    !scalarDispositions.includes(
      value.fields.russia_stance as (typeof scalarDispositions)[number],
    ) ||
    value.fields.party_tones !== "accepted" ||
    !validPublicAxis(analysis.leaning) ||
    !validPublicAxis(analysis.russia_stance) ||
    !Array.isArray(analysis.party_tones)
  )
    return false;
  if (value.status === "accepted") {
    for (const field of ["leaning", "russia_stance"] as const) {
      if (
        value.fields[field] !== "unable_to_judge" &&
        analysis[field]?.confidence !== null
      )
        return false;
    }
    if (
      analysis.party_tones.some((item) => {
        if (!isPlainRecord(item)) return true;
        return (item as unknown as Record<string, unknown>).confidence !== null;
      })
    )
      return false;
  }
  return true;
};

const FEEDBACK_FIELDS: AcceptedFeedbackField[] = [
  "leaning",
  "russia_stance",
  "party_tones",
  "entity_links",
  "issue_kinds",
];
const ISSUE_KINDS: AcceptedIssueKind[] = [
  "missing_analysis",
  "missing_entity",
  "wrong_entity_link",
  "missing_topic",
  "missing_sector",
  "other",
];

export const isPublicEditorialFeedback = (
  value: unknown,
): value is EditorialFeedbackProvenance => {
  if (
    !isPlainRecord(value) ||
    !exactRecordKeys(value, [
      "status",
      "adjudicated_at",
      "revision",
      "fields",
      "needs_revalidation_fields",
      "issue_kinds",
      "public_explanation",
    ])
  )
    return false;
  const revalidationFields = value.needs_revalidation_fields;
  return (
    (value.status === "accepted" || value.status === "needs_revalidation") &&
    typeof value.adjudicated_at === "string" &&
    Number.isFinite(Date.parse(value.adjudicated_at)) &&
    Number.isInteger(value.revision) &&
    (value.revision as number) >= 1 &&
    Array.isArray(value.fields) &&
    value.fields.every((field) =>
      FEEDBACK_FIELDS.includes(field as AcceptedFeedbackField),
    ) &&
    new Set(value.fields).size === value.fields.length &&
    Array.isArray(revalidationFields) &&
    revalidationFields.every((field) =>
      FEEDBACK_FIELDS.includes(field as AcceptedFeedbackField),
    ) &&
    new Set(revalidationFields).size === revalidationFields.length &&
    value.fields.every((field) => !revalidationFields.includes(field)) &&
    Array.isArray(value.issue_kinds) &&
    value.issue_kinds.every((kind) =>
      ISSUE_KINDS.includes(kind as AcceptedIssueKind),
    ) &&
    new Set(value.issue_kinds).size === value.issue_kinds.length &&
    (value.public_explanation === null ||
      typeof value.public_explanation === "string")
  );
};

const isPublicReviewedLinks = (value: unknown): value is ReviewedLink[] =>
  Array.isArray(value) &&
  value.length <= 20 &&
  value.every((raw) => {
    if (
      !isPlainRecord(raw) ||
      !exactRecordKeys(raw, ["surface", "kind", "id", "canonical", "href"])
    )
      return false;
    return (
      typeof raw.surface === "string" &&
      raw.surface.length > 0 &&
      [
        "person",
        "party",
        "institution",
        "company",
        "settlement",
        "sector",
      ].includes(String(raw.kind)) &&
      typeof raw.id === "string" &&
      raw.id.length > 0 &&
      typeof raw.canonical === "string" &&
      raw.canonical.length > 0 &&
      typeof raw.href === "string" &&
      // ⚠️ BOTH HOSTS — see MAIN_SITE_HOSTS. A release published before the
      // rebrand carries `electionsbg.com`, and narrowing this to the new
      // host would reject every reviewed link in it at a 200.
      !/\s/.test(raw.href) &&
      isMainSiteHref(raw.href)
    );
  });

export interface OutletArticlesBundle {
  domain: string;
  outlet: string;
  generated_at: string;
  articles: ArticleRecord[];
}

export const parseOutletArticlesBundle = (
  value: unknown,
): OutletArticlesBundle => {
  if (
    !isPlainRecord(value) ||
    typeof value.domain !== "string" ||
    typeof value.outlet !== "string" ||
    typeof value.generated_at !== "string" ||
    !Array.isArray(value.articles)
  )
    throw new Error("Невалиден договор на пакета със статии");
  for (const rawArticle of value.articles) {
    if (
      !isPlainRecord(rawArticle) ||
      typeof rawArticle.id !== "string" ||
      typeof rawArticle.domain !== "string"
    )
      throw new Error("Невалиден договор на статия");
    if (
      "editorial_feedback" in rawArticle &&
      !isPublicEditorialFeedback(rawArticle.editorial_feedback)
    )
      throw new Error("Невалиден договор на приетата обратна връзка");
    if (
      "feedback_analysis_sha256" in rawArticle &&
      rawArticle.feedback_analysis_sha256 !== null &&
      (typeof rawArticle.feedback_analysis_sha256 !== "string" ||
        !/^sha256:[a-f0-9]{64}$/.test(rawArticle.feedback_analysis_sha256))
    )
      throw new Error("Невалиден договор на основата за обратна връзка");
    if (rawArticle.analysis === undefined) continue;
    if (!isPlainRecord(rawArticle.analysis))
      throw new Error("Невалиден договор на анализа");
    if (
      "human_review" in rawArticle.analysis &&
      !isPublicHumanReview(
        rawArticle.analysis.human_review,
        rawArticle.analysis as unknown as Pick<
          AnalysisBlock,
          "leaning" | "russia_stance" | "party_tones"
        >,
      )
    )
      throw new Error("Невалиден договор на редакционната проверка");
    if (
      "reviewed_links" in rawArticle.analysis &&
      !isPublicReviewedLinks(rawArticle.analysis.reviewed_links)
    )
      throw new Error("Невалиден договор на проверените връзки");
  }
  return value as unknown as OutletArticlesBundle;
};

export const useOutletArticles = (domain: string | null) =>
  useData<OutletArticlesBundle>(
    domain ? `/articles/${domain}.json` : null,
    parseOutletArticlesBundle,
  );
