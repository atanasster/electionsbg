// /awarder/:eik/contracts — standalone full contracts list with pageable
// DataTable. Replaces the inline contracts tile on the awarder dashboard.

import { FC } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Receipt } from "lucide-react";
import { Title } from "@/ux/Title";
import { useAwarder } from "@/data/procurement/useAwarder";
import { AwarderContractsTile } from "./components/procurement/AwarderContractsTile";
import { ErrorSection } from "./components/ErrorSection";

export const AwarderContractsScreen: FC = () => {
  const { eik } = useParams<{ eik: string }>();
  const { t } = useTranslation();
  const { data, isLoading } = useAwarder(eik);

  if (isLoading) {
    return (
      <>
        <Title>{t("awarder_loading_title") || "Awarder"}</Title>
        <section aria-label="contracts" className="my-4">
          <div className="min-h-[600px]" aria-hidden />
        </section>
      </>
    );
  }
  if (!data) {
    return (
      <ErrorSection
        title={t("awarder_not_found_title") || "Awarder not found"}
        description={t("awarder_not_found_desc") || ""}
      />
    );
  }

  return (
    <>
      <Title description={`Contracts awarded by ${data.name}`}>
        {data.name}
      </Title>
      <section aria-label={data.name} className="my-4">
        <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
          <Receipt className="h-4 w-4" />
          <Link to={`/awarder/${data.eik}`} className="hover:underline">
            EIK {data.eik}
          </Link>
          <span>· {t("company_contracts_title") || "Contracts"}</span>
        </div>
        <AwarderContractsTile eik={data.eik} />
      </section>
    </>
  );
};
