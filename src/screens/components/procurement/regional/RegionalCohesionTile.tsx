// „Усвояване на кохезионните средства за регионите (ИСУН)" — the flagship absorption
// burn-down. The signature contrast, joined by OP CODE (accurate) from the static
// absorption.json: ОПРР „Региони в растеж" 2014-2020 closed at ~96%, while Програма
// „Развитие на регионите" 2021-2027 sits near ~20% — the absorption-risk of the new
// period against the hard 31 December 2029 n+3 decommitment deadline (commitments still
// open then are LOST). Contracted vs actually paid; the gap is money signed but not yet
// drawn. Mirrors EnvironmentEuFundsTile; sources from useRegionalCohesion.
//
// This is THE differentiator tile — cohesiondata.ec.europa.eu leads with exactly this
// planned→contracted→paid burn-down; nobody joins it to the per-oblast money map (§2).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import type { RegionalCohesionProgramme } from "@/data/procurement/useRegional";

// The 2021-2027 programmes' final n+3 decommitment deadline — money committed but not
// spent by then is forfeited. The absorption-risk clock the tile counts down to.
const DECOMMITMENT_YEAR = 2029;

export const RegionalCohesionTile: FC<{
  programmes: RegionalCohesionProgramme[];
}> = ({ programmes }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const rows = programmes.filter((p) => p.contractedEur > 0);
  if (rows.length < 1) return null;

  const totalContracted = rows.reduce((s, p) => s + p.contractedEur, 0);
  const totalPaid = rows.reduce((s, p) => s + p.paidEur, 0);
  const absorption = totalContracted > 0 ? totalPaid / totalContracted : 0;
  const max = Math.max(...rows.map((p) => p.contractedEur), 1);

  // The at-risk money = the still-unpaid portion of the current (2021-27) programme,
  // the one racing the decommitment clock.
  const current = rows.find((p) => p.period.startsWith("2021"));
  const atRisk = current
    ? Math.max(0, current.contractedEur - current.paidEur)
    : 0;

  return (
    <Card id="cohesion">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="h-4 w-4" />
          {bg
            ? "Усвояване на кохезионните средства за регионите (ИСУН)"
            : "Absorption of the regional cohesion funds (ИСУН)"}
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
          {rows.map((p) => {
            const abs = p.contractedEur > 0 ? p.paidEur / p.contractedEur : 0;
            return (
              <div key={p.programCode} className="text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate">
                    {p.programName}
                    {p.period && (
                      <span className="ml-1 text-muted-foreground/70">
                        {p.period}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatEurCompact(p.contractedEur, lang)}
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
                    className="h-full rounded-full bg-primary/30"
                    style={{
                      width: `${Math.max(2, (p.contractedEur / max) * 100)}%`,
                    }}
                  >
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{
                        width: `${p.contractedEur > 0 ? Math.min(100, abs * 100) : 0}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {atRisk > 0 && (
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs leading-snug text-amber-700 dark:text-amber-300">
            {bg ? (
              <>
                Около{" "}
                <span className="font-semibold tabular-nums">
                  {formatEurCompact(atRisk, lang)}
                </span>{" "}
                по „Развитие на регионите“ са договорени, но още неизплатени.
                Средствата, останали неусвоени към{" "}
                <span className="font-semibold">
                  31 декември {DECOMMITMENT_YEAR} г.
                </span>{" "}
                (правилото n+3), се губят.
              </>
            ) : (
              <>
                About{" "}
                <span className="font-semibold tabular-nums">
                  {formatEurCompact(atRisk, lang)}
                </span>{" "}
                under „Развитие на регионите“ is contracted but not yet paid.
                Money left unabsorbed by{" "}
                <span className="font-semibold">
                  31 December {DECOMMITMENT_YEAR}
                </span>{" "}
                (the n+3 rule) is forfeited.
              </>
            )}
          </p>
        )}

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Договорени и реално изплатени европейски средства по ОП „Региони в растеж“ 2014-2020 и Програма „Развитие на регионите“ 2021-2027, от регистъра ИСУН, свързани по код на програмата. Светлата лента е договореното, тъмната — изплатеното; процентът е усвояването. Бенефициентите са общините; сумите са за целия програмен период, не по избрания парламент."
            : "EU funds contracted and actually paid under ОП „Региони в растеж“ 2014-2020 and Programme „Развитие на регионите“ 2021-2027, from the ИСУН register, joined by programme code. The light bar is contracted, the dark fill is paid; the percentage is absorption. The beneficiaries are the municipalities; figures are programme-period totals, not scoped to the selected parliament."}
        </p>
      </CardContent>
    </Card>
  );
};
