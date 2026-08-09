// „Финансирани ли са проекти като твоя" — the /funds resolver.
//
// THE QUESTION. Measured on a 113K-member EU-funds group (docs/plans/funds-module-v2.md §1 and
// Appendix A): ~68% of posts are „има ли програма за X" — a guest house, photovoltaics, a young
// farmer, digitalising a construction firm — and not one of 47 asked who received money, which is
// what every other tile on this page answers. We cannot say „yes, apply here": nobody can, since
// eligibility lives in each procedure's guidance documents. What we CAN say is the base rate, and
// that is what a person deciding whether to spend three months on an application actually needs:
// has anything like this been funded, how many times, for how much, by what kind of organisation,
// and whether any of it was near them.
//
// WHAT IT DELIBERATELY DOES NOT SAY. „You are eligible", „you should apply", or any number that
// reads as a probability of success. The corpus holds only SIGNED contracts — ИСУН publishes no
// rejected applications at all — so an approval rate has no denominator and is not computable.
// „N of them were paid" is the nearest honest thing and is labelled as exactly that.
//
// TWO CORPORA, NAMED. ИСУН holds zero Interreg projects (Interreg runs on Jems), and Interreg
// money is cross-border so it lands almost entirely on BORDER municipalities. An ИСУН-only
// resolver would answer „нищо подобно не е финансирано наблизо" to precisely the readers whose
// neighbours hold grants. The two arms are shown separately because they are different bases, and
// the coverage caption is rendered from the server's own counts rather than written into the copy.

import { FC, useDeferredValue, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Compass, Globe2, Search } from "lucide-react";
import { Card, CardContent } from "@/ux/Card";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { PackSelect } from "@/screens/components/procurement/PackSelect";
import { formatEur } from "@/lib/currency";
import { OBLAST_NAME } from "@/lib/regionalOblast";
import {
  FIT_MIN_QUERY,
  useFundsFit,
  type FundsFitBasis,
  type FundsFitInterregRow,
  type FundsFitIsunRow,
} from "@/data/funds/useFundsFit";

const numFmt = new Intl.NumberFormat("bg-BG");

/** „Всички области" plus the 28 real ones. The empty value means „no place" — which RANKS
 *  nothing rather than filtering, so it is a real choice and not a null state. */
const ALL = "" as const;

const IsunRow: FC<{ row: FundsFitIsunRow; oblast: string }> = ({
  row,
  oblast,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const name = row.procedureName ?? row.sampleTitle ?? row.procedureCode;
  const top = row.orgKinds.slice(0, 3);
  return (
    <li className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <Link
          to={`/funds/procedure/${encodeURIComponent(row.procedureCode)}`}
          className="min-w-0 flex-1 font-medium hover:underline"
        >
          {name}
        </Link>
        {/* THE ANSWER, in one figure: how many have been funded. */}
        <span className="shrink-0 text-sm font-semibold tabular-nums">
          {t("fit_n_projects", { count: row.projectCount })}
        </span>
      </div>
      {/* When the name shown above is an EXAMPLE rather than the scheme's own name, say so — 59%
          of procedures publish no name, and presenting a single project's title as the scheme
          would misdescribe what the reader would be applying to. */}
      {!row.procedureName && row.sampleTitle ? (
        <span className="text-[11px] text-muted-foreground/80">
          {t("fit_example_title")}
        </span>
      ) : null}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {row.grantMedian !== null ? (
          <span className="tabular-nums">
            {t("fit_median")} <b>{formatEur(row.grantMedian, lang)}</b>
            {row.grantP25 !== null && row.grantP75 !== null ? (
              // The SPREAD, not just the middle. „Колко дават" has a long tail, and a lone median
              // over a procedure whose quartiles are €12k and €400k describes almost nobody.
              <span className="opacity-80">
                {" "}
                ({formatEur(row.grantP25, lang)} –{" "}
                {formatEur(row.grantP75, lang)})
              </span>
            ) : null}
          </span>
        ) : null}
        {oblast && row.localCount > 0 ? (
          <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
            {t("fit_local", {
              count: row.localCount,
              place:
                OBLAST_NAME[oblast]?.[lang === "bg" ? "bg" : "en"] ?? oblast,
            })}
          </span>
        ) : null}
        {top.length ? (
          <span>
            {t("fit_who")}{" "}
            {top.map((k) => `${k.label} (${numFmt.format(k.n)})`).join(" · ")}
          </span>
        ) : null}
        {/* DISBURSEMENT, labelled as disbursement. Never „approved" — see the header. */}
        {row.paidProjectCount > 0 ? (
          <span>
            {t("fit_paid", {
              paid: numFmt.format(row.paidProjectCount),
              total: numFmt.format(row.projectCount),
            })}
          </span>
        ) : null}
        {row.programName ? <span>{row.programName}</span> : null}
      </div>
    </li>
  );
};

const InterregRow: FC<{ row: FundsFitInterregRow }> = ({ row }) => {
  const { t, i18n } = useTranslation();
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
      <Link
        to={`/funds/interreg/${row.keepId}`}
        className="min-w-0 flex-1 font-medium hover:underline"
      >
        {row.title}
      </Link>
      {/* The English marker. keep.eu publishes these in English only and we do not translate them
          — an unmarked English row in a Bulgarian list reads as an oversight rather than a fact
          about the source. */}
      {row.titleIsEnglish ? (
        <span className="shrink-0 rounded border px-1 py-0.5 text-[10px] uppercase text-muted-foreground">
          EN
        </span>
      ) : null}
      {row.bgBudgetEur !== null ? (
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {formatEur(row.bgBudgetEur, i18n.language)}
        </span>
      ) : null}
      {/* The chip says „in your province", NOT the operation's mode obshtina. `isLocal` is true
          when ANY Bulgarian partner is in the asker's oblast, while `obshtina` is the mode over
          all of them — so a two-partner operation could name a place in a different oblast
          entirely, and it is a raw code („BGS04") that means nothing to a reader anyway. */}
      {row.isLocal ? (
        <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
          {t("fit_interreg_local")}
        </span>
      ) : null}
      {row.period ? (
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {row.period}
        </span>
      ) : null}
    </li>
  );
};

/** The coverage caption, rendered FROM THE SERVER'S COUNTS. Written as copy it would drift from
 *  the data the first time either corpus reloaded. */
const BasisNote: FC<{ basis: FundsFitBasis }> = ({ basis }) => {
  const { t } = useTranslation();
  const eikPct = basis.interregPartners
    ? Math.round((100 * basis.interregWithEik) / basis.interregPartners)
    : 0;
  return (
    <p className="text-[11px] text-muted-foreground/80">
      {t("fit_basis", {
        projects: numFmt.format(basis.isunProjects),
        procedures: numFmt.format(basis.isunProcedures),
        operations: numFmt.format(basis.interregOperations),
      })}{" "}
      {/* The Tier-L caveat as a real share. 2014-2020 Interreg carries no EIK, so „who applied"
          over that arm is partial by exactly this much. */}
      {t("fit_basis_eik", { pct: eikPct })}
    </p>
  );
};

export const FitResolverTile: FC = () => {
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState("");
  const [oblast, setOblast] = useState<string>(ALL);
  // The input stays responsive while a 20–145 ms query runs behind it.
  const deferred = useDeferredValue(q);
  const { data, isFetching, isError } = useFundsFit(deferred, oblast || null);

  const lang = i18n.language === "bg" ? "bg" : "en";
  const oblastOptions = useMemo(
    () => [
      { value: ALL, label: t("fit_all_oblasts") || "Цялата страна" },
      ...Object.entries(OBLAST_NAME)
        // Labelled and SORTED in the reader's language. OBLAST_NAME carries both; using `.bg`
        // unconditionally left the English page with a Bulgarian picker sorted by Bulgarian
        // collation — the funds-seo-geo F3 mixed-language failure in miniature.
        .map(([code, n]) => ({ value: code, label: n[lang] }))
        .sort((a, b) => a.label.localeCompare(b.label, lang)),
    ],
    [t, lang],
  );

  const short = deferred.trim().length < FIT_MIN_QUERY;
  const isun = data?.isun ?? [];
  const interreg = data?.interreg ?? [];
  // A FAILED FETCH IS NOT A „NO". „Не открихме подобни проекти" is a statement about the corpus,
  // and on this tile it is the statement that stops someone applying — so it must never stand in
  // for a 500.
  //
  // What actually enforces that is the `isError` BRANCH below, which is checked first; the
  // `!isError` term here is belt-and-braces against a future reordering and no test can
  // distinguish it (removing it changes nothing, verified). `!!data` is NOT redundant: on the
  // first render after a long-enough query, before the request starts, there is no data, no
  // error and no fetch in flight — and without it that instant renders „nothing found".
  const nothing =
    !short &&
    !isFetching &&
    !isError &&
    !!data &&
    isun.length === 0 &&
    interreg.length === 0;

  return (
    <DashboardSection
      id="funds"
      title={t("fit_title") || "Финансирани ли са проекти като твоя"}
      subtitle={
        t("fit_sub") ||
        "Опиши дейността си с две-три думи и виж дали подобни проекти са получавали пари — колко пъти, по колко и къде."
      }
      icon={Compass}
    >
      <Card>
        <CardContent className="p-3 md:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={
                  t("fit_placeholder") ||
                  "къща за гости, фотоволтаици, млад фермер…"
                }
                aria-label={
                  t("fit_title") || "Финансирани ли са проекти като твоя"
                }
                className="h-9 w-full rounded-md border border-input bg-transparent pl-8 pr-3 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </label>
            {/* PackSelect, not a Radix Select — Select.Root locks body scroll and has no `modal`
                prop, which flashes a ghost scrollbar. See PackSelect's header. */}
            <PackSelect
              value={oblast}
              onChange={setOblast}
              ariaLabel={t("fit_oblast_label") || "Област"}
              className="h-9 min-w-[170px] text-sm"
              contentClassName="max-h-[60vh] overflow-y-auto"
              options={oblastOptions}
            />
          </div>

          {short ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {t("fit_hint")}
            </p>
          ) : isError ? (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {t("fit_error")}
            </p>
          ) : nothing ? (
            // NAMED, and it names the LIMIT rather than the corpus. „Nothing like that has ever
            // been funded" is a claim we cannot support from a trigram match over project titles.
            <p className="mt-3 text-xs text-muted-foreground">
              {t("fit_empty")}
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-4">
              {isun.length ? (
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("fit_isun_group")}
                  </div>
                  <ul className="flex flex-col divide-y divide-border text-sm">
                    {isun.map((r) => (
                      <IsunRow key={r.procedureCode} row={r} oblast={oblast} />
                    ))}
                  </ul>
                </div>
              ) : null}
              {/* The arm is EMPTY and the reader typed Bulgarian that bridged to nothing — say
                  so, rather than let the absence read as „no cross-border project like this
                  exists". It is a vocabulary gap on our side, not a fact about the corpus. */}
              {!interreg.length && isun.length && !data?.interregQuery ? (
                <p className="text-[11px] text-muted-foreground/80">
                  {t("fit_interreg_unsearched")}
                </p>
              ) : null}
              {interreg.length ? (
                <div>
                  <div className="mb-1 flex flex-wrap items-center gap-x-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Globe2 className="h-3.5 w-3.5" />
                    {t("fit_interreg_group")}
                  </div>
                  {/* WHY THESE ROWS ARE IN ENGLISH, and what was actually searched. keep.eu
                      publishes 86% of Interreg titles in English only, so a Bulgarian query is
                      bridged to an English topic before this arm runs. Saying which term lets a
                      reader see when the bridge picked the wrong one — silently substituting it
                      would leave an English list under a Bulgarian query unexplained. */}
                  {data?.interregQuery ? (
                    <p className="mb-1 text-[11px] text-muted-foreground/80">
                      {t("fit_interreg_bridged", { term: data.interregQuery })}
                    </p>
                  ) : (
                    // Once per GROUP, not once per row — the identical sentence on every row is
                    // noise in a screen reader. Only when the bridge note is absent, since that
                    // note already explains why the rows are in English.
                    <p className="sr-only">{t("fit_interreg_hint")}</p>
                  )}
                  <ul className="flex flex-col divide-y divide-border text-sm">
                    {interreg.map((r) => (
                      <InterregRow key={r.keepId} row={r} />
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}

          {data?.basis ? (
            <div className="mt-3 border-t pt-2">
              <BasisNote basis={data.basis} />
              {/* The boundary of what this answers, stated once. It is a base rate over money
                  already awarded — not an eligibility check, and not a forecast. */}
              <p className="mt-1 text-[11px] text-muted-foreground/80">
                {t("fit_disclaimer")}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </DashboardSection>
  );
};
