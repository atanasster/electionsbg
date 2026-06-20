// Mayor timeline: who was elected mayor of this município in each regular
// local cycle, newest at the top. Fans out useLocalMunicipalityHistory and
// reads each bundle's `mayor.elected`. A party change between consecutive
// cycles is flagged with the shared "flip" pill (tiered affiliation
// comparison — see `flipped` below). Self-hides for municípios with
// fewer than two cycles of elected-mayor data.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { History } from "lucide-react";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { useLocalMunicipalityHistory } from "@/data/local/useLocalMunicipalityHistory";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import {
  friendlyCycleDate,
  UNRESOLVED_PARTY_COLOR,
} from "@/data/local/cycleDate";
import { LocalMayorResult } from "@/data/local/types";
import { formatThousands } from "@/data/utils";
import { StatCard } from "../StatCard";

type Props = {
  obshtinaCode: string;
  className?: string;
};

type TimelineEntry = {
  cycle: string;
  date: string;
  mayor: LocalMayorResult;
};

// A "flip" is a change of political affiliation between the current entry and
// the older one beneath it. Tiered: independent↔party always flips; both
// canonical → compare ids; otherwise treat as "no flip" rather than guess
// (avoids spurious flips on coalition rebrands).
const flipped = (cur: LocalMayorResult, prev: LocalMayorResult): boolean => {
  if (cur.isIndependent !== prev.isIndependent) return true;
  if (cur.primaryCanonicalId && prev.primaryCanonicalId)
    return cur.primaryCanonicalId !== prev.primaryCanonicalId;
  return false;
};

export const LocalMayorTimelineTile: FC<Props> = ({
  obshtinaCode,
  className,
}) => {
  const { t } = useTranslation();
  const { colorFor } = useCanonicalParties();
  const { rows } = useLocalMunicipalityHistory(obshtinaCode);

  // Newest first; keep only cycles with an elected mayor.
  const entries = useMemo<TimelineEntry[]>(
    () =>
      [...rows]
        .reverse()
        .map((r) =>
          r.bundle?.mayor.elected
            ? {
                cycle: r.cycle,
                date: friendlyCycleDate(r.cycle),
                mayor: r.bundle.mayor.elected,
              }
            : null,
        )
        .filter((e): e is TimelineEntry => e !== null),
    [rows],
  );

  // A single-cycle "timeline" carries no history — hide it.
  if (entries.length < 2) return null;

  return (
    <StatCard
      className={className}
      label={
        <div className="flex items-center gap-2">
          <History className="h-4 w-4" />
          <span>{t("local_election_mayor_timeline_title")}</span>
        </div>
      }
      hint={t("local_election_mayor_timeline_hint")}
    >
      <ol className="mt-2">
        {entries.map((e, i) => {
          const m = e.mayor;
          const color = m.primaryCanonicalId
            ? (colorFor(m.primaryCanonicalId) ?? UNRESOLVED_PARTY_COLOR)
            : UNRESOLVED_PARTY_COLOR;
          const older = entries[i + 1];
          const isFlip = older ? flipped(m, older.mayor) : false;
          const isLast = i === entries.length - 1;
          return (
            <li key={e.cycle} className="flex gap-3">
              {/* Rail: party-coloured node + connector to the next entry. */}
              <div className="flex flex-col items-center pt-1">
                <span
                  aria-hidden
                  className="size-2.5 rounded-full ring-2 ring-background shrink-0"
                  style={{ backgroundColor: color }}
                />
                {!isLast ? (
                  <span aria-hidden className="w-px flex-1 bg-border mt-1" />
                ) : null}
              </div>
              {/* Content */}
              <div className={`min-w-0 ${isLast ? "" : "pb-4"}`}>
                <div className="text-[11px] tabular-nums text-muted-foreground">
                  {e.date}
                </div>
                <div className="mt-0.5 flex items-center gap-2 min-w-0">
                  <MpAvatar
                    name={m.candidateName}
                    mpId={m.mpId}
                    showPartyRing={false}
                  />
                  <span className="text-sm font-medium break-words min-w-0">
                    {m.candidateName}
                  </span>
                  {isFlip ? (
                    <span className="ml-0.5 inline-flex items-center rounded-md border border-amber-500/40 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 shrink-0">
                      {t("local_election_party_flipped")}
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  <span title={m.localPartyName}>
                    {m.isIndependent
                      ? t("local_election_independent")
                      : m.localPartyName}
                  </span>
                  <span className="mx-1.5">·</span>
                  <span className="tabular-nums whitespace-nowrap">
                    {t("local_election_elected_round", {
                      round:
                        m.round === 2
                          ? t("local_election_round_2")
                          : t("local_election_round_1"),
                    })}{" "}
                    ·{" "}
                    {t("local_election_ballot_votes", {
                      votes: formatThousands(m.votes),
                    })}{" "}
                    · {m.pctOfValid.toFixed(1)}%
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </StatCard>
  );
};
