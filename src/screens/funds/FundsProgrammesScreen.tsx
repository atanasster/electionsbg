// /funds/programmes — the programme index, and the PICKER for /funds/programme/:code.
//
// Two jobs, and the second is the reason it exists at all. The dashboard-hub skill §4 is
// explicit that a tile pointing at `/x/:id` is a smell: it needs a seed the generator chooses,
// so the reader lands on somebody else's subject with no way to reach their own, and the tile
// omits itself entirely whenever no seed is produced. `/funds/programme/:code` had no landing
// page beside it — this is it.
//
// It is also where `MySectorTile` on the hub's „За теб" band sends „всички програми". That link
// previously pointed at a `#programs` anchor on /funds, which is exactly the kind of
// same-page-fragment destination that stops working the moment the section moves.

import { type FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ExternalLink, Layers } from "lucide-react";
import { Title } from "@/ux/Title";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { StatCard } from "@/screens/dashboard/StatCard";
import { Card, CardContent } from "@/ux/Card";
import { useFundsProjectsIndex } from "@/data/funds/useFundsProjectsIndex";
import { useFundsHubStats } from "@/data/funds/useFundsHubStats";
import { formatEur, formatInt } from "@/lib/currency";

const pctFmt = new Intl.NumberFormat("bg-BG", { maximumFractionDigits: 1 });

export const FundsProgrammesScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { data: index, isLoading } = useFundsProjectsIndex();
  const { data: stats } = useFundsHubStats();

  const title = t("funds_programmes_title") || "Програми";
  const description =
    t("funds_programmes_description") ||
    "Оперативните програми в ИСУН 2020 — по колко е договорено и колко е изплатено по всяка.";

  // EVERY programme, ordered by money. Not a top-N: this is the picker, and a reader looking
  // for the one programme that funds their kind of work must be able to find it here. The
  // corpus has 47, which is a list, not a table.
  const rows = index?.byProgram ?? [];

  return (
    <>
      <Title description={description}>{title}</Title>
      <section className="mx-auto w-full px-3 pb-10 sm:px-4">
        <GovernanceBreadcrumb
          sectionKey="funds_index_title"
          sectionTo="/funds"
          currentKey="funds_programmes_title"
        />

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label={t("funds_programmes_count") || "Програми"}
            hint={
              t("funds_programmes_count_hint") ||
              "Различни програмни кодове в корпуса — включва ОП 2014-2020 и 2021-2027, ПВУ, ЕИП/Норвегия и няколко национални фонда."
            }
          >
            <div className="flex items-baseline gap-2">
              <Layers className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="text-2xl font-bold tabular-nums">
                {stats
                  ? formatInt(stats.isun.programmeCount, i18n.language)
                  : "—"}
              </span>
            </div>
          </StatCard>
          <StatCard
            label={t("funds_programmes_absorption") || "Усвояване"}
            /* The DENOMINATOR is in the hint, because the other answer is 41.1% and both are
               true sentences about the same corpus. Step 1 measured the fork. */
            hint={
              t("funds_programmes_absorption_hint") ||
              "Изплатено спрямо договорената безвъзмездна помощ. Спрямо цялата договорена стойност (със съфинансирането) делът е по-нисък."
            }
          >
            <div className="text-2xl font-bold tabular-nums">
              {stats
                ? `${pctFmt.format(stats.isun.absorptionPctOfGrant)}%`
                : "—"}
            </div>
            {stats ? (
              <div className="text-xs tabular-nums text-muted-foreground">
                {formatEur(stats.isun.paidEur, i18n.language)}{" "}
                {t("funds_programmes_of") || "от"}{" "}
                {formatEur(stats.isun.grantEur, i18n.language)}
              </div>
            ) : null}
          </StatCard>
          <StatCard
            label={t("funds_programmes_rrf") || "От тях ПВУ"}
            hint={
              t("funds_programmes_rrf_hint") ||
              "Планът за възстановяване и устойчивост — най-новият инструмент, затова и усвояването по него е по-ниско."
            }
          >
            <div className="text-2xl font-bold tabular-nums">
              {stats ? formatEur(stats.rrf.contractedEur, i18n.language) : "—"}
            </div>
            {stats ? (
              <div className="text-xs tabular-nums text-muted-foreground">
                {pctFmt.format(stats.rrf.absorptionPctOfGrant)}%{" "}
                {t("funds_programmes_absorbed") || "усвоени от помощта"}
              </div>
            ) : null}
          </StatCard>
        </div>

        <h2 className="mt-8 text-lg font-semibold">
          {t("funds_programmes_all") || "Всички програми"}
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {t("funds_programmes_all_hint") ||
            "Подредени по договорена стойност. Изберете програма, за да видите нейните процедури и договори."}
        </p>

        {isLoading ? (
          <div className="h-96 animate-pulse rounded-xl border bg-card" />
        ) : rows.length ? (
          <Card>
            <CardContent className="p-3 text-sm md:p-4">
              <ul className="flex flex-col divide-y divide-border">
                {rows.map((p) => (
                  <li
                    key={p.programCode}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
                  >
                    <Link
                      to={`/funds/programme/${encodeURIComponent(p.programCode)}`}
                      className="line-clamp-2 min-w-0 flex-1 font-medium hover:underline"
                      title={p.programName}
                    >
                      {p.programName}
                    </Link>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {p.programCode}
                    </span>
                    <span className="ml-auto shrink-0 text-sm font-medium tabular-nums">
                      {formatEur(p.rollup.totalEur, i18n.language)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("funds_programmes_empty") || "Няма заредени програми."}
          </p>
        )}

        <p className="mt-4 text-[11px] text-muted-foreground/80">
          {t("funds_index_source_hint") ||
            "Източник: публичният регистър на бенефициентите в ИСУН 2020."}{" "}
          <a
            href="https://2020.eufunds.bg/bg/0/0/Beneficiary"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-primary hover:underline"
          >
            2020.eufunds.bg <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </section>
    </>
  );
};
