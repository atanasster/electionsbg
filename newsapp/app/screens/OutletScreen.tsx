// Outlet profile — catalogue metadata, analysis distributions, the outlet's
// latest articles, and the analyzed stories it participates in.

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  analyzedArticles,
  articles as articleCount,
  outletScopeLabel,
  outletTierLabel,
  outletTypeLabel,
  formatDate,
  formatVisits,
  LEANING_META,
  LEANING_META_EN,
  relativeTime,
  RUSSIA_META,
  RUSSIA_META_EN,
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
import { Breadcrumbs } from "../components/Breadcrumbs";
import {
  FUNDING_TRANSPARENCY_COVERAGE,
  outletHomepage,
  publishableOwner,
  retirementReason,
  safeHttpUrl,
} from "../sourceTransparency";
import { useNewsLocale } from "../i18n";

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
  const { tr } = useNewsLocale();
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
            {count} {tr("от", "out of")} {total}
            {corpusRate != null
              ? tr(
                  ` · ${Math.round(corpusRate * 100)}% за всички събрани материали`,
                  ` · ${Math.round(corpusRate * 100)}% across all collected articles`,
                )
              : ""}
          </p>
        </>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">
          {total
            ? tr(
                `известно само за ${total} ${total === 1 ? "материал" : "материала"} — твърде малко`,
                `known for only ${total} ${total === 1 ? "article" : "articles"} — too few`,
              )
            : tr("няма данни", "no data")}
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

const SourceIdentity = ({ outlet }: { outlet: Outlet }) => {
  const { language, tr } = useNewsLocale();
  const owner = publishableOwner(outlet.owner);
  const ownerSource = owner ? safeHttpUrl(owner.source) : null;
  const homepage = outletHomepage(outlet.domain);
  return (
    <section aria-labelledby="source-identity-heading">
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2
              id="source-identity-heading"
              className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              {tr("Прозрачност на източника", "Source transparency")}
            </h2>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              {tr(
                "Проверими факти и изрично отбелязани липси — не оценка за доверие или фактологичност.",
                "Verifiable facts and explicitly marked gaps, not a trust or factuality score.",
              )}
            </p>
            {homepage ? (
              <a
                href={homepage}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-1 inline-block font-medium underline underline-offset-4"
              >
                {tr("Отвори", "Open")} {outlet.domain} ↗
              </a>
            ) : (
              <span className="mt-1 block text-sm text-muted-foreground">
                {tr(
                  "Адресът на сайта е невалиден",
                  "The website address is invalid",
                )}
              </span>
            )}
          </div>
          {outlet.retired ? (
            <Badge
              variant="outline"
              className="font-normal text-muted-foreground"
            >
              {tr("оттеглен източник", "retired source")}
            </Badge>
          ) : null}
        </div>

        {owner && ownerSource ? (
          <div className="mt-4 border-t pt-3 text-sm">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {tr("Собственост", "Ownership")}
            </h3>
            <p className="mt-1 font-medium">
              {tr("Вписан собственик", "Registered owner")}: {owner.name}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {tr(
                "Това е собственикът, посочен в регистъра — не твърдение за действителен контрол или редакционна независимост.",
                "This is the owner listed in the register, not a claim about actual control or editorial independence.",
              )}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              <a
                href={ownerSource}
                target="_blank"
                rel="noreferrer noopener"
                className="underline underline-offset-2"
              >
                {tr("Източник на справката", "Registry source")} ↗
              </a>
              {` · ${tr("проверено", "checked")} ${formatDate(owner.checked, language)}`}
            </p>
          </div>
        ) : (
          <div className="mt-4 border-t pt-3 text-sm">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {tr("Собственост", "Ownership")}
            </h3>
            <p className="mt-1 text-muted-foreground">
              {outlet.owner
                ? tr(
                    "Данните за собствеността са непълни и не се публикуват.",
                    "Ownership data are incomplete and are not published.",
                  )
                : tr(
                    "Собствеността още не е проверена. Това не означава, че собственикът е неизвестен.",
                    "Ownership has not yet been verified. This does not mean the owner is unknown.",
                  )}
            </p>
          </div>
        )}

        <div className="mt-4 border-t pt-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {tr("Финансиране", "Funding")}
            </h3>
            <Badge variant="outline" className="font-normal">
              {tr("Не се събира", "Not collected")}
            </Badge>
          </div>
          <p className="mt-1 text-muted-foreground">
            {tr(
              "Моделът на финансиране на изданието още не се събира или проверява в този набор.",
              "The outlet's funding model is not yet collected or verified in this dataset.",
            )}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {tr(
              "Това е липса на проверени данни, не заключение за редакционната независимост.",
              "This is a gap in verified data, not a finding about editorial independence.",
            )}{" "}
            <Link
              to={FUNDING_TRANSPARENCY_COVERAGE.methodologyPath}
              className="font-medium text-primary underline underline-offset-2"
            >
              {tr("Обхват и метод", "Coverage and method")}
            </Link>{" "}
            · {tr("описано", "documented")}{" "}
            {formatDate(FUNDING_TRANSPARENCY_COVERAGE.documentedAt, language)}
          </p>
        </div>

        {outlet.retired ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {tr("Причина за оттегляне", "Reason for retirement")}:{" "}
            {retirementReason(outlet.retired_reason, language)}
            {outlet.retired_on
              ? ` · ${tr("от", "since")} ${formatDate(outlet.retired_on, language)}`
              : tr(" · датата не е записана", " · date not recorded")}
          </p>
        ) : null}
      </Card>
    </section>
  );
};

const ConductSection = ({
  outlet,
  corpus,
}: {
  outlet: Outlet;
  corpus: { authorRate: number | null };
}) => {
  const { tr } = useNewsLocale();
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
        {tr("Поведение на редакцията", "Newsroom practices")}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {tr(
          "Измерено от самите материали, не присъдено. Никога едно число.",
          "Measured from the articles themselves, not assigned. Never reduced to one score.",
        )}
      </p>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        <Measure
          label={tr("Подписани материали", "Bylined articles")}
          count={c.with_author}
          total={c.articles}
          corpusRate={corpus.authorRate}
          minBase={CONDUCT_MIN_BASE}
        />
        <Measure
          label={tr("Редактирани след публикуване", "Edited after publication")}
          count={c.edited_after_publication}
          total={c.updated_known}
          minBase={CONDUCT_MIN_BASE}
          note={tr(
            "Броят се само материали, чиято страница обявява дата на редакция.",
            "Only articles whose page states an edit date are counted.",
          )}
        />
        <Measure
          label={tr("Препубликувано съдържание", "Republished content")}
          minBase={CONDUCT_MIN_BASE}
          unavailable={tr(
            "Не се измерва. Няма надежден признак в тези сайтове — маркерът „Източник:“ на практика придружава снимки, не препечатки.",
            "Not measured. These sites provide no reliable signal: in practice, a ‘Source’ marker accompanies images rather than republished articles.",
          )}
        />
      </div>
    </Card>
  );
};

export const OutletScreen = () => {
  const { isEnglish, language, tr } = useNewsLocale();
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
        {isEnglish
          ? "Sources could not be loaded."
          : `Източниците не се заредиха: ${outlets.error.message}`}
      </Card>
    );
  }

  if (!outlet) {
    return (
      <Card className="p-6">
        <h1 className="app-page-title">
          {tr("Източникът не е намерен", "Source not found")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          <Link
            to="/outlets"
            className="text-primary underline-offset-4 hover:underline"
          >
            {tr("Към каталога с източници", "Browse sources")}
          </Link>
        </p>
      </Card>
    );
  }

  const list = articles.data?.articles ?? [];

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: tr("Източници", "Sources"), to: "/outlets" },
          { label: outlet.outlet },
        ]}
      />

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="app-page-title">{outlet.outlet}</h1>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {outlet.rank ? (
            <Badge variant="secondary">
              #{outlet.rank} {tr("в каталога", "in directory")}
            </Badge>
          ) : null}
          {outlet.tier ? (
            <Badge variant="secondary">
              {outletTierLabel(outlet.tier, language)}
            </Badge>
          ) : null}
          {outlet.type ? (
            <Badge variant="secondary">
              {outletTypeLabel(outlet.type, language)}
            </Badge>
          ) : null}
          {outlet.scope ? (
            <Badge variant="secondary">
              {outletScopeLabel(outlet.scope, language)}
            </Badge>
          ) : null}
          {outlet.visits != null ? (
            <Badge variant="secondary">
              {formatVisits(outlet.visits, language)}{" "}
              {tr("посещ./мес", "visits/month")}
            </Badge>
          ) : null}
          <Badge variant="secondary">
            {/* One definition shared with every count surface. */}
            {articleCount(outlet.article_count, language)}{" "}
            {tr("в корпуса", "in corpus")}
          </Badge>
          <Badge variant="secondary">
            {outlet.analyzed_count === 1
              ? tr("1 анализирана", "1 analyzed")
              : tr(
                  `${outlet.analyzed_count} анализирани`,
                  `${outlet.analyzed_count} analyzed`,
                )}
          </Badge>
        </div>
      </header>

      <SourceIdentity outlet={outlet} />

      <ConductSection outlet={outlet} corpus={corpusConduct} />

      {/* ⚠️ Distributions ONLY above the sample floor. Below it the page says
          how many articles it has instead of drawing a five-segment bar that
          carries the same visual weight at n=2 as at n=100. */}
      {hasSpectrum(outlet.leaning) ? (
        <section
          className="grid gap-3 md:grid-cols-2"
          aria-label={tr("Разпределения", "Distributions")}
        >
          <Card className="p-4">
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {tr(
                "Политическо рамкиране по статии",
                "Political framing by article",
              )}
            </h2>
            <LeanSpectrum
              counts={outlet.leaning}
              emptyLabel={tr("няма анализирани статии", "no analyzed articles")}
            />
            <SpectrumLegend
              counts={outlet.leaning}
              labels={isEnglish ? LEANING_META_EN : LEANING_META}
            />
          </Card>
          <Card className="p-4">
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {tr(
                "Позиция спрямо Русия по статии",
                "Stance toward Russia by article",
              )}
            </h2>
            <StanceSpectrum
              counts={outlet.russia_stance}
              emptyLabel={tr("няма анализирани статии", "no analyzed articles")}
            />
            <SpectrumLegend
              counts={outlet.russia_stance}
              labels={isEnglish ? RUSSIA_META_EN : RUSSIA_META}
            />
          </Card>
        </section>
      ) : (
        <Card className="p-4 text-sm text-muted-foreground">
          {outlet.analyzed_count === 0
            ? tr(
                "Още няма анализирани статии от този източник — разпределенията се появяват, когато анализът го достигне.",
                "There are no analyzed articles from this source yet. Distributions will appear when analysis reaches it.",
              )
            : positionedCount(outlet.leaning) === 0
              ? tr(
                  `Анализът обхваща ${articleCount(outlet.analyzed_count, language)} и нито една няма приложима оценка по тази скала.`,
                  `The analysis covers ${articleCount(outlet.analyzed_count, language)}, and none has an applicable rating on this scale.`,
                )
              : tr(
                  `От ${analyzedArticles(outlet.analyzed_count, language)} само ${positionedCount(outlet.leaning)} ${positionedCount(outlet.leaning) === 1 ? "участва" : "участват"} в разпределението. Това е твърде малко за надеждна лента.`,
                  `Only ${positionedCount(outlet.leaning)} of ${analyzedArticles(outlet.analyzed_count, language)} are included in the distribution. This is too few for a reliable bar.`,
                )}
        </Card>
      )}

      {participating.length > 0 ? (
        <section aria-labelledby="outlet-stories">
          <h2
            id="outlet-stories"
            className="mb-2 text-sm font-semibold uppercase tracking-wide"
          >
            {tr("Истории с участие", "Participating stories")} (
            {participating.length})
          </h2>
          <Card className="divide-y p-0">
            {participating.slice(0, 10).map((s) => (
              <Link
                key={s.id}
                to={`/story/${s.id}`}
                className="flex items-baseline justify-between gap-3 px-4 py-2.5 hover:bg-secondary/50"
              >
                <span className="text-sm">
                  {(language === "bg" ? s.title_bg : s.title_en) ??
                    tr("История без заглавие", "Untitled story")}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {relativeTime(s.last_published, language)}
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
          {tr("Последни статии", "Latest articles")} ({list.length})
        </h2>
        {articles.error && !articles.data ? (
          <Card className="p-4 text-sm text-destructive">
            {isEnglish
              ? "Articles could not be loaded."
              : `Статиите не се заредиха: ${articles.error.message}`}
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
                {tr(
                  "Няма статии от този източник.",
                  "There are no articles from this source.",
                )}
              </p>
            ) : null}
          </Card>
        )}
      </section>
    </div>
  );
};
