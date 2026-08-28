// Outlets — the media catalogue: ranked table of every outlet in the CSV (plus
// any data-only domains) with corpus/analysis counts and the leaning, russia
// and AI distributions computed at build time.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
  bgAnalyzedArticles,
  bgCollectedArticles,
  formatVisits,
  outletScopeLabel,
  outletTypeLabel,
} from "../labels";
import { hasSpectrum, positionedCount, useOutlets, type Outlet } from "../data";
import { LeanSpectrum, StanceSpectrum } from "../components/SpectrumBar";
import { LoadMore } from "../components/LoadMore";

const PAGE_SIZE = 20;

/** Analysed-of-collected, coloured by whether it supports a distribution. */
const Coverage = ({ outlet: o }: { outlet: Outlet }) => {
  if (!o.article_count) return <span className="text-muted-foreground">—</span>;
  const enough = hasSpectrum(o.leaning);
  return (
    <span
      className={enough ? "text-foreground" : "text-muted-foreground"}
      aria-label={`${bgAnalyzedArticles(o.analyzed_count)} от ${bgCollectedArticles(o.article_count)}`}
    >
      {o.analyzed_count}
      <span className="text-muted-foreground">/{o.article_count}</span>
    </span>
  );
};

/** What stands where a bar would be. A sentence, never an empty strip. */
const TooFewSpectrum = ({ outlet: o }: { outlet: Outlet }) => {
  // ⚠️ THREE states, not two. "Nothing read", "read but nothing is
  // applicable to the scale" and "too few are applicable" are different facts about an
  // outlet, and the middle one is the commonest: not_applicable is the
  // majority verdict, so an outlet with 100 analysed articles can have 0
  // positioned. Collapsing them said "няма анализирани статии" about
  // 24chasa.bg, which has a hundred.
  const positioned = positionedCount(o.leaning);
  return (
    <span className="text-xs text-muted-foreground">
      {o.analyzed_count === 0
        ? "няма анализирани статии"
        : positioned === 0
          ? `${bgAnalyzedArticles(o.analyzed_count)}, нито една няма приложима оценка`
          : positioned === 1
            ? `от ${bgAnalyzedArticles(o.analyzed_count)} само 1 участва в разпределението`
            : `от ${bgAnalyzedArticles(o.analyzed_count)} само ${positioned} участват в разпределението`}
    </span>
  );
};

export const OutletsScreen = () => {
  const outlets = useOutlets();
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const q = query.trim().toLowerCase();

  const sorted = useMemo(() => {
    const list = [...(outlets.data?.outlets ?? [])];
    list.sort((a, b) => {
      // ⚠️ Retired outlets sort LAST, whatever their rank. They are kept —
      // their articles were collected in good faith and still count in
      // stories — but a retired outlet interleaved with live ones by
      // catalogue rank reads as a live source. Two of them asked not to be
      // crawled at all.
      if (a.retired !== b.retired) return a.retired ? 1 : -1;
      // Catalogue rank first (nulls last), then by corpus size.
      if (a.rank == null && b.rank == null)
        return b.article_count - a.article_count;
      if (a.rank == null) return 1;
      if (b.rank == null) return -1;
      return a.rank - b.rank;
    });
    return list;
  }, [outlets.data]);

  const filtered = useMemo(
    () =>
      sorted.filter(
        (o) => !q || `${o.outlet} ${o.domain}`.toLowerCase().includes(q),
      ),
    [sorted, q],
  );

  // A fresh query starts from a fresh page — an expanded limit leaking into a
  // new search defeats the incremental reveal.
  useEffect(() => setLimit(PAGE_SIZE), [q]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-title text-3xl">Източници</h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">
          Каталог на българските медии в корпуса — тип, обхват, посещаемост и
          разпределения на политическото рамкиране, позицията спрямо Русия и
          ИИ-сигналите в анализираните статии.
        </p>
      </header>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Търсене на медия…"
          className="pl-8"
          aria-label="Търсене на медия"
        />
      </div>

      {outlets.error && !outlets.data ? (
        <Card className="p-4 text-sm text-destructive">
          Източниците не се заредиха: {outlets.error.message}
        </Card>
      ) : outlets.loading && !outlets.data ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : (
        <Card className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="w-10">
                  #
                </TableHead>
                <TableHead>Източник</TableHead>
                <TableHead scope="col" className="hidden md:table-cell">
                  Тип
                </TableHead>
                <TableHead scope="col" className="hidden lg:table-cell">
                  Обхват
                </TableHead>
                <TableHead
                  scope="col"
                  className="hidden lg:table-cell text-right"
                >
                  Посещения/мес
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Статии
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Анализ
                </TableHead>
                <TableHead scope="col" className="min-w-40">
                  Рамкиране на статиите
                </TableHead>
                <TableHead
                  scope="col"
                  className="min-w-40 hidden md:table-cell"
                >
                  Позиция на статиите спрямо Русия
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, limit).map((o) => (
                <TableRow
                  key={o.domain}
                  className={o.retired ? "opacity-60" : undefined}
                >
                  <TableCell className="text-muted-foreground tabular-nums">
                    {o.rank ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Link
                      to={`/outlet/${o.domain}`}
                      className="font-medium hover:text-primary"
                    >
                      {o.outlet}
                    </Link>
                    {/* Named, not merely dimmed: "why is this outlet greyed"
                        must be answerable from the row itself. */}
                    {o.retired ? (
                      <Badge
                        variant="outline"
                        className="ml-1.5 font-normal text-muted-foreground"
                        title={o.retired_reason ?? undefined}
                      >
                        оттеглен
                      </Badge>
                    ) : null}
                    {o.ai_generated.likely_ai ? (
                      <Badge
                        variant="outline"
                        className="ml-2 text-destructive border-destructive/40"
                      >
                        {o.ai_generated.likely_ai} ИИ?
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">
                    {outletTypeLabel(o.type) ?? "—"}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-muted-foreground">
                    {outletScopeLabel(o.scope) ?? "—"}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-right tabular-nums text-muted-foreground">
                    {formatVisits(o.visits)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {o.article_count}
                  </TableCell>
                  {/* ⚠️ COVERAGE IS A COLUMN, not a caption. A spectrum drawn
                      from a handful of articles is a lie told in colour, and
                      the reader has to be able to see the sample beside the
                      bar rather than infer it. */}
                  <TableCell className="text-right tabular-nums">
                    <Coverage outlet={o} />
                  </TableCell>
                  {/* One cell, always visible — the header has one too. An
                      extra md:hidden duplicate put more cells in every body
                      row than in the header, which is only invisible while
                      the CSS happens to be applied. */}
                  <TableCell>
                    {hasSpectrum(o.leaning) ? (
                      <LeanSpectrum counts={o.leaning} />
                    ) : (
                      <TooFewSpectrum outlet={o} />
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {hasSpectrum(o.russia_stance) ? (
                      <StanceSpectrum counts={o.russia_stance} />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="py-6 text-center text-muted-foreground"
                  >
                    Няма съвпадения.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          {filtered.length > limit ? (
            <LoadMore
              remaining={filtered.length - limit}
              onMore={() => setLimit((n) => n + PAGE_SIZE)}
            />
          ) : null}
        </Card>
      )}
    </div>
  );
};
