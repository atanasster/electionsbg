// Home — the ground.news feed: stats strip, filters (category / timeframe /
// search), blindspot rail, story cards, and the latest-articles wire beneath.

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { relativeTime } from "../labels";
import {
  useHome,
  useOutlets,
  useStats,
  useTaxonomy,
  type Outlet,
} from "../data";
import { StoryCard } from "../components/StoryCard";
import { LeadStory } from "../components/LeadStory";
import { HomeFilterControls } from "../components/HomeFilterControls";
import { buildHomeHierarchy, HOME_SUPPORTING_LIMIT } from "../homeHierarchy";
import { filterHomeStories, homeCategoryCounts } from "../homeFilters";

const STORY_GRID = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3";

export const HomeScreen = () => {
  const stats = useStats();
  const home = useHome();
  const taxonomy = useTaxonomy();
  const outlets = useOutlets();

  const [category, setCategory] = useState<string>("all");
  const [days, setDays] = useState<number>(30);
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [announcedCount, setAnnouncedCount] = useState<number | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const categories = taxonomy.data?.categories ?? null;
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
    () =>
      (categories ?? []).filter(
        (item) =>
          item.id !== "not-site-relevant" &&
          (categoryCounts.has(item.id) || item.id === category),
      ),
    [categories, categoryCounts, category],
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
  // The whole record, not just the name: the card's image needs the outlet's
  // logo (the fallback rung) and its hotlink verdict.
  const outletByDomain = useMemo(() => {
    const map = new Map<string, Outlet>();
    for (const o of outlets.data?.outlets ?? []) map.set(o.domain, o);
    return map;
  }, [outlets.data]);
  const hierarchy = useMemo(
    () => buildHomeHierarchy(filteredStories, home.data?.articles ?? []),
    [filteredStories, home.data?.articles],
  );

  return (
    <div className="space-y-8">
      <section className="news-home-intro border-b pb-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--editorial-kicker))]">
          Независим медиен преглед
        </p>
        <h1 className="max-w-3xl font-title text-4xl leading-[1.05] sm:text-5xl">
          Всяка страна на всяка история
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
          Сравнете как българските медии отразяват едни и същи събития — спектър
          на пристрастията, позиция спрямо Русия и сигнали за ИИ-генерирано
          съдържание.
        </p>
        {/* Stats strip — one glance at corpus + analysis coverage. */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {stats.error && !stats.data ? (
            <span className="text-sm text-destructive">
              Статистиката не се зареди.
            </span>
          ) : stats.data ? (
            <>
              <Badge variant="secondary">{stats.data.stories} истории</Badge>
              <Badge variant="secondary">
                {stats.data.analyzed_articles} анализирани статии (
                {stats.data.analyzed_pct}%)
              </Badge>
              <Badge variant="secondary">
                {stats.data.total_articles} статии общо
              </Badge>
              <Badge variant="secondary">{stats.data.domains} медии</Badge>
              <span className="text-xs text-muted-foreground">
                обновено {relativeTime(stats.data.generated_at)}
              </span>
            </>
          ) : (
            <Skeleton className="h-6 w-72" />
          )}
        </div>
      </section>

      <HomeFilterControls
        categories={availableCategories}
        categoryCounts={categoryCounts}
        category={category}
        days={days}
        query={query}
        onCategoryChange={setCategory}
        onDaysChange={setDays}
        onQueryChange={setQuery}
        onReset={() => {
          setCategory("all");
          setDays(30);
          setQuery("");
        }}
      />
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcedCount === null
          ? ""
          : `${announcedCount} ${announcedCount === 1 ? "история" : "истории"}`}
      </p>

      {home.error && !home.data ? (
        <Card className="p-4 text-sm text-destructive">
          Началният фийд не се зареди: {home.error.message}
        </Card>
      ) : null}
      {(taxonomy.error && !taxonomy.data) ||
      (outlets.error && !outlets.data) ? (
        <Card className="p-4 text-sm text-destructive">
          Част от данните (теми/източници) не се заредиха — филтрите може да са
          непълни.
        </Card>
      ) : null}

      {/* One deterministic lead, followed by a finite supporting briefing. */}
      <section aria-labelledby="stories-heading">
        <h2
          id="stories-heading"
          className="mb-2 text-sm font-semibold uppercase tracking-wide"
        >
          Последно анализирани (
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
            Няма истории за избраните филтри.
          </Card>
        ) : (
          <div className="space-y-5">
            {hierarchy.lead ? (
              <LeadStory
                item={hierarchy.lead}
                taxonomy={categories}
                outlet={outletByDomain.get(hierarchy.lead.imageArticle.domain)}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Няма сравнение с достатъчно източници; показваме анализирани
                статии.
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
                    outlet={outletByDomain.get(item.imageArticle.domain)}
                    kind={item.kind}
                  />
                ))}
              </div>
            ) : null}
          </div>
        )}
        {filteredStories.length > HOME_SUPPORTING_LIMIT + 1 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Показват се водещата и {HOME_SUPPORTING_LIMIT} подбрани истории от{" "}
            {filteredStories.length} — стеснете филтрите, за да видите други.
          </p>
        ) : null}
      </section>
    </div>
  );
};
