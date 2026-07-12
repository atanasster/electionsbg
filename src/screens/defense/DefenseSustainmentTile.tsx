// "Цената да поддържаш флота да лети" — the signature tile. The thesis made
// concrete: sustainment IS visible in the procurement register, acquisition is
// not. This is the cross-buyer aggregate of what it costs to keep the Soviet-era
// and legacy fleet flying — aviation fuel, helicopter and MiG-29/L-39/C-27J
// overhauls — €376M across the МО group, all years. Framed as spend, not a
// verdict (the flood-tile pattern from the water view).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Plane } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { useDefenseAviationSustainment } from "@/data/defense/useDefenseData";

export const DefenseSustainmentTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data } = useDefenseAviationSustainment();
  if (!data) return null;
  const max = Math.max(...data.platforms.map((p) => p.eur), 1);

  return (
    <Card id="defense-sustainment">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Plane className="h-4 w-4" />
          {bg
            ? "Цената да поддържаш флота да лети"
            : "The cost of keeping the fleet flying"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <p className="max-w-[64ch] text-sm leading-snug">
          {bg ? (
            <>
              <span className="font-semibold tabular-nums">
                {formatEurCompact(data.totalEur, lang)}
              </span>{" "}
              по {data.contractCount} договора — това вижда регистърът на
              поръчките: поддръжката на остаряващата авиация. Придобиването на
              новата (F-16) е по US FMS и не е тук.
            </>
          ) : (
            <>
              <span className="font-semibold tabular-nums">
                {formatEurCompact(data.totalEur, lang)}
              </span>{" "}
              across {data.contractCount} contracts — this is what the
              procurement register sees: sustaining the ageing fleet. Acquiring
              the new one (F-16) is via US FMS and is not here.
            </>
          )}
        </p>
        <div className="space-y-2">
          {data.platforms.map((p) => (
            <div key={p.name} className="text-xs">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="font-medium">{p.name}</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatEurCompact(p.eur, lang)}{" "}
                  <span className="text-muted-foreground/70">
                    · {p.contracts} {bg ? "дог." : "contr."}
                  </span>
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-[hsl(var(--primary))]"
                  style={{ width: `${Math.max(2, (p.eur / max) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Всички години. Договори от регистъра, чийто предмет съвпада с авиационна платформа, двигател, вертолет или авиационно гориво. Показва разход, не оценка."
            : "All years. Register contracts whose subject matches an aircraft platform, engine, helicopter or aviation fuel. Shows spend, not a verdict."}
        </p>
      </CardContent>
    </Card>
  );
};
