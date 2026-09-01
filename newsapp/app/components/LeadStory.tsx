import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { Outlet, TaxonomyCategory } from "../data";
import type { HomeLeadStoryItem } from "../homeHierarchy";
import { relativeTime, topicLabel } from "../labels";
import { ArticleImage } from "./ArticleImage";
import { canDisplayHomeImage } from "./imageRights";
import { StorySourcePreview } from "./StorySourcePreview";
import { useNewsLocale } from "../i18n";
import { emitNewsEvent } from "../analytics";

export const LeadStory = ({
  item,
  outlets,
  taxonomy,
}: {
  item: HomeLeadStoryItem;
  outlets: readonly Outlet[];
  taxonomy: TaxonomyCategory[] | null;
}) => {
  const { language, tr } = useNewsLocale();
  const { story, imageArticle } = item;
  const title =
    (language === "en" ? story.title_en : story.title_bg) ??
    tr("(без заглавие)", "(untitled)");
  const summary = language === "en" ? story.summary_en : story.summary_bg;
  const primary =
    story.topics.find((topic) => topic.primary) ?? story.topics[0];
  const source = outlets.find(
    (outlet) => outlet.domain === imageArticle.domain,
  ) ?? {
    domain: imageArticle.domain,
    outlet: imageArticle.domain,
    logo: null,
    hotlink_ok: null,
  };

  return (
    <article>
      <Card className="news-story-card grid overflow-hidden md:grid-cols-5">
        <div className="news-card-body flex min-w-0 flex-col justify-start p-5 md:order-2 md:col-span-2 md:p-7">
          <div className="news-card-meta flex min-w-0 items-center justify-between gap-3 text-xs text-muted-foreground">
            {primary ? (
              <Badge
                variant="secondary"
                className="min-w-0 max-w-[75%] truncate font-normal"
              >
                {topicLabel(
                  taxonomy,
                  primary.category,
                  primary.subcategory,
                  language,
                ) ?? primary.category}
              </Badge>
            ) : (
              <span />
            )}
            <time
              className="shrink-0 whitespace-nowrap"
              dateTime={story.last_published ?? undefined}
            >
              {relativeTime(story.last_published, language)}
            </time>
          </div>
          <Link
            to={`/story/${story.id}`}
            onClick={() =>
              emitNewsEvent({
                name: "reader_task",
                task: "find_story",
                signal: "completed",
              })
            }
            className="news-story-link group mt-4 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            <h3 className="news-story-heading font-title text-2xl leading-tight transition-colors group-hover:text-[hsl(var(--editorial-kicker))] md:text-3xl">
              {title}
            </h3>
            {summary ? (
              <p className="news-story-summary mt-3 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                {summary}
              </p>
            ) : null}
          </Link>
          <StorySourcePreview
            byDomain={story.aggregates.by_domain}
            articleCount={story.aggregates.article_count}
            outlets={outlets}
            limit={3}
            className="news-story-sources mt-5"
          />
        </div>
        <ArticleImage
          image={canDisplayHomeImage(imageArticle) ? imageArticle.image : null}
          imageAlt={imageArticle.image_alt}
          rights={imageArticle.image_rights}
          articleUrl={imageArticle.url}
          outlet={source}
          aspect="aspect-[16/10]"
          className="rounded-none md:order-1 md:col-span-3"
          priority
          creditVariant="compact"
        />
      </Card>
    </article>
  );
};
