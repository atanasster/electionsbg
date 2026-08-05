// The search box at the top of /water — the 38 ВиК operators.
//
// The page renders the consolidated group rollup and a map; the operators
// themselves appear only as map pins and inside a subsidiary tile, so a reader
// looking for their own water company had nowhere to click.
//
// Zero fetch and zero laziness: WATER_OPERATORS is a static module already in
// the bundle, and folding 38 rows costs nothing worth deferring.

import { FC, useMemo } from "react";
import { Droplets } from "lucide-react";
import { SectorEntitySearch } from "@/screens/components/search/SectorEntitySearch";
import { entityGroup } from "@/screens/components/search/entityGroups";
import { buildEntityIndex } from "@/lib/entitySearchIndex";
import { WATER_OPERATORS } from "@/lib/vikReferenceData";

/** Reading order for the type label — the holding parent and the concession are
 *  not the same kind of thing as a regional monopoly, and the reader can see it. */
const TYPE_LABEL: Record<string, { bg: string; en: string }> = {
  holding_parent: { bg: "Холдинг", en: "Holding" },
  holding_sub: { bg: "Регионално ВиК", en: "Regional operator" },
  concession: { bg: "Концесия", en: "Concession" },
  irrigation: { bg: "Напоителни системи", en: "Irrigation" },
  municipal: { bg: "Общинско", en: "Municipal" },
  other: { bg: "Друго", en: "Other" },
};

export const WaterSearchBox: FC = () => {
  const index = useMemo(
    () =>
      buildEntityIndex(
        WATER_OPERATORS,
        (o) => ({
          id: o.eik,
          label: o.name,
          sub: o.oblast,
          // /company/:eik, not /awarder/:eik — a ВиК operator is a company that
          // also happens to buy, and the company page carries both sides.
          href: `/company/${o.eik}`,
        }),
        (o) => [
          o.name,
          o.oblast,
          o.eik,
          TYPE_LABEL[o.type]?.bg,
          TYPE_LABEL[o.type]?.en,
        ],
        // No money on the static list, so no rank: results keep declaration
        // order, which is holding parent → Напоителни системи → Софийска вода
        // → the 35 regional operators. With 38 rows a query rarely reaches the
        // 8-row cap, so the order seldom decides anything; when it does, the
        // three named exceptions leading is the right answer.
      ),
    [],
  );

  const groups = useMemo(
    () => [
      entityGroup("vik", "ВиК оператори", "Water operators", index, {
        icon: Droplets,
      }),
    ],
    [index],
  );

  return (
    <SectorEntitySearch
      idPrefix="water-search"
      groups={groups}
      title={{ bg: "Намери ВиК оператор", en: "Find a water operator" }}
      placeholder={{
        bg: "дружество, област или ЕИК…",
        en: "operator, province or EIK…",
      }}
      hint={{
        bg: "Търси по име, област или ЕИК — приема и изписване на латиница.",
        en: "Search by name, province or EIK — Latin-typed queries work too.",
      }}
    />
  );
};
