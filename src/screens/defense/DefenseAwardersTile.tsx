// "Парите: N-те структури на МО" — the bridge to the money half of the story.
// Every МО budget unit, grouped by universe, each deep-linking to its own awarder
// page; and a lead link to the consolidated МО group pack. Rendered by the shared
// AwarderListSection.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { AwarderListSection } from "@/screens/components/procurement/AwarderListSection";
import { useAwarderHref } from "@/screens/components/procurement/useAwarderHref";
import {
  MO_ENTITIES,
  MOD_EIK,
  DEFENSE_UNIVERSES,
  universeLabel,
} from "@/lib/defenseReferenceData";

export const DefenseAwardersTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const awarderHref = useAwarderHref();

  // Order rows by universe so the section's sub-groups come out in DEFENSE_UNIVERSES order.
  const rows = DEFENSE_UNIVERSES.flatMap((u) =>
    MO_ENTITIES.filter((e) => e.universe === u).map((e) => ({
      eik: e.eik,
      name: e.name,
      group: universeLabel(u, lang),
    })),
  );

  return (
    <AwarderListSection
      id="defense-awarders"
      // Derived, never a literal. The count moved 24 → 25 → 27 and the literal
      // did not follow it: DefenseSearchBox's header comment still said "24 МО
      // bodies" against a 25-row roster, and this heading said 25 while the
      // roster it lists had grown. A heading that miscounts the list directly
      // beneath it is the cheapest kind of wrong to avoid.
      title={
        bg
          ? `Парите: ${MO_ENTITIES.length}-те структури на МО`
          : `The money: the ${MO_ENTITIES.length} МО units`
      }
      rows={rows}
      lead={{
        to: awarderHref(MOD_EIK),
        label: bg
          ? "Обществените поръчки на цялата МО група"
          : "Public procurement of the whole МО group",
      }}
      footnote={
        bg
          ? "Всяка структура има собствена страница с обществените си поръчки. Придобиването на F-16/Stryker е по US FMS и не е в тези договори."
          : "Each unit has its own procurement page. F-16/Stryker acquisition is via US FMS and not in these contracts."
      }
    />
  );
};
