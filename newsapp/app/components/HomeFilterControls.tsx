import { ChevronDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TaxonomyCategory } from "../data";
import { HOME_TIMEFRAMES } from "../homeFilters";
import { emitNewsEvent } from "../analytics";
import { useNewsLocale } from "../i18n";

export const HomeFilterControls = ({
  categories,
  categoryCounts,
  category,
  days,
  defaultDays,
  query,
  onCategoryChange,
  onDaysChange,
  onQueryChange,
  onReset,
}: {
  categories: TaxonomyCategory[];
  categoryCounts: Map<string, number>;
  category: string;
  days: number;
  defaultDays: number;
  query: string;
  onCategoryChange: (value: string) => void;
  onDaysChange: (value: number) => void;
  onQueryChange: (value: string) => void;
  onReset: () => void;
}) => {
  const { language, tr } = useNewsLocale();
  const filtersActive =
    category !== "all" || days !== defaultDays || Boolean(query.trim());
  /**
   * ⚠️ NO READINESS GUARD HERE, DELIBERATELY — and it was measured rather
   * than assumed. „Absent is not zero" governs the LABEL (see below), but in
   * the comparator the two forms are the same function: while the corpus
   * index is in flight the map is EMPTY, `?? 0` makes every category equal,
   * and the comparison already falls through to the label — which is what an
   * explicit `size ? byCount : byLabel` would also do. Adding the guard is
   * configuration that cannot be wrong, and a test for it passes against
   * both implementations.
   *
   * What IS real and is not fixed by either form: when the counts land the
   * top four are recomputed and the row re-orders. That is inherent to
   * ranking by a number that arrives late; the fix is a stable slot or a
   * deferred re-rank, not a comparator change.
   */
  const byLabel = (a: TaxonomyCategory, b: TaxonomyCategory) =>
    a.label[language].localeCompare(b.label[language], language);
  const rankedCategories = [...categories].sort(
    (a, b) =>
      (categoryCounts.get(b.id) ?? 0) - (categoryCounts.get(a.id) ?? 0) ||
      byLabel(a, b),
  );
  const quickCategories = rankedCategories.slice(0, 4);
  const selectedCategory = rankedCategories.find(
    (item) => item.id === category,
  );
  if (
    selectedCategory &&
    !quickCategories.some((item) => item.id === selectedCategory.id)
  ) {
    quickCategories.push(selectedCategory);
  }
  const quickCategoryIds = new Set(quickCategories.map((item) => item.id));
  const remainingCategories = rankedCategories.filter(
    (item) => !quickCategoryIds.has(item.id),
  );
  const selectedCategoryLabel =
    category === "all"
      ? tr("Всички теми", "All topics")
      : (selectedCategory?.label[language] ?? category);
  const selectedPeriod =
    HOME_TIMEFRAMES.find((timeframe) => timeframe.days === days)?.label ??
    `${days} дни`;

  const categoryButton = (item: TaxonomyCategory) => (
    <Button
      key={item.id}
      type="button"
      size="sm"
      variant={category === item.id ? "default" : "outline"}
      className="shrink-0 rounded-full"
      aria-pressed={category === item.id}
      onClick={() => {
        emitNewsEvent({
          name: "home_filter",
          filter: "category",
          active: true,
        });
        onCategoryChange(item.id);
      }}
    >
      {/* ⚠️ NO COUNT IS NOT A COUNT OF ZERO. `?? 0` printed „Икономика · 0"
          for the whole time the corpus index was in flight, and „0" beside a
          topic is a claim that nothing was written about it. */}
      {item.label[language]}
      {categoryCounts.has(item.id) ? ` · ${categoryCounts.get(item.id)}` : ""}
    </Button>
  );

  return (
    <section
      className="space-y-2"
      aria-label={tr("Филтри на историите", "Story filters")}
    >
      <div
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="group"
        aria-label={tr("Тема", "Topic")}
      >
        <Button
          type="button"
          size="sm"
          variant={category === "all" ? "default" : "outline"}
          className="shrink-0 rounded-full"
          aria-pressed={category === "all"}
          onClick={() => {
            emitNewsEvent({
              name: "home_filter",
              filter: "category",
              active: false,
            });
            onCategoryChange("all");
          }}
        >
          {tr("Всички", "All")}
        </Button>
        {quickCategories.map(categoryButton)}
      </div>
      {remainingCategories.length ? (
        <details className="group rounded-md border border-border/70 px-2">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-sm text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&::-webkit-details-marker]:hidden">
            {tr("Всички теми и филтри", "All topics and filters")}
            <ChevronDown
              aria-hidden
              className="size-4 transition-transform group-open:rotate-180"
            />
          </summary>
          <div
            className="flex flex-wrap gap-2 border-t py-3"
            role="group"
            aria-label={tr("Още теми", "More topics")}
          >
            {remainingCategories.map(categoryButton)}
          </div>
        </details>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex max-w-full overflow-x-auto rounded-lg border p-0.5"
          role="group"
          aria-label={tr("Период", "Period")}
        >
          {HOME_TIMEFRAMES.map((timeframe) => (
            <Button
              key={timeframe.days}
              type="button"
              size="sm"
              variant={days === timeframe.days ? "secondary" : "ghost"}
              className="shrink-0"
              aria-pressed={days === timeframe.days}
              onClick={() => {
                emitNewsEvent({
                  name: "home_filter",
                  filter: "period",
                  active: timeframe.days !== defaultDays,
                });
                onDaysChange(timeframe.days);
              }}
            >
              {timeframe.days === 1
                ? tr("24 часа", "24 hours")
                : tr(timeframe.label, `${timeframe.days} days`)}
            </Button>
          ))}
        </div>
        <div className="relative min-w-52 flex-1">
          <Search
            aria-hidden
            className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            id="news-search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={tr(
              "Търсене в заглавия и резюмета…",
              "Search titles and summaries…",
            )}
            className="scroll-mt-20 pl-8"
            aria-label={tr("Търсене", "Search")}
          />
        </div>
      </div>
      <div className="flex min-h-8 items-center justify-between gap-2 text-xs text-muted-foreground">
        <p role="status">
          {tr("Показваме", "Showing")}: {selectedCategoryLabel} ·{" "}
          {days === 1
            ? tr("24 часа", "24 hours")
            : tr(selectedPeriod, `${days} days`)}
          {query.trim() ? ` · ${tr("търсене", "search")}` : ""}
        </p>
        {filtersActive ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              emitNewsEvent({
                name: "home_filter",
                filter: "reset",
                active: false,
              });
              onReset();
            }}
            className="shrink-0"
          >
            {tr("Изчисти", "Clear")}
          </Button>
        ) : null}
      </div>
    </section>
  );
};
