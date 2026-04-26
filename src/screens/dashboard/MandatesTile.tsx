import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { NationalPartyResult } from "@/data/dashboard/dashboardTypes";
import { MAJORITY_SEATS, TOTAL_SEATS } from "@/screens/utils/seatAllocation";
import { formatPct, formatThousands } from "@/data/utils";
import { Link } from "@/ux/Link";
import { useTooltip } from "@/ux/useTooltip";
import { StatCard } from "./StatCard";

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

  const partyByNum = useMemo(
    () => new Map(parties.map((p) => [p.partyNum, p])),
    [parties],
  );

  const { dots, legend, totalSeats } = useMemo(() => {
    const seated = parties
      .filter((p) => (p.seats ?? 0) > 0)
      .sort((a, b) => (b.seats ?? 0) - (a.seats ?? 0));
    const allotted = seated.reduce((s, p) => s + (p.seats ?? 0), 0);
    const slots = buildSeatGrid(TOTAL_SEATS);

    const painted: { seat: Seat; color: string; partyNum: number }[] = [];
    let cursor = 0;
    seated.forEach((p) => {
      const color = p.color || "#888";
      const count = p.seats ?? 0;
      for (let i = 0; i < count && cursor < slots.length; i++, cursor++) {
        painted.push({ seat: slots[cursor], color, partyNum: p.partyNum });
      }
    });

    return {
      dots: painted,
      legend: seated,
      totalSeats: allotted,
    };
  }, [parties]);

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
              {dots.map(({ seat, color, partyNum }, i) => {
                const p = partyByNum.get(partyNum);
                const seatPct =
                  TOTAL_SEATS > 0 && p?.seats
                    ? (p.seats / TOTAL_SEATS) * 100
                    : 0;
                const tooltipContent = p ? (
                  <div className="flex flex-col gap-0.5">
                    <div className="font-semibold">{p.nickName}</div>
                    <div className="tabular-nums">
                      {p.seats} {t("seats").toLowerCase()} ·{" "}
                      {seatPct.toFixed(1)}%
                    </div>
                    <div className="tabular-nums opacity-90">
                      {formatThousands(p.totalVotes)} {t("votes").toLowerCase()}{" "}
                      · {formatPct(p.pct, 2)}
                    </div>
                  </div>
                ) : null;
                return (
                  <circle
                    key={i}
                    cx={seat.x}
                    cy={seat.y}
                    r={DOT_R}
                    fill={color}
                    data-party={partyNum}
                    style={{ cursor: "pointer" }}
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
            {legend.map((p) => {
              const pct =
                totalSeats > 0 ? ((p.seats ?? 0) / TOTAL_SEATS) * 100 : 0;
              return (
                <li
                  key={p.partyNum}
                  className="flex items-center gap-2 text-sm min-w-0"
                >
                  <span
                    className="inline-block w-3 h-3 rounded-sm shrink-0"
                    style={{ backgroundColor: p.color || "#888" }}
                  />
                  <span className="truncate font-medium">{p.nickName}</span>
                  <span className="ml-auto tabular-nums font-semibold">
                    {p.seats}
                  </span>
                  <span className="tabular-nums text-xs text-muted-foreground w-10 text-right">
                    {pct.toFixed(1)}%
                  </span>
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
