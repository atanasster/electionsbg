// Human-readable labels for the scalar "facts" keys that tools emit.
//
// Tools store facts under terse snake_case/camelCase keys (`mp_connected_value`,
// `total_value`, `single_bid_share`). Those are developer-facing names, not
// something a reader should see. `factLabel(key, lang)` maps a key to a friendly
// bilingual label, falling back to a humanized version of the raw key for the
// long tail of rarer keys (there are ~400 distinct fact keys across the tools, so
// a curated entry for every one is neither feasible nor maintainable).

import type { Lang } from "../tools/types";

// Curated labels for the common / high-traffic fact keys. Anything not listed
// here is humanized generically (see `humanize` below).
const FACT_LABELS: Record<string, { bg: string; en: string }> = {
  // election results
  votes: { bg: "Гласове", en: "Votes" },
  total_votes: { bg: "Общо гласове", en: "Total votes" },
  valid_votes: { bg: "Действителни гласове", en: "Valid votes" },
  pct: { bg: "Дял", en: "Share" },
  seats: { bg: "Мандати", en: "Seats" },
  total_seats: { bg: "Общо мандати", en: "Total seats" },
  passed_threshold: { bg: "Над прага", en: "Over threshold" },
  turnout: { bg: "Активност", en: "Turnout" },
  voters: { bg: "Гласували", en: "Voters" },
  registered: { bg: "Регистрирани", en: "Registered" },
  machine_share: { bg: "Машинно (дял)", en: "Machine (share)" },
  machine_votes: { bg: "Машинни гласове", en: "Machine votes" },
  paper_votes: { bg: "Хартиени гласове", en: "Paper votes" },
  leading_party: { bg: "Водеща партия", en: "Leading party" },
  leading_pct: { bg: "Водещ дял", en: "Leading share" },
  leading_wins: { bg: "Победи на водещия", en: "Leading wins" },
  winner: { bg: "Победител", en: "Winner" },
  winner_pct: { bg: "Дял на победителя", en: "Winner share" },
  parties_shown: { bg: "Показани партии", en: "Parties shown" },
  elections_count: { bg: "Брой избори", en: "Elections" },
  total_sections: { bg: "Общо секции", en: "Total sections" },
  sections: { bg: "Секции", en: "Sections" },
  biggest_gainer: { bg: "Най-голям ръст", en: "Biggest gainer" },
  biggest_loser: { bg: "Най-голям спад", en: "Biggest loser" },

  // procurement / fiscal
  contracts: { bg: "Договори", en: "Contracts" },
  contractors: { bg: "Изпълнители", en: "Contractors" },
  buyers: { bg: "Възложители", en: "Buyers" },
  total_value: { bg: "Обща стойност", en: "Total value" },
  total_contracted: { bg: "Общо договорено", en: "Total contracted" },
  total_paid: { bg: "Общо платено", en: "Total paid" },
  avg_contract: { bg: "Среден договор", en: "Avg contract" },
  top_contractor: { bg: "Топ изпълнител", en: "Top contractor" },
  top_awarder: { bg: "Топ възложител", en: "Top buyer" },
  top_value: { bg: "Най-голяма стойност", en: "Top value" },
  top_share: { bg: "Най-голям дял", en: "Top share" },
  top_amount: { bg: "Най-голяма сума", en: "Top amount" },
  top_overpay: { bg: "Най-голямо надплащане", en: "Top overpay" },
  single_bid_share: { bg: "Дял с една оферта", en: "Single-bid share" },
  single_bidder: { bg: "Една оферта", en: "Single bidder" },
  direct_award_share: {
    bg: "Дял пряко възлагане",
    en: "Direct-award share",
  },
  active_debarred: { bg: "Активно отстранени", en: "Active debarred" },
  most_appealed_buyer: {
    bg: "Най-обжалван възложител",
    en: "Most-appealed buyer",
  },
  total_complaints: { bg: "Общо жалби", en: "Total complaints" },
  mp_connected_value: {
    bg: "Стойност, свързана с НП",
    en: "MP-connected value",
  },
  mp_connected_count: {
    bg: "Договори, свързани с НП",
    en: "MP-connected contracts",
  },
  official_connected_value: {
    bg: "Стойност, свързана с длъжностни лица",
    en: "Official-connected value",
  },
  official_connected_count: {
    bg: "Договори, свързани с длъжностни лица",
    en: "Official-connected contracts",
  },

  // subsidies / funds
  total: { bg: "Общо", en: "Total" },
  paid: { bg: "Платено", en: "Paid" },
  contracted: { bg: "Договорено", en: "Contracted" },
  expenditure: { bg: "Разход", en: "Expenditure" },
  biggest_amount: { bg: "Най-голяма сума", en: "Biggest amount" },
  biggest_value: { bg: "Най-голяма стойност", en: "Biggest value" },
  biggest_share: { bg: "Най-голям дял", en: "Biggest share" },
  biggest_estimate: { bg: "Най-голяма прогноза", en: "Biggest estimate" },
  richest_assets: { bg: "Най-големи активи", en: "Largest assets" },

  // prices
  cheapest_chain: { bg: "Най-евтина верига", en: "Cheapest chain" },
  lowest_price: { bg: "Най-ниска цена", en: "Lowest price" },
  basket_change_since_euro: {
    bg: "Промяна в кошницата от еврото",
    en: "Basket change since euro",
  },

  // health
  top_hospital: { bg: "Топ болница", en: "Top hospital" },
  top_inn: { bg: "Топ INN", en: "Top INN" },
  top_cases: { bg: "Най-много случаи", en: "Most cases" },
  total_cases: { bg: "Общо случаи", en: "Total cases" },
  busiest_load: { bg: "Най-натоварен", en: "Busiest load" },
  busiest_tier: { bg: "Най-натоварено ниво", en: "Busiest tier" },

  // fiscal / macro / functional
  top_function: { bg: "Топ функция", en: "Top function" },
  top_region: { bg: "Топ регион", en: "Top region" },
  value_type: { bg: "Тип стойност", en: "Value type" },
  waste_per_capita: { bg: "На човек", en: "Per capita" },
  vs_eu_average: { bg: "Спрямо средното за ЕС", en: "vs EU average" },
  vs_peak: { bg: "Спрямо пика", en: "vs peak" },

  // time
  year: { bg: "Година", en: "Year" },
  latest_year: { bg: "Последна година", en: "Latest year" },
  first_year: { bg: "Първа година", en: "First year" },
  peak_year: { bg: "Пикова година", en: "Peak year" },
  latest_value: { bg: "Последна стойност", en: "Latest value" },
  latest_period: { bg: "Последен период", en: "Latest period" },
  latest_election: { bg: "Последни избори", en: "Latest election" },
  as_of: { bg: "Към", en: "As of" },
  period: { bg: "Период", en: "Period" },

  // generic
  count: { bg: "Брой", en: "Count" },
  amount: { bg: "Сума", en: "Amount" },
  share: { bg: "Дял", en: "Share" },
  median: { bg: "Медиана", en: "Median" },
  avg: { bg: "Средно", en: "Average" },
  rank: { bg: "Позиция", en: "Rank" },
  score: { bg: "Оценка", en: "Score" },
  note: { bg: "Бележка", en: "Note" },
  most_accurate: { bg: "Най-точен", en: "Most accurate" },
};

// Tokens that should keep their casing when a key is humanized generically.
const ACRONYMS: Record<string, string> = {
  mp: "НП",
  eik: "ЕИК",
  cpv: "CPV",
  inn: "INN",
  eu: "ЕС",
  bg: "BG",
  en: "EN",
  gdp: "БВП",
  vs: "vs",
  pm10: "ФПЧ10",
  pm25: "ФПЧ2.5",
  aop: "АОП",
  nzok: "НЗОК",
  noi: "НОИ",
  dzi: "ДЗИ",
};

// Fallback: turn `single_bid_share` into "Single bid share" (with known acronyms
// preserved). Used for the long tail of keys without a curated label. camelCase
// is split too, so `latestYear` -> "Latest year".
const humanize = (key: string, lang: Lang): string => {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split("_")
    .filter(Boolean);
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (ACRONYMS[lower]) return lang === "bg" ? ACRONYMS[lower] : lower.toUpperCase();
      const t = lower;
      return i === 0 ? t.charAt(0).toUpperCase() + t.slice(1) : t;
    })
    .join(" ");
};

export const factLabel = (key: string, lang: Lang): string =>
  FACT_LABELS[key]?.[lang] ?? humanize(key, lang);
