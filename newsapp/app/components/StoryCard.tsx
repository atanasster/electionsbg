// Story card in the home feed — the ground.news vocabulary: canonical title,
// summary, coverage count, lean spectrum, topic chips, relative time. The
// whole card links to /story/:id.

import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { relativeTime, topicLabel } from "../labels";
import type { Story, TaxonomyCategory } from "../data";
import { LeanSpectrum, StanceSpectrum } from "./SpectrumBar";

export const StoryCard = ({
  story,
  taxonomy,
}: {
  story: Story;
  taxonomy: TaxonomyCategory[] | null;
}) => {
  const primary = story.topics.find((t) => t.primary) ?? story.topics[0];
  return (
    <Link
      to={`/story/${story.id}`}
      className="group block focus-visible:outline-none"
    >
      <Card className="h-full p-4 transition-shadow group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-ring">
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
        <div className="mt-3 space-y-1.5">
          <LeanSpectrum counts={story.aggregates.by_leaning} />
          <StanceSpectrum counts={story.aggregates.by_russia_stance} />
        </div>
        {primary ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge variant="secondary" className="font-normal">
              {topicLabel(taxonomy, primary.category, primary.subcategory) ??
                primary.category}
            </Badge>
          </div>
        ) : null}
      </Card>
    </Link>
  );
};
