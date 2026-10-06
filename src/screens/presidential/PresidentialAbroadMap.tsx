// The presidential abroad map — every country with a polling station, filled with the leading
// ticket's colour, with the two-round hover card the country and place maps carry.
//
// ⚠ IT IS DRAWN BY COUNTRY, NOT BY CONTINENT, and that is what made it buildable. The registry
// used to refuse this level because the parliamentary abroad geometry (`maps/regions/32.json`)
// is six CONTINENTS while this tree keys abroad by ISO-2 COUNTRY, with no crosswalk between
// them. But the six per-continent files under `maps/municipalities/<AF|AS|EU|NA|OC|SA>.json`
// ARE the crosswalk: each feature is one country (`ekatte` = its ISO-2 code, `nuts4` = its
// continent), and together they cover every country the corpus names — Kosovo included, under
// the same Cyrillic `КО` key both sides use. So this joins exactly, invents nothing, and answers
// the question the descriptor already asks („Коя двойка води по държави?").
//
// ⚠ HOVER-ONLY. No presidential page exists per country, so a click would lead nowhere; a
// feature with no click is not a keyboard stop, which is honest for one that activates
// nothing. The text equivalent is the per-country table under „География".
//
// ⚠ ONLY A READY ROLL-UP COLOURS ANYTHING — the rule every presidential map states. A country
// missing from a READY abroad file genuinely had no station; one missing because nothing has
// loaded yet has not.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { LocalChoropleth } from "@/screens/components/local/LocalChoropleth";
import {
  MAP_BOX_HEIGHT_CLASS,
  MeasuredMapBox,
} from "@/screens/components/maps/MeasuredMapBox";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { formatPct } from "@/lib/currency";
import {
  foldPlace,
  leadersByPlace,
  useRoundRollup,
} from "@/data/presidential/useRoundRollup";
import { useTicketsByNumber } from "@/data/presidential/useTickets";
import { useAbroadCountriesGeo } from "@/data/presidential/useAbroadCountriesGeo";
import type { SettlementJSONProps } from "@/screens/components/maps/mapTypes";
import type { MapCoordinates } from "@/layout/dataview/MapLayout";
import { PresidentialPlaceTip } from "./PresidentialPlaceTip";
import {
  entriesByRound,
  indexRollup,
  localizedName,
  otherRound,
  tipRounds,
} from "@/data/presidential/tipRounds";

type Props = { cycle: string; round: 1 | 2 };

export const PresidentialAbroadMap: FC<Props> = (props) => (
  <MeasuredMapBox>{(size) => <Inner {...props} size={size} />}</MeasuredMapBox>
);

const Inner: FC<Props & { size: MapCoordinates }> = ({
  size,
  cycle,
  round,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const isBg = lang?.startsWith("bg") ?? true;
  const rollup = useRoundRollup(cycle, round, "abroad");
  // ⚠ THE OTHER ROUND FOR THE HOVER CARD — the same file the country page's world inset reads,
  // so React Query usually already holds it.
  const otherRollup = useRoundRollup(cycle, otherRound(round), "abroad");
  const tickets = useTicketsByNumber(cycle);
  const { geo, failed: geoFailed } = useAbroadCountriesGeo();
  const { findSettlement } = useSettlementsInfo();

  const leaders = useMemo(
    () =>
      rollup.status === "ready" ? leadersByPlace(rollup.rollup) : new Map(),
    [rollup],
  );
  const byRound = useMemo(
    () => entriesByRound(round, indexRollup(rollup), indexRollup(otherRollup)),
    [rollup, otherRollup, round],
  );

  const nameOf = (key: string): string => {
    const s = findSettlement(key);
    return localizedName(s, isBg, key);
  };
  const labelOf = (key: string): string => {
    const lead = leaders.get(key);
    const ticket = lead ? tickets.get(lead.number) : undefined;
    return ticket && lead
      ? t("presidential_map_region_label", {
          place: nameOf(key),
          president: ticket.president,
          pct: formatPct(lead.shareOfTicketVotes, lang, 1),
        })
      : t("presidential_map_region_label_empty", { place: nameOf(key) });
  };

  // ⚠ A FAILED GEOMETRY FILE IS NOT „STILL LOADING": it falls through to the no-data line
  // below rather than leaving a pulsing placeholder that promises a map that will not come.
  if (rollup.status === "loading" || (!geo && !geoFailed))
    return (
      <div
        className={`w-full animate-pulse rounded bg-muted ${MAP_BOX_HEIGHT_CLASS}`}
        aria-hidden="true"
      />
    );
  if (leaders.size === 0 || !geo)
    return (
      <p className="text-sm text-muted-foreground" data-map-no-data>
        {t("election_map_no_data_here")}
      </p>
    );

  return (
    <LocalChoropleth<SettlementJSONProps>
      size={size}
      mapGeo={geo}
      colorOf={(p) => tickets.get(leaders.get(p.ekatte)?.number ?? -1)?.color}
      ariaLabelOf={(p) => labelOf(p.ekatte)}
      tooltipOf={(p) => (
        <PresidentialPlaceTip
          title={nameOf(p.ekatte)}
          rounds={tipRounds(byRound, p.ekatte, round)}
          tickets={tickets}
          current={round}
        />
      )}
      infoOf={(p) => findSettlement(p.ekatte)}
      markerValueOf={(p) => {
        const e = byRound[round].get(p.ekatte);
        return e ? foldPlace(e).total : undefined;
      }}
    />
  );
};
