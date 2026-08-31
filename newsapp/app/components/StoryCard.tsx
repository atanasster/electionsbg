// Story card in the home feed — a canonical title and summary, one useful
// comparison signal, named publications, topic and relative time. The title +
// summary form the one story link; image credit/licence remain independent
// links, so the surface must never become one invalid nested anchor.

import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { relativeTime, topicLabel } from "../labels";
import type {
  ArticleRecord,
  HomeStory,
  Outlet,
  TaxonomyCategory,
} from "../data";
import type { HomeStoryKind } from "../homeHierarchy";
import { LeanSpectrum, StanceSpectrum } from "./SpectrumBar";
import { ArticleImage } from "./ArticleImage";
import { canDisplayHomeImage } from "./imageRights";
import { StorySourcePreview } from "./StorySourcePreview";

export const StoryCard = ({
  story,
  taxonomy,
  imageArticle,
  outlets,
  kind,
}: {
  story: HomeStory;
  taxonomy: TaxonomyCategory[] | null;
  imageArticle?: ArticleRecord | null;
  outlets: readonly Outlet[];
  kind?: HomeStoryKind;
}) => {
  const title = story.title_bg ?? story.title_en ?? "(без заглавие)";
  const primary = story.topics.find((t) => t.primary) ?? story.topics[0];
  const leaningCount = Object.entries(story.aggregates.by_leaning).reduce(
    (sum, [label, count]) =>
      label === "not_applicable" ? sum : sum + (count ?? 0),
    0,
  );
  const stanceCount = Object.entries(story.aggregates.by_russia_stance).reduce(
    (sum, [label, count]) =>
      label === "not_applicable" ? sum : sum + (count ?? 0),
    0,
  );
  const signal =
    kind === "comparison" && Math.max(leaningCount, stanceCount) > 0
      ? leaningCount >= stanceCount
        ? "leaning"
        : "russia"
      : null;
  return (
    <article className="h-full">
      <Card
        className={`news-story-card flex h-full min-w-0 flex-col overflow-hidden ${
          imageArticle ? "" : "news-story-card--text"
        }`}
      >
        {imageArticle ? (
          <ArticleImage
            image={
              canDisplayHomeImage(imageArticle) ? imageArticle.image : null
            }
            imageAlt={imageArticle.image_alt}
            rights={imageArticle.image_rights}
            articleUrl={imageArticle.url}
            outlet={
              outlets.find((item) => item.domain === imageArticle.domain) ?? {
                domain: imageArticle.domain,
                outlet: imageArticle.domain,
                logo: null,
                hotlink_ok: null,
              }
            }
            className="rounded-none"
            creditVariant="compact"
          />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col p-4">
          <div className="flex min-w-0 items-center justify-between gap-3 text-xs text-muted-foreground">
            {primary ? (
              <Badge
                variant="secondary"
                className="min-w-0 max-w-[75%] truncate font-normal"
              >
                {topicLabel(taxonomy, primary.category, primary.subcategory) ??
                  primary.category}
              </Badge>
            ) : (
              <span />
            )}
            <time
              className="shrink-0 whitespace-nowrap"
              dateTime={story.last_published ?? undefined}
            >
              {relativeTime(story.last_published)}
            </time>
          </div>
          <Link
            to={`/story/${story.id}`}
            className="news-story-link group mt-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            <h3 className="line-clamp-3 font-title text-xl leading-[1.22] transition-colors group-hover:text-[hsl(var(--editorial-kicker))]">
              {title}
            </h3>
            {story.summary_bg ? (
              <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                {story.summary_bg}
              </p>
            ) : null}
          </Link>
          <StorySourcePreview
            byDomain={story.aggregates.by_domain}
            articleCount={story.aggregates.article_count}
            outlets={outlets}
            className="mt-4"
          />
          {signal ? (
            <div className="mt-3 space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                {signal === "leaning"
                  ? "Политическо рамкиране"
                  : "Позиция спрямо Русия"}
              </p>
              {signal === "leaning" ? (
                <LeanSpectrum counts={story.aggregates.by_leaning} />
              ) : (
                <StanceSpectrum counts={story.aggregates.by_russia_stance} />
              )}
            </div>
          ) : null}
        </div>
      </Card>
    </article>
  );
};
