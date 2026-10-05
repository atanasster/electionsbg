// „Топ общини" / „Топ населени места" for a presidential place page — `/parliamentary`'s
// geography tile at the region and município levels, built on the country page's
// „Къде бяха гласовете" card (`PresidentialTopPlacesCard`).
//
// ⚠ NO NEW REQUEST. It reads the same whole-country child roll-up the place's map is coloured
// from (see `PresidentialChildMap` for its size and why it is gzipped on the bucket), and the
// same parent geometry the map narrows it with — so the tile and the map cover exactly the same
// places, and React Query hands both the one download.
//
// ⚠ THE CHILDREN ARE THE MAP'S FEATURES, NOT A CODE PREFIX. Oblast codes do not prefix their
// municipalities reliably (Plovdiv city and Plovdiv oblast are `PDV-00` and `PDV`; Sofia's
// МИР hold `S23xx` districts), so the set is read off the geometry the map draws.
//
// ⚠ RENDERS NOTHING until the roll-up is READY and at least one child cast a vote — the
// country map's rule: a place missing from a roll-up that has not loaded has not „cast
// nothing".

import { FC, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { presidentialUrl } from "@/data/elections/presidentialRoutes";
import { roundSearch } from "@/data/presidential/roundParam";
import { useRoundRollup } from "@/data/presidential/useRoundRollup";
import { useTicketsByNumber } from "@/data/presidential/useTickets";
import { useChildKeys, type ChildGrain } from "@/data/presidential/useChildTop";
import { PresidentialTopPlacesCard } from "./PresidentialTopRegionsTile";

export type PresidentialChildTopTileProps = {
  cycle: string;
  round: 1 | 2;
  /** An oblast code for the municipality grain, an obshtina code for the settlement grain. */
  parentId: string;
  grain: ChildGrain;
};

export const PresidentialChildTopTile: FC<PresidentialChildTopTileProps> = ({
  cycle,
  round,
  parentId,
  grain,
}) => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language?.startsWith("bg") ?? true;
  const rollup = useRoundRollup(cycle, round, grain);
  const tickets = useTicketsByNumber(cycle);
  const keys = useChildKeys(parentId, grain);
  const { findMunicipality } = useMunicipalities();
  const { findSettlement } = useSettlementsInfo();
  const isMuni = grain === "municipality";

  const entries = useMemo(
    () =>
      rollup.status === "ready" && keys
        ? rollup.rollup.entries.filter((e) => keys.has(e.key))
        : [],
    [rollup, keys],
  );
  const nameOf = useCallback(
    (key: string) => {
      const info = isMuni ? findMunicipality(key) : findSettlement(key);
      return (isBg ? info?.name : info?.name_en) || info?.name || key;
    },
    [isMuni, isBg, findMunicipality, findSettlement],
  );
  if (entries.length === 0) return null;
  return (
    <PresidentialTopPlacesCard
      entries={entries}
      tickets={tickets}
      nameOf={nameOf}
      hrefOf={(key) => {
        const to = presidentialUrl(cycle, grain, key);
        return to ? to + roundSearch(round) : to;
      }}
      title={t(
        isMuni ? "dashboard_top_municipalities" : "dashboard_top_settlements",
      )}
      hint={t(
        isMuni
          ? "presidential_top_municipalities_hint"
          : "presidential_top_settlements_hint",
      )}
      placeHeader={t(isMuni ? "municipality" : "settlement")}
    />
  );
};
