// Теми — the topic directory, ranked by DISAGREEMENT rather than by volume.
//
// ⚠️ The whole proposition of this screen is "where do the outlets diverge",
// and volume is not that. The loudest topic in the corpus today is
// „не е по темата на сайта" at 143 articles, and every one of its verdicts is
// not_applicable — a perfectly uncontested pile. Ranking by article_count
// would put it first and call it the most interesting thing here.
//
// ⚠️ AND NOTHING CLEARS THE FLOOR YET. Measured 2026-08-26 over 365 analysed
// articles: the best topic is foreign-policy with 15 positioned articles on
// the Russia axis against a floor of 20. So this screen ships with the
// measure defined, the ranking in place, and EVERY topic reporting its
// shortfall. That is deliberate: a "most divisive topics" board computed over
// n=4 is decoration with a number attached, and the shortfall is itself the
// most useful thing we can currently say.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  TOPIC_MIN_POSITIONED,
  dominantAxis,
  useTaxonomy,
  type AxisSpread,
  type TaxonomyCategory,
} from "../data";
import {
  LEANING_META,
  LEANING_META_EN,
  RUSSIA_META,
  RUSSIA_META_EN,
  articles as articleCount,
} from "../labels";
import { LeanSpectrum, StanceSpectrum } from "../components/SpectrumBar";
import { useNewsLocale } from "../i18n";

const PAGE_SIZE = 15;

type SortKey = "label" | "primary_count" | "outlet_count" | "disagreement";
type SortDirection = "asc" | "desc";
type AxisFilter = "all" | "leaning" | "russia_stance";

/**
 * The off-topic bucket. Shown, dashed and counted — never dropped.
 *
 * ⚠️ It is 143 of 365 analysed articles. Hiding it would make every
 * percentage on this page a share of a denominator the reader cannot see, and
 * "what fraction of what we collect is not about Bulgarian public affairs" is
 * a real answer about the crawl rather than a blemish to sweep up.
 */
const OFF_TOPIC = "not-site-relevant";

/**
 * „3 статии" / „1 статия" / „21 статия" — Bulgarian number agreement.
 *
 * ⚠️ The rule is on the LAST DIGIT, not on the value: every numeral ending in
 * 1 takes the singular EXCEPT the teens (11 статии, but 21 статия, 101
 * статия). An `n === 1` test is right for exactly one number and wrong for
 * 21, 31, 41 … which are reachable here — the floor is 20.
 */
/**
 * What stands where a spread would be.
 *
 * ⚠️ A sentence naming the SHORTFALL, never a dash and never a zero. „—"
 * reads as "these outlets agree"; `0.0` reads as it even more strongly, and
 * both are claims we have not earned. The reader is told how far off we are.
 */
const Shortfall = ({
  axis,
  primaryCount,
}: {
  axis: AxisSpread;
  primaryCount: number;
}) => {
  const { language, tr } = useNewsLocale();
  return (
    <span className="text-xs text-muted-foreground">
      {/* ⚠️ THREE states, not two — the third is real and common. „Управление
        и кабинет" is tagged on 7 articles and is the MAIN subject of none, so
        „нито една статия няма приложима оценка" is the wrong fact about it: no
        article was ever asked. Only a topic somebody actually wrote about can
        be short of positions. */}
      {primaryCount === 0
        ? tr("само като второстепенна тема", "secondary topic only")
        : axis.n === 0
          ? tr(
              "нито една статия няма приложима оценка",
              "no article has an applicable rating",
            )
          : tr(
              `${articleCount(axis.n, language)} от нужните ${TOPIC_MIN_POSITIONED}`,
              `${articleCount(axis.n, language)} out of ${TOPIC_MIN_POSITIONED} needed`,
            )}
    </span>
  );
};

/**
 * The spread itself, once a topic has the sample for it.
 *
 * ⚠️ `n` IS RENDERED, not put in a `title`. A hover-only sample is invisible
 * to a touch reader, to a screen reader and to anyone who does not think to
 * hover — and the number sitting next to it in the row is `primary_count`,
 * which is a DIFFERENT and much larger denominator (foreign-policy: 32
 * articles, 15 positioned). So a bare spread does not merely omit its sample,
 * it hands the reader the wrong one.
 */
const Spread = ({ axis }: { axis: AxisSpread }) => {
  const { language, tr } = useNewsLocale();
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="tabular-nums font-medium">
        {/* `enough` implies `spread != null` — n >= 20 > 2. If that ever stops
          holding, an em dash beside "от N статии" is a visible contradiction
          rather than a blank that reads as zero. */}
        {axis.spread == null ? "—" : axis.spread.toFixed(2)}
      </span>
      <span className="text-xs text-muted-foreground">
        {tr("от", "from")} {articleCount(axis.n, language)}
      </span>
    </span>
  );
};

const pageNumbers = (page: number, total: number): number[] => {
  const start = Math.max(1, Math.min(page - 1, total - 2));
  return Array.from({ length: Math.min(3, total) }, (_, i) => start + i);
};

/** The editorial ranking used by the default disagreement sort. */
const compareDisagreement = (
  a: TaxonomyCategory,
  b: TaxonomyCategory,
  direction: SortDirection,
): number => {
  const ax = a.spread[dominantAxis(a)];
  const bx = b.spread[dominantAxis(b)];
  // A measured topic always outranks an unmeasured one. Reversing the arrow
  // changes low-to-high within the earned measurements, not whether a sample
  // of two is allowed to leap above a sample of twenty.
  if (ax.enough !== bx.enough) return ax.enough ? -1 : 1;
  if (ax.enough && bx.enough) {
    const delta = (ax.spread ?? 0) - (bx.spread ?? 0);
    return direction === "asc" ? delta : -delta;
  }
  // Below the floor there is no disagreement value to sort. Volume remains
  // the stable fallback, as stated in the notice shown above the table.
  return b.article_count - a.article_count;
};

export const TopicsScreen = () => {
  const { isEnglish, language, tr } = useNewsLocale();
  const taxonomy = useTaxonomy();
  const [query, setQuery] = useState("");
  const [axisFilter, setAxisFilter] = useState<AxisFilter>("all");
  const [sort, setSort] = useState<{
    key: SortKey;
    direction: SortDirection;
  }>({ key: "disagreement", direction: "desc" });
  const [page, setPage] = useState(1);
  const q = query.trim().toLocaleLowerCase("bg");

  const allRows = useMemo(() => {
    // ⚠️ EITHER count, not `article_count` alone. `article_count` sums the
    // taxonomy's declared subcategories; `primary_count` keys on the category
    // itself. An article whose subcategory has since been retired from
    // topics.json therefore has a verdict, a spread and an outlet — and an
    // `article_count` of 0, which silently drops the whole row.
    const list = (taxonomy.data?.categories ?? []).filter(
      (c) => c.article_count > 0 || c.primary_count > 0,
    );
    return list;
  }, [taxonomy.data]);

  const rows = useMemo(() => {
    const filtered = allRows.filter((c) => {
      if (q && !c.label[language].toLocaleLowerCase(language).includes(q))
        return false;
      return axisFilter === "all" || dominantAxis(c) === axisFilter;
    });
    return [...filtered].sort((a, b) => {
      // The off-topic bucket is always disclosed but never promoted as a
      // subject, whichever reader-selected ordering is active.
      const aOff = a.id === OFF_TOPIC;
      const bOff = b.id === OFF_TOPIC;
      if (aOff !== bOff) return aOff ? 1 : -1;
      if (sort.key === "disagreement") {
        return compareDisagreement(a, b, sort.direction);
      }
      const direction = sort.direction === "asc" ? 1 : -1;
      if (sort.key === "label") {
        return (
          direction *
          a.label[language].localeCompare(b.label[language], language)
        );
      }
      return (
        direction * (a[sort.key] - b[sort.key]) ||
        a.label[language].localeCompare(b.label[language], language)
      );
    });
  }, [allRows, axisFilter, language, q, sort]);

  const inScope = allRows.filter((c) => c.id !== OFF_TOPIC);
  const measurable = inScope.filter((c) => c.spread[dominantAxis(c)].enough);
  const primaryArticles = inScope.reduce((sum, c) => sum + c.primary_count, 0);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => setPage(1), [axisFilter, q, sort]);
  useEffect(() => setPage((p) => Math.min(p, totalPages)), [totalPages]);

  const changeSort = (key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? {
            key,
            direction: current.direction === "asc" ? "desc" : "asc",
          }
        : {
            key,
            direction: key === "label" ? "asc" : "desc",
          },
    );
  };

  const sortButton = (
    key: SortKey,
    label: string,
    align: "left" | "right" = "left",
  ) => {
    const selected = sort.key === key;
    const Icon = !selected
      ? ArrowUpDown
      : sort.direction === "asc"
        ? ArrowUp
        : ArrowDown;
    return (
      <button
        type="button"
        onClick={() => changeSort(key)}
        className={`group inline-flex w-full items-center gap-1.5 py-1 text-[11px] font-semibold uppercase tracking-[0.04em] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          align === "right" ? "justify-end" : "justify-start"
        }`}
        aria-label={`${tr("Подреди по", "Sort by")} ${label}`}
      >
        {label}
        <Icon
          className={`size-3.5 shrink-0 ${selected ? "text-foreground" : "opacity-35 group-hover:opacity-70"}`}
          aria-hidden
        />
      </button>
    );
  };

  const ariaSort = (key: SortKey) =>
    sort.key === key
      ? sort.direction === "asc"
        ? ("ascending" as const)
        : ("descending" as const)
      : ("none" as const);

  return (
    <div className="space-y-5">
      <header className="border-b pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--editorial-kicker))]">
          {tr("Карта на отразяването", "Coverage map")}
        </p>
        <div className="mt-2 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <h1 className="font-title text-4xl leading-none sm:text-5xl">
              {tr("Теми", "Topics")}
            </h1>
            <p className="mt-3 max-w-3xl text-base leading-relaxed text-muted-foreground">
              {tr(
                "Къде българските медии се разминават — по политическата ос или в отношението към Русия — и колко голяма е извадката зад сигнала.",
                "Where Bulgarian media diverge — on political framing or stance toward Russia — and how large the sample behind each signal is.",
              )}
            </p>
          </div>
          <p className="max-w-sm border-l-2 border-[hsl(var(--editorial-kicker))] pl-3 text-xs leading-relaxed text-muted-foreground">
            {tr(
              `Разсейване публикуваме при поне ${TOPIC_MIN_POSITIONED} статии с приложима оценка. Под прага показваме недостига, не подвеждаща стойност.`,
              `We publish dispersion only when at least ${TOPIC_MIN_POSITIONED} articles have an applicable rating. Below that threshold, we show the shortfall rather than a misleading value.`,
            )}
          </p>
        </div>
      </header>

      {taxonomy.data ? (
        <section
          className="grid grid-cols-3 divide-x overflow-hidden rounded-md border bg-card"
          aria-label={tr("Обобщение на темите", "Topic summary")}
        >
          <div className="p-3 sm:p-4">
            <div className="font-title text-2xl tabular-nums sm:text-3xl">
              {inScope.length}
            </div>
            <div className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground sm:text-xs">
              {tr("теми в обхвата", "topics in scope")}
            </div>
          </div>
          <div className="p-3 sm:p-4">
            <div className="font-title text-2xl tabular-nums sm:text-3xl">
              {primaryArticles.toLocaleString(
                language === "bg" ? "bg-BG" : "en-GB",
              )}
            </div>
            <div className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground sm:text-xs">
              {tr("статии в темите", "articles in topics")}
            </div>
          </div>
          <div className="p-3 sm:p-4">
            <div className="font-title text-2xl tabular-nums sm:text-3xl">
              {measurable.length}/{inScope.length}
            </div>
            <div className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground sm:text-xs">
              {tr("с достатъчна извадка", "with sufficient sample")}
            </div>
          </div>
        </section>
      ) : null}

      {/* ⚠️ The state of the measure, stated before the table rather than left
          for the reader to infer from a column of dashes. */}
      {taxonomy.data && allRows.length > 0 && measurable.length === 0 ? (
        <Card className="border-dashed bg-muted/15 p-4 text-sm text-muted-foreground">
          <strong className="font-medium text-foreground">
            {tr(
              "Нито една тема още не стига прага.",
              "No topic has reached the threshold yet.",
            )}
          </strong>{" "}
          {tr(
            `Разсейване се публикува от ${TOPIC_MIN_POSITIONED} статии с позиция нагоре. Мнозинството от анализираните материали не заемат позиция по нито една от двете оси, така че прагът се пълни бавно. Дотогава редът по-долу е по обем, а всяка тема казва колко ѝ липсва.`,
            `Dispersion is published from ${TOPIC_MIN_POSITIONED} positioned articles upward. Most analyzed articles take no position on either axis, so the threshold fills slowly. Until then, the list is ordered by volume and each topic shows its shortfall.`,
          )}
        </Card>
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-3 border-b bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tr("Търсене на тема…", "Search topics…")}
              className="bg-background pl-9"
              aria-label={tr("Търсене на тема", "Search topics")}
            />
          </div>
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <label
              htmlFor="topic-axis"
              className="text-xs font-medium text-muted-foreground"
            >
              {tr("Водеща ос", "Leading axis")}
            </label>
            <select
              id="topic-axis"
              value={axisFilter}
              onChange={(e) => setAxisFilter(e.target.value as AxisFilter)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="all">{tr("Всички", "All")}</option>
              <option value="leaning">{tr("Политическа", "Political")}</option>
              <option value="russia_stance">
                {tr("Спрямо Русия", "Toward Russia")}
              </option>
            </select>
          </div>
        </div>

        {taxonomy.error && !taxonomy.data ? (
          <div className="p-4 text-sm text-destructive">
            {isEnglish
              ? "Topics could not be loaded."
              : `Темите не се заредиха: ${taxonomy.error.message}`}
          </div>
        ) : taxonomy.loading && !taxonomy.data ? (
          <Skeleton className="m-4 h-96 rounded-xl" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/35 hover:bg-muted/35">
                    <TableHead
                      scope="col"
                      aria-sort={ariaSort("label")}
                      className="min-w-48"
                    >
                      {sortButton("label", tr("Тема", "Topic"))}
                    </TableHead>
                    <TableHead
                      scope="col"
                      aria-sort={ariaSort("primary_count")}
                      className="hidden text-right sm:table-cell"
                    >
                      {sortButton(
                        "primary_count",
                        tr("Статии", "Articles"),
                        "right",
                      )}
                    </TableHead>
                    <TableHead
                      scope="col"
                      aria-sort={ariaSort("outlet_count")}
                      className="hidden text-right lg:table-cell"
                    >
                      {sortButton(
                        "outlet_count",
                        tr("Издания", "Outlets"),
                        "right",
                      )}
                    </TableHead>
                    <TableHead
                      scope="col"
                      aria-sort={ariaSort("disagreement")}
                      className="min-w-44"
                    >
                      {sortButton(
                        "disagreement",
                        tr("Разсейване", "Dispersion"),
                      )}
                    </TableHead>
                    <TableHead
                      scope="col"
                      className="hidden min-w-48 md:table-cell"
                    >
                      {tr("Разпределение", "Distribution")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((c) => (
                    <Row key={c.id} category={c} />
                  ))}
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="py-12 text-center text-muted-foreground"
                      >
                        {allRows.length === 0
                          ? tr(
                              "Няма анализирани статии по нито една тема.",
                              "There are no analyzed articles for any topic.",
                            )
                          : tr("Няма съвпадения.", "No matches.")}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>

            {rows.length > 0 ? (
              <div className="flex flex-col gap-3 border-t bg-muted/15 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  {tr("Показани", "Showing")} {(page - 1) * PAGE_SIZE + 1}–
                  {Math.min(page * PAGE_SIZE, rows.length)} {tr("от", "of")}{" "}
                  {rows.length}
                </p>
                <nav
                  className="flex items-center gap-1"
                  aria-label={tr("Страници на темите", "Topic pages")}
                >
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    aria-label={tr("Предишна страница", "Previous page")}
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  {pageNumbers(page, totalPages).map((n) => (
                    <Button
                      key={n}
                      variant={n === page ? "default" : "ghost"}
                      size="icon"
                      className="size-8 tabular-nums"
                      onClick={() => setPage(n)}
                      aria-label={`${tr("Страница", "Page")} ${n}`}
                      aria-current={n === page ? "page" : undefined}
                    >
                      {n}
                    </Button>
                  ))}
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    aria-label={tr("Следваща страница", "Next page")}
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </nav>
              </div>
            ) : null}
          </>
        )}
      </Card>

      <div className="grid gap-2 border-t pt-4 text-xs leading-relaxed text-muted-foreground md:grid-cols-2 md:gap-6">
        <p>
          {tr(
            "Броят до разсейването е статиите с",
            "The count beside dispersion is the number of articles with an",
          )}{" "}
          <strong className="font-medium text-foreground">
            {tr("приложима оценка", "applicable rating")}
          </strong>{" "}
          {tr(
            "по съответната ос — не всички по темата. Неутралната оценка участва в разпределението в средата на скалата.",
            "on that axis, not every article on the topic. Neutral ratings are included at the midpoint of the distribution.",
          )}
        </p>
        <p>
          {tr(
            "Оста се избира за всяка тема поотделно — тази с повече заели позиция статии. Така външната политика може да се чете спрямо Русия, а бюджетът — по политическата ос.",
            "The axis is selected separately for each topic: whichever has more positioned articles. Foreign policy can therefore be read through the Russia axis, while the budget can be read through political framing.",
          )}
        </p>
      </div>
    </div>
  );
};

const Row = ({ category: c }: { category: TaxonomyCategory }) => {
  const { isEnglish, language, tr } = useNewsLocale();
  const axis = dominantAxis(c);
  const measure = c.spread[axis];
  const offTopic = c.id === OFF_TOPIC;
  const meta =
    axis === "leaning"
      ? isEnglish
        ? LEANING_META_EN
        : LEANING_META
      : isEnglish
        ? RUSSIA_META_EN
        : RUSSIA_META;
  const axisLabel =
    axis === "leaning"
      ? tr("политическа ос", "political axis")
      : tr("отношение към Русия", "stance toward Russia");

  return (
    <TableRow className={offTopic ? "opacity-70" : "group"}>
      <TableCell>
        {/* Only a topic with its own route is a link — the rest are subjects
            we classify but do not yet have a page for, and a dead link is a
            promise the site does not keep. */}
        {c.route ? (
          <Link
            to={c.route}
            className="font-semibold underline-offset-4 hover:text-[hsl(var(--editorial-kicker))] hover:underline"
          >
            {c.label[language]}
          </Link>
        ) : (
          <span className="font-semibold">{c.label[language]}</span>
        )}
        {offTopic ? (
          <span className="ml-2 rounded border border-dashed px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {tr("извън обхвата", "out of scope")}
          </span>
        ) : null}
        <div className="mt-1 text-xs tabular-nums text-muted-foreground sm:hidden">
          {c.primary_count !== c.article_count
            ? `${c.primary_count}/${c.article_count} ${tr("статии", "articles")}`
            : articleCount(c.primary_count, language)}{" "}
          · {c.outlet_count}{" "}
          {tr(
            c.outlet_count === 1 ? "издание" : "издания",
            c.outlet_count === 1 ? "outlet" : "outlets",
          )}
        </div>
      </TableCell>
      {/* Both numbers, because they answer different questions and the gap is
          exactly what explains an empty row. */}
      <TableCell className="hidden text-right tabular-nums sm:table-cell">
        <span
          title={tr(
            `${c.primary_count} с основна тема, ${c.article_count} споменавания общо`,
            `${c.primary_count} with this primary topic, ${c.article_count} mentions total`,
          )}
        >
          {c.primary_count}
          {c.primary_count !== c.article_count ? (
            <span className="text-muted-foreground">/{c.article_count}</span>
          ) : null}
        </span>
      </TableCell>
      <TableCell className="hidden text-right tabular-nums text-muted-foreground lg:table-cell">
        {c.outlet_count}
      </TableCell>
      <TableCell>
        {measure.enough ? (
          <span className="flex items-baseline gap-2">
            <Spread axis={measure} />
            <span className="text-xs text-muted-foreground">{axisLabel}</span>
          </span>
        ) : (
          <Shortfall axis={measure} primaryCount={c.primary_count} />
        )}
      </TableCell>
      <TableCell className="hidden md:table-cell">
        {/* The distribution is shown whatever the spread, because the counts
            are facts even when the summary statistic is not yet earned — but
            it is drawn on the axis the row is ranked by, so the bar and the
            number can never describe different things. */}
        {measure.n > 0 ? (
          axis === "leaning" ? (
            <LeanSpectrum counts={c.leaning} />
          ) : (
            <StanceSpectrum counts={c.russia_stance} />
          )
        ) : (
          <span className="text-xs text-muted-foreground">
            {meta.not_applicable.label.toLowerCase()}
          </span>
        )}
      </TableCell>
    </TableRow>
  );
};
