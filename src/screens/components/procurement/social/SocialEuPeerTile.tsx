// "Разход за социална защита спрямо ЕС" — the EU-peer comparison tile. Social
// protection (COFOG GF10) as a share of GDP: Bulgaria sits BELOW the EU average
// here (14.4% vs 19.6%, 2024) — the structural counterpoint to the poverty tile.
// Reads the already-ingested Eurostat COFOG artifact (data/cofog.json,
// update-macro). Mirrors MvrEuPeerTile (GF03→GF10).
//
// ⚠ THIS TILE USED TO CONTRADICT THE ONE DIRECTLY ABOVE IT. Its closing sentence
// read „Разходът не е най-ниският; проблемът е ефектът върху бедността", while
// SocialValueForMoneyTile — rendered immediately before it, off the same two
// series — concluded the opposite: „За похарченото резултатът е около очаквания
// — лостът е размерът на разхода, не ефективността." The value-for-money tile is
// the one the data supports: against its own OLS fit over the five geos BG sits
// +1.7pp ABOVE the line (fit 25.2%, actual 26.9%), and RO is the one below it
// (−2.2). This sentence was a survivor of the pre-correction framing that
// SocialValueForMoneyTile's header already records as wrong; two tiles cannot
// give one reader two verdicts on one pair of numbers.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { HandHeart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatCount } from "@/lib/currency";
import { useCofog } from "@/data/macro/useCofog";
import { EuFlag } from "../security/euFlags";

const GEO_NAME: Record<string, { bg: string; en: string }> = {
  BG: { bg: "България", en: "Bulgaria" },
  RO: { bg: "Румъния", en: "Romania" },
  HR: { bg: "Хърватия", en: "Croatia" },
  HU: { bg: "Унгария", en: "Hungary" },
  GR: { bg: "Гърция", en: "Greece" },
  FR: { bg: "Франция", en: "France" },
  FI: { bg: "Финландия", en: "Finland" },
  AT: { bg: "Австрия", en: "Austria" },
  IT: { bg: "Италия", en: "Italy" },
  DE: { bg: "Германия", en: "Germany" },
  DK: { bg: "Дания", en: "Denmark" },
  EU27_2020: { bg: "ЕС средно", en: "EU average" },
};
const geoName = (geo: string, bg: boolean): string =>
  GEO_NAME[geo]?.[bg ? "bg" : "en"] ?? geo;

const PEER_GEOS = ["BG", "RO", "HR", "HU"] as const;

export const SocialEuPeerTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const loc = bg ? "bg-BG" : "en-US";
  const { data } = useCofog();

  const band = data?.peers?.GF10;
  const year = band?.year ?? data?.peerSeriesLatestYear;
  const row = year != null ? data?.peerSeriesByYear?.[String(year)] : undefined;
  if (!band || !row) return null;

  const countries = new Map<string, number>();
  for (const g of PEER_GEOS) {
    const v = row[g]?.GF10;
    if (v != null) countries.set(g, v);
  }
  if (band.top) countries.set(band.top.geo, band.top.pctGdp);
  const rows = [...countries.entries()]
    .map(([geo, pct]) => ({ geo, pct }))
    .sort((a, b) => b.pct - a.pct);
  if (!rows.length) return null;

  const euPct = row["EU27_2020"]?.GF10 ?? band.euAvgPctGdp ?? null;
  const max = Math.max(...rows.map((r) => r.pct), euPct ?? 0, 1);
  const topGeo = band.top?.geo ?? "BG";

  // ⚠ EVERY COMPARATIVE WORD BELOW IS DERIVED, none asserted. The previous copy
  // hardcoded the direction („под средното"), a magnitude („чувствително") and the
  // rank („не е най-ниският"), while `band` already carries bgPctGdp, euAvgPctGdp,
  // rank and total — so a Eurostat vintage that moved any of them would leave the
  // sentence stating the opposite of the chart above it, in both languages, with
  // nothing failing. MvrEuPeerTile, which this file mirrors, derives all of them.
  //
  // `euAvgPctGdp` is genuinely nullable — fetch_cofog picks the band year on BG
  // plus ≥20 member states WITHOUT requiring the EU27 aggregate — and the old
  // `?? 0` rendered that as „0,0%", so the sentence claimed 14.4% was below a 0.0%
  // average while the chart drew the EU bar at its real value. The clause is now
  // omitted entirely when there is no average to compare against.
  const euAvg = band.euAvgPctGdp;
  const gapPct =
    euAvg != null && euAvg > 0 ? (band.bgPctGdp - euAvg) / euAvg : null;
  const gapWord =
    gapPct == null
      ? { bg: "", en: "" }
      : gapPct >= 0.1
        ? { bg: "чувствително над", en: "well above" }
        : gapPct >= 0.02
          ? { bg: "над", en: "above" }
          : gapPct > -0.02
            ? { bg: "около", en: "in line with" }
            : gapPct > -0.1
              ? { bg: "под", en: "below" }
              : { bg: "чувствително под", en: "well below" };
  // Rank is 1 = highest spender, so `total` is the lowest.
  const rankWord =
    band.rank === band.total
      ? { bg: "Това е най-ниският разход в ЕС", en: "That is the lowest in the EU" } // prettier-ignore
      : band.rank === 1
        ? { bg: "Това е най-високият разход в ЕС", en: "That is the highest in the EU" } // prettier-ignore
        : { bg: `${band.rank}-о място от ${band.total}`, en: `Rank ${band.rank} of ${band.total}` }; // prettier-ignore

  const Bar: FC<{
    geo: string;
    pct: number;
    isBg?: boolean;
    isEu?: boolean;
    rank?: number;
  }> = ({ geo, pct, isBg, isEu, rank }) => (
    <div className="flex items-center gap-2">
      <span className="flex w-28 shrink-0 items-center gap-1.5">
        <EuFlag
          geo={isEu ? "EU27_2020" : geo}
          size={11}
          title={geoName(geo, bg)}
        />
        <span
          className={`truncate text-[11px] ${
            isBg ? "font-semibold text-foreground" : "text-muted-foreground"
          }`}
        >
          {geoName(geo, bg)}
        </span>
        {rank != null && (
          <span
            className={`shrink-0 rounded-full px-1 text-[9px] font-semibold leading-tight ${
              isBg
                ? "bg-primary/15 text-primary"
                : "bg-muted text-muted-foreground"
            }`}
          >
            №{rank}
          </span>
        )}
      </span>
      <div className="relative h-4 flex-1 overflow-hidden rounded bg-muted/40">
        <div
          className={`h-full rounded ${
            isBg
              ? "bg-primary"
              : isEu
                ? "bg-muted-foreground/30"
                : "bg-primary/30"
          }`}
          style={{ width: `${(pct / max) * 100}%` }}
        />
      </div>
      <span
        className={`w-12 shrink-0 text-right text-[11px] tabular-nums ${
          isBg ? "font-semibold" : "text-muted-foreground"
        }`}
      >
        {formatCount(pct, loc, 1)}%
      </span>
    </div>
  );

  return (
    <Card id="social-eu-peers">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <HandHeart className="h-4 w-4" />
          {bg ? "Социална защита — спрямо ЕС" : "Social protection — vs the EU"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-2xl font-bold tabular-nums">
            {formatCount(band.bgPctGdp, loc, 1)}%
          </span>
          <span className="text-xs text-muted-foreground">
            {bg
              ? euAvg != null
                ? `от БВП за социална защита срещу ${formatCount(euAvg, loc, 1)}% средно за ЕС (${band.year} г.)`
                : `от БВП за социална защита (${band.year} г.)`
              : euAvg != null
                ? `of GDP on social protection vs ${formatCount(euAvg, loc, 1)}% EU average (${band.year})`
                : `of GDP on social protection (${band.year})`}
          </span>
        </div>

        <div className="space-y-1.5">
          {rows.map((r) => (
            <Bar
              key={r.geo}
              geo={r.geo}
              pct={r.pct}
              isBg={r.geo === "BG"}
              rank={
                r.geo === topGeo ? 1 : r.geo === "BG" ? band.rank : undefined
              }
            />
          ))}
          {euPct != null && <Bar geo="EU27_2020" pct={euPct} isEu />}
        </div>

        <p className="text-sm leading-snug">
          {bg ? (
            <>
              България отделя{" "}
              <span className="font-semibold tabular-nums">
                {formatCount(band.bgPctGdp, loc, 1)}%
              </span>{" "}
              от БВП за социална защита
              {euAvg != null ? (
                <>
                  {" "}
                  — {gapWord.bg} средното за ЕС ({formatCount(euAvg, loc, 1)}%)
                </>
              ) : null}
              . {rankWord.bg} — а колко бедност сваля този разход, е горе.
            </>
          ) : (
            <>
              Bulgaria spends{" "}
              <span className="font-semibold tabular-nums">
                {formatCount(band.bgPctGdp, loc, 1)}%
              </span>{" "}
              of GDP on social protection
              {euAvg != null ? (
                <>
                  {" "}
                  — {gapWord.en} the EU average ({formatCount(euAvg, loc, 1)}%)
                </>
              ) : null}
              . {rankWord.en} — how much poverty that spend removes is above.
            </>
          )}
        </p>

        <p className="text-[11px] text-muted-foreground/80">
          {bg ? "Източник: " : "Source: "}
          Eurostat gov_10a_exp (COFOG GF10, % {bg ? "от БВП" : "of GDP"})
        </p>
      </CardContent>
    </Card>
  );
};
