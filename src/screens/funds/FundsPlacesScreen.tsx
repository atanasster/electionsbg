// /funds/places — where the money landed.
//
// Absorbs `FundsMuniMapTile` and `GeographyMixTile` off the hub (docs/plans/funds-hub-v1.md §3).
// The map is the single heaviest thing on /funds: Leaflet, a nation-wide GeoJSON and a
// per-municipality payload, all to draw a preview nobody asked for yet.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// THIS PAGE MAPS HALF THE CORPUS, AND IT HAS TO SAY SO. Step 1's measurement:
//
//     3 779 of 82 011 rows (4.6%) carry no oblast          ← sounds like a rounding error
//     those rows hold €22.06 bn — 50.05% of all the money  ← it is half the corpus
//
// The unplaced money is the national-scope programmes — transport corridors, RRF instruments,
// technical assistance — which have no single oblast to sit in. That is a property of the
// money, not a gap in the ingest, so it will not improve with a better parser and the label is
// the whole fix.
//
// Two rules follow, and both are load-bearing:
//   1. A place figure declares MONEY coverage, never ROW coverage. „4.6% от договорите нямат
//      място" is true and misleading; „картата покрива половината от парите" is the fact.
//   2. The map's total and the corpus total are different figures and never sit unlabelled in
//      the same band. Unlabelled side by side they say the map lost half the money.
// ═══════════════════════════════════════════════════════════════════════════════════════════

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, MapPin } from "lucide-react";
import { Title } from "@/ux/Title";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { StatCard } from "@/screens/dashboard/StatCard";
import { useFundsProjectsIndex } from "@/data/funds/useFundsProjectsIndex";
import { useFundsHubStats } from "@/data/funds/useFundsHubStats";
import { FundsMuniMapTile } from "./FundsMuniMapTile";
import { GeographyMixTile } from "./GeographyMixTile";
import { formatEur, formatInt } from "@/lib/currency";

const pctFmt = new Intl.NumberFormat("bg-BG", { maximumFractionDigits: 1 });

export const FundsPlacesScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { data: projectsIndex } = useFundsProjectsIndex();
  const { data: stats } = useFundsHubStats();

  const title = t("funds_places_title") || "По място";
  const description =
    t("funds_places_description") ||
    "Къде са стигнали европейските договори — по община и по област, и защо картата покрива само половината от парите.";

  return (
    <>
      <Title description={description}>{title}</Title>
      <section className="mx-auto w-full px-3 pb-10 sm:px-4">
        <GovernanceBreadcrumb
          sectionKey="funds_index_title"
          sectionTo="/funds"
          currentKey="funds_places_title"
        />

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label={t("funds_places_mapped") || "Разпределено по места"}
            hint={
              t("funds_places_mapped_hint") ||
              "Договорената стойност на проектите, за които ИСУН публикува област. Останалото са национални програми без едно място."
            }
          >
            <div className="flex items-baseline gap-2">
              <MapPin className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="text-2xl font-bold tabular-nums">
                {stats
                  ? formatEur(stats.isun.placedContractedEur, i18n.language)
                  : "—"}
              </span>
            </div>
            {/* THE COVERAGE, AS MONEY. This sub-line is the reason the page is honest: without
                it the map's total reads as the corpus total and half the money has vanished. */}
            {stats ? (
              <div className="text-xs tabular-nums text-muted-foreground">
                {pctFmt.format(stats.isun.placedMoneyPct)}%{" "}
                {t("funds_places_of_corpus") || "от"}{" "}
                {formatEur(stats.isun.contractedEur, i18n.language)}
              </div>
            ) : null}
          </StatCard>
          <StatCard
            label={t("funds_places_oblasti") || "Области"}
            hint={
              t("funds_places_oblasti_hint") ||
              "Всичките 28 области на страната. Столична община се брои като едно място, макар ИСУН да я разделя на четири районни кода."
            }
          >
            <div className="text-2xl font-bold tabular-nums">
              {stats ? formatInt(stats.isun.oblastCount, i18n.language) : "—"}
            </div>
          </StatCard>
          <StatCard
            label={t("funds_places_settlements") || "Населени места"}
            hint={
              t("funds_places_settlements_hint") ||
              "Различни населени места с поне един проект. Не е брой общини."
            }
          >
            <div className="text-2xl font-bold tabular-nums">
              {stats
                ? formatInt(stats.isun.settlementCount, i18n.language)
                : "—"}
            </div>
          </StatCard>
        </div>

        {/* NAMED, not implied. A reader who compares this page's map with the €44 bn on the hub
            deserves the explanation before they conclude the numbers are broken. */}
        <p className="mt-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {t("funds_places_coverage_note") ||
            "Само 4,6% от договорите нямат посочена област — но точно те носят половината пари. Това са националните програми (транспортни коридори, инструменти по Плана за възстановяване, техническа помощ), които не се падат на едно място. Затова сборът на картата е около половината от целия корпус."}
        </p>

        <div className="mt-6">
          <FundsMuniMapTile />
        </div>

        {projectsIndex ? (
          <div className="mt-6">
            <GeographyMixTile index={projectsIndex} />
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
