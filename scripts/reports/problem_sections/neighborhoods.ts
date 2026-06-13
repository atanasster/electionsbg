export type ProblemNeighborhood = {
  id: string;
  name_bg: string;
  name_en: string;
  city_bg: string;
  city_en: string;
  ekatte: string;
  sectionPrefix?: string;
  addressIncludes?: string[];
  sectionCodes?: string[];
  // МИР-agnostic section-code suffixes (the 9-digit code minus its leading
  // 2-digit МИР/NSI-oblast prefix, i.e. община+район+секция = digits 3-9). Used
  // by the LOCAL matcher to pin махала stations the CIK local feed ships with a
  // BLANK address, so neither the prefix nor the keyword path can reach them
  // (Филиповци). Parliamentary "254619069" and local "224619069" share the
  // suffix "4619069", so one curated list holds across systems and cycles.
  sectionSuffixes?: string[];
  source_url: string;
};

export const PROBLEM_NEIGHBORHOODS: ProblemNeighborhood[] = [
  {
    id: "stolipinovo",
    name_bg: "Столипиново / Шекер махала",
    name_en: "Stolipinovo / Sheker mahala",
    city_bg: "Пловдив",
    city_en: "Plovdiv",
    ekatte: "56784",
    sectionPrefix: "162202",
    source_url:
      "https://www.segabg.com/hot/category-bulgaria/nevalidnite-byuletini-skochiha-nad-40-golemite-romski-mahali",
  },
  {
    id: "fakulteta",
    name_bg: "Факултета",
    name_en: "Fakulteta",
    city_bg: "София",
    city_en: "Sofia",
    ekatte: "68134-2511",
    addressIncludes: ["ФАКУЛТЕТ"],
    source_url:
      "https://www.svobodnaevropa.bg/a/mvr-riskovi-sekcii-kupuvane-glasove-peevski-borisov/33190193.html",
  },
  {
    id: "filipovci",
    name_bg: "Филиповци",
    name_en: "Filipovci",
    city_bg: "София",
    city_en: "Sofia",
    ekatte: "68134-2519",
    addressIncludes: ["ФИЛИПОВЦИ"],
    // The CIK local feed ships every Филиповци махала station (77 ОУ + 103 ОУ
    // Васил Левски, район Люлин) with a BLANK address, so the keyword above can
    // only reach them in the parliamentary data. Pin them by МИР-agnostic suffix
    // for the local matcher — verified stable against the parliamentary
    // problem_sections set across 2009-2026 (132 appears from 2017).
    sectionSuffixes: ["4619069", "4619070", "4619071", "4619072", "4619132"],
    source_url:
      "https://www.svobodnaevropa.bg/a/mvr-riskovi-sekcii-kupuvane-glasove-peevski-borisov/33190193.html",
  },
  {
    id: "nadezhda_sliven",
    name_bg: "Надежда (Сливен)",
    name_en: "Nadezhda (Sliven)",
    city_bg: "Сливен",
    city_en: "Sliven",
    ekatte: "67338",
    addressIncludes: ["БРАТЯ МИЛАДИНОВИ"],
    source_url:
      "https://www.segabg.com/hot/category-bulgaria/nevalidnite-byuletini-skochiha-nad-40-golemite-romski-mahali",
  },
  {
    id: "pobeda_burgas",
    name_bg: "Победа (Бургас)",
    name_en: "Pobeda (Burgas)",
    city_bg: "Бургас",
    city_en: "Burgas",
    ekatte: "07079",
    addressIncludes: ["КВ.ПОБЕДА"],
    source_url: "https://rroma.org/bulgaria-vote-buying/",
  },
  {
    id: "gorno_ezerovo",
    name_bg: "Горно Езерово (Бургас)",
    name_en: "Gorno Ezerovo (Burgas)",
    city_bg: "Бургас",
    city_en: "Burgas",
    ekatte: "07079",
    addressIncludes: ["ГОРНО ЕЗЕРОВО"],
    source_url: "https://rroma.org/bulgaria-vote-buying/",
  },
  {
    id: "dolno_ezerovo",
    name_bg: "Долно Езерово (Бургас)",
    name_en: "Dolno Ezerovo (Burgas)",
    city_bg: "Бургас",
    city_en: "Burgas",
    ekatte: "07079",
    addressIncludes: ["ДОЛНО ЕЗЕРОВО"],
    source_url: "https://rroma.org/bulgaria-vote-buying/",
  },
  {
    id: "maksuda",
    name_bg: "Максуда",
    name_en: "Maksuda",
    city_bg: "Варна",
    city_en: "Varna",
    ekatte: "10135",
    // Maksuda is officially registered under "ж.к. Възраждане" — the housing
    // complex name appears in CEC section addresses for the schools serving it.
    addressIncludes: ["ВЪЗРАЖДАНЕ"],
    source_url:
      "https://www.segabg.com/hot/category-bulgaria/nevalidnite-byuletini-skochiha-nad-40-golemite-romski-mahali",
  },
];
