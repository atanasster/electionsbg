// "Концентрация на изпълнителите (HHI)" — how concentrated the water sector's ЗОП
// spend is among contractors, using the Herfindahl-Hirschman Index with the DOJ
// bands (competitive <1500, moderate ≤2500, high >2500). Computed client-side
// from the group model's suppliers (no new query), reusing the shared HHI
// banding helpers. Mirrors mon/TextbookConcentrationTile (docs/plans/
// water-view-v1.md §4.6b).

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PieChart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import {
  hhiBandLabel,
  HHI_BAND_COLOR,
  hhiBand,
} from "@/lib/textbookPublishers";

interface Supplier {
  eik: string;
  name: string;
  totalEur: number;
}

const TOP_N = 8;

export const VikContractorHhiTile: FC<{
  suppliers: Supplier[];
  totalEur: number;
}> = ({ suppliers, totalEur }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const rows = suppliers.filter((s) => s.totalEur > 0);
  if (rows.length < 3 || totalEur <= 0) return null;

  // Denominator is the ATTRIBUTED total (Σ over ranked suppliers), not the
  // awarder headline total — contracts with no contractor EIK are in `totalEur`
  // but in no supplier bucket, so using it would deflate HHI/CR-4 and could
  // misclassify a concentrated market as competitive on a low-coverage sector.
  const attributed = rows.reduce((a, s) => a + s.totalEur, 0);
  const denom = attributed > 0 ? attributed : totalEur;

  // HHI = Σ (percentage market share)², 0–10 000.
  const hhi = Math.round(
    rows.reduce((acc, s) => {
      const pct = (s.totalEur / denom) * 100;
      return acc + pct * pct;
    }, 0),
  );
  const band = hhiBand(hhi);
  const top = [...rows].sort((a, b) => b.totalEur - a.totalEur).slice(0, TOP_N);
  const cr4 = top.slice(0, 4).reduce((acc, s) => acc + s.totalEur / denom, 0);
  const max = top[0]?.totalEur ?? 1;

  return (
    <Card id="hhi">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <PieChart className="h-4 w-4" />
          {bg
            ? "Концентрация на изпълнителите (HHI)"
            : "Contractor concentration (HHI)"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex items-baseline gap-4">
          <div>
            <span
              className={`text-2xl font-bold tabular-nums ${HHI_BAND_COLOR[band]}`}
            >
              {hhi.toLocaleString(lang)}
            </span>
            <span className={`ml-2 text-sm ${HHI_BAND_COLOR[band]}`}>
              {hhiBandLabel(hhi, lang)}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            {bg ? "Топ-4 дял" : "Top-4 share"}:{" "}
            <span className="font-medium text-foreground tabular-nums">
              {Math.round(cr4 * 100)}%
            </span>{" "}
            · {rows.length} {bg ? "изпълнители" : "contractors"}
          </div>
        </div>

        <div className="space-y-1.5">
          {top.map((s) => {
            const share = s.totalEur / denom;
            return (
              <div key={s.eik} className="text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <Link
                    to={`/company/${s.eik}`}
                    className="min-w-0 truncate hover:text-primary hover:underline"
                  >
                    {s.name}
                  </Link>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatEurCompact(s.totalEur, lang)}
                    <span className="ml-1 text-muted-foreground/70">
                      {Math.round(share * 100)}%
                    </span>
                  </span>
                </div>
                <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-violet-600"
                    style={{
                      width: `${Math.max(2, (s.totalEur / max) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Индекс на Херфиндал-Хиршман върху дела на изпълнителите в договорената стойност на групата (по DOJ: под 1500 конкурентен, 1500–2500 умерен, над 2500 концентриран). Изчислено от договорите в текущия обхват."
            : "Herfindahl-Hirschman index over contractors' shares of the group's contracted value (DOJ bands: <1500 competitive, 1500–2500 moderate, >2500 concentrated). Computed from the contracts in the current scope."}
        </p>
      </CardContent>
    </Card>
  );
};
