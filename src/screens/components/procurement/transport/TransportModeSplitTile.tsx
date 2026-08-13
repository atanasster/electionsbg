// "Къде отиват парите за транспорт — по вид" — the signature transport tile. Folds
// the group's ЗОП spend by MODE (railways, maritime & ports, aviation, road transport
// & safety, ministry) from the per-unit rollup. This is the transport-unique geometry
// the generic category tile can't give: which slice of the state transport apparatus
// the money flows through. Rail dominates (НКЖИ + БДЖ). Pure from TransportUnitAgg.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { TrainFront } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import type { TransportUnitAgg } from "@/data/procurement/useTransport";
import {
  TRANSPORT_UNIVERSES,
  transportUniverseLabel,
  type TransportUniverse,
} from "@/lib/transportReferenceData";

// Fixed colour per mode so the universe Select never repaints a survivor (colour
// follows the entity, not its rank — dataviz house rule).
const MODE_COLOR: Record<TransportUniverse, string> = {
  ministry: "bg-slate-500",
  rail: "bg-primary",
  maritime: "bg-cyan-600",
  aviation: "bg-sky-500",
  road: "bg-amber-500",
};

interface ModeAgg {
  universe: TransportUniverse;
  totalEur: number;
  unitCount: number;
  top: { name: string; totalEur: number } | null;
}

export const TransportModeSplitTile: FC<{ units: TransportUnitAgg[] }> = ({
  units,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const loc = bg ? "bg-BG" : "en-US";

  const { rows, total } = useMemo(() => {
    const acc = new Map<TransportUniverse, ModeAgg>();
    for (const u of units) {
      if (!u.universe) continue;
      const uni = u.universe;
      let m = acc.get(uni);
      if (!m) {
        m = { universe: uni, totalEur: 0, unitCount: 0, top: null };
        acc.set(uni, m);
      }
      m.totalEur += u.totalEur;
      m.unitCount += 1;
      if (!m.top || u.totalEur > m.top.totalEur)
        m.top = { name: u.name, totalEur: u.totalEur };
    }
    const rows = TRANSPORT_UNIVERSES.map((uni) => acc.get(uni)).filter(
      (m): m is ModeAgg => !!m && m.totalEur > 0,
    );
    const total = rows.reduce((a, m) => a + m.totalEur, 0);
    return { rows, total };
  }, [units]);

  if (rows.length < 2 || total <= 0) return null;
  const max = Math.max(...rows.map((m) => m.totalEur));

  // The bars are per-AWARDER, so the ministry's own line is not HQ spending: in every
  // scope where it is material it is almost entirely rail bought centrally — the PSO
  // contract with БДЖ plus the rolling-stock orders (measured 2026-08-13: 99% of МТС's
  // spend in each of the three years it exceeds €20M). Two things follow that a reader
  // cannot see from the bars, so the footnote says them: rail's real share is larger
  // than its own bar, and the PSO money goes to another member of this same group
  // rather than out of it. The share is DERIVED and the caveat only renders when the
  // slice is big enough to mislead — a hardcoded € would be false on most scopes,
  // since the PSO lots landed on one day in 2026.
  const ministryShare = (rows.find((m) => m.universe === "ministry")?.totalEur ?? 0) / total; // prettier-ignore
  const showPassthrough = ministryShare >= 0.1;

  return (
    <Card id="mode-split">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrainFront className="h-4 w-4" />
          {bg
            ? "Къде отиват парите за транспорт — по вид"
            : "Where transport money goes — by mode"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-2.5">
        {rows.map((m) => {
          const share = m.totalEur / total;
          return (
            <div key={m.universe} className="text-xs">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="font-medium">
                  {transportUniverseLabel(m.universe, lang)}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {formatEurCompact(m.totalEur, lang)}
                  <span className="ml-1 text-muted-foreground/70">
                    {(share * 100).toLocaleString(loc, {
                      maximumFractionDigits: 0,
                    })}
                    %
                  </span>
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${MODE_COLOR[m.universe]}`}
                  style={{ width: `${Math.max(2, (m.totalEur / max) * 100)}%` }}
                />
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {m.unitCount} {bg ? "структури" : "units"}
                {m.top && (
                  <>
                    {" · "}
                    {bg ? "водеща: " : "top: "}
                    <span className="min-w-0">{m.top.name}</span>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {showPassthrough && (
          <p className="pt-1 text-[11px] text-muted-foreground/80">
            {bg
              ? `Внимание при разчитането: „Министерство (централа)“ е ${(ministryShare * 100).toLocaleString(loc, { maximumFractionDigits: 0 })}% тук, но почти всичко в него също е железопътно — договорът за обществена услуга (PSO) с БДЖ и поръчките за нови мотриси се възлагат от министерството, а не от превозвача. Реалният дял на железниците е по-голям от стълбчето им, а тези пари остават вътре в групата, вместо да излязат от нея.`
              : `Read with care: „Ministry (HQ)“ is ${(ministryShare * 100).toLocaleString(loc, { maximumFractionDigits: 0 })}% here, but nearly all of it is rail too — the public-service (PSO) contract with БДЖ and the new-train orders are awarded by the ministry, not by the operator. Rail's real share is larger than its own bar, and this money stays inside the group rather than leaving it.`}
          </p>
        )}
        <p className="pt-1 text-[11px] text-muted-foreground/80">
          {bg
            ? "Договорена стойност по вид транспорт, в избрания обхват. Пътната инфраструктура (АПИ) е отделен сектор и не е включена тук."
            : "Contracted value by transport mode, in the selected scope. Road infrastructure (АПИ) is a separate sector and is not included here."}
        </p>
      </CardContent>
    </Card>
  );
};
