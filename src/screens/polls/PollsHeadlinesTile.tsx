import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Newspaper, Sparkles } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";
import { ElectionNarrative } from "@/data/polls/pollsTypes";

type Props = {
  narrative: ElectionNarrative;
  electionLabel: string; // e.g. "19/04/2026" — appended to titles so it's clear which election
  model: string;
};

export const PollsHeadlinesTile: FC<Props> = ({
  narrative,
  electionLabel,
  model,
}) => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const headlines = isBg ? narrative.headlines.bg : narrative.headlines.en;
  const story = isBg ? narrative.story.bg : narrative.story.en;

  return (
    <div className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <StatCard
        label={
          <div className="flex items-center gap-2">
            <Newspaper className="h-4 w-4" />
            <span>
              {t("polls_headlines")} — {electionLabel}
            </span>
          </div>
        }
      >
        <ul className="flex flex-col gap-2 mt-1 text-sm leading-relaxed">
          {headlines.map((h, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-primary mt-1 shrink-0">•</span>
              <span>{h}</span>
            </li>
          ))}
        </ul>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-3 flex items-center gap-1">
          <Sparkles className="h-3 w-3" />
          {t("polls_editorial_by")} · {model}
        </div>
      </StatCard>
      <StatCard
        label={
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            <span>
              {t("polls_story")} — {electionLabel}
            </span>
          </div>
        }
      >
        <p className="text-sm leading-relaxed mt-1">{story}</p>
      </StatCard>
    </div>
  );
};
