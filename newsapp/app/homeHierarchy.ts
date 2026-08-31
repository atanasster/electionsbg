import type { ArticleRecord, HomeStory } from "./data";
import { canDisplayHomeImage } from "./components/imageRights";

export const HOME_SUPPORTING_LIMIT = 15;

export type HomeStoryKind = "comparison" | "analyzed_article";

export interface HomeStoryItem {
  story: HomeStory;
  imageArticle: ArticleRecord;
  kind: HomeStoryKind;
}

export interface HomeHierarchy {
  lead: HomeStoryItem | null;
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

const isEligibleArticle = (article: ArticleRecord): boolean =>
  Boolean(article.analysis && article.image && canDisplayHomeImage(article));

/**
 * Build the finite, deterministic home briefing.
 *
 * Every item must have an article from home.json, which is the server's
 * analyzed + rights-cleared eligibility boundary. A story without such a
 * representative image cannot leak back into the image-led surface.
 */
export const buildHomeHierarchy = (
  stories: HomeStory[],
  articles: ArticleRecord[],
  supportingLimit = HOME_SUPPORTING_LIMIT,
): HomeHierarchy => {
  const articlesByStory = new Map<string, ArticleRecord[]>();
  for (const article of articles) {
    if (!article.story_id || !isEligibleArticle(article)) continue;
    const bucket = articlesByStory.get(article.story_id) ?? [];
    bucket.push(article);
    articlesByStory.set(article.story_id, bucket);
  }

  const items = stories.flatMap<HomeStoryItem>((story) => {
    const imageArticle = articlesByStory.get(story.id)?.sort(newestFirst)[0];
    return imageArticle
      ? [{ story, imageArticle, kind: homeStoryKind(story) }]
      : [];
  });

  const lead =
    [...items]
      .filter((item) => Boolean(item.story.summary_bg?.trim()))
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
