import { FC } from "react";
import { useTranslation } from "react-i18next";
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
import { localDate } from "@/data/utils";
import { AgencyProfile } from "@/data/polls/pollsTypes";

type TooltipDatum = { value: number; payload: { label: string; mae: number } };

const TooltipBody: FC<{ active?: boolean; payload?: TooltipDatum[] }> = ({
  active,
  payload,
}) => {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md bg-primary px-2 py-1 text-[11px] text-primary-foreground shadow">
      <div className="font-semibold">{d.label}</div>
      <div className="tabular-nums">MAE {d.mae.toFixed(2)}</div>
    </div>
  );
};

export const AgencyMaeHistory: FC<{
  profile: AgencyProfile;
  consensusMAE: number;
}> = ({ profile, consensusMAE }) => {
  const { t } = useTranslation();
  if (profile.maeHistory.length < 2) return null;
  const data = profile.maeHistory.map((h) => ({
    date: h.electionDate,
    label: localDate(h.electionDate.replace(/-/g, "_")),
    mae: h.mae,
  }));
  const maxY = Math.max(consensusMAE, ...data.map((d) => d.mae)) + 0.5;

  return (
    <div className="mt-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
        {t("polls_mae_history")}
      </div>
      <div className="w-full h-[120px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 6, right: 8, left: -16, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              opacity={0.15}
            />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 9 }}
              tickLine={false}
              axisLine={false}
              interval={0}
              angle={-30}
              textAnchor="end"
              height={36}
            />
            <YAxis
              tick={{ fontSize: 9 }}
              tickLine={false}
              axisLine={false}
              width={28}
              domain={[0, maxY]}
              tickFormatter={(v) => `${v}`}
            />
            <Tooltip content={<TooltipBody />} />
            <ReferenceLine
              y={consensusMAE}
              stroke="rgb(100 116 139)"
              strokeDasharray="3 3"
              opacity={0.6}
              label={{
                value: t("polls_consensus_short"),
                position: "right",
                fontSize: 9,
                fill: "rgb(100 116 139)",
              }}
            />
            <Line
              type="monotone"
              dataKey="mae"
              stroke="rgb(59 130 246)"
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
