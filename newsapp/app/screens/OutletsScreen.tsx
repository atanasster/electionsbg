// Outlets — the media catalogue: a searchable, sortable directory of every
// outlet in the corpus. Traffic is the useful default ordering; catalogue
// rank remains visible as a separate, vendor-derived measure.

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
import { Badge } from "@/components/ui/badge";
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
  analyzedArticles,
  collectedArticles,
  formatVisits,
  outletScopeLabel,
  outletTypeLabel,
} from "../labels";
import { hasSpectrum, positionedCount, useOutlets, type Outlet } from "../data";
import { LeanSpectrum, StanceSpectrum } from "../components/SpectrumBar";
import { useNewsLocale, type NewsLanguage } from "../i18n";

const PAGE_SIZE = 15;

type SortKey =
  | "rank"
  | "outlet"
  | "type"
  | "scope"
  | "visits"
  | "article_count"
  | "analyzed_count";
type SortDirection = "asc" | "desc";

/** Analysed-of-collected, coloured by whether it supports a distribution. */
const Coverage = ({ outlet: o }: { outlet: Outlet }) => {
  const { language, tr } = useNewsLocale();
  if (!o.article_count) return <span className="text-muted-foreground">—</span>;
  const enough = hasSpectrum(o.leaning);
  return (
    <span
      className={enough ? "text-foreground" : "text-muted-foreground"}
      aria-label={`${analyzedArticles(o.analyzed_count, language)} ${tr("от", "out of")} ${collectedArticles(o.article_count, language)}`}
    >
      {o.analyzed_count}
      <span className="text-muted-foreground">/{o.article_count}</span>
    </span>
  );
};

/** What stands where a bar would be. A sentence, never an empty strip. */
const TooFewSpectrum = ({ outlet: o }: { outlet: Outlet }) => {
  const { language, tr } = useNewsLocale();
  const positioned = positionedCount(o.leaning);
  return (
    <span className="text-xs text-muted-foreground">
      {o.analyzed_count === 0
        ? tr("няма анализирани статии", "no analyzed articles")
        : positioned === 0
          ? tr(
              `${analyzedArticles(o.analyzed_count, language)}, нито една няма приложима оценка`,
              `${analyzedArticles(o.analyzed_count, language)}; none has an applicable rating`,
            )
          : positioned === 1
            ? tr(
                `от ${analyzedArticles(o.analyzed_count, language)} само 1 участва в разпределението`,
                `only 1 of ${analyzedArticles(o.analyzed_count, language)} is included in the distribution`,
              )
            : tr(
                `от ${analyzedArticles(o.analyzed_count, language)} само ${positioned} участват в разпределението`,
                `only ${positioned} of ${analyzedArticles(o.analyzed_count, language)} are included in the distribution`,
              )}
    </span>
  );
};

const compareNullable = (
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  direction: SortDirection,
): number => {
  // Missing measurements stay last in both directions. A dash must never rise
  // above an actual value merely because the reader reversed the ordering.
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const result =
    typeof a === "string" && typeof b === "string"
      ? a.localeCompare(b, "bg")
      : Number(a) - Number(b);
  return direction === "asc" ? result : -result;
};

const pageNumbers = (page: number, total: number): number[] => {
  const start = Math.max(1, Math.min(page - 1, total - 2));
  return Array.from({ length: Math.min(3, total) }, (_, i) => start + i);
};

const sortValue = (
  outlet: Outlet,
  key: SortKey,
  language: NewsLanguage,
): string | number | null => {
  if (key === "type") return outletTypeLabel(outlet.type, language) ?? null;
  if (key === "scope") return outletScopeLabel(outlet.scope, language) ?? null;
  return outlet[key];
};

export const OutletsScreen = () => {
  const { isEnglish, language, tr } = useNewsLocale();
  const outlets = useOutlets();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"active" | "all" | "retired">("all");
  const [sort, setSort] = useState<{
    key: SortKey;
    direction: SortDirection;
  }>({ key: "visits", direction: "desc" });
  const [page, setPage] = useState(1);

  const all = useMemo(() => outlets.data?.outlets ?? [], [outlets.data]);
  const q = query.trim().toLocaleLowerCase("bg");

  const rows = useMemo(() => {
    const list = all.filter((o) => {
      if (status === "active" && o.retired) return false;
      if (status === "retired" && !o.retired) return false;
      return (
        !q || `${o.outlet} ${o.domain}`.toLocaleLowerCase("bg").includes(q)
      );
    });
    return [...list].sort((a, b) => {
      // When active and retired sources are deliberately mixed, the retired
      // archive still forms a quiet final section rather than masquerading as
      // current merely because its name or old rank sorts high.
      if (status === "all" && a.retired !== b.retired)
        return a.retired ? 1 : -1;
      const result = compareNullable(
        sortValue(a, sort.key, language),
        sortValue(b, sort.key, language),
        sort.direction,
      );
      return result || compareNullable(a.rank, b.rank, "asc");
    });
  }, [all, language, q, sort, status]);

  const active = all.filter((o) => !o.retired);
  const measured = active.filter((o) => o.visits != null).length;
  const collected = active.reduce((sum, o) => sum + o.article_count, 0);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => setPage(1), [q, status, sort]);
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
            direction:
              key === "outlet" || key === "type" || key === "scope"
                ? "asc"
                : "desc",
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
      <header className="news-directory-head border-b pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--editorial-kicker))]">
          {tr("Медиен каталог", "Media directory")}
        </p>
        <div className="mt-2 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <h1 className="font-title text-4xl leading-none sm:text-5xl">
              {tr("Източници", "Sources")}
            </h1>
            <p className="mt-3 max-w-3xl text-base leading-relaxed text-muted-foreground">
              {tr(
                "Българските медии в корпуса — размер на аудиторията, натрупани статии и как изглеждат оценките във вече анализираната извадка.",
                "Bulgarian media in the corpus — audience size, collected articles, and the shape of ratings in the analyzed sample.",
              )}
            </p>
          </div>
          <p className="max-w-sm border-l-2 border-[hsl(var(--editorial-kicker))] pl-3 text-xs leading-relaxed text-muted-foreground">
            {tr(
              "Посещенията са оценки на Similarweb за последния наличен месец, а не измерване на качество, доверие или влияние.",
              "Visits are Similarweb estimates for the latest available month, not a measure of quality, trust, or influence.",
            )}
          </p>
        </div>
      </header>

      {outlets.data ? (
        <section
          className="grid grid-cols-3 divide-x overflow-hidden rounded-md border bg-card"
          aria-label={tr("Обобщение на каталога", "Directory summary")}
        >
          <div className="p-3 sm:p-4">
            <div className="font-title text-2xl tabular-nums sm:text-3xl">
              {active.length}
            </div>
            <div className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground sm:text-xs">
              {tr("активни медии", "active outlets")}
            </div>
          </div>
          <div className="p-3 sm:p-4">
            <div className="font-title text-2xl tabular-nums sm:text-3xl">
              {collected.toLocaleString(language === "bg" ? "bg-BG" : "en-GB")}
            </div>
            <div className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground sm:text-xs">
              {tr("статии в корпуса", "articles in corpus")}
            </div>
          </div>
          <div className="p-3 sm:p-4">
            <div className="font-title text-2xl tabular-nums sm:text-3xl">
              {measured}/{active.length}
            </div>
            <div className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground sm:text-xs">
              {tr("с данни за трафик", "with traffic data")}
            </div>
          </div>
        </section>
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-3 border-b bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tr("Медия или домейн…", "Outlet or domain…")}
              className="bg-background pl-9"
              aria-label={tr("Търсене на медия", "Search outlets")}
            />
          </div>
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <label
              htmlFor="outlet-status"
              className="text-xs font-medium text-muted-foreground"
            >
              {tr("Статус", "Status")}
            </label>
            <select
              id="outlet-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="all">{tr("Всички", "All")}</option>
              <option value="active">{tr("Активни", "Active")}</option>
              <option value="retired">{tr("Оттеглени", "Retired")}</option>
            </select>
          </div>
        </div>

        {outlets.error && !outlets.data ? (
          <div className="p-4 text-sm text-destructive">
            {isEnglish
              ? "Sources could not be loaded."
              : `Източниците не се заредиха: ${outlets.error.message}`}
          </div>
        ) : outlets.loading && !outlets.data ? (
          <Skeleton className="m-4 h-96 rounded-xl" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table className="news-outlets-table">
                <TableHeader>
                  <TableRow className="bg-muted/35 hover:bg-muted/35">
                    <TableHead
                      scope="col"
                      aria-sort={ariaSort("rank")}
                      className="hidden w-16 sm:table-cell"
                    >
                      {sortButton("rank", "№")}
                    </TableHead>
                    <TableHead
                      scope="col"
                      aria-sort={ariaSort("outlet")}
                      className="min-w-56"
                    >
                      {sortButton("outlet", tr("Източник", "Source"))}
                    </TableHead>
                    <TableHead
                      scope="col"
                      aria-sort={ariaSort("type")}
                      className="hidden lg:table-cell"
                    >
                      {sortButton("type", tr("Тип", "Type"))}
                    </TableHead>
                    <TableHead
                      scope="col"
                      aria-sort={ariaSort("scope")}
                      className="hidden xl:table-cell"
                    >
                      {sortButton("scope", tr("Обхват", "Scope"))}
                    </TableHead>
                    <TableHead
                      scope="col"
                      aria-sort={ariaSort("visits")}
                      className="min-w-36 text-right"
                    >
                      {sortButton(
                        "visits",
                        tr("Посещения/мес", "Visits/month"),
                        "right",
                      )}
                    </TableHead>
                    <TableHead
                      scope="col"
                      aria-sort={ariaSort("article_count")}
                      className="hidden text-right md:table-cell"
                    >
                      {sortButton(
                        "article_count",
                        tr("Статии", "Articles"),
                        "right",
                      )}
                    </TableHead>
                    <TableHead
                      scope="col"
                      aria-sort={ariaSort("analyzed_count")}
                      className="hidden text-right lg:table-cell"
                    >
                      {sortButton(
                        "analyzed_count",
                        tr("Анализ", "Analysis"),
                        "right",
                      )}
                    </TableHead>
                    <TableHead
                      scope="col"
                      className="hidden min-w-52 md:table-cell"
                    >
                      {tr("Рамкиране на статиите", "Article framing")}
                    </TableHead>
                    <TableHead
                      scope="col"
                      className="hidden min-w-48 xl:table-cell"
                    >
                      {tr(
                        "Позиция на статиите спрямо Русия",
                        "Article stance toward Russia",
                      )}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((o) => (
                    <TableRow
                      key={o.domain}
                      className={o.retired ? "opacity-60" : "group"}
                    >
                      <TableCell className="hidden text-muted-foreground tabular-nums sm:table-cell">
                        {o.rank ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Link
                          to={`/outlet/${o.domain}`}
                          className="font-semibold leading-tight underline-offset-4 hover:text-[hsl(var(--editorial-kicker))] hover:underline"
                        >
                          {o.outlet}
                        </Link>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">
                            {o.domain}
                          </span>
                          {o.retired ? (
                            <Badge
                              variant="outline"
                              className="font-normal text-muted-foreground"
                              title={o.retired_reason ?? undefined}
                            >
                              {tr("оттеглен", "retired")}
                            </Badge>
                          ) : null}
                          {o.ai_generated.likely_ai ? (
                            <Badge
                              variant="outline"
                              className="border-destructive/40 text-destructive"
                            >
                              {o.ai_generated.likely_ai} {tr("ИИ?", "AI?")}
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">
                        {outletTypeLabel(o.type, language) ?? "—"}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground xl:table-cell">
                        {outletScopeLabel(o.scope, language) ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {o.visits == null ? (
                          <span className="text-xs font-normal text-muted-foreground">
                            {tr("няма данни", "no data")}
                          </span>
                        ) : (
                          formatVisits(o.visits, language)
                        )}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">
                        {o.article_count}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums lg:table-cell">
                        <Coverage outlet={o} />
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {hasSpectrum(o.leaning) ? (
                          <LeanSpectrum counts={o.leaning} />
                        ) : (
                          <TooFewSpectrum outlet={o} />
                        )}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        {hasSpectrum(o.russia_stance) ? (
                          <StanceSpectrum counts={o.russia_stance} />
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={9}
                        className="py-12 text-center text-muted-foreground"
                      >
                        {tr("Няма съвпадения.", "No matches.")}
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
                  aria-label={tr("Страници на източниците", "Source pages")}
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
    </div>
  );
};
