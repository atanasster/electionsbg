// „Какво е отворено сега" — the /funds band-1 companion to the finder.
//
// This is the module's answer to the question the audience actually asks. Measured on a
// 113K-member EU-funds group (docs/plans/funds-module-v2.md §1): ~68% of questions are „има ли
// програма за X", and not one of 47 asked who received money. Everything else on /funds
// answers the second question.
//
// THREE SECTIONS, NEVER ONE LIST. The distinction is not cosmetic:
//   Отворено сега      — a real deadline. Apply.
//   Очаквани приеми    — a ДФЗ month range. A forecast; prepare, do not count on a date.
//   Проекти на насоки  — draft guidance out for comment. You cannot apply; you CAN comment.
// A countdown on a forecast, or a draft rendered beside a real call, is the harm invariants 2
// and 7 exist to prevent.
//
// FRESHNESS IS PART OF THE CONTENT. A list of deadlines with no "checked at" is a claim that
// it is current. When the newest successful crawl is older than the SLA the tile SAYS the list
// may be out of date instead of quietly implying otherwise; when nothing has ever run it says
// that too, rather than rendering an empty section that reads as „no calls".
//
// AND A FAILED FETCH IS NOT AN EMPTY REGISTER. `isError` renders NOTHING (the sibling tiles on
// this page do the same), because the alternative — falling through to an empty payload — makes
// the tile assert both „there are no open procedures" and „we have never checked". Two false
// statements, in the one place on the site where being wrong costs a reader a deadline.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CalendarClock,
  FileText,
  Megaphone,
} from "lucide-react";
import { Card, CardContent } from "@/ux/Card";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { formatEur } from "@/lib/currency";
import {
  crawlAgeHours,
  formatSofiaStamp,
  newestCrawl,
  STALE_AFTER_HOURS,
  useOpenCalls,
  type OpenCallRow,
} from "@/data/opencalls/useOpenCalls";

const PREVIEW = 5;

/** A date chip. Only ever rendered for a row that HAS a date of its own.
 *
 *  The PREFIX is what keeps three different facts from sharing one visual:
 *    a call            — bare „14 сеп, 16:30 · остават 12 дни" (apply by then)
 *    an upcoming call  — „от 1 окт" and NO countdown; it rides in the calls group by design,
 *                        and a bare countdown there would read as time left to APPLY
 *    a consultation    — „коментари до …" (the deadline is for comments, not an application)
 *  The chip is the element a scanning reader actually reads, so the section hint alone cannot
 *  carry the distinction. */
const DateChip: FC<{ row: OpenCallRow }> = ({ row }) => {
  const { t, i18n } = useTranslation();

  if (row.status === "upcoming" && row.opensAt)
    return (
      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
        {t("oc_opens_at", {
          when: formatSofiaStamp(row.opensAt, i18n.language),
        })}
      </span>
    );

  if (!row.closesAt) return null;
  const d = row.daysLeft;
  // <= 7 days is the most actionable figure on the page, so it is the one that gets emphasis.
  // Never for a consultation: „3 days left to comment" is not urgent in the same way.
  const urgent = d !== null && d <= 7 && row.kind !== "consultation";
  const stamp = formatSofiaStamp(row.closesAt, i18n.language);
  return (
    <span
      className={
        urgent
          ? "shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
          : "shrink-0 text-[11px] tabular-nums text-muted-foreground"
      }
    >
      {row.kind === "consultation"
        ? t("oc_comments_until", { when: stamp })
        : stamp}
      {d !== null && row.kind !== "consultation"
        ? ` · ${t("oc_days_left", { count: d })}`
        : null}
    </span>
  );
};

const Money: FC<{ row: OpenCallRow }> = ({ row }) => {
  const { t, i18n } = useTranslation();
  // FORMAT FIRST, FILTER AFTER. `formatEur` returns "" for anything non-finite — including the
  // STRING node-postgres produces from a `numeric` column, which is exactly the state a database
  // that has the route but not migration 142's reconcile is in (the documented cloud order ships
  // `deploy:db` before the SQL). Guarding on `!== null` and joining would then emit a leading
  // „ · ". Filtering the FORMATTED strings is robust to the wire format either way.
  //
  // Only 'source' and 'reviewed' rows carry money at all (142's CHECK), so anything shown here
  // is publisher-stated or human-confirmed — never an unreviewed extraction.
  const bits = [
    formatEur(row.budgetEur, i18n.language),
    row.aidRatePct !== null ? `${row.aidRatePct}%` : "",
    row.grantMaxEur !== null
      ? `${t("oc_up_to") || "до"} ${formatEur(row.grantMaxEur, i18n.language)}`
      : "",
  ].filter(Boolean);
  if (bits.length === 0) return null;
  return (
    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
      {bits.join(" · ")}
    </span>
  );
};

const Row: FC<{ row: OpenCallRow; showPeriod?: boolean }> = ({
  row,
  showPeriod,
}) => (
  <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
    <a
      href={row.sourceUrl}
      target="_blank"
      rel="noreferrer"
      // CLAMPED TO TWO LINES. ИСУН titles are not headlines — they are the procedure's full
      // legal name, and the longest live one („Процедура № 2, Специфична цел 1 „Европейско
      // интегрирано управление на границите" и специфична цел 2 „Обща визова политика"") is
      // 150+ characters. In a third-width column that wrapped to ten lines and made one row
      // taller than the five beneath it, so the card's height was set by its worst title
      // rather than by its content. `title` keeps the whole string one hover away, and the
      // row links out to the register that owns the authoritative name anyway.
      className="line-clamp-2 min-w-0 flex-1 font-medium hover:underline"
      title={`${row.title} — ${row.sourceUrl}`}
    >
      {row.title}
    </a>
    {row.code ? (
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
        {row.code}
      </span>
    ) : null}
    <Money row={row} />
    {showPeriod && row.periodLabel ? (
      <span className="shrink-0 text-[11px] text-muted-foreground">
        {row.periodLabel}
      </span>
    ) : (
      <DateChip row={row} />
    )}
  </li>
);

const Section: FC<{
  title: string;
  hint: string;
  icon: typeof CalendarClock;
  rows: OpenCallRow[];
  /** The size of the GROUP. `rows` is a capped preview, so counting it would understate. */
  total: number;
  showPeriod?: boolean;
  emptyLabel: string;
}> = ({ title, hint, icon: Icon, rows, total, showPeriod, emptyLabel }) => {
  const { t } = useTranslation();
  return (
    <Card>
      <CardContent className="p-3 text-sm md:p-4">
        <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {title}
          {/* The GROUP's size, from the route — never `rows.length`, which is the preview cap
              and disagreed with /funds/calls by 25. */}
          <span className="tabular-nums">{total > 0 ? total : null}</span>
        </div>
        <p className="mb-2 text-[11px] text-muted-foreground/80">{hint}</p>
        {rows.length === 0 ? (
          // A NAMED empty state, not a hidden section. ИСУН's consultation tier was empty on
          // 2026-08-08 and will often be; „nothing here right now" is an answer, a blank is not.
          <p className="text-xs text-muted-foreground">{emptyLabel}</p>
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-border">
              {rows.slice(0, PREVIEW).map((r) => (
                <Row
                  key={`${r.source}:${r.sourceKey}`}
                  row={r}
                  showPeriod={showPeriod}
                />
              ))}
            </ul>
            {total > PREVIEW ? (
              // NAMES the remainder rather than letting five rows imply the whole group: the
              // heading already says `total`, so an unexplained five-row list contradicts it.
              <p className="mt-2 text-[11px]">
                <Link
                  to="/funds/calls"
                  // „+40" alone is all a screen reader would announce without this.
                  aria-label={t("oc_see_all") || "Виж всички процедури"}
                  className="text-primary hover:underline"
                >
                  +{total - PREVIEW}
                </Link>
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export const OpenCallsTile: FC = () => {
  const { t, i18n } = useTranslation();
  // PREVIEW, not 20: the section counts come from `totals`, so there is no reason to ship rows
  // the tile cannot render. Measured on the live corpus, `limit=20` was 82 KB of row JSON on a
  // hub page every visitor loads; the trimmed projection plus this is 18 KB.
  const { data, isLoading, isError } = useOpenCalls({ limit: PREVIEW });

  // A failure must not become „няма отворени процедури" + „още не е зареждан". Same shape as
  // DualCorpusLeaderboardTile / RrfTeaserTile on this page.
  if (isLoading || isError || !data) return null;
  const d = data;

  const newest = newestCrawl(d.crawl);
  const stale = crawlAgeHours(d.crawl) > STALE_AFTER_HOURS;

  return (
    <DashboardSection
      id="funds"
      title={t("oc_band_title") || "Какво е отворено сега"}
      subtitle={
        t("oc_band_sub") || "Процедури, по които може да се кандидатства."
      }
      icon={CalendarClock}
    >
      {/* FRESHNESS FIRST. If we cannot say when we last looked, we must not imply the list is
          current — that is invariant 3, and it is the difference between an index and a claim. */}
      <p
        className={
          stale
            ? "flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400"
            : "text-[11px] text-muted-foreground/80"
        }
      >
        {stale ? <AlertTriangle className="h-3 w-3 shrink-0" /> : null}
        {newest
          ? stale
            ? t("oc_stale", {
                when: formatSofiaStamp(newest.crawledAt, i18n.language),
              })
            : t("oc_checked", {
                when: formatSofiaStamp(newest.crawledAt, i18n.language),
              })
          : t("oc_never_checked")}
      </p>

      <div className="grid gap-4 xl:grid-cols-3">
        <Section
          title={t("oc_open_title") || "Отворено сега"}
          hint={t("oc_open_hint") || "Публикуван краен срок."}
          icon={CalendarClock}
          rows={d.calls}
          total={d.totals.calls}
          emptyLabel={
            t("oc_open_empty") || "В момента няма отворени процедури."
          }
        />
        <Section
          title={t("oc_indicative_title") || "Очаквани приеми"}
          hint={
            t("oc_indicative_hint") ||
            "Индикативен график — период, не краен срок."
          }
          icon={FileText}
          rows={d.indicative}
          total={d.totals.indicative}
          showPeriod
          emptyLabel={t("oc_indicative_empty") || "Няма обявен график."}
        />
        <Section
          title={t("oc_consult_title") || "Проекти на насоки"}
          hint={
            t("oc_consult_hint") ||
            "Още не се кандидатства — може да се дадат коментари."
          }
          icon={Megaphone}
          rows={d.consultations}
          total={d.totals.consultations}
          emptyLabel={
            t("oc_consult_empty") ||
            "В момента няма проекти на насоки за обсъждане."
          }
        />
      </div>

      <p className="text-[11px] text-muted-foreground/80">
        <Link to="/funds/calls" className="text-primary hover:underline">
          {t("oc_see_all") || "Виж всички процедури"}
        </Link>
        {" · "}
        {/* The coverage boundary, stated — and kept EXACT rather than round. ИСУН is the ЕСИФ
            register and ДФЗ the agricultural schedule; Interreg runs on Jems, so it needs its
            own crawler per programme (funds-module-v2 §2.3b, Stage 8).

            „ЧАСТ ОТ", NOT A COUNT — and the count is what the first draft got wrong. This
            string named „2 от 6" and „Черноморски басейн" explicitly while the committed
            snapshot held zero Black Sea rows, because that site answered once on 2026-08-09 and
            then refused every subsequent attempt. A hard-coded fraction is a claim about data
            this component cannot see, and it goes stale in BOTH directions: wrong when a
            programme is down, wrong again when one comes back. „Част от" is true at 1, at 2 and
            at 6, and still refuses the completeness the old „Interreg не се следи тук" denied
            and a bare „Interreg се следи" would imply. The per-programme state lives where it
            stays fresh: the crawl output and the `interreg_calls` watcher's detail line. */}
        {t("oc_coverage") ||
          "Обхват: ИСУН (европейски програми), ДФ „Земеделие“ и част от трансграничните програми (Interreg)."}
      </p>
    </DashboardSection>
  );
};
