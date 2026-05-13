import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useTooltip } from "@/ux/useTooltip";
import { useParliamentGroups } from "@/data/parliament/useParliamentGroups";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { TOTAL_SEATS } from "@/screens/utils/seatAllocation";
import type { SessionItem, VoteValue } from "@/data/parliament/votes/types";

// Hemicycle representation of a single roll-call item. Each seat is one MP,
// colored by their cast vote. Seats are grouped by parliamentary group
// (largest first, left → right) and within each group are sub-sorted by vote
// — yes / no / abstain / absent — to surface intra-party splits as clean
// colored blocks rather than salt-and-pepper noise.

const ROWS = 9;
const R_IN = 70;
const R_OUT = 200;
const DOT_R = 4.6;

const VOTE_COLOR: Record<VoteValue, string> = {
  yes: "#10b981",
  no: "#ef4444",
  abstain: "#f59e0b",
  absent: "#cbd5e1",
};

const VOTE_ORDER: Record<VoteValue, number> = {
  yes: 0,
  no: 1,
  abstain: 2,
  absent: 3,
};

type Seat = { x: number; y: number; angle: number };

const buildSeatGrid = (total: number): Seat[] => {
  const radii = Array.from(
    { length: ROWS },
    (_, i) => R_IN + ((R_OUT - R_IN) * i) / (ROWS - 1),
  );
  const sumR = radii.reduce((s, r) => s + r, 0);
  const seatsPerRow = radii.map((r) => Math.round((total * r) / sumR));
  const diff = total - seatsPerRow.reduce((s, n) => s + n, 0);
  seatsPerRow[ROWS - 1] += diff;
  const seats: Seat[] = [];
  radii.forEach((r, rowIdx) => {
    const n = seatsPerRow[rowIdx];
    if (n <= 0) return;
    const PAD = 0.04 * Math.PI;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const angle = Math.PI - PAD - t * (Math.PI - 2 * PAD);
      seats.push({ x: r * Math.cos(angle), y: -r * Math.sin(angle), angle });
    }
  });
  seats.sort((a, b) => b.angle - a.angle);
  return seats;
};

interface Props {
  item: SessionItem;
  mpParty?: Record<string, string>;
  mpNames?: Record<string, string>;
}

export const SessionVoteHemicycle: FC<Props> = ({ item, mpParty, mpNames }) => {
  const { t } = useTranslation();
  const { tooltip, onMouseEnter, onMouseLeave } = useTooltip();
  const { colorForPartyShort, labelForPartyShort } = useParliamentGroups();

  const dots = useMemo(() => {
    if (!mpParty) return [];
    // Bucket votes by party.
    const byParty = new Map<string, { mpId: number; vote: VoteValue }[]>();
    for (const v of item.votes) {
      const party = mpParty[String(v.mpId)] ?? "—";
      const arr = byParty.get(party) ?? [];
      arr.push({ mpId: v.mpId, vote: v.vote });
      byParty.set(party, arr);
    }
    // Sort parties by seated count (descending) so the largest block sits on
    // the left arc. Within each party, sort by vote so MPs of the same
    // category cluster together.
    const ordered = [...byParty.entries()].sort(
      (a, b) => b[1].length - a[1].length,
    );
    const flat: { mpId: number; vote: VoteValue; party: string }[] = [];
    for (const [party, arr] of ordered) {
      arr.sort((a, b) => VOTE_ORDER[a.vote] - VOTE_ORDER[b.vote]);
      for (const v of arr) flat.push({ mpId: v.mpId, vote: v.vote, party });
    }
    return flat;
  }, [item, mpParty]);

  const slots = useMemo(
    () => buildSeatGrid(Math.max(TOTAL_SEATS, dots.length)),
    [dots.length],
  );

  if (dots.length === 0) return null;

  const PADDING = 8;
  const W = 2 * (R_OUT + PADDING);
  const H = R_OUT + PADDING + DOT_R + 6;
  const cx = W / 2;
  const cy = R_OUT + PADDING;

  const totals = item.tallies;
  const cast = totals.yes + totals.no + totals.abstain;

  return (
    <div className="px-4 py-3 bg-muted/20 border-t">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={t("votes_session_hemicycle") || "Roll-call hemicycle"}
        className="w-full max-w-[440px] mx-auto"
      >
        <g transform={`translate(${cx}, ${cy})`}>
          {dots.map((d, i) => {
            const seat = slots[i];
            if (!seat) return null;
            const partyColor = colorForPartyShort(d.party);
            const partyLabel = labelForPartyShort(d.party) || d.party;
            const name = mpNames?.[String(d.mpId)];
            const tooltipContent = (
              <div className="flex items-center gap-2.5 text-xs">
                <MpAvatar mpId={d.mpId} name={name} className="h-9 w-9" />
                <div className="flex flex-col gap-0.5 min-w-0">
                  {name && (
                    <div className="font-semibold truncate max-w-[200px]">
                      {name}
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <span
                      className="inline-block w-2 h-2 rounded-sm"
                      style={{ backgroundColor: partyColor ?? "#94a3b8" }}
                    />
                    <span>{partyLabel}</span>
                  </div>
                  <div
                    className="font-semibold uppercase tracking-wide"
                    style={{ color: VOTE_COLOR[d.vote] }}
                  >
                    {t(`vote_${d.vote}`) || d.vote}
                  </div>
                </div>
              </div>
            );
            return (
              <circle
                key={i}
                cx={seat.x}
                cy={seat.y}
                r={DOT_R}
                fill={VOTE_COLOR[d.vote]}
                stroke={partyColor ?? "transparent"}
                strokeWidth={partyColor ? 1.2 : 0}
                onMouseEnter={(e) =>
                  onMouseEnter(
                    { pageX: e.pageX, pageY: e.pageY },
                    tooltipContent,
                  )
                }
                onMouseLeave={onMouseLeave}
              />
            );
          })}
        </g>
      </svg>
      {tooltip}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-2 text-xs tabular-nums">
        <LegendDot
          color={VOTE_COLOR.yes}
          label={t("vote_yes") || "Yes"}
          count={totals.yes}
        />
        <LegendDot
          color={VOTE_COLOR.no}
          label={t("vote_no") || "No"}
          count={totals.no}
        />
        <LegendDot
          color={VOTE_COLOR.abstain}
          label={t("vote_abstain") || "Abstain"}
          count={totals.abstain}
        />
        <LegendDot
          color={VOTE_COLOR.absent}
          label={t("vote_absent") || "Absent"}
          count={totals.absent}
        />
        <span className="text-muted-foreground">
          · {cast} {t("vote_cast_short") || "cast"}
        </span>
      </div>
    </div>
  );
};

const LegendDot: FC<{ color: string; label: string; count: number }> = ({
  color,
  label,
  count,
}) => (
  <span className="inline-flex items-center gap-1.5">
    <span
      className="inline-block w-2.5 h-2.5 rounded-full"
      style={{ backgroundColor: color }}
    />
    <span>
      {label}: <span className="font-semibold">{count}</span>
    </span>
  </span>
);
