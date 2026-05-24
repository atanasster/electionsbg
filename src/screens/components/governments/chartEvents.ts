// Curated list of major historical events overlaid on the macro chart on
// /governments, /governments/:slug, and /indicators (hero chart). Distinct
// from the EU-integration milestone markers (which are political process —
// EU accession, Schengen, eurozone) — these are SOCIETAL events that
// shaped the macro picture during a cabinet's term.
//
// Three categories with distinct colors so the visual layer reads at a
// glance:
//   - protest    — civic mobilisations that pressured (or ended) cabinets
//   - crisis     — economic shocks (global recession, banking collapse)
//   - pandemic   — public-health emergencies that drove fiscal + economic
//                  policy
//
// Each event has either a point-in-time `start` only (rendered as a
// vertical marker) OR a `start` + `end` window (rendered as a translucent
// band). All dates are ISO; ChartEventsStrip converts them to fractional
// years on the chart's x-axis.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export type ChartEventCategory = "protest" | "crisis" | "pandemic";

export type ChartEvent = {
  id: string;
  category: ChartEventCategory;
  /** ISO date — start of the event (or single point). */
  start: string;
  /** ISO date — end of the event window. Omit for point events. */
  end?: string;
  /** Short label for the strip + tooltip header. */
  labelKey: string;
  /** One-line description for the tooltip body. */
  descriptionKey: string;
};

// Color tokens — chosen for AA contrast in both light/dark mode and to NOT
// collide with the cabinet party palette (red/grey/purple-pink GERB/BSP/
// Има такъв народ) or the EU-milestone amber inside the chart.
export const EVENT_CATEGORY_COLOR: Record<ChartEventCategory, string> = {
  protest: "#dc2626", // rose-600 — civic mobilisation
  crisis: "#b45309", // amber-700 — economic shock (distinct from EU amber)
  pandemic: "#7c3aed", // violet-600 — public-health emergency
};

// Categorical localised labels for the chart legend.
export const useChartEventCategoryLabels = (): Record<
  ChartEventCategory,
  string
> => {
  const { t } = useTranslation();
  return {
    protest: t("chart_event_category_protest"),
    crisis: t("chart_event_category_crisis"),
    pandemic: t("chart_event_category_pandemic"),
  };
};

// The curated set. Keep the list deliberately small — the strip starts to
// read as noise past ~8 events on a 21-year axis. Each entry has to clear
// the bar of "this materially shaped the macro picture or the cabinet
// landscape at the time".
const EVENTS: ChartEvent[] = [
  // 2008–2009 — global financial crisis hits BG via export shock + capital
  // outflows. Visible in the GDP line (deep dip in 2009) and the
  // unemployment ramp.
  {
    id: "global-financial-crisis",
    category: "crisis",
    start: "2008-09-15", // Lehman collapse
    end: "2009-12-31",
    labelKey: "chart_event_gfc_label",
    descriptionKey: "chart_event_gfc_desc",
  },
  // February 2013 — anti-monopoly / electricity-bill protests that took
  // down Borisov-I four months ahead of the regular election date.
  {
    id: "borisov-1-protests",
    category: "protest",
    start: "2013-02-17",
    end: "2013-03-20",
    labelKey: "chart_event_borisov1_protests_label",
    descriptionKey: "chart_event_borisov1_protests_desc",
  },
  // ДАНСwithMe — year-long mobilisation against the Oresharski cabinet
  // (started days after the Peevski-DANS appointment in June 2013).
  {
    id: "dans-with-me",
    category: "protest",
    start: "2013-06-14",
    end: "2014-07-23",
    labelKey: "chart_event_dans_label",
    descriptionKey: "chart_event_dans_desc",
  },
  // June 2014 — KTB (Corporate Commercial Bank) run + collapse. Largest
  // banking crisis in BG since the late-90s, drove the fiscal-reserve
  // line off a cliff.
  {
    id: "ktb-collapse",
    category: "crisis",
    start: "2014-06-20",
    end: "2014-11-06", // license withdrawn
    labelKey: "chart_event_ktb_label",
    descriptionKey: "chart_event_ktb_desc",
  },
  // COVID-19 — first WHO emergency declaration to the lifting of the
  // state of emergency in BG. Drove the 2020 GDP contraction + the
  // 2021–2023 inflation cycle that toppled multiple cabinets.
  {
    id: "covid-19",
    category: "pandemic",
    start: "2020-03-11",
    end: "2022-04-01",
    labelKey: "chart_event_covid_label",
    descriptionKey: "chart_event_covid_desc",
  },
  // Summer 2020 — anti-government / anti-Borisov-III protests over
  // alleged corruption + Geshev's prosecution practices. Did not topple
  // the cabinet but reshaped the 2021 election cycle.
  {
    id: "borisov-3-protests",
    category: "protest",
    start: "2020-07-09",
    end: "2020-09-02",
    labelKey: "chart_event_borisov3_protests_label",
    descriptionKey: "chart_event_borisov3_protests_desc",
  },
];

/** Memoised event list. Stable identity unless `t` changes, so chart
 *  components downstream don't re-render when navigating between cabinets. */
export const useChartEvents = (): ChartEvent[] => useMemo(() => EVENTS, []);

/** Filter to events overlapping a given fractional-year window. Used by
 *  the cabinet-detail screen to drop events outside the term ± buffer. */
export const filterEventsToWindow = (
  events: ChartEvent[],
  startFracYear: number,
  endFracYear: number,
): ChartEvent[] => {
  const toFrac = (iso: string): number => {
    const d = new Date(iso);
    const y = d.getUTCFullYear();
    const dayOfYear =
      (Date.UTC(y, d.getUTCMonth(), d.getUTCDate()) - Date.UTC(y, 0, 1)) /
      (1000 * 60 * 60 * 24);
    const daysInYear =
      (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / (1000 * 60 * 60 * 24);
    return y + dayOfYear / daysInYear;
  };
  return events.filter((e) => {
    const s = toFrac(e.start);
    const en = e.end ? toFrac(e.end) : s;
    return en >= startFracYear && s <= endFracYear;
  });
};
