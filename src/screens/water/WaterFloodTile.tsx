// "Почистване на речни корита — къде отиват парите" — the Tier-A maintenance-spend
// half of the flood-risk feature (docs/plans/water-view-v1.md §4.5b). Riverbed-
// cleaning / river-regulation / dere works from the procurement corpus, with the
// responsibility split (Напоителни системи vs municipalities — the "chaos" the
// deadly Царево 2023 / Свети Влас 2024 floods exposed). The РЗПРН flood-risk
// geodata half (who is AT RISK, and the at-risk-but-unmaintained join) is a later
// phase — this shows only who spent, so it is framed as spend, not as a verdict.

import { FC, useMemo } from "react";
import { Link } from "react-router-dom";
import { useScopedHref } from "@/data/scope/useScope";
import { useTranslation } from "react-i18next";
import { Waves } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { useFloodMaintenance } from "@/data/water/useFloodMaintenance";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import { buildFloodModel } from "@/lib/floodModel";
import { WaterFloodMap } from "./WaterFloodMap";

export const WaterFloodTile: FC = () => {
  // Carry the active scope (pscope/elections) onto the awarder page — a bare
  // pathname resets it to the default window (see SectorAwardersTile).
  const scopedHref = useScopedHref();
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data, isLoading } = useFloodMaintenance();
  // Re-aggregate to the page's ?pscope window (like every other pack) rather
  // than showing the whole-corpus precomputed figures.
  const { from, to } = useScopeWindow();
  const model = useMemo(
    () => (data ? buildFloodModel(data.contracts, from, to) : null),
    [data, from, to],
  );

  if (isLoading)
    return (
      <div className="h-[280px] animate-pulse rounded-xl border bg-card" />
    );
  if (!data || !model) return null;
  if (model.totalEur <= 0)
    return (
      <Card id="flood">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Waves className="h-4 w-4" />
            {bg
              ? "Почистване на речни корита — къде отиват парите"
              : "Riverbed cleaning — where the money goes"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 md:p-4">
          <p className="text-sm text-muted-foreground">
            {bg
              ? "Няма договори за почистване на речни корита в избрания обхват."
              : "No riverbed-cleaning contracts in the selected scope."}
          </p>
        </CardContent>
      </Card>
    );

  const napShare =
    model.totalEur > 0 ? model.napoitelniEur / model.totalEur : 0;
  const top = model.topAwarders.slice(0, 10);
  const max = Math.max(...top.map((a) => a.eur), 1);
  const yearMax = Math.max(...model.byYear.map((y) => y.eur), 1);
  const topContracts = model.topContracts.slice(0, 5);

  return (
    <Card id="flood">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Waves className="h-4 w-4" />
          {bg
            ? "Почистване на речни корита — къде отиват парите"
            : "Riverbed cleaning — where the money goes"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <div className="text-xl font-bold tabular-nums">
              {formatEurCompact(model.totalEur, lang)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {bg
                ? "общо за почистване/корекция"
                : "total on cleaning/regulation"}
            </div>
          </div>
          <div>
            <div className="text-xl font-bold tabular-nums">
              {model.contractCount.toLocaleString(lang)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {bg ? "договора" : "contracts"}
            </div>
          </div>
          <div>
            <div className="text-xl font-bold tabular-nums">
              {model.awarderCount.toLocaleString(lang)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {bg ? "възложителя" : "awarders"}
            </div>
          </div>
          <div>
            <div className="text-xl font-bold tabular-nums">
              {Math.round(napShare * 100)}%
            </div>
            <div className="text-[11px] text-muted-foreground">
              {bg ? "от Напоителни системи" : "by Irrigation Systems"}
            </div>
          </div>
        </div>

        {model.byOblast.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              {bg ? "Разходи по области" : "Spend by oblast"}
            </div>
            <WaterFloodMap byOblast={model.byOblast} />
          </div>
        )}

        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">
            {bg ? "Водещи възложители" : "Top awarders"}
          </div>
          {top.map((a) => (
            <div key={a.eik} className="text-xs">
              <div className="flex items-baseline justify-between gap-2">
                <Link
                  to={scopedHref(`/awarder/${a.eik}`)}
                  className="min-w-0 truncate hover:text-primary hover:underline"
                >
                  {a.name}
                </Link>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatEurCompact(a.eur, lang)}{" "}
                  <span className="text-muted-foreground/70">{a.count}</span>
                </span>
              </div>
              <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-cyan-600"
                  style={{ width: `${Math.max(2, (a.eur / max) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        {model.byYear.length > 1 && (
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              {bg ? "По години" : "By year"}
            </div>
            <div className="flex items-end gap-0.5" style={{ height: 40 }}>
              {model.byYear.map((y) => (
                <div
                  key={y.year}
                  className="group relative flex-1"
                  title={`${y.year}: ${formatEurCompact(y.eur, lang)} · ${y.count}`}
                >
                  <div
                    className="w-full rounded-sm bg-cyan-600/70"
                    style={{ height: Math.max(2, (y.eur / yearMax) * 40) }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground/70">
              <span>{model.byYear[0].year}</span>
              <span>{model.byYear[model.byYear.length - 1].year}</span>
            </div>
          </div>
        )}

        {topContracts.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">
              {bg ? "Най-големи договори" : "Largest contracts"}
            </div>
            {topContracts.map((c) => (
              <div
                key={c.key}
                className="flex items-baseline justify-between gap-2 text-xs"
              >
                <Link
                  to={`/procurement/contract/${c.key}`}
                  className="min-w-0 truncate hover:text-primary hover:underline"
                >
                  {c.title || "—"}
                </Link>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatEurCompact(c.eur, lang)}
                </span>
              </div>
            ))}
          </div>
        )}

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Договори за почистване, корекция и укрепване на речни корита и дерета (АОП/ЦАИС ЕОП, по CPV и предмет). Отговорността е поделена между общини, областни управители и „Напоителни системи“ — разпределение, което трагичните наводнения в Царево (2023) и Свети Влас (2024) извадиха наяве. Тук показваме похарченото за поддръжка."
            : "Contracts for cleaning, regulation and reinforcement of riverbeds and gullies (АОП/ЦАИС ЕОП, by CPV and subject). Responsibility is split between municipalities, regional governors and Irrigation Systems — the split the deadly Tsarevo (2023) and Sveti Vlas (2024) floods exposed. This shows the maintenance spend."}
        </p>
      </CardContent>
    </Card>
  );
};
