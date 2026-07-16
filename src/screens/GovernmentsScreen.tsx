import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { useGovernments } from "@/data/governments/useGovernments";
import { useMacro } from "@/data/macro/useMacro";
import {
  useCabinetAnchor,
  useSetCabinetAnchor,
} from "@/data/macro/cabinetAnchor";
import { Link, useLocation } from "react-router-dom";
import {
  CabinetStrip,
  GovernmentTimeline,
} from "./components/governments/GovernmentTimeline";
import { xDomainFor } from "./components/governments/governmentTimelineUtils";
import { useEuMilestones } from "./components/governments/euMilestones";
import { useChartEvents } from "./components/governments/chartEvents";
import { GovernmentTable } from "./components/governments/GovernmentTable";
import { CabinetScoreDetail } from "./components/macro/CabinetScoreCard";

export const GovernmentsScreen = () => {
  const { t, i18n } = useTranslation();
  const { data: governments } = useGovernments();
  const { data: macro } = useMacro();
  const anchor = useCabinetAnchor();
  const setAnchor = useSetCabinetAnchor();
  const lang: "en" | "bg" = i18n.language === "bg" ? "bg" : "en";
  const { hash } = useLocation();
  // Multi-select via toggle-on-click — see IndicatorsLandingScreen for the
  // rationale; the GovernmentTable below also lists every cabinet, so this
  // strip mostly serves as a quick "pick a few to compare" picker.
  const [selectedCabinetIds, setSelectedCabinetIds] = useState<string[]>([]);
  const [userTouched, setUserTouched] = useState(false);

  const xDomain = useMemo<[number, number] | null>(
    () => (governments ? xDomainFor(governments) : null),
    [governments],
  );

  // Shared EU milestone list — see euMilestones.ts for placement rationale.
  const eventMarkers = useEuMilestones();
  // Societal-events strip below the chart (protests, crises, pandemic) —
  // distinct color rows from the EU milestone markers above the strip.
  const chartEvents = useChartEvents();

  // Default selection on this page = the current (incumbent) cabinet — its
  // endReason is "incumbent". Falls back to the last entry if none is so
  // marked. Resets if the user clears the selection.
  const defaultCabinetId = useMemo<string | null>(() => {
    if (!governments || governments.length === 0) return null;
    const incumbent = governments.find((g) => g.endReason === "incumbent");
    return incumbent?.id ?? governments[governments.length - 1].id;
  }, [governments]);

  useEffect(() => {
    if (userTouched) return;
    setSelectedCabinetIds(defaultCabinetId ? [defaultCabinetId] : []);
  }, [defaultCabinetId, userTouched]);

  // Hash-scroll: when the user arrives via /governments#cabinet-table from
  // the indicators "Compare all" link, scroll the target into view once the
  // governments + macro data have loaded (the table only renders then).
  useEffect(() => {
    if (!hash || !governments || !macro) return;
    const id = hash.replace(/^#/, "");
    if (!id) return;
    // rAF lets the just-rendered table reach the DOM before we measure.
    const handle = requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(handle);
  }, [hash, governments, macro]);

  const toggleCabinet = (id: string) => {
    setUserTouched(true);
    setSelectedCabinetIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const selectedCabinets = useMemo(() => {
    if (!governments || selectedCabinetIds.length === 0) return [];
    const set = new Set(selectedCabinetIds);
    return governments.filter((g) => set.has(g.id));
  }, [governments, selectedCabinetIds]);

  if (!governments) {
    return (
      <div className="pb-12">
        <Title>{t("governments_title")}</Title>
      </div>
    );
  }

  return (
    <div className="pb-12">
      <Title description={t("governments_description")}>
        {t("governments_title")}
      </Title>
      <GovernanceBreadcrumb
        sectionKey="governments_title"
        sectionTo="/governments"
        className="mt-5"
      />

      <p className="text-sm text-muted-foreground mb-6 max-w-3xl mx-auto text-center">
        {t("governments_explainer")}
      </p>

      {xDomain ? (
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
      ) : null}

      {macro && selectedCabinets.length > 0 ? (
        <section className="mb-8 mt-3 flex flex-col gap-2">
          {selectedCabinets.map((g) => (
            <CabinetScoreDetail key={g.id} government={g} macro={macro} />
          ))}
        </section>
      ) : null}

      <section className="mb-10">
        <div className="flex items-baseline justify-between mb-3 gap-4 flex-wrap">
          <h2 className="text-lg font-semibold">
            {t("governments_headline_tile_heading")}
          </h2>
          <Link
            to="/indicators"
            className="text-sm text-primary hover:underline whitespace-nowrap"
          >
            {t("governments_to_indicators_link")}
          </Link>
        </div>
        <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
          {t("governments_headline_tile_explainer")}
        </p>
        <GovernmentTimeline
          governments={governments}
          macro={macro}
          indicatorKeys={["gdpGrowth", "inflation", "unemployment"]}
          yAxisFormatter={(v) => `${v}`}
          unitFormatter={(_k, v) => `${v.toFixed(1)}%`}
          showZeroLine
          hideToggles
          height={280}
          eventMarkers={eventMarkers}
          onCabinetClick={setAnchor}
          highlightedCabinetId={anchor?.cabinet.id ?? null}
          chartEvents={chartEvents}
        />
      </section>

      <section id="cabinet-table" className="mb-10 scroll-mt-20">
        <h2 className="text-lg font-semibold mb-3">
          {t("governments_table_heading")}
        </h2>
        <GovernmentTable
          governments={governments}
          macro={macro}
          selectedIds={selectedCabinetIds}
        />
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-3">
          {t("governments_observations_heading")}
        </h2>
        <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
          {t("governments_observations_explainer")}
        </p>
        <Link
          to="/observations"
          className="text-sm text-primary hover:underline"
        >
          {t("observations_nav_link")}
        </Link>
      </section>

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
          href="https://www.osce.org/odihr/elections/bulgaria"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          OSCE/ODIHR
        </a>
        {" · "}
        {lang === "bg"
          ? "правителства от Уикипедия"
          : "cabinets from Wikipedia"}
      </p>
    </div>
  );
};
