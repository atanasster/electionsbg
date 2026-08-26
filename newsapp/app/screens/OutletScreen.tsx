// Outlet profile — catalogue metadata, analysis distributions, the outlet's
// latest articles, and the analyzed stories it participates in.

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  bgArticles,
  formatVisits,
  LEANING_META,
  relativeTime,
  RUSSIA_META,
} from "../labels";
import {
  hasSpectrum,
  positionedCount,
  useOutlets,
  useOutletArticles,
  useStories,
  type Outlet,
} from "../data";
import {
  LeanSpectrum,
  SpectrumLegend,
  StanceSpectrum,
} from "../components/SpectrumBar";
import { ArticleRecordRow } from "../components/ArticleRow";
import { LoadMore } from "../components/LoadMore";

const PAGE_SIZE = 20;

/**
 * A conduct measure: a count, its denominator, and the corpus mean beside it.
 *
 * ⚠️ NEVER a single trust score. Three separate measures with their bases
 * shown is a description; one number would be a verdict we cannot defend.
 *
 * ⚠️ And never a bare rate. `updated_known` covers 2.7% of the corpus, so an
 * "edit rate" over `articles` would be a near-zero number that reads as a
 * finding about the newsroom rather than about our own coverage.
 */
const Measure = ({
  label,
  count,
  total,
  corpusRate,
  minBase,
  unavailable,
  note,
}: {
  label: string;
  count?: number;
  total?: number;
  corpusRate?: number | null;
  minBase: number;
  unavailable?: string;
  note?: string;
}) => {
  const enough = !unavailable && (total ?? 0) >= minBase;
  const rate = enough ? (count! / total!) * 100 : null;
  return (
    <div>
      <div className="text-sm font-medium">{label}</div>
      {unavailable ? (
        <p className="mt-1 text-xs text-muted-foreground">{unavailable}</p>
      ) : enough ? (
        <>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary"
                style={{ width: `${Math.min(100, rate!)}%` }}
              />
            </div>
            <span className="text-sm tabular-nums">{Math.round(rate!)}%</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {count} от {total}
            {corpusRate != null
              ? ` · ${Math.round(corpusRate * 100)}% за всички събрани материали`
              : ""}
          </p>
        </>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">
          {total
            ? `известно само за ${total} ${total === 1 ? "материал" : "материала"} — твърде малко`
            : "няма данни"}
        </p>
      )}
      {note ? (
        <p className="mt-1 text-xs text-muted-foreground">{note}</p>
      ) : null}
    </div>
  );
};

/** The smallest base a conduct rate may be computed over. */
const CONDUCT_MIN_BASE = 20;

const ConductSection = ({
  outlet,
  corpus,
}: {
  outlet: Outlet;
  corpus: { authorRate: number | null };
}) => {
  // ⚠️ Optional-chained. A bundle built before `conduct` existed is on disk
  // right now (dist-news carries whatever the last build produced), and
  // newsapp has NO error boundary — so a bare `outlet.conduct.articles`
  // white-screens the whole page. The same file already guards with `?.`
  // fifty lines away.
  const c = outlet.conduct ?? {
    articles: 0,
    with_author: 0,
    updated_known: 0,
    edited_after_publication: 0,
  };
  return (
    <Card className="p-4">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Поведение на редакцията
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Измерено от самите материали, не присъдено. Никога едно число.
      </p>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        <Measure
          label="Подписани материали"
          count={c.with_author}
          total={c.articles}
          corpusRate={corpus.authorRate}
          minBase={CONDUCT_MIN_BASE}
        />
        <Measure
          label="Редактирани след публикуване"
          count={c.edited_after_publication}
          total={c.updated_known}
          minBase={CONDUCT_MIN_BASE}
          note="Броят се само материали, чиято страница обявява дата на редакция."
        />
        <Measure
          label="Препубликувано съдържание"
          minBase={CONDUCT_MIN_BASE}
          unavailable="Не се измерва. Няма надежден признак в тези сайтове — маркерът „Източник:“ на практика придружава снимки, не препечатки."
        />
      </div>
    </Card>
  );
};

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

  // ⚠️ The corpus mean, derived from the same counts the outlet's own meter
  // uses. A "% of articles signed" with nothing to compare it against is a
  // number the reader cannot place — 78% is good or bad only relative to
  // what these newsrooms actually do.
  const corpusConduct = useMemo(() => {
    let signed = 0;
    let total = 0;
    for (const o of outlets.data?.outlets ?? []) {
      signed += o.conduct?.with_author ?? 0;
      total += o.conduct?.articles ?? 0;
    }
    return { authorRate: total ? signed / total : null };
  }, [outlets.data]);

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
            {/* One definition, shared with /topics — this was a private copy
                carrying the same n===1 gap (21 статии, not 21 статия). */}
            {bgArticles(outlet.article_count)} в корпуса
          </Badge>
          <Badge variant="secondary">
            {outlet.analyzed_count === 1
              ? "1 анализирана"
              : `${outlet.analyzed_count} анализирани`}
          </Badge>
        </div>
      </header>

      <ConductSection outlet={outlet} corpus={corpusConduct} />

      {/* ⚠️ Distributions ONLY above the sample floor. Below it the page says
          how many articles it has instead of drawing a five-segment bar that
          carries the same visual weight at n=2 as at n=100. */}
      {hasSpectrum(outlet.leaning) ? (
        <section
          className="grid gap-3 md:grid-cols-2"
          aria-label="Разпределения"
        >
          <Card className="p-4">
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Пристрастие по статии
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
          {outlet.analyzed_count === 0
            ? "Още няма анализирани статии от този източник — разпределенията се появяват, когато анализът го достигне."
            : positionedCount(outlet.leaning) === 0
              ? `Анализирани са ${outlet.analyzed_count} статии и нито една не заема позиция по политическата ос. Това не е липса на данни — повечето материали просто не са политически.`
              : `От ${outlet.analyzed_count} анализирани статии само ${positionedCount(outlet.leaning)} заемат позиция. Това е твърде малко за разпределение: лента, начертана върху толкова материал, изглежда точно като лента върху сто.`}
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
