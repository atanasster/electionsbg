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
// the authoritative subsidiary list must be verified against vikholding.bg or the
// TR children of 206086428 before anything reads `type === "holding_sub"` as a
// hard fact. Sofia (Софийска вода, Veolia) is a CONCESSION, never a subsidiary.
//
// Do NOT restate the population in prose. Four comments across three files used
// to carry a hand-written count ("26 subsidiaries", "38 operators", "35 regional
// operators") and all four were wrong at once after the 2026-08-13 audit. The
// counts are derived — `WATER_SECTOR_EIKS.length`, `VIK_HOLDING_SUB_EIKS.length`
// — and pinned in vikReferenceData.test.ts, so a drifted number fails a test
// instead of misleading a reader.
//
// ⚠ THE OBLAST IS THE COMPLETENESS TEST, and it is what a name sweep alone misses.
// Almost every oblast has ONE regional monopoly operator, so an oblast with no
// LIVE `holding_sub` row is a missing operator, not an oblast nobody supplies
// water to. The 2026-08-13 audit (docs/plans/water-sector-audit-v1.md) found three
// that way — Разград and Кюстендил had no regional operator at all (only their
// small municipal ones, which read as coverage), and Пазарджик was represented
// solely by the liquidated 822106665, whose last contract is 2019, so its whole
// live procurement was absent. €56.2M between them.
//
// The rule has exactly TWO named exceptions, and stating them is what makes it
// checkable (water_sector.test.ts holds it):
//
//   - **София (столица)** has no `holding_sub` row and never will — the capital is
//     served by the Софийска вода CONCESSION.
//   - **Пазарджик** has no live regional operator at all. The regional company was
//     liquidated and its services fragmented across municipal operators (Пазарджик,
//     Пещера, Велинград, Панагюрище). That is a fact about the oblast, recorded
//     here rather than papered over by promoting a municipal row.
//
// "LIVE" is the field `status`, never the display name: the only trace that
// 822106665 is defunct used to be the string „(в ликвидация)" inside its label,
// and a gate that regexes a Bulgarian display string is not a gate.
// vikReferenceData.test.ts runs this rule, both exceptions included.

export const VIK_HOLDING_EIK = "206086428"; // Български ВиК холдинг ЕАД (parent)
export const NAPOITELNI_EIK = "831160078"; // Напоителни системи ЕАД (irrigation)
export const SOFIYSKA_VODA_EIK = "130175000"; // Софийска вода АД (Veolia concession)
export const USYA_EIK = "205756975"; // ДП „Управление и стопанисване на язовири“

export type WaterOperatorType =
  | "holding_parent"
  | "holding_sub"
  | "municipal"
  | "concession"
  | "irrigation"
  // State dam infrastructure (ДП УСЯ) — not a ВиК operator and not the same kind
  // of thing as one, but the sector already carries Напоителни системи on the
  // same footing: publicly-owned water infrastructure whose ЗОП flow belongs in
  // the water sector's money rather than nowhere. ⚠ That precedent covers the
  // SECTOR MONEY only: the /water flood tile's Напоителни split (floodModel.ts,
  // scripts/water/write_flood_maintenance.ts) is built from riverbed-maintenance
  // criteria and knows nothing about dams, so dam-safety spend is deliberately
  // absent there.
  | "dams";

export interface WaterOperator {
  eik: string;
  /** Canonical Bulgarian label (corpus carries spelling variants per EIK). */
  name: string;
  /** Oblast the operator primarily serves (Cyrillic). Not 1:1 — some operators
   *  span oblasti; this is the primary-service oblast (plan §0d.19). For a
   *  `national` row it is the SEAT, not a service area. */
  oblast: string;
  type: WaterOperatorType;
  /** Nationwide scope, so `oblast` is its seat and it is not any oblast's
   *  regional coverage — the completeness rule in the header skips these. */
  national?: true;
  /** Absent = live. A `liquidated` / `dormant` row is kept because its € is real
   *  history, but it must never count as an oblast's regional coverage — that is
   *  verbatim the Пазарджик failure the header describes. */
  status?: "liquidated" | "dormant";
  /** The EIK now doing this operator's job, where one exists. A reader who lands
   *  on the dead row is sent here rather than to a page with no company. */
  successorEik?: string;
  /** Extra search keys. The curated `name` is sometimes an abbreviation nobody
   *  types (ВКС, ВКТВ) or omits the word the corpus uses (Дунав, for Разград). */
  aliases?: string[];
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
    national: true,
  },
  {
    eik: NAPOITELNI_EIK,
    name: "Напоителни системи ЕАД",
    oblast: "София",
    type: "irrigation",
    national: true,
  },
  {
    eik: SOFIYSKA_VODA_EIK,
    name: "Софийска вода АД",
    oblast: "София (столица)",
    type: "concession",
  },
  {
    eik: USYA_EIK,
    name: "ДП „Управление и стопанисване на язовири“",
    oblast: "София",
    type: "dams",
    national: true,
    aliases: ["УСЯ", "язовири"],
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
  // ⚠ These two are typed `holding_sub` on exactly the same best-effort basis as
  // the 25 above — they are state oblast-wide regional monopolies of the same
  // kind — but note the CONSEQUENCE, which the 2026-08-13 audit missed on its
  // first pass: `VIK_HOLDING_SUB_EIKS` is derived from this field, so typing them
  // here added €41.5M to what /awarder/206086428 consolidates as the holding's
  // own group. That is the intended reading and it is still unverified; see the
  // warning on VIK_HOLDING_SUB_EIKS below before changing either row's `type`.
  {
    eik: "826043778",
    name: "Водоснабдяване-Дунав ЕООД (Разград)",
    oblast: "Разград",
    type: "holding_sub",
    aliases: ["Дунав"],
  },
  {
    eik: "200167154",
    name: "Кюстендилска вода ЕООД",
    oblast: "Кюстендил",
    type: "holding_sub",
  },
  // Пазарджик is served by a PAIR, and until the 2026-08-13 audit only the dead
  // half was here. 822106665 went into liquidation and awarded its last contract
  // in 2019; 205323041 has awarded every Пазарджик contract since. Both stay —
  // they are separate legal entities, so keeping the predecessor preserves ~€5.0M
  // of real history and double-counts nothing. (Contrast the retired ВиК Свищов
  // EIK below, which is the SAME company and would double-count.)
  //
  // The successor is `municipal`, NOT a promotion to `holding_sub`: Пазарджик's
  // water services fragmented across municipal operators after the liquidation,
  // so the oblast genuinely has no regional monopoly. The header records that as
  // a named exception rather than restoring the appearance of one.
  {
    eik: "822106665",
    name: "ВиК Пазарджик ЕООД (в ликвидация)",
    oblast: "Пазарджик",
    type: "holding_sub",
    status: "liquidated",
    successorEik: "205323041",
  },
  {
    eik: "205323041",
    name: "ВиК услуги ЕООД (Пазарджик)",
    oblast: "Пазарджик",
    // Ownership NOT verified against the TR — see the header.
    type: "municipal",
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
  // ВиК Свищов's defunct old EIK (000120252) is intentionally omitted: it would
  // render as a second row for the same company in /water/operators and double-
  // count the org in the group totals. Its footprint is negligible (~1 contract,
  // ~€54k) and it operates under 200736851 now.
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
  {
    eik: "822104714",
    name: "ВКС ЕООД (Пещера)",
    oblast: "Пазарджик",
    type: "municipal",
    aliases: ["Водоснабдяване, канализация и строителство"],
  },
  {
    eik: "822106633",
    name: "ВКТВ ЕООД (Велинград)",
    oblast: "Пазарджик",
    type: "municipal",
    // Last awarded a contract in Feb 2013 (3 contracts, €158,731) — kept for the
    // history, but it is not current coverage.
    status: "dormant",
    aliases: ["Водоснабдяване, канализация и териториален водоинженеринг"],
  },
  {
    eik: "208403279",
    name: "ВиК Елин Пелин ЕООД",
    oblast: "Софийска област",
    type: "municipal",
  },
];

const OPERATOR_BY_EIK: Record<string, WaterOperator> = Object.fromEntries(
  WATER_OPERATORS.map((o) => [o.eik, o]),
);

export const operatorByEik = (eik: string): WaterOperator | undefined =>
  OPERATOR_BY_EIK[eik];

/** The believed-holding subsidiaries (parent excluded). Verify per the note.
 *
 *  ⚠ THIS DRIVES A MONEY CLAIM ABOUT A NAMED LEGAL ENTITY. `useVik` aggregates
 *  `[VIK_HOLDING_EIK, ...VIK_HOLDING_SUB_EIKS]` on /awarder/206086428, so adding
 *  or removing a `holding_sub` row silently moves what that page reports as
 *  Български ВиК холдинг's own group procurement — €41.5M on the 2026-08-13
 *  audit, which is how this warning came to exist. It is NOT interchangeable with
 *  WATER_SECTOR_EIKS below; changing a row's `type` is an attribution decision,
 *  not a classification tidy-up. */
export const VIK_HOLDING_SUB_EIKS: string[] = WATER_OPERATORS.filter(
  (o) => o.type === "holding_sub",
).map((o) => o.eik);

/** Every row in WATER_OPERATORS, whatever its `type` — adding a union member
 *  widens this set automatically and is meant to. This is THE sector universe:
 *  the `/governance/sectors` water headline (SECTOR_EIKS in
 *  scripts/db/gen_procurement/sector_stats.ts), the SECTOR_BROWSE_PACKS `water`
 *  entry (plan §4.3), `/water` and `/water/operators`, and the operator map all
 *  derive from it, so those surfaces cannot disagree about what "water" is.
 *
 *  VIK_HOLDING_SUB_EIKS above is the strictly narrower HOLDING group and is not
 *  interchangeable with this: it excludes the concession (Софийска вода — the
 *  largest water awarder in the country), Напоителни, the dams enterprise and
 *  every municipal operator, which is roughly a quarter of the sector's money.
 *  Use it only where the subject is Български ВиК холдинг itself, e.g.
 *  /awarder/206086428. The exact gap moves with every corpus reload and is
 *  therefore asserted as a BAND in sector_stats.data.test.ts, never restated in
 *  prose here — an earlier draft of this file carried €864.2M in three places
 *  and it was stale before the audit that wrote it had finished.
 *
 *  Deduped because OPERATOR_BY_EIK collapses a repeated EIK silently (last row
 *  wins) while a plain `.map()` would not — and this array is summed. The file
 *  documents two one-company-two-EIK cases already, which is exactly where a
 *  paste error lands. vikReferenceData.test.ts asserts there is nothing to
 *  dedupe, so the guard cannot go quietly vacuous. */
export const WATER_SECTOR_EIKS: string[] = [
  ...new Set(WATER_OPERATORS.map((o) => o.eik)),
];
