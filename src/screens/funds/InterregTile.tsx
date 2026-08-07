// Interreg on /funds — the cross-border corpus ИСУН does not hold, and the
// municipalities it moves once counted.
//
// `fund_projects` contains ZERO Interreg projects. That is a system boundary,
// not a filter: Interreg runs on Jems while the Bulgarian OPs run on ИСУН 2020,
// so no amount of re-querying the ИСУН export would have found them. Because
// Interreg is cross-border by definition, every euro of it lands on a border
// municipality — which is why the site's per-capita ranking understated exactly
// the poorest, most depopulated общини in the country until migration 139.
//
// The tile therefore does two things, and the second is the point: it states the
// corpus, and it shows WHO MOVED. A total nobody can locate is a statistic; a
// municipality that climbs 43 places is the finding.
//
// Both figures come from live aggregates over the fact tables (137/138/139),
// never from fund_payloads — an `interreg-*` kind written there would be
// silently deleted by the next db:load:funds:pg.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/ux/Card";
import { formatEur, formatEurCompact } from "@/lib/currency";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import {
  useInterregOverview,
  useFundsMuniRank,
} from "@/data/funds/useInterreg";

const numFmt = new Intl.NumberFormat("bg-BG");
const MOVERS_SHOWN = 10;
const PROGRAMMES_SHOWN = 6;

const Stat: FC<{ label: string; value: string; hint?: string }> = ({
  label,
  value,
  hint,
}) => (
  <div className="flex flex-col">
    <span className="text-lg font-bold tabular-nums leading-tight">
      {value}
    </span>
    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
      {label}
    </span>
    {hint ? (
      <span className="text-[10px] text-muted-foreground">{hint}</span>
    ) : null}
  </div>
);

export const InterregTile: FC = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const bg = lang === "bg";
  const { data: overview } = useInterregOverview();
  // 300, not 10: the server orders by RANK while the tile ranks by rankDelta,
  // so a smaller limit returns the wrong ten climbers. ~40 KB for 256 rows.
  const { data: ranking } = useFundsMuniRank(300);
  const { findMunicipality } = useMunicipalities();

  if (!overview || overview.partnerCount === 0) return null;

  // The biggest climbers, which is what the tile exists to show. Sorted on
  // rankDelta rather than on money: a large municipality can take more euros and
  // barely move, while a village of 3,000 moves 40 places on a single project —
  // and it is the second that the ИСУН-only ranking was getting wrong.
  const movers = (ranking?.munis ?? [])
    .filter((m) => m.rankDelta > 0)
    .sort((a, b) => b.rankDelta - a.rankDelta || b.interregEur - a.interregEur)
    .slice(0, MOVERS_SHOWN);

  // Everything the ranking cannot see, on the INTERREG arm. `ranked` is the
  // covered bucket, so it is not an exclusion — the other two are. The ИСУН
  // exclusion is a separate and far larger number (€6.56bn, mostly Sofia) and
  // comes from the payload: printing only this one beside a sentence naming both
  // sources would say €95m is missing from a ranking missing €6.6bn.
  const excludedEur = Object.entries(ranking?.excluded ?? {})
    .filter(([reason]) => reason !== "ranked")
    .reduce((a, [, v]) => a + v.eur, 0);

  const p2127 = overview.periods["2021-2027"];
  const p1420 = overview.periods["2014-2020"];

  return (
    <Card>
      <CardContent className="p-4 flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold">{t("interreg_title")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("interreg_intro")}
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat
            label={t("interreg_stat_budget")}
            value={formatEurCompact(overview.budgetEur, lang)}
          />
          <Stat
            label={t("interreg_stat_operations")}
            value={numFmt.format(overview.operationCount)}
          />
          <Stat
            label={t("interreg_stat_partners")}
            value={numFmt.format(overview.partnerCount)}
            // `placed`, not `count`: i18next reserves `count` for plural
            // selection and types it as a number, so a pre-formatted string
            // there is a type error rather than a label.
            hint={t("interreg_placed_hint", {
              placed: numFmt.format(overview.placedCount),
            })}
          />
          <Stat
            label={t("interreg_stat_programmes")}
            value={numFmt.format(overview.programmeCount)}
          />
        </div>

        {/* The period split is a caveat, not a detail: keep.eu's national-id
            field exists only in the 2021-2027 template, so the older and larger
            half of this money can be attributed to a PLACE but never to a
            company. Saying so here is cheaper than every downstream surface
            having to discover it. */}
        {p1420 && p2127 ? (
          <p className="text-[11px] text-muted-foreground">
            {t("interreg_periods", {
              older: formatEur(p1420.budgetEur, lang),
              newer: formatEur(p2127.budgetEur, lang),
              linked: numFmt.format(p2127.linkedCount),
              rows: numFmt.format(p2127.partnerCount),
            })}
          </p>
        ) : null}

        {movers.length > 0 && ranking ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold">
              {t("interreg_movers_title", {
                moved: numFmt.format(ranking.movedCount),
                cohort: numFmt.format(ranking.cohortSize),
              })}
            </h3>
            <ul className="divide-y text-xs">
              {movers.map((m) => {
                const muni = findMunicipality(m.obshtina);
                return (
                  <li
                    key={m.obshtina}
                    className="flex flex-wrap items-baseline gap-x-3 py-1.5"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {(bg ? muni?.name : muni?.name_en) ?? m.obshtina}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatEurCompact(m.interregEur, lang)}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {m.rankBefore} → {m.rank}
                    </span>
                    <span className="w-10 text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                      +{m.rankDelta}
                    </span>
                  </li>
                );
              })}
            </ul>
            {/* WHAT THE RANKING DOES NOT COVER. Столична община's €88.7m is the
                bulk of it: Sofia has no per-capita figure on EITHER arm, because
                ГРАО carries no Sofia city EKATTE. Without this line the table
                above reads as national coverage it does not have. */}
            {excludedEur > 0 ? (
              <p className="text-[10px] text-muted-foreground">
                {t("interreg_excluded", {
                  cohort: numFmt.format(ranking.cohortSize),
                  interreg: formatEur(excludedEur, lang),
                  isun: formatEur(ranking.excludedIsunEur, lang),
                })}
              </p>
            ) : null}
          </div>
        ) : null}

        {overview.programmes.length > 0 ? (
          <div className="flex flex-col gap-1">
            <h3 className="text-xs font-semibold">
              {t("interreg_by_programme", {
                shown: Math.min(PROGRAMMES_SHOWN, overview.programmes.length),
                total: overview.programmeCount,
              })}
            </h3>
            <ul className="divide-y text-xs">
              {overview.programmes.slice(0, PROGRAMMES_SHOWN).map((p) => (
                <li
                  key={p.code}
                  className="flex flex-wrap items-baseline gap-x-3 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {(bg ? p.nameBg : p.nameEn) ?? p.code}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {p.period}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {numFmt.format(p.operationCount)}
                  </span>
                  <span className="tabular-nums font-medium">
                    {formatEurCompact(p.budgetEur, lang)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="text-[10px] text-muted-foreground">
          <a
            href="https://keep.eu/"
            target="_blank"
            rel="noreferrer noopener"
            className="underline"
          >
            keep.eu
          </a>{" "}
          {t("interreg_source")}
        </p>
      </CardContent>
    </Card>
  );
};
