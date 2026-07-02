// At-a-glance signal chips under the company name — the "why this company
// matters" summary that would otherwise be buried in tiles far down the page:
// debarred, disproportionately large in its sector, dependent on a single buyer,
// political links, EU-funds beneficiary. All derived from data already loaded by
// the DB company page (no extra fetch).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Ban, BarChart3, Crosshair, Landmark, Euro } from "lucide-react";
import { cpvDivisionName } from "@/lib/cpvSectors";
import type { BuyerRelationships } from "./CompanyBuyerCaptureTile";
import type { SectorRank } from "./CompanySectorRankTile";

type Tone = "red" | "amber" | "violet" | "emerald";
const toneClass: Record<Tone, string> = {
  red: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  violet:
    "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  emerald:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
};

interface Chip {
  tone: Tone;
  icon: FC<{ className?: string }>;
  label: string;
}

export const CompanyRiskChips: FC<{
  debarredCount: number;
  sectors: SectorRank[] | null;
  relationships: BuyerRelationships | null;
  politicianCount: number;
  fundsContractedEur: number;
}> = ({
  debarredCount,
  sectors,
  relationships,
  politicianCount,
  fundsContractedEur,
}) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const pct = (f: number) => `${Math.round(f * 100)}%`;
  const chips: Chip[] = [];

  if (debarredCount > 0)
    chips.push({
      tone: "red",
      icon: Ban,
      label: bg ? "Отстранен изпълнител" : "Debarred contractor",
    });

  // Disproportionately large: top sector where it ranks in the top 5% (or top 3).
  const topSector = (sectors ?? [])
    .filter((s) => s.divContractors > 0)
    .sort((a, b) => b.totalEur - a.totalEur)[0];
  if (
    topSector &&
    (topSector.rank <= 3 || topSector.rank / topSector.divContractors <= 0.05)
  )
    chips.push({
      tone: "amber",
      icon: BarChart3,
      label: `№${topSector.rank} ${bg ? "в" : "in"} ${cpvDivisionName(
        topSector.division,
        i18n.language,
      )}`,
    });

  // Single-buyer dependence — ≥60% of revenue from one buyer.
  if (relationships && relationships.top1Share >= 0.6)
    chips.push({
      tone: "amber",
      icon: Crosshair,
      label: bg
        ? `${pct(relationships.top1Share)} от един възложител`
        : `${pct(relationships.top1Share)} from one buyer`,
    });

  if (politicianCount > 0)
    chips.push({
      tone: "violet",
      icon: Landmark,
      label: bg
        ? `Политически връзки (${politicianCount})`
        : `Political links (${politicianCount})`,
    });

  if (fundsContractedEur > 0)
    chips.push({
      tone: "emerald",
      icon: Euro,
      label: bg ? "Бенефициент по ЕС" : "EU-funds beneficiary",
    });

  if (chips.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {chips.map((c, i) => {
        const Icon = c.icon;
        return (
          <span
            key={i}
            title={c.label}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${toneClass[c.tone]}`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate max-w-[15rem]">{c.label}</span>
          </span>
        );
      })}
    </div>
  );
};
