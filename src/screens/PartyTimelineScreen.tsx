import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useElectionContext } from "@/data/ElectionContext";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { BubbleTimeline } from "./timeline/BubbleTimeline";

export const PartyTimelineScreen = () => {
  const { t } = useTranslation();
  const { stats } = useElectionContext();
  const { colorFor, canonicalIdFor } = useCanonicalParties();

  return (
    <div className="w-full max-w-6xl mx-auto px-4 pb-12">
      <Title description={t("timeline_description")}>
        {t("timeline_title")}
      </Title>
      <p className="text-sm text-muted-foreground mb-6 max-w-3xl">
        {t("timeline_explainer")}
      </p>
      <BubbleTimeline
        stats={stats}
        colorFor={colorFor}
        lineageFor={canonicalIdFor}
      />
      <p className="text-xs text-muted-foreground mt-4">
        {t("timeline_legend_hint")}
      </p>
    </div>
  );
};
