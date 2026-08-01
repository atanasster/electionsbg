// The procurement portfolio cuts on the resolved-person dashboard (/person/:slug and, via
// PersonDashboard, /candidate/:id) — the slug-keyed counterpart of the two tiles the legacy
// PersonScreen shows. Renders the by-company / by-settlement breakdowns (migration 125) plus a
// link to the standalone /person/:slug/contracts browser. Self-hides when the person has no
// procurement, so PersonDashboard can mount it unconditionally under its procuredEur gate.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Building2, MapPin, Receipt } from "lucide-react";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import {
  PersonProcurementBreakdownTile,
  type PersonBreakdownRow,
} from "@/screens/components/procurement/PersonProcurementBreakdownTile";
import { usePersonBreakdowns } from "./usePersonBreakdowns";

export const PersonProcurementSection: FC<{ slug: string }> = ({ slug }) => {
  const { t } = useTranslation();
  const data = usePersonBreakdowns(slug);

  // Self-hide: undefined = loading, or a person with no contract-winning firms.
  if (!data || data.byCompany.length === 0) return null;

  const companyRows: PersonBreakdownRow[] = data.byCompany.map((c) => ({
    id: c.eik,
    label: c.name ?? c.eik,
    href: `/company/${c.eik}`,
    totalEur: c.totalEur,
    contractCount: c.contractCount,
  }));
  const settlementRows: PersonBreakdownRow[] = data.bySettlement.map((s) => ({
    // by_settlement GROUPs BY ekatte, so there is at most ONE null-ekatte (national) row —
    // the constant "national" key cannot collide.
    id: s.ekatte ?? "national",
    label:
      s.settlement ?? (t("pp_national_buyers") || "Национални възложители"),
    href: s.ekatte ? `/procurement/settlement/${s.ekatte}` : null,
    totalEur: s.totalEur,
    contractCount: s.contractCount,
  }));

  return (
    <DashboardSection
      id="person-procurement"
      title={t("pp_proc_all_contracts") || "Обществени поръчки"}
      icon={Receipt}
      subtitle={t("pp_proc_all_contracts_hint")}
    >
      <div className="mb-3">
        <Link
          to={`/person/${encodeURIComponent(slug)}/contracts`}
          className="text-xs text-primary hover:underline"
        >
          {t("procurement_tile_see_all") || "Виж всички"} →
        </Link>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <PersonProcurementBreakdownTile
          title={t("pp_by_company") || "По фирма"}
          icon={Building2}
          rows={companyRows}
        />
        <PersonProcurementBreakdownTile
          title={t("pp_by_settlement") || "По населено място"}
          icon={MapPin}
          rows={settlementRows}
        />
      </div>
    </DashboardSection>
  );
};
