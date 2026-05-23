// Sources attribution + last-fetched timestamps for the EU compare
// dashboard. Lists the underlying public datasets so a reader can pull
// the same numbers themselves, and notes the one synthesized aggregate
// (EU27 WGI mean — World Bank does not publish a regional aggregate).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { useCofog } from "@/data/macro/useCofog";
import { useMacroPeers } from "@/data/macro/useMacroPeers";

const fmtDate = (iso: string | undefined, lang: "bg" | "en"): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return iso;
  return d.toLocaleDateString(lang === "bg" ? "bg-BG" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

export const EuCompareSourcesStrip: FC = () => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { data: peers } = useMacroPeers();
  const { data: cofog } = useCofog();
  const peersFetched = fmtDate(peers?.fetchedAt, lang);
  const cofogFetched = fmtDate(cofog?.fetchedAt, lang);
  const wgiFetched = fmtDate(peers?.wgi?.fetchedAt, lang);
  return (
    <div className="rounded border border-border/40 bg-muted/10 p-3 text-[11px] text-muted-foreground">
      <p className="font-semibold uppercase tracking-wide text-[10px] mb-1 text-muted-foreground/80">
        {t("eu_compare_sources_heading")}
      </p>
      <ul className="space-y-0.5">
        <li>{t("eu_compare_sources_eurostat", { date: peersFetched })}</li>
        <li>{t("eu_compare_sources_silc", { date: peersFetched })}</li>
        <li>{t("eu_compare_sources_cofog", { date: cofogFetched })}</li>
        <li>{t("eu_compare_sources_wgi", { date: wgiFetched })}</li>
        <li>{t("eu_compare_sources_eu27_synth")}</li>
      </ul>
    </div>
  );
};
