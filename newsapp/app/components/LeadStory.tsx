import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { Outlet, TaxonomyCategory } from "../data";
import type { HomeStoryItem } from "../homeHierarchy";
import { relativeTime, topicLabel } from "../labels";
import { ArticleImage } from "./ArticleImage";
import { canDisplayHomeImage } from "./imageRights";

export const LeadStory = ({
  item,
  outlet,
  taxonomy,
}: {
  item: HomeStoryItem;
  outlet?: Outlet;
  taxonomy: TaxonomyCategory[] | null;
}) => {
  const { story, imageArticle, kind } = item;
  const title = story.title_bg ?? story.title_en ?? "(без заглавие)";
  const action =
    kind === "comparison" ? "Сравни отразяването" : "Прочети анализа";
  const primary =
    story.topics.find((topic) => topic.primary) ?? story.topics[0];
  const source = outlet ?? {
    domain: imageArticle.domain,
    outlet: imageArticle.domain,
    logo: null,
    hotlink_ok: null,
  };

  return (
    <article>
      <Card className="news-story-card grid overflow-hidden md:grid-cols-5">
        <ArticleImage
          image={canDisplayHomeImage(imageArticle) ? imageArticle.image : null}
          imageAlt={imageArticle.image_alt}
          rights={imageArticle.image_rights}
          articleUrl={imageArticle.url}
          outlet={source}
          aspect="aspect-[16/10]"
          className="rounded-none md:col-span-3"
          priority
        />
        <div className="flex flex-col justify-center p-5 md:col-span-2 md:p-7">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {primary ? (
              <Badge variant="secondary" className="font-normal">
                {topicLabel(taxonomy, primary.category, primary.subcategory) ??
                  primary.category}
              </Badge>
            ) : null}
            <time dateTime={story.last_published ?? undefined}>
              {relativeTime(story.last_published)}
            </time>
          </div>
          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-primary">
            {kind === "comparison"
              ? "Сравнение на отразяването"
              : "Анализирана статия"}
          </p>
          <h3 className="mt-1 font-title text-2xl leading-tight md:text-3xl">
            {title}
          </h3>
          {story.summary_bg ? (
            <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">
              {story.summary_bg}
            </p>
          ) : null}
          <p className="mt-4 text-sm font-medium">
            {story.aggregates.outlet_count}{" "}
            {story.aggregates.outlet_count === 1 ? "медия" : "медии"}
            {" · "}
            {story.aggregates.article_count}{" "}
            {story.aggregates.article_count === 1 ? "публикация" : "публикации"}
          </p>
          <Link
            to={`/story/${story.id}`}
            aria-label={`${action}: ${title}`}
            className="news-story-link mt-5 inline-flex w-fit items-center gap-2 font-semibold text-[hsl(var(--editorial-kicker))] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {action}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </Card>
    </article>
  );
};
