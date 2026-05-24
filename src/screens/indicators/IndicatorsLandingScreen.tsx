// /indicators — the new KPI dashboard front door. 12 KpiTile cards above the
// CabinetStrip ribbon. The ribbon doubles as a multi-select picker: click
// pills to toggle them into the stacked CabinetScoreDetail panels below.
// Default selection = the cabinet in office at the user's selected election.
// "Compare all cabinets" is a cross-page link to /governments#cabinet-table
// where the full sortable table lives — keeps this landing page focused.

import { FC, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Title } from "@/ux/Title";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useElectionContext } from "@/data/ElectionContext";
import { useGovernments } from "@/data/governments/useGovernments";
import { useMacro } from "@/data/macro/useMacro";
import {
  useCabinetAnchor,
  useSetCabinetAnchor,
} from "@/data/macro/cabinetAnchorContext";
import {
  toFractionalYear,
  xDomainFor,
} from "@/screens/components/governments/governmentTimelineUtils";
import {
  CabinetStrip,
  GovernmentTimeline,
  type EventMarker,
} from "@/screens/components/governments/GovernmentTimeline";
import { KpiTile } from "@/screens/components/macro/KpiTile";
import { CabinetScoreDetail } from "@/screens/components/macro/CabinetScoreCard";
import { LANDING_KPI_ORDER } from "./indicatorsRegistry";

// Election-name "YYYY_MM_DD" → ISO date; falls back to today if unparsable.
const electionNameToIso = (name: string | undefined): string => {
  if (!name) return new Date().toISOString();
  const parts = name.split("_");
  if (parts.length !== 3) return new Date().toISOString();
  return `${parts[0]}-${parts[1]}-${parts[2]}T00:00:00.000Z`;
};

const localDateFromIso = (
  iso: string | undefined,
  lang: "bg" | "en",
): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(lang === "bg" ? "bg-BG" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const DomainLink: FC<{ to: string; labelKey: string }> = ({ to, labelKey }) => {
  const { t } = useTranslation();
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
    >
      {t(labelKey)}
      <ArrowRight className="h-3 w-3" />
    </Link>
  );
};

export const IndicatorsLandingScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { selected } = useElectionContext();
  const { data: governments } = useGovernments();
  const { data: macro } = useMacro();
  const anchor = useCabinetAnchor();
  const setAnchor = useSetCabinetAnchor();
  // Hero chart is collapsed by default — the tile grid is what the user came
  // for. The reveal toggle gives the strategic-context "big picture" without
  // pushing the tiles below the fold on first paint.
  const [heroExpanded, setHeroExpanded] = useState(false);
  // EU integration milestones — same six events as GovernmentsScreen so the
  // hero chart reads as the same artifact rebranded for this page.
  const heroEvents = useMemo<EventMarker[]>(
    () => [
      {
        x: toFractionalYear("2007-01-01"),
        label: t("governments_event_eu_accession"),
      },
      {
        x: toFractionalYear("2020-07-10"),
        label: t("governments_event_erm2"),
      },
      {
        x: toFractionalYear("2024-03-31"),
        label: t("governments_event_schengen_air"),
        labelPosition: "bottom",
      },
      {
        x: toFractionalYear("2025-01-01"),
        label: t("governments_event_schengen_land"),
      },
      {
        x: toFractionalYear("2025-06-04"),
        label: t("governments_event_convergence_report"),
        labelPosition: "bottom",
      },
      {
        x: toFractionalYear("2026-01-01"),
        label: t("governments_event_eurozone"),
      },
    ],
    [t],
  );
  // Multi-select: clicking a strip pill toggles its membership here, so two
  // or more cabinets can be compared side-by-side via stacked detail panels.
  // Independent of the URL cabinet anchor — clicking a pill ALSO sets the
  // anchor (most-recently-clicked wins) but the multi-select state lives
  // page-local so navigating away doesn't carry the comparison set with you.
  // userTouched flips on first click so the auto-default (cabinet in office
  // at the selected election) doesn't keep re-overwriting the user's choice
  // when they change election; default only re-applies if they've cleared
  // selection entirely.
  const [selectedCabinetIds, setSelectedCabinetIds] = useState<string[]>([]);
  const [userTouched, setUserTouched] = useState(false);

  const xDomain = useMemo<[number, number] | null>(
    () => (governments ? xDomainFor(governments) : null),
    [governments],
  );

  // Default selection follows the chosen election: the cabinet that was in
  // office on (or, if mid-campaign, immediately before) the election date.
  // If the user has already clicked a pill, keep their choice.
  const defaultCabinetId = useMemo<string | null>(() => {
    if (!governments || governments.length === 0) return null;
    const electionIso = electionNameToIso(selected);
    const electionMs = new Date(electionIso).getTime();
    const match = governments.find((g) => {
      const startMs = new Date(g.startDate).getTime();
      const endMs = g.endDate ? new Date(g.endDate).getTime() : Infinity;
      return startMs <= electionMs && electionMs <= endMs;
    });
    if (match) return match.id;
    // Fallback: nearest cabinet whose tenure ended before the election (or
    // the very first cabinet if everything is after it).
    let nearest: string | null = null;
    let nearestDelta = Infinity;
    for (const g of governments) {
      const startMs = new Date(g.startDate).getTime();
      const delta = Math.abs(startMs - electionMs);
      if (delta < nearestDelta) {
        nearestDelta = delta;
        nearest = g.id;
      }
    }
    return nearest;
  }, [governments, selected]);

  useEffect(() => {
    if (userTouched) return;
    setSelectedCabinetIds(defaultCabinetId ? [defaultCabinetId] : []);
  }, [defaultCabinetId, userTouched]);

  const toggleCabinet = (id: string) => {
    setUserTouched(true);
    setSelectedCabinetIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  // Render cards in the strip's left-to-right order (chronological) regardless
  // of the click order, so the stack always reads the same way as the ribbon.
  const selectedCabinets = useMemo(() => {
    if (!governments || selectedCabinetIds.length === 0) return [];
    const set = new Set(selectedCabinetIds);
    return governments.filter((g) => set.has(g.id));
  }, [governments, selectedCabinetIds]);

  const fetchedDate = localDateFromIso(macro?.fetchedAt, lang);

  if (!governments) {
    return (
      <div className="pb-12">
        <Title>{t("indicators_page_title")}</Title>
      </div>
    );
  }

  return (
    <div className="pb-12">
      <Title description={t("indicators_page_description")}>
        {t("indicators_page_title")}
      </Title>

      <p className="text-sm text-muted-foreground mb-6 max-w-3xl mx-auto text-center">
        {t("indicators_page_explainer")}
      </p>

      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-wrap items-center gap-3">
          <DomainLink
            to="/indicators/economy"
            labelKey="indicators_nav_economy"
          />
          <DomainLink
            to="/indicators/fiscal"
            labelKey="indicators_nav_fiscal"
          />
          <DomainLink
            to="/indicators/governance"
            labelKey="indicators_nav_governance"
          />
          <DomainLink
            to="/indicators/society"
            labelKey="indicators_nav_society"
          />
          <DomainLink
            to="/indicators/compare"
            labelKey="indicators_nav_compare"
          />
        </div>
        <Link
          to="/governments"
          className="text-sm text-primary hover:underline"
        >
          {t("indicators_to_governments_link")}
        </Link>
      </div>

      {macro ? (
        <section className="mb-6">
          <button
            type="button"
            onClick={() => setHeroExpanded((v) => !v)}
            aria-expanded={heroExpanded}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {heroExpanded ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            {t(
              heroExpanded
                ? "indicators_hero_chart_collapse"
                : "indicators_hero_chart_expand",
            )}
          </button>
          {heroExpanded ? (
            <div className="mt-2">
              <GovernmentTimeline
                governments={governments}
                macro={macro}
                indicatorKeys={["gdpGrowth", "inflation", "unemployment"]}
                yAxisFormatter={(v) => `${v}`}
                unitFormatter={(_k, v) => `${v.toFixed(1)}%`}
                showZeroLine
                hideToggles
                height={240}
                eventMarkers={heroEvents}
                onCabinetClick={setAnchor}
                highlightedCabinetId={anchor?.cabinet.id ?? null}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      <section
        aria-label={t("indicators_landing_kpi_grid_aria")}
        className="mb-8"
        data-og="indicators-kpi-grid"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {LANDING_KPI_ORDER.map((key) => (
            <KpiTile key={key} indicatorKey={key} />
          ))}
        </div>
      </section>

      {xDomain ? (
        <section className="mb-6">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            {t("cabinet_score_row_heading")}
          </div>
          <CabinetStrip
            governments={governments}
            xDomain={xDomain}
            lang={lang}
            mobileScrollable
            fullWidth
            selectedIds={selectedCabinetIds}
            onToggle={toggleCabinet}
            onAnchor={setAnchor}
            anchoredId={anchor?.cabinet.id ?? null}
          />
          {macro && selectedCabinets.length > 0 ? (
            <div className="mt-3 flex flex-col gap-2">
              {selectedCabinets.map((g) => (
                <CabinetScoreDetail key={g.id} government={g} macro={macro} />
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground mt-3">
              {t("cabinet_selector_hint")}
            </p>
          )}
          {macro ? (
            <div className="mt-2 flex justify-end">
              <Link
                to="/governments#cabinet-table"
                className="text-xs text-primary hover:underline inline-flex items-center gap-1"
              >
                {t("cabinet_compare_all")}
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          ) : null}
        </section>
      ) : null}

      <p className="text-[11px] text-muted-foreground mt-6">
        {t("governments_source_prefix")}{" "}
        <a
          href="https://ec.europa.eu/eurostat/databrowser/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Eurostat
        </a>
        {" · "}
        <a
          href="https://databank.worldbank.org/source/worldwide-governance-indicators"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          World Bank WGI
        </a>
        {" · "}
        <a
          href="https://www.transparency.org/en/cpi"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Transparency International CPI
        </a>
        {" · "}
        <a
          href="https://europa.eu/eurobarometer/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          {lang === "bg" ? "Евробарометър" : "Eurobarometer"}
        </a>
        {fetchedDate ? (
          <>
            {" · "}
            {t("indicators_landing_as_of")} {fetchedDate}
          </>
        ) : null}
      </p>
    </div>
  );
};
