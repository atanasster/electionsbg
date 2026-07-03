// NUTS3 (BG3xx) → oblast display names. The procurement oblast tile-map and the
// concentration section (/procurement/flags#concentration) key on NUTS3
// (unambiguous, 1:1 with the 28 oblasts, and already the keyspace of
// buyer_oblast_map.json) rather than the app's canonical oblast codes
// (SFO/S23/PDV-00…), which carry Sofia/Plovdiv special-casing this feature
// doesn't need. Names only live here; the data files carry the bare NUTS code.

export const NUTS3_NAMES: Record<string, { bg: string; en: string }> = {
  BG311: { bg: "Видин", en: "Vidin" },
  BG312: { bg: "Монтана", en: "Montana" },
  BG313: { bg: "Враца", en: "Vratsa" },
  BG314: { bg: "Плевен", en: "Pleven" },
  BG315: { bg: "Ловеч", en: "Lovech" },
  BG321: { bg: "Велико Търново", en: "Veliko Tarnovo" },
  BG322: { bg: "Габрово", en: "Gabrovo" },
  BG323: { bg: "Русе", en: "Ruse" },
  BG324: { bg: "Разград", en: "Razgrad" },
  BG325: { bg: "Силистра", en: "Silistra" },
  BG331: { bg: "Варна", en: "Varna" },
  BG332: { bg: "Добрич", en: "Dobrich" },
  BG333: { bg: "Шумен", en: "Shumen" },
  BG334: { bg: "Търговище", en: "Targovishte" },
  BG341: { bg: "Бургас", en: "Burgas" },
  BG342: { bg: "Сливен", en: "Sliven" },
  BG343: { bg: "Ямбол", en: "Yambol" },
  BG344: { bg: "Стара Загора", en: "Stara Zagora" },
  BG411: { bg: "София (столица)", en: "Sofia (capital)" },
  BG412: { bg: "София-област", en: "Sofia region" },
  BG413: { bg: "Благоевград", en: "Blagoevgrad" },
  BG414: { bg: "Кюстендил", en: "Kyustendil" },
  BG415: { bg: "Перник", en: "Pernik" },
  BG421: { bg: "Пловдив", en: "Plovdiv" },
  BG422: { bg: "Хасково", en: "Haskovo" },
  BG423: { bg: "Пазарджик", en: "Pazardzhik" },
  BG424: { bg: "Смолян", en: "Smolyan" },
  BG425: { bg: "Кърджали", en: "Kardzhali" },
};

// Display name for a NUTS3 code, falling back to the raw code for anything not
// in the table (defensive — keeps an odd buyer_oblast_map value visible).
export const nuts3Name = (code: string, lang: string): string => {
  const e = NUTS3_NAMES[code];
  if (!e) return code;
  return lang === "bg" ? e.bg : e.en;
};
