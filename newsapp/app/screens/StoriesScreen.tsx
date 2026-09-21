// The corpus browse — every published story, under one global query.
//
// ⚠️⚠️ THE ROUTE R1 WAS MISSING. The home page is a finite briefing (≤16
// stories) and says „Показваме 1 от 139"; this is where the other 138 are.
// The rules are in `storyBrowse.ts`; this file is their rendering, and the
// three properties it must keep are:
//
//   1. the predicate runs over the WHOLE corpus (`useGlobalStoryQuery`), so
//      the count and the facet chips are facts about the corpus, never
//      about what has downloaded;
//   2. the order comes from the published pages (`ranked-N` / `index-N`),
//      revealed as a PREFIX and intersected with the match set — so a story
//      is shown in its rank, and never invented or dropped at a boundary;
//   3. one browse is one snapshot: the window's anchor is pinned per query
//      (`usePinnedInstant`), a sort change starts a new prefix, a base
//      publish while paging is REPORTED with a refresh and never continued
//      from (`staleVintage`), and a hot overlay is merged into the prefix,
//      the match set and the counts TOGETHER (`storyListView` + the
//      overlay-replaced filter index), so no row moves without its count.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PackSelect } from "@/screens/components/procurement/PackSelect";
import {
  useGlobalStoryQuery,
  useOutlets,
  useStoryList,
  useTaxonomy,
  type StoryIndexRow,
  type StorySort,
} from "../data";
import {
  articles as articlesLabel,
  relativeTime,
  stories as storiesLabel,
  topicLabel,
} from "../labels";
import { listState } from "../storyQuery";
import {
  BROWSE_DAYS,
  BROWSE_DEFAULT_DAYS,
  BROWSE_FILL_ROW_CEILING,
  BROWSE_SORTS,
  BROWSE_STEP,
  browseQuery,
  browseRows,
  readBrowseDepth,
  writeBrowseDepth,
} from "../storyBrowse";
import { useUrlStoryBrowse } from "../useUrlStoryBrowse";
import { useNewsLocale } from "../i18n";

const ALL = "all";

const rowText = (row: StoryIndexRow): string =>
  `${row.title_bg ?? ""} ${row.title_en ?? ""}`;

/**
 * ⚠️ THE WINDOW'S ANCHOR IS CAPTURED ONCE PER QUERY, never per render. A
 * rolling window read off the live clock moves under the reader: page 2 is
 * fetched a minute later, the boundary has shifted, and a story either
 * repeats or disappears between pages. A filter change is a new query and
 * re-pins it; nothing else does — a ref rather than an effect, so the first
 * render of a new query already carries its own instant and no render ever
 * pairs one query's filters with another's anchor.
 */
const usePinnedInstant = (queryKey: string): number => {
  const pinned = useRef<{ key: string; now: number } | null>(null);
  if (pinned.current === null || pinned.current.key !== queryKey)
    pinned.current = { key: queryKey, now: Date.now() };
  return pinned.current.now;
};

export const StoriesScreen = () => {
  const { language, tr } = useNewsLocale();
  const taxonomy = useTaxonomy();
  const outlets = useOutlets();

  const categories = useMemo(
    () =>
      (taxonomy.data?.categories ?? []).filter(
        (item) => item.id !== "not-site-relevant",
      ),
    [taxonomy.data],
  );
  const categoryIds = useMemo(
    () => (taxonomy.data ? categories.map((item) => item.id) : null),
    [taxonomy.data, categories],
  );
  const domainIds = useMemo(
    () => outlets.data?.outlets.map((item) => item.domain) ?? null,
    [outlets.data],
  );
  const filters = useUrlStoryBrowse(categoryIds, domainIds);
  const { category, days, domain, sort, query, search } = filters;

  // ⚠️ Not `sort`: an ordering is not a filter. Toggling it resets the
  // prefix but leaves the window where the reader put it.
  const now = usePinnedInstant(`${category}\u0000${days}\u0000${domain}`);
  const corpusQuery = useMemo(
    () => browseQuery({ category, days, domain }, now),
    [category, days, domain, now],
  );
  const corpus = useGlobalStoryQuery(corpusQuery);
  const list = useStoryList(sort);

  // How many matching rows the reader has asked to see. Restored from the
  // depth memory so Back lands on the list they left. ⚠️ The target and the
  // browse it was read for travel as ONE value, so the memory is never
  // written under a new browse's key with the previous browse's depth.
  const [depth, setDepth] = useState(() => ({
    search,
    target: readBrowseDepth(search),
  }));
  useEffect(() => {
    if (depth.search !== search)
      setDepth({ search, target: readBrowseDepth(search) });
  }, [search, depth.search]);
  useEffect(() => {
    writeBrowseDepth(depth.search, depth.target);
  }, [depth]);
  const target = depth.search === search ? depth.target : BROWSE_STEP;
  const setTarget = (update: (n: number) => number) =>
    setDepth((prev) => ({ ...prev, target: update(prev.target) }));

  const { rows: matching, scope } = useMemo(
    () =>
      browseRows(
        list.stories,
        corpus.result.match,
        query,
        rowText,
        corpus.result.ids.length,
      ),
    [list.stories, corpus.result.match, corpus.result.ids.length, query],
  );
  const shown = matching.slice(0, target);
  const moreInHand = matching.length > shown.length;

  /**
   * ⚠️ FILL, BUT NOT WITHOUT LIMIT. A narrow filter can match nothing on the
   * first pages of the ordering, so the browse keeps revealing pages until
   * the target is met or the ordering is exhausted — up to a ceiling, past
   * which it stops and the button names the cost. It never fills across a
   * publish: a stale prefix must not be extended with a fresh page.
   */
  const fill =
    corpus.ready &&
    !query.trim() &&
    // ⚠️ A FAILED PAGE STOPS THE FILL. `useData` keeps the previous page
    // beside the error, so without this the predicate flips back to true
    // and the fill steps over the page that never landed — a prefix with a
    // hole in it, ending in „това са всички". The reader retries instead.
    !list.error &&
    matching.length < target &&
    list.hasMore &&
    !list.loading &&
    !list.staleVintage &&
    list.sort === sort &&
    list.stories.length < BROWSE_FILL_ROW_CEILING;
  // ⚠️ KEYED ON `loadMore`, NOT ON `list`. `list` is a fresh object every
  // render, and the render right after `setPage` still reports `loading:
  // false` — so an effect re-running on it would advance the page twice
  // for one fill. `loadMore` is stable for the life of a page count.
  const { loadMore } = list;
  useEffect(() => {
    if (fill) loadMore();
  }, [fill, loadMore]);

  const state = listState({
    revealed: matching.length,
    total: corpus.result.ids.length,
    hasMore: list.hasMore,
    ready: corpus.ready,
    error: corpus.error,
  });
  const total = corpus.result.ids.length;
  const facets = corpus.ready ? corpus.result.facets : null;

  /** „N издания · M статии" — the components a reader can check. */
  const coverage = (outlets: number, count: number): string =>
    `${outlets} ${
      language === "bg"
        ? outlets === 1
          ? "издание"
          : "издания"
        : outlets === 1
          ? "outlet"
          : "outlets"
    } · ${articlesLabel(count, language)}`;

  const outletName = (id: string): string =>
    outlets.data?.outlets.find((item) => item.domain === id)?.outlet ?? id;
  const domainOptions = useMemo(() => {
    const counts = facets?.domains ?? {};
    const known = outlets.data?.outlets ?? [];
    const options = known
      .map((item) => ({
        value: item.domain,
        count: counts[item.domain] ?? 0,
        label: item.outlet,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "bg"))
      .map((item) => ({
        value: item.value,
        label: facets ? `${item.label} · ${item.count}` : item.label,
      }));
    return [
      { value: ALL, label: tr("Всички източници", "All sources") },
      ...options,
    ];
  }, [facets, outlets.data, tr]);

  const sortLabel = (value: StorySort) =>
    value === "ranked"
      ? tr("Най-отразявани", "Most covered")
      : tr("Последни", "Latest");
  const daysLabel = (value: number) =>
    value === 0
      ? tr("Всички", "All time")
      : value === 1
        ? tr("24 часа", "24 hours")
        : tr(`${value} дни`, `${value} days`);

  const filtersActive =
    category !== ALL ||
    domain !== ALL ||
    days !== BROWSE_DEFAULT_DAYS ||
    Boolean(query.trim());

  return (
    <div className="space-y-5">
      <section className="border-b pb-4">
        <p className="app-eyebrow mb-2">{tr("Архив", "Archive")}</p>
        <h1 className="app-page-title">
          {tr("Всички истории", "All stories")}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {tr(
            "Целият корпус, подреден по това колко издания са отразили едно събитие. Началната страница е кратък преглед; тук е всичко.",
            "The whole corpus, ordered by how many outlets covered one event. The home page is a briefing; this is everything.",
          )}
        </p>
      </section>

      <section
        className="space-y-2"
        aria-label={tr("Филтри на архива", "Archive filters")}
      >
        <div
          className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="group"
          aria-label={tr("Тема", "Topic")}
        >
          <Button
            type="button"
            size="sm"
            variant={category === ALL ? "default" : "outline"}
            className="shrink-0 rounded-full"
            aria-pressed={category === ALL}
            onClick={() => filters.setCategory(ALL)}
          >
            {tr("Всички теми", "All topics")}
          </Button>
          {categories.map((item) => (
            <Button
              key={item.id}
              type="button"
              size="sm"
              variant={category === item.id ? "default" : "outline"}
              className="shrink-0 rounded-full"
              aria-pressed={category === item.id}
              onClick={() => filters.setCategory(item.id)}
            >
              {/* ⚠️ NO COUNT IS NOT A COUNT OF ZERO — the chip carries no
                  number until the corpus index has landed. */}
              {item.label[language]}
              {facets && item.id in facets.categories
                ? ` · ${facets.categories[item.id]}`
                : facets
                  ? " · 0"
                  : ""}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex max-w-full overflow-x-auto rounded-lg border p-0.5"
            role="group"
            aria-label={tr("Период", "Period")}
          >
            {BROWSE_DAYS.map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={days === value ? "secondary" : "ghost"}
                className="shrink-0"
                aria-pressed={days === value}
                onClick={() => filters.setDays(value)}
              >
                {daysLabel(value)}
              </Button>
            ))}
          </div>
          <div
            className="flex max-w-full overflow-x-auto rounded-lg border p-0.5"
            role="group"
            aria-label={tr("Подредба", "Order")}
          >
            {BROWSE_SORTS.map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={sort === value ? "secondary" : "ghost"}
                className="shrink-0"
                aria-pressed={sort === value}
                onClick={() => filters.setSort(value)}
              >
                {sortLabel(value)}
              </Button>
            ))}
          </div>
          <PackSelect
            value={domain}
            options={domainOptions}
            onChange={(value) => filters.setDomain(value)}
            ariaLabel={tr("Източник", "Source")}
            align="start"
            contentClassName="max-h-80 overflow-y-auto"
          />
          <div className="relative min-w-52 flex-1">
            <Search
              aria-hidden
              className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => filters.setQuery(event.target.value)}
              placeholder={tr(
                "Търсене в заредените заглавия…",
                "Search the loaded titles…",
              )}
              className="pl-8"
              aria-label={tr("Търсене", "Search")}
            />
          </div>
        </div>
        <div className="flex min-h-8 items-center justify-between gap-2 text-xs text-muted-foreground">
          <p role="status">
            {tr("Показваме", "Showing")}:{" "}
            {category === ALL
              ? tr("всички теми", "all topics")
              : (categories.find((item) => item.id === category)?.label[
                  language
                ] ?? category)}
            {" · "}
            {daysLabel(days)}
            {domain === ALL ? "" : ` · ${outletName(domain)}`}
            {" · "}
            {sortLabel(sort)}
          </p>
          {filtersActive ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={filters.clearFilters}
            >
              {tr("Изчисти", "Clear")}
            </Button>
          ) : null}
        </div>
      </section>

      {(taxonomy.error && !taxonomy.data) ||
      (outlets.error && !outlets.data) ? (
        <Card className="p-4 text-sm text-destructive">
          {tr(
            "Част от данните (теми/източници) не се заредиха — филтрите може да са непълни.",
            "Some topic or source data could not be loaded, so the filters may be incomplete.",
          )}
        </Card>
      ) : null}

      {/* ⚠️ A PUBLISH IS REPORTED, NEVER SILENTLY CONTINUED FROM. The
          revealed prefix is one vintage; page N+1 of the next vintage does
          not belong behind it. The reader chooses when to start over. */}
      {list.staleVintage ? (
        <Card className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
          <span>
            {tr(
              "Излезе ново издание. Списъкът е от предишното.",
              "A new release is out. This list is from the previous one.",
            )}
          </span>
          <Button type="button" size="sm" onClick={list.reset}>
            {tr("Обнови списъка", "Refresh the list")}
          </Button>
        </Card>
      ) : null}

      <section aria-labelledby="browse-heading">
        <h2 id="browse-heading" className="sr-only">
          {tr("Истории", "Stories")}
        </h2>
        {state === "failed" ? (
          <Card className="p-4 text-sm text-destructive">
            {tr(
              "Не можахме да заредим индекса на корпуса, затова не можем да преброим или филтрираме историите.",
              "We could not load the corpus index, so we cannot count or filter the stories.",
            )}
          </Card>
        ) : state === "loading" && shown.length === 0 ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 rounded-xl" />
            ))}
          </div>
        ) : state === "empty" ? (
          <Card className="p-6 text-sm text-muted-foreground">
            {tr(
              "Няма истории за избраните филтри.",
              "No stories match these filters.",
            )}
          </Card>
        ) : (
          <Card id="browse-list" className="divide-y p-0">
            {shown.length === 0 && (list.loading || fill) ? (
              <div className="px-4 py-3" aria-busy="true">
                <Skeleton className="h-10 rounded-md" />
              </div>
            ) : null}
            {shown.map((row) => {
              const primary =
                row.topics.find((t) => t.primary) ?? row.topics[0] ?? null;
              const topic = primary
                ? topicLabel(
                    categories,
                    primary.category,
                    primary.subcategory,
                    language,
                  )
                : null;
              const p = row.prominence;
              return (
                <div key={row.id} className="px-4 py-2.5">
                  <Link
                    to={`/story/${row.id}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {(language === "bg" ? row.title_bg : row.title_en) ??
                      row.title_bg ??
                      tr("История без заглавие", "Untitled story")}
                  </Link>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    {topic ? (
                      <Badge variant="secondary" className="font-normal">
                        {topic}
                      </Badge>
                    ) : null}
                    {/* ⚠️ THE COMPONENTS, NOT THE SCORE. „6 издания · 11
                        материала" is a fact a reader can check; a rank is a
                        number they must trust. */}
                    <span>
                      {p
                        ? coverage(p.outlets, p.articles)
                        : coverage(row.domains.length, row.member_count)}
                    </span>
                    <span>{relativeTime(row.last_published, language)}</span>
                  </p>
                </div>
              );
            })}
            <div className="px-4 py-3 text-xs text-muted-foreground">
              {/* ⚠️ BOTH NUMBERS, ALWAYS — and a search names its scope,
                  because the index carries no titles and the term was
                  applied only to what is in hand. */}
              {query.trim() ? (
                <p>
                  {tr(
                    `${storiesLabel(shown.length, language)} · търсено в ${scope.searched} от ${storiesLabel(scope.of, language)} за този филтър${scope.complete ? "" : " — заредете още, за да търсите в останалите"}.`,
                    `${storiesLabel(shown.length, language)} · searched ${scope.searched} of ${storiesLabel(scope.of, language)} matching this filter${scope.complete ? "" : " — load more to search the rest"}.`,
                  )}
                </p>
              ) : (
                <p>
                  {tr(
                    `Показани са ${shown.length} от ${storiesLabel(total, language)}`,
                    `Showing ${shown.length} of ${storiesLabel(total, language)}`,
                  )}
                  {state === "complete" && !moreInHand
                    ? ` — ${tr("това са всички", "that is all of them")}`
                    : ""}
                </p>
              )}
              {sort === "ranked" && list.merged ? (
                <p className="mt-1">
                  {tr(
                    `Подредбата е изчислена към ${list.asOf ? relativeTime(list.asOf, language) : "последното пълно издание"}; по-нови истории са добавени без ново класиране.`,
                    `The order was scored ${list.asOf ? relativeTime(list.asOf, language) : "at the last full release"}; newer stories were added without re-ranking.`,
                  )}
                </p>
              ) : null}
              {list.error ? (
                <p className="mt-1 text-destructive" role="alert">
                  {tr(
                    "Следващата страница не се зареди.",
                    "The next page could not be loaded.",
                  )}{" "}
                  <button
                    type="button"
                    onClick={list.retry}
                    className="font-medium underline underline-offset-4"
                  >
                    {tr("Опитай пак", "Try again")}
                  </button>
                </p>
              ) : null}
              {moreInHand || list.hasMore ? (
                <button
                  type="button"
                  onClick={() => {
                    setTarget((n) => n + BROWSE_STEP);
                    if (!moreInHand && !list.staleVintage) list.loadMore();
                  }}
                  disabled={
                    !moreInHand &&
                    (list.loading || list.staleVintage || Boolean(list.error))
                  }
                  aria-controls="browse-list"
                  className="mt-1 min-h-11 text-sm font-medium text-primary hover:underline disabled:opacity-50"
                >
                  {list.loading && !moreInHand
                    ? tr("Зареждане…", "Loading…")
                    : list.stories.length >= BROWSE_FILL_ROW_CEILING &&
                        !moreInHand
                      ? tr(
                          "Зареди още страници от подредбата",
                          "Load more pages of the ordering",
                        )
                      : tr("Покажи още", "Show more")}
                </button>
              ) : null}
            </div>
          </Card>
        )}
      </section>
    </div>
  );
};
