// Replacement for EuCompareWgiRadar — 2×3 grid of small WGI radars, each
// showing BG vs ONE peer plus the EU27 reference. Avoids the "mushy middle"
// problem of overlaying 6 polygons on one chart (axis-order distortion +
// non-linear area scaling) by giving every peer its own panel. Shared scale
// across cells (radius axis fixed at -1.5..+1.5) so visual comparison
// between panels works.
//
// "Изглед" toggle at the top lets users flip to the legacy overlaid view
// (EuCompareWgiRadar) when they explicitly want all polygons in one frame
// — eg. screenshotting for an article. Small multiples is the default.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  useMacroPeers,
  WGI_DIMENSIONS,
  type PeerGeo,
  type WgiDimension,
} from "@/data/macro/useMacroPeers";
import { cn } from "@/lib/utils";
import { Flag } from "./Flag";
import { EuCompareWgiRadar } from "./EuCompareWgiRadar";
import {
  GEO_SHORT_BG,
  GEO_SHORT_EN,
  GEO_COLOR,
  usePeerSelection,
} from "./usePeerSelection";
import { pickByYear, useCompareSnapshotYear } from "./useElectionYear";

// Per-panel tooltip — shows the three series in scope (BG, the assigned peer,
// EU27) for whichever axis the cursor is over, sorted descending so the
// reader can spot the rank at a glance. Same shape as the legacy
// EuCompareWgiRadar tooltip but narrower (3 rows instead of all 6 peers).
type PanelTooltipProps = {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: unknown }>;
  label?: string | number;
  shortLabel: Record<PeerGeo, string>;
};

const PanelTooltip = ({
  active,
  payload,
  label,
  shortLabel,
}: PanelTooltipProps) => {
  if (!active || !payload || payload.length === 0) return null;
  const rows = payload
    .filter((p) => typeof p.value === "number")
    .map((p) => ({
      geo: p.dataKey as PeerGeo,
      value: p.value as number,
    }))
    .sort((a, b) => b.value - a.value);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-background/95 px-2.5 py-2 text-[11px] shadow-sm backdrop-blur">
      <div className="mb-1.5 font-semibold text-foreground">{label}</div>
      <div className="flex flex-col gap-0.5">
        {rows.map(({ geo, value }) => {
          const isBg = geo === "BG";
          return (
            <div
              key={geo}
              className={cn(
                "flex items-center gap-2",
                isBg ? "font-semibold text-foreground" : "text-foreground/85",
              )}
            >
              <Flag geo={geo} size={10} title={shortLabel[geo]} />
              <span className="w-6">{shortLabel[geo]}</span>
              <span className="ml-auto tabular-nums">{value.toFixed(2)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const DIM_LABEL_KEYS: Record<WgiDimension, string> = {
  VA: "eu_compare_wgi_dim_va",
  PV: "eu_compare_wgi_dim_pv",
  GE: "eu_compare_wgi_dim_ge",
  RQ: "eu_compare_wgi_dim_rq",
  RL: "eu_compare_wgi_dim_rl",
  CC: "eu_compare_wgi_dim_cc",
};

type Row = { dim: string } & Partial<Record<PeerGeo, number>>;

// One panel: BG (filled green polygon) + one peer (outlined polygon) +
// EU27 dashed reference. Shared radius scale across the grid keeps the
// shapes visually comparable across panels.
const PeerPanel: FC<{
  peerGeo: PeerGeo;
  rows: Row[];
  shortLabel: Record<PeerGeo, string>;
  lang: "bg" | "en";
  /** Render the panel's chrome around an EMPTY plot — the peers query is still
   *  in flight. Everything above the plot (both flags, both labels) comes from
   *  the URL peer selection and the locale, so the pending panel is the same
   *  box at the same height as the one that replaces it. */
  pending?: boolean;
}> = ({ peerGeo, rows, shortLabel, lang, pending = false }) => {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between text-[11px]">
        <span className="inline-flex items-center gap-1.5 font-semibold">
          <Flag geo="BG" size={11} title={shortLabel.BG} />
          {shortLabel.BG}
          <span className="text-muted-foreground font-normal mx-0.5">vs</span>
          <Flag geo={peerGeo} size={11} title={shortLabel[peerGeo]} />
          {shortLabel[peerGeo]}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {lang === "bg" ? "и ЕС-27" : "and EU27"}
        </span>
      </div>
      <div className="h-[200px] w-full">
        {pending ? (
          <div className="h-full w-full animate-pulse rounded bg-muted/40" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={rows} outerRadius="68%">
              <PolarGrid stroke="hsl(var(--border))" />
              <PolarAngleAxis
                dataKey="dim"
                tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
              />
              <PolarRadiusAxis
                domain={[-1.5, 1.5]}
                tick={false}
                axisLine={false}
                tickCount={4}
              />
              <Radar
                key="EU27_2020"
                name="EU27"
                dataKey="EU27_2020"
                stroke={GEO_COLOR.EU27_2020}
                strokeWidth={1.2}
                strokeDasharray="4 3"
                fill={GEO_COLOR.EU27_2020}
                fillOpacity={0}
                isAnimationActive={false}
              />
              <Radar
                key={peerGeo}
                name={shortLabel[peerGeo]}
                dataKey={peerGeo}
                stroke={GEO_COLOR[peerGeo]}
                strokeWidth={1.5}
                fill={GEO_COLOR[peerGeo]}
                fillOpacity={0.1}
                isAnimationActive={false}
              />
              <Radar
                key="BG"
                name={shortLabel.BG}
                dataKey="BG"
                stroke={GEO_COLOR.BG}
                strokeWidth={2.2}
                fill={GEO_COLOR.BG}
                fillOpacity={0.28}
                isAnimationActive={false}
              />
              <Tooltip
                cursor={{
                  stroke: "hsl(var(--muted-foreground))",
                  strokeWidth: 0.5,
                  strokeDasharray: "2 3",
                }}
                content={(props) => (
                  <PanelTooltip {...props} shortLabel={shortLabel} />
                )}
              />
            </RadarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

// "Изглед" — small multiples vs the legacy overlaid radar. Its own component
// because the loading placeholder renders it too: nothing in it depends on the
// payload (both labels are translation keys, the mode is local state), so it is
// part of the shape that must be there from first paint rather than something
// that arrives with the data.
const ViewToggle: FC<{
  mode: "small" | "overlaid";
  setMode: (m: "small" | "overlaid") => void;
}> = ({ mode, setMode }) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-end gap-1.5 text-[11px]">
      <span className="text-muted-foreground mr-1">
        {t("eu_compare_wgi_view_label")}
      </span>
      <button
        type="button"
        aria-pressed={mode === "small"}
        onClick={() => setMode("small")}
        className={cn(
          "px-2 py-0.5 rounded-full border transition-colors",
          mode === "small"
            ? "bg-foreground text-background border-transparent"
            : "bg-background text-muted-foreground border-border hover:bg-accent/10",
        )}
      >
        {t("eu_compare_wgi_view_small")}
      </button>
      <button
        type="button"
        aria-pressed={mode === "overlaid"}
        onClick={() => setMode("overlaid")}
        className={cn(
          "px-2 py-0.5 rounded-full border transition-colors",
          mode === "overlaid"
            ? "bg-foreground text-background border-transparent"
            : "bg-background text-muted-foreground border-border hover:bg-accent/10",
        )}
      >
        {t("eu_compare_wgi_view_overlaid")}
      </button>
    </div>
  );
};

export const EuCompareWgiSmallMultiples: FC = () => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { data: peers, isPending: peersPending } = useMacroPeers();
  const { geos } = usePeerSelection();
  const electionYear = useCompareSnapshotYear();
  const wgi = peers?.wgi;
  const shortLabel = lang === "bg" ? GEO_SHORT_BG : GEO_SHORT_EN;
  // "small" (default) — 2×3 grid of bilateral radars
  // "overlaid" — legacy single radar with all 6 polygons
  const [mode, setMode] = useState<"small" | "overlaid">("small");

  // One row per WGI dimension, value-keyed by every peer geo in scope. Each
  // PeerPanel reads BG + EU27 + its assigned peer column from the same rows
  // (cheap — already in memory).
  const rows: Row[] = useMemo(() => {
    if (!wgi) return [];
    return WGI_DIMENSIONS.map((dim) => {
      const row: Row = { dim: t(DIM_LABEL_KEYS[dim]) };
      const perGeo = wgi.series[dim] ?? {};
      for (const g of geos) {
        const cell = pickByYear(perGeo[g], electionYear);
        if (cell != null) row[g] = cell.value;
      }
      return row;
    });
  }, [wgi, geos, t, electionYear]);

  const resolvedYear = useMemo(() => {
    if (!wgi) return null;
    const firstDim = WGI_DIMENSIONS[0];
    const bgSeries = wgi.series[firstDim]?.BG;
    return pickByYear(bgSeries, electionYear)?.year ?? null;
  }, [wgi, electionYear]);

  // Filter out BG and EU27 — these are baked into every panel as the anchor +
  // reference. Only render a panel per user-toggleable peer. Derived from the
  // URL peer selection, so the panel COUNT is known before macro_peers.json is.
  const peerPanels = geos.filter((g) => g !== "BG" && g !== "EU27_2020");

  // While the peers query is unsettled this is the first thing the section
  // renders, and collapsing it to one line of text is what made the section
  // grow 208px → 1284px when macro_peers.json landed. Measured on
  // /indicators/compare (Pixel 5, 150ms RTT, 1.6Mbps, 4x CPU) that growth
  // pushed the snapshot table below it clean out of the viewport and scored
  // 0.2230 — the largest single shift on the page.
  //
  // There is no scalar height to reserve here, because the loaded state is a
  // grid of small multiples rather than one plot. So the placeholder is the
  // grid itself: the same wrapper, the same toggle row, one PeerPanel per
  // selected peer, each around the same fixed h-[200px] plot. Every input to
  // that shape (peer selection, locale) is available before the payload is, so
  // it reserves what actually arrives rather than an estimate of it.
  //
  // Pending ONLY. useMacroPeers' fetcher returns undefined on a non-ok
  // response and react-query records that as SUCCESS, so `!wgi` is permanent
  // after a failed fetch — reserving on it would hold a page of empty panels
  // for ever. A settled-but-empty payload falls through to the line of text
  // below, exactly as before.
  if (peersPending) {
    return (
      <div className="flex flex-col gap-3">
        <ViewToggle mode={mode} setMode={setMode} />
        {/* Mode-aware, like the loaded return below — the toggle is live while
            the payload is in flight, so a placeholder that ignored `mode` would
            leave it looking broken for the second the fetch takes. The overlaid
            view reserves its own plot. */}
        {mode === "small" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {peerPanels.map((g) => (
              <PeerPanel
                key={g}
                peerGeo={g}
                rows={[]}
                shortLabel={shortLabel}
                lang={lang}
                pending
              />
            ))}
          </div>
        ) : (
          <EuCompareWgiRadar />
        )}
        {/* The year footnote's text needs the payload, but its line box does
            not — reserving it with the same classes keeps the last 18px from
            shifting too, without inventing a year to display. */}
        <div
          className="text-[10px] text-muted-foreground/70 mt-1 text-right"
          aria-hidden
        >
          &nbsp;
        </div>
      </div>
    );
  }

  if (!wgi || rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("gov_macro_unavailable")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ViewToggle mode={mode} setMode={setMode} />

      {mode === "small" ? (
        peerPanels.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("eu_compare_wgi_no_peers")}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {peerPanels.map((g) => (
              <PeerPanel
                key={g}
                peerGeo={g}
                rows={rows}
                shortLabel={shortLabel}
                lang={lang}
              />
            ))}
          </div>
        )
      ) : (
        <EuCompareWgiRadar />
      )}

      <div className="text-[10px] text-muted-foreground/70 mt-1 text-right">
        {t("eu_compare_wgi_year", { year: resolvedYear ?? wgi.latestYear })}
      </div>
    </div>
  );
};
