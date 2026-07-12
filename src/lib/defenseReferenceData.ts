// Отбрана (defense / МО) reference data — the hand-curated EIK universe for the
// defense sector pack, mirroring src/lib/vikReferenceData.ts and
// vssReferenceData.ts (a TS constant, not a generated crosswalk): the multi-
// entity / alias-merge concerns are the same as the water and judiciary sets.
// See docs/plans/defense-pack-v1.md §2.
//
// EIKs resolved from the procurement corpus (contracts.awarder_eik/awarder_name,
// 2026-07-09) — the МО budget units that actually award ЗОП contracts. The name
// below is a canonical Bulgarian label; the corpus carries spelling variants per
// EIK (e.g. Министерство на отбраната has three), all folded to one entity here
// by EIK.
//
// ⚠ CURATED BY EIK ALLOWLIST, NEVER BY NAME REGEX. A name sweep false-positives:
// "7-МО Основно училище" matches "МО"; the town of Раковски matches the Раковски
// military academy; the EIK prefix 1290* is the whole security-services range
// (mostly МВР), so two МВР directorates (ДУССД 129010157 €301M, ДКИС 129010698
// €70M) sit adjacent and would be a €370M error. Explicitly OUT: ДА „Държавен
// резерв и военновременни запаси" (831913661, a separate CoM agency), all МВР,
// ДАНС (129009710), ДАТО (129010090).
//
// ⚠ ВМА (Военномедицинска академия, 129000273) is ~47% of the group's value and
// buys oncology drugs / nursing care. Any tile that folds the whole group must be
// segmentable by universe (see DEFENSE_UNIVERSES) or "what the МО group buys"
// reads as medicines. See plan §2.

export const MOD_EIK = "000695324"; // Министерство на отбраната (the ministry)
export const VMA_EIK = "129000273"; // Военномедицинска академия (~47% of group €)
/** The МО node in the per-ministry budget tree (data/budget/ministries/<id>.json,
 *  written by update-budget) — the real МО budget series behind the budget bridge. */
export const MO_BUDGET_NODE = "admin-ministerstvo-na-otbranata";

/** The five "defense universes" — label every group tile with which it covers. */
export type DefenseUniverse =
  | "mo" // Министерство на отбраната (централа)
  | "army" // Българска армия — командвания и служби
  | "health" // Военно здравеопазване — ВМА
  | "education" // военно образование и наука
  | "culture"; // култура, музеи, имоти

export interface DefenseEntity {
  eik: string;
  /** Canonical Bulgarian label (corpus carries spelling variants per EIK). */
  name: string;
  universe: DefenseUniverse;
}

// One row per distinct EIK. 25 curated МО budget units (plan §2).
export const MO_ENTITIES: DefenseEntity[] = [
  { eik: MOD_EIK, name: "Министерство на отбраната", universe: "mo" },

  // Военно здравеопазване
  { eik: VMA_EIK, name: "Военномедицинска академия", universe: "health" },

  // Българска армия — командвания и служби
  { eik: "129010189", name: "Военновъздушни сили", universe: "army" },
  { eik: "129010196", name: "Командване на военноморските сили", universe: "army" }, // prettier-ignore
  { eik: "129010171", name: "Сухопътни войски", universe: "army" },
  {
    eik: "129010207",
    name: "Съвместно командване на силите",
    universe: "army",
  },
  { eik: "129010680", name: "Съвместно командване на специалните операции", universe: "army" }, // prettier-ignore
  { eik: "129011031", name: "Командване за логистична поддръжка", universe: "army" }, // prettier-ignore
  { eik: "129010221", name: "Командване за комуникационно-информационна поддръжка и киберотбрана", universe: "army" }, // prettier-ignore
  { eik: "129009023", name: "Служба „Военна полиция“", universe: "army" },
  { eik: "129009728", name: "Служба „Военна информация“", universe: "army" },
  { eik: "129009030", name: "Национална гвардейска част", universe: "army" },
  { eik: "129011024", name: "Централно военно окръжие", universe: "army" },
  { eik: "129010984", name: "Централен артилерийски технически изпитателен полигон", universe: "army" }, // prettier-ignore

  // Военно образование и наука
  { eik: "129003305", name: "Военна академия „Г. С. Раковски“", universe: "education" }, // prettier-ignore
  { eik: "129009094", name: "НВУ „Васил Левски“", universe: "education" },
  { eik: "129004492", name: "ВВМУ „Н. Й. Вапцаров“", universe: "education" },
  { eik: "129011005", name: "ВВВУ „Георги Бенковски“", universe: "education" },
  { eik: "129010036", name: "Институт по отбрана „Проф. Цветан Лазаров“", universe: "education" }, // prettier-ignore
  { eik: "129010214", name: "Военно-географска служба", universe: "education" },

  // Култура, музеи, имоти
  { eik: "129008829", name: "ИА „Военни клубове и военно-почивно дело“", universe: "culture" }, // prettier-ignore
  { eik: "129009048", name: "Национален военноисторически музей", universe: "culture" }, // prettier-ignore
  { eik: "129009016", name: "Театър „Българска армия“", universe: "culture" },
  { eik: "129010545", name: "Информационен център на МО", universe: "culture" },
  { eik: "129010142", name: "Комендантство — МО", universe: "culture" },
];

const ENTITY_BY_EIK: Record<string, DefenseEntity> = Object.fromEntries(
  MO_ENTITIES.map((e) => [e.eik, e]),
);

export const entityByEik = (eik: string): DefenseEntity | undefined =>
  ENTITY_BY_EIK[eik];

export const universeOf = (eik: string): DefenseUniverse | undefined =>
  ENTITY_BY_EIK[eik]?.universe;

/** МО proper + the subordinate units (parent first). The pack fans out over
 *  this set on the ministry's page; any other EIK stands alone. */
export const DEFENSE_ALIAS_EIKS: string[] = MO_ENTITIES.filter(
  (e) => e.eik !== MOD_EIK,
).map((e) => e.eik);

/** Every МО-group EIK — the input to the SECTOR_BROWSE_PACKS `defense` entry and
 *  the group-rollup endpoint. */
export const DEFENSE_SECTOR_EIKS: string[] = MO_ENTITIES.map((e) => e.eik);

export const DEFENSE_UNIVERSE_LABEL: Record<
  DefenseUniverse,
  { bg: string; en: string }
> = {
  mo: { bg: "Министерство (централа)", en: "Ministry (HQ)" },
  army: { bg: "Българска армия", en: "Bulgarian Army" },
  health: { bg: "Военно здравеопазване (ВМА)", en: "Military health (ВМА)" },
  education: { bg: "Образование и наука", en: "Education & research" },
  culture: { bg: "Култура и имоти", en: "Culture & estate" },
};

export const universeLabel = (u: DefenseUniverse, lang: string): string =>
  (lang === "bg"
    ? DEFENSE_UNIVERSE_LABEL[u]?.bg
    : DEFENSE_UNIVERSE_LABEL[u]?.en) ?? u;

/** Universe options in display order (for the segmentation Select). */
export const DEFENSE_UNIVERSES: DefenseUniverse[] = [
  "mo",
  "army",
  "health",
  "education",
  "culture",
];
