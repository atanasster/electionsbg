// Region (oblast) Governance dashboard body — the "programmes filtered by
// region, minus local governance" cut. An oblast has no elected council, so
// none of the município node's mayor/council/kmetstvo/LISI/local-tax tiles
// have an equivalent here; what remains is:
//   - Representation: the oblast's MPs + their declarations
//   - Programmes & funding: Чл.53 transfers, registered-unemployment / matura
//     indicators, census, and the per-oblast property/land-use composition
//
// All tiles are oblast-keyed and self-hide without data. МИР 32 (abroad) has
// no municipalities/census/property, so those tiles drop out for it.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Briefcase, Landmark, ShoppingBasket, Wallet } from "lucide-react";
import { useRegionSummary } from "@/data/dashboard/useRegionSummary";
import { useRegionDeclarationsHasContent } from "@/data/parliament/useMpDeclarationsAvailability";
import { isDiasporaRegion } from "@/data/diaspora/diasporaFaq";
import { SOFIA_REGIONS } from "@/data/dataTypes";
import { DashboardSection } from "./DashboardSection";
import { RegionMpsTile } from "./RegionMpsTile";
import { MpConnectionsTile } from "./MpConnectionsTile";
import { CarMakesTile } from "./CarMakesTile";
import { MpAssetsTile } from "./MpAssetsTile";
import { MpDeclarationsProvenance } from "./MpDeclarationsProvenance";
import { RegionalIndicatorsTile } from "./RegionalIndicatorsTile";
import { MunicipalTransfersTile } from "./MunicipalTransfersTile";
import { CensusDemographicsTile } from "./CensusDemographicsTile";
import { MyAreaPropertyStockTile } from "@/screens/myarea/MyAreaPropertyStockTile";
import { GovernancePricesTile } from "@/screens/governance/GovernancePricesTile";

type Props = {
  regionCode: string;
};

export const RegionGovernanceCards: FC<Props> = ({ regionCode }) => {
  const { t } = useTranslation();
  const diaspora = isDiasporaRegion(regionCode);
  const { data } = useRegionSummary(regionCode);
  const declarationsHaveContent = useRegionDeclarationsHasContent({
    regionCode,
  });

  return (
    <section aria-label={t("governance_dashboard") || "Governance"}>
      <DashboardSection
        id="parliament"
        title={t("governance_region_representation") || "Representation"}
        icon={Landmark}
      >
        {data?.parties ? (
          <RegionMpsTile regionCode={regionCode} parties={data.parties} />
        ) : null}
      </DashboardSection>

      {diaspora ? null : (
        <DashboardSection
          id="prices"
          title={t("governance_section_prices") || "Цени / Prices"}
          icon={ShoppingBasket}
        >
          <GovernancePricesTile oblast={regionCode} showConsumptionLink />
        </DashboardSection>
      )}

      {diaspora ? null : (
        <DashboardSection
          id="geography"
          title={t("governance_region_programmes") || "Programmes & funding"}
          icon={Wallet}
        >
          <MunicipalTransfersTile regionCode={regionCode} />
          <RegionalIndicatorsTile regionCode={regionCode} />
          <div className="grid gap-3 grid-cols-1 lg:grid-cols-2 [&>*:only-child]:lg:col-span-2">
            {/* Census is published at city level, not per Sofia МИР, so the
                three Sofia electoral districts would share identical numbers —
                omit it there (the Sofia city node renders it for the whole
                city). */}
            {SOFIA_REGIONS.includes(regionCode) ? null : (
              <CensusDemographicsTile regionCode={regionCode} />
            )}
            <MyAreaPropertyStockTile oblast={regionCode} />
          </div>
        </DashboardSection>
      )}

      {declarationsHaveContent ? (
        <DashboardSection
          id="declarations"
          title={t("dashboard_section_declarations")}
          subtitle={<MpDeclarationsProvenance regionCode={regionCode} />}
          icon={Briefcase}
        >
          <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
            <MpConnectionsTile regionCode={regionCode} />
            <CarMakesTile regionCode={regionCode} hideProvenance />
          </div>
          <MpAssetsTile regionCode={regionCode} />
        </DashboardSection>
      ) : null}
    </section>
  );
};
