// The local country map, as a shell adapter (§6) — 31 oblast polygons filled by the party
// leading that oblast's COUNCIL VOTE.
//
// ⚠ VOTES, NEVER SEATS, AND THE TWO DISAGREE. `LocalRegionsControlMapTile`'s council map — the
// tile further down the same page — fills by top council party BY SEATS, which is the right
// answer to "who controls the councils here". This map sits beside the shell's ranked list, and
// that list is `buildCountrySurface`'s preview: party VOTES and their share of the national
// valid vote. Filling it by seats would colour an oblast for a party the table next to it does
// not lead — measured on the published corpus, that is Благоевград and Ямбол in 2023, three
// oblasts in 2011 and six in 2007. Seats are apportioned per município under a local threshold;
// a party spread thinly across many councils leads on votes and trails on seats. Both maps are
// true and they answer different questions, so each says which in its own tooltip header.
//
// ⚠ IT DRAWS ITS OWN FEATURES RATHER THAN REIMPLEMENTING A CHOROPLETH. `LocalChoropleth` already
// owns the projection, the Leaflet basemap, the SVG container and the tooltip for every local
// map on the site; what this adds is the fill rule, the labels and the drill-down.
//
// ⚠ NO `StatCard` WRAPPER — the same rule `ParliamentaryCountryMap` states. The canvas already
// draws the map's question as a heading, so a tile label and hint would frame it twice.
//
// ⚠ AN OBLAST WITH NO `councilVotes` IS LEFT UNFILLED AND SAYS SO. That is the state of a
// `regions_summary.json` written before the field existed — a cached copy, or a bucket that has
// not been re-synced — and borrowing the seats leader's colour there would publish one quantity
// under the other's label on exactly the oblasts where the two disagree.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useRegionsMap } from "@/data/regions/useRegionsMap";
import { useSofiaObshtinaMap } from "@/data/regions/useSofiaObshtinaMap";
import { useRegions } from "@/data/regions/useRegions";
import { useLocalRegionsSummary } from "@/data/local/useLocalRegionsSummary";
import { MeasuredMapBox } from "@/screens/components/maps/MeasuredMapBox";
import { LocalChoropleth } from "@/screens/components/local/LocalChoropleth";
import {
  LocalPartyBreakdownXS,
  type LocalBreakdownRow,
} from "@/screens/components/local/LocalPartyBreakdownXS";
import { formatInt, formatPct } from "@/lib/currency";
import type {
  RegionGeoJSON,
  RegionJSONProps,
} from "@/screens/components/maps/mapTypes";
import type { LocalRegionsSummaryRow } from "@/data/local/types";
import type { ElectionMapAdapterProps } from "../electionMapSlots";

/** Parliamentary geography splits Sofia city into three МИР (S23/S24/S25); local government
 *  treats it as ONE council, keyed `SOF`. */
const isSofiaMir = (nuts3: string): boolean => /^S2[345]$/.test(nuts3);

/** What one oblast's fill and tooltip are built from. `rows` is empty when the summary carries
 *  no answer for that oblast — which is a different state from "the party won no votes". */
type OblastReading = {
  rows: LocalBreakdownRow[];
  total: number;
  headerKey: string;
  /** ⚠ THE ABSENCE COPY IS PER-ARM TOO. A mayor slot that fell through to „няма данни за вота
   *  за съветите" would name the wrong ballot in the one sentence a reader gets when there is
   *  nothing else on the tooltip. */
  emptyKey: string;
};

/** ⚠ THE BASIS IS DECLARED ON THE MAP, because the heading above it cannot carry it and the
 *  page contradicts itself without it. The question comes from the shared descriptor —
 *  „Коя партия води в съветите по области?" — which is true of votes AND of seats; and the
 *  `LocalRegionsControlMapTile` further down the SAME page answers the seats reading, so on the
 *  oblasts where the two disagree a reader sees one province in two colours with nothing saying
 *  why. Naming the quantity here is cheaper and safer than re-wording a descriptor key the
 *  region level shares. */
const NOTE_KEY = {
  council: "local_map_council_votes_note",
  mayor: "local_map_mayors_note",
} as const;

const LocalCountryMap: FC<ElectionMapAdapterProps> = ({ cycle, ballot }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const isBg = lang?.startsWith("bg") ?? true;
  const { data: summary } = useLocalRegionsSummary(cycle);
  const regionsMap = useRegionsMap();
  const sofiaObshtina = useSofiaObshtinaMap();
  const { findRegion } = useRegions();
  // ⚠ THE MAYOR ARM IS A COUNT OF MAYORALTIES, NOT VOTES. Only the council ballot is generated
  // at this level today; the branch exists so a mayor slot — which resolves to this same
  // adapter key — cannot silently render mayoralty counts under a votes header.
  const isMayor = ballot === "municipality_mayor";

  const byOblast = useMemo(() => {
    const m = new Map<string, LocalRegionsSummaryRow>();
    for (const r of summary?.regions ?? []) m.set(r.oblast, r);
    return m;
  }, [summary]);

  // ⚠ THE THREE МИР POLYGONS ARE REPLACED, NOT RECOLOURED. Sofia has ONE общински съвет, so
  // three differently-filled slices of it would assert three council results for one council.
  // Until the Столична-община outline has loaded the city is simply absent from the map, which
  // is the honest intermediate state — the ranked list beside it is complete either way.
  const mapGeo = useMemo((): RegionGeoJSON | undefined => {
    if (!regionsMap) return undefined;
    const nonSofia = regionsMap.features.filter(
      (f) => !isSofiaMir(f.properties.nuts3),
    );
    if (!sofiaObshtina) return { ...regionsMap, features: nonSofia };
    return {
      ...regionsMap,
      features: [...nonSofia, ...sofiaObshtina.features],
    };
  }, [regionsMap, sofiaObshtina]);

  const regionName = (code: string): string => {
    const info = findRegion(code);
    if (!info) return code === "SOF" ? t("local_region_sofia_city") : code;
    return (
      (isBg
        ? info.long_name || info.name
        : info.long_name_en || info.name_en) || code
    );
  };

  const readingOf = (code: string): OblastReading => {
    const row = byOblast.get(code);
    if (isMayor) {
      const rows = (row?.mayorsWon ?? []).map((p) => ({
        id: p.canonicalId,
        name: p.displayName,
        color: p.color,
        value: p.count,
      }));
      return {
        rows,
        total: rows.reduce((a, r) => a + r.value, 0),
        headerKey: "local_region_mayors_count",
        emptyKey: "local_map_mayors_region_label_empty",
      };
    }
    // ⚠ NO `?? councilSeats` FALLBACK — see the header. An absent array means the summary
    // predates the field, and seats are not votes.
    const rows = (row?.councilVotes ?? []).map((p) => ({
      id: p.canonicalId,
      name: p.displayName,
      color: p.color,
      value: p.votes,
    }));
    return {
      rows,
      total: rows.reduce((a, r) => a + r.value, 0),
      headerKey: "local_region_council_votes_total",
      emptyKey: "local_map_council_region_label_empty",
    };
  };

  const labelOf = (code: string): string => {
    const { rows, total, emptyKey } = readingOf(code);
    const lead = rows[0];
    if (!lead || total <= 0) return t(emptyKey, { place: regionName(code) });
    return t(
      isMayor
        ? "local_map_mayors_region_label"
        : "local_map_council_region_label",
      {
        place: regionName(code),
        party: lead.name,
        pct: formatPct(lead.value / total, lang, 1),
      },
    );
  };

  return (
    <>
      <MeasuredMapBox>
        {(size) => (
          <LocalChoropleth<RegionJSONProps>
            size={size}
            mapGeo={mapGeo}
            colorOf={(p) => readingOf(p.nuts3).rows[0]?.color}
            ariaLabelOf={(p) => labelOf(p.nuts3)}
            tooltipOf={(p) => {
              const { rows, total, headerKey, emptyKey } = readingOf(p.nuts3);
              return (
                <div className="text-left">
                  <div className="pb-1 text-center text-sm font-semibold">
                    {regionName(p.nuts3)}
                  </div>
                  {rows.length ? (
                    <LocalPartyBreakdownXS
                      // ⚠ THE HEADER NAMES THE QUANTITY. „1 470 места" and „2 177 293 гласа" are
                      // both true of this corpus and neither can be read off the numbers alone.
                      header={t(headerKey, {
                        count: total,
                        votes: formatInt(total, lang),
                      })}
                      rows={rows}
                      total={total}
                    />
                  ) : (
                    <div className="text-xs opacity-70">
                      {t(emptyKey, { place: regionName(p.nuts3) })}
                    </div>
                  )}
                </div>
              );
            }}
            onClickPath={(p) =>
              // Sofia's one polygon is the Столична община itself, whose full result lives at the
              // município route; every other oblast drills into its own oblast page.
              p.nuts3 === "SOF"
                ? { pathname: `/local/${cycle}/SOF` }
                : { pathname: `/local/${cycle}/region/${p.nuts3}` }
            }
          />
        )}
      </MeasuredMapBox>
      <p className="mt-1 text-xs text-muted-foreground" data-map-basis>
        {t(NOTE_KEY[isMayor ? "mayor" : "council"])}
      </p>
    </>
  );
};

export default LocalCountryMap;
