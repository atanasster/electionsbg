// The labelled header above one voting track, rendered ONLY for a person whose BOTH
// municipal-council and National Assembly records actually put a card on the page (see
// useRenderedVotingTracks). It is what stops two bodies' voting records reading as one
// continuous history: a councillor's figures are measured against their council's own
// majority and an MP's against their parliamentary group, so the two are not comparable and
// must not look like one series.
//
// ⚠️ THE YEAR IS NOT DECORATION. The tracks are ordered chronologically, but the page shows
// no dates otherwise, so position alone would carry the career order — and position is
// exactly what a MISSING date decides: measured 2026-08-25, 107 of the 348 people holding
// both roles have every `mp` role undated, so their national track sorts last because
// `start_date` is NULL rather than because they served in the council first. Printing the
// year when there is one makes its ABSENCE visible, which is the honest signal that this
// track's position is a fallback rather than a fact.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Landmark, Vote } from "lucide-react";
import { SectionRule } from "@/screens/dashboard/DashboardSection";
import { votingTrackHeaderId, type VotingTrackKind } from "./votingTracks";

const PILL: Record<VotingTrackKind, { key: string; className: string }> = {
  local: {
    key: "pp_track_local",
    className: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20",
  },
  national: {
    key: "pp_track_national",
    className:
      "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  },
};

export const VotingTrackHeader: FC<{
  kind: VotingTrackKind;
  /** The track's earliest known start (ISO). Null when no role feeding it is dated — see
   *  the module header on why that absence is shown rather than filled in. */
  since?: string | null;
}> = ({ kind, since }) => {
  const { t } = useTranslation();
  const { key, className } = PILL[kind];
  const Icon = kind === "local" ? Landmark : Vote;
  return (
    // -mb-2 rather than mt-8: every wrapper up to the page body is a fragment, so this is a
    // direct child of a `space-y-4` container whose `> * ~ *` selector outranks a plain
    // `mt-*` utility. Pulling the pill DOWN is what binds it to the section it introduces.
    <div className="-mb-2 flex items-center gap-2">
      <span
        id={votingTrackHeaderId(kind)}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${className}`}
      >
        <Icon className="h-3 w-3" aria-hidden />
        {t(key)}
        {since && (
          <span className="font-normal tabular-nums opacity-80">
            · {t("pp_track_since", { year: since.slice(0, 4) })}
          </span>
        )}
      </span>
      <SectionRule />
    </div>
  );
};
