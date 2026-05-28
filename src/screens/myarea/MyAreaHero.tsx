// Hero strip at the top of the My-Area dashboard. Auto-generates a
// narrative line from settlement type + parent municipality + linked
// región, plus a compact registered-population table (current address +
// permanent address with the source date) and the centroid lat/lon so
// the user gets an immediate sense of "where" + "how many".
//
// The narrative is templated, not LLM-generated — same shape across all
// 5,300 settlements and zero hallucination risk. Município name and
// oblast name are rendered as Links to /settlement/<obshtina> and
// /municipality/<oblast> so the user can drill up from settlement →
// município → oblast in one click. The ГРАО registered-population
// block is the same data the CensusDemographicsTile used to surface
// further down the page; consolidating it here removes the duplicate
// (see CensusDemographicsTile's `hideGrao` prop) and gives the user the
// headcount the moment the page loads.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Link } from "@/ux/Link";
import type { ResolvedArea } from "@/data/area/useAreaResolver";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useRegions } from "@/data/regions/useRegions";
import { useGraoMunicipalitySlice } from "@/data/grao/useGraoPopulation";

type Props = {
  area: ResolvedArea;
};

const formatNumber = (n: number | undefined, lang: "bg" | "en"): string => {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(lang === "bg" ? "bg-BG" : "en-GB");
};

// Settlement/município centroids in our data files are stored as
// "lon,lat" strings. Returns null if either coord can't be parsed —
// callers branch on the result to skip rendering.
const parseLoc = (loc?: string): { lat: number; lon: number } | null => {
  if (!loc) return null;
  const [lonStr, latStr] = loc.split(",");
  if (!lonStr || !latStr) return null;
  const lat = Number(latStr);
  const lon = Number(lonStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
};

// Single-tile OSM static thumbnail. We don't pull Leaflet in for this —
// that would cost ~150 KB gz on the hero path (see MyAreaProjectsMapTile
// for the lazy-loaded variant). Instead we compute the fractional tile
// coords for the centroid at a fixed zoom and crop a 2×2 tile mosaic so
// the centroid sits at the middle of the visible thumbnail, then drop a
// CSS pin on top. No bundle cost beyond a few KB of JSX and four cached
// 256×256 PNGs from tile.openstreetmap.org.
const TILE_SIZE = 256;
const ZOOM = 12; // ~5 km across — good for "where in the oblast is this".
const THUMB_W = 144;
const THUMB_H = 96;

const StaticOsmThumbnail: FC<{
  lat: number;
  lon: number;
  alt: string;
}> = ({ lat, lon, alt }) => {
  const n = Math.pow(2, ZOOM);
  const fx = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const fy =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const tx = Math.floor(fx);
  const ty = Math.floor(fy);
  // Offset of the point inside the top-left tile (pixels).
  const ox = (fx - tx) * TILE_SIZE;
  const oy = (fy - ty) * TILE_SIZE;
  // Translate the 2×2 mosaic so the point lands at the thumbnail center.
  const shiftX = THUMB_W / 2 - ox;
  const shiftY = THUMB_H / 2 - oy;
  const tiles: Array<{
    x: number;
    y: number;
    sub: string;
    left: number;
    top: number;
  }> = [
    { x: tx, y: ty, sub: "a", left: 0, top: 0 },
    { x: tx + 1, y: ty, sub: "b", left: TILE_SIZE, top: 0 },
    { x: tx, y: ty + 1, sub: "c", left: 0, top: TILE_SIZE },
    { x: tx + 1, y: ty + 1, sub: "a", left: TILE_SIZE, top: TILE_SIZE },
  ];
  return (
    <div
      className="relative rounded-md overflow-hidden border bg-muted"
      style={{ width: THUMB_W, height: THUMB_H }}
      aria-label={alt}
      role="img"
    >
      <div
        className="absolute"
        style={{
          left: shiftX,
          top: shiftY,
          width: TILE_SIZE * 2,
          height: TILE_SIZE * 2,
        }}
      >
        {tiles.map((tile) => (
          <img
            key={`${tile.x}-${tile.y}`}
            src={`https://${tile.sub}.tile.openstreetmap.org/${ZOOM}/${tile.x}/${tile.y}.png`}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute select-none pointer-events-none"
            style={{
              left: tile.left,
              top: tile.top,
              width: TILE_SIZE,
              height: TILE_SIZE,
            }}
          />
        ))}
      </div>
      {/* Centered pin marking the centroid. Pure CSS — no SVG asset. */}
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

export const MyAreaHero: FC<Props> = ({ area }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { findMunicipality } = useMunicipalities();
  const { findRegion } = useRegions();

  // Only fetch ГРАО for settlements. The slice is keyed by obshtina, so
  // one settlement page fetches exactly one ~1 KB JSON.
  const obshtinaForGrao =
    area.kind === "settlement" ? area.obshtina : undefined;
  const { data: graoSlice } = useGraoMunicipalitySlice(obshtinaForGrao);

  if (area.kind === "unknown") {
    return null;
  }

  const isSettlement = area.kind === "settlement";
  const name = isSettlement
    ? lang === "bg"
      ? area.settlement.name
      : area.settlement.name_en
    : lang === "bg"
      ? area.municipality.name
      : area.municipality.name_en;
  const settlementType = isSettlement ? area.settlement.t_v_m : null;

  const muni = isSettlement ? findMunicipality(area.obshtina) : null;
  const region = findRegion(area.oblast);

  const muniName = muni ? (lang === "bg" ? muni.name : muni.name_en) : null;
  const regionNameRaw = region
    ? lang === "bg"
      ? region.long_name || region.name
      : region.long_name_en || region.name_en
    : null;
  // Some region names already carry the "област" / "region" suffix in the
  // source (notably SFO = "София област" / "Sofia region"). The narrative
  // template prepends "област " / appends " oblast", so without stripping
  // we'd produce "област София област" / "Sofia region oblast". Drop the
  // tautological suffix before prefixing.
  const regionName = regionNameRaw
    ? lang === "bg"
      ? regionNameRaw.replace(/\s+област$/u, "").trim()
      : regionNameRaw.replace(/\s+region$/iu, "").trim()
    : null;

  // Per-settlement ГРАО — both current-address and permanent-address
  // headcounts plus the source date. Surfaced here so users see the
  // population without scrolling to CensusDemographicsTile.
  const graoRow =
    isSettlement && graoSlice
      ? graoSlice.settlements[area.settlement.ekatte]
      : undefined;
  const graoAsOf = isSettlement ? (graoSlice?.asOf ?? null) : null;

  // Centroid for the static map thumbnail. Both settlements and municípios
  // carry a `loc` field ("lon,lat"). Settlements override on .settlement,
  // municípios on .municipality. Falls back to null which hides the thumb.
  const loc = isSettlement
    ? parseLoc(area.settlement.loc)
    : parseLoc(area.municipality.loc);

  // muniHref / regionHref drive the inline links in the narrative —
  // /settlement/:id accepts an obshtina code (despite the route name),
  // /municipality/:id accepts an oblast code. See SectionsScreen.tsx
  // for the canonical example of these breadcrumbs.
  const muniHref = isSettlement ? `/settlement/${area.obshtina}` : null;
  const regionHref = `/municipality/${area.oblast}`;

  // Composed narrative as JSX so município and oblast are links. The
  // typed strings below preserve the locative grammar — "в община",
  // "област ", " municipality", " oblast" — for non-link literals.
  const renderNarrative = () => {
    if (!isSettlement) {
      // Município view: "Община {name}, област {region-link}".
      if (lang === "bg") {
        return (
          <>
            Община {name}
            {regionName ? (
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
          {regionName ? (
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
    // Settlement view:
    //   BG: "{type} {name} в община {muni-link}, област {region-link}"
    //   EN: "{name} in {muni-link} municipality, {region-link} oblast"
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
          {regionName ? (
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
        {regionName ? (
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

  // Compact, single-row hero. The previous version had a three-line
  // structure (eyebrow + H1 + narrative + a separate ГРАО block + a
  // lat/lon column) that ate ~30% of the visible viewport on first
  // paint. We now:
  //   - drop the "МОЯТ РАЙОН" eyebrow (H1 + breadcrumb already say it)
  //   - drop the lat/lon column (developer info, not citizen info)
  //   - inline the breadcrumb narrative directly under the H1
  //   - render ГРАО as a single chip row beside the narrative on wide
  //     screens, wrapping below on mobile
  const thumbAlt =
    lang === "bg" ? `Карта на района — ${name}` : `Area map — ${name}`;

  return (
    <Card className="p-4 md:p-5">
      <div className="flex items-start gap-3">
        <MapPin className="size-5 text-primary mt-1 shrink-0" />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl md:text-3xl font-bold truncate">
            {isSettlement && settlementType && lang === "bg"
              ? `${settlementType} ${name}`
              : name}
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
        </div>
        {/* Static OSM thumbnail. Clicking jumps to the EU-funded projects
            map further down the page (id="myarea-projects-map"). If the
            projects tile is hidden (no geocoded contracts), the anchor
            no-ops and the browser stays put — better than removing the
            map link entirely. Hidden on small screens to keep the
            two-column hero from collapsing awkwardly. */}
        {loc ? (
          <a
            href="#myarea-projects-map"
            className="hidden sm:block shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md"
            aria-label={thumbAlt}
          >
            <StaticOsmThumbnail lat={loc.lat} lon={loc.lon} alt={thumbAlt} />
          </a>
        ) : null}
      </div>
    </Card>
  );
};
