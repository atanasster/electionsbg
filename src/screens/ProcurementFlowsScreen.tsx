// /procurement/flows — full-page money-flow explorer. Promotes the MP-tied
// awarder → company → MP sankey (also embedded on /procurement) to its own
// navigable page with the threshold slider + legend, so the flow has a
// shareable destination. Per-entity flows live on /awarder/:eik and
// /company/:eik (see EntityFlowTile).

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { Title } from "@/ux/Title";
import { ProcurementNav } from "@/screens/components/procurement/ProcurementNav";
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
      <ProcurementNav />
      <section aria-label="procurement flows" className="my-4">
        <Link
          to="/procurement"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("procurement_back") || "Public procurement"}
        </Link>
        <ProcurementFlowTile />
      </section>
    </>
  );
};
