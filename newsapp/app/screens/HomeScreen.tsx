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
import {
  buildBriefingSections,
  readBriefingPreferences,
  sanitizeBriefingPreferences,
  storiesSinceBriefing,
  writeBriefingPreferences,
  type BriefingCadence,
  type BriefingPreferences,
} from "../briefing";
import { BriefingControls } from "../components/BriefingControls";
import { emitNewsEvent } from "../analytics";

/**
 * ONE grid for every section, deliberately — not the "named variants for update
 * and standard sections" an earlier draft of the plan called for.
 *
 * §4.2 asks the update band to fit one or two cards to the full width and §4.3
 * asks the standard grid for at most two columns. Under
 * `repeat(auto-fit, minmax(min(28rem, 100%), 1fr))` those are the SAME rule:
 * auto-fit collapses the tracks a short section has no card for, and the 28rem
 * minimum caps the count at two inside the 84rem shell. A `variant` prop that
 * resolved to identical tracks would be configuration that cannot be wrong,
 * which is worse than none — so the convergence is recorded here instead.
 *
 * The explicit minimum is still what stops CSS Grid's implicit `auto` track
 * expanding to a long image credit's min-content width and scrolling the whole
 * mobile page sideways.
 */
export const STORY_GRID = "news-supporting-grid grid gap-3";

export const HomeScreen = () => {
  const { isEnglish, language, tr } = useNewsLocale();
  const stats = useStats();
  const home = useHome();
  const taxonomy = useTaxonomy();
  const outlets = useOutlets();

  const [now, setNow] = useState(() => Date.now());
  const [announcedCount, setAnnouncedCount] = useState<number | null>(null);
  const [briefingPreferences, setBriefingPreferences] =
    useState<BriefingPreferences>(readBriefingPreferences);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const categories = taxonomy.data?.categories ?? null;
  const adaptiveDefaultDays = useMemo(
    () => defaultHomeDays(home.data?.stories ?? [], now),
    [home.data?.stories, now],
  );
  const briefingDefaultDays =
    briefingPreferences.cadence === "weekly" ? 7 : adaptiveDefaultDays;
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
    briefingDefaultDays,
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
  // Cards need the full registry for named source previews and the image
  // fallback rung. Missing registry rows still degrade to their domain.
  const outletRegistry = outlets.data?.outlets ?? [];
  const hierarchy = useMemo(
    () => buildHomeHierarchy(filteredStories, home.data?.articles ?? []),
    [filteredStories, home.data?.articles],
  );
  const personalizationPaused = category !== "all" || Boolean(query.trim());
  const activeFollowedTopics = useMemo(
    () => (personalizationPaused ? [] : briefingPreferences.followedTopics),
    [personalizationPaused, briefingPreferences.followedTopics],
  );
  const briefing = useMemo(
    () =>
      buildBriefingSections(
        hierarchy,
        activeFollowedTopics,
        briefingPreferences.completedStoryIds,
      ),
    [hierarchy, activeFollowedTopics, briefingPreferences.completedStoryIds],
  );
  useEffect(() => {
    if (!home.data) return;
    const timer = window.setTimeout(() => {
      setAnnouncedCount(briefing.visibleCount);
      if (query.trim())
        emitNewsEvent({
          name: "reader_outcome",
          task: "search",
          outcome: briefing.visibleCount ? "results" : "empty",
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [briefing.visibleCount, home.data, query]);

  useEffect(() => {
    if (!categories) return;
    const known = new Set(
      categories
        .filter((item) => item.id !== "not-site-relevant")
        .map((item) => item.id),
    );
    const followedTopics = briefingPreferences.followedTopics.filter((id) =>
      known.has(id),
    );
    if (followedTopics.length === briefingPreferences.followedTopics.length)
      return;
    const next = { ...briefingPreferences, followedTopics };
    setBriefingPreferences(next);
    writeBriefingPreferences(next);
  }, [briefingPreferences, categories]);
  const briefingTopics = useMemo(() => {
    const ranked = [...availableCategories].sort(
      (a, b) =>
        Number(briefingPreferences.followedTopics.includes(b.id)) -
          Number(briefingPreferences.followedTopics.includes(a.id)) ||
        (categoryCounts.get(b.id) ?? 0) - (categoryCounts.get(a.id) ?? 0) ||
        a.label[language].localeCompare(b.label[language], language),
    );
    const limit = Math.max(6, briefingPreferences.followedTopics.length);
    return ranked.slice(0, limit).map((item) => ({
      id: item.id,
      label: item.label[language],
      count: categoryCounts.get(item.id) ?? 0,
    }));
  }, [
    availableCategories,
    briefingPreferences.followedTopics,
    categoryCounts,
    language,
  ]);
  const newStoryCount = useMemo(
    () =>
      storiesSinceBriefing(
        briefing.currentStoryIds.map((id) => ({ id })),
        briefingPreferences.completedStoryIds,
      ),
    [briefing.currentStoryIds, briefingPreferences.completedStoryIds],
  );
  const updateBriefingPreferences = (next: BriefingPreferences) => {
    const safe = sanitizeBriefingPreferences(next);
    setBriefingPreferences(safe);
    writeBriefingPreferences(safe);
  };
  const finishBriefing = () =>
    updateBriefingPreferences({
      ...briefingPreferences,
      lastCompletedAt: new Date(Date.now()).toISOString(),
      completedStoryIds: briefing.currentStoryIds,
    });
  const changeDays = (nextDays: number) => {
    setDays(nextDays);
    if (nextDays !== 1 && nextDays !== 7) return;
    const cadence: BriefingCadence = nextDays === 1 ? "daily" : "weekly";
    if (briefingPreferences.cadence !== cadence)
      updateBriefingPreferences({ ...briefingPreferences, cadence });
  };
  const activeCadence: BriefingCadence | "custom" =
    days === 1 ? "daily" : days === 7 ? "weekly" : "custom";
  const storyCard = (item: (typeof briefing.update)[number]) => (
    <StoryCard
      key={item.story.id}
      story={item.story}
      taxonomy={categories}
      imageArticle={item.imageArticle}
      outlets={outletRegistry}
      kind={item.kind}
      density={briefingPreferences.density}
    />
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
        defaultDays={briefingDefaultDays}
        query={query}
        onCategoryChange={setCategory}
        onDaysChange={changeDays}
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

      {/* One deterministic, finite briefing. Preferences never remove the
          explicit outside-interests section or create an infinite feed. */}
      <section aria-labelledby="stories-heading">
        {/* ⚠️ sr-only, NOT deleted. The section points at this id with
            `aria-labelledby`, so removing the element would leave the whole
            briefing landmark with no accessible name — the heading is what a
            screen reader announces on entering it. Hidden visually because the
            page already reads as a briefing and the count is repeated by the
            "Показваме:" line above. */}
        <h2 id="stories-heading" className="sr-only">
          {tr("Кратък преглед", "Briefing")} ({briefing.visibleCount})
        </h2>
        {home.loading && !home.data ? (
          // Two blocks, because the grid holds at most two tracks — a third
          // wrapped to a row of its own and promised a shape the loaded page
          // never takes.
          <div className={STORY_GRID}>
            {[0, 1].map((i) => (
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
          <div className="space-y-7">
            {briefing.update.length ? (
              <section aria-labelledby="briefing-update-heading">
                {/* sr-only for the same reason as `stories-heading`: the
                    section is labelled by it. */}
                <h3 id="briefing-update-heading" className="sr-only">
                  {tr("Обнови ме", "Update me")}
                </h3>
                <div className="space-y-5">
                  {/* ⚠️ The lead module renders only when the lead is also
                      the FIRST update item — a story the reader has already
                      completed drops out of `update`, and the module goes with
                      it rather than repeating a story the briefing considers
                      done. So "compact keeps the lead" means "compact no
                      longer suppresses it", not that it is always present. */}
                  {hierarchy.lead &&
                  briefing.update[0]?.story.id === hierarchy.lead.story.id ? (
                    <LeadStory
                      item={hierarchy.lead}
                      taxonomy={categories}
                      outlets={outletRegistry}
                      density={briefingPreferences.density}
                    />
                  ) : briefing.update[0] ? (
                    storyCard(briefing.update[0])
                  ) : null}
                  {briefing.update.length > 1 ? (
                    <div className={STORY_GRID}>
                      {briefing.update.slice(1).map(storyCard)}
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}

            <BriefingControls
              preferences={briefingPreferences}
              activeCadence={activeCadence}
              topics={briefingTopics}
              newStoryCount={newStoryCount}
              personalizationPaused={personalizationPaused}
              onChange={updateBriefingPreferences}
              onCadenceChange={(cadence) =>
                changeDays(cadence === "daily" ? 1 : 7)
              }
              onComplete={finishBriefing}
            />

            {briefing.moreAnalyzed.length ? (
              <section aria-labelledby="briefing-explain-heading">
                <h3
                  id="briefing-explain-heading"
                  className="app-section-title mb-3"
                >
                  {tr("Още анализирани истории", "More analyzed stories")}
                </h3>
                <div className={STORY_GRID}>
                  {briefing.moreAnalyzed.map(storyCard)}
                </div>
              </section>
            ) : null}

            {briefing.perspectives.length ? (
              <section aria-labelledby="briefing-perspectives-heading">
                <h3
                  id="briefing-perspectives-heading"
                  className="app-section-title mb-3"
                >
                  {tr("Различни гледни точки", "Different perspectives")}
                </h3>
                <div className={STORY_GRID}>
                  {briefing.perspectives.map(storyCard)}
                </div>
              </section>
            ) : null}

            <section aria-labelledby="briefing-outside-heading">
              <h3
                id="briefing-outside-heading"
                className="app-section-title mb-3"
              >
                {tr(
                  "Водещи истории извън интересите ви",
                  "Top stories outside your interests",
                )}
              </h3>
              {personalizationPaused ? (
                <Card className="p-4 text-sm text-muted-foreground">
                  {tr(
                    "Групирането по интереси е спряно за активното търсене или тематичен филтър; всички подбрани съвпадения са показани по-горе.",
                    "Interest grouping is paused for the active search or topic filter; every selected match is shown above.",
                  )}
                </Card>
              ) : briefingPreferences.followedTopics.length === 0 ? (
                <Card className="p-4 text-sm text-muted-foreground">
                  {tr(
                    "Изберете следвани теми, за да виждате тук отделна извадка. Дотогава нищо не е скрито от прегледа.",
                    "Follow topics to create a separate sample here. Until then, nothing is hidden from the briefing.",
                  )}
                </Card>
              ) : briefing.outsideInterests.length ? (
                <div className={STORY_GRID}>
                  {briefing.outsideInterests.map(storyCard)}
                </div>
              ) : (
                <Card className="p-4 text-sm text-muted-foreground">
                  {tr(
                    "В текущия краен списък няма други теми; променете периода за по-широка извадка.",
                    "This finite list has no other topics; widen the period for a broader sample.",
                  )}
                </Card>
              )}
            </section>
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
