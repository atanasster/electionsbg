import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TaxonomyCategory } from "../data";
import { HOME_TIMEFRAMES } from "../homeFilters";

export const HomeFilterControls = ({
  categories,
  categoryCounts,
  category,
  days,
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
  query: string;
  onCategoryChange: (value: string) => void;
  onDaysChange: (value: number) => void;
  onQueryChange: (value: string) => void;
  onReset: () => void;
}) => {
  const filtersActive =
    category !== "all" || days !== 30 || Boolean(query.trim());
  return (
    <section className="space-y-3" aria-label="Филтри на историите">
      <div
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="group"
        aria-label="Тема"
      >
        <Button
          type="button"
          size="sm"
          variant={category === "all" ? "default" : "outline"}
          className="shrink-0 rounded-full"
          aria-pressed={category === "all"}
          onClick={() => onCategoryChange("all")}
        >
          Всички
        </Button>
        {categories.map((item) => (
          <Button
            key={item.id}
            type="button"
            size="sm"
            variant={category === item.id ? "default" : "outline"}
            className="shrink-0 rounded-full"
            aria-pressed={category === item.id}
            onClick={() => onCategoryChange(item.id)}
          >
            {item.label.bg} · {categoryCounts.get(item.id) ?? 0}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex max-w-full overflow-x-auto rounded-lg border p-0.5"
          role="group"
          aria-label="Период"
        >
          {HOME_TIMEFRAMES.map((timeframe) => (
            <Button
              key={timeframe.days}
              type="button"
              size="sm"
              variant={days === timeframe.days ? "secondary" : "ghost"}
              className="shrink-0"
              aria-pressed={days === timeframe.days}
              onClick={() => onDaysChange(timeframe.days)}
            >
              {timeframe.label}
            </Button>
          ))}
        </div>
        <div className="relative min-w-52 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Търсене в заглавия и резюмета…"
            className="pl-8"
            aria-label="Търсене"
          />
        </div>
        {filtersActive ? (
          <Button type="button" variant="ghost" size="sm" onClick={onReset}>
            Изчисти
          </Button>
        ) : null}
      </div>
    </section>
  );
};
