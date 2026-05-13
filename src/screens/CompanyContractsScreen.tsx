// /company/:eik/contracts — standalone full contracts list with pageable
// DataTable. Replaces the inline contracts tile on the company dashboard
// (now a tile teaser at /company/:eik).

import { FC } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Receipt } from "lucide-react";
import { Title } from "@/ux/Title";
import { useContractor } from "@/data/procurement/useContractor";
import { CompanyContractsTile } from "./components/procurement/CompanyContractsTile";
import { ErrorSection } from "./components/ErrorSection";

export const CompanyContractsScreen: FC = () => {
  const { eik } = useParams<{ eik: string }>();
  const { t } = useTranslation();
  const { data, isLoading } = useContractor(eik);

  if (isLoading) {
    return (
      <>
        <Title>{t("company_loading_title") || "Company"}</Title>
        <section aria-label="contracts" className="my-4">
          <div className="min-h-[600px]" aria-hidden />
        </section>
      </>
    );
  }
  if (!data) {
    return (
      <ErrorSection
        title={t("company_not_found_title") || "Company not found"}
        description={t("company_not_found_desc") || ""}
      />
    );
  }

  return (
    <>
      <Title description={`Public-procurement contracts of ${data.name}`}>
        {data.name}
      </Title>
      <section aria-label={data.name} className="my-4">
        <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
          <Receipt className="h-4 w-4" />
          <Link to={`/company/${data.eik}`} className="hover:underline">
            EIK {data.eik}
          </Link>
          <span>· {t("company_contracts_title") || "Contracts"}</span>
        </div>
        <CompanyContractsTile eik={data.eik} />
      </section>
    </>
  );
};
