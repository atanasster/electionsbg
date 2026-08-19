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
import { CompanyLink } from "@/screens/components/procurement/CompanyLink";

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

export const SectorTopContractorsTile: FC<{
  model: AwarderModel<"all">;
  /** Optional "see all →" link in the header (opt-in; omit to hide). */
  seeAllTo?: string;
  /** The sector's own member EIKs. A contractor that is ALSO a member is an
   *  in-group transfer, not a supplier the sector bought from on the market, and
   *  the row says so — see the note under the list. Omit to disable the check. */
  memberEiks?: readonly string[];
}> = ({ model, seeAllTo, memberEiks }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const locale = bg ? "bg-BG" : "en-US";
  const rows = model.suppliers.slice(0, 8);
  const members = new Set(memberEiks ?? []);
  const hasInGroup = rows.some((s) => members.has(s.eik));
  if (rows.length < 2) return null;
  const max = rows[0].totalEur || 1;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">
          {bg ? "Топ изпълнители" : "Top contractors"}
        </CardTitle>
        {seeAllTo && (
          <Link
            to={seeAllTo}
            className="shrink-0 text-xs font-medium text-primary hover:underline"
          >
            {bg ? "виж всички →" : "see all →"}
          </Link>
        )}
      </CardHeader>
      <CardContent className="space-y-1.5 p-3 md:p-4">
        {rows.map((s) => {
          const inGroup = members.has(s.eik);
          return (
            <div key={s.eik} className="flex items-center gap-2 text-sm">
              <CompanyLink
                eik={s.eik}
                className="min-w-0 max-w-[42%] shrink truncate text-primary hover:underline"
                title={s.name}
              >
                {s.name}
              </CompanyLink>
              {inGroup && (
                <span
                  className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                  title={
                    bg
                      ? "Изпълнителят е от същата група — парите остават в сектора"
                      : "The contractor belongs to the same group — the money stays inside the sector"
                  }
                >
                  {bg ? "в групата" : "in-group"}
                </span>
              )}
              <div className="relative h-4 flex-1 overflow-hidden rounded bg-muted/40">
                <div
                  className={`absolute inset-y-0 left-0 rounded ${
                    inGroup ? "bg-primary/30" : "bg-primary/70"
                  }`}
                  style={{ width: `${Math.max(3, (s.totalEur / max) * 100)}%` }}
                />
              </div>
              <div className="w-20 shrink-0 text-right tabular-nums text-muted-foreground">
                {formatEurCompact(s.totalEur, locale)}
              </div>
            </div>
          );
        })}
        {hasInGroup && (
          <p className="pt-1.5 text-xs text-muted-foreground">
            {bg
              ? "„В групата“ = изпълнителят е една от организациите в сектора. Тези пари не са отишли на външен пазар — държавата плаща на собственото си дружество."
              : "“In-group” = the contractor is one of the sector's own organisations. That money did not go to an external market — the state is paying its own company."}
          </p>
        )}
      </CardContent>
    </Card>
  );
};
