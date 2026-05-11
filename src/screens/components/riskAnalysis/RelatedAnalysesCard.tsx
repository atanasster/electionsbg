import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUpRight,
  Building2,
  Cpu,
  MapPin,
  ShieldAlert,
  Sigma,
  Vote,
} from "lucide-react";
import { Link } from "@/ux/Link";
import { StatCard } from "@/screens/dashboard/StatCard";

type Item = {
  to: string;
  Icon: typeof ShieldAlert;
  titleKey: string;
  descKey: string;
};

const ITEMS: Item[] = [
  {
    to: "/risk-score",
    Icon: ShieldAlert,
    titleKey: "risk_analysis_link_risk_score_title",
    descKey: "risk_analysis_link_risk_score_desc",
  },
  {
    to: "/benford",
    Icon: Sigma,
    titleKey: "risk_analysis_link_benford_title",
    descKey: "risk_analysis_link_benford_desc",
  },
  {
    to: "/flash-memory",
    Icon: Cpu,
    titleKey: "risk_analysis_link_flash_title",
    descKey: "risk_analysis_link_flash_desc",
  },
  {
    to: "/reports/settlement/concentrated",
    Icon: MapPin,
    titleKey: "risk_analysis_link_concentrated_title",
    descKey: "risk_analysis_link_concentrated_desc",
  },
  {
    to: "/reports/section/problem_sections",
    Icon: Building2,
    titleKey: "risk_analysis_link_problem_sections_title",
    descKey: "risk_analysis_link_problem_sections_desc",
  },
  {
    to: "/reports/settlement/additional_voters",
    Icon: Vote,
    titleKey: "risk_analysis_link_additional_voters_title",
    descKey: "risk_analysis_link_additional_voters_desc",
  },
];

export const RelatedAnalysesCard: FC = () => {
  const { t } = useTranslation();
  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <span>{t("risk_analysis_related_title")}</span>
        </div>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-1">
        {ITEMS.map(({ to, Icon, titleKey, descKey }) => (
          <Link
            key={to}
            to={to}
            underline={false}
            className="block rounded-lg border bg-background hover:bg-muted/40 p-3 transition-colors group"
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span>{t(titleKey)}</span>
              </div>
              <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t(descKey)}
            </p>
          </Link>
        ))}
      </div>
    </StatCard>
  );
};
