// Unified header for the three "views" of a single place — the personal
// My-Area dashboard (/my-area/:id), the parliamentary-elections results
// (/sections/:ekatte, /settlement/:obshtina), and the local-elections
// results (/local/:cycle/...). Before this component each screen rolled its
// own header (a Card hero, a centered serif H1, a plain inline <h1>), so the
// same place looked like three unrelated pages and nothing but the small
// switcher told you which dashboard you were on.
//
// This is the one header for all of them. The skeleton — Card shell, eyebrow,
// localized title, breadcrumb narrative, map thumbnail, and the embedded
// PlaceViewNav switcher — is identical across the three. Only a small set of
// per-view slots vary (the eyebrow's accent + label, an optional back-link,
// a cycle-date suffix, a cross-link, or a switcher override).
//
// "Which dashboard am I on" is answered three redundant ways, all keyed to
// one accent hue per view (PLACE_VIEW_META): the left border of the Card, the
// eyebrow icon + label, and the active pill inside PlaceViewNav.
//
// Identity is resolved from the shared geographic codes (the same hooks the
// screens already use), so the title is localized everywhere — fixing the
// local pages that used to hard-render the Bulgarian município name even in
// English. `fallbackName` covers the rare code that resolves to nothing.

import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Link } from "@/ux/Link";
import { PlaceLevel, PlaceView } from "@/data/local/placeViews";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useRegions } from "@/data/regions/useRegions";
import { useGraoMunicipalitySlice } from "@/data/grao/useGraoPopulation";
import { PlaceViewNav } from "./PlaceViewNav";
import { PLACE_VIEW_META } from "./placeViewMeta";

type Props = {
  active: PlaceView;
  level: PlaceLevel;
  ekatte?: string;
  obshtina?: string;
  oblast?: string;
  // Makes the colored eyebrow a link (local → its cycle's overview feed).
  eyebrowTo?: string;
  // Trailing context after the eyebrow label (e.g. the local cycle date).
  eyebrowSuffix?: ReactNode;
  // Title to show when the codes resolve to nothing (defensive / synthetic
  // aggregates like Sofia's SOF bundle).
  fallbackName?: string;
  // Per-view cross-link rendered under the breadcrumb (e.g. район → all of
  // Sofia).
  extra?: ReactNode;
  // Replaces the default PlaceViewNav switcher (e.g. SOF city keeps a single
  // → parliamentary pill instead of the three-way control).
  navSlot?: ReactNode;
  className?: string;
};

const formatNumber = (n: number | undefined, lang: "bg" | "en"): string => {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(lang === "bg" ? "bg-BG" : "en-GB");
};

// Settlement/município centroids in our data files are stored as "lon,lat"
// strings. Returns null if either coord can't be parsed.
const parseLoc = (loc?: string): { lat: number; lon: number } | null => {
  if (!loc) return null;
  const [lonStr, latStr] = loc.split(",");
  if (!lonStr || !latStr) return null;
  const lat = Number(latStr);
  const lon = Number(lonStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
};

// Single-tile OSM static thumbnail — no Leaflet on the hero path. Computes
// the fractional tile coords for the centroid at a fixed zoom and lays down a
// 3×3 tile mosaic so the centroid sits at the middle, then drops a CSS pin.
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

export const PlaceHeader: FC<Props> = ({
  active,
  level,
  ekatte,
  obshtina,
  oblast,
  eyebrowTo,
  eyebrowSuffix,
  fallbackName,
  extra,
  navSlot,
  className,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { findSettlement } = useSettlementsInfo();
  const { findMunicipality } = useMunicipalities();
  const { findRegion } = useRegions();

  const isSettlement = level === "settlement";
  // For a Sofia район the caller passes the район's parliamentary EKATTE as
  // `ekatte` (level "settlement") and the S2xxx code as `obshtina` (used only
  // by the switcher). Resolving the settlement gives us its real parent
  // município for the breadcrumb.
  const settlement = isSettlement ? findSettlement(ekatte) : undefined;
  const obshtinaForName = isSettlement ? settlement?.obshtina : obshtina;
  const muni = obshtinaForName ? findMunicipality(obshtinaForName) : undefined;
  const oblastCode = oblast ?? settlement?.oblast ?? muni?.oblast;
  const region = oblastCode ? findRegion(oblastCode) : undefined;

  // GRAO only for settlements — the slice is per-obshtina, indexed by ekatte.
  const graoObshtina = isSettlement ? settlement?.obshtina : undefined;
  const { data: graoSlice } = useGraoMunicipalitySlice(graoObshtina);

  const meta = PLACE_VIEW_META[active];
  const Icon = meta.icon;

  const settlementType = isSettlement ? settlement?.t_v_m : null;
  const resolvedName = isSettlement
    ? settlement
      ? lang === "bg"
        ? settlement.name
        : settlement.name_en
      : undefined
    : muni
      ? lang === "bg"
        ? muni.name
        : muni.name_en
      : undefined;
  const name = resolvedName ?? fallbackName ?? ekatte ?? obshtina ?? "";

  // Strip the tautological "област"/"region" suffix some region names carry
  // (SFO = "София област") — the narrative template re-adds it.
  const regionNameRaw = region
    ? lang === "bg"
      ? region.long_name || region.name
      : region.long_name_en || region.name_en
    : null;
  const regionName = regionNameRaw
    ? lang === "bg"
      ? regionNameRaw.replace(/\s+област$/u, "").trim()
      : regionNameRaw.replace(/\s+region$/iu, "").trim()
    : null;
  const muniName = muni ? (lang === "bg" ? muni.name : muni.name_en) : null;

  const graoRow =
    isSettlement && graoSlice && settlement
      ? graoSlice.settlements[settlement.ekatte]
      : undefined;
  const graoAsOf = isSettlement ? (graoSlice?.asOf ?? null) : null;

  const loc = isSettlement ? parseLoc(settlement?.loc) : parseLoc(muni?.loc);

  const muniHref =
    isSettlement && settlement ? `/settlement/${settlement.obshtina}` : null;
  const regionHref = oblastCode ? `/municipality/${oblastCode}` : null;

  // Composed breadcrumb narrative — município and oblast are links so the
  // reader can drill up the hierarchy.
  const renderNarrative = () => {
    if (!isSettlement) {
      // Município view: "Община {name}, област {region}".
      if (lang === "bg") {
        return (
          <>
            Община {name}
            {regionName && regionHref ? (
              <>
                , област{" "}
                <Link to={regionHref} underline>
                  {regionName}
                </Link>
              </>
            ) : null}
          </>
        );
      }
      return (
        <>
          {name} municipality
          {regionName && regionHref ? (
            <>
              ,{" "}
              <Link to={regionHref} underline>
                {regionName}
              </Link>{" "}
              oblast
            </>
          ) : null}
        </>
      );
    }
    // Settlement view.
    if (lang === "bg") {
      const typed = settlementType ? `${settlementType} ${name}` : name;
      return (
        <>
          {typed}
          {muniName && muniHref ? (
            <>
              {" "}
              в община{" "}
              <Link to={muniHref} underline>
                {muniName}
              </Link>
            </>
          ) : null}
          {regionName && regionHref ? (
            <>
              , област{" "}
              <Link to={regionHref} underline>
                {regionName}
              </Link>
            </>
          ) : null}
        </>
      );
    }
    return (
      <>
        {name}
        {muniName && muniHref ? (
          <>
            {" in "}
            <Link to={muniHref} underline>
              {muniName}
            </Link>{" "}
            municipality
          </>
        ) : null}
        {regionName && regionHref ? (
          <>
            ,{" "}
            <Link to={regionHref} underline>
              {regionName}
            </Link>{" "}
            oblast
          </>
        ) : null}
      </>
    );
  };

  const titleText =
    isSettlement && settlementType && lang === "bg"
      ? `${settlementType} ${name}`
      : name;
  const thumbAlt =
    lang === "bg" ? `Карта на района — ${name}` : `Area map — ${name}`;

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
            <p className="text-sm text-muted-foreground mt-1">
              {renderNarrative()}
            </p>
            {graoRow ? (
              <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {graoAsOf
                    ? t("grao_tile_heading", { date: graoAsOf })
                    : t("grao_population_label")}
                </span>
                <span className="flex items-baseline gap-1.5">
                  <span className="text-muted-foreground">
                    {t("grao_current_address")}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatNumber(graoRow.current, lang)}
                  </span>
                </span>
                <span className="flex items-baseline gap-1.5">
                  <span className="text-muted-foreground">
                    {t("grao_permanent_address")}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatNumber(graoRow.permanent, lang)}
                  </span>
                </span>
              </div>
            ) : null}
            {extra ? <div className="mt-2">{extra}</div> : null}
          </div>
          {/* Static OSM thumbnail. On My-Area it jumps to the projects map
              further down the page; elsewhere that anchor doesn't exist, so
              we render it static. Hidden on small screens. */}
          {loc ? (
            active === "myarea" ? (
              <a
                href="#myarea-projects-map"
                className="hidden sm:block shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label={thumbAlt}
              >
                <StaticOsmThumbnail
                  lat={loc.lat}
                  lon={loc.lon}
                  alt={thumbAlt}
                />
              </a>
            ) : (
              <div className="hidden sm:block shrink-0">
                <StaticOsmThumbnail
                  lat={loc.lat}
                  lon={loc.lon}
                  alt={thumbAlt}
                />
              </div>
            )
          ) : null}
        </div>

        {/* View switcher — pivot to this same place's other dashboards. A
            navSlot override (e.g. SOF city's single → parliamentary pill) is
            wrapped so it keeps its natural width rather than stretching to
            fill the Card's flex column. */}
        {navSlot !== undefined ? (
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
