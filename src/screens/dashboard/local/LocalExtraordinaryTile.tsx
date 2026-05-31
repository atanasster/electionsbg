// Country-dashboard tile surfacing the most recent extraordinary (partial +
// new) local elections held between regular cycles, with a link to the full
// /local/chmi feed. As-of filtered to the selected parliamentary date by
// useChmiHistoryAll. Auto-hides when there are no events yet.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarClock } from "lucide-react";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { useChmiHistoryAll } from "@/data/local/useChmiHistory";
import { ChmiPartyBadge } from "@/screens/local/ChmiPartyBadge";
import { titleCaseName } from "@/lib/utils";
import { StatCard } from "../StatCard";

const kindKey = (kind: string): string =>
  kind === "kmetstvo_mayor"
    ? "local_election_chmi_kind_kmetstvo"
    : kind === "rayon_mayor"
      ? "local_election_chmi_kind_rayon"
      : "local_election_chmi_kind_obshtina";

export const LocalExtraordinaryTile: FC = () => {
  const { t } = useTranslation();
  const { data } = useChmiHistoryAll();

  const recent = useMemo(
    () =>
      (data?.allEvents ?? [])
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 6),
    [data],
  );

  if (recent.length === 0) return null;

  return (
    <StatCard
      label={
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4" />
            <span>{t("chmi_feed_title")}</span>
          </div>
          <Link
            to="/local/chmi"
            className="inline-flex items-center gap-1 text-[11px] normal-case text-primary hover:underline shrink-0"
          >
            {t("local_extraordinary_view_all")}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      }
      hint={t("local_extraordinary_hint")}
    >
      <ul className="flex flex-col divide-y">
        {recent.map((e, i) => {
          return (
            <li
              key={`${e.cycle}-${e.obshtinaCode}-${e.kmetstvoName ?? "main"}-${i}`}
              className="flex items-center gap-2 py-2 text-sm"
            >
              <span className="w-20 shrink-0 text-xs text-muted-foreground tabular-nums">
                {e.date}
              </span>
              <MpAvatar
                name={e.candidateName}
                mpId={e.mpId}
                showPartyRing={false}
              />
              <div className="min-w-0 flex-1">
                <Link
                  to={`/local/${e.cycle}/${e.obshtinaCode}`}
                  className="block truncate font-medium hover:underline"
                >
                  {titleCaseName(e.candidateName)}
                </Link>
                <div className="truncate text-xs text-muted-foreground">
                  {t(kindKey(e.kind))} ·{" "}
                  {e.kmetstvoName ? `${e.kmetstvoName}, ` : ""}
                  {e.obshtinaName}
                </div>
              </div>
              <div className="shrink-0 max-w-[45%] text-xs text-muted-foreground">
                <ChmiPartyBadge
                  primaryCanonicalId={e.primaryCanonicalId}
                  localPartyName={e.localPartyName}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </StatCard>
  );
};
