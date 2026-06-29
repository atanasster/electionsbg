// "Кой получава парите" — the largest АПИ contractors by € (all of them, not
// only the politically-connected slice), each with a competition profile
// (single-bidder share) + their dominant component + a connected badge where
// the firm is linked to an MP/official. Click → /company/:eik.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Banknote, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import type { TopContractor } from "@/data/procurement/roadAttributes";
import { COMPONENT_LABEL } from "./RoadComponentsTile";

export const RoadTopContractorsTile: FC<{
  contractors: TopContractor[];
  connectedEiks: Set<string>;
}> = ({ contractors, connectedEiks }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  if (contractors.length === 0) return null;
  const max = Math.max(...contractors.map((c) => c.totalEur));
  const pct = (v: number | undefined) =>
    v == null
      ? "—"
      : (v * 100).toLocaleString(lang, { maximumFractionDigits: 0 }) + "%";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Banknote className="h-4 w-4" />
          {lang === "bg" ? "Кой получава парите" : "Who gets the money"}
          <span className="text-xs text-muted-foreground font-normal">
            {lang === "bg" ? "топ изпълнители" : "top contractors"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
          <span className="w-4 shrink-0" />
          <span className="flex-1" />
          <span className="w-20 text-right">
            {lang === "bg" ? "стойност" : "value"}
          </span>
          <span className="w-9 text-right">
            {lang === "bg" ? "дог." : "ctr"}
          </span>
          <span className="w-10 text-right">
            {lang === "bg" ? "1 оф." : "1 bid"}
          </span>
        </div>
        <div className="space-y-1.5">
          {contractors.map((c, i) => {
            const connected = connectedEiks.has(c.eik);
            const single = c.singleBidShare ?? 0;
            return (
              <div key={c.eik} className="flex items-center gap-2 text-xs">
                <span className="w-4 shrink-0 text-right tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1 min-w-0">
                    <Link
                      to={`/company/${c.eik}`}
                      className="min-w-0 truncate font-medium hover:underline"
                    >
                      {c.name}
                    </Link>
                    {connected ? (
                      <Users className="h-3 w-3 text-amber-600 shrink-0" />
                    ) : null}
                  </span>
                  <span className="block text-[10px] text-muted-foreground truncate">
                    {lang === "bg"
                      ? COMPONENT_LABEL[c.topComponent].bg
                      : COMPONENT_LABEL[c.topComponent].en}
                  </span>
                </span>
                <span className="w-20 shrink-0">
                  <span className="block h-1.5 rounded bg-muted overflow-hidden mb-0.5">
                    <span
                      className="block h-full bg-primary/60"
                      style={{
                        width: `${Math.max(3, Math.min(100, (c.totalEur / max) * 100))}%`,
                      }}
                    />
                  </span>
                  <span className="block text-right tabular-nums">
                    {formatEur(c.totalEur)}
                  </span>
                </span>
                <span className="w-9 text-right tabular-nums text-muted-foreground">
                  {c.contractCount}
                </span>
                <span
                  className={`w-10 text-right tabular-nums ${single > 0.4 ? "text-amber-600 font-medium" : "text-muted-foreground"}`}
                >
                  {pct(c.singleBidShare)}
                </span>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground/80 pt-2">
          {lang === "bg"
            ? "Иконата за свързаност маркира фирми със свързано лице в парламента или администрацията. Консорциумите за големи обекти се водят като отделни изпълнители."
            : "The link icon marks firms tied to an MP/official. Per-project consortia are counted as separate contractors."}
        </p>
      </CardContent>
    </Card>
  );
};
