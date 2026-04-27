import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { TrendingUp } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useElectionContext } from "@/data/ElectionContext";
import { CanonicalPartyHistory } from "@/data/parties/canonicalPartyTypes";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { PartyDashboardSummary } from "@/data/dashboard/partyDashboardTypes";
import {
  formatThousands,
  localDate,
  partyVotesPosition,
  totalAllVotes,
} from "@/data/utils";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";

const THRESHOLD = 4;

type Row = {
  election: string;
  label: string;
  pct: number;
  totalVotes: number;
  position: number;
  nickName: string;
  fullName?: string;
  passedThreshold: boolean;
  isSelected: boolean;
  rebrand: boolean;
};

type DotProps = {
  cx?: number;
  cy?: number;
  payload?: Row;
  color: string;
};

const TrajectoryDot: FC<DotProps> = ({ cx, cy, payload, color }) => {
  if (cx === undefined || cy === undefined || !payload) return null;
  const r = payload.isSelected ? 7 : payload.rebrand ? 6 : 4.5;
  const stroke = payload.isSelected
    ? "rgb(255 255 255 / 0.85)"
    : payload.rebrand
      ? color
      : "none";
  const fill = payload.passedThreshold ? color : "rgb(120, 120, 120)";
  return (
    <circle
      cx={cx}
      cy={cy}
      r={r}
      fill={payload.rebrand ? "white" : fill}
      stroke={payload.rebrand ? color : stroke}
      strokeWidth={payload.rebrand ? 2.5 : payload.isSelected ? 2 : 0}
    />
  );
};

type TooltipPayload = { active?: boolean; payload?: { payload: Row }[] };

const ChartTooltip: FC<TooltipPayload> = ({ active, payload }) => {
  const { t } = useTranslation();
  if (!active || !payload?.[0]) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow">
      <div className="font-semibold">{r.label}</div>
      {r.fullName ? (
        <div className="text-primary-foreground/80 max-w-[220px] truncate">
          {r.fullName}
        </div>
      ) : (
        <div className="text-primary-foreground/80">{r.nickName}</div>
      )}
      <div className="flex gap-2 mt-1">
        <span className="text-primary-foreground/70">{t("share")}:</span>
        <span className="tabular-nums font-semibold">{r.pct.toFixed(2)}%</span>
      </div>
      <div className="flex gap-2">
        <span className="text-primary-foreground/70">{t("votes")}:</span>
        <span className="tabular-nums font-semibold">
          {formatThousands(r.totalVotes)}
        </span>
      </div>
      <div className="flex gap-2">
        <span className="text-primary-foreground/70">{t("position")}:</span>
        <span className="tabular-nums font-semibold">#{r.position}</span>
      </div>
      <div className="text-primary-foreground/70 mt-0.5">
        {r.passedThreshold
          ? t("dashboard_above_threshold")
          : t("dashboard_below_threshold")}
      </div>
      {r.rebrand ? (
        <div className="text-amber-200 mt-0.5">
          {t("party_trajectory_rebrand")}
        </div>
      ) : null}
    </div>
  );
};

type Props = { data: PartyDashboardSummary };

export const PartyTrajectoryTile: FC<Props> = ({ data }) => {
  const { t } = useTranslation();
  const { stats, selected } = useElectionContext();
  const { canonicalIdFor, consolidationIdFor, byId } = useCanonicalParties();

  const rows = useMemo<Row[]>(() => {
    const id = canonicalIdFor(data.nickName);
    if (!id || !stats) return [];
    const canonical = byId.get(id);
    if (!canonical) return [];
    const historyByElection = new Map<string, CanonicalPartyHistory>();
    canonical.history.forEach((h) => historyByElection.set(h.election, h));
    if (canonical.history.length < 2) {
      const consolId = consolidationIdFor(data.nickName);
      if (consolId && consolId !== id) {
        const consolidated = byId.get(consolId);
        consolidated?.history.forEach((h) => {
          if (!historyByElection.has(h.election)) {
            historyByElection.set(h.election, h);
          }
        });
      }
    }
    const ordered = [...stats].sort((a, b) => (a.name < b.name ? -1 : 1));
    let prevNick: string | undefined;
    const out: Row[] = [];
    for (const e of ordered) {
      const h = historyByElection.get(e.name);
      if (!h) continue;
      const votes = e.results?.votes;
      if (!votes) continue;
      const totalAll = totalAllVotes(votes) ?? 0;
      const partyV = votes.find((v) => v.partyNum === h.partyNum);
      if (!partyV || !totalAll) continue;
      const pct = (100 * partyV.totalVotes) / totalAll;
      const pos = partyVotesPosition(h.partyNum, votes);
      const rebrand = prevNick !== undefined && prevNick !== h.nickName;
      out.push({
        election: e.name,
        label: localDate(e.name),
        pct: Math.round(pct * 100) / 100,
        totalVotes: partyV.totalVotes,
        position: pos?.position ?? 0,
        nickName: h.nickName,
        fullName: h.name,
        passedThreshold: pct >= THRESHOLD,
        isSelected: e.name === selected,
        rebrand,
      });
      prevNick = h.nickName;
    }
    return out;
  }, [
    data.nickName,
    stats,
    selected,
    canonicalIdFor,
    consolidationIdFor,
    byId,
  ]);

  if (rows.length < 2) return null;

  const color = data.color ?? "rgb(99, 102, 241)";
  const yMax = Math.max(...rows.map((r) => r.pct));
  const yDomainMax = Math.max(yMax + 2, THRESHOLD + 1);

  return (
    <StatCard
      label={
        <Hint text={t("party_trajectory_hint")} underline={false}>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            <span>{t("party_trajectory")}</span>
          </div>
        </Hint>
      }
      className="overflow-hidden"
    >
      <div className="w-full h-[240px] mt-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={rows}
            margin={{ top: 14, right: 18, left: -16, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              opacity={0.15}
            />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              interval={0}
              angle={-30}
              textAnchor="end"
              height={50}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={32}
              tickFormatter={(v) => `${v}%`}
              domain={[0, yDomainMax]}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ stroke: "rgba(255,255,255,0.08)" }}
            />
            <ReferenceLine
              y={THRESHOLD}
              stroke="rgb(244, 63, 94)"
              strokeDasharray="4 4"
              opacity={0.5}
              label={{
                value: `${THRESHOLD}% ${t("threshold").toLowerCase()}`,
                position: "right",
                fontSize: 9,
                fill: "rgb(244, 63, 94)",
                opacity: 0.7,
              }}
            />
            <Line
              type="monotone"
              dataKey="pct"
              stroke={color}
              strokeWidth={2.5}
              dot={<TrajectoryDot color={color} />}
              activeDot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </StatCard>
  );
};
