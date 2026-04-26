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
