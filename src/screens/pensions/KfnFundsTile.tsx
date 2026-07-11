// "Частни пенсионни фондове" — the missing half. НОИ (pillars 1) is pay-as-you-go;
// this is pillars 2 and 3, the funded private accounts run by the ПОД (pension
// companies) and supervised by КФН. A sortable per-fund comparison — net assets
// and insured persons — grouped by fund type, with the headline that the whole
// second+third pillar is ~€14.5bn of Bulgarians' retirement savings that never
// appears in the state budget.
//
// moitepari.bg is the only public comparison and it is a dated black box; this
// is the neutral, maintained version.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatEurCompact, formatInt } from "@/lib/currency";
import { PillToggle } from "@/components/ui/PillToggle";
import { useKfnFunds } from "@/data/budget/useBudget";
import type { KfnFundRow, KfnPillar } from "@/data/budget/types";

type Metric = "assets" | "insured";

const PILLAR_ORDER: KfnPillar[] = ["UPF", "PPF", "VPF", "VPFOS"];

export const KfnFundsTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data } = useKfnFunds();
  const [metric, setMetric] = useState<Metric>("assets");

  const grouped = useMemo(() => {
    if (!data) return [];
    const byPillar = new Map<KfnPillar, KfnFundRow[]>();
    for (const f of data.funds) {
      const arr = byPillar.get(f.pillar) ?? [];
      arr.push(f);
      byPillar.set(f.pillar, arr);
    }
    return PILLAR_ORDER.filter((p) => byPillar.has(p)).map((p) => {
      const rows = [...byPillar.get(p)!].sort((a, b) =>
        metric === "assets"
          ? (b.netAssetsEur ?? 0) - (a.netAssetsEur ?? 0)
          : (b.insured ?? 0) - (a.insured ?? 0),
      );
      const max = Math.max(
        ...rows.map((r) =>
          metric === "assets" ? (r.netAssetsEur ?? 0) : (r.insured ?? 0),
        ),
        1,
      );
      return { pillar: p, rows, max, label: rows[0] };
    });
  }, [data, metric]);

  const totals = useMemo(() => {
    if (!data) return null;
    return {
      assets: data.funds.reduce((s, f) => s + (f.netAssetsEur ?? 0), 0),
      insured: data.funds.reduce((s, f) => s + (f.insured ?? 0), 0),
    };
  }, [data]);

  if (!data || !totals) return null;

  const val = (r: KfnFundRow) =>
    metric === "assets" ? (r.netAssetsEur ?? 0) : (r.insured ?? 0);
  const fmt = (v: number) =>
    metric === "assets" ? formatEurCompact(v, lang) : formatInt(v, lang);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Wallet className="h-4 w-4" />
            {bg
              ? "Частни пенсионни фондове (стълбове 2 и 3)"
              : "Private pension funds (pillars 2 & 3)"}
          </CardTitle>
          <PillToggle<Metric>
            ariaLabel={bg ? "Показател" : "Metric"}
            value={metric}
            onChange={setMetric}
            options={[
              { value: "assets", label: bg ? "Активи" : "Assets" },
              { value: "insured", label: bg ? "Осигурени" : "Insured" },
            ]}
          />
        </div>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-4">
        <div className="grid gap-3 grid-cols-2">
          <StatCard
            label={bg ? "Нетни активи — общо" : "Net assets — total"}
            hint={data.periodLabel}
          >
            <span className="text-2xl font-bold tabular-nums">
              {formatEurCompact(totals.assets, lang)}
            </span>
          </StatCard>
          <StatCard
            label={bg ? "Осигурени лица" : "Insured persons"}
            hint={data.periodLabel}
          >
            <span className="text-2xl font-bold tabular-nums">
              {formatInt(totals.insured, lang)}
            </span>
          </StatCard>
        </div>

        {grouped.map((g) => (
          <div key={g.pillar}>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">
              {bg ? g.label.pillarLabelBg : g.label.pillarLabelEn}
              <span className="ml-1 text-muted-foreground/60">
                {bg
                  ? `· стълб ${g.label.pillarNumber}`
                  : `· pillar ${g.label.pillarNumber}`}
              </span>
            </div>
            <div className="space-y-1">
              {g.rows.map((r) => (
                <div key={r.fundName}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate">
                      {bg ? r.companyBg : r.companyEn}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {fmt(val(r))}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{
                        width: `${Math.max(1, (val(r) / g.max) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `Нетни активи и осигурени лица по фонд, ${data.periodLabel}. Стълб 2 (УПФ/ППФ) е задължителен, стълб 3 (ДПФ) е доброволен. Източник: КФН.`
            : `Net assets and insured persons per fund, ${data.periodLabel}. Pillar 2 (UPF/PPF) is mandatory, pillar 3 (VPF) voluntary. Source: КФН (FSC).`}
        </p>
      </CardContent>
    </Card>
  );
};
