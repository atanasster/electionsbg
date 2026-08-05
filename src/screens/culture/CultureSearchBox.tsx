// The institution finder on /culture — the five culture bodies plus the 21 state
// institutes (НДК, Народен театър, Софийска опера…).
//
// CultureAwardersTile hides the institutes behind a "show all" toggle, so 21 of
// the 26 are one click away from invisible. The toggle stays; this is the jump.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { SectorEntitySearch } from "@/screens/components/search/SectorEntitySearch";
import { entityGroup } from "@/screens/components/search/entityGroups";
import { buildMembersIndex } from "@/screens/sector/membersIndex";
import {
  CULTURE_BODIES,
  STATE_CULTURE_INSTITUTES,
} from "@/lib/kulturaReferenceData";

export const CultureSearchBox: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";

  const index = useMemo(() => {
    // Bodies first, then the institutes the tile hides — and de-duplicated,
    // since a body can also appear in the institute list.
    const seen = new Set(CULTURE_BODIES.map((b) => b.eik));
    return buildMembersIndex(
      [
        ...CULTURE_BODIES.map((b) => ({
          eik: b.eik,
          name: { bg: b.bg, en: b.en },
        })),
        ...STATE_CULTURE_INSTITUTES.filter((i) => !seen.has(i.eik)).map(
          (i) => ({
            eik: i.eik,
            // The institute list is Bulgarian-only (proper nouns); the BG label
            // doubles as the en one, as the awarders tile already does.
            name: { bg: i.bg, en: i.bg },
          }),
        ),
      ],
      bg,
    );
  }, [bg]);

  const groups = useMemo(
    () => [
      entityGroup("culture", "Културни институции", "Cultural bodies", index, {
        icon: Landmark,
      }),
    ],
    [index],
  );

  return (
    <SectorEntitySearch
      idPrefix="culture-members-search"
      groups={groups}
      title={{ bg: "Намери институция", en: "Find an institution" }}
      placeholder={{
        bg: "театър, опера, фонд или ЕИК…",
        en: "theatre, opera, fund or EIK…",
      }}
      hint={{
        bg: "Търси по име или ЕИК — приема и изписване на латиница.",
        en: "Search by name or EIK — Latin-typed queries work too.",
      }}
    />
  );
};
