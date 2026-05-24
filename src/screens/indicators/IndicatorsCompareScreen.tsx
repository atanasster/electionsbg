// /indicators/compare — EU peer comparison dashboard. Bulgaria-anchored,
// pre-loaded with the four CEE/southern peers (RO, GR, HU, HR) and the
// EU27 aggregate. Shipped as a stacked-section dashboard rather than a
// table because the goal is opinionated civic storytelling, not raw data
// browsing: WGI radar lead, snapshot table, COFOG side-by-side, inequality,
// spend → outcome scatters, sources.
//
// Layout copies the homepage shell (no max-w cap) so tiles can use the full
// container width on xl viewports. Peer-selection state lives in the URL
// (?peers=RO,GR …) so the view is shareable.
//
// Cabinet anchor: the CabinetStrip at the top doubles as a temporal anchor
// for every panel. Pick a cabinet → the whole page re-renders as values at
// the end of that cabinet's tenure (annual + quarterly snapshots). Implemented
// via CompareAnchorProvider so the panels need no API changes; default
// selection is the cabinet in office at the chosen election.

import { FC, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useElectionContext } from "@/data/ElectionContext";
import { useGovernments } from "@/data/governments/useGovernments";
import {
  CompareAnchorContext,
  type CompareAnchorOverride,
} from "@/data/macro/compareAnchorContext";
import { useMacroPeers, type PeerGeo } from "@/data/macro/useMacroPeers";
import { PeerSnapshotTable } from "@/screens/components/macro/PeerSnapshotTable";
import { Title } from "@/ux/Title";
import { EuComparePeerStrip } from "@/screens/components/euCompare/EuComparePeerStrip";
import { EuCompareWgiRadar } from "@/screens/components/euCompare/EuCompareWgiRadar";
import { EuCompareCofogMultiples } from "@/screens/components/euCompare/EuCompareCofogMultiples";
import { EuCompareInequalityPanel } from "@/screens/components/euCompare/EuCompareInequalityPanel";
import { EuCompareSpendOutcomeScatters } from "@/screens/components/euCompare/EuCompareSpendOutcomeScatters";
import { EuCompareSourcesStrip } from "@/screens/components/euCompare/EuCompareSourcesStrip";
import { usePeerSelection } from "@/screens/components/euCompare/usePeerSelection";
import { CabinetStrip } from "@/screens/components/governments/GovernmentTimeline";
import { xDomainFor } from "@/screens/components/governments/governmentTimelineUtils";

// "YYYY_MM_DD" → ms epoch (UTC start of day). Used to match a cabinet to the
// selected election by tenure-window containment. Returns NaN on bad input;
// the caller already guards against missing/invalid keys.
const electionNameToMs = (name: string | undefined): number => {
  if (!name) return Number.NaN;
  const parts = name.split("_");
  if (parts.length !== 3) return Number.NaN;
  return Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
};

// Translate a cabinet's tenure into the snapshot anchor consumed by the
// override hooks. Incumbent → "use latest data" (null asOf + current year).
// Finished cabinet → end-of-tenure quarter and year so the page reads as
// "indicators at the moment this cabinet left office".
const anchorFor = (
  cabinet: { endDate: string | null; endReason: string } | null,
): CompareAnchorOverride | null => {
  if (!cabinet) return null;
  if (cabinet.endReason === "incumbent" || !cabinet.endDate) {
    return { asOf: null, year: new Date().getFullYear() };
  }
  const end = new Date(cabinet.endDate);
  const year = end.getUTCFullYear();
  const month0 = end.getUTCMonth();
  const quarter = (Math.floor(month0 / 3) + 1) as 1 | 2 | 3 | 4;
  return { asOf: { year, quarter }, year };
};

export const IndicatorsCompareScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { selected } = useElectionContext();
  const { data: peers } = useMacroPeers();
  const { data: governments } = useGovernments();
  const { geos } = usePeerSelection();
  const [selectedCabinetId, setSelectedCabinetId] = useState<string | null>(
    null,
  );
  const [userTouched, setUserTouched] = useState(false);

  const indicatorKeys = peers?.indicators ? Object.keys(peers.indicators) : [];
  const tableGeos: PeerGeo[] = geos;

  const xDomain = useMemo<[number, number] | null>(
    () => (governments ? xDomainFor(governments) : null),
    [governments],
  );

  // Default cabinet = the one whose tenure contains the selected election
  // date. Matches /indicators landing so the two screens read consistently.
  const defaultCabinetId = useMemo<string | null>(() => {
    if (!governments || governments.length === 0) return null;
    const electionMs = electionNameToMs(selected);
    if (Number.isNaN(electionMs)) return governments[governments.length - 1].id;
    const match = governments.find((g) => {
      const startMs = new Date(g.startDate).getTime();
      const endMs = g.endDate ? new Date(g.endDate).getTime() : Infinity;
      return startMs <= electionMs && electionMs <= endMs;
    });
    return match?.id ?? governments[governments.length - 1].id;
  }, [governments, selected]);

  useEffect(() => {
    if (userTouched) return;
    setSelectedCabinetId(defaultCabinetId);
  }, [defaultCabinetId, userTouched]);

  const selectedCabinet = useMemo(() => {
    if (!governments || !selectedCabinetId) return null;
    return governments.find((g) => g.id === selectedCabinetId) ?? null;
  }, [governments, selectedCabinetId]);

  const anchorOverride = useMemo(
    () => anchorFor(selectedCabinet),
    [selectedCabinet],
  );

  // Single-select switch: clicking a different pill swaps the anchor; the
  // active pill is a no-op. Avoids the awkward "no cabinet selected" state
  // where the strip shows nothing highlighted but the page silently falls
  // back to the election anchor. The page is always cabinet-anchored once
  // data loads — multi-select is reserved for the /indicators landing where
  // multiple stacked detail panels make sense.
  const toggleCabinet = (id: string) => {
    setUserTouched(true);
    setSelectedCabinetId((prev) => (prev === id ? prev : id));
  };

  const anchorLabel = useMemo(() => {
    if (!selectedCabinet) return null;
    const surname =
      (lang === "bg" ? selectedCabinet.pmBg : selectedCabinet.pmEn)
        .split(" ")
        .pop() ?? "";
    if (selectedCabinet.endReason === "incumbent" || !selectedCabinet.endDate) {
      return lang === "bg"
        ? `текущи стойности (кабинет ${surname})`
        : `latest values (cabinet ${surname})`;
    }
    const end = new Date(selectedCabinet.endDate);
    const periodLabel = end.toLocaleDateString(
      lang === "bg" ? "bg-BG" : "en-GB",
      { month: "short", year: "numeric" },
    );
    return lang === "bg"
      ? `към края на мандата на ${surname} (${periodLabel})`
      : `at end of ${surname} cabinet (${periodLabel})`;
  }, [selectedCabinet, lang]);

  return (
    <CompareAnchorContext.Provider value={anchorOverride}>
      <div className="pb-12">
        <Title description={t("eu_compare_page_description")}>
          {t("eu_compare_page_title")}
        </Title>

        {xDomain && governments ? (
          <section className="mb-4">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
              {t("eu_compare_cabinet_anchor_label")}
            </div>
            <CabinetStrip
              governments={governments}
              xDomain={xDomain}
              lang={lang}
              mobileScrollable
              selectedIds={selectedCabinetId ? [selectedCabinetId] : []}
              onToggle={toggleCabinet}
            />
            {anchorLabel ? (
              <p className="text-[11px] text-muted-foreground mt-1">
                {anchorLabel}
              </p>
            ) : null}
          </section>
        ) : null}

        <section className="mb-6">
          <EuComparePeerStrip />
        </section>

        <section className="mb-8" data-og="eu-compare-wgi">
          <h2 className="text-lg font-semibold mb-1">
            {t("eu_compare_section_wgi_title")}
          </h2>
          <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
            {t("eu_compare_section_wgi_explainer")}
          </p>
          <EuCompareWgiRadar />
        </section>

        <section className="mb-8" data-og="eu-compare-snapshot">
          <h2 className="text-lg font-semibold mb-1">
            {t("eu_compare_section_snapshot_title")}
          </h2>
          <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
            {t("eu_compare_section_snapshot_explainer")}
          </p>
          {indicatorKeys.length > 0 ? (
            <PeerSnapshotTable
              rows={indicatorKeys.map((k) => ({ indicatorKey: k }))}
              geos={tableGeos}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("gov_macro_unavailable")}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground mt-3">
            {t("eu_compare_section_snapshot_footnote")}
          </p>
        </section>

        <section className="mb-8" data-og="eu-compare-cofog">
          <h2 className="text-lg font-semibold mb-1">
            {t("eu_compare_section_cofog_title")}
          </h2>
          <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
            {t("eu_compare_section_cofog_explainer")}
          </p>
          <EuCompareCofogMultiples />
        </section>

        <section className="mb-8" data-og="eu-compare-inequality">
          <h2 className="text-lg font-semibold mb-1">
            {t("eu_compare_section_inequality_title")}
          </h2>
          <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
            {t("eu_compare_section_inequality_explainer")}
          </p>
          <EuCompareInequalityPanel />
        </section>

        <section className="mb-8" data-og="eu-compare-scatters">
          <h2 className="text-lg font-semibold mb-1">
            {t("eu_compare_section_scatters_title")}
          </h2>
          <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
            {t("eu_compare_section_scatters_explainer")}
          </p>
          <EuCompareSpendOutcomeScatters />
        </section>

        <section className="mb-2">
          <EuCompareSourcesStrip />
        </section>
      </div>
    </CompareAnchorContext.Provider>
  );
};
