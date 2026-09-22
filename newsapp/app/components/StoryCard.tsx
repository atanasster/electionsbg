// Story card in the home feed — a canonical title and summary, one useful
// comparison signal, named publications, topic and relative time. The title +
// summary form the one story link; image credit/licence remain independent
// links, so the surface must never become one invalid nested anchor.
//
// ⚠️ THE MEDIA IS A SQUARE THUMBNAIL BESIDE THE HEADLINE, NEVER A FULL-WIDTH
// BLOCK ABOVE IT. A 16:10 block plus its caption added ~320px to a card, which
// made its whole grid row that tall while the text cards beside it stopped at
// their natural height — the blank bands v4 exists to remove. It also pushed
// the card's own headline BELOW its neighbours', so the order a sighted reader
// scans disagreed with the DOM and keyboard order. Both are measured in
// `tests/news/home-grid.spec.ts`.
//
// The card body is one CSS grid (`news-card-grid`) with named areas, so media,
// headline, credit and footer are PLACED rather than stacked.
//
// ⚠️ THE FIGURE IS WRITTEN AFTER THE HEADLINE, AND THAT ORDER IS LOAD-BEARING.
// Its caption carries the credit and licence LINKS, and the caption renders
// below the headline — so a figure written first (as it was while the media
// was a block above the text) would put two links into tab order before the
// headline they visually follow. The thumbnail image is placed into the media
// area by grid, not by document order, and is not focusable.

import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { media, relativeTime, topicLabel } from "../labels";
import type {
  ArticleRecord,
  HomeStory,
  Outlet,
  TaxonomyCategory,
} from "../data";
import type { HomeStoryKind } from "../homeHierarchy";
import { ArticleImage } from "./ArticleImage";
import { canDisplayHomeImage } from "./imageRights";
import { StorySourcePreview } from "./StorySourcePreview";
import { useNewsLocale } from "../i18n";
import { aggregateDivergence, type AxisDivergence } from "../storyDivergence";
import { emitNewsEvent } from "../analytics";

export const StoryCard = ({
  story,
  taxonomy,
  imageArticle,
  outlets,
  kind,
  density = "detailed",
}: {
  story: HomeStory;
  taxonomy: TaxonomyCategory[] | null;
  imageArticle?: ArticleRecord | null;
  outlets: readonly Outlet[];
  kind?: HomeStoryKind;
  density?: "compact" | "detailed";
}) => {
  const { language, tr } = useNewsLocale();
  const title =
    (language === "en" ? story.title_en : story.title_bg) ??
    tr("(без заглавие)", "(untitled)");
  const summary = language === "en" ? story.summary_en : story.summary_bg;
  const primary = story.topics.find((t) => t.primary) ?? story.topics[0];
  // ⚠️ DIVERGENCE, NOT PRESENCE — the cue makes a claim about named outlets.
  // Counting labelled articles says only that somebody applied a label; a
  // story whose outlets all frame it identically is a comparison story with
  // nothing to compare. Measured 2026-09-01, BOTH comparison stories in the
  // home corpus are uniform (`{neutral: 2}` and `{neutral: 3}`), so a presence
  // test would have made every live instance of this cue a false statement.
  // The spectrum bar this replaced was honest by construction: it drew the
  // distribution, so a single-colour bar showed the reader there was nothing
  // to see. A sentence has to earn that on its own.
  //
  // T5.2: the unit is the OUTLET. Until 2026-09-22 this counted distinct
  // LABELS, so two articles from one outlet with different labels read as
  // „framing differs" — the same rule the story page now applies, from the
  // build's per-axis positioned-outlet count (`storyDivergence.ts`).
  const leaning = aggregateDivergence(
    story.aggregates.by_leaning,
    story.aggregates.leaning_outlets,
  );
  const russia = aggregateDivergence(
    story.aggregates.by_russia_stance,
    story.aggregates.russia_stance_outlets,
  );
  const rank = (d: AxisDivergence) =>
    d.state === "distribution" ? 2 : d.state === "uniform" ? 1 : 0;
  const signal =
    kind === "comparison" && Math.max(rank(leaning), rank(russia)) > 0
      ? rank(leaning) >= rank(russia)
        ? "leaning"
        : "russia"
      : null;
  const cueAxis = signal === "leaning" ? leaning : russia;
  /** Two or more OUTLETS on two or more labels is the only thing that licences "differs". */
  const diverges = cueAxis.state === "distribution";
  // The number in front of the verdict is the number the verdict is ABOUT:
  // the outlets holding a position on that axis, not the story's whole
  // outlet count. Measured 2026-09-22: on 12 live cards the two differ, and
  // „5 медии · сходно рамкиране" asserted five where two had a position.
  const cueOutlets = cueAxis.positionedOutlets;
  const compact = density === "compact";
  // ONE predicate for the layout and the content. Deriving the grid from the
  // weaker `Boolean(imageArticle)` would reserve a 7rem media column for an
  // image the rights layer refuses to show, and fill it with a monogram square
  // — the placeholder treatment option C was rejected for.
  const showMedia =
    Boolean(imageArticle && canDisplayHomeImage(imageArticle)) && !compact;
  return (
    <article className="h-full">
      <Card
        className={`news-story-card news-story-card--standard flex h-full min-w-0 flex-col overflow-hidden ${
          showMedia ? "" : "news-story-card--text"
        }`}
      >
        <div
          className={`news-card-body news-card-grid min-w-0 flex-1 ${
            compact ? "news-card-grid--compact" : "p-4"
          } ${showMedia ? "news-card-grid--media" : ""}`}
        >
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
            className="news-card-headline news-story-link group rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            <h3 className="news-story-heading line-clamp-3 font-title text-xl leading-[1.22] transition-colors group-hover:text-[hsl(var(--editorial-kicker))]">
              {title}
            </h3>
            {summary && !compact ? (
              <p className="news-story-summary mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                {summary}
              </p>
            ) : null}
          </Link>
          {showMedia && imageArticle ? (
            <ArticleImage
              image={imageArticle.image}
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
              layout="thumbnail"
              creditVariant="compact"
            />
          ) : null}
          <div className="news-card-footer flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <StorySourcePreview
              byDomain={story.aggregates.by_domain}
              articleCount={story.aggregates.article_count}
              outlets={outlets}
              className="news-story-sources min-w-0"
            />
            {/* ⚠️ A one-line TEXT cue, never the labelled spectrum bar.
                The bar is too tall for the evidence a two-outlet story carries,
                it varied the height of every card that had one, and it reads as
                a confidence meter. The full labelled distribution stays on the
                story page, which is where the counts can be explained. */}
            {signal && !compact ? (
              <p className="news-story-cue shrink-0 text-xs text-muted-foreground">
                {media(cueOutlets, language)}
                {cueOutlets < story.aggregates.outlet_count
                  ? tr(
                      ` от ${story.aggregates.outlet_count}`,
                      ` of ${story.aggregates.outlet_count}`,
                    )
                  : ""}{" "}
                ·{" "}
                {diverges
                  ? signal === "leaning"
                    ? tr("различия в рамкирането", "framing differs")
                    : tr(
                        "различна позиция спрямо Русия",
                        "differing position on Russia",
                      )
                  : signal === "leaning"
                    ? tr("сходно рамкиране", "similar framing")
                    : tr(
                        "сходна позиция спрямо Русия",
                        "similar position on Russia",
                      )}
              </p>
            ) : null}
          </div>
        </div>
      </Card>
    </article>
  );
};
