// /sector/:id — the generic sector dashboard. Gives every state sector a proper
// landing page (not a deep-link into one institution's awarder page): a group
// KPI overview rolled up over the sector's awarder EIK-set, an optional bespoke
// thematic-tiles slot, and the SectorAwardersTile listing the member
// institutions — each deep-linking to its own /awarder/:eik page.
//
// The anatomy mirrors WaterScreen (breadcrumb up to the sectors hub + the shared
// ?pscope control + tiles), but this shell is config-driven (SECTOR_DASHBOARDS)
// so a sector graduates by adding config, not a bespoke screen.

import { FC, Suspense, useCallback, useMemo } from "react";
import { useParams, Navigate, Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { Title } from "@/ux/Title";
import { Card, CardContent } from "@/ux/Card";
import { SectorBreadcrumb } from "@/screens/components/procurement/SectorBreadcrumb";
import { ScopeControl } from "@/screens/components/ScopeControl";
import { getSectorPack } from "@/screens/components/procurement/sectorPacks";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import { useAwarderGroupModel } from "@/data/procurement/useAwarderGroupModel";
import {
  buildAwarderModelFromAggregates,
  type GroupModelPayload,
  type SectorClassifier,
} from "@/lib/awarderModel";
import { formatEurCompact } from "@/lib/currency";
import {
  getSectorDashboard,
  sectorMemberEiks,
  type SectorDashboardConfig,
} from "./sectorDashboards";
import { SectorAwardersTile } from "./SectorAwardersTile";
import {
  SectorSpendByYearTile,
  SectorTopContractorsTile,
} from "./SectorCharts";
import { SECTORS_HUB_PATH } from "@/screens/components/procurement/SectorBreadcrumb";

// The generic dashboard needs headline money/competition, not a CPV taxonomy —
// fold every contract into one bucket.
const GENERIC_CLASSIFIER: SectorClassifier<"all"> = {
  categoryOf: () => "all",
};

const KpiCard: FC<{ label: string; value: string; sub?: string }> = ({
  label,
  value,
  sub,
}) => (
  <Card>
    <CardContent className="p-3 md:p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {sub && (
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {sub}
        </div>
      )}
    </CardContent>
  </Card>
);

const Dashboard: FC<{ config: SectorDashboardConfig }> = ({ config }) => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const locale = bg ? "bg-BG" : "en-US";

  // The sector's domain-specific pack (e.g. the НЗОК hospital-payments hero, the
  // roads km/delivery tiles) — the disbursement/delivery substance that used to
  // sit on the awarder page. When present it IS the dashboard's content, so the
  // generic ЗОП KPI row + top-contractors/by-year charts are skipped (the pack
  // leads with its own, richer framing) and the group-model fetch is disabled.
  const scopeWindow = useScopeWindow();
  const Pack = getSectorPack(config.leadEik);

  const eiks = useMemo(() => sectorMemberEiks(config), [config]);
  const build = useCallback(
    (p: GroupModelPayload) =>
      buildAwarderModelFromAggregates(p, GENERIC_CLASSIFIER),
    [],
  );
  const { model, byUnit, isLoading } = useAwarderGroupModel(
    eiks,
    build,
    undefined,
    !Pack,
  );

  const top = model?.suppliers[0] ?? null;
  const awarderN = byUnit.filter((u) => (u.totalEur ?? 0) > 0).length;
  const ThematicTiles = config.ThematicTiles;
  const browsePackId = config.browsePackId ?? config.id;
  // Mirror each chart tile's own render condition so a lone survivor (e.g.
  // spend-by-year needs ≥2 years, absent on a narrow scope) spans full width
  // instead of leaving an empty grid half.
  const showSpendChart =
    (model?.years.filter((y) => y.totalEur > 0).length ?? 0) >= 2;
  const showTopChart = (model?.suppliers.length ?? 0) >= 2;

  // "All sector contracts" must carry the active time scope (?pscope) forward —
  // same convention as the procurement nav — so a narrowed scope survives the
  // jump to the contracts browser instead of silently resetting.
  const [searchParams] = useSearchParams();
  const contractsTo = useMemo(() => {
    const params = new URLSearchParams(searchParams);
    params.set("sector", browsePackId);
    return {
      pathname: "/procurement/contracts",
      search: `?${params.toString()}`,
    };
  }, [searchParams, browsePackId]);

  return (
    <div className="space-y-4" id="sector-dashboard">
      <Title description={t(config.descKey)}>{t(config.titleKey)}</Title>

      <SectorBreadcrumb currentKey={config.titleKey} />

      <div className="mb-3">
        <ScopeControl mode="toggle" />
      </div>

      {Pack ? (
        // Pack-backed sector: the disbursement/delivery pack is the content.
        <Suspense
          fallback={
            <div className="h-[280px] animate-pulse rounded-xl border bg-card" />
          }
        >
          <Pack eik={config.leadEik} scopeWindow={scopeWindow} />
        </Suspense>
      ) : isLoading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-[86px] animate-pulse rounded-xl border bg-card"
            />
          ))}
        </div>
      ) : model && model.totalEur > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard
              label={bg ? "Общо възложени" : "Total awarded"}
              value={formatEurCompact(model.totalEur, locale)}
            />
            <KpiCard
              label={bg ? "Договори" : "Contracts"}
              value={model.contractCount.toLocaleString(locale)}
            />
            <KpiCard
              label={bg ? "Изпълнители" : "Contractors"}
              value={model.supplierCount.toLocaleString(locale)}
              sub={
                config.members.length > 1
                  ? bg
                    ? `${awarderN} възложители`
                    : `${awarderN} awarders`
                  : undefined
              }
            />
            <KpiCard
              label={bg ? "Топ изпълнител" : "Top contractor"}
              value={top ? formatEurCompact(top.totalEur, locale) : "—"}
              sub={top?.name}
            />
          </div>
          {showSpendChart && showTopChart ? (
            <div className="grid gap-4 md:grid-cols-2">
              <SectorSpendByYearTile model={model} />
              <SectorTopContractorsTile model={model} />
            </div>
          ) : (
            <>
              {showSpendChart && <SectorSpendByYearTile model={model} />}
              {showTopChart && <SectorTopContractorsTile model={model} />}
            </>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {bg
            ? "Няма договори в избрания обхват."
            : "No contracts in the selected scope."}
        </p>
      )}

      {ThematicTiles && (
        <Suspense
          fallback={
            <div className="h-[200px] animate-pulse rounded-xl border bg-card" />
          }
        >
          <ThematicTiles />
        </Suspense>
      )}

      <SectorAwardersTile config={config} />

      <div className="flex flex-wrap gap-3 pt-1 text-sm">
        <Link
          to={contractsTo}
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          {bg ? "Всички договори на сектора" : "All sector contracts"}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
        <Link
          to={SECTORS_HUB_PATH}
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          {bg ? "Всички сектори" : "All sectors"}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
};

export const SectorDashboardScreen: FC = () => {
  const { id } = useParams<{ id: string }>();
  const config = getSectorDashboard(id);
  if (!config) return <Navigate to={SECTORS_HUB_PATH} replace />;
  // Key on id so the hooks reset cleanly when navigating sector→sector.
  return <Dashboard key={config.id} config={config} />;
};
