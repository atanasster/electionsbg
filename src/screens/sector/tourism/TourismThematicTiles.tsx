// Tourism-specific thematic tiles rendered on the generic /sector/tourism
// dashboard (via SECTOR_DASHBOARDS.tourism.ThematicTiles) between the KPI row
// and the awarders bridge. МТ's ~€27M is overwhelmingly destination marketing,
// so these two tiles tell that story: WHAT the money buys (campaign categories)
// and the BIGGEST individual campaigns by name.
//
// Both inherit ?pscope date scoping. The category split re-folds the SAME server
// group-model the dashboard already fetches (deduped by react-query on the
// eik-set + window → free). The campaigns list pulls МТ's 300-row corpus once
// (cheap for a single small awarder) so it can name contracts + flag EU funding
// and single-bid awards — detail the aggregate model doesn't carry.

import { FC, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { useAwarderGroupModel } from "@/data/procurement/useAwarderGroupModel";
import {
  useAwarderContracts,
  scopeByWindow,
} from "@/data/procurement/useAwarderContracts";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import {
  buildAwarderModelFromAggregates,
  type GroupModelPayload,
} from "@/lib/awarderModel";
import { TOURISM_MINISTRY_EIK } from "@/lib/tourismReferenceData";
import {
  tourismClassifier,
  TOURISM_CAT_LABELS,
  type TourismCat,
} from "./tourismCategories";
import { TourismSeasonalityTile } from "./TourismSeasonalityTile";
import { TourismSourceMarketsTile } from "./TourismSourceMarketsTile";
import { TourismSpendVsNightsTile } from "./TourismSpendVsNightsTile";

const EIKS = [TOURISM_MINISTRY_EIK] as const;

const CardSkeleton: FC = () => (
  <div className="h-[220px] animate-pulse rounded-xl border bg-card" />
);

/** Campaign-category split (CPV → advertising / events / digital / …). */
const CampaignCategoriesTile: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const locale = bg ? "bg-BG" : "en-US";

  const build = useCallback(
    (p: GroupModelPayload) =>
      buildAwarderModelFromAggregates(p, tourismClassifier),
    [],
  );
  const { model, isLoading } = useAwarderGroupModel<TourismCat>(EIKS, build);

  if (isLoading) return <CardSkeleton />;

  const cats = (model?.categories ?? []).filter((c) => c.totalEur > 0);
  if (cats.length < 2) return null;

  const total = model?.totalEur || 1;
  const max = cats[0].totalEur || 1;
  const lead = cats[0];
  const leadPct = Math.round((lead.totalEur / total) * 100);

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {bg ? "Разход по кампании" : "Spend by campaign type"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {bg
            ? `Договорите на МТ по CPV — ${TOURISM_CAT_LABELS[lead.id]?.bg ?? lead.id} води с ${leadPct}%.`
            : `MT contracts by CPV — ${TOURISM_CAT_LABELS[lead.id]?.en ?? lead.id} leads with ${leadPct}%.`}
        </p>
      </CardHeader>
      <CardContent className="space-y-2.5 p-3 md:p-4">
        {cats.map((c) => {
          const label = TOURISM_CAT_LABELS[c.id]?.[bg ? "bg" : "en"] ?? c.id;
          const pct = (c.totalEur / total) * 100;
          const singleBid =
            c.singleBidShare != null
              ? Math.round(c.singleBidShare * 100)
              : null;
          return (
            <div key={c.id} className="text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate font-medium">{label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatEurCompact(c.totalEur, locale)} · {pct.toFixed(0)}%
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="relative h-2.5 flex-1 overflow-hidden rounded bg-muted/40">
                  <div
                    className="absolute inset-y-0 left-0 rounded bg-primary/70"
                    style={{
                      width: `${Math.max(2, (c.totalEur / max) * 100)}%`,
                    }}
                  />
                </div>
                <span
                  className="w-24 shrink-0 truncate text-right text-xs text-muted-foreground"
                  title={c.topSupplier?.name ?? undefined}
                >
                  {c.topSupplier ? (
                    <Link
                      to={`/company/${c.topSupplier.eik}`}
                      className="text-primary hover:underline"
                    >
                      {c.topSupplier.name}
                    </Link>
                  ) : (
                    ""
                  )}
                </span>
              </div>
              {singleBid != null && (
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {c.contractCount} {bg ? "договора" : "contracts"}
                  {" · "}
                  {bg ? "единствена оферта" : "single bid"} {singleBid}%
                </div>
              )}
            </div>
          );
        })}
        <p className="pt-1 text-[11px] text-muted-foreground">
          {bg
            ? "Класификация по CPV. Пълната разбивка — на страницата на възложителя."
            : "Classified by contract CPV. Full breakdown on the awarder page."}
        </p>
      </CardContent>
    </Card>
  );
};

/** The biggest individual contracts (named campaigns) in the current scope. */
const TopCampaignsTile: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const locale = bg ? "bg-BG" : "en-US";
  const { from, to } = useScopeWindow();
  const [params] = useSearchParams();
  const { data, isLoading } = useAwarderContracts(TOURISM_MINISTRY_EIK);

  if (isLoading) return <CardSkeleton />;

  const rows = scopeByWindow(data?.contracts ?? [], from, to)
    .filter((c) => c.tag === "contract" && (c.amountEur ?? 0) > 0)
    .sort((a, b) => (b.amountEur ?? 0) - (a.amountEur ?? 0))
    .slice(0, 6);
  if (rows.length < 2) return null;

  // "See all" → the sector-filtered browse table, carrying the current scope
  // (pscope + elections) forward so the list matches the tile's window.
  const seeAllParams = new URLSearchParams(params);
  seeAllParams.set("sector", "tourism");
  const seeAllTo = {
    pathname: "/procurement/contracts",
    search: `?${seeAllParams.toString()}`,
  };

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">
            {bg ? "Най-големи кампании" : "Biggest campaigns"}
          </CardTitle>
          <Link
            to={seeAllTo}
            className="mt-0.5 shrink-0 text-xs font-medium text-primary hover:underline"
          >
            {bg ? "виж всички →" : "see all →"}
          </Link>
        </div>
        <p className="text-xs text-muted-foreground">
          {bg
            ? "Най-скъпите отделни договори в обхвата."
            : "The costliest individual contracts in scope."}
        </p>
      </CardHeader>
      <CardContent className="space-y-3 p-3 md:p-4">
        {rows.map((c) => (
          <div key={c.key} className="text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <Link
                to={`/procurement/contract/${c.key}`}
                className="min-w-0 truncate text-primary hover:underline"
                title={c.title}
              >
                {c.title || "—"}
              </Link>
              <span className="shrink-0 font-medium tabular-nums">
                {formatEurCompact(c.amountEur ?? 0, locale)}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
              {c.contractorEik ? (
                <Link
                  to={`/company/${c.contractorEik}`}
                  className="max-w-[60%] truncate text-primary hover:underline"
                  title={c.contractorName}
                >
                  {c.contractorName}
                </Link>
              ) : (
                <span className="max-w-[60%] truncate">{c.contractorName}</span>
              )}
              <span className="tabular-nums">
                · {(c.date ?? "").slice(0, 4)}
              </span>
              {c.euFunded && (
                <span className="rounded bg-primary/10 px-1 font-medium text-primary">
                  {bg ? "ЕС" : "EU"}
                </span>
              )}
              {c.numberOfTenderers === 1 && (
                <span>· {bg ? "1 оферта" : "1 bid"}</span>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

export const TourismThematicTiles: FC = () => (
  <div className="space-y-4">
    {/* Visitor-outcome row: who comes and when (Eurostat). */}
    <div className="grid gap-4 md:grid-cols-2">
      <TourismSeasonalityTile />
      <TourismSourceMarketsTile />
    </div>
    {/* The fusion: marketing spend vs the visitor outcome it targets. */}
    <TourismSpendVsNightsTile />
    {/* Procurement-detail row: where the money goes (ЗОП). */}
    <div className="grid gap-4 md:grid-cols-2">
      <CampaignCategoriesTile />
      <TopCampaignsTile />
    </div>
  </div>
);
