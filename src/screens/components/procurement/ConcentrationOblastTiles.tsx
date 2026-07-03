// Flags-by-region tile-map for /procurement/flags. A grid of oblast tiles
// coloured by how many single-supplier-concentration pairs sit with buyers in
// that oblast. Clicking a tile scrolls to the concentration section below,
// filtered to that oblast.
// A separate "national / unresolved" tile covers buyers with no single seat
// (central ministries/agencies), so the map never silently drops them. Oblast is
// the awarder's seat oblast name (from awarder_seats), matching the explorer's
// own oblast filter.

import { FC } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

const countFmt = new Intl.NumberFormat("bg-BG");

// Coral ("risk") ramp, lightest → darkest. Matches the orange flag accent on
// the page. Text flips to light on the two darkest tiers.
const RAMP = ["#FAECE7", "#F5C4B3", "#F0997B", "#D85A30", "#993C1D"];
const DARK_TEXT = "#4A1B0C";

const tierOf = (count: number, max: number): number => {
  if (max <= 0) return 0;
  const t = Math.sqrt(count) / Math.sqrt(max);
  return Math.min(RAMP.length - 1, Math.floor(t * RAMP.length));
};

export const ConcentrationOblastTiles: FC<{
  byOblast: Array<{ oblast: string; count: number }>;
  nationalCount: number;
}> = ({ byOblast, nationalCount }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  if (byOblast.length === 0) return null;
  const max = byOblast.reduce((m, o) => Math.max(m, o.count), 0);

  const Tile: FC<{
    label: string;
    count: number;
    tier: number;
    to: string;
  }> = ({ label, count, tier, to }) => {
    const fill = RAMP[tier];
    const light = tier >= 3;
    const fg = light ? "#FFFFFF" : DARK_TEXT;
    return (
      <button
        type="button"
        onClick={() => navigate(to)}
        title={`${label}: ${countFmt.format(count)}`}
        className="rounded-md px-1.5 py-2 text-center transition-transform hover:scale-[1.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        style={{ background: fill }}
      >
        <div
          className="text-[11px] leading-tight truncate"
          style={{ color: fg }}
        >
          {label}
        </div>
        <div
          className="text-sm font-semibold tabular-nums"
          style={{ color: fg }}
        >
          {countFmt.format(count)}
        </div>
      </button>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-muted-foreground">
          {t("flags_map_caption") ||
            "Concentration flags by buyer's oblast — click to see the full list"}
        </p>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>{t("flags_map_few") || "few"}</span>
          {RAMP.map((c) => (
            <span
              key={c}
              className="inline-block h-2.5 w-3.5 rounded-sm"
              style={{ background: c }}
            />
          ))}
          <span>{t("flags_map_many") || "many"}</span>
        </div>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-7 gap-1.5">
        {byOblast.map((o) => (
          <Tile
            key={o.oblast}
            label={o.oblast}
            count={o.count}
            tier={tierOf(o.count, max)}
            to={`/procurement/flags?oblast=${encodeURIComponent(o.oblast)}#concentration`}
          />
        ))}
        {nationalCount > 0 && (
          <Tile
            label={t("flags_map_national") || "National"}
            count={nationalCount}
            tier={tierOf(nationalCount, max)}
            to="/procurement/flags?oblast=national#concentration"
          />
        )}
      </div>
    </div>
  );
};
