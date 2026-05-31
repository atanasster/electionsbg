// Council-vote × Census 2021 demographic cleavages for a local-election cycle.
// The local analogue of DemographicCleavagesTile: each leading council party
// is a dot whose horizontal position is the Pearson r between its council vote
// share across municipalities and the demographic on that row. Reads the
// precomputed per-cycle aggregate; parties are keyed by canonical id and carry
// no per-party page, so the legend is plain (no links) and rows aren't
// clickable (there is no local cross-tab scatter explorer).

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { useLocalDemographicCleavages } from "@/data/local/useLocalDemographicCleavages";
import { useTooltip } from "@/ux/useTooltip";
import { Hint } from "@/ux/Hint";
import { METRIC_BY_KEY } from "@/screens/components/demographics/censusMetrics";
import { StatCard } from "../StatCard";
import { selectCleavageRows } from "../selectCleavageRows";

const fmtR = (r: number) => `${r > 0 ? "+" : ""}${r.toFixed(2)}`;

export const LocalDemographicCleavagesTile: FC<{ cycle: string }> = ({
  cycle,
}) => {
  const { t } = useTranslation();
  const { data: payload } = useLocalDemographicCleavages(cycle);
  const { tooltip, ...tooltipEvents } = useTooltip();

  const rows = useMemo(
    () => (payload ? selectCleavageRows(payload.rows) : []),
    [payload],
  );

  if (!payload || rows.length === 0) return null;

  // Maps r in [-1, 1] to a 0..100 horizontal position in the row track.
  const xPct = (r: number) => 50 + Math.max(-1, Math.min(1, r)) * 50;

  return (
    <StatCard
      label={
        <Hint text={t("local_demographic_cleavages_hint")} underline={false}>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            <span>{t("dashboard_demographic_cleavages")}</span>
          </div>
        </Hint>
      }
    >
      {/* Party legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 mb-3 text-[11px]">
        {payload.parties.map((p) => (
          <span key={p.canonicalId} className="flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: p.color ?? "#888" }}
            />
            <span className="font-medium">{p.displayName}</span>
            <span className="text-muted-foreground tabular-nums">
              {p.pctNational.toFixed(1)}%
            </span>
          </span>
        ))}
      </div>

      {/* Rows: each is a track from −1 (red side) to +1 (green side) with a
          dot per party. Sorted by spread descending so the most polarizing
          dimension is on top. */}
      <div className="flex flex-col gap-1.5">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(160px,2.5fr)_auto] gap-x-3 items-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <span>{t("census_axis_demographic")}</span>
          <span className="flex justify-between">
            <span>−1</span>
            <span>0</span>
            <span>+1</span>
          </span>
          <span className="text-right w-12">
            {t("dashboard_demographic_cleavages_spread")}
          </span>
        </div>
        {rows.map((row) => {
          const def = METRIC_BY_KEY[row.metric];
          const label = def ? t(def.i18nKey) : row.metric;
          return (
            <div
              key={row.metric}
              className="grid grid-cols-[minmax(0,1fr)_minmax(160px,2.5fr)_auto] gap-x-3 items-center text-xs px-1 py-0.5 -mx-1"
            >
              <span className="leading-tight">{label}</span>
              <div className="relative h-5">
                {/* Track + zero line */}
                <div className="absolute inset-x-0 top-1/2 h-px bg-border -translate-y-1/2" />
                <div className="absolute top-1 bottom-1 left-1/2 w-px bg-border" />
                {/* One dot per party — overlapping is OK at this density. */}
                {row.rs.map((r, i) => {
                  const p = payload.parties[i];
                  return (
                    <span
                      key={p.canonicalId}
                      className="absolute top-1/2 h-2.5 w-2.5 rounded-full border border-background -translate-x-1/2 -translate-y-1/2 cursor-pointer"
                      style={{
                        left: `${xPct(r)}%`,
                        backgroundColor: p.color ?? "#888",
                      }}
                      onMouseEnter={(e) =>
                        tooltipEvents.onMouseEnter(
                          { pageX: e.pageX, pageY: e.pageY },
                          <div className="text-left text-xs">
                            <div className="font-semibold pb-1 mb-1 border-b border-border">
                              {label}
                            </div>
                            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                              <span className="text-muted-foreground">
                                {p.displayName}
                              </span>
                              <span
                                className="font-semibold tabular-nums text-right"
                                style={{ color: p.color ?? "#888" }}
                              >
                                {fmtR(r)}
                              </span>
                            </div>
                          </div>,
                        )
                      }
                      onMouseMove={(e) =>
                        tooltipEvents.onMouseMove({
                          pageX: e.pageX,
                          pageY: e.pageY,
                        })
                      }
                      onMouseLeave={tooltipEvents.onMouseLeave}
                    />
                  );
                })}
              </div>
              <span className="text-xs font-semibold tabular-nums text-right w-12 text-muted-foreground">
                {row.spread.toFixed(2)}
              </span>
            </div>
          );
        })}
      </div>
      {tooltip}
      <p className="text-[10px] text-muted-foreground italic mt-3">
        {t("local_demographic_cleavages_note")}
      </p>
    </StatCard>
  );
};
