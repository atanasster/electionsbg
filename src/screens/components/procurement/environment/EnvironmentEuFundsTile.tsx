// „Европейски средства за околна среда (ИСУН)" — the ОП „Околна среда" absorption story,
// joined by OP CODE (accurate) (§0.5). The signature contrast: ОПОС 2014-2020 closed at
// ~95% while Програма „Околна среда" 2021-2027 sits near ~18% — the absorption-risk of the
// new period, straight from the ИСУН register. Contracted vs actually paid; the gap is the
// money signed but not yet drawn. Mirrors the visual of VikEuFundsTile /
// TransportEuFundsTile.
//
// Served from Postgres via useEnvFundProgrammes → useFundsAbsorption
// (/api/db/fund-payload?kind=absorption). An earlier version of this header said it read
// "the static absorption.json" — it does not, and must not: bucket:sync excludes
// ^funds/.* so that copy is unmaintained and goes stale.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import type { EnvFundProgramme } from "@/data/procurement/useEnvironment";

export const EnvironmentEuFundsTile: FC<{ funds: EnvFundProgramme[] }> = ({
  funds,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const rows = funds.filter((f) => f.contractedEur > 0);
  if (rows.length < 1) return null;

  const totalContracted = rows.reduce((s, f) => s + f.contractedEur, 0);
  const totalPaid = rows.reduce((s, f) => s + f.paidEur, 0);
  const absorption = totalContracted > 0 ? totalPaid / totalContracted : 0;
  const max = Math.max(...rows.map((f) => f.contractedEur), 1);

  return (
    <Card id="eu-funds">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="h-4 w-4" />
          {bg
            ? "Европейски средства за околна среда (ИСУН)"
            : "EU funds for the environment (ИСУН)"}
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
          {rows.map((f) => {
            const abs = f.contractedEur > 0 ? f.paidEur / f.contractedEur : 0;
            return (
              <div key={f.programCode} className="text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate">
                    {f.programName}
                    {f.period && (
                      <span className="ml-1 text-muted-foreground/70">
                        {f.period}
                      </span>
                    )}
                  </span>
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
            ? "Договорени и изплатени европейски средства по ОП/Програма „Околна среда“ и грантове по ЕИП/Норвежкия механизъм, от регистъра ИСУН, свързани по код на програмата. Светлата лента е договореното, тъмната — реално изплатеното; процентът е усвояването. Сумите са за целия програмен период, не по избрания парламент. Водният цикъл по ОПОС се брои и в изгледа „Води“."
            : "EU funds contracted and actually paid under ОП/Programme „Околна среда“ and the EEA/Norway grants, from the ИСУН register, joined by programme code. The light bar is contracted, the dark fill is paid; the percentage is absorption. Figures are programme-period totals, not scoped to the selected parliament. The ОПОС water-cycle also appears in the Water view."}
        </p>
      </CardContent>
    </Card>
  );
};
