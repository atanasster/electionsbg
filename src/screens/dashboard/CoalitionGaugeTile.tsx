import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Scale } from "lucide-react";
import { NationalPartyResult } from "@/data/dashboard/dashboardTypes";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { Link } from "@/ux/Link";
import {
  buildOfficialRows,
  findMinimalCoalitions,
  MAJORITY_SEATS,
  TOTAL_SEATS,
} from "@/screens/utils/seatAllocation";
import { PartySeats, StatsVote } from "@/data/dataTypes";
import { StatCard } from "./StatCard";

type Props = {
  parties: NationalPartyResult[];
};

// SVG semicircle gauge: filled arc proportional to majority-coalition seats / 240.
const Gauge: FC<{
  segments: { color: string; seats: number }[];
  total: number;
}> = ({ segments, total }) => {
  const W = 220;
  const H = 130;
  const cx = W / 2;
  const cy = H - 14;
  const r = 92;
  const stroke = 18;

  const polar = (angle: number) => {
    const a = (angle - 180) * (Math.PI / 180);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  };

  const arcPath = (startA: number, endA: number) => {
    const [x1, y1] = polar(startA);
    const [x2, y2] = polar(endA);
    const large = endA - startA > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  };

  let cursor = 0;
  const arcs = segments.map((s, i) => {
    const start = (cursor / total) * 180;
    cursor += s.seats;
    const end = (cursor / total) * 180;
    return (
      <path
        key={i}
        d={arcPath(start, end)}
        stroke={s.color}
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="butt"
      />
    );
  });

  // Majority threshold tick at MAJORITY_SEATS / 240 of the half-circle.
  const tickAngle = (MAJORITY_SEATS / total) * 180;
  const [tx1, ty1] = polar(tickAngle);
  const tickInner = r - stroke / 2 - 4;
  const tickOuter = r + stroke / 2 + 4;
  const a = (tickAngle - 180) * (Math.PI / 180);
  const tx0 = cx + tickInner * Math.cos(a);
  const ty0 = cy + tickInner * Math.sin(a);
  const tx2 = cx + tickOuter * Math.cos(a);
  const ty2 = cy + tickOuter * Math.sin(a);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      className="w-full max-w-[260px] mx-auto"
    >
      <path
        d={arcPath(0, 180)}
        stroke="currentColor"
        strokeOpacity={0.1}
        strokeWidth={stroke}
        fill="none"
      />
      {arcs}
      <line
        x1={tx0}
        y1={ty0}
        x2={tx2}
        y2={ty2}
        stroke="currentColor"
        strokeOpacity={0.7}
        strokeWidth={1.5}
      />
      <text
        x={tx1}
        y={ty1 - stroke / 2 - 8}
        textAnchor="middle"
        className="text-[9px] fill-muted-foreground font-medium uppercase tracking-wide"
      >
        {MAJORITY_SEATS}
      </text>
    </svg>
  );
};

const fmtSeats = (n: number) => n.toLocaleString("bg-BG").replace(/\s/g, ",");

export const CoalitionGaugeTile: FC<Props> = ({ parties }) => {
  const { t } = useTranslation();
  const { findParty } = usePartyInfo();

  const { rows, segments, leadCoalitionSeats, leadCoalitionPartyNums } =
    useMemo(() => {
      const seats: PartySeats[] = parties
        .filter((p) => (p.seats ?? 0) > 0)
        .map((p) => ({
          partyNum: p.partyNum,
          nickName: p.nickName,
          seats: p.seats ?? 0,
        }));
      const v: StatsVote[] = parties.map((p) => ({
        partyNum: p.partyNum,
        number: p.partyNum,
        nickName: p.nickName,
        totalVotes: p.totalVotes,
      }));
      const r = seats.length ? buildOfficialRows(seats, v) : [];

      // Pick first minimal-winning coalition (by size, then seats) as the
      // visualised majority. If no coalition reaches majority, just show
      // top-seated parties for context.
      const coalitions = findMinimalCoalitions(r, MAJORITY_SEATS, 4);
      const lead = coalitions[0];
      const leadSet = new Set(lead?.partyNums ?? []);

      const segs: { color: string; seats: number; partyNum: number }[] = r
        .filter((row) => leadSet.has(row.partyNum))
        .sort((a, b) => b.seats - a.seats)
        .map((row) => ({
          partyNum: row.partyNum,
          seats: row.seats,
          color: findParty(row.partyNum)?.color || "#888",
        }));

      return {
        rows: r,
        segments: segs,
        leadCoalitionSeats: lead?.seats ?? 0,
        leadCoalitionPartyNums: lead?.partyNums ?? [],
      };
    }, [parties, findParty]);

  const hasSeats = rows.length > 0;
  const reachesMajority = leadCoalitionSeats >= MAJORITY_SEATS;

  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4" />
          <span>{t("dashboard_coalition_math")}</span>
        </div>
      }
      hint={t("dashboard_coalition_hint")}
    >
      {hasSeats ? (
        <>
          <Gauge segments={segments} total={TOTAL_SEATS} />
          <div className="flex items-baseline justify-center gap-2 -mt-1">
            <span
              className={`text-3xl font-bold tabular-nums ${
                reachesMajority ? "text-emerald-600" : "text-muted-foreground"
              }`}
            >
              {fmtSeats(leadCoalitionSeats)}
            </span>
            <span className="text-sm text-muted-foreground tabular-nums">
              / {TOTAL_SEATS} {t("seats").toLowerCase()}
            </span>
          </div>
          <div className="text-xs text-center text-muted-foreground">
            {reachesMajority
              ? t("dashboard_coalition_reaches", {
                  majority: MAJORITY_SEATS,
                })
              : t("dashboard_coalition_short", {
                  short: MAJORITY_SEATS - leadCoalitionSeats,
                })}
          </div>
          {leadCoalitionPartyNums.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 mt-2">
              {leadCoalitionPartyNums.map((pn, i) => {
                const row = rows.find((r) => r.partyNum === pn);
                const party = findParty(pn);
                return (
                  <span key={pn} className="flex items-center gap-1 text-xs">
                    {i > 0 && <span className="text-muted-foreground">+</span>}
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-sm"
                      style={{ backgroundColor: party?.color || "#888" }}
                    />
                    <span className="font-medium">
                      {party?.nickName || row?.nickName}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      ({row?.seats})
                    </span>
                  </span>
                );
              })}
            </div>
          )}
        </>
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
