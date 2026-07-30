// The PRESENTATIONAL place-identity hero — the Card shell, eyebrow, localized
// title, breadcrumb narrative (passed in, composed by renderPlaceNarrative), map
// thumbnail, optional GRAO population row, and the PlaceViewNav switcher. It is a
// pure function of already-resolved identity: it holds NO data hook, so a
// PG-backed page can render the exact same hero as the JSON-backed PlaceHeader
// without pulling the 940 KB settlements.json.
//
// PlaceHeader (the JSON wrapper) resolves identity from the shared geo hooks and
// feeds this; the procurement settlement page resolves from Postgres and feeds
// this. Both get the identical Card, so the same place stops looking like two
// unrelated pages.

import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Link } from "@/ux/Link";
import { PlaceLevel, PlaceView } from "@/data/local/placeViews";
import { PlaceViewNav } from "../PlaceViewNav";
import { PLACE_VIEW_META } from "../placeViewMeta";

export type PlaceHeaderGrao = {
  current: number;
  permanent: number;
  asOf: string | null;
};

type Props = {
  active: PlaceView;
  level: PlaceLevel;
  // Switcher codes — used to render the default PlaceViewNav (skipped when a
  // navSlot override is given or the place is abroad).
  ekatte?: string;
  obshtina?: string;
  oblast?: string;
  // Fully-resolved presentational identity.
  titleText: string;
  narrative: ReactNode;
  // Centroid for the static thumbnail (null → no thumbnail). Abroad suppresses
  // it regardless (a zoom-12 tile of a continent centre loads blank).
  loc: { lat: number; lon: number } | null;
  isAbroad: boolean;
  // Name used to label the thumbnail (a section borrows its settlement's name).
  thumbName: string;
  // When set, the thumbnail becomes a jump-link to that anchor (the Governance place
  // dashboard passes "#myarea-projects-map"); omitted → a plain static thumbnail. This is an
  // EXPLICIT prop rather than inferred from `active` so a page framed under governance (e.g.
  // the procurement settlement page) that has no such anchor doesn't get a link-to-nowhere.
  thumbAnchorHref?: string;
  // Optional GRAO population row (settlement level only in the JSON wrapper).
  grao?: PlaceHeaderGrao | null;
  // Makes the colored eyebrow a link (local → its cycle's overview feed).
  eyebrowTo?: string;
  // Trailing context after the eyebrow label (e.g. the local cycle date).
  eyebrowSuffix?: ReactNode;
  // Per-view content rendered under the breadcrumb (cross-links, a FollowStar…).
  extra?: ReactNode;
  // Replaces the default PlaceViewNav switcher.
  navSlot?: ReactNode;
  // "full" (default) = the dashboard hero: accent Card + eyebrow + view switcher — for pages
  // that ARE one of the switchable views (governance / parliamentary / local / consumption),
  // where the switcher actually navigates. "compact" = JUST the location display (title +
  // breadcrumb + map thumbnail), no Card chrome / eyebrow / switcher — for a page that merely
  // scopes ITS OWN data to a place (e.g. the procurement settlement page) and where a
  // view-switcher would be misleading (there is no procurement "view" to switch between).
  variant?: "full" | "compact";
  className?: string;
};

const formatNumber = (n: number | undefined, lang: "bg" | "en"): string => {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(lang === "bg" ? "bg-BG" : "en-GB");
};

// Single-tile OSM static thumbnail — no Leaflet on the hero path. Computes the
// fractional tile coords for the centroid at a fixed zoom and lays down a 3×3
// tile mosaic so the centroid sits at the middle, then drops a CSS pin.
const TILE_SIZE = 256;
const ZOOM = 12; // ~5 km across — good for "where in the oblast is this".
const THUMB_W = 144;
const THUMB_H = 96;
const SUBDOMAINS = ["a", "b", "c"];

const StaticOsmThumbnail: FC<{ lat: number; lon: number; alt: string }> = ({
  lat,
  lon,
  alt,
}) => {
  const n = Math.pow(2, ZOOM);
  const fx = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const fy =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const tx = Math.floor(fx);
  const ty = Math.floor(fy);
  // 3×3 mosaic centred on the centroid's tile, each tile placed so the centroid
  // lands at the thumbnail centre. A 3×3 grid (vs a 2×2) is what guarantees the
  // thumbnail is fully covered no matter where the centroid sits within its
  // tile — a 2×2 leaves a bare strip when the centroid is near the tile's top
  // or left edge (e.g. Plovdiv: map "cut off at the top").
  const tiles: Array<{
    x: number;
    y: number;
    sub: string;
    left: number;
    top: number;
  }> = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx;
      const y = ty + dy;
      tiles.push({
        x,
        y,
        sub: SUBDOMAINS[(((x + y) % 3) + 3) % 3],
        left: THUMB_W / 2 + (x - fx) * TILE_SIZE,
        top: THUMB_H / 2 + (y - fy) * TILE_SIZE,
      });
    }
  }
  return (
    <div
      className="relative rounded-md overflow-hidden border bg-muted"
      style={{ width: THUMB_W, height: THUMB_H }}
      aria-label={alt}
      role="img"
    >
      {tiles.map((tile) => (
        <img
          key={`${tile.x}-${tile.y}`}
          src={`https://${tile.sub}.tile.openstreetmap.org/${ZOOM}/${tile.x}/${tile.y}.png`}
          alt=""
          loading="lazy"
          decoding="async"
          // max-w-none: Tailwind preflight's `img { max-width: 100% }` would
          // otherwise clamp each tile to the 144px-wide thumbnail box (squishing
          // 256→142px and breaking the mosaic alignment). The old 2×2 wrapper
          // hid this by sizing the tiles' container to 512px.
          className="absolute select-none pointer-events-none max-w-none"
          style={{
            left: tile.left,
            top: tile.top,
            width: TILE_SIZE,
            height: TILE_SIZE,
          }}
        />
      ))}
      <span
        className="absolute size-2.5 rounded-full bg-primary ring-2 ring-background shadow"
        style={{
          left: THUMB_W / 2,
          top: THUMB_H / 2,
          transform: "translate(-50%, -50%)",
        }}
      />
    </div>
  );
};

export const PlaceHeaderView: FC<Props> = ({
  active,
  level,
  ekatte,
  obshtina,
  oblast,
  titleText,
  narrative,
  loc,
  isAbroad,
  thumbName,
  thumbAnchorHref,
  grao,
  eyebrowTo,
  eyebrowSuffix,
  extra,
  navSlot,
  variant = "full",
  className,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";

  const meta = PLACE_VIEW_META[active];
  const Icon = meta.icon;

  const thumbAlt =
    lang === "bg"
      ? `Карта на района — ${thumbName}`
      : `Area map — ${thumbName}`;

  // The static OSM thumbnail (shared by both variants). With thumbAnchorHref it becomes a
  // jump-link to that in-page anchor (the Governance dashboard's projects map); without it it
  // renders static. Abroad (МИР 32) has no meaningful street-map centroid, so it's dropped.
  const thumbnail =
    loc && !isAbroad ? (
      thumbAnchorHref ? (
        <a
          href={thumbAnchorHref}
          className="hidden sm:block shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={thumbAlt}
        >
          <StaticOsmThumbnail lat={loc.lat} lon={loc.lon} alt={thumbAlt} />
        </a>
      ) : (
        <div className="hidden sm:block shrink-0">
          <StaticOsmThumbnail lat={loc.lat} lon={loc.lon} alt={thumbAlt} />
        </div>
      )
    ) : null;

  // Compact: the location display alone — title + breadcrumb + map. No Card accent, no
  // eyebrow, no view switcher (a page like /procurement/settlement scopes its own data to a
  // place; it is not a switchable "view", so those cues would mislead). grao is not shown.
  if (variant === "compact") {
    return (
      <div className={cn("flex items-start gap-3", className)}>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl md:text-3xl font-bold">{titleText}</h1>
          {narrative ? (
            <p className="text-sm text-muted-foreground mt-1">{narrative}</p>
          ) : null}
          {extra ? <div className="mt-2">{extra}</div> : null}
        </div>
        {thumbnail}
      </div>
    );
  }

  const eyebrowInner = (
    <>
      <Icon className="size-3.5" aria-hidden />
      <span>{t(meta.labelKey)}</span>
    </>
  );

  return (
    <Card className={cn("p-4 md:p-5 border-l-4", meta.border, className)}>
      <div className="flex flex-col gap-3">
        {/* Eyebrow: the dashboard identity (accent colour + icon + label),
            optionally linking back to a parent feed, with a context suffix. */}
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide">
          {eyebrowTo ? (
            <Link
              to={eyebrowTo}
              underline
              className={cn("inline-flex items-center gap-1.5", meta.text)}
            >
              {eyebrowInner}
            </Link>
          ) : (
            <span className={cn("inline-flex items-center gap-1.5", meta.text)}>
              {eyebrowInner}
            </span>
          )}
          {eyebrowSuffix ? (
            <span className="font-normal normal-case text-muted-foreground">
              · {eyebrowSuffix}
            </span>
          ) : null}
        </div>

        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl md:text-3xl font-bold truncate">
              {titleText}
            </h1>
            {narrative ? (
              <p className="text-sm text-muted-foreground mt-1">{narrative}</p>
            ) : null}
            {grao ? (
              <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {grao.asOf
                    ? t("grao_tile_heading", { date: grao.asOf })
                    : t("grao_population_label")}
                </span>
                <span className="flex items-baseline gap-1.5">
                  <span className="text-muted-foreground">
                    {t("grao_current_address")}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatNumber(grao.current, lang)}
                  </span>
                </span>
                <span className="flex items-baseline gap-1.5">
                  <span className="text-muted-foreground">
                    {t("grao_permanent_address")}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatNumber(grao.permanent, lang)}
                  </span>
                </span>
              </div>
            ) : null}
            {extra ? <div className="mt-2">{extra}</div> : null}
          </div>
          {thumbnail}
        </div>

        {/* View switcher — pivot to this same place's other dashboards. A
            navSlot override (e.g. SOF city's single → parliamentary pill) is
            wrapped so it keeps its natural width rather than stretching to
            fill the Card's flex column. Abroad places (oblast 32) have only the
            parliamentary dimension, so the switcher is dropped altogether — no
            pills at all. */}
        {isAbroad ? null : navSlot !== undefined ? (
          <div className="flex">{navSlot}</div>
        ) : (
          <PlaceViewNav
            active={active}
            level={level}
            ekatte={ekatte}
            obshtina={obshtina}
            oblast={oblast}
            align="start"
          />
        )}
      </div>
    </Card>
  );
};
