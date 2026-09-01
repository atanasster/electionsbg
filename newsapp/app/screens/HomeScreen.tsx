// Home — the ground.news feed: stats strip, filters (category / timeframe /
// search), blindspot rail, story cards, and the latest-articles wire beneath.

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  analyzedArticles,
  articles,
  media,
  relativeTime,
  stories,
} from "../labels";
import { useHome, useOutlets, useStats, useTaxonomy } from "../data";
import { StoryCard } from "../components/StoryCard";
import { LeadStory } from "../components/LeadStory";
import { HomeFilterControls } from "../components/HomeFilterControls";
import { buildHomeHierarchy, HOME_SUPPORTING_LIMIT } from "../homeHierarchy";
import {
  defaultHomeDays,
  filterHomeStories,
  homeCategoryCounts,
} from "../homeFilters";
import { useUrlHomeFilters } from "../useUrlHomeFilters";
import { useNewsLocale } from "../i18n";

// The explicit one-column track is minmax(0, 1fr). Without it, CSS Grid's
// implicit `auto` track expands to a long image-credit's min-content width and
// makes the entire mobile page horizontally scroll.
export const STORY_GRID = "news-supporting-grid grid gap-3";

export const HomeScreen = () => {
  const { isEnglish, language, tr } = useNewsLocale();
  const stats = useStats();
  const home = useHome();
  const taxonomy = useTaxonomy();
  const outlets = useOutlets();

  const [now, setNow] = useState(() => Date.now());
  const [announcedCount, setAnnouncedCount] = useState<number | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const categories = taxonomy.data?.categories ?? null;
  const adaptiveDefaultDays = useMemo(
    () => defaultHomeDays(home.data?.stories ?? [], now),
    [home.data?.stories, now],
  );
  const {
    category,
    days,
    query,
    setCategory,
    setDays,
    setQuery,
    clearFilters,
    daysExplicit,
  } = useUrlHomeFilters(
    categories?.map((item) => item.id) ?? null,
    adaptiveDefaultDays,
  );
  const facetedStories = useMemo(
    () =>
      filterHomeStories(home.data?.stories ?? [], {
        category: "all",
        days,
        query,
        now,
      }),
    [home.data?.stories, days, query, now],
  );
  const categoryCounts = useMemo(
    () => homeCategoryCounts(facetedStories),
    [facetedStories],
  );
  const availableCategories = useMemo(
    () => (categories ?? []).filter((item) => item.id !== "not-site-relevant"),
    [categories],
  );

  const filteredStories = useMemo(
    () =>
      filterHomeStories(home.data?.stories ?? [], {
        category,
        days,
        query,
        now,
      }),
    [home.data?.stories, category, days, query, now],
  );
  useEffect(() => {
    if (!home.data) return;
    const timer = window.setTimeout(
      () => setAnnouncedCount(filteredStories.length),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [filteredStories.length, home.data]);
  // Cards need the full registry for named source previews and the image
  // fallback rung. Missing registry rows still degrade to their domain.
  const outletRegistry = outlets.data?.outlets ?? [];
  const hierarchy = useMemo(
    () => buildHomeHierarchy(filteredStories, home.data?.articles ?? []),
    [filteredStories, home.data?.articles],
  );

  return (
    <div className="space-y-5 sm:space-y-8">
      <section className="news-home-intro border-b pb-4 sm:pb-6">
        <p className="app-eyebrow mb-2 hidden sm:block">
          {tr("Независим медиен преглед", "Independent media overview")}
        </p>
        <h1 className="app-story-title max-w-3xl">
          {tr("Всяка страна на всяка история", "Every side of every story")}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:mt-3 sm:text-base">
          {tr(
            "Сравнете как българските медии разказват едни и същи събития и къде се различават.",
            "Compare how Bulgarian media tell the same stories and where their coverage differs.",
          )}
        </p>
        {/* Corpus detail remains available without delaying the first story. */}
        <details className="group mt-3 rounded-md border border-border/70 bg-muted/40 px-3">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-sm text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&::-webkit-details-marker]:hidden">
            <span>
              {tr("Покритие", "Coverage")}:{" "}
              {stats.error && !stats.data
                ? tr("не е налично", "unavailable")
                : stats.data
                  ? `${stories(stats.data.stories, language)} · ${stats.data.analyzed_pct}% ${tr("анализирани", "analyzed")}`
                  : tr("зарежда се", "loading")}
            </span>
            <ChevronDown
              aria-hidden
              className="size-4 shrink-0 transition-transform group-open:rotate-180"
            />
          </summary>
          <div className="flex flex-wrap items-center gap-2 border-t py-3">
            {stats.error && !stats.data ? (
              <span className="text-sm text-destructive">
                {tr(
                  "Статистиката не се зареди.",
                  "Statistics could not be loaded.",
                )}
              </span>
            ) : stats.data ? (
              <>
                <Badge variant="secondary">
                  {stories(stats.data.stories, language)}
                </Badge>
                <Badge variant="secondary">
                  {analyzedArticles(stats.data.analyzed_articles, language)} (
                  {stats.data.analyzed_pct}%)
                </Badge>
                <Badge variant="secondary">
                  {articles(stats.data.total_articles, language)}{" "}
                  {tr("общо", "total")}
                </Badge>
                <Badge variant="secondary">
                  {media(stats.data.domains, language)}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {tr("обновено", "updated")}{" "}
                  {relativeTime(stats.data.generated_at, language)}
                </span>
              </>
            ) : (
              <Skeleton className="h-6 w-60 max-w-full" />
            )}
          </div>
        </details>
      </section>

      <HomeFilterControls
        categories={availableCategories}
        categoryCounts={categoryCounts}
        category={category}
        days={days}
        defaultDays={adaptiveDefaultDays}
        query={query}
        onCategoryChange={setCategory}
        onDaysChange={setDays}
        onQueryChange={setQuery}
        onReset={clearFilters}
      />
      {home.data && !daysExplicit && adaptiveDefaultDays > 1 ? (
        <p className="-mt-5 text-xs text-muted-foreground" role="status">
          {tr(
            "Няма достатъчно истории за 24 часа — показваме последните 7 дни.",
            "There are not enough stories from the last 24 hours — showing the last 7 days.",
          )}
        </p>
      ) : null}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcedCount === null ? "" : stories(announcedCount, language)}
      </p>

      {home.error && !home.data ? (
        <Card className="p-4 text-sm text-destructive">
          {isEnglish
            ? "The home page could not be loaded."
            : `Началната страница не се зареди: ${home.error.message}`}
        </Card>
      ) : null}
      {(taxonomy.error && !taxonomy.data) ||
      (outlets.error && !outlets.data) ? (
        <Card className="p-4 text-sm text-destructive">
          {tr(
            "Част от данните (теми/източници) не се заредиха — филтрите може да са непълни.",
            "Some topic or source data could not be loaded, so the filters may be incomplete.",
          )}
        </Card>
      ) : null}

      {/* One deterministic lead, followed by a finite supporting briefing. */}
      <section aria-labelledby="stories-heading">
        <h2
          id="stories-heading"
          className="mb-2 text-sm font-semibold uppercase tracking-wide"
        >
          {tr("Последни истории", "Latest stories")} (
          {hierarchy.supporting.length + (hierarchy.lead ? 1 : 0)})
        </h2>
        {home.loading && !home.data ? (
          <div className={STORY_GRID}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-44 rounded-xl" />
            ))}
          </div>
        ) : home.error && !home.data ? null : !hierarchy.lead &&
          !hierarchy.supporting.length ? (
          <Card className="p-6 text-sm text-muted-foreground">
            {tr(
              "Няма истории за избраните филтри.",
              "No stories match these filters.",
            )}
          </Card>
        ) : (
          <div className="space-y-5">
            {hierarchy.lead ? (
              <LeadStory
                item={hierarchy.lead}
                taxonomy={categories}
                outlets={outletRegistry}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {tr(
                  "Няма сравнение с достатъчно източници; показваме анализирани статии.",
                  "No comparison has enough sources; showing analyzed articles.",
                )}
              </p>
            )}
            {hierarchy.supporting.length ? (
              <div className={STORY_GRID}>
                {hierarchy.supporting.map((item) => (
                  <StoryCard
                    key={item.story.id}
                    story={item.story}
                    taxonomy={categories}
                    imageArticle={item.imageArticle}
                    outlets={outletRegistry}
                    kind={item.kind}
                  />
                ))}
              </div>
            ) : null}
          </div>
        )}
        {filteredStories.length > HOME_SUPPORTING_LIMIT + 1 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {tr("Показват се водещата и", "Showing the lead and")}{" "}
            {HOME_SUPPORTING_LIMIT}{" "}
            {tr("подбрани истории от", "selected stories out of")}{" "}
            {filteredStories.length} —{" "}
            {tr(
              "стеснете филтрите, за да видите други.",
              "narrow the filters to see others.",
            )}
          </p>
        ) : null}
      </section>
    </div>
  );
};
