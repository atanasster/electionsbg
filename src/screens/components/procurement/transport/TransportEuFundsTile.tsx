// "Европейски средства за транспорт (ИСУН)" — the group's EU-funds absorption per
// beneficiary: contracted vs actually paid (ОП „Транспортна свързаност" / ОПТ). The
// invest-half the procurement corpus can't show — most rail capital (НКЖИ track
// modernization, БДЖ rolling stock) is EU money. The gap between contracted and paid
// is the story: sign hundreds of millions, draw a fraction. Pure from TransportFundOp
// (useTransportFunds). Tier-A — the beneficiary data is already in Postgres. Mirrors
// VikEuFundsTile.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import type { TransportFundOp } from "@/data/procurement/useTransport";

const TOP_N = 10;

export const TransportEuFundsTile: FC<{ funds: TransportFundOp[] }> = ({
  funds,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const rows = funds.filter((f) => f.contractedEur > 0);
  if (rows.length < 2) return null;

  const totalContracted = rows.reduce((s, f) => s + f.contractedEur, 0);
  const totalPaid = rows.reduce((s, f) => s + f.paidEur, 0);
  const absorption = totalContracted > 0 ? totalPaid / totalContracted : 0;
  const max = Math.max(...rows.map((f) => f.contractedEur), 1);
  const shown = rows.slice(0, TOP_N);

  return (
    <Card id="eu-funds">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="h-4 w-4" />
          {bg
            ? "Европейски средства за транспорт (ИСУН)"
            : "EU funds for transport (ИСУН)"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <div className="text-xl font-bold tabular-nums">
              {formatEurCompact(totalContracted, lang)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {bg ? "договорени" : "contracted"}
            </div>
          </div>
          <div>
            <div className="text-xl font-bold tabular-nums">
              {formatEurCompact(totalPaid, lang)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {bg ? "изплатени" : "paid"}
            </div>
          </div>
          <div>
            <div
              className={`text-xl font-bold tabular-nums ${absorption < 0.5 ? "text-amber-600 dark:text-amber-400" : ""}`}
            >
              {Math.round(absorption * 100)}%
            </div>
            <div className="text-[11px] text-muted-foreground">
              {bg ? "усвоени" : "absorbed"}
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          {shown.map((f) => {
            const abs = f.contractedEur > 0 ? f.paidEur / f.contractedEur : 0;
            return (
              <div key={f.eik} className="text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <Link
                    to={`/awarder/${f.eik}`}
                    className="min-w-0 truncate hover:text-primary hover:underline"
                  >
                    {f.name}
                  </Link>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatEurCompact(f.contractedEur, lang)}
                    <span
                      className={`ml-1 ${abs < 0.25 ? "text-amber-600 dark:text-amber-400 font-medium" : "text-muted-foreground/70"}`}
                    >
                      {Math.round(abs * 100)}%
                    </span>
                  </span>
                </div>
                {/* Contracted bar with the paid portion filled darker. */}
                <div className="mt-0.5 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-emerald-500/30"
                    style={{
                      width: `${Math.max(2, (f.contractedEur / max) * 100)}%`,
                    }}
                  >
                    <div
                      className="h-full rounded-full bg-emerald-600"
                      style={{
                        width: `${f.contractedEur > 0 ? Math.min(100, abs * 100) : 0}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Договорени и изплатени европейски средства (предимно ОП „Транспортна свързаност“ / ОПТ — жп модернизация, подвижен състав), от регистъра ИСУН. Светлата лента е договореното, тъмната — реално изплатеното; процентът е усвояването. Сумите са за целия програмен период, не по избрания парламент."
            : "EU funds contracted and actually paid (mostly the Transport Connectivity programme / ОПТ — rail modernization, rolling stock), from the ИСУН register. The light bar is contracted, the dark fill is paid; the percentage is absorption. Figures are programme-period totals, not scoped to the selected parliament."}
        </p>
      </CardContent>
    </Card>
  );
};
