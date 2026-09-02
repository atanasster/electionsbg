import type { ArticleRecord, HomeStory } from "./data";
import { canDisplayHomeImage } from "./components/imageRights";

export const HOME_SUPPORTING_LIMIT = 15;

export type HomeStoryKind = "comparison" | "analyzed_article";

export interface HomeStoryItem {
  story: HomeStory;
  imageArticle: ArticleRecord | null;
  kind: HomeStoryKind;
}

export interface HomeLeadStoryItem extends HomeStoryItem {
  imageArticle: ArticleRecord;
}

export interface HomeHierarchy {
  lead: HomeLeadStoryItem | null;
  supporting: HomeStoryItem[];
}

export const homeStoryKind = (story: HomeStory): HomeStoryKind =>
  story.aggregates.outlet_count >= 2 && story.aggregates.article_count >= 2
    ? "comparison"
    : "analyzed_article";

/**
 * ⚠️ Returns -Infinity, never NaN, and that is what makes `||` chaining safe in
 * the comparators below: `NaN || next` falls through because NaN is falsy, so a
 * date the parser could not read would silently defer to the next key instead
 * of sorting last. -Infinity subtracts to a real number and sorts undated
 * stories to the end deterministically.
 */
const instant = (value: string | null | undefined): number => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};

const newestFirst = (a: ArticleRecord, b: ArticleRecord): number =>
  instant(b.published) - instant(a.published) ||
  `${a.domain}/${a.id}`.localeCompare(`${b.domain}/${b.id}`);

const supportingRank = (a: HomeStoryItem, b: HomeStoryItem): number =>
  instant(b.story.last_published) - instant(a.story.last_published) ||
  b.story.aggregates.outlet_count - a.story.aggregates.outlet_count ||
  a.story.id.localeCompare(b.story.id);

/**
 * Width of the lead's freshness bucket, in milliseconds.
 *
 * ⚠️ Without a bucket, "rank by freshness AND breadth" collapses to "the newest
 * item with an image". Publication timestamps are near-unique, so a strict
 * recency sort settles every comparison before breadth is ever consulted —
 * measured on the committed corpus, the four newest stories span 10.06 to
 * 10.68 hours and would be ordered by minutes.
 */
const LEAD_FRESHNESS_MS = 24 * 60 * 60 * 1000;

/**
 * Rank eligible leads by freshness bucket, then by how many outlets covered
 * the story, then by recency, then by a stable id.
 *
 * ⚠️ THE BUCKET IS RELATIVE TO THE FRESHEST CANDIDATE, never `t / DAY`. An
 * absolute epoch-day grid makes comparability depend on where 00:00 UTC
 * happens to fall: two stories two minutes apart across midnight land in
 * different buckets and never reach the breadth comparison, while two 23h58m
 * apart share one. That is not hypothetical for this corpus — measured
 * 2026-09-02, 7 of 16 committed stories sit within 90 minutes of a UTC-day
 * boundary, and one adjacent pair only 1.45 hours apart was already split by
 * it. Anchoring on the freshest candidate leaves exactly one boundary, keeps
 * the comparator transitive, and makes the rule independent of the clock.
 *
 * ⚠️ Deliberately NOT ranked on summary quality or image relevance. Plan §4.1
 * lists both, and neither has a field in the data model — scoring them would
 * mean inventing a proxy and calling it a review. When they become reviewed
 * fields they belong here, ahead of recency.
 */
const leadRankIn = (
  candidates: readonly HomeStoryItem[],
): ((a: HomeStoryItem, b: HomeStoryItem) => number) => {
  const newest = Math.max(
    ...candidates.map((item) => instant(item.story.last_published)),
  );
  const bucket = (item: HomeStoryItem) =>
    Math.floor(
      (newest - instant(item.story.last_published)) / LEAD_FRESHNESS_MS,
    );
  return (a, b) =>
    bucket(a) - bucket(b) ||
    b.story.aggregates.outlet_count - a.story.aggregates.outlet_count ||
    instant(b.story.last_published) - instant(a.story.last_published) ||
    a.story.id.localeCompare(b.story.id);
};

const hasDisplayImage = (article: ArticleRecord): boolean =>
  Boolean(article.image && canDisplayHomeImage(article));

const representativeRank = (a: ArticleRecord, b: ArticleRecord): number =>
  Number(hasDisplayImage(b)) - Number(hasDisplayImage(a)) || newestFirst(a, b);

const isLeadItem = (item: HomeStoryItem): item is HomeLeadStoryItem =>
  Boolean(item.imageArticle && hasDisplayImage(item.imageArticle));

/**
 * Build the finite, deterministic home briefing.
 *
 * Every item must have an analyzed article from home.json. Supporting stories
 * may be text-first; the lead remains image-led and therefore requires the
 * server's explicit rights-cleared display decision.
 */
export const buildHomeHierarchy = (
  stories: HomeStory[],
  articles: ArticleRecord[],
  supportingLimit = HOME_SUPPORTING_LIMIT,
): HomeHierarchy => {
  const articlesByStory = new Map<string, ArticleRecord[]>();
  for (const article of articles) {
    // ⚠️ `has_analysis`, not `analysis`. The home bundle carries a boolean
    // because the object was 54% of its bytes and this is the only line that
    // ever read it. The `analysis` fallback keeps a bundle built before the
    // trim working — the client can be newer than the data it is served.
    if (
      !article.story_id ||
      !(article.has_analysis ?? Boolean(article.analysis))
    )
      continue;
    const bucket = articlesByStory.get(article.story_id) ?? [];
    bucket.push(article);
    articlesByStory.set(article.story_id, bucket);
  }

  const items = stories.flatMap<HomeStoryItem>((story) => {
    const representative = articlesByStory
      .get(story.id)
      ?.sort(representativeRank)[0];
    return representative
      ? [
          {
            story,
            imageArticle: hasDisplayImage(representative)
              ? representative
              : null,
            kind: homeStoryKind(story),
          },
        ]
      : [];
  });

  const leadCandidates = items.filter(
    (item): item is HomeLeadStoryItem =>
      isLeadItem(item) && Boolean(item.story.summary_bg?.trim()),
  );
  const lead = [...leadCandidates].sort(leadRankIn(leadCandidates))[0] ?? null;
  const visibleSupportingLimit = lead
    ? supportingLimit
    : supportingLimit > 0
      ? supportingLimit + 1
      : 0;
  const supporting = items
    .filter((item) => item.story.id !== lead?.story.id)
    .sort(supportingRank)
    .slice(0, Math.max(0, visibleSupportingLimit));

  return {
    lead,
    supporting,
  };
};
