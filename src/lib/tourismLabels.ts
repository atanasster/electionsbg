// Shared display labels for the Tourism sector — one source of truth so the
// dashboard tiles (src/screens/sector/tourism/) and the AI tools (ai/tools/) can
// no longer drift. They had already diverged: the AI tool's country map lacked
// RU / BE / CH / SE / DK / NO / FI, so it fell back to the English Eurostat label
// while the tile showed Bulgarian. Pure data, no runtime deps.

/** ISO 2-letter country code → Bulgarian name, for the Eurostat source-market
 *  tile / AI tool. Superset; anything missing falls back to Eurostat's EN label. */
export const TOURISM_MARKET_NAMES_BG: Record<string, string> = {
  RO: "Румъния",
  UA: "Украйна",
  PL: "Полша",
  UK: "Обединено кралство",
  GB: "Обединено кралство",
  DE: "Германия",
  CZ: "Чехия",
  TR: "Турция",
  SK: "Словакия",
  EL: "Гърция",
  GR: "Гърция",
  FR: "Франция",
  IL: "Израел",
  RS: "Сърбия",
  MK: "Северна Македония",
  AT: "Австрия",
  NL: "Нидерландия",
  IT: "Италия",
  ES: "Испания",
  HU: "Унгария",
  MD: "Молдова",
  RU: "Русия",
  BE: "Белгия",
  CH: "Швейцария",
  SE: "Швеция",
  DK: "Дания",
  NO: "Норвегия",
  FI: "Финландия",
};

/** Full month names, index 0 = January. (Single-letter axis labels stay local
 *  to the seasonality tile — those are a tile-specific rendering choice.) */
export const MONTH_NAMES_BG = [
  "януари",
  "февруари",
  "март",
  "април",
  "май",
  "юни",
  "юли",
  "август",
  "септември",
  "октомври",
  "ноември",
  "декември",
] as const;

export const MONTH_NAMES_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;
