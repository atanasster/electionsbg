// /funds/interreg/:keepId — one Interreg operation and its whole partnership.
//
// This page exists because a search hit and a place tile both need a link
// target: without it, Interreg money is visible in aggregate everywhere and
// inspectable nowhere.
//
// IT IS THE ONE INTERREG SURFACE WHERE THE OPERATION TOTAL IS THE HEADLINE.
// Everywhere else that figure is forbidden inside an aggregate — summing it per
// place puts ~4x the true money on a municipality (€1,419,208 against Малко
// Търново's €357,183 on BSB00963). Here the subject IS the whole cross-border
// project, so the total is the honest number, and the Bulgarian share is stated
// right beside it so neither can stand in for the other.
//
// ALL partners are listed, foreign ones included. A page describing a
// cross-border project as if only its Bulgarian side existed would describe a
// project that does not exist — and it is why migration 137 stores all ~12,141
// partner rows rather than the ~1,493 Bulgarian ones.

import { FC } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import { useInterregOperation } from "@/data/funds/useInterreg";

const numFmt = new Intl.NumberFormat("bg-BG");

// Numeric shape, so this cannot use @/lib/formatDate — but it needs that module's UTC pin.
// `startDate` / `endDate` are PG `date` columns rendered inside jsonb, so they arrive as bare
// days ("2025-11-15"); formatting them in the reader's zone starts and ends the operation a
// day early for everyone west of Greenwich.
const fmtDate = (d: string | null, lang: string): string =>
  d
    ? new Date(d).toLocaleDateString(lang === "bg" ? "bg-BG" : "en-GB", {
        timeZone: "UTC",
      })
    : "—";

export const FundsInterregScreen: FC = () => {
  const { keepId } = useParams<{ keepId: string }>();
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const lang = bg ? "bg" : "en";
  const { data, isLoading, isError } = useInterregOperation(keepId);

  if (isLoading) return null;

  // ERROR AND NOT-FOUND ARE DIFFERENT ANSWERS, and the route goes out of its way
  // to keep them apart: it serves 200 + null for an unknown keepId precisely so
  // that a 500, a pool timeout or a dropped connection is distinguishable. Both
  // arrive here as `!data`, so branching on isError first is what stops an
  // outage from being reported as a factual claim about the corpus.
  if (isError) {
    return (
      <Title description={bg ? "Грешка при зареждане" : "Failed to load"}>
        <div className="p-4 text-sm text-muted-foreground">
          {bg
            ? "Проектът не можа да бъде зареден. Това е грешка при заявката, не липсващ проект — опитайте отново."
            : "This project could not be loaded. That is a request failure, not a missing project — please try again."}
        </div>
      </Title>
    );
  }

  if (!data) {
    return (
      <Title
        description={
          bg ? "Проектът не е намерен" : "Interreg project not found"
        }
      >
        <div className="p-4 text-sm text-muted-foreground">
          {bg
            ? "Няма такъв проект в корпуса от keep.eu."
            : "No such project in the keep.eu corpus."}{" "}
          <Link to="/funds" className="underline">
            {bg ? "Към еврофондовете" : "Back to EU funds"}
          </Link>
        </div>
      </Title>
    );
  }

  // keep.eu is English-only for titles (107 of 107 sampled projects carry no
  // `bg` translation), so a BG page renders the English one with a marker
  // rather than inventing a translation — the same rule programmeNamesEn.ts
  // records for programme names.
  const title = data.titleBg ?? data.titleEn;
  const foreignTitle = bg && !data.titleBg;

  return (
    <Title description={title}>
      <div className="flex flex-col gap-4 p-4">
        <div>
          <h1 className="text-xl font-bold">{title}</h1>
          {foreignTitle ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {data.titleLang && data.titleLang !== "en"
                ? `Заглавието се публикува от keep.eu само на латиница (${data.titleLang}).`
                : "Заглавието се публикува от keep.eu само на английски."}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground">
            {(bg ? data.programmeBg : data.programmeEn) ?? data.programmeCode}
            {" · "}
            {data.period}
            {data.operationId ? ` · ${data.operationId}` : ""}
            {data.status ? ` · ${data.status}` : ""}
          </p>
        </div>

        <Card>
          <CardContent className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="flex flex-col">
              <span className="text-lg font-bold tabular-nums">
                {data.totalBudgetEur != null
                  ? formatEur(data.totalBudgetEur, lang)
                  : "—"}
              </span>
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {bg ? "целият проект" : "whole project"}
              </span>
            </div>
            {/* Stated beside the total, never instead of it. This is the number
                every other Interreg surface on the site uses. */}
            <div className="flex flex-col">
              <span className="text-lg font-bold tabular-nums">
                {formatEur(data.bgBudgetEur, lang)}
              </span>
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {bg ? "български партньори" : "Bulgarian partners"}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {bg
                  ? `${numFmt.format(data.bgPartnerCount)} от ${numFmt.format(data.partners.length)}`
                  : `${numFmt.format(data.bgPartnerCount)} of ${numFmt.format(data.partners.length)}`}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-lg font-bold tabular-nums">
                {data.euFundingEur != null
                  ? formatEur(data.euFundingEur, lang)
                  : "—"}
              </span>
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {bg ? "средства от ЕС" : "EU funding"}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold tabular-nums">
                {fmtDate(data.startDate, lang)} → {fmtDate(data.endDate, lang)}
              </span>
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {bg ? "период" : "period"}
              </span>
            </div>
          </CardContent>
        </Card>

        {data.summaryEn ? (
          <Card>
            <CardContent className="p-4">
              <p className="text-sm whitespace-pre-line">{data.summaryEn}</p>
              {bg ? (
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Резюмето се публикува от keep.eu само на английски.
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {bg
                ? `Партньорство (${numFmt.format(data.partners.length)}${
                    data.countries?.length
                      ? ` · ${data.countries.join(", ")}`
                      : ""
                  })`
                : `Partnership (${numFmt.format(data.partners.length)}${
                    data.countries?.length
                      ? ` · ${data.countries.join(", ")}`
                      : ""
                  })`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <ul className="divide-y text-sm">
              {data.partners.map((p) => (
                <li key={p.seq} className="flex flex-col gap-0.5 py-2">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="min-w-0 flex-1 font-medium">
                      {/* The registry name is shown, never attributed: an EIK
                          is a link to a company page, a name alone is not. */}
                      {p.eik ? (
                        <Link to={`/company/${p.eik}`} className="underline">
                          {bg ? p.name : (p.nameEn ?? p.name)}
                        </Link>
                      ) : bg ? (
                        p.name
                      ) : (
                        (p.nameEn ?? p.name)
                      )}
                      {p.isLead ? (
                        <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-normal text-primary">
                          {bg ? "водещ" : "lead"}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {/* NULL means the programme published no budget for this
                          partner — distinct from a published €0, which some
                          co-beneficiaries genuinely carry. Never rendered as 0. */}
                      {p.budgetEur != null
                        ? formatEur(p.budgetEur, lang)
                        : bg
                          ? "без публикуван бюджет"
                          : "no published budget"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                    <span>{p.country}</span>
                    {p.orgType ? (
                      <>
                        <span>·</span>
                        <span>{p.orgType}</span>
                      </>
                    ) : null}
                    {p.locationRaw ? (
                      <>
                        <span>·</span>
                        <span>{p.locationRaw}</span>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <p className="text-[10px] text-muted-foreground">
          {bg ? "Източник: " : "Source: "}
          <a
            href={`https://keep.eu/projects/${data.keepId}/`}
            target="_blank"
            rel="noreferrer noopener"
            className="underline"
          >
            keep.eu
          </a>
          {bg
            ? " (INTERACT). Interreg не се управлява през ИСУН, затова тези проекти липсват в останалата част от корпуса с европейски средства."
            : " (INTERACT). Interreg is not run through ИСУН, which is why these projects are absent from the rest of the EU-funds corpus."}
        </p>
      </div>
    </Title>
  );
};
