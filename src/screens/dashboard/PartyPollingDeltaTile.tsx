import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Target } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usePollsAccuracy } from "@/data/polls/usePolls";
import { useElectionContext } from "@/data/ElectionContext";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { PartyDashboardSummary } from "@/data/dashboard/partyDashboardTypes";
import { localDate } from "@/data/utils";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";

type Row = {
  election: string; // YYYY_MM_DD
  label: string;
  delta: number; // actual - avgPolled (positive = under-polled)
  actual: number;
  avgPolled: number;
  agencyCount: number;
  isSelected: boolean;
};

type TooltipPayload = { active?: boolean; payload?: { payload: Row }[] };

const ChartTooltip: FC<TooltipPayload> = ({ active, payload }) => {
  const { t } = useTranslation();
  if (!active || !payload?.[0]) return null;
  const r = payload[0].payload;
  const sign = r.delta > 0 ? "+" : "";
  return (
    <div className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow">
      <div className="font-semibold">{r.label}</div>
      <div className="flex gap-2 mt-1">
        <span className="text-primary-foreground/70">
          {t("party_polling_delta_actual")}:
        </span>
        <span className="tabular-nums font-semibold">
          {r.actual.toFixed(2)}%
        </span>
      </div>
      <div className="flex gap-2">
        <span className="text-primary-foreground/70">
          {t("party_polling_delta_polled")}:
        </span>
        <span className="tabular-nums font-semibold">
          {r.avgPolled.toFixed(2)}%
        </span>
      </div>
      <div className="flex gap-2">
        <span className="text-primary-foreground/70">
          {t("party_polling_delta_diff")}:
        </span>
        <span className="tabular-nums font-semibold">
          {sign}
          {r.delta.toFixed(2)} pp
        </span>
      </div>
      <div className="text-primary-foreground/70 mt-0.5">
        {r.agencyCount}{" "}
        {(r.agencyCount === 1
          ? t("polls_agency")
          : t("polls_agencies")
        ).toLowerCase()}
      </div>
    </div>
  );
};

type Props = { data: PartyDashboardSummary };

export const PartyPollingDeltaTile: FC<Props> = ({ data }) => {
  const { t } = useTranslation();
  const { selected } = useElectionContext();
  const { canonicalIdFor, consolidationIdFor, byId } = useCanonicalParties();
  const { data: accuracy } = usePollsAccuracy();

  const rows = useMemo<Row[]>(() => {
    if (!accuracy) return [];
    const id = canonicalIdFor(data.nickName);
    if (!id) return [];
    const canonical = byId.get(id);
    if (!canonical) return [];
    const nickByElection = new Map<string, string>();
    canonical.history.forEach((h) =>
      nickByElection.set(h.election, h.nickName),
    );
    if (canonical.history.length < 2) {
      const consolId = consolidationIdFor(data.nickName);
      if (consolId && consolId !== id) {
        const consolidated = byId.get(consolId);
        consolidated?.history.forEach((h) => {
          if (!nickByElection.has(h.election)) {
            nickByElection.set(h.election, h.nickName);
          }
        });
      }
    }
    const out: Row[] = [];
    for (const e of accuracy.elections) {
      const electionKey = e.electionDate.replace(/-/g, "_");
      const nick = nickByElection.get(electionKey);
      if (!nick) continue;
      const actualEntry = e.actualResults.find((r) => r.key === nick);
      if (!actualEntry) continue;
      const errs = e.agencies
        .map((a) => a.errors.find((er) => er.key === nick))
        .filter((er): er is NonNullable<typeof er> => !!er);
      if (errs.length === 0) continue;
      const avgPolled = errs.reduce((s, er) => s + er.polled, 0) / errs.length;
      const actual = actualEntry.pct;
      const delta = actual - avgPolled;
      out.push({
        election: electionKey,
        label: localDate(electionKey),
        delta: Math.round(delta * 100) / 100,
        actual: Math.round(actual * 100) / 100,
        avgPolled: Math.round(avgPolled * 100) / 100,
        agencyCount: errs.length,
        isSelected: electionKey === selected,
      });
    }
    return out.sort((a, b) => (a.election < b.election ? -1 : 1));
  }, [
    accuracy,
    data.nickName,
    selected,
    canonicalIdFor,
    consolidationIdFor,
    byId,
  ]);

  if (rows.length < 2) return null;

  const partyColor = data.color ?? "rgb(99, 102, 241)";
  const positive = "rgb(16, 185, 129)"; // emerald — exceeded poll
  const negative = "rgb(244, 63, 94)"; // rose — fell short of poll
  const absMax = Math.max(...rows.map((r) => Math.abs(r.delta)), 1);

  return (
    <StatCard
      label={
        <Hint text={t("party_polling_delta_hint")} underline={false}>
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4" style={{ color: partyColor }} />
            <span>{t("party_polling_delta")}</span>
          </div>
        </Hint>
      }
      className="overflow-hidden"
    >
      <div className="w-full h-[220px] mt-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            margin={{ top: 10, right: 8, left: -16, bottom: 0 }}
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
              tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}`}
              domain={[-absMax - 0.5, absMax + 0.5]}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
            />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" />
            <Bar dataKey="delta" radius={[4, 4, 0, 0]}>
              {rows.map((r) => (
                <Cell
                  key={r.election}
                  fill={r.delta >= 0 ? positive : negative}
                  fillOpacity={r.isSelected ? 1 : 0.75}
                  stroke={r.isSelected ? "rgb(255 255 255 / 0.6)" : "none"}
                  strokeWidth={r.isSelected ? 1.5 : 0}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span
            className="inline-block w-2 h-2 rounded-sm"
            style={{ backgroundColor: positive }}
          />
          {t("party_polling_delta_outperformed")}
        </span>
        <span className="flex items-center gap-1">
          <span
            className="inline-block w-2 h-2 rounded-sm"
            style={{ backgroundColor: negative }}
          />
          {t("party_polling_delta_underperformed")}
        </span>
      </div>
    </StatCard>
  );
};
