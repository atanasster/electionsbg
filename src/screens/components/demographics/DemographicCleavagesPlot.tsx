import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type {
  DemographicCleavageRow,
  DemographicCleavagesPayload,
} from "@/data/dashboard/useDemographicCleavages";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useTooltip } from "@/ux/useTooltip";
import { METRIC_BY_KEY } from "@/screens/components/demographics/censusMetrics";
import { partyHref } from "@/lib/utils";

const fmtR = (r: number) => `${r > 0 ? "+" : ""}${r.toFixed(2)}`;
// Maps r in [-1, 1] to a 0..100 horizontal position in the row track.
const xPct = (r: number) => 50 + Math.max(-1, Math.min(1, r)) * 50;

// The demographic-cleavages dot plot — a colour-dot per party on a −1…+1 track
// for each census metric, sorted by spread. Shared by the home
// DemographicCleavagesTile (a curated subset of rows) and the /party-demographics
// analysis page (the full metric set). Presentation only: the caller wraps it in
// a StatCard and decides which `rows` to pass.
export const DemographicCleavagesPlot: FC<{
  payload: DemographicCleavagesPayload;
  rows: DemographicCleavageRow[];
}> = ({ payload, rows }) => {
  const { t, i18n } = useTranslation();
  const { tooltip, ...tooltipEvents } = useTooltip();
  const { displayNameFor } = useCanonicalParties();
  const isBg = i18n.language === "bg";

  const partyName = (p: (typeof payload.parties)[number]) =>
    isBg ? p.nickName : (displayNameFor(p.nickName) ?? p.nickName);

  return (
    <>
      {/* Party legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 mb-3 text-[11px]">
        {payload.parties.map((p) => (
          <Link
            key={p.partyNum}
            to={partyHref(p.nickName)}
            className="flex items-center gap-1 hover:underline"
          >
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: p.color ?? "#888" }}
            />
            <span className="font-medium">{partyName(p)}</span>
            <span className="text-muted-foreground tabular-nums">
              {p.pctNational.toFixed(1)}%
            </span>
          </Link>
        ))}
      </div>

      {/* Rows: each is a track from −1 (red side) to +1 (green side) with a dot
          per party. Sorted by spread descending so the most polarizing
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
          const scatterTo = `/demographics?scatter=${row.metric}#scatter`;
          return (
            <Link
              key={row.metric}
              to={scatterTo}
              className="grid grid-cols-[minmax(0,1fr)_minmax(160px,2.5fr)_auto] gap-x-3 items-center text-xs hover:bg-muted/50 rounded px-1 py-0.5 -mx-1 group"
            >
              <span className="leading-tight group-hover:underline">
                {label}
              </span>
              <div className="relative h-5">
                {/* Track + zero line */}
                <div className="absolute inset-x-0 top-1/2 h-px bg-border -translate-y-1/2" />
                <div className="absolute top-1 bottom-1 left-1/2 w-px bg-border" />
                {/* One dot per party — overlapping is OK at this density. */}
                {row.rs.map((r, i) => {
                  const p = payload.parties[i];
                  return (
                    <span
                      key={p.partyNum}
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
                                {partyName(p)}
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
            </Link>
          );
        })}
      </div>
      {tooltip}
      <p className="text-[10px] text-muted-foreground italic mt-3">
        {t("dashboard_demographic_cleavages_note")}
      </p>
    </>
  );
};
