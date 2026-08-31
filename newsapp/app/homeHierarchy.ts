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
    if (!article.story_id || !article.analysis) continue;
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

  const lead =
    [...items]
      .filter(
        (item): item is HomeLeadStoryItem =>
          isLeadItem(item) && Boolean(item.story.summary_bg?.trim()),
      )
      .sort(supportingRank)[0] ?? null;
  const supporting = items
    .filter((item) => item.story.id !== lead?.story.id)
    .sort(supportingRank)
    .slice(0, Math.max(0, supportingLimit));

  return {
    lead,
    supporting,
  };
};
