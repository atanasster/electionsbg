// Outlet profile — catalogue metadata, analysis distributions, the outlet's
// latest articles, and the analyzed stories it participates in.

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatVisits,
  LEANING_META,
  relativeTime,
  RUSSIA_META,
} from "../labels";
import { useOutlets, useOutletArticles, useStories } from "../data";
import {
  LeanSpectrum,
  SpectrumLegend,
  StanceSpectrum,
} from "../components/SpectrumBar";
import { ArticleRecordRow } from "../components/ArticleRow";
import { LoadMore } from "../components/LoadMore";

const PAGE_SIZE = 20;

export const OutletScreen = () => {
  const { domain } = useParams<{ domain: string }>();
  const outlets = useOutlets();
  const articles = useOutletArticles(domain ?? null);
  const stories = useStories();
  const [limit, setLimit] = useState(PAGE_SIZE);

  // Router reuses this element across /outlet/:domain — start each outlet fresh.
  useEffect(() => setLimit(PAGE_SIZE), [domain]);

  const outlet = useMemo(
    () =>
      (outlets.data?.outlets ?? []).find((o) => o.domain === domain) ?? null,
    [outlets.data, domain],
  );

  const participating = useMemo(() => {
    if (!domain) return [];
    return (stories.data?.stories ?? [])
      .filter((s) => s.members.some((m) => m.domain === domain))
      .sort((a, b) =>
        (b.last_published ?? "").localeCompare(a.last_published ?? ""),
      );
  }, [stories.data, domain]);

  if (outlets.loading && !outlets.data) {
    return <Skeleton className="h-96 rounded-xl" />;
  }

  if (outlets.error && !outlets.data) {
    return (
      <Card className="p-6 text-sm text-destructive">
        Източниците не се заредиха: {outlets.error.message}
      </Card>
    );
  }

  if (!outlet) {
    return (
      <Card className="p-6">
        <h1 className="font-title text-2xl">Източникът не е намерен</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          <Link
            to="/outlets"
            className="text-primary underline-offset-4 hover:underline"
          >
            Към каталога с източници
          </Link>
        </p>
      </Card>
    );
  }

  const list = articles.data?.articles ?? [];

  return (
    <div className="space-y-6">
      <nav className="text-sm text-muted-foreground" aria-label="Път">
        <Link to="/outlets" className="hover:text-primary">
          Източници
        </Link>
        <span className="px-1.5">/</span>
        <span className="text-foreground">{outlet.outlet}</span>
      </nav>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-title text-3xl">{outlet.outlet}</h1>
          <a
            href={`https://${outlet.domain}`}
            target="_blank"
            rel="noreferrer noopener"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
          >
            {outlet.domain} ↗
          </a>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {outlet.rank ? (
            <Badge variant="secondary">#{outlet.rank} в каталога</Badge>
          ) : null}
          {outlet.tier ? (
            <Badge variant="secondary">{outlet.tier}</Badge>
          ) : null}
          {outlet.type ? (
            <Badge variant="secondary">{outlet.type}</Badge>
          ) : null}
          {outlet.scope ? (
            <Badge variant="secondary">{outlet.scope}</Badge>
          ) : null}
          {outlet.visits != null ? (
            <Badge variant="secondary">
              {formatVisits(outlet.visits)} посещ./мес
            </Badge>
          ) : null}
          <Badge variant="secondary">
            {outlet.article_count} статии в корпуса
          </Badge>
          <Badge variant="secondary">{outlet.analyzed_count} анализирани</Badge>
        </div>
      </header>

      {/* Distributions over the outlet's analyzed articles. */}
      {outlet.analyzed_count > 0 ? (
        <section
          className="grid gap-3 md:grid-cols-2"
          aria-label="Разпределения"
        >
          <Card className="p-4">
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Причастие по статии
            </h2>
            <LeanSpectrum
              counts={outlet.leaning}
              emptyLabel="няма анализирани статии"
            />
            <SpectrumLegend counts={outlet.leaning} labels={LEANING_META} />
          </Card>
          <Card className="p-4">
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Позиция спрямо Русия по статии
            </h2>
            <StanceSpectrum
              counts={outlet.russia_stance}
              emptyLabel="няма анализирани статии"
            />
            <SpectrumLegend
              counts={outlet.russia_stance}
              labels={RUSSIA_META}
            />
          </Card>
        </section>
      ) : (
        <Card className="p-4 text-sm text-muted-foreground">
          Още няма анализирани статии от този източник — разпределенията се
          появяват, когато анализът го достигне.
        </Card>
      )}

      {participating.length > 0 ? (
        <section aria-labelledby="outlet-stories">
          <h2
            id="outlet-stories"
            className="mb-2 text-sm font-semibold uppercase tracking-wide"
          >
            Истории с участие ({participating.length})
          </h2>
          <Card className="divide-y p-0">
            {participating.slice(0, 10).map((s) => (
              <Link
                key={s.id}
                to={`/story/${s.id}`}
                className="flex items-baseline justify-between gap-3 px-4 py-2.5 hover:bg-secondary/50"
              >
                <span className="text-sm">
                  {s.title_bg ?? s.title_en ?? s.id}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {relativeTime(s.last_published)}
                </span>
              </Link>
            ))}
          </Card>
        </section>
      ) : null}

      <section aria-labelledby="outlet-articles">
        <h2
          id="outlet-articles"
          className="mb-2 text-sm font-semibold uppercase tracking-wide"
        >
          Последни статии ({list.length})
        </h2>
        {articles.error && !articles.data ? (
          <Card className="p-4 text-sm text-destructive">
            Статиите не се заредиха: {articles.error.message}
          </Card>
        ) : articles.loading && !articles.data ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : (
          <Card className="px-4 py-1">
            {list.slice(0, limit).map((a) => (
              <ArticleRecordRow key={a.id} article={a} />
            ))}
            {list.length > limit ? (
              <LoadMore
                remaining={list.length - limit}
                onMore={() => setLimit((n) => n + PAGE_SIZE)}
              />
            ) : null}
            {list.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                Няма статии от този източник.
              </p>
            ) : null}
          </Card>
        )}
      </section>
    </div>
  );
};
