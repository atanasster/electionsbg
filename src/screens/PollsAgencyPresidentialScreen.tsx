import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAgencies } from "@/data/polls/usePolls";
import { Title } from "@/ux/Title";
import { PresidentialHistory } from "./polls/PresidentialHistory";

export function PollsAgencyPresidentialScreen() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const { t, i18n } = useTranslation();
  const agencies = useAgencies();
  const agency = agencies.data?.find((a) => a.id === agencyId);
  const name = agency
    ? i18n.language === "bg"
      ? agency.name_bg
      : agency.name_en
    : agencyId;
  return (
    <div className="space-y-4 my-4">
      <Link className="text-primary underline" to={`/polls/${agencyId}`}>
        {t("pp_history_agency_overview")}
      </Link>
      <Title
        title={`${name} · ${t("polls_presidential_polls")}`}
        description={t("pp_history_chart_hint")}
      >
        {name} · {t("polls_presidential_polls")}
      </Title>
      <PresidentialHistory agencyId={agencyId} />
    </div>
  );
}
