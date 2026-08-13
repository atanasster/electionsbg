// The search box at the top of /water — every operator in the water sector.
//
// The page renders the consolidated rollup and a map; the operators themselves
// appear only as map pins and inside a subsidiary tile, so a reader looking for
// their own water company had nowhere to click.
//
// Zero fetch and zero laziness: WATER_OPERATORS is a static module already in
// the bundle, and folding a few dozen rows costs nothing worth deferring. The
// exact population is deliberately not restated here — it has grown twice and the
// comment went stale both times; vikReferenceData.test.ts holds the number.

import { FC, useMemo } from "react";
import { Droplets } from "lucide-react";
import { SectorEntitySearch } from "@/screens/components/search/SectorEntitySearch";
import { entityGroup } from "@/screens/components/search/entityGroups";
import { buildEntityIndex } from "@/lib/entitySearchIndex";
import {
  WATER_OPERATORS,
  type WaterOperatorType,
} from "@/lib/vikReferenceData";

/** Reading order for the type label — the holding parent and the concession are
 *  not the same kind of thing as a regional monopoly, and the reader can see it.
 *
 *  Keyed on the UNION, not `string`: an unlabelled type folds to `undefined`,
 *  which `buildEntityIndex` drops silently, so the new operator kind would simply
 *  become unsearchable by its type name with nothing red anywhere. Totality here
 *  makes that a build error, matching VikSubsidiaryTile's map. */
const TYPE_LABEL: Record<WaterOperatorType, { bg: string; en: string }> = {
  holding_parent: { bg: "Холдинг", en: "Holding" },
  holding_sub: { bg: "Регионално ВиК", en: "Regional operator" },
  concession: { bg: "Концесия", en: "Concession" },
  irrigation: { bg: "Напоителни системи", en: "Irrigation" },
  dams: { bg: "Язовири", en: "Dams" },
  municipal: { bg: "Общинско", en: "Municipal" },
};

export const WaterSearchBox: FC = () => {
  const index = useMemo(
    () =>
      buildEntityIndex(
        WATER_OPERATORS,
        (o) => ({
          id: o.eik,
          label: o.name,
          // A defunct operator says so on its own row. Пазарджик puts five rows
          // in one result list, one of them a liquidated shell distinguished
          // only by a parenthetical the label can truncate away.
          sub:
            o.status === "liquidated" ? `${o.oblast} · в ликвидация` : o.oblast,
          // /company/:eik, not /awarder/:eik — a ВиК operator is a company that
          // also happens to buy, and the company page carries both sides. A
          // liquidated row goes to its SUCCESSOR: 822106665 has no tr_companies
          // record at all, so its own page would render a company that is not
          // there (the person_slug_retired rule — resolve a dead id to a live
          // target rather than serving a dead end).
          href: `/company/${o.successorEik ?? o.eik}`,
        }),
        (o) => [
          o.name,
          o.oblast,
          o.eik,
          TYPE_LABEL[o.type].bg,
          TYPE_LABEL[o.type].en,
          ...(o.aliases ?? []),
        ],
        // No money on the static list, so no rank: results keep declaration
        // order, which leads with the four national/exceptional rows (holding
        // parent → Напоителни системи → Софийска вода → ДП УСЯ) and then the
        // regional operators. A query rarely reaches the 8-row cap, so the order
        // seldom decides anything; when it does, the named exceptions leading is
        // the right answer. The one query that DOES fill the cap is „Пазарджик"
        // — five operators share that oblast — which is why the liquidated row
        // labels itself in `sub` rather than relying on rank.
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
