import { FC } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";

export const PollsMethodologyTile: FC = () => {
  const { t } = useTranslation();
  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4" />
          <span>{t("polls_methodology")}</span>
        </div>
      }
    >
      <div className="text-sm text-muted-foreground space-y-2 normal-case font-normal tracking-normal">
        <p>{t("polls_methodology_intro")}</p>
        <p>{t("polls_methodology_normalization")}</p>
        <p>{t("polls_methodology_genre")}</p>
        <p>{t("polls_methodology_shrunk")}</p>
        <p>{t("polls_methodology_grade")}</p>
        <p className="text-xs">{t("polls_methodology_caveat")}</p>
      </div>
    </StatCard>
  );
};
