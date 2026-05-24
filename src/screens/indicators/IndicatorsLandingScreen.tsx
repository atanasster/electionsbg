// /indicators — the new KPI dashboard front door. 12 KpiTile cards above the
// CabinetStrip ribbon. The ribbon doubles as a multi-select picker: click
// pills to toggle them into the stacked CabinetScoreDetail panels below.
// Default selection = the cabinet in office at the user's selected election.
// "Compare all cabinets" is a cross-page link to /governments#cabinet-table
// where the full sortable table lives — keeps this landing page focused.

import { FC, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, ArrowUpRight, ChevronDown, ChevronUp } from "lucide-react";
import { Title } from "@/ux/Title";
import { useElectionContext } from "@/data/ElectionContext";
import { useGovernments } from "@/data/governments/useGovernments";
import { useMacro } from "@/data/macro/useMacro";
import { useElectionAsOf } from "@/data/macro/useElectionAsOf";
import {
  useCabinetAnchor,
  useSetCabinetAnchor,
} from "@/data/macro/cabinetAnchor";
import { useDefaultCabinetForElection } from "@/data/macro/useDefaultCabinetForElection";
import { xDomainFor } from "@/screens/components/governments/governmentTimelineUtils";
import {
  CabinetStrip,
  GovernmentTimeline,
} from "@/screens/components/governments/GovernmentTimeline";
import { useEuMilestones } from "@/screens/components/governments/euMilestones";
import { useChartEvents } from "@/screens/components/governments/chartEvents";
import { KpiTile } from "@/screens/components/macro/KpiTile";
import { CabinetScoreDetail } from "@/screens/components/macro/CabinetScoreCard";
import { IndicatorsNav } from "./indicatorsNav";
import { LANDING_KPI_ORDER } from "./indicatorsRegistry";

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

// "YYYY_MM_DD" → long localized date ("19 април 2026 г."). Returns null for
// missing/malformed input so the calling banner can collapse cleanly.
const electionNameToLongDate = (
  name: string | undefined,
  lang: "bg" | "en",
): string | null => {
  if (!name) return null;
  const parts = name.split("_");
  if (parts.length !== 3) return null;
  const d = new Date(
    Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])),
  );
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(lang === "bg" ? "bg-BG" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

// Short quarter label ("2 тр. 2026" / "Q2 2026") for the as-of banner.
const formatQuarter = (
  q: { year: number; quarter: 1 | 2 | 3 | 4 } | null,
  lang: "bg" | "en",
): string | null => {
  if (!q) return null;
  return lang === "bg"
    ? `${q.quarter} тр. ${q.year}`
    : `Q${q.quarter} ${q.year}`;
};

export const IndicatorsLandingScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { selected } = useElectionContext();
  const { data: governments } = useGovernments();
  const { data: macro } = useMacro();
  const anchor = useCabinetAnchor();
  const setAnchor = useSetCabinetAnchor();
  const defaultCabinetId = useDefaultCabinetForElection();
  const electionAsOf = useElectionAsOf();
  // URL search string — preserved when navigating to /governments so the
  // cabinet anchor (?cabinet=) and election (?elections=) survive the
  // section change.
  const { search } = useLocation();
  const electionLongDate = electionNameToLongDate(selected, lang);
  const asOfQuarter = formatQuarter(electionAsOf, lang);
  // Hero chart is collapsed by default — the tile grid is what the user came
  // for. The reveal toggle gives the strategic-context "big picture" without
  // pushing the tiles below the fold on first paint.
  const [heroExpanded, setHeroExpanded] = useState(false);
  // Shared EU integration milestones — see euMilestones.ts.
  const heroEvents = useEuMilestones();
  // Societal-events strip (protests, crises, pandemic) below the hero
  // chart — same set as /governments so the picture reads consistently.
  const chartEvents = useChartEvents();
  // Multi-select: clicking a strip pill toggles its membership here, so two
  // or more cabinets can be compared side-by-side via stacked detail panels.
  // Independent of the URL cabinet anchor — clicking a pill ALSO sets the
  // anchor (most-recently-clicked wins) but the multi-select state lives
  // page-local so navigating away doesn't carry the comparison set with you.
  // userTouched flips on first click so the auto-default (cabinet in office
  // at the selected election OR the URL anchor) doesn't keep re-overwriting
  // the user's choice when they change election; default only re-applies if
  // they've cleared selection entirely.
  const [selectedCabinetIds, setSelectedCabinetIds] = useState<string[]>([]);
  const [userTouched, setUserTouched] = useState(false);

  const xDomain = useMemo<[number, number] | null>(
    () => (governments ? xDomainFor(governments) : null),
    [governments],
  );

  // Default selection prefers the URL cabinet anchor (so coming from
  // /compare?cabinet=denkov surfaces denkov's detail card below) and falls
  // back to the election-default cabinet. Without this, the strip would
  // highlight denkov in amber while the bottom card showed the
  // election-default cabinet — three "selected" semantics out of sync.
  const initialSelection = useMemo<string[]>(() => {
    if (anchor) return [anchor.cabinet.id];
    return defaultCabinetId ? [defaultCabinetId] : [];
  }, [anchor, defaultCabinetId]);

  useEffect(() => {
    if (userTouched) return;
    setSelectedCabinetIds(initialSelection);
  }, [initialSelection, userTouched]);

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

      <p className="text-sm text-muted-foreground mb-3 max-w-3xl mx-auto text-center">
        {t("indicators_page_explainer")}
      </p>

      {/* "Values as of" banner — answers "what point in time am I looking
          at?" before the user scans 12 tiles with varying period labels.
          Uses the election date (user-picked) and the resolved quarter
          (what KpiTile's pickAtOrBefore actually compares against). */}
      {electionLongDate ? (
        <p className="text-[11px] text-center text-muted-foreground mb-5">
          {t("indicators_landing_values_as_of", {
            date: electionLongDate,
            quarter: asOfQuarter ?? "",
          })}
        </p>
      ) : null}

      <IndicatorsNav variant="landing" />

      {/* Sibling-section link — distinct from the sub-nav pills above so
          it reads as "leave for a related section" rather than another
          tab. Outlined chip with an external-link icon makes the
          affordance explicit. Preserves the URL search (election +
          cabinet anchor) so the user lands on /governments with the same
          context they had here. */}
      <div className="mb-6 flex justify-center">
        <Link
          to={{ pathname: "/governments", search }}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground hover:bg-accent/10 hover:border-foreground/30 transition-colors"
        >
          {t("indicators_to_governments_link")}
          <ArrowUpRight className="h-3 w-3" />
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
                chartEvents={chartEvents}
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
                to={{
                  pathname: "/governments",
                  search,
                  hash: "#cabinet-table",
                }}
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
