// Home — the ground.news feed: stats strip, filters (category / timeframe /
// search), blindspot rail, story cards, and the latest-articles wire beneath.

import { useMemo, useState } from "react";
import { EyeOff, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  useLatest,
  useOutlets,
  useStats,
  useStories,
  useTaxonomy,
  type ArticleRecord,
  type Outlet,
  type Story,
} from "../data";
import { StoryCard } from "../components/StoryCard";
import { ArticleCard } from "../components/ArticleCard";

const TIMEFRAMES = [
  { days: 0, label: "Всички" },
  { days: 1, label: "24 часа" },
  { days: 7, label: "7 дни" },
  { days: 30, label: "30 дни" },
] as const;

const STORY_GRID = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3";
const STORY_PAGE_SIZE = 30;
const BLINDSPOT_LIMIT = 3;

const withinDays = (iso: string | null | undefined, days: number): boolean => {
  if (!days) return true;
  if (!iso) return false;
  const t = new Date(iso).getTime();
  // Unparseable dates (NaN) drop out of time-filtered views rather than
  // silently passing every window.
  return Number.isFinite(t) && Date.now() - t <= days * 86400_000;
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

const articleMatches = (
  article: ArticleRecord,
  category: string,
  days: number,
  q: string,
): boolean => {
  if (!withinDays(article.published, days)) return false;
  if (category !== "all") {
    const topics = article.analysis?.topics ?? [];
    if (!topics.some((t) => t.category === category)) return false;
  }
  if (q) {
    const haystack = `${article.title ?? ""} ${article.excerpt ?? ""} ${article.topic ?? ""}`;
    if (!haystack.toLowerCase().includes(q)) return false;
  }
  return true;
};

export const HomeScreen = () => {
  const stats = useStats();
  const stories = useStories();
  const latest = useLatest();
  const taxonomy = useTaxonomy();
  const outlets = useOutlets();

  const [category, setCategory] = useState<string>("all");
  const [days, setDays] = useState<number>(0);
  const [query, setQuery] = useState("");
  const [latestLimit, setLatestLimit] = useState(30);

  const q = query.trim().toLowerCase();
  const categories = taxonomy.data?.categories ?? null;

  const filteredStories = useMemo(
    () =>
      (stories.data?.stories ?? []).filter((s) =>
        storyMatches(s, category, days, q),
      ),
    [stories.data, category, days, q],
  );
  // side = the wing of the spectrum with ZERO coverage (the missing one).
  const blindspots = useMemo(
    () =>
      filteredStories.flatMap((s) =>
        s.blindspot ? [{ story: s, side: s.blindspot.side }] : [],
      ),
    [filteredStories],
  );
  const filteredLatest = useMemo(
    () =>
      (latest.data?.articles ?? []).filter((a) =>
        articleMatches(a, category, days, q),
      ),
    [latest.data, category, days, q],
  );
  // The whole record, not just the name: the card's image needs the outlet's
  // logo (the fallback rung) and its hotlink verdict.
  const outletByDomain = useMemo(() => {
    const map = new Map<string, Outlet>();
    for (const o of outlets.data?.outlets ?? []) map.set(o.domain, o);
    return map;
  }, [outlets.data]);

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
          {stats.data ? (
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

      {stories.error && !stories.data ? (
        <Card className="p-4 text-sm text-destructive">
          Данните не се заредиха: {stories.error.message}
        </Card>
      ) : null}
      {(taxonomy.error && !taxonomy.data) ||
      (outlets.error && !outlets.data) ? (
        <Card className="p-4 text-sm text-destructive">
          Част от данните (теми/източници) не се заредиха — филтрите може да са
          непълни.
        </Card>
      ) : null}

      {/* Blindspots — stories covered by only one wing of the spectrum. */}
      {blindspots.length > 0 ? (
        <section aria-labelledby="blindspot-heading">
          <div className="mb-2 flex items-center gap-2">
            <EyeOff className="size-4 text-primary" />
            <h2
              id="blindspot-heading"
              className="text-sm font-semibold uppercase tracking-wide"
            >
              Слепи петна
            </h2>
            <span className="text-xs text-muted-foreground">
              истории, отразявани само от едната страна на спектъра
            </span>
          </div>
          <div className={STORY_GRID}>
            {blindspots.slice(0, BLINDSPOT_LIMIT).map(({ story, side }) => (
              <div key={story.id} className="relative">
                <Badge
                  className="absolute -top-2 left-3 z-10"
                  variant="default"
                >
                  {side === "right"
                    ? "без десни източници"
                    : "без леви източници"}
                </Badge>
                <StoryCard story={story} taxonomy={categories} />
              </div>
            ))}
          </div>
          {blindspots.length > BLINDSPOT_LIMIT ? (
            <p className="mt-2 text-xs text-muted-foreground">
              +{blindspots.length - BLINDSPOT_LIMIT} още в общия фийд долу.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Story feed */}
      <section aria-labelledby="stories-heading">
        <h2
          id="stories-heading"
          className="mb-2 text-sm font-semibold uppercase tracking-wide"
        >
          Истории ({filteredStories.length})
        </h2>
        {stories.loading && !stories.data ? (
          <div className={STORY_GRID}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-44 rounded-xl" />
            ))}
          </div>
        ) : filteredStories.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">
            Няма истории за избраните филтри.
          </Card>
        ) : (
          <div className={STORY_GRID}>
            {filteredStories.slice(0, STORY_PAGE_SIZE).map((story) => (
              <StoryCard key={story.id} story={story} taxonomy={categories} />
            ))}
          </div>
        )}
        {filteredStories.length > STORY_PAGE_SIZE ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Показват се първите {STORY_PAGE_SIZE} от {filteredStories.length}{" "}
            истории — стеснете филтрите, за да видите останалите.
          </p>
        ) : null}
      </section>

      {/* Latest wire */}
      <section aria-labelledby="latest-heading">
        <h2
          id="latest-heading"
          className="mb-2 text-sm font-semibold uppercase tracking-wide"
        >
          Последни статии ({filteredLatest.length})
        </h2>
        {latest.error && !latest.data ? (
          <Card className="p-4 text-sm text-destructive">
            Последните статии не се заредиха: {latest.error.message}
          </Card>
        ) : latest.loading && !latest.data ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : (
          <>
            <div className={STORY_GRID}>
              {filteredLatest.slice(0, latestLimit).map((article) => (
                <ArticleCard
                  key={`${article.domain}/${article.id}`}
                  article={article}
                  outlet={outletByDomain.get(article.domain)}
                />
              ))}
            </div>
            {filteredLatest.length > latestLimit ? (
              <div className="py-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLatestLimit((n) => n + 30)}
                >
                  Покажи още ({filteredLatest.length - latestLimit})
                </Button>
              </div>
            ) : null}
            {filteredLatest.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                Няма статии за избраните филтри.
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
};
