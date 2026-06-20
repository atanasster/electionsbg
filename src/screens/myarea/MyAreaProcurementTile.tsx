// My-Area procurement tile (Band E — Money). Shows the local public
// procurement pinned to this place: total awarded, contract count, and the top
// local-tier buyers (município, schools, hospitals…). Joins on EKATTE — the
// settlement's own ekatte, or the municipal centre's ekatte for a município
// view — which sidesteps the obshtina-code↔name mismatch in the settlement
// index. Reuses the existing per-settlement procurement shard; no new data.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Receipt, ArrowRight } from "lucide-react";
import { Card } from "@/ux/Card";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useSettlementProcurement } from "@/data/procurement/useSettlementProcurement";
import { formatEur, formatEurCompact } from "@/lib/currency";

const numFmt = new Intl.NumberFormat("bg-BG");

export const MyAreaProcurementTile: FC<{
  obshtina: string;
  ekatte?: string;
}> = ({ obshtina, ekatte }) => {
  const { t } = useTranslation();
  const { findMunicipality } = useMunicipalities();
  // Settlement view → its own ekatte; município view → the centre's ekatte
  // (where "Община X" + the centre's schools/hospitals are pinned).
  const targetEkatte = ekatte ?? findMunicipality(obshtina)?.ekatte;
  const { data, isLoading } = useSettlementProcurement(targetEkatte);

  if (isLoading) return null;
  if (!data || data.awarders.length === 0) return null;

  const topAwarders = data.awarders.slice(0, 5);

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Receipt className="size-4 text-primary" />
        <h2 className="text-sm font-semibold flex-1">
          {t("my_area_procurement_title") || "Public procurement here"}
        </h2>
        <Link
          to={`/procurement/settlement/${data.ekatte}`}
          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
        >
          {t("my_area_procurement_all") || "All"}
          <ArrowRight className="size-3" />
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <Kpi
          label={t("my_area_procurement_total") || "Awarded"}
          value={formatEurCompact(data.totalEur)}
        />
        <Kpi
          label={t("my_area_procurement_contracts") || "Contracts"}
          value={numFmt.format(data.contractCount)}
        />
        <Kpi
          label={t("my_area_procurement_buyers") || "Buyers"}
          value={numFmt.format(data.awarders.length)}
        />
      </div>

      <ul className="flex flex-col">
        {topAwarders.map((aw) => (
          <li key={aw.eik} className="border-b last:border-b-0">
            <Link
              to={`/awarder/${aw.eik}`}
              className="group flex items-center gap-2 py-1.5 hover:bg-accent/30 rounded-sm -mx-1 px-1"
            >
              <span className="min-w-0 flex-1 text-xs truncate">{aw.name}</span>
              <span className="text-xs tabular-nums font-medium shrink-0">
                {formatEur(aw.totalEur)}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="text-[10px] text-muted-foreground mt-3 italic">
        {t("my_area_procurement_caveat") ||
          "Local-tier buyers only (município, schools, hospitals). National ministries procure from Sofia and are excluded."}
      </p>
    </Card>
  );
};

const Kpi: FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-md border bg-muted/20 px-2 py-1.5">
    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
      {label}
    </div>
    <div className="text-sm font-semibold tabular-nums truncate">{value}</div>
  </div>
);
