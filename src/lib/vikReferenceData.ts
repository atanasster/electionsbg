// Води (water sector) reference data — the hand-curated EIK universe for the ВиК
// pack, mirroring src/lib/vssReferenceData.ts (a TS constant, not a generated
// JSON crosswalk): the multi-entity / alias-merge concerns are the same as the
// judiciary sector set. See docs/plans/water-view-v1.md §0a/§2.
//
// EIKs resolved from the procurement corpus (contracts.awarder_eik/awarder_name,
// 2026-07-11) — the operators that actually award ЗОП contracts. The name below
// is a canonical Bulgarian label; the corpus carries many spelling variants per
// EIK (e.g. "Водоснабдяване и канализация ООД - Варна" == "…- варна ООД"), all
// folded to one operator here by EIK.
//
// ⚠ HOLDING MEMBERSHIP IS BEST-EFFORT. The three "water universes" (state holding
// vs the ~42 КЕВР-regulated operators vs the Sofia concession) must never be
// conflated (plan §2). The `type` below is a first cut inferred from name/scale;
// the authoritative 26-subsidiary list must be verified against vikholding.bg or
// the TR children of 206086428 before anything reads `type === "holding_sub"` as
// a hard fact. Sofia (Софийска вода, Veolia) is a CONCESSION, never a subsidiary.

export const VIK_HOLDING_EIK = "206086428"; // Български ВиК холдинг ЕАД (parent)
export const NAPOITELNI_EIK = "831160078"; // Напоителни системи ЕАД (irrigation)
export const SOFIYSKA_VODA_EIK = "130175000"; // Софийска вода АД (Veolia concession)

export type WaterOperatorType =
  | "holding_parent"
  | "holding_sub"
  | "municipal"
  | "concession"
  | "irrigation";

export interface WaterOperator {
  eik: string;
  /** Canonical Bulgarian label (corpus carries spelling variants per EIK). */
  name: string;
  /** Oblast the operator primarily serves (Cyrillic). Not 1:1 — some operators
   *  span oblasti; this is the primary-service oblast (plan §0d.19). */
  oblast: string;
  type: WaterOperatorType;
}

// One row per distinct EIK. `holding_sub` = the regional monopoly operators that
// are (believed to be) held by Български ВиК холдинг; `municipal` = smaller
// community operators outside the holding; verify per the note above.
export const WATER_OPERATORS: WaterOperator[] = [
  {
    eik: VIK_HOLDING_EIK,
    name: "Български ВиК холдинг ЕАД",
    oblast: "София",
    type: "holding_parent",
  },
  {
    eik: NAPOITELNI_EIK,
    name: "Напоителни системи ЕАД",
    oblast: "София",
    type: "irrigation",
  },
  {
    eik: SOFIYSKA_VODA_EIK,
    name: "Софийска вода АД",
    oblast: "София (столица)",
    type: "concession",
  },

  // Regional operators (holding subsidiaries — verify).
  {
    eik: "103002253",
    name: "ВиК Варна ООД",
    oblast: "Варна",
    type: "holding_sub",
  },
  {
    eik: "812115210",
    name: "ВиК Бургас ЕАД",
    oblast: "Бургас",
    type: "holding_sub",
  },
  {
    eik: "115010670",
    name: "ВиК Пловдив ЕООД",
    oblast: "Пловдив",
    type: "holding_sub",
  },
  {
    eik: "833066300",
    name: "ВиК Стара Загора ЕООД",
    oblast: "Стара Загора",
    type: "holding_sub",
  },
  {
    eik: "824106518",
    name: "ВиК Плевен ЕООД",
    oblast: "Плевен",
    type: "holding_sub",
  },
  {
    eik: "832046330",
    name: "ВиК София ЕООД",
    oblast: "Софийска област",
    type: "holding_sub",
  },
  {
    eik: "126004284",
    name: "ВиК Хасково ЕООД",
    oblast: "Хасково",
    type: "holding_sub",
  },
  {
    eik: "104055066",
    name: "ВиК Йовковци ООД (Велико Търново)",
    oblast: "Велико Търново",
    type: "holding_sub",
  },
  {
    eik: "204219357",
    name: "ВиК Добрич АД",
    oblast: "Добрич",
    type: "holding_sub",
  },
  {
    eik: "827184123",
    name: "ВиК Русе ООД",
    oblast: "Русе",
    type: "holding_sub",
  },
  {
    eik: "829053806",
    name: "ВиК Сливен ООД",
    oblast: "Сливен",
    type: "holding_sub",
  },
  {
    eik: "837068284",
    name: "ВиК Шумен ООД",
    oblast: "Шумен",
    type: "holding_sub",
  },
  {
    eik: "816090199",
    name: "ВиК Враца ООД",
    oblast: "Враца",
    type: "holding_sub",
  },
  {
    eik: "817040128",
    name: "ВиК Габрово ООД",
    oblast: "Габрово",
    type: "holding_sub",
  },
  {
    eik: "815123415",
    name: "ВиК Видин ЕООД",
    oblast: "Видин",
    type: "holding_sub",
  },
  {
    eik: "811047831",
    name: "ВиК Благоевград ЕООД",
    oblast: "Благоевград",
    type: "holding_sub",
  },
  {
    eik: "835014989",
    name: "ВиК Търговище ООД",
    oblast: "Търговище",
    type: "holding_sub",
  },
  {
    eik: "000225011",
    name: "ВиК Кърджали ООД",
    oblast: "Кърджали",
    type: "holding_sub",
  },
  {
    eik: "128000893",
    name: "ВиК Ямбол ЕООД",
    oblast: "Ямбол",
    type: "holding_sub",
  },
  {
    eik: "830166530",
    name: "ВиК Смолян ЕООД",
    oblast: "Смолян",
    type: "holding_sub",
  },
  {
    eik: "828050351",
    name: "ВиК Силистра ООД",
    oblast: "Силистра",
    type: "holding_sub",
  },
  {
    eik: "821152916",
    name: "ВиК Монтана ООД",
    oblast: "Монтана",
    type: "holding_sub",
  },
  {
    eik: "110549443",
    name: "ВиК Ловеч АД",
    oblast: "Ловеч",
    type: "holding_sub",
  },
  {
    eik: "823073638",
    name: "ВиК Перник ООД",
    oblast: "Перник",
    type: "holding_sub",
  },
  {
    eik: "822106665",
    name: "ВиК Пазарджик ЕООД (в ликвидация)",
    oblast: "Пазарджик",
    type: "holding_sub",
  },

  // Municipal / community operators (outside the holding — verify).
  {
    eik: "122052207",
    name: "ВиК Бебреш ЕООД (Ботевград)",
    oblast: "Софийска област",
    type: "municipal",
  },
  {
    eik: "820146942",
    name: "ВиК Стенето ЕООД (Троян)",
    oblast: "Ловеч",
    type: "municipal",
  },
  {
    eik: "836005135",
    name: "ВиК Димитровград ООД",
    oblast: "Хасково",
    type: "municipal",
  },
  {
    eik: "834026369",
    name: "ВиК Добрич ЕООД",
    oblast: "Добрич",
    type: "municipal",
  },
  {
    eik: "101005019",
    name: "ВиК Петрич ЕООД",
    oblast: "Благоевград",
    type: "municipal",
  },
  {
    eik: "826043803",
    name: "ВиК Исперих ООД",
    oblast: "Разград",
    type: "municipal",
  },
  {
    eik: "819364771",
    name: "ВиК Дупница ЕООД",
    oblast: "Кюстендил",
    type: "municipal",
  },
  {
    eik: "200736851",
    name: "ВиК Свищов ЕАД",
    oblast: "Велико Търново",
    type: "municipal",
  },
  {
    eik: "000120252",
    name: "ВиК Свищов ЕАД (стар ЕИК)",
    oblast: "Велико Търново",
    type: "municipal",
  },
  {
    eik: "111037645",
    name: "ВиК Берковица ЕООД",
    oblast: "Монтана",
    type: "municipal",
  },
  {
    eik: "112106795",
    name: "ВиК Панагюрище ЕООД",
    oblast: "Пазарджик",
    type: "municipal",
  },
];

const OPERATOR_BY_EIK: Record<string, WaterOperator> = Object.fromEntries(
  WATER_OPERATORS.map((o) => [o.eik, o]),
);

export const operatorByEik = (eik: string): WaterOperator | undefined =>
  OPERATOR_BY_EIK[eik];

export const oblastOfEik = (eik: string): string | undefined =>
  OPERATOR_BY_EIK[eik]?.oblast;

/** The believed-holding subsidiaries (parent excluded). Verify per the note. */
export const VIK_HOLDING_SUB_EIKS: string[] = WATER_OPERATORS.filter(
  (o) => o.type === "holding_sub",
).map((o) => o.eik);

/** Every operator EIK that awards water contracts — the input to the
 *  SECTOR_BROWSE_PACKS `water` entry (plan §4.3). Holding parent + Напоителни +
 *  every operator (holding_sub + municipal + concession). */
export const WATER_SECTOR_EIKS: string[] = WATER_OPERATORS.map((o) => o.eik);
