import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useElectionContext } from "@/data/ElectionContext";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { BubbleTimeline } from "./timeline/BubbleTimeline";
import { useConsolidatedLabel } from "./components/useConsolidatedLabel";

export const PartyTimelineScreen = () => {
  const { t } = useTranslation();
  const { stats } = useElectionContext();
  const { colorFor, canonicalIdFor, fullNameFor, displayNameFor } =
    useCanonicalParties();
  const { isConsolidated, consolidated } = useConsolidatedLabel();

  return (
    <div className="w-full max-w-6xl mx-auto px-4 pb-12">
      <Title description={t("timeline_description")}>
        {t("timeline_title")}
      </Title>
      <p className="text-sm text-muted-foreground mb-6 max-w-3xl">
        {t("timeline_explainer")}
      </p>
      <div className="flex justify-end">{consolidated}</div>
      <BubbleTimeline
        stats={stats}
        colorFor={colorFor}
        lineageFor={canonicalIdFor}
        fullNameFor={fullNameFor}
        displayNameFor={displayNameFor}
        consolidated={isConsolidated}
      />
      <p className="text-xs text-muted-foreground mt-4">
        {t("timeline_legend_hint")}
      </p>
    </div>
  );
};
