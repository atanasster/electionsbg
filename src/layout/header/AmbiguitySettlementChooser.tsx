// When the user grants geolocation but their coordinates fall within the
// ambiguity radius of 2+ settlements (common in dense towns where adjacent
// villages overlap), we render this chooser instead of auto-picking.
//
// The dialog presents up to 5 candidates sorted by distance with a clear
// label so the user can pick the right one. It's modal — closing it cancels
// the geolocation flow.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { SettlementInfo } from "@/data/dataTypes";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useRegions } from "@/data/regions/useRegions";

type Candidate = {
  settlement: SettlementInfo;
  distanceKm: number;
};

type Props = {
  candidates: Candidate[];
  onPick: (ekatte: string) => void;
  onClose: () => void;
};

const formatDistance = (km: number): string => {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
};

export const AmbiguitySettlementChooser: FC<Props> = ({
  candidates,
  onPick,
  onClose,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { findMunicipality } = useMunicipalities();
  const { findRegion } = useRegions();

  // Parent-context resolver — each candidate gets a "Settlement type · in
  // município X, oblast Y" subtitle so duplicates like "България" the село
  // can be told apart from the country, and the seven "Аврамово" villages
  // can be told apart from each other. Settlement-type prefix (с. / гр.)
  // also signals "this is a village, not the country" at a glance.
  const parentLine = (settlement: SettlementInfo): string => {
    const m = findMunicipality(settlement.obshtina);
    const r = findRegion(settlement.oblast);
    const muniName = m ? (lang === "bg" ? m.name : m.name_en) : null;
    const regionName = r
      ? lang === "bg"
        ? r.long_name || r.name
        : r.long_name_en || r.name_en
      : null;
    if (lang === "bg") {
      const parts = [
        settlement.t_v_m,
        muniName ? `общ. ${muniName}` : null,
        regionName ? `обл. ${regionName}` : null,
      ].filter(Boolean);
      return parts.join(" · ");
    }
    const parts = [
      muniName ? `${muniName} municipality` : null,
      regionName ? `${regionName} oblast` : null,
    ].filter(Boolean);
    return parts.join(" · ");
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("my_area_ambiguity_title")}</DialogTitle>
          <DialogDescription>
            {t("my_area_ambiguity_description")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 py-2">
          {candidates.map(({ settlement, distanceKm }) => {
            const subtitle = parentLine(settlement);
            return (
              <button
                key={settlement.ekatte}
                type="button"
                onClick={() => onPick(settlement.ekatte)}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-md border hover:bg-accent/40 focus:bg-accent/60 focus:outline-none text-left"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <MapPin className="size-4 shrink-0 text-primary" />
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium truncate">
                      {lang === "bg" ? settlement.name : settlement.name_en}
                    </span>
                    {subtitle ? (
                      <span className="text-[10px] text-muted-foreground truncate">
                        {subtitle}
                      </span>
                    ) : null}
                  </div>
                </div>
                <span className="text-xs tabular-nums text-muted-foreground shrink-0">
                  {formatDistance(distanceKm)}
                </span>
              </button>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
