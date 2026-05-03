import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { NationalPartyResult } from "@/data/dashboard/dashboardTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { useMps } from "@/data/parliament/useMps";
import {
  useParliamentGroups,
  stripPgPrefix,
} from "@/data/parliament/useParliamentGroups";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import { MAJORITY_SEATS, TOTAL_SEATS } from "@/screens/utils/seatAllocation";
import { formatPct, formatThousands } from "@/data/utils";
import { Link } from "@/ux/Link";
import { useNavigateParams } from "@/ux/useNavigateParams";
import { useTooltip } from "@/ux/useTooltip";
import { StatCard } from "./StatCard";

// Local row type — same shape as NationalPartyResult for the fields we render,
// plus an `isSplitChild` flag so the tooltip can hide vote totals for child
// groups (their votes belong to the parent coalition, not them individually).
type SeatRow = {
  partyNum: number;
  nickName: string;
  color: string;
  seats: number;
  totalVotes: number;
  pct: number;
  isSplitChild?: boolean;
};

type Props = {
  parties: NationalPartyResult[];
};

const ROWS = 9;
const R_IN = 70;
const R_OUT = 200;
const DOT_R = 4.6;

type Seat = { x: number; y: number; angle: number };

// Layout 240 seats across ROWS concentric arcs. Each row is allocated dots
// proportionally to its radius (longer arc → more seats fit). The dots are
// then flattened into a single array sorted left → right (largest angle to
// smallest) so we can paint them by party in left-to-right order.
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
    // Pad the arc slightly so end-dots aren't flush with the baseline.
    const PAD = 0.04 * Math.PI;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const angle = Math.PI - PAD - t * (Math.PI - 2 * PAD);
      seats.push({
        x: r * Math.cos(angle),
        y: -r * Math.sin(angle),
        angle,
      });
    }
  });
  // Largest angle (≈π) is leftmost; sort DESC so seats[0] is the leftmost dot.
  seats.sort((a, b) => b.angle - a.angle);
  return seats;
};

const fmt = (n: number) => n.toLocaleString("bg-BG").replace(/\s/g, ",");

export const MandatesTile: FC<Props> = ({ parties }) => {
  const { t } = useTranslation();
  const { tooltip, onMouseEnter, onMouseLeave } = useTooltip();
  const navigate = useNavigateParams();
  const { selected } = useElectionContext();
  const { mps, currentNs } = useMps();
  const { childrenFor } = useParliamentGroups();

  // Coalition→child-group MP counts, populated only when the selected election
  // is the currently-sitting NS (parliament.bg only reports current group
  // membership, so we can't reconstruct splits for past parliaments).
  const groupSeatsByShort = useMemo(() => {
    if (!mps || !currentNs) return null;
    const selFolder = electionToNsFolder(selected);
    const currentFolder = currentNs.match(/^(\d+)/)?.[1] ?? null;
    if (!selFolder || selFolder !== currentFolder) return null;
    const counts = new Map<string, number>();
    for (const mp of mps) {
      if (!mp.isCurrent || !mp.currentPartyGroupShort) continue;
      const bare = stripPgPrefix(mp.currentPartyGroupShort);
      counts.set(bare, (counts.get(bare) ?? 0) + 1);
    }
    return counts;
  }, [mps, currentNs, selected]);

  const partyByNum = useMemo(
    () => new Map(parties.map((p) => [p.partyNum, p])),
    [parties],
  );

  const { dots, legend, totalSeats } = useMemo(() => {
    const seated = parties
      .filter((p) => (p.seats ?? 0) > 0)
      .sort((a, b) => (b.seats ?? 0) - (a.seats ?? 0));

    // Expand split coalitions (e.g. ПП-ДБ → ПП + ДБ) using parliament-group
    // MP counts. The total seats per coalition stay the same (CIK seat count
    // == sum of child group MPs).
    const rows: SeatRow[] = [];
    seated.forEach((p) => {
      const children = groupSeatsByShort ? childrenFor(p.nickName) : undefined;
      if (children && children.length) {
        for (const c of children) {
          const seats = groupSeatsByShort!.get(c.shortName) ?? 0;
          if (seats <= 0) continue;
          rows.push({
            partyNum: p.partyNum, // click-through still goes to the coalition
            nickName: c.displayName,
            color: c.color,
            seats,
            totalVotes: 0,
            pct: 0,
            isSplitChild: true,
          });
        }
      } else {
        rows.push({
          partyNum: p.partyNum,
          nickName: p.nickName,
          color: p.color || "#888",
          seats: p.seats ?? 0,
          totalVotes: p.totalVotes,
          pct: p.pct,
        });
      }
    });
    // Re-sort after expansion so the legend (and dot painting) stays largest-first.
    rows.sort((a, b) => b.seats - a.seats);

    const allotted = rows.reduce((s, r) => s + r.seats, 0);
    const slots = buildSeatGrid(TOTAL_SEATS);

    const painted: {
      seat: Seat;
      color: string;
      row: SeatRow;
    }[] = [];
    let cursor = 0;
    rows.forEach((r) => {
      for (let i = 0; i < r.seats && cursor < slots.length; i++, cursor++) {
        painted.push({ seat: slots[cursor], color: r.color, row: r });
      }
    });

    return {
      dots: painted,
      legend: rows,
      totalSeats: allotted,
    };
  }, [parties, groupSeatsByShort, childrenFor]);

  const hasSeats = legend.length > 0;

  // SVG bounds — buildSeatGrid uses center (0, 0) with x ∈ [-R_OUT, R_OUT]
  // and y ∈ [-R_OUT, 0]. Add padding for dot radius and a baseline gap.
  const PADDING = 8;
  const W = 2 * (R_OUT + PADDING);
  const H = R_OUT + PADDING + DOT_R + 6;
  const cx = W / 2;
  const cy = R_OUT + PADDING;

  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <Landmark className="h-4 w-4" />
          <span>{t("dashboard_mandates")}</span>
        </div>
      }
      hint={t("dashboard_mandates_hint")}
    >
      {hasSeats ? (
        <div className="flex flex-col gap-3">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={t("dashboard_mandates")}
            className="w-full max-w-[440px] mx-auto"
          >
            <g transform={`translate(${cx}, ${cy})`}>
              {dots.map(({ seat, color, row }, i) => {
                const seatPct =
                  TOTAL_SEATS > 0 ? (row.seats / TOTAL_SEATS) * 100 : 0;
                const parentParty = partyByNum.get(row.partyNum);
                const partyPath = parentParty?.nickName ?? row.nickName;
                const tooltipContent = (
                  <div className="flex flex-col gap-0.5">
                    <div className="font-semibold">{row.nickName}</div>
                    <div className="tabular-nums">
                      {row.seats} {t("seats").toLowerCase()} ·{" "}
                      {seatPct.toFixed(1)}%
                    </div>
                    {!row.isSplitChild && (
                      <div className="tabular-nums opacity-90">
                        {formatThousands(row.totalVotes)}{" "}
                        {t("votes").toLowerCase()} · {formatPct(row.pct, 2)}
                      </div>
                    )}
                    {row.isSplitChild && parentParty && (
                      <div className="opacity-75 text-xs">
                        {t("from_coalition", {
                          coalition: parentParty.nickName,
                          defaultValue: `от коалиция ${parentParty.nickName}`,
                        })}
                      </div>
                    )}
                  </div>
                );
                return (
                  <circle
                    key={i}
                    cx={seat.x}
                    cy={seat.y}
                    r={DOT_R}
                    fill={color}
                    data-party={row.partyNum}
                    style={{ cursor: "pointer" }}
                    onMouseEnter={(e) =>
                      onMouseEnter(
                        { pageX: e.pageX, pageY: e.pageY },
                        tooltipContent,
                      )
                    }
                    onMouseLeave={onMouseLeave}
                    onClick={() =>
                      navigate({ pathname: `/party/${partyPath}` })
                    }
                  />
                );
              })}
            </g>
          </svg>
          {tooltip}
          <div className="flex items-baseline justify-center gap-2 -mt-1">
            <span className="text-2xl font-bold tabular-nums">
              {fmt(totalSeats)}
            </span>
            <span className="text-sm text-muted-foreground tabular-nums">
              / {TOTAL_SEATS} {t("seats").toLowerCase()}
            </span>
            <span className="text-xs text-muted-foreground">
              · {t("dashboard_majority_at", { majority: MAJORITY_SEATS })}
            </span>
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 mt-1">
            {legend.map((r, i) => {
              const pct = totalSeats > 0 ? (r.seats / TOTAL_SEATS) * 100 : 0;
              const parentParty = partyByNum.get(r.partyNum);
              const partyPath = parentParty?.nickName ?? r.nickName;
              return (
                <li
                  key={`${r.partyNum}-${r.nickName}-${i}`}
                  className="min-w-0"
                >
                  <Link
                    to={`/party/${partyPath}`}
                    underline={false}
                    className="flex items-center gap-2 text-sm hover:underline"
                  >
                    <span
                      className="inline-block w-3 h-3 rounded-sm shrink-0"
                      style={{ backgroundColor: r.color }}
                    />
                    <span className="truncate font-medium">{r.nickName}</span>
                    <span className="ml-auto tabular-nums font-semibold">
                      {r.seats}
                    </span>
                    <span className="tabular-nums text-xs text-muted-foreground w-10 text-right">
                      {pct.toFixed(1)}%
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("dashboard_no_seats_yet")}
        </p>
      )}
      <Link
        to="/simulator"
        className="text-xs text-primary hover:underline mt-2 self-end"
        underline={false}
      >
        {t("dashboard_open_simulator")} →
      </Link>
    </StatCard>
  );
};
