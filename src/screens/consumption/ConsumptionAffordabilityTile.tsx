// "Достъпност на кошницата спрямо доходите в региона" — the affordability tile.
// Pairs each oblast's КЗП basket cost (ranking.json) with its regional income
// proxy (Eurostat GDP-per-capita, regional.json) so the same basket reads as a
// bigger burden in a poor oblast than a rich one — the "real cost of living"
// angle, a stand-in for the (Cloudflare-walled) per-oblast net-wage index.
//
// Metric: basket € relative to GDP-per-capita. The exact scaling is constant
// across oblasti, so the RANK is robust; we lead with the rank and show the two
// raw numbers (basket €, GDP/capita €) so the comparison is transparent.
// GDP/capita is regional OUTPUT per person, NOT household net wage — labelled.
//
// national (no oblast): most- / least-affordable leaderboards.
// oblast: that oblast's basket €, GDP/capita € and affordability rank.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { usePriceRanking, fmtEur } from "@/data/prices/usePrices";
import { useRegional } from "@/data/regional/useRegional";

interface Props {
  oblast?: string;
}

type Row = {
  code: string;
  name: string;
  basket: number;
  gpc: number;
  share: number; // ranking key: annualized basket ÷ annual GDP/capita
};

export const ConsumptionAffordabilityTile: FC<Props> = ({ oblast }) => {
  const { i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const T = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const { data: ranking } = usePriceRanking();
  const { data: regional } = useRegional();

  // NB: these ranking rules — skip PDV-00 (Plovdiv-city double-count), collapse
  // S23/S24/S25 into one Sofia-city row, and the `share` formula — are mirrored
  // in the AI tool `basketAffordability` (ai/tools/prices.ts). The ai/ layer is
  // separately compiled and can't import src/, so keep the two copies in sync.
  const rows = useMemo<Row[]>(() => {
    if (!ranking || !regional) return [];
    const gdp = regional.series.gdpPerCapita ?? {};
    const latestGpc = (code: string): number | undefined => {
      const g = gdp[code];
      return g && g.length ? g[g.length - 1].value : undefined;
    };
    const out: Row[] = [];
    // Sofia city is split into three МИР oblast rows (S23/S24/S25) in the price
    // ranking — same city, same GDP, and they render with bare-number names.
    // Collapse them into one "София (столица)" entry so the leaderboard isn't
    // cluttered with three near-duplicates.
    const sofiaParts: number[] = [];
    let sofiaGpc: number | undefined;
    for (const p of ranking.places) {
      if (p.tier !== "oblast" || p.basketLevel == null) continue;
      const gpc = latestGpc(p.code);
      if (!gpc || gpc <= 0) continue;
      if (/^S2[345]$/.test(p.code)) {
        sofiaParts.push(p.basketLevel);
        sofiaGpc = gpc;
        continue;
      }
      // PDV-00 is the Plovdiv-CITY МИР — a sub-oblast electoral district inside
      // the PDV oblast (already listed), not a separate oblast. Skip it so
      // Plovdiv isn't double-counted. (Sofia differs: its 3 МИР together ARE the
      // София-град oblast, so they're consolidated below rather than skipped.)
      if (p.code === "PDV-00") continue;
      out.push({
        code: p.code,
        name: p.name,
        basket: p.basketLevel,
        gpc,
        // share = annualized basket cost ÷ annual GDP-per-capita; the ×52 is a
        // constant across oblasti, so only the RANK is meaningful here.
        share: (p.basketLevel * 52) / gpc,
      });
    }
    if (sofiaParts.length && sofiaGpc) {
      const basket = sofiaParts.reduce((a, b) => a + b, 0) / sofiaParts.length;
      out.push({
        code: "SOF_CITY",
        name: T("София (столица)", "Sofia (capital)"),
        basket,
        gpc: sofiaGpc,
        share: (basket * 52) / sofiaGpc,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranking, regional, lang]);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => a.share - b.share),
    [rows],
  ); // ascending share = most affordable first

  if (!ranking || !regional) return null;
  if (sorted.length < 5) return null; // not enough joined oblasts to rank

  const N = sorted.length;
  const gpcMeta = regional.indicators?.gdpPerCapita;
  const gpcUrl = gpcMeta?.sourceUrl;
  const note = T(
    "Достъпност = цена на кошницата спрямо БВП на човек в областта (Евростат). БВП на човек е приблизителен измерител на регионалния доход, не нетна работна заплата.",
    "Affordability = basket cost relative to the oblast's GDP-per-capita (Eurostat). GDP-per-capita is a proxy for regional income, not net household wage.",
  );

  // EUR per project convention: BG suffix "25 хил. €", EN prefix "€25k"
  // (matches fmtEur + the AI tool's gpcLabel).
  const gpcLabel = (n: number) => {
    const v = Math.round(n / 100) / 10;
    return lang === "bg" ? `${v} хил. €` : `€${v}k`;
  };

  // ── Single-oblast view ────────────────────────────────────────────────────
  if (oblast) {
    // Sofia МИР codes resolve to the consolidated city entry.
    const lookup = /^S2[345]$/.test(oblast) ? "SOF_CITY" : oblast;
    const me = rows.find((r) => r.code === lookup);
    if (!me) return null;
    const rank = sorted.findIndex((r) => r.code === lookup) + 1;
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <div>
            <div className="text-2xl font-bold tabular-nums">
              {T(`${rank}-о от ${N}`, `#${rank} of ${N}`)}
            </div>
            <div className="text-xs text-muted-foreground">
              {T("по достъпност на кошницата", "by basket affordability")}
            </div>
          </div>
          <div className="text-sm">
            <div className="text-muted-foreground text-xs">
              {T("Кошница", "Basket")}
            </div>
            <div className="font-semibold tabular-nums">
              {fmtEur(me.basket, lang)}
            </div>
          </div>
          <div className="text-sm">
            <div className="text-muted-foreground text-xs">
              {T("БВП на човек", "GDP per capita")}
            </div>
            <div className="font-semibold tabular-nums">{gpcLabel(me.gpc)}</div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{note}</p>
        {gpcUrl ? (
          <a
            href={gpcUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-primary hover:underline"
          >
            {T("Източник: Евростат (БВП)", "Source: Eurostat (GDP)")}
          </a>
        ) : null}
      </div>
    );
  }

  // ── National leaderboards ─────────────────────────────────────────────────
  // Cap each side to half the field so the two columns never share a row when
  // coverage is sparse (5 ≤ N ≤ 7 would otherwise overlap).
  const half = Math.min(4, Math.floor(N / 2));
  const most = sorted.slice(0, half);
  const least = sorted.slice(-half).reverse();

  const list = (items: Row[]) => (
    <ul className="space-y-0.5 text-sm">
      {items.map((r) => (
        <li key={r.code} className="flex justify-between gap-2">
          <span className="truncate min-w-0">{r.name}</span>
          <span className="tabular-nums shrink-0 text-muted-foreground whitespace-nowrap">
            {fmtEur(r.basket, lang)}
            <span className="opacity-60"> · {gpcLabel(r.gpc)}</span>
          </span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="font-medium text-sm mb-1 text-green-700 dark:text-green-400">
            {T("Най-достъпни области", "Most affordable oblasts")}
          </div>
          {list(most)}
        </div>
        <div>
          <div className="font-medium text-sm mb-1 text-red-700 dark:text-red-400">
            {T("Най-недостъпни области", "Least affordable oblasts")}
          </div>
          {list(least)}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{note}</p>
      {gpcUrl ? (
        <a
          href={gpcUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-primary hover:underline"
        >
          {T("Източник: Евростат (БВП)", "Source: Eurostat (GDP)")}
        </a>
      ) : null}
    </div>
  );
};
