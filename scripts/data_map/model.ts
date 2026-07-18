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
  { pattern: /^\/transitions_prevote\//, dataset: "local" },
  { pattern: /^\/local_place_trends\//, dataset: "local" },
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
  { pattern: /^\/judiciary\//, dataset: "judiciary" },
  { pattern: /^\/defense\//, dataset: "defense" },
  { pattern: /^\/security\//, dataset: "security" },
  { pattern: /^\/transport\//, dataset: "transport" },
  { pattern: /^\/energy\//, dataset: "energy" },
  // /sector/environment reads waste.json (Eurostat recycling/per-capita indicators);
  // its other data rides existing datasets (air→localgov, funds→funds, procurement→
  // procurement, cofog→macro). Attribute the env indicator series to `indicators`,
  // mirroring the `/tourism/` → indicators rule.
  { pattern: /^\/environment\//, dataset: "indicators" },
  { pattern: /^\/administration\//, dataset: "administration" },
  { pattern: /^\/social\//, dataset: "social" }, // АСП benefits + Eurostat poverty (benefits.json, poverty_impact.json)
  { pattern: /^\/water\//, dataset: "water" },
  { pattern: /^\/culture\//, dataset: "culture" },
  { pattern: /^\/tourism\//, dataset: "indicators" }, // Eurostat tourism nights (visitors.json)
  { pattern: /^\/budget\//, dataset: "budget" },
  { pattern: /^\/customs\//, dataset: "budget" },
  // macro_fdi must precede the generic `macro` rule below (first match wins),
  // otherwise /macro_fdi.json would be attributed to ds:macro.
  { pattern: /^\/macro_fdi/, dataset: "macro_fdi" },
  {
    pattern: /^\/(macro|macro_peers|cofog|governments|debt-emissions)/,
    dataset: "macro",
  },
  {
    pattern: /^\/(indicators|regional|landuse|schools|education)/,
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
  { pattern: /^\/ngo\//, dataset: "ngo" },
  { pattern: /^\/funds\//, dataset: "funds" },
  // The per-município "recent activity" feed (data/myarea/alerts/) is a derived
  // place-governance digest — built from council/procurement/funds/budget data
  // that already feed AI on their own edges. The model has no dataset→dataset
  // edge, so we attribute the AI fetch to the place-governance dataset.
  { pattern: /^\/myarea\//, dataset: "localgov" },
  { pattern: /^\/financing\//, dataset: "financing" },
  { pattern: /^\/(municipalities|settlements|ekatte)/, dataset: "geo" },
  { pattern: /^\/(maps\/|regions_map)/, dataset: "geo" },
];

export const SOURCE_GROUPS: SourceGroupDef[] = [
  {
    id: "water",
    label: { bg: "Води · ВиК сектор", en: "Water · ВиК sector" },
    detail: {
      bg: "поръчки и почистване на реки",
      en: "procurement & river cleaning",
    },
    desc: {
      bg: "Обществените поръчки на Български ВиК холдинг и регионалните ВиК дружества, и договорите за почистване и корекция на речни корита и дерета — изведени от регистъра на обществените поръчки (АОП/ЦАИС ЕОП). Предстоят показателите на КЕВР (загуби на вода, цени), водният режим (НСИ) и нивата на язовирите (МОСВ).",
      en: "Public procurement of the Bulgarian Water Holding and the regional water operators, plus contracts for cleaning and regulating riverbeds — derived from the public-procurement register (АОП/ЦАИС ЕОП). КЕВР indicators (water loss, tariffs), water rationing (NSI) and reservoir levels (МОСВ) are planned.",
    },
    url: "https://www.vikholding.bg/",
    origin: "state",
    members: [],
    extras: [
      {
        label: {
          bg: "АОП/ЦАИС ЕОП — обществени поръчки",
          en: "АОП/ЦАИС ЕОП — public procurement",
        },
        url: "https://www.eop.bg/",
      },
      {
        label: {
          bg: "КЕВР — регулиране на ВиК",
          en: "КЕВР — water regulation",
        },
        url: "https://www.dker.bg/bg/vik.html",
      },
      {
        label: {
          bg: "НСИ — Статистика на водите (воден режим)",
          en: "NSI — Water statistics (rationing)",
        },
        url: "https://www.nsi.bg/bg/content/2603",
      },
    ],
    skills: [],
    tags: ["fiscal"],
  },
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
      "erik_campaign_financing",
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
      bg: "Националният портал за отворени данни: обществени поръчки (АОП), Търговски регистър, касово изпълнение на бюджета, общински бюджети, резултати от матурите (ДЗИ) и от НВО в 7. клас (по училища — захранват /education и картоните /school), качество на въздуха (ИАОС) и пощенски кодове.",
      en: "The national open-data portal: public procurement (OCDS), the Commerce Registry, budget cash execution, municipal budgets, matura (ДЗИ) and 7th-grade НВО exam results by school (feeding /education and the /school report cards), air quality and postcodes.",
    },
    url: "https://data.egov.bg/",
    origin: "state",
    members: [
      "egov_procurement",
      "egov_commerce",
      "egov_budget_execution",
      "egov_municipal_execution",
      "bgpost_postcodes",
      "indicators_mon_dzi",
      "indicators_mon_nvo",
      "iaos_air_quality",
    ],
    skills: [
      "update-procurement",
      "update-connections",
      "update-budget",
      "update-indicators",
      "update-schools",
      "update-air-quality",
    ],
    tags: ["fiscal", "parliament", "indicators", "local"],
  },
  {
    id: "eop",
    label: { bg: "ЦАИС ЕОП", en: "CAIS EOP (e-procurement)" },
    detail: {
      bg: "пълна емисия отворени данни за поръчките",
      en: "the full procurement open-data feed",
    },
    desc: {
      bg: "Дневната емисия отворени данни на ЦАИС ЕОП (storage.eop.bg): договори (допълват OCDS емисията на АОП с ~900 малки възложители — предимно училища и детски градини — и са единственият източник за 2024–2025 г., които АОП не публикува в OCDS), поръчки (захранват тендер-СТАДИЙНИЯ корпус — прогнозна стойност, обособени позиции, статус — на /procurement/tenders + детайла /tenders/:унп, плюс място на изпълнение по NUTS за локализиране на възложителите) и OCDS обявления (адреси на страните).",
      en: "ЦАИС ЕОП's daily open-data feed (storage.eop.bg): contracts (supplement АОП's OCDS export with ~900 small buyers — mostly schools and kindergartens — and are the sole source for 2024–2025, which АОП doesn't publish in OCDS), tenders (drive the tender-STAGE corpus — estimated value, lots, status — on /procurement/tenders + the /tenders/:unp detail page, plus place-of-performance NUTS for buyer geo-location) and OCDS announcements (party addresses).",
    },
    url: "https://storage.eop.bg/",
    origin: "state",
    members: ["eop_procurement"],
    skills: ["update-procurement"],
    tags: ["fiscal"],
  },
  {
    id: "aop",
    label: { bg: "АОП — черен списък", en: "AOP debarment register" },
    detail: {
      bg: "регистър на отстранените изпълнители",
      en: "the debarred-suppliers register",
    },
    desc: {
      bg: "Регистърът „Стопански субекти с нарушения“ на Агенцията по обществени поръчки (www2.aop.bg) — лица с влязла в сила забрана да участват в обществени поръчки. Захранва маркера „в черен списък“ на оценката на риска. Отделен източник, обхождан директно от сайта на АОП, а не от data.egov.bg.",
      en: 'The Public Procurement Agency\'s "Стопански субекти с нарушения" register (www2.aop.bg) — operators barred from public procurement after a final ruling. Drives the "debarred" flag on the contract risk score. A separate source scraped directly from the АОП site, not data.egov.bg.',
    },
    url: "https://www2.aop.bg/stopanski-subekti/stopanski-subekti-s-narusheniya/",
    origin: "state",
    members: ["aop_debarred"],
    skills: ["update-procurement"],
    tags: ["fiscal"],
  },
  {
    id: "kzk",
    label: { bg: "КЗК — жалби по ЗОП", en: "CPC procurement appeals" },
    detail: {
      bg: "регистър на жалбите пред КЗК",
      en: "the procurement-appeals register",
    },
    desc: {
      bg: "Публичният електронен регистър на Комисията за защита на конкуренцията (reg.cpc.bg) — всяка жалба срещу обществена поръчка с нейния УНП, статус (спряно/приключено/…) и изхода на решението (уважена/отхвърлена). Свързва се точно към търга по УНП и показва „обжалвана“/„спряна“ на страницата на процедурата. Ръчно обхождане с браузър (изисква българска свързаност).",
      en: "The Competition Protection Commission's public register (reg.cpc.bg) — every complaint against a public-procurement procedure with its УНП, status (suspended/concluded/…) and merits outcome (upheld/rejected). Joins to the tender by exact УНП and drives the “under appeal” / “suspended” markers on the procedure page. Manual headed-browser crawl (needs a Bulgarian connection).",
    },
    url: "https://reg.cpc.bg/AllComplaints.aspx?dt=2",
    origin: "state",
    members: ["kzk_appeals"],
    // Manual, headed-Playwright ingest (scripts/procurement/kzk_appeals.ts) — NOT
    // part of update-procurement's automated flow, so no auto-skill is mapped.
    skills: [],
    tags: ["fiscal"],
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
    id: "dfz",
    label: { bg: "ДФ „Земеделие“", en: "State Fund Agriculture" },
    detail: {
      bg: "изплатени земеделски субсидии",
      en: "paid farm subsidies",
    },
    desc: {
      bg: "Разплащателната агенция по ОСП — всички изплатени субсидии (директни плащания, пазарни мерки и развитие на селските райони) по бенефициент, схема и област, публикувани на data.egov.bg.",
      en: "The CAP paying agency — every paid subsidy (direct payments, market measures and rural development) by beneficiary, scheme and region, published on data.egov.bg.",
    },
    url: "https://www.dfz.bg/",
    origin: "state",
    members: ["dfz_subsidies"],
    skills: ["update-agri"],
    tags: ["fiscal"],
  },
  {
    id: "ec_fts",
    label: {
      bg: "ЕК — Система за финансова прозрачност",
      en: "EC Financial Transparency System",
    },
    detail: {
      bg: "получатели на пряко управлявани средства от ЕС",
      en: "recipients of directly-managed EU funds",
    },
    desc: {
      bg: "Годишните набори данни на Системата за финансова прозрачност (FTS) на Европейската комисия — получателите на пряко управляваните бюджетни средства на ЕС (Horizon, Erasmus, CERV, LIFE и др.), с флаг за НПО и ДДС номер. Захранва профила „Външно финансиране“ на организациите с нестопанска цел (допълва ИСУН, който покрива средствата при споделено управление).",
      en: "The European Commission's Financial Transparency System annual datasets — recipients of directly-managed EU budget funds (Horizon, Erasmus, CERV, LIFE, etc.), with an NGO flag and VAT number. Feeds the NGO 'external funding' profile (complements ISUN, which covers shared-management funds).",
    },
    url: "https://ec.europa.eu/budget/financial-transparency-system/",
    origin: "eu",
    members: ["ec_fts"],
    tags: ["fiscal"],
  },
  {
    id: "ministries",
    label: { bg: "Министерства и агенции", en: "Ministries and agencies" },
    detail: {
      bg: "МФ, НАП, Митници, НОИ, МРРБ, ИИСДА",
      en: "MoF, NRA, Customs, NSSI, NHIF, MRDPW, IISDA",
    },
    desc: {
      bg: "Отчети за изпълнението на програмните бюджети, месечните бюлетини на МФ, годишните отчети на НАП и Агенция „Митници“, фондовете на НОИ, бюджета и плащанията на НЗОК (болнична помощ, лекарства, единични цени на лекарства, отчетени дейности и цени на клинични пътеки по НРД), финансовите показатели на болниците (ЕЕОФ, МЗ), годишните приходи на частните болници от ГФО в Търговския регистър, общинските проекти в ИПОП (МРРБ) и регистрите на администрацията (ИИСДА).",
      en: "Programme-budget execution reports, MoF monthly bulletins, NRA and Customs annual reports, NSSI social-security funds, NHIF (НЗОК) budget + payments (hospital care, drugs, per-hospital drug unit prices, reported clinical-pathway activity and НРД pathway tariffs), the МЗ hospital financial indicators (ЕЕОФ), private-hospital annual revenue from ГФО in the Commerce Register, MRDPW's municipal project register (IPOP) and the state-administration registers (IISDA).",
    },
    url: "https://www.minfin.bg/",
    origin: "state",
    extras: [
      {
        label: {
          bg: "Търговски регистър — ГФО на частните болници (годишни приходи)",
          en: "Commerce Register — private-hospital annual accounts (ГФО revenue)",
        },
        url: "https://portal.registryagency.bg/",
      },
    ],
    members: [
      "minfin_mreports",
      "minfin_program_otchet",
      "mfa_program_otchet",
      "ministry_execution_reports",
      "customs_revenue",
      "customs_excise_register",
      "nap_annual",
      "nssi_b1",
      "nssi_yearbook",
      "kfn_pensions",
      "nzok_hospital_bmp",
      "nzok_drug_quarterly",
      "nzok_drug_unit_prices",
      "nzok_execution_b1",
      "nzok_activities",
      "mh_eeof_quarterly",
      "policy_baseline_local",
      "ipop_mrrb",
      "iisda_doklad",
      "iisda_mayors",
    ],
    skills: [
      "update-budget",
      "update-noi",
      "update-nzok",
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
      bg: "Население по общини, естествен прираст и миграция, Преброяване 2021, балансът на територията и регионалните отворени данни (болнични легла, обща смъртност, ЧПИ, музеи).",
      en: "Municipal population, vital statistics and migration, Census 2021, the land-use balance and regional open data (hospital beds, crude death rate, FDI, museums).",
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
      bg: "Тримесечни и годишни серии: БВП, инфлация, СИЛК неравенство, COFOG разходи, COICOP потребление, ценови равнища на храните (PLI, за /consumption/eu), NUTS 3 регионални данни и бюджетът на ЕС по държави.",
      en: "Quarterly and annual series: GDP, inflation, SILC inequality, COFOG spending, COICOP consumption, food price level indices (PLI, for /consumption/eu), NUTS 3 regional data and the EU budget per member state.",
    },
    url: "https://ec.europa.eu/eurostat/",
    origin: "eu",
    members: [
      "eurostat",
      "eurostat_policy",
      "eurostat_regional",
      "eurostat_tourism",
      "eurostat_env",
      "eurostat_food_pli",
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
      bg: "НСИ EDP нотификация, Фискален съвет, АПИ пътни такси",
      en: "НСИ EDP notification, Fiscal Council, АПИ road charges",
    },
    desc: {
      bg: "Българските котви на данъчния симулатор: EDP нотификацията на НСИ (дефицит/дълг/БВП — началната точка на 5-годишната проекция), публикациите на Фискалния съвет, срещу които симулаторът сверява оценките си (включително калибрацията на дивидентния лост в динамичния режим), и годишните приходи от пътни такси на АПИ (винетки + тол — базата на лоста за пътни такси). Всички водят до ръчна редакция на константи с източници в кода.",
      en: "The tax simulator's Bulgarian anchors: the НСИ EDP notification (deficit/debt/GDP — the starting point of the 5-year projection), the Fiscal Council publications the simulator benchmarks against (including the dividend lever's calibration in dynamic mode), and АПИ's annual road-charge revenue (vignettes + toll — the base of the road-charge lever). All map to manual edits of sourced constants in code.",
    },
    url: "https://www.nsi.bg/bg/content/2432/",
    origin: "state",
    members: ["nsi_edp", "fiscal_council_bg", "api_road_charges"],
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
      bg: "аукциони на ДЦК, месечни ПЧИ",
      en: "ДЦК auctions, monthly FDI",
    },
    desc: {
      bg: "Резултатите от аукционите за държавни ценни книжа (вътрешният държавен дълг и доходността по емисиите) и месечните потоци на преките чуждестранни инвестиции по платежния баланс (РПБ6) — общо, дялов капитал, реинвестирана печалба и дългови инструменти.",
      en: "Government securities auction results (domestic sovereign debt issuance and yields) and monthly foreign-direct-investment flows from the balance of payments (BPM6) — total, equity, reinvested earnings and debt instruments.",
    },
    url: "https://www.bnb.bg/Statistics/StExternalSector/index.htm",
    origin: "state",
    members: ["bnb_auctions", "bnb_fdi"],
    skills: ["update-macro"],
    tags: ["fiscal", "indicators"],
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
    id: "oil_bulletin",
    label: { bg: "ЕК — Седмичен нефтен бюлетин", en: "EC Weekly Oil Bulletin" },
    detail: {
      bg: "цени на горивата BG спрямо ЕС",
      en: "BG vs EU fuel prices",
    },
    desc: {
      bg: "Консолидираната история на потребителските цени на горивата (бензин А95 и дизел, с ДДС) — България спрямо средното за ЕС, седмично от 2005 г. Захранва тайла „Горива“ в изгледа „Потребление“.",
      en: "The consolidated history of consumer fuel prices (petrol 95 & diesel, incl. VAT) — Bulgaria vs the EU average, weekly since 2005. Powers the Fuel tile in the Consumption view.",
    },
    url: "https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en",
    origin: "eu",
    members: ["ec_oil_bulletin"],
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
    id: "vss",
    label: { bg: "ВСС · съдебна статистика", en: "ВСС · court statistics" },
    detail: {
      bg: "движение на делата и натовареност",
      en: "case movement and workload",
    },
    desc: {
      bg: "Годишните „Обобщени статистически таблици за дейността на съдилищата“ на Висшия съдебен съвет — постъпили, свършени и висящи дела, срокове и натовареност на съдиите, по съдебен ред (Приложение № 1) и по конкретен съд за картата на натовареността (Приложение № 2). Публикуват се само като PDF. Плюс регистъра на имуществените декларации на магистратите и списъците на ИВСС за неизрядни декларации, както и декларираните от магистрати дружества (целият състав, кръстосан с поръчките и с политици през общи управители). Забележка: регистърът на ИВСС се публикува на гол IP адрес по нешифрован HTTP (без TLS), затова обхождането му се прави от доверена мрежа и всяка промяна в имената се преглежда ръчно преди публикуване.",
      en: "The Supreme Judicial Council's annual summary statistical tables on the activity of the courts — cases filed, resolved and pending, delays and judges' workload, by court tier (Приложение № 1) and by individual court for the per-court workload map (Приложение № 2). Published as PDFs only. Plus the magistrates' asset-declaration register and the Inspectorate's non-compliance lists, and the companies magistrates declare (the full roster, cross-linked to procurement and — through shared officers — to politicians). Note: the Inspectorate's register is served from a bare IP over unencrypted HTTP (no TLS), so the crawl is run from a trusted network and every change to the named individuals is reviewed by hand before publication.",
    },
    url: "https://vss.justice.bg/page/view/1082",
    origin: "state",
    members: ["vss_court_statistics", "ivss_declarations"],
    skills: ["update-judiciary"],
    tags: ["fiscal"],
  },
  {
    id: "defense",
    label: { bg: "НАТО · МО · МИ · отбрана", en: "NATO · МО · МИ · defense" },
    detail: {
      bg: "разходи, износ, готовност",
      en: "spending, exports, readiness",
    },
    desc: {
      bg: "Данни за отбраната от три източника: годишният доклад на НАТО „Defence Expenditure of NATO Countries“ (дял от БВП и разпределението техника/личен състав), годишният доклад на Министерството на икономиката за износа на отбранителна продукция, и докладът за състоянието на отбраната на МО (готовност, личен състав). Публикуват се само като PDF; поддържат се като малки .json файлове в data/defense/. Придобиването на F-16/Stryker е по US FMS и не е в регистъра на поръчките.",
      en: "Defence data from three sources: NATO's annual Defence Expenditure of NATO Countries (share of GDP and the equipment/personnel split), the Ministry of Economy's annual arms-export control report, and the МО state-of-defence report (readiness, personnel). Published as PDFs only; maintained as small .json files under data/defense/. F-16/Stryker acquisition is via US FMS and not in the procurement register.",
    },
    url: "https://www.nato.int/cps/en/natohq/news_216897.htm",
    origin: "state",
    members: ["nato_defexp", "mod_defense_report", "moe_arms_exports"],
    skills: ["update-defense"],
    tags: ["fiscal", "indicators"],
  },
  {
    id: "energy",
    label: { bg: "Ember · Eurostat · GEM · енергетика", en: "Ember · Eurostat · GEM · energy" }, // prettier-ignore
    detail: {
      bg: "производство, цени, централи",
      en: "generation, prices, plants",
    },
    desc: {
      bg: "Физическата картина на енергетиката до парите: производственият микс на тока (ядрена, въглища, ВЕИ), нетният износ и въглеродният интензитет от Ember (Yearly Electricity Data, CC BY 4.0), цената на тока за домакинствата спрямо ЕС от Eurostat (nrg_pc_204), и регистър на електроцентралите (мощност и собственост) — куриран от Global Energy Monitor. Поддържат се като .json в data/energy/. Обществените поръчки на групата на БЕХ идват от корпуса на договорите, не оттук.",
      en: "The physical picture of energy beside the money: the electricity generation mix (nuclear, coal, renewables), net exports and carbon intensity from Ember (Yearly Electricity Data, CC BY 4.0), the household electricity price vs the EU from Eurostat (nrg_pc_204), and a power-plant registry (capacity and ownership) curated from Global Energy Monitor. Maintained as .json under data/energy/. The БЕХ group's procurement comes from the contracts corpus, not here.",
    },
    url: "https://ember-energy.org/data/",
    origin: "intl",
    members: ["ember_generation", "eurostat_energy_prices"],
    skills: ["update-energy"],
    tags: ["indicators", "prices"],
  },
  {
    id: "security",
    label: { bg: "Eurostat · МВР · пътна безопасност", en: "Eurostat · МВР · road safety" }, // prettier-ignore
    detail: {
      bg: "жертви на пътя (изход)",
      en: "road deaths (outcome)",
    },
    desc: {
      bg: "Изходният слой до парите на МВР: националните жертви на пътя по години от Eurostat (sdg_11_40) — изходът, който Пътна полиция (КАТ) и покупката на патрулни автомобили трябва да подобрят (708 връх 2015 → 478 през 2024, −32%). Поддържа се като малък .json в data/security/. Обществените поръчки на групата на МВР (~75 структури, ~€1.9 млрд.) идват от корпуса на договорите, не оттук; разсейката разход-срещу-престъпност преизползва data/regional.json.",
      en: "The outcome layer beside МВР's money: national road-traffic deaths by year from Eurostat (sdg_11_40) — the outcome the traffic police (КАТ) and patrol-car procurement are meant to improve (708 peak 2015 → 478 in 2024, −32%). Maintained as a small .json under data/security/. The МВР group's procurement (~75 units, ~€1.9bn) comes from the contracts corpus, not here; the spend-vs-crime scatter reuses data/regional.json.",
    },
    url: "https://ec.europa.eu/eurostat/databrowser/view/sdg_11_40/default/table",
    origin: "intl",
    members: ["eurostat_road_safety"],
    skills: [],
    tags: ["indicators"],
  },
  {
    id: "transport",
    label: { bg: "Eurostat · железници · субсидия", en: "Eurostat · rail · subsidy" }, // prettier-ignore
    detail: {
      bg: "жп пътници (знаменател)",
      en: "rail passengers (denominator)",
    },
    desc: {
      bg: "Данните за железопътната субсидия до парите на транспорта: жп пътниците от Eurostat (rail_pa_total) — знаменателят на „субсидия на пътник“ — сдвоени с държавната субсидия за БДЖ/НКЖИ от Закона за държавния бюджет (data/transport/). Субсидията се парсва от вече кешираните ЗДБ HTML файлове (rides the budget_law watcher). Обществените поръчки на транспортната група идват от корпуса на договорите, не оттук.",
      en: "The rail-subsidy data beside the transport money: rail passengers from Eurostat (rail_pa_total) — the denominator of 'subsidy per passenger' — paired with the state subsidy to БДЖ/НКЖИ from the State Budget Law (data/transport/). The subsidy is parsed from the already-cached ЗДБ HTML (rides the budget_law watcher). The transport group's procurement comes from the contracts corpus, not here.",
    },
    url: "https://ec.europa.eu/eurostat/databrowser/view/rail_pa_total/default/table",
    origin: "intl",
    members: ["eurostat_rail"],
    skills: [],
    tags: ["indicators"],
  },
  {
    id: "administration",
    label: { bg: "ИИСДА · Eurostat · администрация", en: "IISDA · Eurostat · administration" }, // prettier-ignore
    detail: {
      bg: "щат, услуги, е-управление",
      en: "workforce, services, e-gov",
    },
    desc: {
      bg: "Държавната администрация като институция: административните услуги от Административния регистър (ИИСДА, ~2 668 услуги), използването на електронно управление спрямо ЕС от Eurostat (isoc_ciegi_ac), дигиталните умения на гражданите (isoc_sk_dskl_i21) и показателите за административно обслужване от годишния Доклад за състоянието на администрацията. Численост, структури и разход идват от Доклада (personnel.json) и COFOG.",
      en: "The state administration as an institution: the administrative-services register (IISDA, ~2,668 services), e-government use vs the EU from Eurostat (isoc_ciegi_ac), citizen digital skills (isoc_sk_dskl_i21), and the service-quality metrics from the annual Report on the State of the Administration. Headcount, structures and cost come from the Report (personnel.json) and COFOG.",
    },
    url: "https://iisda.government.bg/",
    origin: "state",
    members: ["iisda_services", "eurostat_egov", "eurostat_digital_skills"],
    skills: ["update-administration"],
    tags: ["fiscal", "indicators"],
  },
  {
    id: "social",
    label: { bg: "АСП · МТСП · Eurostat", en: "АСП · МТСП · Eurostat" },
    detail: {
      bg: "помощи, бюджет по вид, бедност",
      en: "benefits, budget by type, poverty",
    },
    desc: {
      bg: "Социалното подпомагане: помощите, които Агенцията за социално подпомагане (АСП) плаща на домакинствата — детски надбавки, помощи за хора с увреждания, целева помощ за отопление, ГМД (национално/годишно, от годишния отчет на АСП), бюджетът на МТСП по вид помощ (Закон за държавния бюджет) и ефектът на трансферите върху бедността спрямо ЕС (Eurostat ilc_li10/ilc_li02). Пенсиите (НОИ) са отделен източник.",
      en: "Social assistance: the benefits the Agency for Social Assistance (АСП) pays households — child allowances, disability support, targeted heating aid, guaranteed minimum income (national/annual, from the АСП annual report), the МТСП budget by benefit type (State Budget Law), and the poverty-reduction effect of transfers vs the EU (Eurostat ilc_li10/ilc_li02). Pensions (НОИ) are a separate source.",
    },
    url: "https://asp.government.bg/",
    origin: "state",
    members: ["asp_benefits", "git_inspections"],
    skills: ["update-social"],
    tags: ["fiscal", "indicators"],
  },
  {
    id: "culture",
    label: { bg: "НФЦ · филмови субсидии", en: "НФЦ · film subsidies" },
    detail: {
      bg: "държавно финансиране на кино",
      en: "state film financing",
    },
    desc: {
      bg: "Единният публичен регистър на финансираните филми и сериали на Изпълнителна агенция „Национален филмов център“ — държавната субсидия за игрално, документално и анимационно кино по проект и продуцент, 2014–2025. Публикува се като .xls файлове по година; сумите са в лева, конвертирани в евро по фиксирания курс.",
      en: "The National Film Center's public register of financed films and series — the state subsidy for feature, documentary and animation film by project and producer, 2014–2025. Published as per-year .xls files; amounts are in leva, converted to euro at the fixed rate.",
    },
    url: "https://www.nfc.bg/статистика-публичен-регистър/единен-публичен-регистър/",
    origin: "state",
    members: ["nfc_film_register", "ncf_grant_results", "nfc_commissions"],
    skills: ["update-culture"],
    tags: ["fiscal"],
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
    id: "water",
    label: { bg: "Води (ВиК)", en: "Water (ВиК)" },
    detail: { bg: "поръчки на ВиК сектора", en: "water-sector procurement" },
    desc: {
      bg: "Консолидираните обществени поръчки на групата на Български ВиК холдинг (по дружества и по функция) и договорите за почистване на речни корита (по възложител, по години, най-големи), от АОП/ЦАИС ЕОП.",
      en: "The Bulgarian Water Holding group's consolidated public procurement (by operator and by function) and the riverbed-cleaning contracts (by awarder, by year, largest), from the АОП/ЦАИС ЕОП register.",
    },
    path: "data/water/",
    tags: ["fiscal"],
  },
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
      bg: "Резултати за кметове и общински съвети от всички редовни цикли от 2007 г. насам плюс частичните и нови избори между тях. Данни по избирателни секции (за кмет и за съвет) захранват картите на секциите.",
      en: "Mayor and council results from every regular cycle since 2007 plus the partial and new elections in between. Per-polling-station data (both the mayor and council ballots) powers the section maps.",
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
      bg: "Всички договори от АОП (OCDS емисията) плюс попълване от ЦАИС ЕОП за малките възложители, които АОП пропуска — по месеци, изпълнители и възложители, с локализация до населено място и кръстосване с фирмите, свързани с депутати и длъжностни лица.",
      en: "Every procurement contract from АОП (the OCDS feed) plus a ЦАИС ЕОП gap-fill for the small contracting authorities АОП omits — by month, contractor and awarder, localised to settlement level and cross-referenced against companies tied to MPs and public officials.",
    },
    path: "data/procurement/",
    tags: ["fiscal"],
  },
  {
    id: "ngo",
    label: {
      bg: "Организации с нестопанска цел",
      en: "Non-profit organisations",
    },
    detail: {
      bg: "ЮЛНЦ, управителни органи, публично и външно финансиране",
      en: "NPOs, governing bodies, public and external funding",
    },
    desc: {
      bg: "Регистърът на юридическите лица с нестопанска цел (сдружения, фондации, читалища) от общата база на Търговския регистър — управителни съвети, представляващи и настоятелства, цели и статут за обществена полза, гражданство на членовете, плюс полученото публично и външно финансиране (държавни субсидии, пряко управлявани средства от ЕС). Само в базата данни — сървира се от Postgres, без статични JSON файлове.",
      en: "The register of non-profit legal entities (associations, foundations, community centres) from the shared Commerce Registry database — management boards, representatives and boards of trustees, objectives and public-benefit status, member nationality, plus the public and external funding received (state subsidies, directly-managed EU funds). Database-only — served live from Postgres, no static JSON.",
    },
    path: "raw_data/tr/state.sqlite",
    tags: ["fiscal", "parliament"],
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
    id: "agri",
    label: { bg: "Земеделски субсидии", en: "Farm subsidies" },
    detail: {
      bg: "кой получава земеделските пари",
      en: "who receives farm money",
    },
    desc: {
      bg: "Изплатените субсидии от ДФ „Земеделие“ по бенефициент, схема и област — с концентрация, топ получатели и връзка към поръчки и еврофондове по ЕИК. Съхранява се директно в Postgres (agri_subsidies, agri_payloads).",
      en: "Subsidies paid by the State Fund Agriculture by beneficiary, scheme and region — with concentration, top recipients and an EIK link to procurement and EU funds. Stored directly in Postgres (agri_subsidies, agri_payloads).",
    },
    tags: ["fiscal"],
  },
  {
    id: "judiciary",
    label: { bg: "Съдебна власт", en: "The judiciary" },
    detail: {
      bg: "дела, срокове, натовареност",
      en: "caseload, delays, workload",
    },
    desc: {
      bg: "Движението на делата в българските съдилища от 2018 г. насам — постъпили, свършени и висящи дела, дял решени в 3-месечния срок, брой съдии и двата официални показателя за натовареност (по щат и действителна), по съдебен ред и по конкретен съд (геокодирана карта на натовареността). Плюс регистъра на имуществените декларации на целия магистратски състав и декларираните от тях дружества, които се кръстосват с обществените поръчки и — през общи управители/съдружници — с политици.",
      en: "The movement of cases through Bulgaria's courts since 2018 — filed, resolved and pending, the share closed inside the three-month deadline, judge posts and both official workload measures (per post and actual), by court tier and by individual court (a geocoded workload map). Plus the full magistrate roster's asset-declaration index and the companies they declare, cross-linked to public procurement and — through shared officers — to politicians.",
    },
    path: "data/judiciary/",
    tags: ["fiscal"],
  },
  {
    id: "defense",
    label: { bg: "Отбрана", en: "Defense" },
    detail: {
      bg: "разходи, износ, готовност",
      en: "spending, exports, readiness",
    },
    desc: {
      bg: "Разходите на България за отбрана като дял от БВП (пътят към целта от 5%), разпределението техника срещу личен състав, големите програми (F-16, Stryker, патрулни кораби), рекордният износ на оръжие след 2022 г. и готовността на армията.",
      en: "Bulgaria's defence spending as a share of GDP (the road to the 5% target), the equipment-vs-personnel split, the flagship programs (F-16, Stryker, patrol ships), the record post-2022 arms exports and force readiness.",
    },
    path: "data/defense/",
    tags: ["fiscal", "indicators"],
  },
  {
    id: "energy",
    label: { bg: "Енергетика", en: "Energy" },
    detail: {
      bg: "производство, цени, централи",
      en: "generation, prices, plants",
    },
    desc: {
      bg: "Производственият микс на тока (ядрена, въглища, ВЕИ), нетният износ и въглеродният интензитет от Ember, цената на тока за домакинствата спрямо ЕС от Eurostat, и регистър на електроцентралите (мощност и собственост) от Global Energy Monitor. Поръчките на държавната енергийна група (БЕХ) идват от корпуса на договорите.",
      en: "The electricity generation mix (nuclear, coal, renewables), net exports and carbon intensity from Ember, the household electricity price vs the EU from Eurostat, and a power-plant registry (capacity and ownership) from Global Energy Monitor. The state energy group's (БЕХ) procurement comes from the contracts corpus.",
    },
    path: "data/energy/",
    tags: ["indicators", "prices"],
  },
  {
    id: "security",
    label: { bg: "Сигурност / МВР", en: "Security / МВР" },
    detail: {
      bg: "жертви на пътя (изход)",
      en: "road deaths (outcome)",
    },
    desc: {
      bg: "Изходният слой до парите на МВР: националните жертви на пътя по години от Eurostat (708 връх 2015 → 478 през 2024), сдвоени с покупката на патрулни автомобили от МВР. Обществените поръчки на групата на МВР (~75 структури, ~€1.9 млрд.) идват от корпуса на договорите; разсейката разход-срещу-престъпност преизползва data/regional.json.",
      en: "The outcome layer beside МВР's money: national road-traffic deaths by year from Eurostat (708 peak 2015 → 478 in 2024), paired with МВР patrol-car procurement. The МВР group's procurement (~75 units, ~€1.9bn) comes from the contracts corpus; the spend-vs-crime scatter reuses data/regional.json.",
    },
    path: "data/security/",
    tags: ["indicators"],
  },
  {
    id: "transport",
    label: { bg: "Транспорт", en: "Transport" },
    detail: {
      bg: "жп субсидия и пътници",
      en: "rail subsidy & passengers",
    },
    desc: {
      bg: "Данните до парите на транспорта: държавната субсидия за железниците (БДЖ PSO + НКЖИ) от Закона за държавния бюджет и жп пътниците от Eurostat, за плочката „субсидия на пътник“ на /sector/transport. Обществените поръчки на групата (~€5.9 млрд., 11 структури) идват от корпуса на договорите; пътната инфраструктура (АПИ) е отделен сектор.",
      en: "The data beside the transport money: the state rail subsidy (БДЖ PSO + НКЖИ) from the State Budget Law and rail passengers from Eurostat, for the 'subsidy per passenger' tile on /sector/transport. The group's procurement (~€5.9bn, 11 entities) comes from the contracts corpus; road infrastructure (АПИ) is a separate sector.",
    },
    path: "data/transport/",
    tags: ["indicators"],
  },
  {
    id: "administration",
    label: { bg: "Държавна администрация", en: "State administration" },
    detail: {
      bg: "щат, разход, услуги, е-управление",
      en: "workforce, cost, services, e-gov",
    },
    desc: {
      bg: "Административните услуги (ИИСДА, ~2 668), използването на е-управление спрямо ЕС (Eurostat), качеството на административното обслужване (сигнали, измерване на удовлетвореността — от годишния Доклад), плюс сгънатия page-context (щат, структури, разход, население). Поръчките за е-управление (МЕУ + ИА ИЕУ + ДАЕУ) идват от корпуса на договорите.",
      en: "The administrative-services register (IISDA, ~2,668), e-government use vs the EU (Eurostat), service quality (signals, satisfaction-measurement — from the annual Report), plus the folded page-context (workforce, structures, cost, population). e-government procurement (МЕУ + ИА ИЕУ + ДАЕУ) comes from the contracts corpus.",
    },
    path: "data/administration/",
    tags: ["fiscal", "indicators"],
  },
  {
    id: "social",
    label: { bg: "Социално подпомагане", en: "Social assistance" },
    detail: {
      bg: "помощи, бюджет по вид, бедност",
      en: "benefits, budget by type, poverty",
    },
    desc: {
      bg: "Помощите на АСП по вид (детски надбавки, увреждания, отопление, ГМД — национално/годишно) и ефектът на социалните трансфери върху бедността спрямо ЕС (Eurostat ilc_li10/ilc_li02). Бюджетът на МТСП по вид помощ идва от бюджетното дърво; поръчките на групата — от корпуса на договорите. Пенсиите (НОИ) са отделен изглед.",
      en: "АСП benefits by type (child allowances, disability, heating aid, GMI — national/annual) and the poverty-reduction effect of social transfers vs the EU (Eurostat ilc_li10/ilc_li02). The МТСП budget by benefit type comes from the budget tree; the group's procurement from the contracts corpus. Pensions (НОИ) are a separate view.",
    },
    path: "data/social/",
    tags: ["fiscal", "indicators"],
  },
  {
    id: "culture",
    label: { bg: "Култура", en: "Culture" },
    detail: {
      bg: "филмови субсидии, продуценти",
      en: "film subsidies, producers",
    },
    desc: {
      bg: "Държавната субсидия на Националния филмов център за кино (2014–2025) — по вид (игрално, документално, анимационно), по продуцент и по година, с концентрацията на средствата у най-финансираните продуценти. Плюс успеваемостта на грантовете на НФК, културните институти по области, съставите на националните художествени комисии (кой решава за филмовите пари), и общинската и читалищна култура (Столична програма „Култура“ по направления и националната субсидия за читалища).",
      en: "The National Film Center's state subsidy for film (2014–2025) — by discipline (feature, documentary, animation), by producer and by year, with the concentration of money among the most-funded producers. Plus НФК grant success rates, the state cultural institutes by oblast, the national artistic-commission compositions (who decides the film money), and municipal & community-centre culture (Sofia's „Култура“ programme by direction and the national читалища subsidy).",
    },
    path: "data/culture/",
    tags: ["fiscal"],
  },
  {
    id: "pensions",
    label: { bg: "Пенсии (НОИ)", en: "Pensions (NSSI)" },
    detail: {
      bg: "разпределение, области, вноски",
      en: "distribution, oblasts, contributions",
    },
    desc: {
      bg: "Пенсионната система на България от статистическия годишник на НОИ — средна пенсия и плащания в брой по области, разпределението на пенсионерите по размер на пенсията (минимум и таван), и националните редове заплата–осигурителен доход–пенсия, плюс кой плаща разходите на ДОО (вноски срещу трансфер от бюджета). Включва и частните пенсионни фондове (стълбове 2 и 3) от КФН — нетни активи и осигурени лица по фонд.",
      en: "Bulgaria's pension system from the NSSI statistical yearbook — average pension and cash payments by oblast, the distribution of pensioners by pension size (minimum and cap), and the national wage–insurable-income–pension series, plus who pays for ДОО (contributions vs the state-budget transfer). Also the private pension funds (pillars 2 & 3) from КФН — net assets and insured persons per fund.",
    },
    path: "data/budget/noi/pensions.json",
    tags: ["fiscal"],
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
    id: "macro_fdi",
    label: {
      bg: "Месечни ПЧИ (БНБ)",
      en: "Monthly FDI (BNB)",
    },
    detail: {
      bg: "поток на инвестициите по компоненти",
      en: "investment flow by component",
    },
    desc: {
      bg: "Месечните потоци на преките чуждестранни инвестиции в България по платежния баланс (РПБ6) от 2010 г. насам — общо, дялов капитал, реинвестирана печалба и дългови инструменти, плюс натрупването от началото на годината спрямо същия период на предходната.",
      en: "Monthly foreign-direct-investment flows into Bulgaria from the balance of payments (BPM6) since 2010 — total, equity, reinvested earnings and debt instruments, plus the year-to-date cumulative versus the same period a year earlier.",
    },
    path: "data/macro_fdi.json",
    tags: ["indicators", "fiscal"],
  },
  {
    id: "indicators",
    label: { bg: "Регионални индикатори", en: "Regional indicators" },
    detail: {
      bg: "безработица, ДЗИ/НВО по училища, регионално развитие",
      en: "unemployment, per-school ДЗИ/НВО, regional growth",
    },
    desc: {
      bg: "Годишните под-национални индикатори — безработица и матури по общини, БВП на човек, миграция и инвестиции по области. Включва и per-училище разрез (/education + картоните /school): успех на ДЗИ, постижение спрямо социалната среда (индекс от Преброяване 2021) и добавена стойност 7→12 клас спрямо входното ниво по НВО, плюс концентрацията на пазара на учебници (по обществени поръчки, CPV 22112).",
      en: "Annual sub-national indicators — unemployment and matura scores by municipality, GDP per capita, migration and investment by region. Also a per-school layer (/education + the /school report cards): ДЗИ results, performance versus the community's socioeconomic context (a Census-2021 index) and 7→12 value-added against the 7th-grade НВО intake, plus textbook-market concentration (from procurement, CPV 22112).",
    },
    path: "data/schools/index.json",
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
      bg: "кошница + каталог по населени места и вериги",
      en: "basket + catalogue by settlement and chain",
    },
    desc: {
      bg: "Потребителската кошница от въвеждането на еврото — мин/средна/макс цена по населено място и продукт, индекси по категории, сравнение между веригите и каталог от ~118 000 продукта с история на цените. Съхранява се директно в Postgres (price_facts, price_products, price_payloads), без статичен JSON.",
      en: "The consumer basket since euro adoption — min/average/max prices by settlement and product, category indices, chain comparison and a ~118,000-product catalogue with price history. Stored directly in Postgres (price_facts, price_products, price_payloads); no static JSON.",
    },
    // No `path`: Postgres-only, like ds:agri. Served live via /api/db/price-*.
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
    id: "water",
    label: { bg: "Води (ВиК)", en: "Water (ВиК)" },
    detail: { bg: "поръчки на водния сектор", en: "water-sector procurement" },
    desc: {
      bg: "Кой купува във водния сектор — консолидираните поръчки на Български ВиК холдинг и дружествата му, какво купуват по функция, и парите за почистване на речни корита.",
      en: "Who buys in the water sector — the Bulgarian Water Holding group's consolidated procurement, what they buy by function, and the money spent cleaning riverbeds.",
    },
    route: "/water",
    tags: ["fiscal"],
  },
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
    id: "ngo",
    label: {
      bg: "Организации с нестопанска цел",
      en: "Non-profit organisations",
    },
    detail: {
      bg: "НПО, управителни органи, конфликт на интереси",
      en: "NPOs, governing bodies, conflicts of interest",
    },
    desc: {
      bg: "Профилите на сдруженията, фондациите и читалищата — управителни органи, публично и външно финансиране, и сигнали за конфликт на интереси, когато член на властта е в управата на НПО, което печели обществени поръчки или субсидии.",
      en: "Profiles of associations, foundations and community centres — governing bodies, public and external funding, and conflict-of-interest flags when a person in power sits on the board of an NGO that wins public contracts or subsidies.",
    },
    route: "/procurement/ngos",
    tags: ["fiscal", "parliament"],
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
    id: "agri",
    label: { bg: "Земеделски субсидии", en: "Farm subsidies" },
    detail: {
      bg: "кой получава земеделските пари",
      en: "who receives farm money",
    },
    desc: {
      bg: "Националната картина на земеделските субсидии — колко се плаща, колко е концентрирано, по схема и област, плюс профил на всеки получател до връзка с поръчки и еврофондове.",
      en: "The national picture of farm subsidies — how much is paid, how concentrated, by scheme and region, plus a per-recipient profile linking through to procurement and EU funds.",
    },
    route: "/subsidies",
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
    id: "judiciary",
    label: { bg: "Съдебна власт", en: "The judiciary" },
    detail: {
      bg: "дела, срокове и натовареност",
      en: "caseload, delays and workload",
    },
    desc: {
      bg: "Колко дела влизат в съдилищата, колко излизат и колко остават висящи — плюс натовареността на всеки съд върху карта, разхода за свършено дело, бюджета на съдебната власт по органи и декларираните от магистрати дружества.",
      en: "How many cases enter the courts, how many leave, and how many stay pending — plus each court's workload on a map, the cost per resolved case, the judiciary's budget by spending body, and the companies magistrates declare.",
    },
    route: "/judiciary",
    tags: ["fiscal"],
  },
  {
    id: "defense",
    label: { bg: "Отбрана", en: "Defense" },
    detail: {
      bg: "пътят към 5%, програми, износ",
      en: "the road to 5%, programs, exports",
    },
    desc: {
      bg: "Разходите за отбрана като дял от БВП спрямо целите на НАТО, техника срещу заплати, големите програми (F-16, Stryker), износът на оръжие и готовността — плюс поръчките на 25-те структури на МО.",
      en: "Defence spending as a share of GDP against the NATO targets, equipment vs personnel, the flagship programs (F-16, Stryker), arms exports and readiness — plus the procurement of the 25 МО units.",
    },
    route: "/defense",
    tags: ["fiscal", "indicators"],
  },
  {
    id: "energy",
    label: { bg: "Енергетика", en: "Energy" },
    detail: {
      bg: "парите и физическата система",
      en: "the money and the physical system",
    },
    desc: {
      bg: "Обществените поръчки на държавната енергийна група (БЕХ, ~9 млрд. €), невидимата инвестиция в Козлодуй 7/8 (~14 млрд.), единственият участник, производственият микс на тока, регистърът на електроцентралите (мощност и собственост) и цената за домакинствата спрямо ЕС.",
      en: "The procurement of the state energy group (БЕХ, ~€9bn), the invisible Kozloduy 7/8 investment (~€14bn), single-bid share, the electricity generation mix, the power-plant fleet (capacity and ownership) and the household electricity price vs the EU.",
    },
    route: "/sector/energy",
    tags: ["fiscal", "indicators"],
  },
  {
    id: "administration",
    label: { bg: "Държавна администрация", en: "State administration" },
    detail: {
      bg: "колко голяма, колко струва, колко цифрова",
      en: "how big, what it costs, how digital",
    },
    desc: {
      bg: "Държавната администрация като институция — щатна численост и структури по тип (годишният Доклад за състоянието на администрацията), разходът за персонал на щат, разминаването администрация–население, и парите за електронно управление (обществените поръчки на групата МЕУ + ИА ИЕУ + ДАЕУ).",
      en: "The state administration as an institution — positions and structures by type (the annual Report on the State of the Administration), personnel cost per FTE, the administration-vs-population divergence, and the e-government money (procurement by the МЕУ + ИА ИЕУ + ДАЕУ group).",
    },
    route: "/sector/administration",
    tags: ["fiscal", "indicators"],
  },
  {
    id: "regional",
    label: { bg: "Регионално развитие", en: "Regional development" },
    detail: {
      bg: "къде отиват парите за регионите",
      en: "where the money for the regions goes",
    },
    desc: {
      bg: "МРРБ е министерство-разпределител: управлява ~1,06 млрд. €/год., но през собствени поръчки минават само ~100 млн. — останалото са трансфери към общините и европейско съфинансиране. Усвояването на ОПРР и „Развитие на регионите“, кохезията по области, разходът спрямо ЕС (COFOG GF06), кадастърът (АГКК) и стигат ли парите до най-бедните области. Пътищата (АПИ) и ВиК са отделни сектори.",
      en: "МРРБ is a pass-through ministry: it directs ~€1.06bn/yr but only ~€100M flows through its own procurement — the rest is transfers to municipalities and EU co-financing. ОПРР and „Развитие на регионите“ absorption, cohesion by oblast, spending vs the EU (COFOG GF06), the cadastre (АГКК) and whether the money reaches the poorest oblasts. Roads (АПИ) and water (ВиК) are separate sectors.",
    },
    route: "/sector/regional",
    tags: ["fiscal", "indicators"],
  },
  {
    id: "social",
    label: { bg: "Социално подпомагане", en: "Social assistance" },
    detail: {
      bg: "къде отиват парите и какво постигат",
      en: "where the money goes and what it achieves",
    },
    desc: {
      bg: "Социалната защита е ~37% от разхода на държавата. /sector/social показва бюджета на МТСП по вид помощ (разходът за хора с увреждания се утрои), помощите на АСП към домакинствата (отопление, детски, ГМД), ефекта на трансферите върху бедността спрямо ЕС и обществените поръчки на групата. Пенсиите (НОИ) са отделен изглед.",
      en: "Social protection is ~37% of state spending. /sector/social shows the МТСП budget by benefit type (disability spending tripled), the benefits АСП pays households (heating, child, GMI), the poverty-reduction effect of transfers vs the EU, and the group's procurement. Pensions (НОИ) are a separate view.",
    },
    route: "/sector/social",
    tags: ["fiscal", "indicators"],
  },
  {
    id: "culture",
    label: { bg: "Култура", en: "Culture" },
    detail: {
      bg: "кой получава парите за кино",
      en: "who gets the film money",
    },
    desc: {
      bg: "Къде отиват държавните пари за кино — субсидиите на Националния филмов център по вид, по продуцент и по година, и колко се концентрират у най-финансираните.",
      en: "Where the state's film money goes — the National Film Center's subsidies by discipline, producer and year, and how concentrated they are among the most-funded.",
    },
    route: "/culture",
    tags: ["fiscal"],
  },
  {
    id: "pensions",
    label: { bg: "Пенсии", en: "Pensions" },
    detail: {
      bg: "кой плаща, разпределение, области",
      en: "who pays, distribution, oblasts",
    },
    desc: {
      bg: "Кой плаща пенсиите (вноски срещу трансфер от бюджета), как са разпределени по размер, средна пенсия и плащания в брой по области, и връзката заплата–пенсия през годините.",
      en: "Who pays for pensions (contributions vs the state-budget transfer), how they are distributed by size, average pension and cash payment by oblast, and the wage-to-pension link over time.",
    },
    route: "/pensions",
    tags: ["fiscal"],
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
    id: "products",
    label: { bg: "Каталог на продуктите", en: "Product catalogue" },
    detail: {
      bg: "търси и сравни всеки продукт",
      en: "search and compare any product",
    },
    desc: {
      bg: "Каталог от ~118 000 продукта, извлечени от имената във фийда на КЗП — търсене, цена по вериги и история на цената от еврото за всеки продукт.",
      en: "A ~118,000-product catalogue derived from the CPC feed's product names — search, per-chain price, and since-euro price history for every product.",
    },
    route: "/consumption/products",
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
  ["src:vss", "ds:judiciary"],
  ["src:dv", "ds:judiciary"],
  ["ds:judiciary", "f:judiciary"],
  ["src:defense", "ds:defense"],
  ["ds:defense", "f:defense"],
  // The /defense feature also consumes the budget (МО budget bridge) and macro
  // (peer %GDP/per-capita) datasets — cross-dataset edges, like judiciary↔budget.
  ["ds:budget", "f:defense"],
  ["ds:macro", "f:defense"],
  ["src:security", "ds:security"],
  ["src:transport", "ds:transport"],
  ["src:energy", "ds:energy"],
  ["ds:energy", "f:energy"],
  // /sector/energy leads with the БЕХ procurement pack (the €8.96bn group), which
  // renders off the contracts corpus — a cross-dataset edge like defense↔budget.
  ["ds:procurement", "f:energy"],
  // /sector/administration leads with the institution (headcount/structures/cost
  // from the budget-personnel dataset + macro for the population/GDP context) and
  // folds the e-gov procurement group below — three cross-dataset edges. Its own
  // dataset (services register + e-gov + service quality) rides src→ds→f.
  ["src:administration", "ds:administration"],
  ["ds:administration", "f:administration"],
  ["ds:budget", "f:administration"],
  ["ds:macro", "f:administration"],
  ["ds:procurement", "f:administration"],
  // /sector/social leads with the disbursement iceberg + poverty outcome: its own
  // dataset (АСП benefits + Eurostat poverty) rides src→ds→f, and it folds the МТСП
  // budget-by-benefit (budget), the €15bn COFOG split + AROPE (macro) and the 6-EIK
  // procurement group (procurement) — cross-dataset edges, like administration.
  ["src:social", "ds:social"],
  ["ds:social", "f:social"],
  ["ds:budget", "f:social"],
  ["ds:macro", "f:social"],
  ["ds:procurement", "f:social"],
  // /sector/regional (МРРБ) reuses only EXISTING datasets — no new data/ tree. The
  // cohesion spine is funds (ИСУН OPs + per-oblast muni-map), the budget node is
  // budget, COFOG GF06 is macro, the NUTS3 GDP/capita for the convergence scatter is
  // indicators (⚠ NOT a ds:regional — regional NUTS3 lives in ds:indicators), and the
  // group procurement is procurement.
  ["ds:funds", "f:regional"],
  ["ds:budget", "f:regional"],
  ["ds:macro", "f:regional"],
  ["ds:indicators", "f:regional"],
  ["ds:procurement", "f:regional"],
  ["src:water", "ds:water"],
  ["src:egov", "ds:water"],
  ["ds:water", "f:water"],
  ["src:culture", "ds:culture"],
  ["ds:culture", "f:culture"],
  ["src:ministries", "ds:pensions"],
  ["ds:pensions", "f:pensions"],
  ["ds:budget", "f:judiciary"],
  ["src:egov", "ds:budget"],
  ["src:egov", "ds:indicators"],
  ["src:egov", "ds:localgov"],
  ["src:eop", "ds:procurement"],
  ["src:aop", "ds:procurement"],
  ["src:kzk", "ds:procurement"],
  ["src:isun", "ds:funds"],
  ["src:dfz", "ds:agri"],
  ["src:egov", "ds:ngo"],
  ["src:ec_fts", "ds:ngo"],
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
  ["src:bnb", "ds:macro_fdi"],
  ["src:kzp", "ds:prices"],
  ["src:oil_bulletin", "ds:prices"],
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
  ["ds:ngo", "f:ngo"],
  ["ds:ngo", "f:procurement"],
  ["ds:ngo", "f:mps"],
  ["ds:funds", "f:funds"],
  ["ds:funds", "f:mps"],
  ["ds:funds", "f:governance"],
  ["ds:agri", "f:agri"],
  ["ds:agri", "f:mps"],
  ["ds:budget", "f:budget"],
  ["ds:budget", "f:governance"],
  ["ds:macro", "f:budget"],
  ["ds:macro", "f:indicators"],
  ["ds:macro", "f:prices"],
  ["ds:macro_fdi", "f:indicators"],
  ["ds:indicators", "f:indicators"],
  ["ds:indicators", "f:governance"],
  ["ds:demographics", "f:elections"],
  ["ds:demographics", "f:risk"],
  ["ds:demographics", "f:governance"],
  ["ds:localgov", "f:governance"],
  ["ds:prices", "f:prices"],
  ["ds:prices", "f:products"],
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
