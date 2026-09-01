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
  density = "detailed",
}: {
  item: HomeLeadStoryItem;
  outlets: readonly Outlet[];
  taxonomy: TaxonomyCategory[] | null;
  /**
   * Compact keeps the lead — it is the one composition the page is built
   * around — but at a shallower media ratio and with a shorter body, so the
   * module costs a dense reader a band rather than a screen. Dropping it
   * outright, which is what compact used to do, removed the module and left
   * compact as the standard grid with less in each card.
   *
   * ⚠️ THE MEDIA RATIO ALONE DOES NOTHING BELOW ~1000px, and that was the
   * first attempt. The two columns are a grid row: the `<figure>` stretches to
   * whichever side is taller, so a shallower aspect is simply absorbed while
   * the BODY sets the height. Measured 2026-09-02 at 768-900px, a 21/9 lead
   * was exactly as tall as a 16/10 one (424.3px, 0px saved) and the muted band
   * under its image grew by 87-102px. The body has to shrink too, which is
   * what the clamped summary and smaller heading below are for.
   *
   * ⚠️ 21/9 CROPS HARDER than 16/10, on the one above-the-fold image, while
   * `crop_allowed` does not exist yet (deferred to Phase 3a with the rest of
   * the provenance contract). The ratio is kept because 16/10 already crops
   * and this is a reader-chosen density, not a default — but when
   * `crop_allowed` lands, a lead whose authority forbids adaptation must not
   * take the deeper ratio.
   */
  density?: "compact" | "detailed";
}) => {
  const { language, tr } = useNewsLocale();
  const compact = density === "compact";
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
            <h3
              className={`news-story-heading font-title leading-tight transition-colors group-hover:text-[hsl(var(--editorial-kicker))] ${
                compact ? "text-xl md:text-2xl" : "text-2xl md:text-3xl"
              }`}
            >
              {title}
            </h3>
            {summary ? (
              <p
                className={`news-story-summary mt-3 text-sm leading-relaxed text-muted-foreground ${
                  compact ? "line-clamp-2" : "line-clamp-3"
                }`}
              >
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
          aspect={density === "compact" ? "aspect-[21/9]" : "aspect-[16/10]"}
          className="rounded-none md:order-1 md:col-span-3"
          priority
          creditVariant="compact"
        />
      </Card>
    </article>
  );
};
