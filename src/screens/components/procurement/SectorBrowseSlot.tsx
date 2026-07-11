// Sector browse slot — the shared seam that enriches the corpus-wide browse
// pages (/procurement/contracts, /procurement/tenders) when a ?sector= is active.
// The generalization of the awarder sector-pack: keyed on a sector (an EIK-set)
// instead of a single entity. The host screen restricts its table with the
// pack's EIK-set (awarder_eik IN …) and mounts this above the table to show the
// sector label + an optional enrichment Section. See
// docs/plans/water-view-v1.md §4.3 (a shared prerequisite with the judiciary plan).

import { FC, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Filter } from "lucide-react";
import type { SectorBrowsePack } from "./sectorPacks";
import type { ScopeWindow } from "@/data/procurement/useAwarderContracts";

export const SectorBrowseSlot: FC<{
  pack: SectorBrowsePack;
  scope: ScopeWindow;
}> = ({ pack, scope }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const label = bg ? pack.label.bg : pack.label.en;
  const Section = pack.Section;
  return (
    <section className="my-4 space-y-3">
      <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
        <Filter className="h-4 w-4 shrink-0 text-primary" />
        <span>
          {bg
            ? "Показани са само поръчките на: "
            : "Showing only procurement of: "}
          <strong>{label}</strong>
        </span>
      </div>
      {Section && (
        <Suspense
          fallback={
            <div className="h-[200px] animate-pulse rounded-xl border bg-card" />
          }
        >
          <Section scope={scope} eiks={pack.eiks} />
        </Suspense>
      )}
    </section>
  );
};
