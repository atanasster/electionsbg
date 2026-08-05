// The institution finder on /culture — the culture bodies plus the state
// institutes (НДК, Народен театър, Софийска опера…), 22 rows after de-duping
// the one entity that appears in both lists (НДК).
//
// CultureAwardersTile hides the institutes behind a "show all" toggle, so most
// of them are one click away from invisible. The toggle stays; this is the jump.
//
// НФЦ IS EXCLUDED. It is a Bulstat entity with a zero procurement footprint —
// no tr_companies row, no contracts either side — so /awarder/000695833 renders
// "Няма фирма с ЕИК … в базата." The plan's rule is that a group whose rows
// cannot land does not ship them, and that applies per ROW, not only per group.
// It stays in CULTURE_BODIES (the awarders tile labels it deliberately); it
// just is not a search destination.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { SectorEntitySearch } from "@/screens/components/search/SectorEntitySearch";
import { entityGroup } from "@/screens/components/search/entityGroups";
import { buildMembersIndex } from "@/screens/sector/membersIndex";
import {
  CULTURE_BODIES,
  STATE_CULTURE_INSTITUTES,
  NFC_EIK,
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
        ...CULTURE_BODIES.filter((b) => b.eik !== NFC_EIK).map((b) => ({
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
