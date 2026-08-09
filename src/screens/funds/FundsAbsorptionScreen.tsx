// /funds/absorption — how much of the committed money has actually been paid, and by what route.
//
// Absorbs `AbsorptionByPeriodTile`, `FundsSankeyTile` and `ProjectsStatusMixTile` off the hub
// (docs/plans/funds-hub-v1.md §3). The Sankey in particular is a whole-corpus flow diagram that
// the hub was rendering below eleven screens of scroll.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// „УСВОЯВАНЕ" HAS TWO DENOMINATORS AND THIS IS THE PAGE THAT OWES THE DISTINCTION. Measured in
// step 1:
//
//     53.8%   paid ÷ GRANT        the public money disbursed against the public money committed
//     41.1%   paid ÷ CONTRACTED   the same numerator over contract value, which includes the
//                                 beneficiary's own co-financing
//
// 12.7 points apart, both true, and the word „усвояване" in Bulgarian public debate means the
// first. So the headline is the grant basis and the other is shown beside it rather than left
// for a reader to derive and disagree with. Neither is ever rendered as a bare „усвояване: X%".
// ═══════════════════════════════════════════════════════════════════════════════════════════

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Gauge } from "lucide-react";
import { Title } from "@/ux/Title";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { StatCard } from "@/screens/dashboard/StatCard";
import { useFundsProjectsIndex } from "@/data/funds/useFundsProjectsIndex";
import { useFundsHubStats } from "@/data/funds/useFundsHubStats";
import { AbsorptionByPeriodTile } from "./AbsorptionByPeriodTile";
import { FundsSankeyTile } from "./FundsSankeyTile";
import { ProjectsStatusMixTile } from "./ProjectsStatusMixTile";
import { formatEur } from "@/lib/currency";

const pctFmt = new Intl.NumberFormat("bg-BG", { maximumFractionDigits: 1 });

export const FundsAbsorptionScreen: FC = () => {
  const { t } = useTranslation();
  const { data: projectsIndex } = useFundsProjectsIndex();
  const { data: stats } = useFundsHubStats();

  const title = t("funds_absorption_title") || "Усвояване и движение";
  const description =
    t("funds_absorption_description") ||
    "Колко от договорената помощ е реално изплатена, по програмни периоди, и по какъв път парите стигат до получателя.";

  return (
    <>
      <Title description={description}>{title}</Title>
      <section className="mx-auto w-full px-3 pb-10 sm:px-4">
        <GovernanceBreadcrumb
          sectionKey="funds_index_title"
          sectionTo="/funds"
          currentKey="funds_absorption_title"
        />

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label={t("funds_absorption_of_grant") || "Усвояване"}
            hint={
              t("funds_absorption_of_grant_hint") ||
              "Изплатено спрямо договорената безвъзмездна помощ — това е смисълът, в който се говори за „усвояване“."
            }
          >
            <div className="flex items-baseline gap-2">
              <Gauge className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="text-2xl font-bold tabular-nums">
                {stats
                  ? `${pctFmt.format(stats.isun.absorptionPctOfGrant)}%`
                  : "—"}
              </span>
            </div>
            {stats ? (
              <div className="text-xs tabular-nums text-muted-foreground">
                {formatEur(stats.isun.paidEur)}{" "}
                {t("funds_absorption_of") || "от"}{" "}
                {formatEur(stats.isun.grantEur)}
              </div>
            ) : null}
          </StatCard>
          {/* THE SECOND DENOMINATOR, on its own card rather than buried in a hint. A reader who
              divides the paid total by the contracted total gets 41.1% and would otherwise
              conclude the page's headline is wrong. Both are here, both are labelled.

              THIS ALSO MATTERS FOR THE TILES BELOW, which is where the first draft leaked: the
              cards here are GRANT-basis while `AbsorptionByPeriodTile` and
              `ProjectsStatusMixTile` are CONTRACTED-basis. Unlabelled, the page printed 30% and
              21.1% for the Recovery Plan against an identical €17.74 bn — two numbers for one
              thing, on one screen. Both tiles now name their denominator in their own headings
              rather than relying on this card to imply it. */}
          <StatCard
            label={t("funds_absorption_of_contracted") || "Спрямо договореното"}
            hint={
              t("funds_absorption_of_contracted_hint") ||
              "Същото изплатено, но разделено на цялата договорена стойност — тя включва и собственото съфинансиране на бенефициента, затова делът е по-нисък."
            }
          >
            <div className="text-2xl font-bold tabular-nums">
              {stats
                ? `${pctFmt.format(stats.isun.absorptionPctOfContracted)}%`
                : "—"}
            </div>
            {stats ? (
              <div className="text-xs tabular-nums text-muted-foreground">
                {formatEur(stats.isun.paidEur)}{" "}
                {t("funds_absorption_of") || "от"}{" "}
                {formatEur(stats.isun.contractedEur)}
              </div>
            ) : null}
          </StatCard>
          <StatCard
            label={t("funds_absorption_rrf") || "Планът за възстановяване"}
            hint={
              t("funds_absorption_rrf_hint") ||
              "Усвояване спрямо помощта по ПВУ. Най-новият инструмент, затова и делът е по-нисък от средния за корпуса."
            }
          >
            <div className="text-2xl font-bold tabular-nums">
              {stats
                ? `${pctFmt.format(stats.rrf.absorptionPctOfGrant)}%`
                : "—"}
            </div>
            {stats ? (
              <div className="text-xs tabular-nums text-muted-foreground">
                {formatEur(stats.rrf.contractedEur)}{" "}
                {t("funds_absorption_contracted_word") || "договорени"}
              </div>
            ) : null}
          </StatCard>
        </div>

        <div className="mt-6">
          <AbsorptionByPeriodTile />
        </div>

        <div className="mt-6">
          <FundsSankeyTile />
        </div>

        {projectsIndex ? (
          <div className="mt-6">
            <ProjectsStatusMixTile index={projectsIndex} />
          </div>
        ) : null}

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
