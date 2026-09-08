// Where the runoff winner picked up ground — 31 oblasts, and the table that says the same
// thing in words.
//
// ⚠⚠ EVERY NUMBER HERE IS OBSERVED, and that is why it sits beside the estimated Sankey rather
// than inside it. „The winner's gain here equals 62% of the votes the eliminated pairs held
// here" is arithmetic on two published protocol figures. It is NOT „62% of those voters went
// to the winner" — that is a claim about individuals, and the only thing in this feature
// entitled to make it is the regression, with its caveat attached. The copy therefore says
// „равен на" / „equal to", never „отидоха" / „went to".
//
// ⚠ THE DENOMINATOR IS THE ELIMINATED POOL, NOT THE VALID VOTE. A share-point swing would
// mostly measure the field narrowing from 23 pairs to 2 — Радев went 49.4% → 67.7% nationally
// almost everywhere — which says nothing about anywhere in particular.
//
// ⚠ COLOUR IS NEVER THE ONLY ENCODING (§4). The list is the text twin and precedes the map in
// the DOM; the map is the optional half of the pair, because a reader who cannot see it must
// still get every figure.
//
// ⚠ THE TURNOUT RATIOS USE EACH ROUND'S OWN PUBLISHED ROLL. `reg1` and `reg2` differ — rolls
// are corrected between the rounds and voters are added at the section on the day, by up to
// 6% in Софийска област in 2006 — so dividing round 1's voters by round 2's roll invents a
// turnout change that did not happen.

import { FC, useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { GeoPermissibleObjects } from "d3-geo";
import { Link, useNavigate } from "react-router-dom";
import { useRegionsMap } from "@/data/regions/useRegionsMap";
import { useRegions } from "@/data/regions/useRegions";
import { FeatureMap } from "@/screens/components/maps/FeatureMap";
import { SVGMapContainer } from "@/screens/components/maps/SVGMapContainer";
import { MeasuredMapBox } from "@/screens/components/maps/MeasuredMapBox";
import { getDataProjection } from "@/screens/components/maps/d3_utils";
import { useTooltip } from "@/ux/useTooltip";
import { presidentialUrl } from "@/data/elections/presidentialRoutes";
import { regionDisplayName } from "@/data/presidential/regionName";
import { formatInt, formatPct } from "@/lib/currency";
import {
  PICKUP_BANDS,
  bandFor,
  pickupRatio,
  turnoutRate,
} from "./runoffPickup";
import type { RunoffOblast } from "@/data/presidential/useRunoffTransfer";
import type { RegionJSONProps } from "@/screens/components/maps/mapTypes";
import type { MapCoordinates } from "@/layout/dataview/MapLayout";

/** ⚠ A PLACE WITH NO ROW TAKES THE NEUTRAL FILL, never a band's colour. */
const NO_DATA = "hsl(var(--muted))";

type Props = {
  cycle: string;
  /** The runoff winner, named so the copy can attribute the gain to a person rather than to
   *  „the winner", which a reader arriving at this tile has not been told. */
  winner: string;
  oblasts: RunoffOblast[];
};

export const PresidentialRunoffSwingMap: FC<Props> = (props) => (
  <MeasuredMapBox>
    {(size) => <MapInner {...props} size={size} />}
  </MeasuredMapBox>
);

const MapInner: FC<Props & { size: MapCoordinates }> = ({
  size,
  cycle,
  winner,
  oblasts,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const isBg = lang?.startsWith("bg") ?? true;
  const mapGeo = useRegionsMap();
  const { findRegion } = useRegions();
  const navigate = useNavigate();
  const { tooltip, ...tooltipEvents } = useTooltip();
  const byOblast = useMemo(
    () => new Map(oblasts.map((o) => [o.oblast, o])),
    [oblasts],
  );

  // ⚠ THE GEOMETRY IS CHECKED, NOT ASSUMED — `useRegionsMap` has no shape guard, and with no
  // error boundary in `src/` a render-time TypeError unmounts the React ROOT: a white screen
  // for the whole SPA rather than a missing map.
  const features = Array.isArray(mapGeo?.features) ? mapGeo.features : null;
  const { path } = useMemo(
    () => getDataProjection(mapGeo as GeoPermissibleObjects, size),
    [mapGeo, size],
  );
  if (!features) return null;
  return (
    <>
      <SVGMapContainer
        size={size}
        supportsShiftArrows={false}
        supportsNames={false}
      >
        {features.map((feature, i) => {
          const code = (feature.properties as RegionJSONProps).nuts3;
          const row = byOblast.get(code);
          const ratio = row ? pickupRatio(row) : null;
          const band = bandFor(ratio);
          const name = regionDisplayName(findRegion(code), isBg, code);
          // ⚠ THE LABEL CARRIES THE MEASURE, not only the place. Without it `FeatureMap`
          // derives `keyboard` as `!!ariaLabel && !!onClick` and leaves the region mouse-only.
          const label =
            row && ratio !== null
              ? t("presidential_pickup_map_label", {
                  place: name,
                  president: winner,
                  pct: formatPct(ratio, lang, 0),
                })
              : t("presidential_pickup_map_label_empty", { place: name });
          const to = presidentialUrl(cycle, "region", code);
          return (
            <FeatureMap
              key={code || i}
              geoPath={path}
              feature={feature}
              fillColor={band?.color ?? NO_DATA}
              ariaLabel={to ? label : undefined}
              onClick={to ? () => navigate(to) : undefined}
              onMouseEnter={(e) =>
                tooltipEvents.onMouseEnter(
                  { pageX: e.pageX, pageY: e.pageY },
                  <div className="text-left">
                    <div>{label}</div>
                    {row ? (
                      <div className="opacity-70">
                        {t("presidential_pickup_tooltip", {
                          from: formatInt(row.w1, lang),
                          to: formatInt(row.w2, lang),
                          pool: formatInt(row.elim, lang),
                        })}
                      </div>
                    ) : null}
                  </div>,
                )
              }
              onMouseMove={tooltipEvents.onMouseMove}
              onMouseLeave={tooltipEvents.onMouseLeave}
            />
          );
        })}
      </SVGMapContainer>
      {tooltip}
    </>
  );
};

export const PresidentialRunoffSwingList: FC<Props> = ({
  cycle,
  winner,
  oblasts,
}) => {
  const headingId = useId();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const isBg = lang?.startsWith("bg") ?? true;
  const { findRegion } = useRegions();

  // ⚠ SORTED BY NAME, not by the measure. A table ordered by pickup answers „where was the
  // swing biggest"; this table's job is to let a reader find their own oblast — the ranking is
  // what the map already shows.
  // ⚠ MEMOIZED, like the map's `byOblast` a few components up. 31 rows makes the cost
  // immaterial; the ASYMMETRY within one file is what invites a copy of the wrong half.
  const rows = useMemo(
    () =>
      oblasts
        .map((o) => ({
          o,
          name: regionDisplayName(findRegion(o.oblast), isBg, o.oblast),
          ratio: pickupRatio(o),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, lang)),
    [oblasts, findRegion, isBg, lang],
  );
  if (!rows.length) return null;

  return (
    <div>
      <h3 id={headingId} className="sr-only">
        {t("presidential_pickup_table_heading", { president: winner })}
      </h3>
      <div className="overflow-x-auto">
        <table
          aria-labelledby={headingId}
          className="w-full text-sm tabular-nums"
        >
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="py-1 pr-3 font-normal">
                {/* ⚠ THE BUNDLE'S OWN KEY, not the core `region`. They are identical in Bulgarian and
                    differ in English — „Oblast" against „Region" — so the same page headed its two
                    31-row tables differently, in one locale only. */}
                {t("presidential_col_region")}
              </th>
              {/* ⚠ NAMES LEFT, NUMBERS RIGHT. The `text-left` on `<thead>` reaches only these
                  header cells — the row header in `<tbody>` carries its own, because a `<th>`
                  defaults to `text-align: center`. */}
              <th scope="col" className="py-1 pr-3 text-right font-normal">
                {t("presidential_pickup_col_votes")}
              </th>
              <th scope="col" className="py-1 pr-3 text-right font-normal">
                {t("presidential_pickup_col_pool")}
              </th>
              <th scope="col" className="py-1 pr-3 text-right font-normal">
                {t("presidential_pickup_col_ratio")}
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                {t("presidential_pickup_col_turnout")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ o, name, ratio }) => {
              const to = presidentialUrl(cycle, "region", o.oblast);
              // ⚠ NOT `t1`/`t2` — three lines from `const { t } = useTranslation()`, in a
              // file where every other line reads `t("…")`, those scan as translator variants.
              const turnout1 = turnoutRate(o.a1, o.reg1);
              const turnout2 = turnoutRate(o.a2, o.reg2);
              return (
                <tr key={o.oblast} className="border-t">
                  <th scope="row" className="py-1 pr-3 text-left font-normal">
                    {to ? <Link to={to}>{name}</Link> : name}
                  </th>
                  {/* ⚠ `whitespace-nowrap` ON THE TWO ARROW CELLS. Right-aligned, „56 179 →
                      67 474" is free to break after the arrow, which would put the second
                      figure on its own line under the first and read as two rows. */}
                  <td className="whitespace-nowrap py-1 pr-3 text-right">
                    {formatInt(o.w1, lang)} → {formatInt(o.w2, lang)}
                  </td>
                  <td className="py-1 pr-3 text-right">
                    {formatInt(o.elim, lang)}
                  </td>
                  <td className="py-1 pr-3 text-right">
                    {/* ⚠ „—“, NEVER „0%“, where nobody was eliminated. */}
                    {ratio === null ? "—" : formatPct(ratio, lang, 0)}
                  </td>
                  <td className="whitespace-nowrap py-1 text-right">
                    {turnout1 === null || turnout2 === null
                      ? "—"
                      : `${formatPct(turnout1, lang, 1)} → ${formatPct(turnout2, lang, 1)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/** The map's legend. Exported so the screen can place it between the two halves. */
export const PresidentialRunoffSwingLegend: FC = () => {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {PICKUP_BANDS.map((b) => (
        <li key={b.key} className="flex items-center gap-1">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 rounded-sm"
            style={{ backgroundColor: b.color }}
          />
          {t(`presidential_pickup_band_${b.key}`)}
        </li>
      ))}
    </ul>
  );
};
