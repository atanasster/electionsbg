// /indicators/society — youth unemployment, house prices, Gini, poverty rate.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useGovernments } from "@/data/governments/useGovernments";
import { useMacro } from "@/data/macro/useMacro";
import { useMacroPeers } from "@/data/macro/useMacroPeers";
import { useCompareToggle } from "@/data/macro/useCompareToggle";
import {
  CabinetStrip,
  GovernmentTimeline,
  type PeerOverlay,
} from "@/screens/components/governments/GovernmentTimeline";
import { xDomainFor } from "@/screens/components/governments/governmentTimelineUtils";
import { PeerSnapshotStrip } from "@/screens/components/macro/PeerSnapshotStrip";
import { CompareToggleButton } from "@/screens/components/macro/CompareToggleButton";
import { IndicatorsNav } from "./indicatorsNav";
import { ChartSources } from "./indicatorsShared";

export const IndicatorsSocietyScreen = () => {
  const { t, i18n } = useTranslation();
  const { data: governments } = useGovernments();
  const { data: macro } = useMacro();
  const { data: peers } = useMacroPeers();
  const [compare, toggleCompare] = useCompareToggle();
  const lang: "en" | "bg" = i18n.language === "bg" ? "bg" : "en";

  const peerOverlay = useMemo<PeerOverlay | undefined>(() => {
    if (!peers?.indicators) return undefined;
    return peers.indicators as PeerOverlay;
  }, [peers]);

  const xDomain = useMemo<[number, number] | null>(
    () => (governments ? xDomainFor(governments) : null),
    [governments],
  );

  if (!governments) {
    return (
      <div className="pb-12">
        <Title>{t("indicators_society_title")}</Title>
      </div>
    );
  }

  return (
    <div className="pb-12">
      <Title description={t("indicators_society_description")}>
        {t("indicators_society_title")}
      </Title>

      <IndicatorsNav />

      <div className="mb-4 flex justify-end">
        <CompareToggleButton enabled={compare} onToggle={toggleCompare} />
      </div>

      {xDomain ? (
        <CabinetStrip
          governments={governments}
          xDomain={xDomain}
          lang={lang}
          mobileScrollable
        />
      ) : null}

      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-3">
          {t("governments_chart_social")}
        </h2>
        <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
          {t("governments_chart_social_explainer")}
        </p>
        <ChartSources
          prefix={t("governments_chart_sources_prefix")}
          sources={[
            {
              href: "https://ec.europa.eu/eurostat/databrowser/view/une_rt_q/default/table",
              label: "Eurostat une_rt_q (youth unemployment, ages 15-24)",
            },
            {
              href: "https://ec.europa.eu/eurostat/databrowser/view/prc_hpi_q/default/table",
              label: "Eurostat prc_hpi_q (house price index, YoY)",
            },
            {
              href: "https://ec.europa.eu/eurostat/databrowser/view/ilc_di12/default/table",
              label: "Eurostat ilc_di12 (Gini coefficient)",
            },
            {
              href: "https://ec.europa.eu/eurostat/databrowser/view/ilc_li02/default/table",
              label: "Eurostat ilc_li02 (at-risk-of-poverty rate)",
            },
          ]}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">
              {macro?.indicators.youthUnemployment &&
                (lang === "bg"
                  ? macro.indicators.youthUnemployment.titleBg
                  : macro.indicators.youthUnemployment.titleEn)}
            </div>
            {compare && <PeerSnapshotStrip indicatorKey="youthUnemployment" />}
            <GovernmentTimeline
              governments={governments}
              macro={macro}
              indicatorKeys={["youthUnemployment"]}
              yAxisFormatter={(v) => `${v}%`}
              unitFormatter={(_k, v) => `${v.toFixed(1)}%`}
              hideToggles
              height={200}
              peerOverlay={peerOverlay}
              peerCompareEnabled={compare}
            />
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">
              {macro?.indicators.housePricesYoY &&
                (lang === "bg"
                  ? macro.indicators.housePricesYoY.titleBg
                  : macro.indicators.housePricesYoY.titleEn)}
            </div>
            {compare && <PeerSnapshotStrip indicatorKey="housePricesYoY" />}
            <GovernmentTimeline
              governments={governments}
              macro={macro}
              indicatorKeys={["housePricesYoY"]}
              yAxisFormatter={(v) => `${v}%`}
              unitFormatter={(_k, v) => `${v.toFixed(1)}%`}
              showZeroLine
              hideToggles
              height={200}
              peerOverlay={peerOverlay}
              peerCompareEnabled={compare}
            />
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">
              {macro?.indicators.gini &&
                (lang === "bg"
                  ? macro.indicators.gini.titleBg
                  : macro.indicators.gini.titleEn)}
            </div>
            <GovernmentTimeline
              governments={governments}
              macro={macro}
              indicatorKeys={["gini"]}
              yAxisFormatter={(v) => v.toFixed(0)}
              unitFormatter={(_k, v) => v.toFixed(1)}
              hideToggles
              height={200}
            />
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">
              {macro?.indicators.povertyRate &&
                (lang === "bg"
                  ? macro.indicators.povertyRate.titleBg
                  : macro.indicators.povertyRate.titleEn)}
            </div>
            <GovernmentTimeline
              governments={governments}
              macro={macro}
              indicatorKeys={["povertyRate"]}
              yAxisFormatter={(v) => `${v}%`}
              unitFormatter={(_k, v) => `${v.toFixed(1)}%`}
              hideToggles
              height={200}
            />
          </div>
        </div>
      </section>
    </div>
  );
};
