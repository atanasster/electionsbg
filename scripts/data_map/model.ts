// Curated model for the public "Data map" diagram (/data/map).
//
// The diagram is GENERATED, not drawn: source groups reference watcher ids
// from scripts/watch/sources (label/url/cadence/freshness are pulled from the
// registry + state/watch at build time), and build_manifest.ts fails the
// build if a watcher source is missing from the grouping below — so a newly
// watched source must be placed on the map before it can ship.
//
// Node id convention: "src:<id>" | "ds:<id>" | "f:<id>".
// Tags drive the view chips (VIEWS below) — a node is visible in a view when
// it carries the view's tag.

export type Lang = { bg: string; en: string };

export type Origin = "state" | "eu" | "intl" | "community";

export interface SourceGroupDef {
  id: string;
  label: Lang;
  detail: Lang;
  desc: Lang;
  url: string;
  origin: Origin;
  /** Watcher source ids (scripts/watch/sources). Each id maps to exactly one group. */
  members: string[];
  /** Static inputs with no watcher (geo boundaries, one-off census files…). */
  extras?: { label: Lang; url: string }[];
  /** update-* skills that ingest this group — used to overlay live freshness
   *  from data-changes.json at runtime. */
  skills?: string[];
  tags: string[];
}

export interface DatasetDef {
  id: string;
  label: Lang;
  detail: Lang;
  desc: Lang;
  /** Representative path under data/ or public/ (shown in the detail panel). */
  path?: string;
  tags: string[];
}

export interface FeatureDef {
  id: string;
  label: Lang;
  detail: Lang;
  desc: Lang;
  /** Internal route ("/budget") or absolute href for external surfaces. */
  route?: string;
  href?: string;
  tags: string[];
}

export interface ViewDef {
  id: string;
  label: Lang;
  tag: string | null; // null = everything
}

export interface TourDef {
  id: string;
  title: Lang;
  steps: { node: string; text: Lang }[];
}

/**
 * Maps the data paths the AI assistant reads (every `fetchData("...")` in
 * ai/, extracted by build_manifest.ts) to dataset nodes. First match wins;
 * `null` ignores the path (internal artifacts). Template expressions are
 * normalised to `{expr}` before matching, so per-election trees keep their
 * variable name (`/{election}/…` vs `/{cycle}/…`).
 *
 * The build FAILS on an unmatched path — adding a tool that reads a new
 * dataset forces a rule (and thereby an edge) here.
 */
export const AI_PATH_RULES: { pattern: RegExp; dataset: string | null }[] = [
  { pattern: /^\/ai\//, dataset: null }, // internal eval artifacts
  { pattern: /^\/\{cycle\}\//, dataset: "local" },
  { pattern: /^\/local_chmi_history/, dataset: "local" },
  { pattern: /^\/\{e(lection|\.name)?\}\//, dataset: "elections" },
  { pattern: /^\/transitions\//, dataset: "elections" },
  { pattern: /^\/transitions_local\//, dataset: "local" },
  { pattern: /^\/cluster_persistence/, dataset: "elections" },
  { pattern: /^\/canonical_parties/, dataset: "elections" },
  { pattern: /^\/regions\//, dataset: "elections" },
  { pattern: /^\/sections\//, dataset: "elections" },
  { pattern: /^\/problem_sections_stats/, dataset: "elections" },
  {
    pattern: /^\/parliament\/(connections|companies|mp-connections)/,
    dataset: "connections",
  },
  { pattern: /^\/parliament\//, dataset: "parliament" },
  { pattern: /^\/officials\//, dataset: "officials" },
  { pattern: /^\/budget\//, dataset: "budget" },
  {
    pattern: /^\/(macro|macro_peers|cofog|governments|debt-emissions)/,
    dataset: "macro",
  },
  {
    pattern: /^\/(indicators|regional|landuse|schools)/,
    dataset: "indicators",
  },
  {
    pattern: /^\/(air|municipal_transparency|local_taxes|council)\//,
    dataset: "localgov",
  },
  { pattern: /^\/(census|grao_population)/, dataset: "demographics" },
  { pattern: /^\/prices\//, dataset: "prices" },
  { pattern: /^\/polls\//, dataset: "polls" },
  { pattern: /^\/procurement\//, dataset: "procurement" },
  { pattern: /^\/funds\//, dataset: "funds" },
  { pattern: /^\/financing\//, dataset: "financing" },
  { pattern: /^\/(municipalities|settlements|ekatte)/, dataset: "geo" },
  { pattern: /^\/(maps\/|regions_map)/, dataset: "geo" },
];

export const SOURCE_GROUPS: SourceGroupDef[] = [
  {
    id: "cik",
    label: { bg: "ЦИК", en: "Central Election Commission" },
    detail: {
      bg: "протоколи и резултати по секции",
      en: "section-level protocols and results",
    },
    desc: {
      bg: "Протоколите на секционните комисии и официалните резултати от results.cik.bg — за всички парламентарни избори от 2005 г. и местните избори от 2007 г. насам.",
      en: "Section-commission protocols and official results from results.cik.bg — every parliamentary election since 2005 and local elections since 2007.",
    },
    url: "https://results.cik.bg/",
    origin: "state",
    members: ["cik_results"],
    skills: ["update-local-elections"],
    tags: ["elections", "local"],
  },
  {
    id: "parliament",
    label: { bg: "Народно събрание", en: "National Assembly" },
    detail: {
      bg: "поименни гласувания и профили",
      en: "roll-call votes and MP profiles",
    },
    desc: {
      bg: "Поименните гласувания от пленарните заседания, съставите и биографиите на народните представители от parliament.bg.",
      en: "Roll-call votes from plenary sittings plus MP rosters and biographies from parliament.bg.",
    },
    url: "https://www.parliament.bg/",
    origin: "state",
    members: ["parliament_votes", "parliament_mps"],
    skills: ["update-rollcall", "parliament-scrape"],
    tags: ["parliament"],
  },
  {
    id: "dv",
    label: { bg: "Държавен вестник", en: "State Gazette" },
    detail: {
      bg: "закон за бюджета и приложения",
      en: "budget law and annexes",
    },
    desc: {
      bg: "Обнародваният Закон за държавния бюджет с чл. 53 (трансфери към общините) и Приложение III — инвестиционната програма по проекти.",
      en: "The promulgated State Budget Law with Article 53 municipal transfers and Annex III — the per-project investment programme.",
    },
    url: "https://dv.parliament.bg/",
    origin: "state",
    members: ["budget_law", "dv_investment_annex"],
    skills: ["update-budget"],
    tags: ["fiscal"],
  },
  {
    id: "sp",
    label: { bg: "Сметна палата", en: "National Audit Office" },
    detail: {
      bg: "декларации и партийно финансиране",
      en: "asset declarations and party financing",
    },
    desc: {
      bg: "Имуществените декларации на депутати, магистрати, кметове и съветници от register.cacbg.bg, плюс отчетите за финансиране на партиите и предизборните кампании.",
      en: "Asset and interest declarations of MPs, officials, mayors and councillors from register.cacbg.bg, plus party and campaign financing reports.",
    },
    url: "https://register.cacbg.bg/",
    origin: "state",
    members: [
      "smetna_palata",
      "financing_reports",
      "cacbg_declarations",
      "cacbg_officials",
      "cacbg_local",
    ],
    skills: ["update-connections", "update-officials", "update-financing"],
    tags: ["parliament", "elections", "local"],
  },
  {
    id: "egov",
    label: { bg: "data.egov.bg", en: "data.egov.bg" },
    detail: {
      bg: "портал за отворени данни",
      en: "the national open-data portal",
    },
    desc: {
      bg: "Националният портал за отворени данни: обществени поръчки (АОП), Търговски регистър, касово изпълнение на бюджета, общински бюджети, ДЗИ резултати, качество на въздуха (ИАОС) и пощенски кодове.",
      en: "The national open-data portal: public procurement (OCDS), the Commerce Registry, budget cash execution, municipal budgets, matura exam scores, air quality and postcodes.",
    },
    url: "https://data.egov.bg/",
    origin: "state",
    members: [
      "egov_procurement",
      "aop_debarred",
      "egov_commerce",
      "egov_budget_execution",
      "egov_municipal_execution",
      "bgpost_postcodes",
      "indicators_mon_dzi",
      "iaos_air_quality",
    ],
    skills: [
      "update-procurement",
      "update-connections",
      "update-budget",
      "update-indicators",
      "update-air-quality",
    ],
    tags: ["fiscal", "parliament", "indicators", "local"],
  },
  {
    id: "isun",
    label: { bg: "ИСУН 2020", en: "ISUN (EU funds register)" },
    detail: {
      bg: "бенефициенти и проекти по еврофондове",
      en: "EU-funds beneficiaries and projects",
    },
    desc: {
      bg: "Публичният регистър на еврофондовете — всички договори, бенефициенти и проекти по оперативните програми и ПВУ от 2020.eufunds.bg.",
      en: "The public EU-funds register — every contract, beneficiary and project across operational programmes and the RRF, from 2020.eufunds.bg.",
    },
    url: "https://2020.eufunds.bg/",
    origin: "state",
    members: ["isun_eu_funds", "isun_eu_funds_projects"],
    skills: ["update-funds"],
    tags: ["fiscal", "local"],
  },
  {
    id: "ministries",
    label: { bg: "Министерства и агенции", en: "Ministries and agencies" },
    detail: {
      bg: "МФ, НАП, Митници, НОИ, МРРБ, ИИСДА",
      en: "MoF, NRA, Customs, NSSI, MRDPW, IISDA",
    },
    desc: {
      bg: "Отчети за изпълнението на програмните бюджети, месечните бюлетини на МФ, годишните отчети на НАП и Агенция „Митници“, фондовете на НОИ, общинските проекти в ИПОП (МРРБ) и регистрите на администрацията (ИИСДА).",
      en: "Programme-budget execution reports, MoF monthly bulletins, NRA and Customs annual reports, NSSI social-security funds, MRDPW's municipal project register (IPOP) and the state-administration registers (IISDA).",
    },
    url: "https://www.minfin.bg/",
    origin: "state",
    members: [
      "minfin_mreports",
      "minfin_program_otchet",
      "mfa_program_otchet",
      "ministry_execution_reports",
      "customs_revenue",
      "nap_annual",
      "nssi_b1",
      "policy_baseline_local",
      "ipop_mrrb",
      "iisda_doklad",
      "iisda_mayors",
    ],
    skills: [
      "update-budget",
      "update-noi",
      "update-macro",
      "update-municipal-contacts",
    ],
    tags: ["fiscal", "local"],
  },
  {
    id: "municipalities",
    label: { bg: "Общински администрации", en: "Municipal administrations" },
    detail: {
      bg: "капиталови програми, протоколи, наредби",
      en: "capital programmes, minutes, ordinances",
    },
    desc: {
      bg: "Капиталовите програми на 26 областни града, протоколите с решения на общинските съвети и наредбите за местните данъци и такси — направо от сайтовете на общините.",
      en: "Capital programmes of 26 oblast-centre cities, municipal-council resolution minutes and local-tax ordinances — scraped directly from municipal websites.",
    },
    url: "https://www.namrb.org/",
    origin: "state",
    members: ["capital_programs", "council_minutes", "municipal_naredba"],
    skills: ["update-budget", "update-council-minutes", "update-local-taxes"],
    tags: ["local", "fiscal"],
  },
  {
    id: "nsi",
    label: { bg: "НСИ", en: "National Statistical Institute" },
    detail: {
      bg: "население, преброяване, територия",
      en: "population, census, land use",
    },
    desc: {
      bg: "Население по общини, естествен прираст и миграция, Преброяване 2021, балансът на територията и регионалните отворени данни (болнични легла, ЧПИ, музеи).",
      en: "Municipal population, vital statistics and migration, Census 2021, the land-use balance and regional open data (hospital beds, FDI, museums).",
    },
    url: "https://www.nsi.bg/",
    origin: "state",
    members: [
      "indicators_nsi_pop",
      "indicators_nsi_vital",
      "nsi_landuse",
      "nsi_regional",
    ],
    extras: [
      {
        label: { bg: "Преброяване 2021", en: "Census 2021" },
        url: "https://census2021.bg/",
      },
      {
        label: { bg: "ЕКАТТЕ класификатор", en: "EKATTE classifier" },
        url: "https://www.nsi.bg/nrnm/ekatte/regions",
      },
    ],
    skills: [
      "update-indicators",
      "update-landuse",
      "update-regional",
      "update-census",
    ],
    tags: ["indicators"],
  },
  {
    id: "az",
    label: { bg: "Агенция по заетостта", en: "Employment Agency" },
    detail: {
      bg: "регистрирана безработица по общини",
      en: "registered unemployment by municipality",
    },
    desc: {
      bg: "Годишните таблици за регистрирана и продължителна безработица по общини от az.government.bg.",
      en: "Annual registered and long-term unemployment tables by municipality from az.government.bg.",
    },
    url: "https://www.az.government.bg/stats/4/",
    origin: "state",
    members: ["indicators_az"],
    skills: ["update-indicators", "update-regional"],
    tags: ["indicators"],
  },
  {
    id: "grao",
    label: { bg: "ГРАО", en: "Civil Registration (GRAO)" },
    detail: {
      bg: "адресна регистрация по населени места",
      en: "address registration by settlement",
    },
    desc: {
      bg: "Тримесечните таблици „по постоянен и настоящ адрес“ за всяко населено място — независим от НСИ поглед върху населението.",
      en: "Quarterly permanent/current address tables for every settlement — a population view independent of the statistics institute.",
    },
    url: "https://www.grao.bg/tables.html",
    origin: "state",
    members: ["grao"],
    skills: ["update-grao"],
    tags: ["indicators"],
  },
  {
    id: "eurostat",
    label: { bg: "Евростат и ЕК", en: "Eurostat and the EC" },
    detail: {
      bg: "макро, регионални и ЕС серии",
      en: "macro, regional and EU series",
    },
    desc: {
      bg: "Тримесечни и годишни серии: БВП, инфлация, СИЛК неравенство, COFOG разходи, COICOP потребление, NUTS 3 регионални данни и бюджетът на ЕС по държави.",
      en: "Quarterly and annual series: GDP, inflation, SILC inequality, COFOG spending, COICOP consumption, NUTS 3 regional data and the EU budget per member state.",
    },
    url: "https://ec.europa.eu/eurostat/",
    origin: "eu",
    members: [
      "eurostat",
      "eurostat_policy",
      "eurostat_regional",
      "ec_budget_per_ms",
    ],
    skills: ["update-macro", "update-regional", "update-budget"],
    tags: ["indicators", "fiscal", "prices"],
  },
  {
    id: "eu_policy_anchors",
    label: {
      bg: "ЕС, НАТО, МВФ — политики",
      en: "EU, NATO, IMF policy anchors",
    },
    detail: {
      bg: "данъчни ставки в ЕС, отбрана, прогноза на ЕК, ДДС несъбираемост, МВФ",
      en: "EU tax rates, defence shares, EC forecast, VAT gap, IMF",
    },
    desc: {
      bg: "Котвите на данъчния симулатор: ставките в държавите от ЕС зад сравнителите „Като в…“ по отделните лостове и зад бутоните за избор на цяла държава (PwC Worldwide Tax Summaries за ДДС/ДДФЛ/корпоративен; Tax Foundation за акцизите на горива и цигари и ЕК TEDB за спиртните напитки и виното; базите на ОИСР за данъците и за семейството за праговете, необлагаемите минимуми и платения отпуск зад лостовете за необлагаем минимум/скоби/майчинство), дяловете за отбрана от компендиума на НАТО, прогнозата на ЕК за България, върху която стъпва 5-годишната проекция на салдото и дълга, плюс котвите на динамичния (поведенчески) режим — докладът на ЕК за несъбраното ДДС и МВФ изданията зад фискалните мултипликатори. Котвите за хазарта (GGR) и виното са по данни на бранша и НАП. Стойностите живеят като константи с източници в кода на симулатора и се обновяват ръчно при сигнал от наблюдателя.",
      en: "The tax simulator's anchors: EU member-state rates behind both the per-lever \"Like in…\" comparators and the whole-country quick-select profiles (PwC Worldwide Tax Summaries for VAT/PIT/corporate; Tax Foundation for fuel & cigarette excises and the EC TEDB for spirits/wine; the OECD Tax & Family databases for the income-threshold, allowance and paid-leave inputs behind the tax-free-minimum/bracket/maternity levers), defence shares from the NATO expenditure compendium, the EC forecast for Bulgaria that the 5-year balance/debt projection is built on, plus the dynamic (behavioral) mode's anchors — the EC VAT gap report and the IMF vintages behind the fiscal multipliers. The gambling (GGR) and wine bases are industry/НАП-reported. The values live as sourced constants in the simulator code and are updated manually when the watcher flags a change.",
    },
    url: "https://taxsummaries.pwc.com/quick-charts/value-added-tax-vat-rates",
    origin: "intl",
    members: [
      "eu_tax_rates",
      "eu_excise_rates",
      "eu_alcohol_excise",
      "oecd_pit_params",
      "oecd_family_leave",
      "nato_defence",
      "ec_forecast_bg",
      "ec_vat_gap",
      "imf_weo_bg",
    ],
    skills: [],
    tags: ["fiscal"],
  },
  {
    id: "bg_fiscal_anchors",
    label: { bg: "Фискални котви (БГ)", en: "BG fiscal anchors" },
    detail: {
      bg: "НСИ EDP нотификация, Фискален съвет",
      en: "НСИ EDP notification, Fiscal Council",
    },
    desc: {
      bg: "Българските котви на данъчния симулатор: EDP нотификацията на НСИ (дефицит/дълг/БВП — началната точка на 5-годишната проекция) и публикациите на Фискалния съвет, срещу които симулаторът сверява оценките си (включително калибрацията на дивидентния лост в динамичния режим). И двете водят до ръчна редакция на константи с източници в кода.",
      en: "The tax simulator's Bulgarian anchors: the НСИ EDP notification (deficit/debt/GDP — the starting point of the 5-year projection) and the Fiscal Council publications the simulator benchmarks against (including the dividend lever's calibration in dynamic mode). Both map to manual edits of sourced constants in code.",
    },
    url: "https://www.nsi.bg/bg/content/2432/",
    origin: "state",
    members: ["nsi_edp", "fiscal_council_bg"],
    skills: [],
    tags: ["fiscal"],
  },
  {
    id: "intl",
    label: { bg: "Международни индекси", en: "International indices" },
    detail: {
      bg: "Световна банка WGI, Transparency CPI",
      en: "World Bank WGI, Transparency CPI",
    },
    desc: {
      bg: "Индикаторите за управление на Световната банка (шест измерения) и Индексът за възприятие на корупцията на Transparency International.",
      en: "The World Bank's Worldwide Governance Indicators (six dimensions) and Transparency International's Corruption Perceptions Index.",
    },
    url: "https://databank.worldbank.org/source/worldwide-governance-indicators",
    origin: "intl",
    members: ["worldbank_wgi", "transparency_cpi"],
    skills: ["update-macro"],
    tags: ["indicators"],
  },
  {
    id: "bnb",
    label: { bg: "БНБ", en: "Bulgarian National Bank" },
    detail: {
      bg: "аукциони на ДЦК",
      en: "government securities auctions",
    },
    desc: {
      bg: "Резултатите от аукционите за държавни ценни книжа — вътрешният държавен дълг и доходността по емисиите.",
      en: "Government securities auction results — domestic sovereign debt issuance and yields.",
    },
    url: "https://www.bnb.bg/FiscalAgent/FAGSAuctions/FAAuctionResults/index.htm",
    origin: "state",
    members: ["bnb_auctions"],
    skills: ["update-macro"],
    tags: ["fiscal"],
  },
  {
    id: "kzp",
    label: { bg: "КЗП „Колко струва“", en: "CPC price monitor" },
    detail: {
      bg: "1,45 млн. цени дневно от 207 вериги",
      en: "1.45M daily prices from 207 chains",
    },
    desc: {
      bg: "Дневният отворен файл на kolkostruva.bg — индивидуалните цени на 101 продукта от потребителската кошница във всички големи търговски вериги, от въвеждането на еврото насам.",
      en: "The daily open-data file from kolkostruva.bg — individual prices for the 101-product consumer basket across all major retail chains, since euro adoption.",
    },
    url: "https://kolkostruva.bg/opendata",
    origin: "state",
    members: ["kzp_prices"],
    skills: ["update-prices"],
    tags: ["prices"],
  },
  {
    id: "tibg",
    label: {
      bg: "Прозрачност без граници",
      en: "Transparency International BG",
    },
    detail: {
      bg: "индекс на местния интегритет (LISI)",
      en: "Local Integrity System Index (LISI)",
    },
    desc: {
      bg: "Годишният Индекс на местната система за почтеност — композитна оценка за прозрачност на 27-те областни центъра.",
      en: "The annual Local Integrity System Index — a composite transparency score for the 27 oblast-centre municipalities.",
    },
    url: "https://lisi.transparency.bg/",
    origin: "intl",
    members: ["ti_bg_lisi"],
    skills: ["update-transparency-lisi"],
    tags: ["local"],
  },
  {
    id: "ipi",
    label: { bg: "ИПИ · 265 общини", en: "IME · 265 municipalities" },
    detail: {
      bg: "местни данъци и такси",
      en: "local tax rates",
    },
    desc: {
      bg: "Петте индикатора за местни данъци на Института за пазарна икономика — данък върху имоти на юридически лица, възмезден превоз, превозни средства и патентни данъци за всички 265 общини.",
      en: "The Institute for Market Economics' five local-tax indicators — property, transfer, vehicle and patent taxes across all 265 municipalities.",
    },
    url: "https://www.265obshtini.bg/",
    origin: "community",
    members: ["ipi_local_taxes"],
    skills: ["update-local-taxes"],
    tags: ["local"],
  },
  {
    id: "wiki",
    label: { bg: "Уикипедия", en: "Wikipedia" },
    detail: {
      bg: "социология и хронология на кабинетите",
      en: "polls and cabinet chronology",
    },
    desc: {
      bg: "Социологическите проучвания, събрани в българската Уикипедия, и хронологията на правителствата — проверени срещу сайтовете на агенциите и официални източници.",
      en: "Opinion polls collected on Bulgarian Wikipedia and the cabinet chronology — cross-checked against pollster websites and official sources.",
    },
    url: "https://bg.wikipedia.org/",
    origin: "community",
    members: ["wiki_polls", "wiki_governments"],
    skills: ["update-polls"],
    tags: ["elections", "indicators"],
  },
  {
    id: "geo",
    label: { bg: "Геоданни и граници", en: "Geodata and boundaries" },
    detail: {
      bg: "ГИС контури, локации, ЕКАТТЕ",
      en: "GIS boundaries, locations, EKATTE",
    },
    desc: {
      bg: "Контурите на области, общини и населени места (Bulgaria-geocoding), районите на София (Sofiaplan) и координатите на населените места — основата на всички карти.",
      en: "Region, municipality and settlement boundaries (Bulgaria-geocoding), Sofia districts (Sofiaplan) and settlement coordinates — the base layer for every map.",
    },
    url: "https://github.com/yurukov/Bulgaria-geocoding",
    origin: "community",
    members: [],
    extras: [
      {
        label: {
          bg: "Bulgaria-geocoding (Юруков)",
          en: "Bulgaria-geocoding (Yurukov)",
        },
        url: "https://github.com/yurukov/Bulgaria-geocoding",
      },
      {
        label: { bg: "Sofiaplan API", en: "Sofiaplan API" },
        url: "https://sofiaplan.bg/api/",
      },
    ],
    skills: [],
    tags: ["elections", "local", "indicators"],
  },
];

export const DATASETS: DatasetDef[] = [
  {
    id: "elections",
    label: { bg: "Парламентарни избори", en: "Parliamentary elections" },
    detail: {
      bg: "2005–2026, до ниво секция",
      en: "2005–2026, down to section level",
    },
    desc: {
      bg: "Резултатите от всеки парламентарен вот от 2005 г. насам — по секция, населено място, община и област, с машинно/хартиено разделение, преференции и деривирания рисков индекс.",
      en: "Every parliamentary vote since 2005 — by section, settlement, municipality and region, with machine/paper splits, preferences and the derived risk index.",
    },
    path: "public/{election}/",
    tags: ["elections"],
  },
  {
    id: "local",
    label: { bg: "Местни избори", en: "Local elections" },
    detail: {
      bg: "кметове и съвети, 2007–2026",
      en: "mayors and councils, 2007–2026",
    },
    desc: {
      bg: "Резултати за кметове и общински съвети от всички редовни цикли от 2007 г. насам плюс частичните и нови избори между тях.",
      en: "Mayor and council results from every regular cycle since 2007 plus the partial and new elections in between.",
    },
    path: "data/{cycle}_mi/",
    tags: ["local", "elections"],
  },
  {
    id: "parliament",
    label: { bg: "Гласувания и депутати", en: "Votes and MPs" },
    detail: {
      bg: "поименни вотове, лоялност, присъствие",
      en: "roll calls, loyalty, attendance",
    },
    desc: {
      bg: "Всички поименни гласувания с деривирани метрики — лоялност към групата, присъствие, сходство между депутати и кохезия на групите.",
      en: "Every roll-call vote with derived metrics — party loyalty, attendance, MP similarity and group cohesion.",
    },
    path: "data/parliament/votes/",
    tags: ["parliament"],
  },
  {
    id: "connections",
    label: { bg: "Граф на връзките", en: "Connections graph" },
    detail: {
      bg: "депутати ↔ фирми ↔ длъжностни лица",
      en: "MPs ↔ companies ↔ officials",
    },
    desc: {
      bg: "Бизнес връзките между хора във властта и фирми — от декларациите пред Сметната палата, съединени с Търговския регистър.",
      en: "Business ties between people in power and companies — from audit-office declarations joined with the Commerce Registry.",
    },
    path: "public/parliament/connections.json",
    tags: ["parliament"],
  },
  {
    id: "officials",
    label: {
      bg: "Декларации на длъжностни лица",
      en: "Officials' declarations",
    },
    detail: {
      bg: "имущество на министри, кметове, съветници",
      en: "assets of ministers, mayors, councillors",
    },
    desc: {
      bg: "Декларираното имущество на членовете на кабинета, областните управители и общинския ешелон — кметове, председатели на съвети, съветници.",
      en: "Declared assets of cabinet members, governors and the municipal tier — mayors, council chairs, councillors.",
    },
    path: "data/officials/",
    tags: ["parliament", "local"],
  },
  {
    id: "financing",
    label: { bg: "Партийно финансиране", en: "Party financing" },
    detail: {
      bg: "приходи, разходи, дарители",
      en: "income, expenses, donors",
    },
    desc: {
      bg: "Декларираните приходи и разходи на партиите за всяка кампания и годишните им отчети — включително индивидуалните дарители.",
      en: "Declared party income and spending for every campaign plus annual reports — including individual donors.",
    },
    path: "data/financing/",
    tags: ["elections"],
  },
  {
    id: "procurement",
    label: { bg: "Обществени поръчки", en: "Public procurement" },
    detail: {
      bg: "договори, изпълнители, възложители",
      en: "contracts, contractors, awarders",
    },
    desc: {
      bg: "Всички договори от АОП — по месеци, изпълнители и възложители, с локализация до населено място и кръстосани проверки срещу графа на връзките.",
      en: "Every procurement contract — by month, contractor and awarder, localised to settlement level and cross-checked against the connections graph.",
    },
    path: "data/procurement/",
    tags: ["fiscal"],
  },
  {
    id: "funds",
    label: { bg: "Еврофондове", en: "EU funds" },
    detail: {
      bg: "бенефициенти, проекти, интегритет",
      en: "beneficiaries, projects, integrity",
    },
    desc: {
      bg: "Договорите и бенефициентите по еврофондовете с геокодирани проекти по общини и интегрити проверки срещу декларациите и черните списъци.",
      en: "EU-funds contracts and beneficiaries with geocoded projects per municipality and integrity checks against declarations and debarment lists.",
    },
    path: "data/funds/",
    tags: ["fiscal", "local"],
  },
  {
    id: "budget",
    label: { bg: "Държавен бюджет", en: "State budget" },
    detail: {
      bg: "план, изпълнение, капиталови проекти",
      en: "plan, execution, capital projects",
    },
    desc: {
      bg: "Законът за бюджета срещу касовото изпълнение — по министерства и програми, с приходната разбивка (ДДС, акцизи, мита), общинските бюджети, инвестиционната програма и фондовете на НОИ.",
      en: "Budget law versus cash execution — by ministry and programme, with the revenue breakdown (VAT, excise, customs), municipal budgets, the investment programme and NSSI funds.",
    },
    path: "data/budget/",
    tags: ["fiscal"],
  },
  {
    id: "macro",
    label: { bg: "Макро и ЕС сравнения", en: "Macro and EU comparisons" },
    detail: {
      bg: "БВП, инфлация, дълг, ЕС партньори",
      en: "GDP, inflation, debt, EU peers",
    },
    desc: {
      bg: "Националните макро серии и сравненията с ЕС — растеж, инфлация, дълг, фискален резерв, COFOG структура на разходите, управленски индикатори и хронологията на кабинетите.",
      en: "National macro series and EU comparisons — growth, inflation, debt, the fiscal reserve, COFOG spending structure, governance indicators and the cabinet timeline.",
    },
    path: "data/macro.json",
    tags: ["indicators", "fiscal"],
  },
  {
    id: "indicators",
    label: { bg: "Регионални индикатори", en: "Regional indicators" },
    detail: {
      bg: "безработица, ДЗИ, регионално развитие",
      en: "unemployment, education, regional growth",
    },
    desc: {
      bg: "Годишните под-национални индикатори — безработица и матури по общини, БВП на човек, миграция и инвестиции по области.",
      en: "Annual sub-national indicators — unemployment and matura scores by municipality, GDP per capita, migration and investment by region.",
    },
    path: "data/indicators.json",
    tags: ["indicators"],
  },
  {
    id: "demographics",
    label: { bg: "Демография и население", en: "Demographics and population" },
    detail: {
      bg: "преброяване, ГРАО, прираст",
      en: "census, registration, vital statistics",
    },
    desc: {
      bg: "Преброяване 2021 по образование, възраст и етнос, адресните регистри на ГРАО и естественият прираст — основата на демографските разрези на вота.",
      en: "Census 2021 by education, age and ethnicity, GRAO address registers and vital statistics — the base for demographic vote analysis.",
    },
    path: "data/census/",
    tags: ["indicators", "elections"],
  },
  {
    id: "localgov",
    label: { bg: "Местна власт", en: "Local government" },
    detail: {
      bg: "данъци, решения, прозрачност, въздух",
      en: "taxes, resolutions, transparency, air",
    },
    desc: {
      bg: "Местните данъци по общини, решенията на общинските съвети, индексът на прозрачност LISI, контактите на кметовете и качеството на въздуха.",
      en: "Local tax rates per municipality, council resolutions, the LISI transparency index, mayor contacts and air quality.",
    },
    path: "data/local_taxes/ · data/council/",
    tags: ["local"],
  },
  {
    id: "prices",
    label: { bg: "Цени на дребно", en: "Retail prices" },
    detail: {
      bg: "кошница по населени места и вериги",
      en: "basket by settlement and chain",
    },
    desc: {
      bg: "Потребителската кошница от въвеждането на еврото — мин/средна/макс цена по населено място и продукт, индекси по категории и сравнение между веригите.",
      en: "The consumer basket since euro adoption — min/average/max prices by settlement and product, category indices and chain comparison.",
    },
    path: "data/prices/",
    tags: ["prices"],
  },
  {
    id: "polls",
    label: { bg: "Социология", en: "Opinion polls" },
    detail: {
      bg: "проучвания и точност на агенциите",
      en: "surveys and pollster accuracy",
    },
    desc: {
      bg: "Предизборните проучвания за всеки вот с измерена точност на всяка агенция спрямо реалния резултат.",
      en: "Pre-election surveys for every vote with each agency's measured accuracy against the real result.",
    },
    path: "data/polls/",
    tags: ["elections"],
  },
  {
    id: "geo",
    label: { bg: "Карти и граници", en: "Maps and boundaries" },
    detail: {
      bg: "geojson на области, общини, секции",
      en: "geojson for regions, munis, sections",
    },
    desc: {
      bg: "Геоконтурите и координатите, върху които стъпват всички карти — области, общини, населени места, столичните райони и адресите на секциите.",
      en: "The boundaries and coordinates under every map — regions, municipalities, settlements, Sofia districts and polling-station locations.",
    },
    path: "public/*.geojson",
    tags: ["elections", "local", "indicators"],
  },
];

export const FEATURES: FeatureDef[] = [
  {
    id: "elections",
    label: { bg: "Изборни карти и резултати", en: "Election maps and results" },
    detail: {
      bg: "интерактивни карти на всеки вот",
      en: "interactive maps of every vote",
    },
    desc: {
      bg: "Резултати по области, общини, населени места и секции — с преференции, машинно гласуване, демографски разрези и сравнение между изборите.",
      en: "Results by region, municipality, settlement and section — with preferences, machine voting, demographic breakdowns and election-to-election comparison.",
    },
    route: "/",
    tags: ["elections"],
  },
  {
    id: "risk",
    label: { bg: "Рискови анализи", en: "Risk analysis" },
    detail: {
      bg: "аномалии и контролиран вот",
      en: "anomalies and controlled voting",
    },
    desc: {
      bg: "Композитният рисков индекс и докладите за аномалии — Бенфорд отклонения, клъстери на контролиран вот, недействителни бюлетини, повторни преброявания.",
      en: "The composite risk index and anomaly reports — Benford deviations, controlled-voting clusters, invalid ballots, recount shifts.",
    },
    route: "/risk-analysis",
    tags: ["elections"],
  },
  {
    id: "polls",
    label: { bg: "Социологически проучвания", en: "Opinion polls" },
    detail: {
      bg: "кой колко позна",
      en: "who called it right",
    },
    desc: {
      bg: "Всички предизборни проучвания, сравнени с реалните резултати — точност и пристрастия на всяка агенция през годините.",
      en: "Every pre-election poll compared against the real results — each agency's accuracy and bias over the years.",
    },
    route: "/polls",
    tags: ["elections"],
  },
  {
    id: "local",
    label: { bg: "Местни избори", en: "Local elections" },
    detail: {
      bg: "кметове, съвети, балотажи",
      en: "mayors, councils, runoffs",
    },
    desc: {
      bg: "Резултатите от местните избори по общини — кметски битки, разпределение на съветите, хемицикли и извънредните избори между циклите.",
      en: "Local-election results by municipality — mayoral races, council seat allocation, hemicycles and the extraordinary elections between cycles.",
    },
    route: "/local/2023_10_29_mi",
    tags: ["local", "elections"],
  },
  {
    id: "parliament",
    label: { bg: "Парламент и гласувания", en: "Parliament and votes" },
    detail: {
      bg: "кой как гласува в пленарна зала",
      en: "who votes how in the plenary",
    },
    desc: {
      bg: "Поименните гласувания, лоялността и присъствието на всеки депутат, сходството между депутати и кохезията на групите.",
      en: "Roll-call votes, every MP's loyalty and attendance, MP-to-MP similarity and party cohesion.",
    },
    route: "/parliament",
    tags: ["parliament"],
  },
  {
    id: "mps",
    label: { bg: "Депутати и връзки", en: "MPs and connections" },
    detail: {
      bg: "профили, декларации, бизнес граф",
      en: "profiles, declarations, business graph",
    },
    desc: {
      bg: "Профил на всеки депутат — резултати, декларирано имущество, фирмени връзки, поръчки и еврофондове на свързани фирми, дарения.",
      en: "Every MP's profile — results, declared assets, company ties, procurement and EU funds of connected companies, donations.",
    },
    route: "/connections",
    tags: ["parliament"],
  },
  {
    id: "financing",
    label: { bg: "Финансиране на партиите", en: "Party financing" },
    detail: {
      bg: "кампании, дарители, отчети",
      en: "campaigns, donors, reports",
    },
    desc: {
      bg: "Приходите и разходите на партиите по кампании, индивидуалните дарители и статусът на годишните им отчети пред Сметната палата.",
      en: "Party income and spending per campaign, individual donors and the filing status of annual reports before the audit office.",
    },
    route: "/financing",
    tags: ["elections"],
  },
  {
    id: "procurement",
    label: { bg: "Обществени поръчки", en: "Public procurement" },
    detail: {
      bg: "кой печели договорите на държавата",
      en: "who wins the state's contracts",
    },
    desc: {
      bg: "Договорите на държавата и общините — топ изпълнители и възложители, поръчки по населени места и връзки с хора във властта.",
      en: "State and municipal contracts — top contractors and awarders, procurement by settlement and ties to people in power.",
    },
    route: "/procurement",
    tags: ["fiscal"],
  },
  {
    id: "funds",
    label: { bg: "Еврофондове", en: "EU funds" },
    detail: {
      bg: "кой получава европейските пари",
      en: "who receives the EU money",
    },
    desc: {
      bg: "Програмите и бенефициентите на еврофондовете, проектите по общини и интегрити сигналите — свързани лица, черни списъци.",
      en: "EU-funds programmes and beneficiaries, projects per municipality and integrity flags — connected persons, debarment lists.",
    },
    route: "/funds",
    tags: ["fiscal"],
  },
  {
    id: "budget",
    label: { bg: "Бюджет и данъчен симулатор", en: "Budget and tax simulator" },
    detail: {
      bg: "къде отиват парите + „какво ако“",
      en: "where the money goes + what-if",
    },
    desc: {
      bg: "Държавният бюджет — план срещу изпълнение по министерства, приходната структура, инвестиционната програма и симулаторът на данъчни промени.",
      en: "The state budget — plan versus execution by ministry, the revenue structure, the investment programme and the tax-policy simulator.",
    },
    route: "/budget",
    tags: ["fiscal"],
  },
  {
    id: "governance",
    label: { bg: "Управление по места", en: "Governance by place" },
    detail: {
      bg: "таблото за твоето населено място",
      en: "the dashboard for your place",
    },
    desc: {
      bg: "Всичко за едно място на един екран — кмет и съвет, избори, бюджет и капиталови проекти, еврофондове, данъци, въздух, демография. Най-големият потребител на данни в сайта.",
      en: "Everything about one place on one screen — mayor and council, elections, budget and capital projects, EU funds, taxes, air quality, demographics. The site's biggest data consumer.",
    },
    route: "/governance",
    tags: ["local", "indicators", "fiscal", "elections"],
  },
  {
    id: "indicators",
    label: { bg: "Индикатори и ЕС сравнение", en: "Indicators and EU compare" },
    detail: {
      bg: "как се справя България",
      en: "how Bulgaria is doing",
    },
    desc: {
      bg: "Икономика, фискална политика, общество и управление — националните серии и сравнението с партньорите от ЕС.",
      en: "Economy, fiscal policy, society and governance — national series and the comparison against EU peers.",
    },
    route: "/indicators",
    tags: ["indicators"],
  },
  {
    id: "prices",
    label: { bg: "Цени и потребление", en: "Prices and consumption" },
    detail: {
      bg: "къде е скъпо и къде — не",
      en: "where it's expensive and where not",
    },
    desc: {
      bg: "Цените на потребителската кошница по населени места и вериги от въвеждането на еврото, плюс структурата на потреблението на домакинствата.",
      en: "Consumer-basket prices by settlement and chain since euro adoption, plus household consumption structure.",
    },
    route: "/prices",
    tags: ["prices"],
  },
  {
    id: "ai",
    label: { bg: "AI асистент", en: "AI assistant" },
    detail: {
      bg: "питай данните на човешки език",
      en: "ask the data in plain language",
    },
    desc: {
      bg: "Чат асистент със 75+ инструмента върху същите данни — изборни резултати, гласувания, бюджет, цени и индикатори, с точни числа от източниците.",
      en: "A chat assistant with 75+ tools over the same data — election results, roll calls, budget, prices and indicators, with exact numbers from the sources.",
    },
    href: "https://ai.electionsbg.com",
    tags: [
      "elections",
      "parliament",
      "fiscal",
      "local",
      "indicators",
      "prices",
    ],
  },
];

/**
 * Edges as [from, to] using full node ids. Always source → dataset → feature.
 * Note: `ds:* → f:ai` edges are NOT listed here — they are derived at build
 * time from the fetchData() calls in ai/ via AI_PATH_RULES above.
 */
export const EDGES: [string, string][] = [
  // sources → datasets
  ["src:cik", "ds:elections"],
  ["src:cik", "ds:local"],
  ["src:parliament", "ds:parliament"],
  ["src:parliament", "ds:connections"],
  ["src:sp", "ds:connections"],
  ["src:sp", "ds:officials"],
  ["src:sp", "ds:financing"],
  ["src:sp", "ds:funds"],
  ["src:egov", "ds:connections"],
  ["src:egov", "ds:procurement"],
  ["src:egov", "ds:budget"],
  ["src:egov", "ds:indicators"],
  ["src:egov", "ds:localgov"],
  ["src:isun", "ds:funds"],
  ["src:dv", "ds:budget"],
  ["src:ministries", "ds:budget"],
  ["src:ministries", "ds:macro"],
  ["src:ministries", "ds:localgov"],
  ["src:municipalities", "ds:budget"],
  ["src:municipalities", "ds:localgov"],
  ["src:nsi", "ds:indicators"],
  ["src:nsi", "ds:demographics"],
  ["src:az", "ds:indicators"],
  ["src:grao", "ds:demographics"],
  ["src:eurostat", "ds:macro"],
  ["src:eurostat", "ds:indicators"],
  ["src:eurostat", "ds:budget"],
  ["src:eu_policy_anchors", "ds:budget"],
  ["src:bg_fiscal_anchors", "ds:budget"],
  ["src:intl", "ds:macro"],
  ["src:bnb", "ds:macro"],
  ["src:kzp", "ds:prices"],
  ["src:tibg", "ds:localgov"],
  ["src:ipi", "ds:localgov"],
  ["src:wiki", "ds:polls"],
  ["src:wiki", "ds:macro"],
  ["src:geo", "ds:geo"],

  // datasets → features
  ["ds:elections", "f:elections"],
  ["ds:elections", "f:risk"],
  ["ds:elections", "f:polls"],
  ["ds:elections", "f:governance"],
  ["ds:local", "f:local"],
  ["ds:local", "f:governance"],
  ["ds:parliament", "f:parliament"],
  ["ds:parliament", "f:mps"],
  ["ds:connections", "f:mps"],
  ["ds:connections", "f:procurement"],
  ["ds:officials", "f:mps"],
  ["ds:officials", "f:governance"],
  ["ds:financing", "f:financing"],
  ["ds:financing", "f:mps"],
  ["ds:procurement", "f:procurement"],
  ["ds:procurement", "f:mps"],
  ["ds:funds", "f:funds"],
  ["ds:funds", "f:mps"],
  ["ds:funds", "f:governance"],
  ["ds:budget", "f:budget"],
  ["ds:budget", "f:governance"],
  ["ds:macro", "f:budget"],
  ["ds:macro", "f:indicators"],
  ["ds:macro", "f:prices"],
  ["ds:indicators", "f:indicators"],
  ["ds:indicators", "f:governance"],
  ["ds:demographics", "f:elections"],
  ["ds:demographics", "f:risk"],
  ["ds:demographics", "f:governance"],
  ["ds:localgov", "f:governance"],
  ["ds:prices", "f:prices"],
  ["ds:prices", "f:governance"],
  ["ds:polls", "f:polls"],
  ["ds:polls", "f:elections"],
  ["ds:geo", "f:elections"],
  ["ds:geo", "f:local"],
  ["ds:geo", "f:governance"],
  ["ds:geo", "f:indicators"],
];

export const VIEWS: ViewDef[] = [
  { id: "all", label: { bg: "Всичко", en: "Everything" }, tag: null },
  {
    id: "elections",
    label: { bg: "Избори", en: "Elections" },
    tag: "elections",
  },
  {
    id: "parliament",
    label: { bg: "Парламент", en: "Parliament" },
    tag: "parliament",
  },
  {
    id: "fiscal",
    label: { bg: "Публични пари", en: "Public money" },
    tag: "fiscal",
  },
  {
    id: "local",
    label: { bg: "Местна власт", en: "Local government" },
    tag: "local",
  },
  {
    id: "indicators",
    label: { bg: "Индикатори", en: "Indicators" },
    tag: "indicators",
  },
  { id: "prices", label: { bg: "Цени", en: "Prices" }, tag: "prices" },
];

export const TIERS: { kind: "source" | "dataset" | "feature"; label: Lang }[] =
  [
    { kind: "source", label: { bg: "Източници", en: "Sources" } },
    { kind: "dataset", label: { bg: "Данни", en: "Datasets" } },
    { kind: "feature", label: { bg: "Функции", en: "Features" } },
  ];

/** Guided walkthroughs — each step highlights one node with a short narration. */
export const TOURS: TourDef[] = [
  {
    id: "ballot",
    title: {
      bg: "Как протоколът става карта",
      en: "How a protocol becomes a map",
    },
    steps: [
      {
        node: "src:cik",
        text: {
          bg: "Всичко започва в ЦИК: след всеки вот протоколите на секционните комисии се публикуват на results.cik.bg.",
          en: "Everything starts at the election commission: after every vote the section protocols are published on results.cik.bg.",
        },
      },
      {
        node: "ds:elections",
        text: {
          bg: "Пайплайнът ги превръща в единен масив — резултати по секция, населено място, община и област, за всеки вот от 2005 г. насам.",
          en: "The pipeline turns them into one dataset — results by section, settlement, municipality and region, for every vote since 2005.",
        },
      },
      {
        node: "f:elections",
        text: {
          bg: "Върху него стъпват интерактивните карти — от националното ниво чак до всяка отделна секция.",
          en: "The interactive maps stand on top of it — from the national level all the way down to each individual section.",
        },
      },
      {
        node: "f:risk",
        text: {
          bg: "Същите числа захранват и рисковите анализи — Бенфорд отклонения, клъстери на контролиран вот, повторни преброявания.",
          en: "The same numbers also power the risk analysis — Benford deviations, controlled-voting clusters, recount shifts.",
        },
      },
      {
        node: "f:ai",
        text: {
          bg: "А AI асистентът отговаря на въпроси върху същите данни — с точните числа от протоколите.",
          en: "And the AI assistant answers questions over the same data — with the exact numbers from the protocols.",
        },
      },
    ],
  },
  {
    id: "money",
    title: {
      bg: "Пътят на публичните пари",
      en: "Following the public money",
    },
    steps: [
      {
        node: "src:dv",
        text: {
          bg: "Законът за бюджета се обнародва в Държавен вестник — с трансферите към общините и инвестиционната програма по проекти.",
          en: "The budget law is promulgated in the State Gazette — with the municipal transfers and the per-project investment programme.",
        },
      },
      {
        node: "src:egov",
        text: {
          bg: "Касовото изпълнение, обществените поръчки и общинските бюджети идват от националния портал за отворени данни.",
          en: "Cash execution, public procurement and municipal budgets come from the national open-data portal.",
        },
      },
      {
        node: "ds:budget",
        text: {
          bg: "Планът се сверява с изпълнението — по министерства, програми и капиталови проекти, до ниво община.",
          en: "The plan is reconciled against execution — by ministry, programme and capital project, down to municipality level.",
        },
      },
      {
        node: "f:budget",
        text: {
          bg: "Резултатът: бюджетът във визуален вид плюс данъчният симулатор „какво ако“.",
          en: "The result: the budget made visual, plus the what-if tax simulator.",
        },
      },
      {
        node: "f:governance",
        text: {
          bg: "И всичко се връзва по места — таблото на твоята община показва нейните пари, проекти и поръчки.",
          en: "And it all ties back to places — your municipality's dashboard shows its money, projects and contracts.",
        },
      },
    ],
  },
  {
    id: "prices",
    title: {
      bg: "Цените: от рафта до екрана",
      en: "Prices: from the shelf to the screen",
    },
    steps: [
      {
        node: "src:kzp",
        text: {
          bg: "КЗП публикува всеки ден 1,45 млн. цени от 207 търговски вериги — отворен файл на kolkostruva.bg.",
          en: "The consumer-protection commission publishes 1.45M prices from 207 retail chains every day — an open file on kolkostruva.bg.",
        },
      },
      {
        node: "ds:prices",
        text: {
          bg: "Пайплайнът ги агрегира по населено място и продукт — мин/средна/макс цена и индекси от въвеждането на еврото.",
          en: "The pipeline aggregates them by settlement and product — min/average/max prices and indices since euro adoption.",
        },
      },
      {
        node: "f:prices",
        text: {
          bg: "Така виждаш къде кошницата е скъпа и къде — не, и как се движат цените след еврото.",
          en: "So you can see where the basket is expensive and where it is not — and how prices move after the euro.",
        },
      },
      {
        node: "f:governance",
        text: {
          bg: "Цените влизат и в таблото на твоето населено място — редом с данъците и бюджета му.",
          en: "Prices also feed your place's dashboard — right next to its taxes and budget.",
        },
      },
    ],
  },
];
