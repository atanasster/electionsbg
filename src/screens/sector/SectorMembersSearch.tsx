// The member finder for a group sector — МВР's 74 structures, МРРБ's 31, МОСВ's
// 28, МТС's 15.
//
// These render as an undifferentiated chip cloud in SectorAwardersTile: 73 chips
// is a wall, not a list, and a reader looking for their own ОДМВР or РИОСВ has
// to read all of them. The chips stay (they are the sector's roster) — this adds
// a way to jump.
//
// ONE box, not a filter inside AwarderListSection: putting an input in the tile
// would give six sector pages two search boxes, against the plan's §9.2. So the
// members become a group in the same top-of-page box every other sector uses.
//
// Zero fetch — `members` is curated reference data already in the bundle.

import { FC, useMemo } from "react";
import { Landmark } from "lucide-react";
import { SectorEntitySearch } from "@/screens/components/search/SectorEntitySearch";
import { entityGroup } from "@/screens/components/search/entityGroups";
import type { SectorDashboardConfig } from "./sectorDashboards";
import { buildMembersIndex } from "./membersIndex";

export const SectorMembersSearch: FC<{
  config: SectorDashboardConfig;
  bg: boolean;
}> = ({ config, bg }) => {
  const index = useMemo(
    () => buildMembersIndex(config.members, bg),
    [config.members, bg],
  );

  const groups = useMemo(
    () => [
      entityGroup(
        "members",
        "Структури в сектора",
        "Bodies in this sector",
        index,
        { icon: Landmark },
      ),
    ],
    [index],
  );

  return (
    <SectorEntitySearch
      idPrefix={`${config.id}-members-search`}
      groups={groups}
      title={{
        bg: `Намери структура (${config.members.length})`,
        en: `Find a body (${config.members.length})`,
      }}
      placeholder={{
        bg: "институция, съкращение или ЕИК…",
        en: "institution, acronym or EIK…",
      }}
      hint={{
        bg: "Търси по име, съкращение, направление или ЕИК — приема и изписване на латиница.",
        en: "Search by name, acronym, branch or EIK — Latin-typed queries work too.",
      }}
    />
  );
};
