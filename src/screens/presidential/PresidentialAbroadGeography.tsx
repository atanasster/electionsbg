// „География" for the presidential abroad page — the countries and the continents that cast the
// most, and who led each: `/parliamentary`'s abroad page carries the same pair (its per-country
// table and its per-continent ranking).
//
// ⚠ NO NEW REQUEST. It reads the abroad roll-up the page's country map is coloured from.
//
// ⚠ THE CONTINENT IS THE SETTLEMENT CATALOGUE'S, NOT A GUESS. `settlements.json` carries each
// abroad country under its ISO-2 key with `obshtina` = its continent (the same rows the
// parliamentary continent pages read), so the per-continent card is a plain sum over countries
// whose continent the catalogue names. A country it cannot place is left out of the continent
// card rather than assigned — it still appears, by name, in the country card.
//
// ⚠ IT OWNS ITS SECTION HEADING, and renders nothing — heading included — until the roll-up is
// ready with at least one vote: `DashboardSection` cannot see through a child's self-hide.

import { FC, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon } from "lucide-react";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import {
  useRoundRollup,
  type RollupEntry,
} from "@/data/presidential/useRoundRollup";
import { useTicketsByNumber } from "@/data/presidential/useTickets";
import { localizedName } from "@/data/presidential/tipRounds";
import { PresidentialTopPlacesCard } from "./PresidentialTopRegionsTile";

export const PresidentialAbroadGeography: FC<{
  cycle: string;
  round: 1 | 2;
}> = ({ cycle, round }) => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language?.startsWith("bg") ?? true;
  const rollup = useRoundRollup(cycle, round, "abroad");
  const tickets = useTicketsByNumber(cycle);
  const { findSettlement } = useSettlementsInfo();
  const { findMunicipality } = useMunicipalities();

  const countries = useMemo(
    () => (rollup.status === "ready" ? rollup.rollup.entries : []),
    [rollup],
  );
  const continents = useMemo<RollupEntry[]>(() => {
    const sums = new Map<string, Map<number, number>>();
    for (const e of countries) {
      const continent = findSettlement(e.key)?.obshtina;
      if (!continent) continue;
      const m = sums.get(continent) ?? new Map<number, number>();
      for (const v of e.results.votes)
        m.set(v.partyNum, (m.get(v.partyNum) ?? 0) + v.totalVotes);
      sums.set(continent, m);
    }
    return [...sums].map(([key, m]) => ({
      key,
      results: {
        votes: [...m].map(([partyNum, totalVotes]) => ({
          partyNum,
          totalVotes,
        })),
      },
    }));
  }, [countries, findSettlement]);

  const countryName = useCallback(
    (key: string) => {
      const s = findSettlement(key);
      return localizedName(s, isBg, key);
    },
    [findSettlement, isBg],
  );
  const continentName = useCallback(
    (key: string) => {
      const m = findMunicipality(key);
      return localizedName(m, isBg, key);
    },
    [findMunicipality, isBg],
  );

  const hasVotes = countries.some((e) =>
    e.results.votes.some((v) => v.totalVotes > 0),
  );
  if (!hasVotes) return null;
  return (
    <DashboardSection
      id="geography"
      title={t("dashboard_section_geography")}
      icon={MapIcon}
      headingLevel={2}
    >
      <PresidentialTopPlacesCard
        entries={countries}
        tickets={tickets}
        nameOf={countryName}
        hrefOf={() => null}
        title={t("dashboard_top_diaspora")}
        hint={t("presidential_top_countries_hint")}
        placeHeader={t("country")}
      />
      {continents.length > 1 ? (
        <PresidentialTopPlacesCard
          entries={continents}
          tickets={tickets}
          nameOf={continentName}
          hrefOf={() => null}
          title={t("continents")}
          hint={t("presidential_top_continents_hint")}
          placeHeader={t("continent")}
        />
      ) : null}
    </DashboardSection>
  );
};
