// The structure finder on /defense — the 24 МО bodies.
//
// Same job as SectorMembersSearch does for the config-driven group sectors, but
// /defense is a bespoke screen with its own curated roster (MO_ENTITIES), so it
// maps that roster onto the same helper rather than growing a second one.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { SectorEntitySearch } from "@/screens/components/search/SectorEntitySearch";
import { entityGroup } from "@/screens/components/search/entityGroups";
import { buildMembersIndex } from "@/screens/sector/membersIndex";
import {
  MO_ENTITIES,
  DEFENSE_UNIVERSE_LABEL,
} from "@/lib/defenseReferenceData";

export const DefenseSearchBox: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";

  const index = useMemo(
    () =>
      buildMembersIndex(
        MO_ENTITIES.map((e) => ({
          eik: e.eik,
          // The roster carries one canonical Bulgarian name; it doubles as the
          // en label, as SECTOR_DASHBOARDS does for its own curated lists.
          name: { bg: e.name, en: e.name },
          group: DEFENSE_UNIVERSE_LABEL[e.universe],
        })),
        bg,
      ),
    [bg],
  );

  const groups = useMemo(
    () => [
      entityGroup("mo", "Структури на МО", "MoD bodies", index, {
        icon: Landmark,
      }),
    ],
    [index],
  );

  return (
    <SectorEntitySearch
      idPrefix="defense-members-search"
      groups={groups}
      title={{
        bg: `Намери структура (${MO_ENTITIES.length})`,
        en: `Find a body (${MO_ENTITIES.length})`,
      }}
      placeholder={{
        bg: "структура, съкращение или ЕИК…",
        en: "body, acronym or EIK…",
      }}
      hint={{
        bg: "Търси по име, съкращение, направление или ЕИК — приема и изписване на латиница.",
        en: "Search by name, acronym, branch or EIK — Latin-typed queries work too.",
      }}
    />
  );
};
