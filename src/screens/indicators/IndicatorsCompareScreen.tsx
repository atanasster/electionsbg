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
// for the snapshot panels (WGI radar, COFOG multiples, inequality panel,
// spend-outcome scatters, peer snapshot table). Pick a cabinet → ?cabinet=
// <id> goes into the URL, and those panels re-render as values at the end
// of that cabinet's tenure. With no cabinet picked, the panels default to
// the election quarter — matching the rest of /indicators so the user's
// mental model stays consistent.
//
// The opt-in is explicit: each panel calls useCompareSnapshotYear or
// receives an `asOf` prop from useCompareSnapshotAsOf. KpiTile, the domain
// pages, and the cabinet detail screen do NOT consult the anchor for their
// headline values — only the small "При [Cabinet]" footers do.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { useGovernments } from "@/data/governments/useGovernments";
import { cabinetFullLabel } from "@/data/governments/cabinetLabel";
import {
  useCabinetAnchor,
  useSetCabinetAnchor,
} from "@/data/macro/cabinetAnchorContext";
import { useCompareSnapshotAsOf } from "@/data/macro/useElectionAsOf";
import { useMacroPeers, type PeerGeo } from "@/data/macro/useMacroPeers";
import { PeerSnapshotTable } from "@/screens/components/macro/PeerSnapshotTable";
import { Title } from "@/ux/Title";
import { EuComparePeerStrip } from "@/screens/components/euCompare/EuComparePeerStrip";
import { EuCompareWgiSmallMultiples } from "@/screens/components/euCompare/EuCompareWgiSmallMultiples";
import { EuCompareCofogMultiples } from "@/screens/components/euCompare/EuCompareCofogMultiples";
import { EuCompareInequalityPanel } from "@/screens/components/euCompare/EuCompareInequalityPanel";
import { EuCompareSpendOutcomeScatters } from "@/screens/components/euCompare/EuCompareSpendOutcomeScatters";
import { EuCompareSourcesStrip } from "@/screens/components/euCompare/EuCompareSourcesStrip";
import { usePeerSelection } from "@/screens/components/euCompare/usePeerSelection";
import { CabinetStrip } from "@/screens/components/governments/GovernmentTimeline";
import { SelectedCabinetCallout } from "@/screens/components/governments/SelectedCabinetCallout";
import { xDomainFor } from "@/screens/components/governments/governmentTimelineUtils";

export const IndicatorsCompareScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { data: peers } = useMacroPeers();
  const { data: governments } = useGovernments();
  const { geos } = usePeerSelection();
  const anchor = useCabinetAnchor();
  const setAnchor = useSetCabinetAnchor();
  // Snapshot anchor for /compare panels: cabinet's tenure-end when set,
  // election quarter otherwise. Threaded explicitly to PeerSnapshotTable so
  // other call sites of the table (on /economy + /fiscal) stay
  // election-only.
  const compareAsOf = useCompareSnapshotAsOf();

  const indicatorKeys = peers?.indicators ? Object.keys(peers.indicators) : [];
  const tableGeos: PeerGeo[] = geos;

  const xDomain = useMemo<[number, number] | null>(
    () => (governments ? xDomainFor(governments) : null),
    [governments],
  );

  const selectedCabinet = anchor?.cabinet ?? null;

  // Header text rendered above the SelectedCabinetCallout — separate from
  // the callout itself because the framing changes depending on whether
  // the picked cabinet is the still-in-office incumbent (latest data
  // anyway) or a finished one (snapshot to its tenure-end).
  const calloutHeader = useMemo(() => {
    if (!selectedCabinet) return null;
    if (selectedCabinet.endReason === "incumbent" || !selectedCabinet.endDate) {
      return t("eu_compare_callout_header_incumbent");
    }
    return t("eu_compare_callout_header_finished");
  }, [selectedCabinet, t]);

  // Breadcrumb: Bulgaria → [Cabinet] → vs peers. Each crumb is a deeper
  // route. The cabinet crumb links to the cabinet-detail page; the peer
  // crumb is the current page (non-link, slightly muted).
  const renderBreadcrumb = () => (
    <nav
      aria-label="breadcrumb"
      className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
    >
      <Link to="/indicators" className="hover:text-foreground hover:underline">
        {t("eu_compare_breadcrumb_bg")}
      </Link>
      {selectedCabinet && governments ? (
        <>
          <ChevronRight className="h-3 w-3 opacity-60" aria-hidden />
          <Link
            to={`/governments/${encodeURIComponent(selectedCabinet.id)}`}
            className="hover:text-foreground hover:underline"
          >
            {cabinetFullLabel(selectedCabinet, governments, lang)}
          </Link>
        </>
      ) : null}
      <ChevronRight className="h-3 w-3 opacity-60" aria-hidden />
      <span className="text-foreground">
        {t("eu_compare_breadcrumb_vs_peers")}
      </span>
    </nav>
  );

  return (
    <div className="pb-12">
      {renderBreadcrumb()}

      <Title description={t("eu_compare_page_description")}>
        {t("eu_compare_page_title")}
      </Title>

      {xDomain && governments ? (
        <section className="mb-5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            {t("eu_compare_cabinet_anchor_label")}
          </div>
          <CabinetStrip
            governments={governments}
            xDomain={xDomain}
            lang={lang}
            mobileScrollable
            fullWidth
            anchoredId={anchor?.cabinet.id ?? null}
            onAnchor={setAnchor}
          />
          {selectedCabinet ? (
            <SelectedCabinetCallout
              government={selectedCabinet}
              lang={lang}
              headerText={calloutHeader ?? undefined}
              className="mt-3"
            />
          ) : (
            <p className="text-[11px] text-muted-foreground mt-2">
              {t("eu_compare_callout_no_selection")}
            </p>
          )}
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
        <EuCompareWgiSmallMultiples />
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
            asOf={compareAsOf}
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

      {selectedCabinet && governments ? (
        <div className="mt-6 flex flex-wrap justify-end">
          <Link
            to={`/governments/${encodeURIComponent(selectedCabinet.id)}`}
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <ArrowLeft className="h-3 w-3" />
            {t("eu_compare_back_to_cabinet", {
              name: cabinetFullLabel(selectedCabinet, governments, lang),
            })}
          </Link>
        </div>
      ) : null}
    </div>
  );
};
