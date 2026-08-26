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

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
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
import { LEANING_META, RUSSIA_META, bgArticles } from "../labels";
import { LeanSpectrum, StanceSpectrum } from "../components/SpectrumBar";
import { LoadMore } from "../components/LoadMore";

const PAGE_SIZE = 15;

/**
 * The off-topic bucket. Shown, dashed and counted — never dropped.
 *
 * ⚠️ It is 143 of 365 analysed articles. Hiding it would make every
 * percentage on this page a share of a denominator the reader cannot see, and
 * "what fraction of what we collect is not about Bulgarian public affairs" is
 * a real answer about the crawl rather than a blemish to sweep up.
 */
const OFF_TOPIC = "not-site-relevant";

const AXIS_LABEL = {
  leaning: "политическа ос",
  russia_stance: "отношение към Русия",
} as const;

/**
 * „3 статии" / „1 статия" / „21 статия" — Bulgarian number agreement.
 *
 * ⚠️ The rule is on the LAST DIGIT, not on the value: every numeral ending in
 * 1 takes the singular EXCEPT the teens (11 статии, but 21 статия, 101
 * статия). An `n === 1` test is right for exactly one number and wrong for
 * 21, 31, 41 … which are reachable here — the floor is 20.
 */
const articles = bgArticles;

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
}) => (
  <span className="text-xs text-muted-foreground">
    {/* ⚠️ THREE states, not two — the third is real and common. „Управление
        и кабинет" is tagged on 7 articles and is the MAIN subject of none, so
        „нито една статия не заема позиция" is the wrong fact about it: no
        article was ever asked. Only a topic somebody actually wrote about can
        be short of positions. */}
    {primaryCount === 0
      ? "само като второстепенна тема"
      : axis.n === 0
        ? "нито една статия не заема позиция"
        : `${articles(axis.n)} от нужните ${TOPIC_MIN_POSITIONED}`}
  </span>
);

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
const Spread = ({ axis }: { axis: AxisSpread }) => (
  <span className="flex items-baseline gap-1.5">
    <span className="tabular-nums font-medium">
      {/* `enough` implies `spread != null` — n >= 20 > 2. If that ever stops
          holding, an em dash beside "от N статии" is a visible contradiction
          rather than a blank that reads as zero. */}
      {axis.spread == null ? "—" : axis.spread.toFixed(2)}
    </span>
    <span className="text-xs text-muted-foreground">от {articles(axis.n)}</span>
  </span>
);

export const TopicsScreen = () => {
  const taxonomy = useTaxonomy();
  const [limit, setLimit] = useState(PAGE_SIZE);

  const rows = useMemo(() => {
    // ⚠️ EITHER count, not `article_count` alone. `article_count` sums the
    // taxonomy's declared subcategories; `primary_count` keys on the category
    // itself. An article whose subcategory has since been retired from
    // topics.json therefore has a verdict, a spread and an outlet — and an
    // `article_count` of 0, which silently drops the whole row.
    const list = (taxonomy.data?.categories ?? []).filter(
      (c) => c.article_count > 0 || c.primary_count > 0,
    );
    return list.sort((a, b) => {
      // ⚠️ Sorted by DISAGREEMENT, and a topic without the sample for it can
      // never outrank one that has it — otherwise a single 2.0 read off two
      // articles tops the board. Below the floor we fall back to volume, so
      // the ordering is still stable and legible while the corpus fills up.
      const ax = a.spread[dominantAxis(a)];
      const bx = b.spread[dominantAxis(b)];
      if (ax.enough !== bx.enough) return ax.enough ? -1 : 1;
      if (ax.enough && bx.enough) return (bx.spread ?? 0) - (ax.spread ?? 0);
      // Off-topic sinks among the below-floor rows: it is shown and counted,
      // but it is not a subject anyone came here to read about.
      const aOff = a.id === OFF_TOPIC;
      const bOff = b.id === OFF_TOPIC;
      if (aOff !== bOff) return aOff ? 1 : -1;
      return b.article_count - a.article_count;
    });
  }, [taxonomy.data]);

  const measurable = rows.filter((c) => c.spread[dominantAxis(c)].enough);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-title text-3xl">Теми</h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">
          Не по обем, а по разминаване: колко различно изданията отразяват една
          и съща тема. Разсейването е стандартното отклонение на позициите по
          скалата −2…+2 — 0 значи, че всички са в една посока, 2 — че се делят
          между двете крайности.
        </p>
      </header>

      {/* ⚠️ The state of the measure, stated before the table rather than left
          for the reader to infer from a column of dashes. */}
      {taxonomy.data && rows.length > 0 && measurable.length === 0 ? (
        <Card className="border-dashed p-4 text-sm text-muted-foreground">
          <strong className="font-medium text-foreground">
            Нито една тема още не стига прага.
          </strong>{" "}
          Разсейване се публикува от {TOPIC_MIN_POSITIONED} статии с позиция
          нагоре. Мнозинството от анализираните материали не заемат позиция по
          нито една от двете оси, така че прагът се пълни бавно. Дотогава редът
          по-долу е по обем, а всяка тема казва колко ѝ липсва.
        </Card>
      ) : null}

      {taxonomy.error && !taxonomy.data ? (
        <Card className="p-4 text-sm text-destructive">
          Темите не се заредиха: {taxonomy.error.message}
        </Card>
      ) : taxonomy.loading && !taxonomy.data ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : (
        <Card className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Тема</TableHead>
                <TableHead scope="col" className="text-right">
                  Статии
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Издания
                </TableHead>
                <TableHead scope="col" className="min-w-44">
                  Разсейване
                </TableHead>
                <TableHead
                  scope="col"
                  className="min-w-40 hidden md:table-cell"
                >
                  Разпределение
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, limit).map((c) => (
                <Row key={c.id} category={c} />
              ))}
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-6 text-center text-muted-foreground"
                  >
                    Няма анализирани статии по нито една тема.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          {rows.length > limit ? (
            <LoadMore
              remaining={rows.length - limit}
              onMore={() => setLimit((n) => n + PAGE_SIZE)}
            />
          ) : null}
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Броят до разсейването е статиите, които{" "}
        <strong className="font-medium text-foreground">заемат позиция</strong>{" "}
        по съответната ос — не всички по темата. Мнозинството от анализираните
        материали получават „без пристрастие" или „без позиция"; те не влизат
        нито в разсейването, нито в лентата вдясно, защото липсата на позиция не
        е позиция в средата.
      </p>
      <p className="text-xs text-muted-foreground">
        Оста се избира за всяка тема поотделно — тази с повече заели позиция
        статии. Украйна се дели по отношението към Русия, бюджетът — по
        политическата ос; една обща ос за всички теми би показала грешното
        разминаване или никакво.
      </p>
    </div>
  );
};

const Row = ({ category: c }: { category: TaxonomyCategory }) => {
  const axis = dominantAxis(c);
  const measure = c.spread[axis];
  const offTopic = c.id === OFF_TOPIC;
  const meta = axis === "leaning" ? LEANING_META : RUSSIA_META;

  return (
    <TableRow className={offTopic ? "opacity-70" : undefined}>
      <TableCell>
        {/* Only a topic with its own route is a link — the rest are subjects
            we classify but do not yet have a page for, and a dead link is a
            promise the site does not keep. */}
        {c.route ? (
          <Link to={c.route} className="font-medium hover:text-primary">
            {c.label.bg}
          </Link>
        ) : (
          <span className="font-medium">{c.label.bg}</span>
        )}
        {offTopic ? (
          <span className="ml-2 rounded border border-dashed px-1.5 py-0.5 text-[11px] text-muted-foreground">
            извън обхвата
          </span>
        ) : null}
      </TableCell>
      {/* Both numbers, because they answer different questions and the gap is
          exactly what explains an empty row. */}
      <TableCell className="text-right tabular-nums">
        <span
          title={`${c.primary_count} с основна тема, ${c.article_count} споменавания общо`}
        >
          {c.primary_count}
          {c.primary_count !== c.article_count ? (
            <span className="text-muted-foreground">/{c.article_count}</span>
          ) : null}
        </span>
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {c.outlet_count}
      </TableCell>
      <TableCell>
        {measure.enough ? (
          <span className="flex items-baseline gap-2">
            <Spread axis={measure} />
            <span className="text-xs text-muted-foreground">
              {AXIS_LABEL[axis]}
            </span>
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
