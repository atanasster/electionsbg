// Полиция / Вътрешен ред (МВР) reference data — the hand-curated EIK universe for
// the МВР sector pack, mirroring src/lib/defenseReferenceData.ts (a TS constant,
// not a generated crosswalk): МВР is the near-exact structural twin of the МО
// group — a multi-EIK security cluster with a health confound (the Медицински
// институт, like ВМА) and alias-merge pairs. See docs/plans/police-mvr-view-v1.md.
//
// EIKs resolved from the procurement corpus (contracts.awarder_eik/awarder_name,
// 2026-07-15) — the МВР budget units that actually award ЗОП contracts. Canonical
// Bulgarian labels below; the corpus carries spelling variants per EIK, all folded
// to one entity here by EIK.
//
// ⚠ CURATED BY EIK ALLOWLIST, NEVER BY NAME REGEX OR THE 1290* PREFIX. The `1290*`
// range is the whole security-services family and mixes THREE ministries:
//   - a name sweep false-positives ("Професионална гимназия по вътрешна архитектура"
//     matches "вътрешн"; "Специализирана болница … по вътрешни болести" matches too);
//   - the `1290*` prefix also holds the МО military units (defenseReferenceData.ts),
//     ДАНС (129009710) and ДАТО (129010090) — all OUT;
//   - critically, it holds Ministry of JUSTICE penitentiary units that a naive sweep
//     would misattribute to МВР: ГД „Изпълнение на наказанията" (129010029, €159M),
//     Фонд затворно дело (129009070, €97M), ГД „Охрана" (129010011, €22M — the court/
//     witness guard, NOT to be confused with МВР's ГД „Охранителна полиция" below).
// EXPLICITLY OUT (anti-allowlist): the three МЮ units above; КПКОНПИ (129010997) /
// КПК (129011056); ДКСИ (129009087); БЗЗЛ (129011049, prosecutor witness protection);
// ЦППКОП (176073030, към МС); Държавен авиационен оператор (129009105); all МО, ДАНС,
// ДАТО; and the schools/hospital/kindergarten name-collisions.
//
// ⚠ The Медицински институт на МВР (129007218, €161M, ~8% of the group) buys drugs
// and hospital consumables — the ВМА analogue. Any tile that folds the whole group
// must be segmentable by universe (see SECURITY_UNIVERSES) or "what МВР buys" reads as
// medicines.

export const MVR_EIK = "000695235"; // Министерство на вътрешните работи (the ministry)
export const MEDICAL_INSTITUTE_EIK = "129007218"; // Медицински институт на МВР (~8% — the health confound)
/** The МВР node in the per-ministry budget tree (data/budget/ministries/<id>.json,
 *  written by update-budget) — the real МВР budget series behind the budget bridge. */
export const MVR_BUDGET_NODE = "admin-ministerstvo-na-vatreshnite-raboti";

/** The seven "МВР universes" — label every group tile with which it covers. */
export type SecurityUniverse =
  | "ministry" // Министерство на вътрешните работи (централа)
  | "police" // Полиция — ГДНП, СДВР, ОДМВР, Криминална, ГДБОП, Жандармерия, ГДОП
  | "border" // Гранична полиция
  | "fire" // Пожарна безопасност и защита на населението — ГДПБЗН + РДПБЗН
  | "migration" // Дирекция „Миграция"
  | "health" // Медицински институт на МВР — the confound
  | "logistics"; // Собственост, ИТ, обучение — ДУССД, ДКИС, Академия, проекти, СКС

export interface SecurityEntity {
  eik: string;
  /** Canonical Bulgarian label (corpus carries spelling variants per EIK). */
  name: string;
  universe: SecurityUniverse;
}

// One row per distinct EIK. 74 curated МВР budget units (plan §3).
export const MVR_ENTITIES: SecurityEntity[] = [
  { eik: MVR_EIK, name: "Министерство на вътрешните работи", universe: "ministry" }, // prettier-ignore

  // Гранична полиция
  { eik: "129010125", name: "Главна дирекция „Гранична полиция“ (ГДГП)", universe: "border" }, // prettier-ignore

  // Военно… не — Полиция (ГДНП, СДВР, специализирани главни дирекции)
  { eik: "129010641", name: "Главна дирекция „Национална полиция“ (ГДНП)", universe: "police" }, // prettier-ignore
  { eik: "129010513", name: "Главна дирекция „Национална полиция“ (ГДНП) — София", universe: "police" }, // prettier-ignore
  { eik: "129009938", name: "Столична дирекция на вътрешните работи (СДВР)", universe: "police" }, // prettier-ignore
  { eik: "129010082", name: "Главна дирекция „Криминална полиция“", universe: "police" }, // prettier-ignore
  { eik: "129010659", name: "Главна дирекция „Борба с организираната престъпност“ (ГДБОП)", universe: "police" }, // prettier-ignore
  { eik: "129010043", name: "Главна дирекция „Борба с организираната престъпност“ (ГДБОП)", universe: "police" }, // prettier-ignore
  { eik: "129011017", name: "Главна дирекция „Жандармерия, специални операции и борба с тероризма“", universe: "police" }, // prettier-ignore
  { eik: "129010118", name: "Главна дирекция „Охранителна полиция“ (ГДОП)", universe: "police" }, // prettier-ignore
  { eik: "129010627", name: "Главна дирекция „Охранителна полиция“ (ГДОП)", universe: "police" }, // prettier-ignore

  // Областни дирекции на МВР (ОДМВР) — по области
  { eik: "129009742", name: "ОДМВР — Бургас", universe: "police" },
  { eik: "129009750", name: "ОДМВР — Варна", universe: "police" },
  { eik: "129009870", name: "ОДМВР — Пловдив", universe: "police" },
  { eik: "129009735", name: "ОДМВР — Благоевград", universe: "police" },
  { eik: "129009767", name: "ОДМВР — Велико Търново", universe: "police" },
  { eik: "129009965", name: "ОДМВР — Добрич", universe: "police" },
  { eik: "129009991", name: "ОДМВР — Шумен", universe: "police" },
  { eik: "129009984", name: "ОДМВР — Хасково", universe: "police" },
  { eik: "129009863", name: "ОДМВР — Плевен", universe: "police" },
  { eik: "129009824", name: "ОДМВР — Ловеч", universe: "police" },
  { eik: "129009920", name: "ОДМВР — Смолян", universe: "police" },
  { eik: "129009849", name: "ОДМВР — Пазарджик", universe: "police" },
  { eik: "129009799", name: "ОДМВР — Габрово", universe: "police" },
  { eik: "129009831", name: "ОДМВР — Монтана", universe: "police" },
  { eik: "129009913", name: "ОДМВР — Сливен", universe: "police" },
  { eik: "129009895", name: "ОДМВР — Русе", universe: "police" },
  { eik: "129009952", name: "ОДМВР — Стара Загора", universe: "police" },
  { eik: "129009945", name: "ОДМВР — София", universe: "police" },
  { eik: "129009802", name: "ОДМВР — Кърджали", universe: "police" },
  { eik: "129009781", name: "ОДМВР — Враца", universe: "police" },
  { eik: "129009977", name: "ОДМВР — Търговище", universe: "police" },
  { eik: "129010004", name: "ОДМВР — Ямбол", universe: "police" },
  { eik: "129009774", name: "ОДМВР — Видин", universe: "police" },
  { eik: "129009817", name: "ОДМВР — Кюстендил", universe: "police" },
  { eik: "129009888", name: "ОДМВР — Разград", universe: "police" },
  { eik: "129009856", name: "ОДМВР — Перник", universe: "police" },
  { eik: "129009906", name: "ОДМВР — Силистра", universe: "police" },

  // Пожарна безопасност и защита на населението (ГДПБЗН + СДПБЗН + РДПБЗН)
  { eik: "129010164", name: "Главна дирекция „Пожарна безопасност и защита на населението“ (ГДПБЗН)", universe: "fire" }, // prettier-ignore
  { eik: "129010709", name: "Столична дирекция ПБЗН (СДПБЗН)", universe: "fire" }, // prettier-ignore
  { eik: "129010851", name: "РДПБЗН — Пловдив", universe: "fire" },
  { eik: "129010821", name: "РДПБЗН — Ловеч", universe: "fire" },
  { eik: "129010972", name: "РДПБЗН — Плевен", universe: "fire" },
  { eik: "129010812", name: "РДПБЗН — Велико Търново", universe: "fire" },
  { eik: "129010787", name: "РДПБЗН — Кърджали", universe: "fire" },
  { eik: "129010805", name: "РДПБЗН — Монтана", universe: "fire" },
  { eik: "129010723", name: "РДПБЗН — Бургас", universe: "fire" },
  { eik: "129010762", name: "РДПБЗН — Габрово", universe: "fire" },
  { eik: "129010779", name: "РДПБЗН — Добрич", universe: "fire" },
  { eik: "129010940", name: "РДПБЗН — Хасково", universe: "fire" },
  { eik: "129010901", name: "РДПБЗН — Смолян", universe: "fire" },
  { eik: "129010958", name: "РДПБЗН — Шумен", universe: "fire" },
  { eik: "129010876", name: "РДПБЗН — Русе", universe: "fire" },
  { eik: "129010755", name: "РДПБЗН — Враца", universe: "fire" },
  { eik: "129010926", name: "РДПБЗН — София", universe: "fire" },
  { eik: "129010730", name: "РДПБЗН — Варна", universe: "fire" },
  { eik: "129010716", name: "РДПБЗН — Благоевград", universe: "fire" },
  { eik: "129010933", name: "РДПБЗН — Търговище", universe: "fire" },
  { eik: "129010837", name: "РДПБЗН — Пазарджик", universe: "fire" },
  { eik: "129010748", name: "РДПБЗН — Видин", universe: "fire" },
  { eik: "129010965", name: "РДПБЗН — Ямбол", universe: "fire" },
  { eik: "129010794", name: "РДПБЗН — Кюстендил", universe: "fire" },
  { eik: "129010890", name: "РДПБЗН — Сливен", universe: "fire" },
  { eik: "129010869", name: "РДПБЗН — Разград", universe: "fire" },
  { eik: "129010844", name: "РДПБЗН — Перник", universe: "fire" },

  // Миграция
  {
    eik: "129010666",
    name: "Дирекция „Миграция“ — МВР",
    universe: "migration",
  },
  { eik: "129010050", name: "Дирекция „Миграция“ — МВР (ДМ)", universe: "migration" }, // prettier-ignore

  // Здравеопазване — the confound
  { eik: MEDICAL_INSTITUTE_EIK, name: "Медицински институт на МВР", universe: "health" }, // prettier-ignore

  // Собственост, ИТ, обучение и логистика
  { eik: "129010157", name: "Дирекция „Управление на собствеността и социални дейности“ (ДУССД)", universe: "logistics" }, // prettier-ignore
  { eik: "129010698", name: "Дирекция „Комуникационни и информационни системи“ (ДКИС)", universe: "logistics" }, // prettier-ignore
  { eik: "129001232", name: "Академия на МВР", universe: "logistics" },
  { eik: "129010068", name: "Дирекция „Международни проекти“ — МВР", universe: "logistics" }, // prettier-ignore
  { eik: "831616418", name: "Дирекция „Специална куриерска служба“ (ДСКС)", universe: "logistics" }, // prettier-ignore
  { eik: "129010673", name: "Дирекция „Специална куриерска служба“", universe: "logistics" }, // prettier-ignore
];

const ENTITY_BY_EIK: Record<string, SecurityEntity> = Object.fromEntries(
  MVR_ENTITIES.map((e) => [e.eik, e]),
);

export const securityEntityByEik = (eik: string): SecurityEntity | undefined =>
  ENTITY_BY_EIK[eik];

export const securityUniverseOf = (eik: string): SecurityUniverse | undefined =>
  ENTITY_BY_EIK[eik]?.universe;

/** МВР proper + the subordinate units (parent first). The pack fans out over this
 *  set on the ministry's page; any other EIK stands alone. */
export const SECURITY_ALIAS_EIKS: string[] = MVR_ENTITIES.filter(
  (e) => e.eik !== MVR_EIK,
).map((e) => e.eik);

/** Every МВР-group EIK — the input to the SECTOR_BROWSE_PACKS `security` entry, the
 *  sector-dashboard rollup and the group-rollup endpoint. */
export const SECURITY_SECTOR_EIKS: string[] = MVR_ENTITIES.map((e) => e.eik);

export const SECURITY_UNIVERSE_LABEL: Record<
  SecurityUniverse,
  { bg: string; en: string }
> = {
  ministry: { bg: "Министерство (централа)", en: "Ministry (HQ)" },
  police: { bg: "Полиция", en: "Police" },
  border: { bg: "Гранична полиция", en: "Border police" },
  fire: { bg: "Пожарна и защита", en: "Fire & civil protection" },
  migration: { bg: "Миграция", en: "Migration" },
  health: { bg: "Медицински институт", en: "Medical Institute" },
  logistics: { bg: "Собственост и обучение", en: "Estate & training" },
};

export const securityUniverseLabel = (
  u: SecurityUniverse,
  lang: string,
): string =>
  (lang === "bg"
    ? SECURITY_UNIVERSE_LABEL[u]?.bg
    : SECURITY_UNIVERSE_LABEL[u]?.en) ?? u;

/** Universe options in display order (for the segmentation Select). */
export const SECURITY_UNIVERSES: SecurityUniverse[] = [
  "ministry",
  "police",
  "border",
  "fire",
  "migration",
  "health",
  "logistics",
];
