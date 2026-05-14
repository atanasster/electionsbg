import { FC } from "react";
import { useTranslation } from "react-i18next";
import { CandidateDashboardSummary } from "@/data/dashboard/candidateDashboardTypes";
import { formatThousands, localDate } from "@/data/utils";

type Props = { data: CandidateDashboardSummary };

/** One-line plain-language recap above the candidate dashboard cards. Most
 *  candidate-page traffic arrives from a Google name search — this answers
 *  the headline question (how many preference votes, which election,
 *  strongest where) before the dense tile grid. */
export const CandidateSummaryLine: FC<Props> = ({ data }) => {
  const { t, i18n } = useTranslation();
  const top = data.regions[0];
  if (!top || data.totalVotes <= 0) return null;

  const region =
    i18n.language === "bg"
      ? top.long_name || top.name || top.oblast
      : top.long_name_en || top.name_en || top.oblast;

  return (
    <p className="mb-3 rounded-lg bg-muted/40 px-4 py-2.5 text-[15px] leading-relaxed text-muted-foreground">
      {t("candidate_summary_line", {
        votes: formatThousands(data.totalVotes),
        date: localDate(data.election),
        region,
        regionVotes: formatThousands(top.totalVotes),
      })}
    </p>
  );
};
