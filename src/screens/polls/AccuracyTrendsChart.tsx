import { FC, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
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
import { usePreserveParams } from "@/ux/usePreserveParams";
import { tooltipSurfaceCompactClass } from "@/components/ui/tooltipSurface";
import { localDate } from "@/data/utils";

// Severity bands for cross-agency average MAE.
// Anything <= NORMAL is healthy polling; > ANOMALY means polls collectively missed
// — a signal the user wants to surface.
export const NORMAL_MAE = 2;
export const ANOMALY_MAE = 3;

const colorForMAE = (mae: number): string => {
  if (mae <= NORMAL_MAE) return "rgb(16, 185, 129)"; // emerald
  if (mae <= ANOMALY_MAE) return "rgb(245, 158, 11)"; // amber
  return "rgb(244, 63, 94)"; // rose
};

type Row = {
  date: string; // ISO
  label: string; // localized short date
  avgMae: number;
  maxMae: number;
  agencyCount: number;
  isSelected: boolean;
};

type TooltipPayload = {
  active?: boolean;
  payload?: { payload: Row }[];
};

const ChartTooltip: FC<TooltipPayload> = ({ active, payload }) => {
  const { t } = useTranslation();
  if (!active || !payload?.[0]) return null;
  const r = payload[0].payload;
  return (
    <div className={tooltipSurfaceCompactClass}>
      <div className="font-semibold">{r.label}</div>
      <div className="flex gap-2 mt-1">
        <span className="text-muted-foreground">{t("polls_avg_mae")}:</span>
        <span className="tabular-nums font-semibold">
          {r.avgMae.toFixed(2)}
        </span>
      </div>
      <div className="flex gap-2">
        <span className="text-muted-foreground">{t("polls_worst_mae")}:</span>
        <span className="tabular-nums font-semibold">
          {r.maxMae.toFixed(2)}
        </span>
      </div>
      <div className="text-muted-foreground mt-0.5">
        {r.agencyCount}{" "}
        {(r.agencyCount === 1
          ? t("polls_agency")
          : t("polls_agencies")
        ).toLowerCase()}
      </div>
    </div>
  );
};

/**
 * Per-election polling-accuracy bar chart (cross-agency average MAE) plus the
 * anomalous-elections callout. Shared between the dashboard tile
 * (`AccuracyTrendsTile`) and the `/polls` accuracy page. Self-fetches the
 * accuracy series; clicking a bar (or an anomaly row) re-anchors the selected
 * election. Renders `null` when fewer than two elections are available.
 */
export const AccuracyTrendsChart: FC<{ height?: number }> = ({
  height = 220,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const preserveParams = usePreserveParams();
  const { data: accuracy } = usePollsAccuracy();
  const { selected } = useElectionContext();
  const selectedIso = selected?.replace(/_/g, "-");

  const goToElection = useCallback(
    (iso: string) => {
      const electionParam = iso.replace(/-/g, "_");
      const params = preserveParams({ elections: electionParam });
      navigate(`/polls?${params.toString()}`);
    },
    [navigate, preserveParams],
  );

  const handleBarClick = useCallback(
    (data: { date?: string }) => {
      if (!data?.date) return;
      goToElection(data.date);
    },
    [goToElection],
  );

  const rows = useMemo<Row[]>(() => {
    if (!accuracy) return [];
    return accuracy.elections
      .filter((e) => e.agencies.length > 0)
      .map((e) => {
        const maes = e.agencies.map((a) => a.mae);
        const avg = maes.reduce((a, b) => a + b, 0) / maes.length;
        const max = Math.max(...maes);
        return {
          date: e.electionDate,
          label: localDate(e.electionDate.replace(/-/g, "_")),
          avgMae: avg,
          maxMae: max,
          agencyCount: e.agencies.length,
          isSelected: e.electionDate === selectedIso,
        };
      })
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [accuracy, selectedIso]);

  if (rows.length < 2) return null;

  const anomalies = rows.filter((r) => r.avgMae > ANOMALY_MAE);

  return (
    <>
      <div className="w-full mt-2" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            margin={{ top: 10, right: 8, left: 0, bottom: 0 }}
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
              tickFormatter={(v) => `${v}`}
              domain={[0, "dataMax + 0.5"]}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
            />
            <ReferenceLine
              y={NORMAL_MAE}
              stroke="rgb(16, 185, 129)"
              strokeDasharray="4 4"
              opacity={0.4}
              label={{
                value: t("polls_typical_threshold"),
                position: "right",
                fontSize: 9,
                fill: "rgb(16, 185, 129)",
                opacity: 0.7,
              }}
            />
            <Bar
              dataKey="avgMae"
              radius={[4, 4, 0, 0]}
              onClick={handleBarClick}
              style={{ cursor: "pointer" }}
              // Render bar shapes immediately. Without this, recharts leaves the
              // bars empty when the ResponsiveContainer first measures 0 width
              // (happens on mobile / async mount) — the grow animation never
              // recovers. Matches the rest of the app's charts.
              isAnimationActive={false}
            >
              {rows.map((r) => (
                <Cell
                  key={r.date}
                  fill={colorForMAE(r.avgMae)}
                  fillOpacity={r.isSelected ? 1 : 0.75}
                  stroke={r.isSelected ? "rgb(255 255 255 / 0.6)" : "none"}
                  strokeWidth={r.isSelected ? 1.5 : 0}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Anomalies callout */}
      {anomalies.length > 0 ? (
        <div className="mt-3 pt-3 border-t flex flex-col gap-1 text-xs">
          <div className="flex items-center gap-1 text-rose-600">
            <span className="text-[10px] uppercase tracking-wide font-medium">
              {t("polls_anomalous_elections")}
            </span>
          </div>
          {anomalies.map((a) => (
            <div
              key={a.date}
              className="flex justify-between items-baseline gap-2"
            >
              <button
                type="button"
                onClick={() => goToElection(a.date)}
                className="text-primary hover:underline text-left"
              >
                {a.label}
              </button>
              <span className="text-muted-foreground">
                {t("polls_avg_mae")}{" "}
                <span className="tabular-nums font-semibold text-foreground">
                  {a.avgMae.toFixed(2)}
                </span>{" "}
                · {t("polls_worst_mae").toLowerCase()}{" "}
                <span className="tabular-nums font-semibold text-foreground">
                  {a.maxMae.toFixed(2)}
                </span>
              </span>
            </div>
          ))}
          <div className="text-[10px] text-muted-foreground mt-1">
            {t("polls_anomalous_hint")}
          </div>
        </div>
      ) : null}
    </>
  );
};
