// Полиция / МВР tools. The МВР procurement corpus is served live from Postgres
// (answerable via the generic awarder/company tools on EIK 000695235), so the
// police-specific AI surface is the OUTCOME data the sector view adds:
//
//   securityRoadSafety  /security/road_safety.json — national road-traffic deaths
//                     (Eurostat sdg_11_40), the outcome the МВР traffic police &
//                     patrol-car procurement are meant to move.
//
// Mirrors the defense/judiciary tools' Envelope shape; every fact goes through
// ctx.lang and the tool never computes prose numbers — narrate() reads env.facts.
// See docs/plans/police-mvr-view-v1.md §7a.

import { fetchData } from "./dataClient";
import type { Envelope, ToolArgs, ToolContext } from "./types";

interface RoadSafetyFile {
  source: { label: string; dataset: string; sourceUrl: string };
  series: { year: number; deaths: number }[];
  latest: { year: number; deaths: number };
  peak: { year: number; deaths: number };
  changeSincePeakPct: number | null;
  changeSinceFirstPct: number | null;
}

// "Намаляват ли жертвите на пътя?" — the road-safety outcome, as a line the reader
// argues about when МВР's patrol-car spend is in the news.
export const securityRoadSafety = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const f = await fetchData<RoadSafetyFile>("/security/road_safety.json");
  const { latest, peak, changeSincePeakPct } = f;

  return {
    tool: "securityRoadSafety",
    domain: "indicators",
    kind: "series",
    title: bg ? "Загинали на пътя" : "Road traffic deaths",
    viz: "line",
    value: latest.deaths,
    valueFormat: "int",
    categories: f.series.map((d) => d.year),
    series: [
      {
        key: "deaths",
        label: bg ? "Загинали на пътя" : "Road deaths",
        points: f.series.map((d) => ({ x: d.year, y: d.deaths })),
      },
    ],
    markers: [{ x: peak.year, label: bg ? "пик" : "peak" }],
    facts: {
      latest_year: String(latest.year),
      latest_deaths: String(latest.deaths),
      peak_year: String(peak.year),
      peak_deaths: String(peak.deaths),
      change_since_peak:
        changeSincePeakPct == null
          ? "—"
          : `${changeSincePeakPct > 0 ? "+" : ""}${changeSincePeakPct}%`,
      note: bg
        ? "Инструментът на МВР е Пътна полиция (КАТ) и патрулните автомобили; безопасността зависи от много фактори — контекст, не причинно-следствена връзка."
        : "МВР's instrument is the traffic police (КАТ) and patrol vehicles; road safety has many drivers — context, not causation.",
    },
    provenance: ["security/road_safety.json (Eurostat sdg_11_40)"],
  };
};
