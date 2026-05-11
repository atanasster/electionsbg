import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, MapPin, Vote, X } from "lucide-react";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";
import { SEO } from "@/ux/SEO";
import { H1 } from "@/ux/H1";
import type { MapCoordinates } from "@/layout/dataview/MapLayout";
import { useNationalSummary } from "@/data/dashboard/useNationalSummary";
import {
  useRegionWastedVotes,
  useWastedVoteDashboard,
  type WastedVoteTopRow,
} from "@/data/wastedVote/useWastedVote";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { SOFIA_REGIONS } from "@/data/dataTypes";
import { formatPct, formatThousands } from "@/data/utils";
import { StatCard } from "@/screens/dashboard/StatCard";
import { WastedVoteRegionsMap } from "./components/wastedVote/WastedVoteRegionsMap";
import regionsJson from "@/data/json/regions.json";

type RegionMeta = {
  oblast: string;
  name?: string;
  name_en?: string;
  long_name?: string;
  long_name_en?: string;
};

const regionLabel = (key: string, isBg: boolean): string => {
  const info = (regionsJson as RegionMeta[]).find((r) => r.oblast === key);
  if (!info) return key;
  return (
    (isBg ? info.long_name || info.name : info.long_name_en || info.name_en) ||
    key
  );
};

// Tile body: top-N rows with name + share, mirrors the visual rhythm of
// TopRegionsTile but stripped to two columns (name + %) so it works at
// dashboard-tile width on every breakpoint.
const TopList: React.FC<{ rows: WastedVoteTopRow[]; isBg: boolean }> = ({
  rows,
  isBg,
}) => {
  const maxShare = Math.max(1, ...rows.map((r) => r.share));
  if (!rows.length)
    return <div className="text-xs text-muted-foreground">—</div>;
  return (
    <div className="flex flex-col gap-1.5 mt-1">
      {rows.map((r) => {
        const name = (isBg ? r.name_bg : r.name_en) || r.key;
        const region = isBg ? r.region_name_bg : r.region_name_en;
        return (
          <div
            key={r.key}
            className="grid grid-cols-[minmax(0,1fr)_minmax(40px,1fr)_auto] items-center gap-x-3 text-sm"
          >
            <div className="min-w-0">
              <div className="truncate font-medium text-xs">{name}</div>
              {region && (
                <div className="truncate text-[10px] text-muted-foreground">
                  {region}
                </div>
              )}
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-orange-500/80"
                style={{ width: `${Math.max(4, (r.share / maxShare) * 100)}%` }}
              />
            </div>
            <span className="tabular-nums text-xs font-semibold text-right">
              {formatPct(r.share, 2)}
            </span>
          </div>
        );
      })}
    </div>
  );
};

const HEADER_ROW =
  "flex items-center justify-between w-full text-xs font-medium uppercase tracking-wide";

const TileHeader: React.FC<{
  icon: React.ReactNode;
  title: string;
  hint?: string;
  to: string;
  seeDetailsLabel: string;
}> = ({ icon, title, hint, to, seeDetailsLabel }) => (
  <div className={HEADER_ROW}>
    <Hint text={hint ?? ""} underline={false}>
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span>{title}</span>
      </div>
    </Hint>
    <Link
      to={to}
      className="text-[10px] normal-case text-primary hover:underline flex items-center"
      underline={false}
    >
      {seeDetailsLabel} <ChevronRight className="h-3 w-3" />
    </Link>
  </div>
);

export const WastedVoteScreen = () => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const { data: summary } = useNationalSummary();
  const { data: regions } = useRegionWastedVotes();
  const { data: dashboard } = useWastedVoteDashboard();
  const { findParty } = usePartyInfo();

  const [selectedKey, setSelectedKey] = useState<string | undefined>(undefined);

  // Inline map sizer — keeps the map at dashboard-tile height (matches
  // RegionsMapTile on the home page) rather than MapLayout's much taller
  // min-h that's intended for full-page map views.
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapSize, setMapSize] = useState<MapCoordinates | undefined>();
  useLayoutEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const measure = () =>
      setMapSize([
        el.offsetWidth,
        el.offsetHeight,
        el.offsetLeft,
        el.offsetTop,
      ]);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const wasted = summary?.wastedVotes;

  const sofia = useMemo(() => {
    if (!regions) return undefined;
    const rows = regions.filter((r) => SOFIA_REGIONS.includes(r.key));
    if (!rows.length) return undefined;
    const wastedVotes = rows.reduce((s, r) => s + r.wastedVotes, 0);
    const validVotes = rows.reduce((s, r) => s + r.validVotes, 0);
    return {
      wastedVotes,
      validVotes,
      share: validVotes
        ? Math.round((10000 * wastedVotes) / validVotes) / 100
        : 0,
    };
  }, [regions]);

  // Selected region details — shown inline below the map when a region is
  // clicked, in place of the regions list. Pulled from the regional rollup
  // we already loaded, so no extra fetch.
  const selectedRegion = useMemo(() => {
    if (!selectedKey || !regions) return undefined;
    return regions.find((r) => r.key === selectedKey);
  }, [selectedKey, regions]);

  return (
    <div className="pb-12">
      <SEO
        title={t("wasted_votes_title")}
        description={t("wasted_votes_description")}
      />
      <div className="py-4 md:py-6">
        <H1 className="text-xl md:text-2xl font-bold text-foreground">
          {t("wasted_votes_title")}
        </H1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl mx-auto text-center">
          {t("wasted_votes_description")}
        </p>
      </div>

      {/* Top KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <StatCard
          label={
            <Hint text={t("wasted_votes_share_hint")} underline={false}>
              <span>{t("wasted_votes_share_national")}</span>
            </Hint>
          }
        >
          <div className="text-2xl md:text-3xl font-bold tabular-nums">
            {formatPct(wasted?.share, 2)}
          </div>
          <div className="text-[11px] text-muted-foreground tabular-nums">
            {wasted
              ? `${formatThousands(wasted.wastedVotes)} / ${formatThousands(wasted.validVotes)}`
              : ""}
          </div>
        </StatCard>
        <StatCard
          label={
            <Hint text={t("wasted_votes_almost_hint")} underline={false}>
              <span>{t("wasted_votes_almost_made_it")}</span>
            </Hint>
          }
        >
          <div className="text-2xl md:text-3xl font-bold tabular-nums">
            {formatPct(wasted?.almostMadeItShare, 2)}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {t("wasted_votes_almost_caption")}
          </div>
        </StatCard>
        <StatCard
          label={
            <Hint text={t("wasted_votes_fringe_hint")} underline={false}>
              <span>{t("wasted_votes_fringe")}</span>
            </Hint>
          }
        >
          <div className="text-2xl md:text-3xl font-bold tabular-nums">
            {formatPct(wasted?.fringeShare, 2)}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {t("wasted_votes_fringe_caption")}
          </div>
        </StatCard>
      </div>

      {/* Map + below-threshold parties */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3 mb-3">
        <StatCard
          label={
            <div className={HEADER_ROW}>
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4" />
                <span>{t("wasted_votes_by_region")}</span>
              </div>
              {selectedKey && (
                <button
                  onClick={() => setSelectedKey(undefined)}
                  className="text-[10px] normal-case text-primary hover:underline flex items-center gap-1"
                >
                  <X className="h-3 w-3" />
                  {t("wasted_votes_clear_selection")}
                </button>
              )}
            </div>
          }
          className="overflow-hidden"
        >
          <div ref={mapRef} className="w-full h-[300px] md:h-[380px]">
            {mapSize && (
              <WastedVoteRegionsMap
                size={mapSize}
                selectedKey={selectedKey}
                onSelect={setSelectedKey}
              />
            )}
          </div>

          {/* Drill-down: selected region details, or Sofia city aggregate */}
          {selectedRegion ? (
            <div className="border-t mt-2 pt-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="font-semibold text-sm">
                    {regionLabel(selectedRegion.key, isBg)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {formatThousands(selectedRegion.wastedVotes)} /{" "}
                    {formatThousands(selectedRegion.validVotes)}
                  </div>
                </div>
                <div className="text-2xl font-bold tabular-nums">
                  {formatPct(selectedRegion.share, 2)}
                </div>
              </div>
              {selectedRegion.topParties.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t("wasted_votes_top_parties")}
                  </div>
                  {selectedRegion.topParties.slice(0, 4).map((p) => {
                    const party = findParty(p.partyNum);
                    return (
                      <div
                        key={p.partyNum}
                        className="flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="inline-block w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: party?.color || "#888" }}
                          />
                          <span className="truncate font-medium">
                            {party?.nickName || party?.name || `#${p.partyNum}`}
                          </span>
                        </div>
                        <span className="tabular-nums font-mono">
                          {formatPct(p.share, 2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : sofia ? (
            <div className="border-t mt-2 pt-3 flex items-center justify-between">
              <div>
                <div className="font-semibold text-sm">{t("sofia_city")}</div>
                <div className="text-[11px] text-muted-foreground">
                  {t("wasted_votes_sofia_caption")}
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold tabular-nums">
                  {formatPct(sofia.share, 2)}
                </div>
                <div className="text-[10px] text-muted-foreground tabular-nums">
                  {formatThousands(sofia.wastedVotes)} /{" "}
                  {formatThousands(sofia.validVotes)}
                </div>
              </div>
            </div>
          ) : null}
        </StatCard>

        {/* Parties below threshold — compact color-dot rows */}
        <StatCard
          label={
            <div className={HEADER_ROW}>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Vote className="h-4 w-4" />
                <span>{t("wasted_votes_top_parties")}</span>
              </div>
            </div>
          }
          className="overflow-hidden"
        >
          <div className="flex flex-col gap-1 mt-1">
            {wasted?.parties.slice(0, 8).map((p) => {
              const party = findParty(p.partyNum);
              const maxPct = wasted.parties[0]?.pct || 1;
              return (
                <Link
                  key={p.partyNum}
                  to={`/party/${party?.nickName ?? p.partyNum}`}
                  underline={false}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(60px,1.2fr)_auto] items-center gap-x-3 hover:bg-muted/40 rounded-md px-1 py-1 -mx-1 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: party?.color || "#888" }}
                    />
                    <span className="truncate text-xs font-medium">
                      {party?.nickName || party?.name || `#${p.partyNum}`}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(4, (p.pct / maxPct) * 100)}%`,
                        backgroundColor: party?.color || "#888",
                      }}
                    />
                  </div>
                  <span className="tabular-nums text-xs font-semibold text-right">
                    {formatPct(p.pct, 2)}
                  </span>
                </Link>
              );
            })}
          </div>
        </StatCard>
      </div>

      {/* Top regions / municipalities / settlements / sections tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <StatCard
          label={
            <TileHeader
              icon={<MapPin className="h-4 w-4" />}
              title={t("top_regions")}
              hint={t("wasted_votes_share_hint")}
              to="/wasted-vote/regions"
              seeDetailsLabel={t("dashboard_see_details")}
            />
          }
          className="overflow-hidden"
        >
          <TopList rows={dashboard?.topRegions ?? []} isBg={isBg} />
        </StatCard>
        <StatCard
          label={
            <TileHeader
              icon={<MapPin className="h-4 w-4" />}
              title={t("by_municipalities")}
              hint={t("wasted_votes_drill_muni")}
              to="/reports/municipality/wasted-votes"
              seeDetailsLabel={t("dashboard_see_details")}
            />
          }
          className="overflow-hidden"
        >
          <TopList rows={dashboard?.topMunicipalities ?? []} isBg={isBg} />
        </StatCard>
        <StatCard
          label={
            <TileHeader
              icon={<MapPin className="h-4 w-4" />}
              title={t("by_settlements")}
              hint={t("wasted_votes_drill_settlement")}
              to="/reports/settlement/wasted-votes"
              seeDetailsLabel={t("dashboard_see_details")}
            />
          }
          className="overflow-hidden"
        >
          <TopList rows={dashboard?.topSettlements ?? []} isBg={isBg} />
        </StatCard>
        <StatCard
          label={
            <TileHeader
              icon={<MapPin className="h-4 w-4" />}
              title={t("by_sections")}
              hint={t("wasted_votes_drill_section")}
              to="/reports/section/wasted-votes"
              seeDetailsLabel={t("dashboard_see_details")}
            />
          }
          className="overflow-hidden"
        >
          <TopList rows={dashboard?.topSections ?? []} isBg={isBg} />
        </StatCard>
      </div>

      <p className="text-[11px] text-muted-foreground mt-4">
        {t("wasted_votes_methodology")}
      </p>
    </div>
  );
};
