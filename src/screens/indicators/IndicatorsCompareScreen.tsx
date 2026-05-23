// /indicators/compare — EU peer comparison dashboard. Bulgaria-anchored,
// pre-loaded with the four CEE/southern peers (RO, GR, HU, HR) and the
// EU27 aggregate. Shipped as a stacked-section dashboard rather than a
// table because the goal is opinionated civic storytelling, not raw data
// browsing: WGI radar lead, snapshot table, COFOG side-by-side, inequality,
// spend → outcome scatters, sources.
//
// Layout copies the homepage shell (no max-w cap) so tiles can use the full
// container width on xl viewports. Peer-selection state lives in the URL
// (?peers=RO,GR …) so the view is shareable.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { useMacroPeers, type PeerGeo } from "@/data/macro/useMacroPeers";
import { PeerSnapshotTable } from "@/screens/components/macro/PeerSnapshotTable";
import { Title } from "@/ux/Title";
import { EuComparePeerStrip } from "@/screens/components/euCompare/EuComparePeerStrip";
import { EuCompareWgiRadar } from "@/screens/components/euCompare/EuCompareWgiRadar";
import { EuCompareCofogMultiples } from "@/screens/components/euCompare/EuCompareCofogMultiples";
import { EuCompareInequalityPanel } from "@/screens/components/euCompare/EuCompareInequalityPanel";
import { EuCompareSpendOutcomeScatters } from "@/screens/components/euCompare/EuCompareSpendOutcomeScatters";
import { EuCompareSourcesStrip } from "@/screens/components/euCompare/EuCompareSourcesStrip";
import { usePeerSelection } from "@/screens/components/euCompare/usePeerSelection";

export const IndicatorsCompareScreen: FC = () => {
  const { t } = useTranslation();
  const { data: peers } = useMacroPeers();
  const { geos } = usePeerSelection();

  const indicatorKeys = peers?.indicators ? Object.keys(peers.indicators) : [];
  const tableGeos: PeerGeo[] = geos;

  return (
    <div className="pb-12">
      <Title description={t("eu_compare_page_description")}>
        {t("eu_compare_page_title")}
      </Title>

      <section className="mb-6">
        <EuComparePeerStrip />
      </section>

      <section className="mb-8" data-og="eu-compare-wgi">
        <h2 className="text-lg font-semibold mb-1">
          {t("eu_compare_section_wgi_title")}
        </h2>
        <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
          {t("eu_compare_section_wgi_explainer")}
        </p>
        <EuCompareWgiRadar />
      </section>

      <section className="mb-8" data-og="eu-compare-snapshot">
        <h2 className="text-lg font-semibold mb-1">
          {t("eu_compare_section_snapshot_title")}
        </h2>
        <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
          {t("eu_compare_section_snapshot_explainer")}
        </p>
        {indicatorKeys.length > 0 ? (
          <PeerSnapshotTable
            rows={indicatorKeys.map((k) => ({ indicatorKey: k }))}
            geos={tableGeos}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("gov_macro_unavailable")}
          </p>
        )}
        <p className="text-[11px] text-muted-foreground mt-3">
          {t("eu_compare_section_snapshot_footnote")}
        </p>
      </section>

      <section className="mb-8" data-og="eu-compare-cofog">
        <h2 className="text-lg font-semibold mb-1">
          {t("eu_compare_section_cofog_title")}
        </h2>
        <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
          {t("eu_compare_section_cofog_explainer")}
        </p>
        <EuCompareCofogMultiples />
      </section>

      <section className="mb-8" data-og="eu-compare-inequality">
        <h2 className="text-lg font-semibold mb-1">
          {t("eu_compare_section_inequality_title")}
        </h2>
        <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
          {t("eu_compare_section_inequality_explainer")}
        </p>
        <EuCompareInequalityPanel />
      </section>

      <section className="mb-8" data-og="eu-compare-scatters">
        <h2 className="text-lg font-semibold mb-1">
          {t("eu_compare_section_scatters_title")}
        </h2>
        <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
          {t("eu_compare_section_scatters_explainer")}
        </p>
        <EuCompareSpendOutcomeScatters />
      </section>

      <section className="mb-2">
        <EuCompareSourcesStrip />
      </section>
    </div>
  );
};
