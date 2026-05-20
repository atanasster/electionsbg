import { FC, useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Boxes } from "lucide-react";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { useRiskClusters } from "@/data/riskScore/useRiskClusters";
import type { RiskBand } from "@/data/riskScore/useRiskScore";
import { useNationalSummary } from "@/data/dashboard/useNationalSummary";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useRegions } from "@/data/regions/useRegions";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { StatCard } from "@/screens/dashboard/StatCard";
import { Hint } from "@/ux/Hint";
import { RiskBandBadge } from "@/screens/components/riskScore/RiskBandBadge";
import { BAND_COLOR } from "@/screens/components/riskScore/bandColors";
import { RiskClustersMap } from "./RiskClustersMap";

const FILTER_BANDS: RiskBand[] = ["elevated", "high", "critical"];

// Risk-analysis page section — geographic map of every elevated-or-above
// polling section, plus a ranked list of detected clusters (knots of
// adjacent same-party sections). A VIEW over the risk scores; see
// useRiskClusters / scripts/reports/risk_score.ts for the methodology.

const TOP_N = 10;
const HEADER_CLASS =
  "text-[10px] font-medium uppercase tracking-wide text-muted-foreground";
const stripPrefix = (s?: string) => (s ?? "").replace(/^\d+\.\s*/, "");

export const RiskClustersCard: FC = () => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const { data } = useRiskClusters();
  const { data: nat } = useNationalSummary();
  const { displayNameFor } = useCanonicalParties();
  const { findRegion } = useRegions();
  const { findMunicipality } = useMunicipalities();
  const { findSettlement } = useSettlementsInfo();

  const [size, setSize] = useState<MapCoordinates | undefined>();
  const roRef = useRef<ResizeObserver | null>(null);
  // Callback ref, not useRef + useLayoutEffect: the measured div only
  // mounts once data has loaded (the card returns null while loading), so
  // a `[]`-deps effect would have already fired against a null ref.
  const mapRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    const measure = () =>
      setSize([el.offsetWidth, el.offsetHeight, el.offsetLeft, el.offsetTop]);
    measure();
    roRef.current = new ResizeObserver(measure);
    roRef.current.observe(el);
  }, []);

  // Map filters — the full marker set (1000+ sections) is too dense to
  // read, so the map opens showing only clustered sections.
  const [clustersOnly, setClustersOnly] = useState(true);
  const [bands, setBands] = useState<Record<RiskBand, boolean>>({
    low: false,
    elevated: true,
    high: true,
    critical: true,
  });

  const topClusters = useMemo(
    () => (data?.clusters ?? []).slice(0, TOP_N),
    [data],
  );

  const visibleSections = useMemo(() => {
    const all = data?.mapSections ?? [];
    const anyClustered = all.some((s) => !!s.clusterId);
    return all.filter(
      (s) => (!clustersOnly || !anyClustered || !!s.clusterId) && bands[s.band],
    );
  }, [data, clustersOnly, bands]);

  if (!data || data.mapSections.length === 0) return null;

  const partyMap = new Map((nat?.parties ?? []).map((p) => [p.partyNum, p]));
  const clusterCount = data.clusters.length;
  const sectionedCount = data.clusters.reduce((a, c) => a + c.sectionCount, 0);
  const anyClustered = data.mapSections.some((s) => !!s.clusterId);

  return (
    <StatCard
      label={
        <Hint text={t("risk_clusters_hint")} underline={false}>
          <div className="flex items-center gap-2">
            <Boxes className="h-4 w-4" />
            <span>{t("risk_clusters_title")}</span>
          </div>
        </Hint>
      }
    >
      <p className="text-sm text-muted-foreground leading-relaxed mt-1">
        {clusterCount > 0
          ? t("risk_clusters_headline", {
              count: clusterCount,
              sectioned: sectionedCount,
              total: data.mapSections.length,
            })
          : t("risk_clusters_headline_none", {
              total: data.mapSections.length,
            })}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {anyClustered ? (
          <button
            type="button"
            aria-pressed={clustersOnly}
            onClick={() => setClustersOnly((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
              clustersOnly
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            <Boxes className="h-3 w-3" />
            {t("risk_clusters_toggle_clustered")}
          </button>
        ) : null}
        {FILTER_BANDS.map((band) => (
          <button
            key={band}
            type="button"
            aria-pressed={bands[band]}
            onClick={() => setBands((b) => ({ ...b, [band]: !b[band] }))}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
              bands[band] ? "" : "opacity-40"
            }`}
            style={{ borderColor: BAND_COLOR[band] }}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: BAND_COLOR[band] }}
            />
            {t(`risk_band_${band}`)}
          </button>
        ))}
      </div>

      <div ref={mapRef} className="w-full h-[360px] md:h-[440px] mt-2">
        {size && <RiskClustersMap sections={visibleSections} size={size} />}
      </div>

      {topClusters.length > 0 ? (
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto_auto] gap-x-3 gap-y-1.5 items-center text-sm">
          <span className={HEADER_CLASS}>{t("dashboard_party")}</span>
          <span className={HEADER_CLASS}>{t("risk_analysis_location")}</span>
          <span className={`${HEADER_CLASS} text-right`}>
            {t("risk_clusters_col_sections")}
          </span>
          <span className={`${HEADER_CLASS} text-right`}>
            {t("risk_col_band")}
          </span>
          {topClusters.map((c) => {
            const party = c.partyNum ? partyMap.get(c.partyNum) : undefined;
            const region = findRegion(c.oblast);
            const muni = findMunicipality(c.obshtina);
            const settlement = findSettlement((c.ekatte || "").split("-")[0]);
            const oblastName = isBg
              ? stripPrefix(region?.long_name || region?.name)
              : stripPrefix(
                  region?.long_name_en || region?.name_en || region?.name,
                );
            const muniName = isBg
              ? muni?.long_name || muni?.name
              : muni?.long_name_en || muni?.name_en || muni?.name;
            const settlementName = isBg
              ? settlement?.name
              : settlement?.name_en || settlement?.name;
            const locParts = [settlementName, muniName, oblastName].filter(
              (s) => !!s && s !== settlementName,
            );
            const location =
              [settlementName, ...locParts].filter(Boolean).join(" · ") ||
              c.ekatte ||
              "—";
            return (
              <div className="contents" key={c.id}>
                <div className="flex items-center gap-2 min-w-0">
                  {party ? (
                    <>
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: party.color || "#888" }}
                      />
                      <span className="truncate text-xs font-medium">
                        {displayNameFor(party.nickName) ?? party.nickName}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>
                <span
                  className="truncate text-xs text-muted-foreground"
                  title={location}
                >
                  {location}
                </span>
                <span className="tabular-nums text-xs font-semibold text-right">
                  {c.sectionCount}
                </span>
                <span className="justify-self-end">
                  <RiskBandBadge
                    band={c.maxBand}
                    score={c.maxScore}
                    size="sm"
                  />
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </StatCard>
  );
};
