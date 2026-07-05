import { FC, ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatEur, formatEurCompact } from "@/lib/currency";
import { formatThousands } from "@/data/utils";
import { PartyFinancingRow } from "@/data/financing/usePartiesFinancing";
import { AgenciesSummary, DonorSummary } from "@/data/dataTypes";

const Tile: FC<{ label: string; value: ReactNode; sub?: ReactNode }> = ({
  label,
  value,
  sub,
}) => (
  <div className="flex flex-col gap-1 rounded-xl border bg-card p-4 shadow-sm">
    <div className="text-sm font-medium text-muted-foreground">{label}</div>
    <div className="text-2xl font-bold tabular-nums leading-tight">{value}</div>
    {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
  </div>
);

// Headline KPI tiles for the national financing dashboard.
export const FinancingKpiTiles: FC<{
  rows: PartyFinancingRow[];
  donors: DonorSummary | null;
  agencies: AgenciesSummary | null;
}> = ({ rows, donors, agencies }) => {
  const { t, i18n } = useTranslation();
  const k = useMemo(() => {
    const totalRaised = rows.reduce((s, r) => s + r.total, 0);
    const selfFunded = rows.reduce((s, r) => s + r.fromParties, 0);
    const media = rows.reduce((s, r) => s + r.media, 0);
    return {
      totalRaised,
      filers: rows.length,
      donationTotal: donors
        ? donors.totalMonetary + donors.totalNonMonetary
        : rows.reduce((s, r) => s + r.fromDonors, 0),
      distinctDonors: donors?.distinctDonors ?? 0,
      topDonor: donors?.topDonors[0],
      selfFunded,
      selfPct: totalRaised > 0 ? (100 * selfFunded) / totalRaised : 0,
      media,
      agencies: agencies?.total ?? 0,
      distinctEik: agencies?.distinctCompanies ?? 0,
    };
  }, [rows, donors, agencies]);

  const lang = i18n.language;
  return (
    <div
      data-og="financing-hero"
      className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
    >
      <Tile
        label={t("financing_kpi_total_raised")}
        value={formatEurCompact(k.totalRaised, lang)}
        sub={t("financing_kpi_filers", { n: k.filers })}
      />
      <Tile
        label={t("financing_kpi_donations")}
        value={formatEurCompact(k.donationTotal, lang)}
        sub={t("financing_kpi_distinct_donors", { n: k.distinctDonors })}
      />
      <Tile
        label={t("financing_kpi_top_donor")}
        value={
          k.topDonor
            ? formatEurCompact(
                k.topDonor.monetary + k.topDonor.nonMonetary,
                lang,
              )
            : "—"
        }
        sub={k.topDonor?.name ?? "—"}
      />
      <Tile
        label={t("financing_kpi_self_funded")}
        value={`${k.selfPct.toFixed(0)}%`}
        sub={formatEur(k.selfFunded, lang)}
      />
      <Tile
        label={t("financing_kpi_media")}
        value={formatEurCompact(k.media, lang)}
        sub={t("financing_kpi_media_sub")}
      />
      <Tile
        label={t("financing_kpi_agencies")}
        value={formatThousands(k.agencies)}
        sub={t("financing_kpi_distinct_companies", { n: k.distinctEik })}
      />
    </div>
  );
};
