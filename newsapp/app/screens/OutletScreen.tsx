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
  useGlobalStoryQuery,
  useOutletArticles,
  useStoryList,
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
import { listState } from "../storyQuery";
import {
  FUNDING_TRANSPARENCY_COVERAGE,
  outletHomepage,
  publishableOwner,
  retirementReason,
  safeCompanyEik,
  safeHttpUrl,
} from "../sourceTransparency";
import { useNewsLocale } from "../i18n";
import { mainSiteUrl } from "../site";

const PAGE_SIZE = 20;
/** How many participating stories the outlet page previews before linking on. */
const STORY_PREVIEW = 10;

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
  const { language, isEnglish, tr } = useNewsLocale();
  const owner = publishableOwner(outlet.owner);
  const ownerSource = owner ? safeHttpUrl(owner.source) : null;
  const ownerEik = owner ? safeCompanyEik(owner.eik) : null;
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
              {tr("Вписан собственик", "Registered owner")}:{" "}
              {ownerEik ? (
                <a
                  href={mainSiteUrl(
                    `https://naiasno.bg/company/${ownerEik}`,
                    isEnglish,
                  )}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline underline-offset-2"
                >
                  {owner.name}
                </a>
              ) : (
                owner.name
              )}
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
  const stories = useStoryList();
  const [limit, setLimit] = useState(PAGE_SIZE);
  // ⚠️ PINNED ONCE PER OUTLET, never read from the clock per render. This
  // query has no window today, so the anchor changes nothing — but it is the
  // input a window would use, and a live clock makes the count flicker under
  // a reader who is not doing anything.
  const [countedAt, setCountedAt] = useState(() => Date.now());
  // How many of this outlet's stories the preview shows. It grows with the
  // reveal button rather than staying at STORY_PREVIEW — see that button.
  const [storyPreview, setStoryPreview] = useState(STORY_PREVIEW);

  // Router reuses this element across /outlet/:domain — start each outlet fresh.
  useEffect(() => {
    setLimit(PAGE_SIZE);
    setCountedAt(Date.now());
    setStoryPreview(STORY_PREVIEW);
  }, [domain]);

  /**
   * ⚠️⚠️ THE COUNT COMES FROM THE WHOLE CORPUS, NOT FROM THE PREFIX. The
   * heading printed `participating.length` — the number of THIS OUTLET's
   * stories inside the ~200-row page the index had revealed — under the
   * label „Истории с участие (N)". For every outlet with more than a page's
   * worth, that number was an artifact of how far the reader had scrolled,
   * and it rose as they pressed „покажи още": the same outlet answered the
   * same question differently on every visit.
   */
  const corpus = useGlobalStoryQuery({
    domain: domain ?? "all",
    now: countedAt,
  });
  const participatingTotal = corpus.ready ? corpus.result.ids.length : null;

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

  // ⚠️ Filtered from the INDEX, which carries each story's outlet list for
  // exactly this — the screen used to download all 1,919 stories (1,456 KB)
  // to keep the handful this outlet appears in. The index arrives a page of
  // 200 at a time (~50 KB), so the list grows as the reader reveals more;
  // `hasMore` below says whether there is more to find.
  const participating = useMemo(() => {
    if (!domain) return [];
    return stories.stories
      .filter((s) => s.domains.includes(domain))
      .sort((a, b) =>
        (b.last_published ?? "").localeCompare(a.last_published ?? ""),
      );
  }, [stories.stories, domain]);

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

      {(() => {
        const shown = participating.slice(0, storyPreview);
        const state = listState({
          revealed: participating.length,
          total: participatingTotal ?? 0,
          hasMore: stories.hasMore,
          ready: corpus.ready,
          error: corpus.error,
        });
        /**
         * ⚠️ „NOTHING TO SHOW" IS THE ONE STATE THAT RENDERS NO SECTION, AND
         * ONLY WHEN THERE IS GENUINELY NOTHING IN HAND. `listState` answers
         * „empty" on the corpus count alone, so if the index and the revealed
         * prefix ever disagree — a stale overlay generation, a domain spelled
         * differently in the two files — dropping the section would discard
         * rows the page is holding on the strength of a count.
         */
        if (state === "empty" && participating.length === 0) return null;
        // ⚠️ Likewise the skeleton: it stands in for rows we do not have, not
        // for a count we are still waiting on. `useStoryList` often resolves
        // first, and a hung index request never rejects — so covering those
        // rows would hide them for the life of the page.
        if (state === "loading" && participating.length === 0)
          return (
            <section aria-labelledby="outlet-stories">
              <h2
                id="outlet-stories"
                className="mb-2 text-sm font-semibold uppercase tracking-wide"
              >
                {tr("Истории с участие", "Participating stories")}
              </h2>
              <Skeleton className="h-32 rounded-xl" />
            </section>
          );
        /**
         * ⚠️ THE BUTTON MUST MOVE SOMETHING. The preview was hard-capped at
         * ten, so once ten of this outlet's stories were in the revealed
         * prefix „Покажи още истории" fetched another index page and changed
         * nothing on screen — beside an exact „Показани са 10 от 40" that
         * reads as broken rather than merely unhelpful. It now raises the
         * preview first and only fetches when the prefix is exhausted.
         */
        const moreInHand = participating.length > shown.length;
        const canReveal = moreInHand || stories.hasMore;
        return (
          <section aria-labelledby="outlet-stories">
            <h2
              id="outlet-stories"
              className="mb-2 text-sm font-semibold uppercase tracking-wide"
            >
              {tr("Истории с участие", "Participating stories")}
              {participatingTotal === null ? null : ` (${participatingTotal})`}
            </h2>
            <Card id="outlet-stories-list" className="divide-y p-0">
              {shown.map((s) => (
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
              <div className="px-4 py-3">
                {/* ⚠️ THE CAPTION NAMES BOTH NUMBERS. „Показани са
                    най-новите; може да има още" was the same sentence
                    whether one story was hidden or four hundred were, and
                    it was printed under complete lists too. */}
                {state === "failed" ? (
                  <p className="text-xs text-destructive">
                    {tr(
                      "Не можахме да преброим всички истории на този източник — показаното е само каквото вече е заредено.",
                      "We could not count every story from this source — what you see is only what has loaded.",
                    )}
                  </p>
                ) : state === "loading" ? (
                  <p className="text-xs text-muted-foreground">
                    {tr(
                      `Показани са ${shown.length}; броим целия корпус…`,
                      `Showing ${shown.length}; counting the whole corpus…`,
                    )}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {tr(
                      `Показани са ${shown.length} от ${participatingTotal ?? shown.length}`,
                      `Showing ${shown.length} of ${participatingTotal ?? shown.length}`,
                    )}
                    {state === "complete" &&
                    shown.length === participating.length
                      ? ` — ${tr("това са всички", "that is all of them")}`
                      : ""}
                  </p>
                )}
                {canReveal ? (
                  <button
                    type="button"
                    onClick={() => {
                      setStoryPreview((n) => n + STORY_PREVIEW);
                      if (!moreInHand) stories.loadMore();
                    }}
                    disabled={stories.loading && !moreInHand}
                    aria-controls="outlet-stories-list"
                    className="mt-1 min-h-11 text-sm font-medium text-primary hover:underline disabled:opacity-50"
                  >
                    {stories.loading && !moreInHand
                      ? tr("Зареждане…", "Loading…")
                      : tr("Покажи още истории", "Show more stories")}
                  </button>
                ) : null}
              </div>
            </Card>
          </section>
        );
      })()}

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
