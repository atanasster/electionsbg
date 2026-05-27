/**
 * Canonical oblast (region) code ↔ Bulgarian display-name map.
 *
 * The codebase has historically inlined this map in several scripts
 * (build_census, municipal_transfers, investment_program, …). New consumers
 * should import from here; the duplicates can be migrated opportunistically.
 *
 * Notable nuances:
 *   - SFO  = София-област (rural Sofia oblast surrounding the capital)
 *   - SOF  = София (столица) — the capital itself (28th oblast)
 *   - S23/S24/S25 = administrative sub-oblasts of Стол. община used inside
 *     data/settlements.json to key the 24 rayons; each maps back to SOF for
 *     display.
 */

export const OBLAST_BG: Record<string, string> = {
  BLG: "Благоевград",
  BGS: "Бургас",
  VAR: "Варна",
  VTR: "Велико Търново",
  VID: "Видин",
  VRC: "Враца",
  GAB: "Габрово",
  DOB: "Добрич",
  KRZ: "Кърджали",
  KNL: "Кюстендил",
  LOV: "Ловеч",
  MON: "Монтана",
  PAZ: "Пазарджик",
  PER: "Перник",
  PVN: "Плевен",
  PDV: "Пловдив",
  "PDV-00": "Пловдив",
  RAZ: "Разград",
  RSE: "Русе",
  SLS: "Силистра",
  SLV: "Сливен",
  SML: "Смолян",
  SOF: "София (столица)",
  SFO: "София",
  S23: "София (столица)",
  S24: "София (столица)",
  S25: "София (столица)",
  SZR: "Стара Загора",
  TGV: "Търговище",
  HKV: "Хасково",
  SHU: "Шумен",
  JAM: "Ямбол",
};

/** Reverse map: BG oblast name → set of codes. Used when joining external
 * datasets that only carry the Bulgarian name (e.g. БГ Пощи postcode CSV,
 * which collapses SFO/SOF/S23/S24/S25 into a single "София" string).
 *
 * Hand-curated rather than auto-derived from OBLAST_BG because the bare
 * label "София" is ambiguous and must collapse to both the Sofia oblast
 * (SFO) and every Sofia-city sub-code (SOF + S23/S24/S25). The "(столица)"
 * variant is provided for sources that explicitly disambiguate. */
export const OBLAST_CODES_BY_BG_NAME: Record<string, string[]> = (() => {
  const m: Record<string, string[]> = {};
  for (const [code, name] of Object.entries(OBLAST_BG)) {
    if (!m[name]) m[name] = [];
    m[name].push(code);
  }
  // "София" (no qualifier) — most BG-language sources use this for both
  // Sofia city and Sofia oblast. Collapse both.
  m["София"] = Array.from(
    new Set([...(m["София"] ?? []), "SOF", "S23", "S24", "S25"]),
  );
  // "София-област" — occasional disambiguation for the rural oblast.
  m["София-област"] = ["SFO"];
  return m;
})();

/** Sofia city EKATTE — synthetic key used to address the capital as a whole.
 * Note: this EKATTE does not appear as a record in data/settlements.json;
 * settlements there are stored per-rayon as `68134-NNNN`. */
export const SOFIA_EKATTE = "68134";
