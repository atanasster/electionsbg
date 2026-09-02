// /funds/interreg/programme/:code — one Interreg PROGRAMME's Bulgarian-side
// detail: its stats, its top operations, and the municipalities it reaches.
//
// The grain between the national overview (InterregTile's top-6-of-19
// programme list, which answers "how big is this programme") and one
// operation (FundsInterregScreen, /funds/interreg/:keepId). This page answers
// what a reader actually wants after clicking a programme's name: what did it
// fund, and where.
//
// BULGARIAN PARTNER ROWS ONLY, same scope as the overview's per-programme
// summary row — see interreg_programme() (194) for why: it is the programme's
// Bulgarian budget share, not the whole cross-border programme total.
//
// A REGISTERED-BUT-EMPTY PROGRAMME IS NOT "NOT FOUND". Two programmes
// (BG-Serbia 2021-2027, ESPON 2030) are registered with keep.eu holding zero
// operations for them — the page renders their honest zero rather than a
// not-found branch, because a missing row and a zero row mean opposite
// things (137's own header). `coverageNote` names why when the corpus knows.

import { FC } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur, formatInt } from "@/lib/currency";
import { useInterregProgramme } from "@/data/funds/useInterreg";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { InterregOperationRow } from "./InterregOperationRow";
import { GOVERNANCE_INTERREG_ANCHOR } from "./InterregTile";

export const FundsInterregProgrammeScreen: FC = () => {
  const { code } = useParams<{ code: string }>();
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const lang = bg ? "bg" : "en";
  const { data, isLoading, isError } = useInterregProgramme(code);
  const { findMunicipality } = useMunicipalities();

  if (isLoading) return null;

  // ERROR AND NOT-FOUND ARE DIFFERENT ANSWERS — same distinction
  // FundsInterregScreen (the operation page) draws, for the same reason: the
  // route serves 200 + null for an unknown code precisely so a 500, a pool
  // timeout or a dropped connection stays distinguishable from a mistyped or
  // retired code.
  if (isError) {
    return (
      <>
        {/* `title` (a string, not the page body) is required for <Title> to
            emit <SEO> at all — see the fix note below the loaded branch. */}
        <Title title="Interreg" description="Interreg">
          Interreg
        </Title>
        <GovernanceBreadcrumb
          sectionKey="funds_index_title"
          sectionTo="/funds"
          className="mt-5"
        />
        <div className="p-4 text-sm text-muted-foreground">
          {bg
            ? "Програмата не можа да бъде заредена. Това е грешка при заявката, не непозната програма — опитайте отново."
            : "This programme could not be loaded. That is a request failure, not an unknown programme — please try again."}
        </div>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <Title title="Interreg" description="Interreg">
          Interreg
        </Title>
        <GovernanceBreadcrumb
          sectionKey="funds_index_title"
          sectionTo="/funds"
          className="mt-5"
        />
        <div className="p-4 text-sm text-muted-foreground">
          {bg
            ? "Няма такава програма в корпуса от keep.eu."
            : "No such programme in the keep.eu corpus."}{" "}
          <Link to="/funds/interreg" className="underline">
            {bg ? "Към Interreg" : "Back to Interreg"}
          </Link>
        </div>
      </>
    );
  }

  const title = (bg ? data.nameBg : data.nameEn) ?? data.code;

  return (
    <>
      {/* <Title>'s `children` become its OWN <h1> — passing the whole page as
          children (as an earlier draft did) both skips <SEO> (it only renders
          when `title` is a string, or `children` is) AND nests that <h1>
          around a second, explicit one below. `title` + a short label as
          children is the pattern FundsProcedureScreen.tsx already uses; the
          rest of the page is a SIBLING, not Title's children. */}
      <Title
        title={title}
        description={t("funds_interreg_programme_meta_description", {
          title,
          eur: formatEur(data.budgetEur, lang),
        })}
      >
        {title}
      </Title>
      <div className="flex flex-col gap-4 p-4">
        <GovernanceBreadcrumb
          sectionKey="funds_index_title"
          sectionTo="/funds"
          current={title}
        />

        <div>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.period}
            {data.cci ? ` · ${data.cci}` : ""}
          </p>
        </div>

        <Card>
          <CardContent className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="flex flex-col">
              <span className="text-lg font-bold tabular-nums">
                {formatEur(data.budgetEur, lang)}
              </span>
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("interreg_stat_budget")}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-lg font-bold tabular-nums">
                {formatInt(data.operationCount, lang)}
              </span>
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("interreg_stat_operations")}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-lg font-bold tabular-nums">
                {formatInt(data.partnerCount, lang)}
              </span>
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("interreg_stat_partners")}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {t("interreg_placed_hint", {
                  placed: formatInt(data.placedCount, lang),
                })}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Rows whose programme published no budget count in partnerCount and
            contribute ZERO euros — the same caveat MyAreaInterregTile treats
            as mandatory context, never optional, beside a money figure. */}
        {data.unpublishedPartnerCount > 0 ? (
          <p className="text-[10px] text-muted-foreground">
            {t("myarea_interreg_unpublished", {
              count: data.unpublishedPartnerCount,
            })}
          </p>
        ) : null}

        {/* A registered-but-empty programme (2 of 19) is a stated gap, not a
            silent one — see the module header. Shown only when there is
            nothing else on the page to explain the zero. */}
        {data.operationCount === 0 && data.coverageNote ? (
          <p className="text-xs text-muted-foreground">{data.coverageNote}</p>
        ) : null}

        {data.operations.length > 0 ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                {t("funds_interreg_programme_operations", {
                  shown: formatInt(data.operations.length, lang),
                  total: formatInt(data.operationCount, lang),
                })}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <ul className="divide-y text-xs">
                {data.operations.map((o) => (
                  <InterregOperationRow
                    key={o.keepId}
                    operation={o}
                    bg={bg}
                    lang={lang}
                  />
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {data.munis.length > 0 ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                {t("funds_interreg_programme_munis", {
                  total: formatInt(data.munis.length, lang),
                })}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <ul className="divide-y text-xs">
                {data.munis.map((m) => {
                  const muni = findMunicipality(m.obshtina);
                  return (
                    <li
                      key={m.obshtina}
                      className="flex flex-wrap items-baseline gap-x-3 py-1.5"
                    >
                      <Link
                        to={`/governance/${m.obshtina}#${GOVERNANCE_INTERREG_ANCHOR}`}
                        className="min-w-0 flex-1 truncate font-medium underline"
                      >
                        {(bg ? muni?.name : muni?.name_en) ?? m.obshtina}
                      </Link>
                      <span className="tabular-nums font-semibold">
                        {formatEur(m.budgetEur, lang)}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {t("funds_interreg_programme_muni_ops", {
                          ops: formatInt(m.operationCount, lang),
                        })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <p className="text-[10px] text-muted-foreground">
          {bg ? "Източник: " : "Source: "}
          <a
            href="https://keep.eu/"
            target="_blank"
            rel="noreferrer noopener"
            className="underline"
          >
            keep.eu
          </a>
          {bg
            ? " (INTERACT). Сумите са бюджетът на българските партньори, не общият бюджет на програмата."
            : " (INTERACT). Amounts are the Bulgarian partners' own budget, not the programme's whole cross-border total."}
        </p>
      </div>
    </>
  );
};
