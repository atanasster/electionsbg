import { FC } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";

const GRADE_THRESHOLDS: { grade: string; bound: string }[] = [
  { grade: "A+", bound: "< 1.6" },
  { grade: "A", bound: "< 1.9" },
  { grade: "B+", bound: "< 2.2" },
  { grade: "B", bound: "< 2.5" },
  { grade: "C+", bound: "< 2.9" },
  { grade: "C", bound: "< 3.3" },
  { grade: "D", bound: "< 3.8" },
  { grade: "F", bound: "≥ 3.8" },
];

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
      <div className="text-sm text-muted-foreground space-y-4 normal-case font-normal tracking-normal">
        <p>{t("polls_methodology_intro")}</p>

        <section className="space-y-2">
          <h4 className="text-foreground font-semibold text-[13px]">
            {t("polls_methodology_section1_title")}
          </h4>
          <p>{t("polls_methodology_section1_body")}</p>
          <div className="font-mono text-xs px-3 py-2 bg-muted/40 border border-border rounded">
            {t("polls_methodology_section1_formula")}
          </div>
          <ul className="list-disc pl-5 space-y-1">
            <li>{t("polls_methodology_section1_icon_note")}</li>
            <li>{t("polls_methodology_section1_genre_note")}</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h4 className="text-foreground font-semibold text-[13px]">
            {t("polls_methodology_section2_title")}
          </h4>
          <p>{t("polls_methodology_section2_body")}</p>
          <div className="font-mono text-xs px-3 py-2 bg-muted/40 border border-border rounded">
            {t("polls_methodology_section2_formula")}
          </div>
          <ul className="list-disc pl-5">
            <li>{t("polls_methodology_section2_logic_note")}</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h4 className="text-foreground font-semibold text-[13px]">
            {t("polls_methodology_section3_title")}
          </h4>
          <p>{t("polls_methodology_section3_body")}</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>{t("polls_methodology_section3_signal1")}</li>
            <li>{t("polls_methodology_section3_signal2")}</li>
            <li>{t("polls_methodology_section3_signal3")}</li>
          </ol>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs tabular-nums pt-1 max-w-md">
            {GRADE_THRESHOLDS.map((row) => (
              <div key={row.grade} className="flex items-baseline gap-2">
                <span className="font-semibold text-foreground min-w-[1.75rem]">
                  {row.grade}
                </span>
                <span>{row.bound}</span>
              </div>
            ))}
          </div>
        </section>

        <p className="text-xs border-l-2 border-amber-500/60 pl-3 italic">
          {t("polls_methodology_caveat")}
        </p>
      </div>
    </StatCard>
  );
};
