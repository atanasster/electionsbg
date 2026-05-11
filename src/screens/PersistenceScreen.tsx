import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, GitFork, MapPin, X } from "lucide-react";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";
import { SEO } from "@/ux/SEO";
import { H1 } from "@/ux/H1";
import type { MapCoordinates } from "@/layout/dataview/MapLayout";
import { useElectionContext } from "@/data/ElectionContext";
import { useVoteFlowPersistence } from "@/data/voteFlows/useVoteFlow";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { oblastToMir } from "@/data/parliament/nsFolders";
import { formatPct, formatThousands, localDate } from "@/data/utils";
import { StatCard } from "@/screens/dashboard/StatCard";
import { PersistenceRegionsMap } from "./components/persistence/PersistenceRegionsMap";
import regionsJson from "@/data/json/regions.json";

type RegionMeta = {
  oblast: string;
  name?: string;
  name_en?: string;
  long_name?: string;
  long_name_en?: string;
};

const regionLabelByMir = (mir: string, isBg: boolean): string => {
  const info = (regionsJson as RegionMeta[]).find(
    (r) => oblastToMir(r.oblast) === mir,
  );
  if (!info) return mir;
  return (
    (isBg ? info.long_name || info.name : info.long_name_en || info.name_en) ||
    mir
  );
};

const regionLabelByOblast = (key: string, isBg: boolean): string => {
  const info = (regionsJson as RegionMeta[]).find((r) => r.oblast === key);
  if (!info) return key;
  return (
    (isBg ? info.long_name || info.name : info.long_name_en || info.name_en) ||
    key
  );
};

// Compact list-tile used for "most loyal" / "most volatile" rankings.
const RankList: React.FC<{
  rows: { mir: string; share: number }[];
  isBg: boolean;
}> = ({ rows, isBg }) => {
  const max = Math.max(1, ...rows.map((r) => r.share));
  if (!rows.length)
    return <div className="text-xs text-muted-foreground">—</div>;
  return (
    <div className="flex flex-col gap-1.5 mt-1">
      {rows.map((r) => (
        <div
          key={r.mir}
          className="grid grid-cols-[minmax(0,1fr)_minmax(40px,1fr)_auto] items-center gap-x-3 text-sm"
        >
          <span className="truncate font-medium text-xs">
            {regionLabelByMir(r.mir, isBg)}
          </span>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-600/80"
              style={{ width: `${Math.max(4, (r.share / max) * 100)}%` }}
            />
          </div>
          <span className="tabular-nums text-xs font-semibold text-right">
            {formatPct(r.share, 1)}
          </span>
        </div>
      ))}
    </div>
  );
};

export const PersistenceScreen = () => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const { selected, priorElections } = useElectionContext();
  const fromDate = priorElections?.name;
  const toDate = selected;
  const { data: summary } = useVoteFlowPersistence(fromDate, toDate);
  const { displayNameForId } = useCanonicalParties();

  const [selectedKey, setSelectedKey] = useState<string | undefined>(undefined);

  // Inline map sizer — same convention as the wasted-vote screen.
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

  const national = summary?.national;

  // Selected region details — sources from the regional rollup so no
  // extra fetch.
  const selectedRow = useMemo(() => {
    if (!selectedKey || !summary) return undefined;
    const mir = oblastToMir(selectedKey);
    if (!mir) return undefined;
    return summary.byOblast.find((r) => r.oblast === mir)?.persistence;
  }, [selectedKey, summary]);

  // Top stable / top volatile lists for the bottom tiles.
  const { stable, volatile } = useMemo(() => {
    const rows = (summary?.byOblast ?? []).map((r) => ({
      mir: r.oblast,
      share: r.persistence.stayRate * 100,
    }));
    const stable = [...rows].sort((a, b) => b.share - a.share).slice(0, 5);
    const volatile = [...rows].sort((a, b) => a.share - b.share).slice(0, 5);
    return { stable, volatile };
  }, [summary]);

  return (
    <div className="w-full max-w-6xl mx-auto px-4 pb-12">
      <SEO
        title={t("persistence_title")}
        description={t("persistence_description")}
      />
      <div className="py-4 md:py-6">
        <H1 className="text-xl md:text-2xl font-bold text-foreground">
          {t("persistence_title")}
        </H1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          {t("persistence_description")}
        </p>
        {fromDate && toDate && (
          <div className="mt-2 text-xs text-muted-foreground flex items-center gap-2">
            <span className="tabular-nums">{localDate(fromDate)}</span>
            <ArrowRight className="h-3 w-3" />
            <span className="tabular-nums">{localDate(toDate)}</span>
          </div>
        )}
      </div>

      {/* Top KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <StatCard
          label={
            <Hint text={t("persistence_stay_rate_hint")} underline={false}>
              <span>{t("persistence_stay_rate")}</span>
            </Hint>
          }
        >
          <div className="text-2xl md:text-3xl font-bold tabular-nums">
            {national ? formatPct(national.stayRate * 100, 1) : "—"}
          </div>
          <div className="text-[11px] text-muted-foreground tabular-nums">
            {national
              ? `${formatThousands(national.stayedVotes)} / ${formatThousands(
                  national.votedBothNamed,
                )}`
              : ""}
          </div>
        </StatCard>
        <StatCard
          label={
            <Hint text={t("persistence_churn_hint")} underline={false}>
              <span>{t("persistence_churn")}</span>
            </Hint>
          }
        >
          <div className="text-2xl md:text-3xl font-bold tabular-nums">
            {national ? formatPct((1 - national.stayRate) * 100, 1) : "—"}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {t("persistence_churn_caption")}
          </div>
        </StatCard>
        <StatCard
          label={
            <Hint text={t("persistence_top_defection_hint")} underline={false}>
              <span>{t("persistence_top_defection")}</span>
            </Hint>
          }
        >
          {national?.topDefection ? (
            <>
              <div className="text-sm font-semibold leading-tight">
                {displayNameForId(national.topDefection.fromId) ??
                  national.topDefection.fromId}{" "}
                <ArrowRight className="inline-block h-3 w-3 mx-1" />{" "}
                {displayNameForId(national.topDefection.toId) ??
                  national.topDefection.toId}
              </div>
              <div className="text-[11px] text-muted-foreground tabular-nums mt-1">
                {formatThousands(national.topDefection.votes)} ·{" "}
                {formatPct(national.topDefection.share * 100, 1)}
              </div>
            </>
          ) : (
            <div className="text-2xl font-bold">—</div>
          )}
        </StatCard>
      </div>

      {/* Map + drill-down panel */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3 mb-3">
        <StatCard
          label={
            <div className="flex items-center justify-between w-full text-xs font-medium uppercase tracking-wide">
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4" />
                <span>{t("persistence_by_region")}</span>
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
              <PersistenceRegionsMap
                size={mapSize}
                summary={summary ?? undefined}
                selectedKey={selectedKey}
                onSelect={setSelectedKey}
              />
            )}
          </div>

          {selectedRow ? (
            <div className="border-t mt-2 pt-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="font-semibold text-sm">
                    {regionLabelByOblast(selectedKey!, isBg)}
                  </div>
                  <div className="text-[11px] text-muted-foreground tabular-nums">
                    {formatThousands(selectedRow.stayedVotes)} /{" "}
                    {formatThousands(selectedRow.votedBothNamed)}
                  </div>
                </div>
                <div className="text-2xl font-bold tabular-nums">
                  {formatPct(selectedRow.stayRate * 100, 1)}
                </div>
              </div>
              {selectedRow.topDefection && (
                <div className="text-xs">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground pb-1">
                    {t("persistence_top_defection")}
                  </div>
                  <div className="font-medium">
                    {displayNameForId(selectedRow.topDefection.fromId) ??
                      selectedRow.topDefection.fromId}{" "}
                    <ArrowRight className="inline-block h-3 w-3 mx-1" />{" "}
                    {displayNameForId(selectedRow.topDefection.toId) ??
                      selectedRow.topDefection.toId}{" "}
                    <span className="text-muted-foreground tabular-nums">
                      · {formatThousands(selectedRow.topDefection.votes)} ·{" "}
                      {formatPct(selectedRow.topDefection.share * 100, 1)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="border-t mt-2 pt-3 text-xs text-muted-foreground">
              {t("persistence_tap_region_hint")}
            </div>
          )}
        </StatCard>

        {/* Right column: methodology + link out to vote-flow */}
        <StatCard
          label={
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wide">
              <GitFork className="h-4 w-4" />
              <span>{t("persistence_methodology_card")}</span>
            </div>
          }
          className="overflow-hidden"
        >
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t("persistence_methodology_body")}
          </p>
          <Link
            to="/where-did-votes-go/methodology"
            className="text-xs text-primary hover:underline mt-2 inline-block"
            underline={false}
          >
            {t("persistence_read_full_methodology")} →
          </Link>
        </StatCard>
      </div>

      {/* Top stable / top volatile regions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <StatCard
          label={
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wide">
              <MapPin className="h-4 w-4" />
              <span>{t("persistence_most_stable")}</span>
            </div>
          }
          className="overflow-hidden"
        >
          <RankList rows={stable} isBg={isBg} />
        </StatCard>
        <StatCard
          label={
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wide">
              <MapPin className="h-4 w-4" />
              <span>{t("persistence_most_volatile")}</span>
            </div>
          }
          className="overflow-hidden"
        >
          <RankList rows={volatile} isBg={isBg} />
        </StatCard>
      </div>

      <p className="text-[11px] text-muted-foreground mt-4">
        {t("persistence_footer")}
      </p>
    </div>
  );
};
