// Sticky chip row at the top of the EU compare dashboard. BG is the implicit
// anchor; EU27 is rendered as a static "always-on" badge; the four CEE peers
// are toggleable buttons. Selection state lives in the URL via
// usePeerSelection so a link to the dashboard always carries the user's
// peer choices.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Flag } from "./Flag";
import {
  PEER_LABELS_BG,
  PEER_LABELS_EN,
  TOGGLEABLE_PEERS,
  usePeerSelection,
} from "./usePeerSelection";

export const EuComparePeerStrip: FC = () => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { isActive, togglePeer } = usePeerSelection();
  const labels = lang === "bg" ? PEER_LABELS_BG : PEER_LABELS_EN;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {t("eu_compare_peers_label")}
      </span>
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-muted/40 text-[11px] text-foreground">
        <Flag geo="EU27_2020" size={11} title="EU27" />
        {lang === "bg" ? "ЕС-27 (винаги)" : "EU27 (always on)"}
      </span>
      {TOGGLEABLE_PEERS.map((p) => {
        const active = isActive(p);
        return (
          <button
            key={p}
            type="button"
            aria-pressed={active}
            onClick={() => togglePeer(p)}
            className={cn(
              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] transition-colors",
              active
                ? "bg-foreground text-background border-transparent"
                : "bg-background text-muted-foreground border-border hover:bg-accent/10",
            )}
          >
            <Flag geo={p} size={11} title={labels[p]} />
            {labels[p]}
          </button>
        );
      })}
    </div>
  );
};
