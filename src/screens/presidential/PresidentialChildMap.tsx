// The presidential map for a place BELOW the country — its children, filled with the leading
// ticket's colour. Region → municipalities, município → settlements.
//
// ⚠⚠ IT FETCHES A WHOLE-COUNTRY ROLL-UP TO COLOUR ONE PARENT'S CHILDREN, and that is the cost
// this map has and the country map does not. The presidential tree has NO per-place shards
// below the country: each level is one file per round covering the whole country, which is
// exactly why those levels are `artifact` in `SURFACE_POLICY`. Measured on 2021, raw:
//
//     region page   → municipality_votes.json    0.96 MB   (272 entries)
//     município     → settlement_votes.json     14.63 MB   (4,184 entries)
//
// ⚠ THOSE ARE THE RAW SIZES AND THE BUCKET SERVES RAW BY DEFAULT — verified live, GCS answers
// `x-goog-stored-content-encoding: identity` for a data object that is not on
// `scripts/bucket_gzip.ts`'s hot list. Gzipped they are 47 KB and 346 KB, a 30-42x cut, so
// those four paths are ON that list; if they are ever dropped from it the município map becomes
// a 14.6 MB download and this component should be unregistered rather than left to ship it.
//
// The PARSE is not the problem and was measured rather than assumed: 19 ms for the settlement
// file on a laptop (V8, 4,184 entries, ~54 MB heap). The download is the whole cost.
//
// ⚠ THE ROUND IS A PROP, NOT A GUESS. A presidential place artifact carries TWO ballots of the
// same kind — one per round — and both declare a map, so the shell mounts this twice on one
// page. Round 1 and the runoff are different electorates (5.7 points apart nationally in 2021)
// and name different leaders in whole oblasts; a map that took the cycle's "current" round
// would colour the runoff canvas with round 1.
//
// ⚠ ONLY A `ready` ROLL-UP MAY COLOUR ANYTHING — the rule `PresidentialRegionsMap`'s header
// states at the country level, and it binds harder here. A child missing from a READY roll-up
// genuinely cast no votes; one missing because nothing has loaded yet has not, and the corpus
// is usually in that second state (`data/*_pvr` is gitignored and has no bucket copy). So this
// renders NOTHING until the roll-up answers, rather than a full map of „няма подадени гласове".

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMunicipalitiesMap } from "@/data/municipalities/useMunicipalitiesMap";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useSettlementsMap } from "@/data/settlements/useSettlementsMap";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { LocalChoropleth } from "@/screens/components/local/LocalChoropleth";
import {
  MAP_BOX_HEIGHT_CLASS,
  MeasuredMapBox,
} from "@/screens/components/maps/MeasuredMapBox";
import { formatPct } from "@/lib/currency";
import { presidentialUrl } from "@/data/elections/presidentialRoutes";
import {
  leadersByPlace,
  useRoundRollup,
  type RollupLevel,
} from "@/data/presidential/useRoundRollup";
import { useTicketsByNumber } from "@/data/presidential/useTickets";
import type {
  MunicipalityJSONProps,
  SettlementJSONProps,
} from "@/screens/components/maps/mapTypes";
import type { MapCoordinates } from "@/layout/dataview/MapLayout";

/** Which child grain a parent level's map draws, and which roll-up carries it. */
export type PresidentialChildGrain = Extract<
  RollupLevel,
  "municipality" | "settlement"
>;

type Props = {
  cycle: string;
  round: 1 | 2;
  /** The PARENT's id — an oblast code for the municipality grain, an obshtina code for the
   *  settlement grain. Children are narrowed to it; the roll-up covers the whole country. */
  parentId: string;
  grain: PresidentialChildGrain;
};

export const PresidentialChildMap: FC<Props> = (props) => (
  <MeasuredMapBox>{(size) => <Inner {...props} size={size} />}</MeasuredMapBox>
);

const Inner: FC<Props & { size: MapCoordinates }> = ({
  size,
  cycle,
  round,
  parentId,
  grain,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const isBg = lang?.startsWith("bg") ?? true;
  const rollup = useRoundRollup(cycle, round, grain);
  const tickets = useTicketsByNumber(cycle);
  const isMuni = grain === "municipality";

  // ⚠ BOTH GEO HOOKS ARE CALLED UNCONDITIONALLY — React hook order. Each is a no-op when its
  // argument is undefined, so the unused one costs no fetch.
  const muniGeo = useMunicipalitiesMap(isMuni ? parentId : "");
  const settlementGeo = useSettlementsMap(isMuni ? undefined : parentId);
  const { findMunicipality } = useMunicipalities();
  const { findSettlement } = useSettlementsInfo();

  const leaders = useMemo(
    () =>
      rollup.status === "ready"
        ? leadersByPlace(rollup.rollup)
        : new Map<
            string,
            { number: number; votes: number; shareOfTicketVotes: number }
          >(),
    [rollup],
  );

  const nameOf = (key: string): string => {
    if (isMuni) {
      const m = findMunicipality(key);
      return (isBg ? m?.name : m?.name_en) || m?.name || key;
    }
    const s = findSettlement(key);
    return (isBg ? s?.name : s?.name_en) || s?.name || key;
  };

  const labelOf = (key: string): string => {
    const lead = leaders.get(key);
    const ticket = lead ? tickets.get(lead.number) : undefined;
    const place = nameOf(key);
    return ticket && lead
      ? t("presidential_map_region_label", {
          place,
          president: ticket.president,
          pct: formatPct(lead.shareOfTicketVotes, lang, 1),
        })
      : t("presidential_map_region_label_empty", { place });
  };

  // ⚠ THE SLOT NEVER GOES EMPTY, because the canvas has already drawn this map's QUESTION as a
  // heading. An adapter that returns null there leaves „Коя двойка води във всяка община?"
  // standing over nothing — a question the page asks and does not answer, which is worse than
  // either a map or a stated absence. So the two non-ready states each render themselves:
  //
  //   loading  → the reserved box, so the arriving map does not shift the page
  //   absent   → one line, because the roll-up is genuinely not published for this cycle
  //
  // ⚠ AND „LOADING" MUST NOT SAY „NO DATA". `data/*_pvr` is gitignored with no bucket copy, so
  // `absent` is the ordinary answer for most of this corpus — but a request still in flight is
  // not an absence, and labelling it one flickers a false claim about named places on every
  // page that does load.
  if (rollup.status === "loading")
    return (
      <div
        className={`w-full animate-pulse rounded bg-muted ${MAP_BOX_HEIGHT_CLASS}`}
        aria-hidden="true"
      />
    );
  if (leaders.size === 0)
    return (
      <p className="text-sm text-muted-foreground" data-map-no-data>
        {t("election_map_no_data_here")}
      </p>
    );

  return isMuni ? (
    <LocalChoropleth<MunicipalityJSONProps>
      size={size}
      mapGeo={muniGeo}
      colorOf={(p) => tickets.get(leaders.get(p.nuts4)?.number ?? -1)?.color}
      ariaLabelOf={(p) => labelOf(p.nuts4)}
      tooltipOf={(p) => <Tip label={labelOf(p.nuts4)} round={round} />}
      onClickPath={(p) => ({
        pathname:
          presidentialUrl(cycle, "municipality", p.nuts4) ??
          `/presidential/${cycle}`,
      })}
    />
  ) : (
    <LocalChoropleth<SettlementJSONProps>
      size={size}
      mapGeo={settlementGeo}
      colorOf={(p) => tickets.get(leaders.get(p.ekatte)?.number ?? -1)?.color}
      ariaLabelOf={(p) => labelOf(p.ekatte)}
      tooltipOf={(p) => <Tip label={labelOf(p.ekatte)} round={round} />}
      onClickPath={(p) => ({
        pathname:
          presidentialUrl(cycle, "settlement", p.ekatte) ??
          `/presidential/${cycle}`,
      })}
    />
  );
};

/** ⚠ THE ROUND IS NAMED IN THE TOOLTIP, for the reason the country map's header gives: a map of
 *  an unstated round is a map of an unstated question, and this page shows two of them. */
const Tip: FC<{ label: string; round: 1 | 2 }> = ({ label, round }) => {
  const { t } = useTranslation();
  return (
    <div className="text-left">
      <div>{label}</div>
      <div className="opacity-70">{t("election_round", { round })}</div>
    </div>
  );
};
