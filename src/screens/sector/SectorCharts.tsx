// Lightweight, dependency-free chart tiles for the generic sector dashboard —
// spend-by-year bars and a top-contractors leaderboard, both built from the
// AwarderModel the dashboard already fetches. Pure CSS/flex (no chart lib) so
// they render instantly for the OG screenshot and stay cheap on the page.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import type { AwarderModel } from "@/lib/awarderModel";

export const SectorSpendByYearTile: FC<{ model: AwarderModel<"all"> }> = ({
  model,
}) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const locale = bg ? "bg-BG" : "en-US";
  const years = model.years.filter((y) => y.totalEur > 0);
  if (years.length < 2) return null;
  const max = Math.max(...years.map((y) => y.totalEur));

  return (
    // min-w-0 so this card can shrink below its bar-row's min-content width when
    // it's a grid/flex child (grid items default to min-width:auto) — otherwise
    // the track grows to the full bar row and the CardContent scroller never
    // engages on a narrow screen.
    <Card className="min-w-0">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {bg ? "Възложени по година" : "Awarded by year"}
        </CardTitle>
      </CardHeader>
      {/* overflow-x-auto so a long year run (e.g. 2017–2026) scrolls on a narrow
          screen instead of clipping the most recent, tallest bars (house rule:
          wide content scrolls in its own container). On desktop it fits and the
          bars flex to fill, so nothing changes there. */}
      <CardContent className="overflow-x-auto p-3 md:p-4">
        <div className="flex h-[220px] items-end gap-2">
          {years.map((y) => (
            <div
              key={y.year}
              className="flex min-w-[40px] flex-1 flex-col items-center justify-end gap-1"
            >
              <div className="text-[10px] font-medium tabular-nums text-muted-foreground">
                {formatEurCompact(y.totalEur, locale)}
              </div>
              <div
                className="w-full rounded-t bg-primary/80"
                style={{
                  height: `${Math.max(2, (y.totalEur / max) * 170)}px`,
                }}
                title={`${y.year}: ${formatEurCompact(y.totalEur, locale)}`}
              />
              <div className="text-[10px] tabular-nums text-muted-foreground">
                {y.year}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export const SectorTopContractorsTile: FC<{ model: AwarderModel<"all"> }> = ({
  model,
}) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const locale = bg ? "bg-BG" : "en-US";
  const rows = model.suppliers.slice(0, 8);
  if (rows.length < 2) return null;
  const max = rows[0].totalEur || 1;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {bg ? "Топ изпълнители" : "Top contractors"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 p-3 md:p-4">
        {rows.map((s) => (
          <div key={s.eik} className="flex items-center gap-2 text-sm">
            <Link
              to={`/company/${s.eik}`}
              className="w-[42%] min-w-0 truncate text-primary hover:underline"
              title={s.name}
            >
              {s.name}
            </Link>
            <div className="relative h-4 flex-1 overflow-hidden rounded bg-muted/40">
              <div
                className="absolute inset-y-0 left-0 rounded bg-primary/70"
                style={{ width: `${Math.max(3, (s.totalEur / max) * 100)}%` }}
              />
            </div>
            <div className="w-20 shrink-0 text-right tabular-nums text-muted-foreground">
              {formatEurCompact(s.totalEur, locale)}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};
