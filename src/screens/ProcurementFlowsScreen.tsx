// /procurement/flows — full-page money-flow explorer. Promotes the MP-tied
// awarder → company → MP sankey (also embedded on /procurement) to its own
// navigable page with the threshold slider + legend, so the flow has a
// shareable destination. Per-entity flows live on /awarder/:eik and
// /company/:eik (see EntityFlowTile).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { ProcurementSectionHeader } from "@/screens/components/procurement/ProcurementSectionHeader";
import { ProcurementFlowTile } from "./components/procurement/ProcurementFlowTile";

export const ProcurementFlowsScreen: FC = () => {
  const { t } = useTranslation();
  return (
    <>
      <Title
        description={
          t("procurement_flows_desc") ||
          "How public money flows from contracting authorities to companies tied to members of parliament."
        }
      >
        {t("procurement_flows_title") || "Procurement money flow"}
      </Title>
      <ProcurementSectionHeader scopeMode="toggle" />
      <section aria-label="procurement flows" className="my-4">
        <ProcurementFlowTile />
      </section>
    </>
  );
};
