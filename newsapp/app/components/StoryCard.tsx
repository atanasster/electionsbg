// Story card in the home feed — the ground.news vocabulary: canonical title,
// summary, coverage count, lean spectrum, topic chips, relative time. The
// whole card links to /story/:id.

import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { relativeTime, topicLabel } from "../labels";
import type { ArticleRecord, Outlet, Story, TaxonomyCategory } from "../data";
import type { HomeStoryKind } from "../homeHierarchy";
import { LeanSpectrum, StanceSpectrum } from "./SpectrumBar";
import { ArticleImage } from "./ArticleImage";
import { canDisplayHomeImage } from "./imageRights";

export const StoryCard = ({
  story,
  taxonomy,
  imageArticle,
  outlet,
  kind,
}: {
  story: Story;
  taxonomy: TaxonomyCategory[] | null;
  imageArticle?: ArticleRecord;
  outlet?: Outlet;
  kind?: HomeStoryKind;
}) => {
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
    <Card className="flex h-full flex-col overflow-hidden transition-shadow hover:shadow-md">
      {imageArticle ? (
        <ArticleImage
          image={canDisplayHomeImage(imageArticle) ? imageArticle.image : null}
          imageAlt={imageArticle.image_alt}
          rights={imageArticle.image_rights}
          articleUrl={imageArticle.url}
          outlet={
            outlet ?? {
              domain: imageArticle.domain,
              outlet: imageArticle.domain,
              logo: null,
              hotlink_ok: null,
            }
          }
          className="rounded-none"
        />
      ) : null}
      <Link
        to={`/story/${story.id}`}
        className="group flex flex-1 flex-col p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {kind ? (
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
            {kind === "comparison"
              ? "Сравнение на отразяването"
              : "Анализирана статия"}
          </p>
        ) : null}
        <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {story.aggregates.outlet_count}{" "}
            {story.aggregates.outlet_count === 1 ? "медия" : "медии"}
            {" · "}
            {story.aggregates.article_count}{" "}
            {story.aggregates.article_count === 1 ? "статия" : "статии"}
          </span>
          <time dateTime={story.last_published ?? undefined}>
            {relativeTime(story.last_published)}
          </time>
        </div>
        <h3 className="mt-1.5 font-title text-lg leading-snug group-hover:text-primary">
          {story.title_bg ?? story.title_en ?? "(без заглавие)"}
        </h3>
        {story.summary_bg ? (
          <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">
            {story.summary_bg}
          </p>
        ) : null}
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
        {primary ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge variant="secondary" className="font-normal">
              {topicLabel(taxonomy, primary.category, primary.subcategory) ??
                primary.category}
            </Badge>
          </div>
        ) : null}
      </Link>
    </Card>
  );
};
