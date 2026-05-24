// Shared EU-integration milestone list overlaid on macro charts. Six events
// rendered as vertical reference lines + labels: EU accession (2007), ERM2
// entry (2020), Schengen air/sea (2024-03), Schengen land (2025-01),
// convergence report (2025-06), eurozone entry (2026-01). Centralised here
// so /governments, /governments/:slug, and /indicators (hero chart) all
// render the same milestone set — adding a 7th event (e.g. OECD accession)
// only touches one file.
//
// Labels alternate top/bottom in the dense 2024–2026 stretch to stop them
// piling on top of each other. Labels are centred on each line (position
// "top"/"bottom") so they extend both ways from the marker — the most
// space-efficient layout for tight clusters.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { EventMarker } from "./GovernmentTimeline";
import { toFractionalYear } from "./governmentTimelineUtils";

export const useEuMilestones = (): EventMarker[] => {
  const { t } = useTranslation();
  return useMemo(
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
        labelOffset: 20,
      },
      {
        x: toFractionalYear("2026-01-01"),
        label: t("governments_event_eurozone"),
        labelOffset: 20,
      },
    ],
    [t],
  );
};

/** Filter the full milestone list to those falling inside a cabinet's tenure
 *  window. Used by /governments/:slug so a narrow term doesn't paint markers
 *  in dead space. */
export const milestonesInWindow = (
  milestones: EventMarker[],
  startFracYear: number,
  endFracYear: number,
): EventMarker[] => {
  return milestones.filter((m) => m.x >= startFracYear && m.x <= endFracYear);
};
