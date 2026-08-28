// Home — the ground.news feed: stats strip, filters (category / timeframe /
// search), blindspot rail, story cards, and the latest-articles wire beneath.

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { relativeTime } from "../labels";
import {
  useHome,
  useOutlets,
  useStats,
  useTaxonomy,
  type Outlet,
  type Story,
} from "../data";
import { StoryCard } from "../components/StoryCard";
import { LeadStory } from "../components/LeadStory";
import { buildHomeHierarchy, HOME_SUPPORTING_LIMIT } from "../homeHierarchy";

const TIMEFRAMES = [
  { days: 0, label: "Всички" },
  { days: 1, label: "24 часа" },
  { days: 7, label: "7 дни" },
  { days: 30, label: "30 дни" },
] as const;

const STORY_GRID = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3";
const withinDays = (iso: string | null | undefined, days: number): boolean => {
  if (!days) return true;
  if (!iso) return false;
  const t = new Date(iso).getTime();
  // Unparseable dates (NaN) drop out of time-filtered views rather than
  // silently passing every window.
  const age = Date.now() - t;
  return Number.isFinite(t) && age >= 0 && age <= days * 86400_000;
};

const storyMatches = (
  story: Story,
  category: string,
  days: number,
  q: string,
): boolean => {
  if (category !== "all" && !story.topics.some((t) => t.category === category))
    return false;
  if (!withinDays(story.last_published, days)) return false;
  if (q) {
    const haystack = `${story.title_bg ?? ""} ${story.title_en ?? ""} ${story.summary_bg ?? ""}`;
    if (!haystack.toLowerCase().includes(q)) return false;
  }
  return true;
};

export const HomeScreen = () => {
  const stats = useStats();
  const home = useHome();
  const taxonomy = useTaxonomy();
  const outlets = useOutlets();

  const [category, setCategory] = useState<string>("all");
  const [days, setDays] = useState<number>(30);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const categories = taxonomy.data?.categories ?? null;

  const filteredStories = useMemo(
    () =>
      (home.data?.stories ?? []).filter((s) =>
        storyMatches(s, category, days, q),
      ),
    [home.data, category, days, q],
  );
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
      <section>
        <h1 className="font-title text-3xl">Всяка страна на всяка история</h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">
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

      {/* Filters */}
      <section
        className="flex flex-wrap items-center gap-2"
        aria-label="Филтри"
      >
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-56" aria-label="Тема">
            <SelectValue placeholder="Тема" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Всички теми</SelectItem>
            {(categories ?? [])
              .filter((c) => c.id !== "not-site-relevant")
              .map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label.bg} ({c.story_count})
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Select
          value={String(days)}
          onValueChange={(v) => {
            const next = TIMEFRAMES.find((t) => String(t.days) === v);
            if (next) setDays(next.days);
          }}
        >
          <SelectTrigger className="w-36" aria-label="Период">
            <SelectValue placeholder="Период" />
          </SelectTrigger>
          <SelectContent>
            {TIMEFRAMES.map((t) => (
              <SelectItem key={t.days} value={String(t.days)}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative min-w-52 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Търсене в заглавия и резюмета…"
            className="pl-8"
            aria-label="Търсене"
          />
        </div>
      </section>

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
