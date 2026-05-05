import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { localDate } from "@/data/utils";
import { useElectionContext } from "@/data/ElectionContext";
import { useResolvedCandidateName } from "@/data/candidates/useResolvedCandidate";
import { ErrorSection } from "./components/ErrorSection";
import { CandidateDonationsTable } from "./components/candidates/CandidateDonationsTable";

export const CandidateDonationsScreen: FC = () => {
  const { id } = useParams();
  const { selected, electionStats } = useElectionContext();
  const { t } = useTranslation();
  const { name: resolved } = useResolvedCandidateName(id);
  if (!id) return null;
  const name =
    resolved ?? (id.startsWith("mp-") || id.startsWith("c-") ? null : id);
  if (!name) return null;
  if (!electionStats?.hasFinancials) {
    return (
      <ErrorSection
        title={name}
        description={`${t("no_financing_data")} ${localDate(selected)}`}
      />
    );
  }
  return (
    <>
      <Title
        description={t("donations")}
        title={`${name} — ${t("donations")}`}
        className="text-base md:text-xl lg:text-2xl py-4 md:py-6"
      >
        <>
          {name}
          <br />
          {t("donations")}
        </>
      </Title>
      <div className="w-full max-w-7xl mx-auto px-4 pb-12">
        <CandidateDonationsTable name={name} />
      </div>
    </>
  );
};
