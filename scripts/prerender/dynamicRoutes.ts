import fs from "fs";
import path from "path";
import {
  CandidatesInfo,
  ElectionInfo,
  PartyInfo,
  RegionInfo,
  SectionIndex,
  SectionInfo,
  Votes,
} from "@/data/dataTypes";
import { DATA_URL, PrerenderRoute, SITE_URL } from "./routes";
import {
  buildBreadcrumbLd,
  buildDatasetLd,
  buildFaqLd,
  buildPersonLd,
  buildWebPageLd,
} from "./jsonLd";
import {
  loadCandidateCardData,
  loadEnPartyNames,
  type CandidateCardData,
} from "../og/candidateData";
import {
  buildElectionLandingBody,
  buildElectionLandingBodyEn,
  buildOblastBody,
  buildPartyBody,
  buildPollsAgencyBody,
  buildPollsBody,
  buildSectionBody,
  buildSectionsListBody,
  buildSettlementBody,
  buildGovernancePlaceBody,
  buildGovernanceMuniBody,
  buildGovernanceRegionBody,
  buildProcurementSettlementBody,
  buildFundsThemeBody,
  buildDiasporaBody,
  formatElectionDateEn,
  type DiasporaCountry,
  type GovernanceRegionMuni,
} from "./bodyBuilders";
import { buildArticleRoutes } from "./articleRoutes";
import { DIASPORA_FAQ } from "@/data/diaspora/diasporaFaq";

const BG_MONTHS = [
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
];

const formatElectionDateBg = (folder: string): string => {
  const m = /^(\d{4})_(\d{2})_(\d{2})$/.exec(folder);
  if (!m) return folder;
  return `${parseInt(m[3], 10)} ${BG_MONTHS[parseInt(m[2], 10) - 1]} ${m[1]}`;
};

type NationalSummaryFile = {
  parties: Array<{
    partyNum: number;
    nickName: string;
    name?: string;
    totalVotes: number;
    pct: number;
    deltaPct?: number;
    seats?: number;
    passedThreshold?: boolean;
    priorPct?: number;
  }>;
  turnout: {
    actual: number;
    registered: number;
    pct: number;
    priorPct?: number;
    deltaPct?: number;
  };
  topGainer?: { nickName: string; deltaPct: number };
  topLoser?: { nickName: string; deltaPct: number };
  paperMachine?: { paperPct: number; machinePct: number };
  anomalies?: { total: number };
  election: string;
};

const readNationalSummary = (
  publicFolder: string,
  latest: string,
): NationalSummaryFile | null => {
  const file = path.join(publicFolder, latest, "national_summary.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
};

// Latest election as of build time (sorted descending in elections.json).
export const getLatestElection = (electionsFile: string): string => {
  const elections: ElectionInfo[] = JSON.parse(
    fs.readFileSync(electionsFile, "utf-8"),
  );
  return elections[0].name;
};

const oblastDisplayName = (r: RegionInfo): string => r.long_name || r.name;
const oblastDisplayNameEn = (r: RegionInfo): string =>
  r.long_name_en || r.name_en || r.name;

const buildOblastNameMap = (regions: RegionInfo[]): Map<string, string> => {
  const map = new Map<string, string>();
  for (const r of regions) {
    if (!map.has(r.oblast)) map.set(r.oblast, oblastDisplayName(r));
  }
  return map;
};

const buildOblastNameMapEn = (regions: RegionInfo[]): Map<string, string> => {
  const map = new Map<string, string>();
  for (const r of regions) {
    if (!map.has(r.oblast)) map.set(r.oblast, oblastDisplayNameEn(r));
  }
  return map;
};

export const buildPartyRoutes = (
  publicFolder: string,
  latestElection: string,
): PrerenderRoute[] => {
  const file = path.join(publicFolder, latestElection, "cik_parties.json");
  if (!fs.existsSync(file)) return [];
  const parties: PartyInfo[] = JSON.parse(fs.readFileSync(file, "utf-8"));
  const summary = readNationalSummary(publicFolder, latestElection);
  return parties.map((p) => {
    const label =
      p.name && p.name !== p.nickName
        ? `${p.name} (${p.nickName})`
        : p.nickName;
    const url = `${SITE_URL}/party/${p.nickName}`;
    const enUrl = `${SITE_URL}/en/party/${p.nickName}`;
    const title = `${label} — Парламентарни избори в България | electionsbg.com`;
    const description = `Резултати на ${label} по години, области, общини и секции на парламентарните избори в България от 2005 г. насам, плюс декларирано финансиране.`;
    const titleEn = `${label} — Bulgarian Parliamentary Elections | electionsbg.com`;
    const descriptionEn = `Results of ${label} by year, region, municipality and section in Bulgaria's parliamentary elections since 2005, plus declared campaign financing.`;
    const bodyHtml = buildPartyBody(publicFolder, latestElection, p, summary);
    // Distribution links point at the structured data files the party page
    // is built from. Search engines and dataset crawlers (Google Dataset
    // Search, OpenAIRE, etc.) use these to ingest the underlying numbers.
    const distribution = [
      {
        url: `${DATA_URL}/${latestElection}/cik_parties.json`,
        name: "Списък на партиите (JSON)",
      },
      {
        url: `${DATA_URL}/${latestElection}/parties/by_region/${p.number}.json`,
        name: `${label} — резултати по области (JSON)`,
      },
      {
        url: `${DATA_URL}/${latestElection}/parties/by_municipality/${p.number}.json`,
        name: `${label} — резултати по общини (JSON)`,
      },
    ];
    const distributionEn = [
      {
        url: `${DATA_URL}/${latestElection}/cik_parties.json`,
        name: "Party list (JSON)",
      },
      {
        url: `${DATA_URL}/${latestElection}/parties/by_region/${p.number}.json`,
        name: `${label} — results by region (JSON)`,
      },
      {
        url: `${DATA_URL}/${latestElection}/parties/by_municipality/${p.number}.json`,
        name: `${label} — results by municipality (JSON)`,
      },
    ];
    const datasetKeywords = [label, "парламентарни избори", "резултати"];
    const datasetKeywordsEn = [
      label,
      "Bulgarian parliamentary elections",
      "results",
    ];
    return {
      path: `party/${p.nickName}`,
      title,
      description,
      ogImage: `/og/party/${encodeURIComponent(p.nickName)}.png`,
      bodyHtml,
      jsonLd: [
        buildWebPageLd({ title, description, url }),
        buildDatasetLd({
          name: `${label} — резултати на парламентарни избори`,
          description,
          url,
          spatialCoverage: "България",
          keywords: datasetKeywords,
          distribution,
        }),
        buildBreadcrumbLd([
          { name: "Начало", url: `${SITE_URL}/` },
          { name: label, url },
        ]),
      ],
      english: {
        title: titleEn,
        description: descriptionEn,
        bodyHtml,
        jsonLd: [
          buildWebPageLd({
            title: titleEn,
            description: descriptionEn,
            url: enUrl,
            inLanguage: "en",
          }),
          buildDatasetLd({
            name: `${label} — Bulgarian parliamentary election results`,
            description: descriptionEn,
            url: enUrl,
            spatialCoverage: "Bulgaria",
            keywords: datasetKeywordsEn,
            distribution: distributionEn,
          }),
          buildBreadcrumbLd([
            { name: "Home", url: `${SITE_URL}/en/` },
            { name: label, url: enUrl },
          ]),
        ],
      },
    };
  });
};

export const buildOblastRoutes = (
  regionsJsonPath: string,
): PrerenderRoute[] => {
  const regions: RegionInfo[] = JSON.parse(
    fs.readFileSync(regionsJsonPath, "utf-8"),
  );
  return regions
    .filter((r) => r.oblast !== "32")
    .map((r) => {
      const displayName = oblastDisplayName(r);
      const url = `${SITE_URL}/municipality/${r.oblast}`;
      const title = `Резултати в ${displayName} — Парламентарни избори | electionsbg.com`;
      const description = `Подробни резултати, машинно гласуване, повторно преброяване и отклонения по секции в област ${displayName} на парламентарните избори в България.`;
      return {
        path: `municipality/${r.oblast}`,
        title,
        description,
        ogImage: `/og/region/${r.oblast}.png`,
        bodyHtml: buildOblastBody(r),
        jsonLd: [
          buildWebPageLd({ title, description, url }),
          buildBreadcrumbLd([
            { name: "Начало", url: `${SITE_URL}/` },
            { name: `Област ${displayName}`, url },
          ]),
        ],
      };
    });
};

// /municipality/32 — the abroad ("чужбина") electoral district. The generic
// oblast prerender above excludes oblast 32 (no municipalities/census/local
// government apply), so this page had NO crawlable HTML — Googlebot saw nothing
// for the verified-demand "секции за гласуване в чужбина" cluster. This builder
// gives it a prerendered landing: a country list (from national_summary's
// topDiaspora) linking each /sections/<code> page, plus the voting-abroad FAQ
// as visible text AND FAQPage JSON-LD. BG + EN (/en/municipality/32) variants.
export const buildDiasporaRoutes = (
  publicFolder: string,
  latest: string,
): PrerenderRoute[] => {
  const file = path.join(publicFolder, latest, "national_summary.json");
  if (!fs.existsSync(file)) return [];
  let summary: { topDiaspora?: DiasporaCountry[] };
  try {
    const raw: {
      topDiaspora?: Array<{
        ekatte: string;
        name: string;
        name_en?: string;
        sections: number;
        voters?: number;
        winnerNickName?: string;
      }>;
    } = JSON.parse(fs.readFileSync(file, "utf-8"));
    summary = {
      topDiaspora: (raw.topDiaspora ?? []).map((c) => ({
        code: c.ekatte,
        name: c.name,
        name_en: c.name_en,
        sections: c.sections,
        voters: c.voters,
        winnerNickName: c.winnerNickName,
      })),
    };
  } catch {
    return [];
  }
  const countries = summary.topDiaspora ?? [];
  const dateBg = formatElectionDateBg(latest);
  const dateEn = formatElectionDateEn(latest);
  const url = `${SITE_URL}/municipality/32`;
  const enUrl = `${SITE_URL}/en/municipality/32`;

  const title =
    "Гласуване в чужбина — избирателни секции по държави | electionsbg.com";
  const description =
    "Къде гласуват българите в чужбина — избирателни секции, адреси и резултати по държави на парламентарните избори, плюс отговори на често задавани въпроси за вота извън страната.";
  const titleEn =
    "Voting Abroad — Bulgarian Polling Sections by Country | electionsbg.com";
  const descriptionEn =
    "Where Bulgarians abroad vote — polling sections, addresses and results by country in the parliamentary elections, plus answers to frequently asked questions about voting outside Bulgaria.";

  const faqBg = DIASPORA_FAQ.bg.map((it) => ({
    question: it.q,
    answer: it.a,
  }));
  const faqEn = DIASPORA_FAQ.en.map((it) => ({
    question: it.q,
    answer: it.a,
  }));

  return [
    {
      path: "municipality/32",
      title,
      description,
      bodyHtml: buildDiasporaBody("bg", countries, dateBg),
      jsonLd: [
        buildWebPageLd({ title, description, url }),
        buildBreadcrumbLd([
          { name: "Начало", url: `${SITE_URL}/` },
          { name: "Гласуване в чужбина", url },
        ]),
        buildFaqLd(faqBg),
      ],
      english: {
        title: titleEn,
        description: descriptionEn,
        bodyHtml: buildDiasporaBody("en", countries, dateEn),
        jsonLd: [
          buildWebPageLd({
            title: titleEn,
            description: descriptionEn,
            url: enUrl,
            inLanguage: "en",
          }),
          buildBreadcrumbLd([
            { name: "Home", url: `${SITE_URL}/en/` },
            { name: "Voting abroad", url: enUrl },
          ]),
          buildFaqLd(faqEn),
        ],
      },
    },
  ];
};

type SettlementBundleEntry = {
  ekatte?: string;
  name?: string;
  t_v_m?: string;
  oblast?: string;
};

export const buildSettlementRoutes = (
  publicFolder: string,
  latestElection: string,
  oblastNames: Map<string, string>,
): PrerenderRoute[] => {
  const byDir = path.join(publicFolder, latestElection, "settlements", "by");
  if (!fs.existsSync(byDir)) return [];
  const files = fs.readdirSync(byDir).filter((f) => f.endsWith(".json"));
  const seen = new Set<string>();
  const result: PrerenderRoute[] = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(byDir, f), "utf-8");
    let bundle: SettlementBundleEntry[];
    try {
      bundle = JSON.parse(raw);
    } catch {
      continue;
    }
    for (const s of bundle) {
      if (!s.ekatte || seen.has(s.ekatte)) continue;
      seen.add(s.ekatte);
      const fullName = `${s.t_v_m ? s.t_v_m + " " : ""}${s.name ?? ""}`.trim();
      const oblastName = s.oblast ? oblastNames.get(s.oblast) : undefined;
      const labelWithOblast = oblastName
        ? `${fullName}, обл. ${oblastName}`
        : fullName;
      const url = `${SITE_URL}/settlement/${s.ekatte}`;
      const title = `Резултати в ${labelWithOblast} — Парламентарни избори | electionsbg.com`;
      const description = `Резултати по секции в ${labelWithOblast} на парламентарните избори в България — гласове, машинно гласуване и отклонения.`;
      const breadcrumb = oblastName
        ? [
            { name: "Начало", url: `${SITE_URL}/` },
            {
              name: `Област ${oblastName}`,
              url: `${SITE_URL}/municipality/${s.oblast}`,
            },
            { name: fullName, url },
          ]
        : [
            { name: "Начало", url: `${SITE_URL}/` },
            { name: fullName, url },
          ];
      result.push({
        path: `settlement/${s.ekatte}`,
        title,
        description,
        bodyHtml: buildSettlementBody({
          ekatte: s.ekatte,
          settlement: fullName,
          oblastName,
          oblastCode: s.oblast,
        }),
        jsonLd: [
          buildWebPageLd({ title, description, url }),
          buildBreadcrumbLd(breadcrumb),
        ],
      });
    }
  }
  return result;
};

// /governance/{ekatte} — settlement-grain place node of the Governance view
// (renamed from the never-deployed /my-area/{ekatte}). Prerendered so each of
// the ~5,000 settlements gets indexable HTML with its own <title>, <meta
// description>, and the place-governance body. The município variant is
// emitted separately by buildGovernanceMuniRoutes below.
//
// SEO body emphasises the "how this place is governed" framing rather than
// the election-by-section framing of buildSettlementRoutes — same data,
// different door, so crawlers can index both.
export const buildGovernancePlaceRoutes = (
  publicFolder: string,
  latestElection: string,
  oblastNames: Map<string, string>,
): PrerenderRoute[] => {
  const byDir = path.join(publicFolder, latestElection, "settlements", "by");
  if (!fs.existsSync(byDir)) return [];
  const files = fs.readdirSync(byDir).filter((f) => f.endsWith(".json"));
  const seen = new Set<string>();
  const result: PrerenderRoute[] = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(byDir, f), "utf-8");
    let bundle: SettlementBundleEntry[];
    try {
      bundle = JSON.parse(raw);
    } catch {
      continue;
    }
    for (const s of bundle) {
      if (!s.ekatte || seen.has(s.ekatte)) continue;
      seen.add(s.ekatte);
      const fullName = `${s.t_v_m ? s.t_v_m + " " : ""}${s.name ?? ""}`.trim();
      const oblastName = s.oblast ? oblastNames.get(s.oblast) : undefined;
      const labelWithOblast = oblastName
        ? `${fullName}, обл. ${oblastName}`
        : fullName;
      const url = `${SITE_URL}/governance/${s.ekatte}`;
      const title = `Управление — ${labelWithOblast} | electionsbg.com`;
      const description = `Обобщено табло за управлението на ${labelWithOblast}: народни представители, кмет и общински съвет, бюджет, еврофондове, преброяване и още — всичко за вашия район на едно място.`;
      const breadcrumb = oblastName
        ? [
            { name: "Начало", url: `${SITE_URL}/` },
            { name: "Управление", url: `${SITE_URL}/governance` },
            {
              name: `Област ${oblastName}`,
              url: `${SITE_URL}/governance/region/${s.oblast}`,
            },
            { name: fullName, url },
          ]
        : [
            { name: "Начало", url: `${SITE_URL}/` },
            { name: "Управление", url: `${SITE_URL}/governance` },
            { name: fullName, url },
          ];
      const bodyHtml = buildGovernancePlaceBody({
        ekatte: s.ekatte,
        settlement: fullName,
        oblastName,
        oblastCode: s.oblast,
      });
      result.push({
        path: `governance/${s.ekatte}`,
        title,
        description,
        bodyHtml,
        jsonLd: [
          buildWebPageLd({ title, description, url }),
          buildBreadcrumbLd(breadcrumb),
        ],
      });
    }
  }
  return result;
};

type MunicipalityInfoFile = {
  obshtina: string;
  name: string;
  name_en?: string;
  oblast?: string;
};

// Synthetic Sofia-city aggregate — not a row in municipalities.json (it spans
// the three Sofia МИР), but the place node /governance/SOF00 is a real
// dashboard the region SOF redirect targets, so it needs a prerendered file.
const SOFIA_CITY_MUNI: MunicipalityInfoFile = {
  obshtina: "SOF00",
  name: "София (столица)",
  name_en: "Sofia (capital)",
  oblast: "S23",
};

const readMunicipalities = (projectRoot: string): MunicipalityInfoFile[] => {
  const file = path.join(projectRoot, "data", "municipalities.json");
  if (!fs.existsSync(file)) return [];
  try {
    const all: MunicipalityInfoFile[] = JSON.parse(
      fs.readFileSync(file, "utf-8"),
    );
    return all.filter((m) => m.obshtina && m.oblast !== "32");
  } catch {
    return [];
  }
};

// /governance/{obshtina} — município-grain place node. The earlier my-area
// prerender skipped municipalities entirely; the Governance view now makes
// each of the 265 общини (+ Sofia districts + the Sofia city aggregate) an
// indexable place-governance landing.
export const buildGovernanceMuniRoutes = (
  projectRoot: string,
  oblastNames: Map<string, string>,
): PrerenderRoute[] => {
  const munis = [...readMunicipalities(projectRoot), SOFIA_CITY_MUNI];
  const result: PrerenderRoute[] = [];
  const seen = new Set<string>();
  for (const m of munis) {
    if (seen.has(m.obshtina)) continue;
    seen.add(m.obshtina);
    const oblastName = m.oblast ? oblastNames.get(m.oblast) : undefined;
    const url = `${SITE_URL}/governance/${m.obshtina}`;
    const title = `Управление — община ${m.name} | electionsbg.com`;
    const description = `Обобщено табло за управлението на община ${m.name}: депутати и декларации, кмет и общински съвет, общинско финансиране, еврофондове, обществени поръчки, местни данъци, преброяване и прозрачност.`;
    const breadcrumb = oblastName
      ? [
          { name: "Начало", url: `${SITE_URL}/` },
          { name: "Управление", url: `${SITE_URL}/governance` },
          {
            name: `Област ${oblastName}`,
            url: `${SITE_URL}/governance/region/${m.oblast}`,
          },
          { name: `Община ${m.name}`, url },
        ]
      : [
          { name: "Начало", url: `${SITE_URL}/` },
          { name: "Управление", url: `${SITE_URL}/governance` },
          { name: `Община ${m.name}`, url },
        ];
    const bodyHtml = buildGovernanceMuniBody({
      name: m.name,
      oblastCode: m.oblast,
      oblastName,
    });
    result.push({
      path: `governance/${m.obshtina}`,
      title,
      description,
      bodyHtml,
      jsonLd: [
        buildWebPageLd({ title, description, url }),
        buildBreadcrumbLd(breadcrumb),
      ],
    });
  }
  return result;
};

// /governance/{muni}-{code} — Пловдив/Варна административен район place node.
// These районите aren't municipalities (only a derived layer), so we enumerate
// them from the район geometry files (one feature per район, keyed nuts4
// "PDV22-01"). Each lands on the lean район dashboard (parliamentary results +
// районен кмет). Reading the geometry avoids a forbidden scripts→src import.
// Mirrors the PDV22/VAR06 entries in src/data/local/cityRayonCatalog.ts (city
// + МИР). Scripts can't import from src, so they're repeated here — keep both
// in sync if a redistricting ever changes a city's МИР assignment.
const RAYON_CITY: Record<string, { bg: string; mir: string }> = {
  PDV22: { bg: "Пловдив", mir: "16" },
  VAR06: { bg: "Варна", mir: "03" },
};
export const buildGovernanceRayonRoutes = (
  projectRoot: string,
): PrerenderRoute[] => {
  const result: PrerenderRoute[] = [];
  for (const muni of Object.keys(RAYON_CITY)) {
    const file = path.join(
      projectRoot,
      "data",
      "maps",
      "city_rayons",
      `${muni}.json`,
    );
    if (!fs.existsSync(file)) continue;
    let geo: {
      features?: { properties?: { nuts4?: string; name?: string } }[];
    };
    try {
      geo = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
      continue;
    }
    const city = RAYON_CITY[muni];
    for (const f of geo.features ?? []) {
      const id = f.properties?.nuts4;
      const name = f.properties?.name;
      if (!id || !name) continue;
      const url = `${SITE_URL}/governance/${id}`;
      const title = `Управление — район ${name}, община ${city.bg} | electionsbg.com`;
      const description = `Резултати от парламентарни избори и районен кмет за административен район ${name} в община ${city.bg} (${city.mir.replace(/^0+/, "")} МИР).`;
      const breadcrumb = [
        { name: "Начало", url: `${SITE_URL}/` },
        { name: "Управление", url: `${SITE_URL}/governance` },
        { name: `Община ${city.bg}`, url: `${SITE_URL}/governance/${muni}` },
        { name: `Район ${name}`, url },
      ];
      const bodyHtml = `<h1>Район ${name}</h1><p>Административен район на община ${city.bg} (${city.mir} МИР). Резултати от парламентарни избори по партии и районен кмет.</p>`;
      result.push({
        path: `governance/${id}`,
        title,
        description,
        bodyHtml,
        jsonLd: [
          buildWebPageLd({ title, description, url }),
          buildBreadcrumbLd(breadcrumb),
        ],
      });
      // Parliamentary results node of the same район (/settlement/<id>) — the
      // other tab of the район place; reuses MunicipalityDashboardCards.
      const pUrl = `${SITE_URL}/settlement/${id}`;
      const pTitle = `Резултати в район ${name}, община ${city.bg} | electionsbg.com`;
      const pDesc = `Резултати от парламентарни избори по партии за административен район ${name} в община ${city.bg} (${city.mir.replace(/^0+/, "")} МИР).`;
      result.push({
        path: `settlement/${id}`,
        title: pTitle,
        description: pDesc,
        bodyHtml: `<h1>Район ${name}</h1><p>Парламентарни избори — резултати по партии за административен район ${name}, община ${city.bg}.</p>`,
        jsonLd: [
          buildWebPageLd({ title: pTitle, description: pDesc, url: pUrl }),
          buildBreadcrumbLd([
            { name: "Начало", url: `${SITE_URL}/` },
            { name: `Община ${city.bg}`, url: `${SITE_URL}/settlement/${muni}` },
            { name: `Район ${name}`, url: pUrl },
          ]),
        ],
      });
    }
  }
  return result;
};

// /governance/region/{oblast} — region (oblast) node of the Governance view.
// A brand-new tier with no my-area equivalent: the regional money +
// representation picture, minus the elected-local-government block. Each page
// lists its municipalities (from municipalities.json) linking to their place
// nodes, giving crawlers a real country → region → município path.
export const buildGovernanceRegionRoutes = (
  projectRoot: string,
  regions: RegionInfo[],
): PrerenderRoute[] => {
  const munisByOblast = new Map<string, GovernanceRegionMuni[]>();
  for (const m of readMunicipalities(projectRoot)) {
    if (!m.oblast) continue;
    const arr = munisByOblast.get(m.oblast) ?? [];
    arr.push({ obshtina: m.obshtina, name: m.name, name_en: m.name_en });
    munisByOblast.set(m.oblast, arr);
  }
  return regions
    .filter((r) => r.oblast !== "32")
    .map((r) => {
      const displayName = r.long_name || r.name;
      const displayNameEn = r.long_name_en || r.name_en || r.name;
      const url = `${SITE_URL}/governance/region/${r.oblast}`;
      const enUrl = `${SITE_URL}/en/governance/region/${r.oblast}`;
      const title = `Управление — област ${displayName} | electionsbg.com`;
      const description = `Регионален разрез на управлението в област ${displayName}: депутати и декларации, средства по Чл. 53, регионални индикатори, преброяване и поземлено покритие.`;
      const titleEn = `Governance — ${displayNameEn} province | electionsbg.com`;
      const descriptionEn = `A regional cut of governance in ${displayNameEn} province: MPs and declarations, Article 53 transfers, regional indicators, census and land-use.`;
      const munis = munisByOblast.get(r.oblast) ?? [];
      return {
        path: `governance/region/${r.oblast}`,
        title,
        description,
        ogImage: `/og/region/${r.oblast}.png`,
        bodyHtml: buildGovernanceRegionBody(r, munis, "bg"),
        jsonLd: [
          buildWebPageLd({ title, description, url }),
          buildBreadcrumbLd([
            { name: "Начало", url: `${SITE_URL}/` },
            { name: "Управление", url: `${SITE_URL}/governance` },
            { name: `Област ${displayName}`, url },
          ]),
        ],
        english: {
          title: titleEn,
          description: descriptionEn,
          bodyHtml: buildGovernanceRegionBody(r, munis, "en"),
          jsonLd: [
            buildWebPageLd({
              title: titleEn,
              description: descriptionEn,
              url: enUrl,
              inLanguage: "en",
            }),
            buildBreadcrumbLd([
              { name: "Home", url: `${SITE_URL}/en/` },
              { name: "Governance", url: `${SITE_URL}/en/governance` },
              { name: `${displayNameEn} province`, url: enUrl },
            ]),
          ],
        },
      };
    });
};

type ProcurementSettlementEntry = {
  ekatte: string;
  name: string;
  province?: string;
  contractCount: number;
  totalEur: number;
  awarderCount: number;
};

// /procurement/settlement/{ekatte} — per-settlement procurement detail. Real
// SPA route (ProcurementSettlementDetailScreen) that previously had NO
// prerendered HTML, so a no-JS crawler hit the SPA rewrite → homepage
// soft-duplicate. Enumerated from the same by_settlement index the sitemap
// uses. BG only (matches the sitemap).
export const buildProcurementSettlementRoutes = (
  projectRoot: string,
): PrerenderRoute[] => {
  const file = path.join(
    projectRoot,
    "data",
    "procurement",
    "by_settlement",
    "index.json",
  );
  if (!fs.existsSync(file)) return [];
  let payload: { settlements?: ProcurementSettlementEntry[] };
  try {
    payload = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return [];
  }
  const settlements = payload.settlements ?? [];
  const result: PrerenderRoute[] = [];
  for (const s of settlements) {
    if (!s.ekatte) continue;
    const place =
      s.province && s.province !== s.name ? `${s.name}, ${s.province}` : s.name;
    const url = `${SITE_URL}/procurement/settlement/${s.ekatte}`;
    const title = `Обществени поръчки — ${place} | electionsbg.com`;
    const description = `Обществени поръчки на възложители със седалище в ${place} — брой договори, обща стойност и водещи възложители по данни от АОП.`;
    result.push({
      path: `procurement/settlement/${s.ekatte}`,
      title,
      description,
      bodyHtml: buildProcurementSettlementBody("bg", s),
      jsonLd: [
        buildWebPageLd({ title, description, url }),
        buildBreadcrumbLd([
          { name: "Начало", url: `${SITE_URL}/` },
          { name: "Обществени поръчки", url: `${SITE_URL}/procurement` },
          {
            name: "По населено място",
            url: `${SITE_URL}/procurement/by-settlement`,
          },
          { name: s.name, url },
        ]),
      ],
    });
  }
  return result;
};

type FundsThemeEntry = {
  slug: string;
  labelBg: string;
  labelEn: string;
  summaryBg?: string;
  summaryEn?: string;
  contractCount?: number;
};

// /funds/focus/{slug} — themed lens on the EU-funds corpus (FundsFocusScreen).
// Real SPA route with no prerendered HTML before this. Enumerated from
// data/funds/themes.json (same source + zero-contract skip as the sitemap).
// BG + EN, since the sitemap emits both.
export const buildFundsThemeRoutes = (
  projectRoot: string,
): PrerenderRoute[] => {
  const file = path.join(projectRoot, "data", "funds", "themes.json");
  if (!fs.existsSync(file)) return [];
  let payload: { themes?: FundsThemeEntry[] };
  try {
    payload = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return [];
  }
  const themes = payload.themes ?? [];
  const result: PrerenderRoute[] = [];
  for (const th of themes) {
    if (!th.slug) continue;
    if (typeof th.contractCount === "number" && th.contractCount === 0)
      continue;
    const url = `${SITE_URL}/funds/focus/${th.slug}`;
    const enUrl = `${SITE_URL}/en/funds/focus/${th.slug}`;
    const title = `Европейски средства — ${th.labelBg} | electionsbg.com`;
    const description =
      th.summaryBg ||
      `Тематичен разрез на европейските средства: ${th.labelBg} — поръчки, бенефициенти и програми по данни от ИСУН 2020.`;
    const titleEn = `EU funds — ${th.labelEn} | electionsbg.com`;
    const descriptionEn =
      th.summaryEn ||
      `A themed lens on EU funds: ${th.labelEn} — contracts, beneficiaries and programmes from the ИСУН 2020 register.`;
    result.push({
      path: `funds/focus/${th.slug}`,
      title,
      description,
      bodyHtml: buildFundsThemeBody("bg", th),
      jsonLd: [
        buildWebPageLd({ title, description, url }),
        buildBreadcrumbLd([
          { name: "Начало", url: `${SITE_URL}/` },
          { name: "Европейски средства", url: `${SITE_URL}/funds` },
          { name: th.labelBg, url },
        ]),
      ],
      english: {
        title: titleEn,
        description: descriptionEn,
        bodyHtml: buildFundsThemeBody("en", th),
        jsonLd: [
          buildWebPageLd({
            title: titleEn,
            description: descriptionEn,
            url: enUrl,
            inLanguage: "en",
          }),
          buildBreadcrumbLd([
            { name: "Home", url: `${SITE_URL}/en/` },
            { name: "EU funds", url: `${SITE_URL}/en/funds` },
            { name: th.labelEn, url: enUrl },
          ]),
        ],
      },
    });
  }
  return result;
};

// /sections/{ekatte} — high-traffic landing page that lists every section in
// an EKATTE (Bulgarian settlement, Sofia subdivision, or 2-letter ISO country
// code for diaspora). Previously served by the SPA fallback only, so Google
// saw the homepage meta on these. Prerendering them gives each one its own
// title, description, body, and FAQ JSON-LD (diaspora only).
export const buildSectionsListRoutes = (
  publicFolder: string,
  latestElection: string,
  oblastNames: Map<string, string>,
): PrerenderRoute[] => {
  const byOblastDir = path.join(
    publicFolder,
    latestElection,
    "sections",
    "by-oblast",
  );
  if (!fs.existsSync(byOblastDir)) return [];

  const partiesFile = path.join(
    publicFolder,
    latestElection,
    "cik_parties.json",
  );
  const partyLabels = new Map<number, string>();
  if (fs.existsSync(partiesFile)) {
    const parties: PartyInfo[] = JSON.parse(
      fs.readFileSync(partiesFile, "utf-8"),
    );
    for (const p of parties) partyLabels.set(p.number, p.nickName || p.name);
  }

  type EkatteAgg = {
    ekatte: string;
    sections: SectionInfo[];
    isDiaspora: boolean;
    oblastCode: string;
  };
  const byEkatte = new Map<string, EkatteAgg>();
  for (const f of fs.readdirSync(byOblastDir)) {
    if (!f.endsWith(".json")) continue;
    let data: Record<string, SectionInfo>;
    try {
      data = JSON.parse(fs.readFileSync(path.join(byOblastDir, f), "utf-8"));
    } catch {
      continue;
    }
    for (const sec of Object.values(data)) {
      if (!sec.ekatte) continue;
      let agg = byEkatte.get(sec.ekatte);
      if (!agg) {
        agg = {
          ekatte: sec.ekatte,
          sections: [],
          isDiaspora: sec.oblast === "32",
          oblastCode: sec.oblast,
        };
        byEkatte.set(sec.ekatte, agg);
      }
      agg.sections.push(sec);
    }
  }

  // Display name lookup from settlement bundles (BG settlements + diaspora
  // countries). Sofia subdivisions like "68134-2302" aren't in this map and
  // are derived from section data below.
  const settlementMeta = new Map<string, { displayName: string }>();
  const settlementsBy = path.join(
    publicFolder,
    latestElection,
    "settlements",
    "by",
  );
  if (fs.existsSync(settlementsBy)) {
    for (const f of fs.readdirSync(settlementsBy)) {
      if (!f.endsWith(".json")) continue;
      let bundle: SettlementBundleEntry[];
      try {
        bundle = JSON.parse(
          fs.readFileSync(path.join(settlementsBy, f), "utf-8"),
        );
      } catch {
        continue;
      }
      for (const s of bundle) {
        if (!s.ekatte) continue;
        const name = `${s.t_v_m ? s.t_v_m + " " : ""}${s.name ?? ""}`.trim();
        if (name) settlementMeta.set(s.ekatte, { displayName: name });
      }
    }
  }

  const electionDateLabel = formatElectionDateBg(latestElection);
  const electionYear = latestElection.slice(0, 4);
  const FAQ_DIASPORA = [
    {
      question: "Кой може да гласува в чужбина?",
      answer:
        "Български граждани с навършени 18 години към изборния ден, без значение от постоянния им адрес.",
    },
    {
      question: "Какви документи са необходими за гласуване?",
      answer:
        "Валидна българска лична карта или паспорт. Не се изисква предварителна регистрация в деня на изборите за вече разкритите секции.",
    },
    {
      question: "Кога работят избирателните секции в чужбина?",
      answer:
        "Обикновено от 7:00 до 20:00 по местно време. Чакащите пред секцията в 20:00 имат право да гласуват.",
    },
  ];

  const result: PrerenderRoute[] = [];
  for (const [ekatte, agg] of byEkatte) {
    let displayName: string;
    if (agg.isDiaspora) {
      const meta = settlementMeta.get(ekatte);
      const fallback = agg.sections[0]?.settlement?.split(",")[0]?.trim();
      displayName = meta?.displayName || fallback || ekatte;
    } else {
      const meta = settlementMeta.get(ekatte);
      if (meta) {
        displayName = meta.displayName;
      } else {
        const settle =
          agg.sections[0]?.settlement?.trim() || `EKATTE ${ekatte}`;
        displayName = /^68134-/.test(ekatte)
          ? `${settle} (район ${ekatte.replace("68134-", "")})`
          : settle;
      }
    }
    const oblastName =
      !agg.isDiaspora && agg.oblastCode
        ? oblastNames.get(agg.oblastCode)
        : undefined;

    let registered = 0;
    let actual = 0;
    const partyVotes = new Map<number, number>();
    for (const s of agg.sections) {
      registered += s.results?.protocol?.numRegisteredVoters ?? 0;
      actual += s.results?.protocol?.totalActualVoters ?? 0;
      const votes = s.results?.votes ?? [];
      for (const v of votes) {
        partyVotes.set(
          v.partyNum,
          (partyVotes.get(v.partyNum) ?? 0) + (v.totalVotes ?? 0),
        );
      }
    }
    const turnoutPct = registered > 0 ? (actual / registered) * 100 : 0;
    const totalVotes = [...partyVotes.values()].reduce((a, b) => a + b, 0);
    const topParties =
      totalVotes > 0
        ? [...partyVotes.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([num, votes]) => ({
              nickName: partyLabels.get(num) ?? `№${num}`,
              totalVotes: votes,
              pct: (votes / totalVotes) * 100,
            }))
        : [];

    const sortedSections = [...agg.sections].sort((a, b) =>
      a.section.localeCompare(b.section),
    );
    const sectionItems = sortedSections.map((s) => {
      const settle = s.settlement?.trim() ?? "";
      const ci = settle.indexOf(",");
      return {
        section: s.section,
        address: s.address,
        cityLabel:
          agg.isDiaspora && ci >= 0 ? settle.slice(ci + 1).trim() : undefined,
      };
    });

    const placeLabel = oblastName
      ? `${displayName}, обл. ${oblastName}`
      : displayName;
    const url = `${SITE_URL}/sections/${ekatte}`;
    const sectionCount = sortedSections.length;
    const title = agg.isDiaspora
      ? `Избирателни секции в ${displayName} ${electionYear} — Парламентарни избори в България | electionsbg.com`
      : `Избирателни секции в ${placeLabel} — Парламентарни избори ${electionYear} | electionsbg.com`;
    const description = agg.isDiaspora
      ? `Списък на ${sectionCount} избирателни секции за гласуване в ${displayName} на парламентарния вот ${electionDateLabel} — градове, адреси и резултати.`
      : `${sectionCount} избирателни секции в ${placeLabel} с адреси и резултати по партии за парламентарния вот ${electionDateLabel}.`;

    const breadcrumb = agg.isDiaspora
      ? [
          { name: "Начало", url: `${SITE_URL}/` },
          { name: `Секции в ${displayName}`, url },
        ]
      : oblastName && agg.oblastCode
        ? [
            { name: "Начало", url: `${SITE_URL}/` },
            {
              name: `Област ${oblastName}`,
              url: `${SITE_URL}/municipality/${agg.oblastCode}`,
            },
            { name: `Секции в ${displayName}`, url },
          ]
        : [
            { name: "Начало", url: `${SITE_URL}/` },
            { name: `Секции в ${displayName}`, url },
          ];

    const jsonLd: object[] = [
      buildWebPageLd({ title, description, url }),
      buildBreadcrumbLd(breadcrumb),
    ];
    if (agg.isDiaspora) {
      jsonLd.push(buildFaqLd(FAQ_DIASPORA));
    }

    result.push({
      path: `sections/${ekatte}`,
      title,
      description,
      bodyHtml: buildSectionsListBody({
        ekatte,
        displayName,
        oblastName,
        oblastCode: agg.isDiaspora ? undefined : agg.oblastCode,
        isDiaspora: agg.isDiaspora,
        electionDateLabel,
        sections: sectionItems,
        aggregate:
          actual > 0 || topParties.length > 0
            ? { registered, actual, turnoutPct, topParties }
            : undefined,
      }),
      jsonLd,
    });
  }
  return result;
};

type CandidateAggregate = {
  parties: Set<string>; // Bulgarian party labels
  partiesEn: Set<string>; // English party labels (same order of discovery)
  elections: Set<string>;
  // Per-election entries — used to render a "Кандидатствания" history table.
  // A candidate may run on multiple lists in one cycle (rare); keep all rows.
  // partyLabel is BG (also the /party/ route slug); partyLabelEn is display-only.
  history: Array<{
    folder: string;
    partyLabel: string;
    partyLabelEn: string;
    oblast: string;
  }>;
};

type MpIndexEntry = {
  id: number;
  name: string;
  name_en?: string;
  normalizedName: string;
  normalizedName_en?: string;
  photoUrl: string;
  currentRegion: {
    code: string;
    name: string;
    name_en?: string;
  } | null;
  currentPartyGroup: string | null;
  currentPartyGroup_en?: string | null;
  position: string | null;
  position_en?: string | null;
  birthDate: string | null;
  isCurrent: boolean;
};

type RawMpProfile = {
  A_ns_MP_id: number;
  A_ns_MPL_Name1?: string;
  A_ns_MPL_Name2?: string;
  A_ns_MPL_Name3?: string;
  A_ns_MP_BDate?: string;
  A_ns_B_Country?: string;
  A_ns_B_City?: string;
  A_ns_MPL_Spec?: string;
  A_ns_MPL_Prof?: string;
  A_ns_MP_url?: string;
  A_ns_MP_fbook?: string;
  A_ns_MP_img?: string | null;
  oldnsList?: { A_nsL_value?: string; A_nsL_value_short?: string }[];
  lngList?: { LngL_value?: string; A_LngL_value?: string }[];
};

const normalizeName = (s: string): string =>
  s.toUpperCase().replace(/\s+/g, " ").trim();

// Thousands-separated integer — comma form reads unambiguously in both the
// Bulgarian and English prerendered bodies and matches the OG card style.
const formatNumber = (n: number): string => n.toLocaleString("en-US");

// Role sentence shared by the body summary and the FAQ — derived from the
// parliament index (current/former MP) or the candidate ballot.
const roleSentenceBg = (name: string, card: CandidateCardData): string => {
  switch (card.role) {
    case "current_mp":
      return card.mp?.partyGroupShort
        ? `${name} е действащ народен представител (${card.mp.partyGroupShort}).`
        : `${name} е действащ народен представител.`;
    case "former_mp":
      return `${name} е бивш народен представител.`;
    default:
      return `${name} е кандидат за народен представител.`;
  }
};

const roleSentenceEn = (name: string, card: CandidateCardData): string => {
  switch (card.role) {
    case "current_mp":
      return card.mp?.partyGroupShort
        ? `${name} is a sitting member of the National Assembly (${card.mp.partyGroupShort}).`
        : `${name} is a sitting member of the National Assembly.`;
    case "former_mp":
      return `${name} is a former member of the National Assembly.`;
    default:
      return `${name} is a candidate for the National Assembly.`;
  }
};

// FAQ Q&As for a candidate page — keyed off the same shared facts as the
// summary line. Returns [] when there isn't enough to make a useful FAQ
// (the caller skips the FAQPage JSON-LD below two items).
const buildCandidateFaqBg = (
  name: string,
  card: CandidateCardData,
): Array<{ question: string; answer: string }> => {
  const items: Array<{ question: string; answer: string }> = [];
  const f = card.facts;
  if (f) {
    items.push({
      question: `Колко преференции получи ${name}?`,
      answer: `${name} получи общо ${formatNumber(f.totalPreferences)} преференции на изборите на ${formatElectionDateBg(f.electionDate)} — най-много в област ${f.topOblastName} (${formatNumber(f.topOblastPreferences)}).`,
    });
    items.push({
      question: `За коя партия се кандидатира ${name}?`,
      answer: `На изборите на ${formatElectionDateBg(f.electionDate)} ${name} се кандидатира от ${f.party.name} (${f.party.nickName}).`,
    });
  } else if (card.candidacy) {
    items.push({
      question: `За коя партия се кандидатира ${name}?`,
      answer: `${name} се кандидатира от ${card.candidacy.partyNickName ?? `№${card.candidacy.partyNum}`} в област ${card.candidacy.oblastName}.`,
    });
  }
  items.push({
    question: `${name} народен представител ли е?`,
    answer: roleSentenceBg(name, card),
  });
  return items;
};

const buildCandidateFaqEn = (
  name: string,
  card: CandidateCardData,
): Array<{ question: string; answer: string }> => {
  const items: Array<{ question: string; answer: string }> = [];
  const f = card.facts;
  if (f) {
    items.push({
      question: `How many preference votes did ${name} get?`,
      answer: `${name} received ${formatNumber(f.totalPreferences)} preference votes in the ${formatElectionDateEn(f.electionDate)} election — most in ${f.topOblastNameEn} (${formatNumber(f.topOblastPreferences)}).`,
    });
    items.push({
      question: `Which party did ${name} run for?`,
      answer: `In the ${formatElectionDateEn(f.electionDate)} election, ${name} ran on the ${f.party.nameEn} (${f.party.nickNameEn}) list.`,
    });
  } else if (card.candidacy) {
    items.push({
      question: `Which party did ${name} run for?`,
      answer: `${name} ran on the ${card.candidacy.partyNickNameEn ?? card.candidacy.partyNickName ?? `№${card.candidacy.partyNum}`} list in ${card.candidacy.oblastName}.`,
    });
  }
  items.push({
    question: `Is ${name} a member of parliament?`,
    answer: roleSentenceEn(name, card),
  });
  return items;
};

const escapeHtmlSimple = (s: string): string =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const fmtBgDate = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = [
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
  ];
  return `${parseInt(m[3], 10)} ${months[parseInt(m[2], 10) - 1]} ${m[1]}`;
};

// Light translation table for the most common parliament-position labels.
// Region names are translated (regions.json carries name_en / long_name_en);
// proper-noun party names stay in BG since cik_parties.json isn't translated.
const POSITION_EN: Record<string, string> = {
  председател: "Speaker of the National Assembly",
  "заместник-председател": "Deputy Speaker",
  "парламентарен секретар": "Parliamentary Secretary",
  квестор: "Quaestor",
};

const translatePositionEn = (position: string | null | undefined): string => {
  if (!position) return "";
  const k = position.trim().toLowerCase();
  return POSITION_EN[k] ?? position.trim();
};

const fmtEnDate = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = [
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
  ];
  return `${parseInt(m[3], 10)} ${months[parseInt(m[2], 10) - 1]} ${m[1]}`;
};

const buildCandidateBodyEn = (
  nameBg: string,
  nameEn: string,
  partyLabelsEn: string[],
  yearSpan: string,
  indexEntry: MpIndexEntry | undefined,
  profile: RawMpProfile | null,
  history: Array<{
    folder: string;
    partyLabel: string;
    partyLabelEn: string;
    oblast: string;
  }>,
  oblastNamesEn: Map<string, string>,
  cardData: CandidateCardData | undefined,
): string => {
  const parts: string[] = [];
  parts.push(`<h1>${escapeHtmlSimple(nameEn)}</h1>`);
  const headline: string[] = [];
  const positionEn = translatePositionEn(indexEntry?.position);
  if (positionEn) headline.push(escapeHtmlSimple(positionEn));
  if (indexEntry?.currentRegion?.name) {
    headline.push(
      `Member of Parliament for ${escapeHtmlSimple(indexEntry.currentRegion.name)}`,
    );
  } else if (partyLabelsEn.length) {
    headline.push(
      `candidate for the National Assembly${yearSpan ? ` (${yearSpan})` : ""}`,
    );
  }
  if (indexEntry?.currentPartyGroup) {
    // The parliamentary-group name has no EN form in parliament/index.json,
    // so it stays in BG.
    headline.push(escapeHtmlSimple(indexEntry.currentPartyGroup));
  } else if (partyLabelsEn.length) {
    headline.push(`from ${escapeHtmlSimple(partyLabelsEn.join(", "))}`);
  }
  if (headline.length) parts.push(`<p>${headline.join(" · ")}.</p>`);

  // Plain-language results summary — the answer a name-searcher actually
  // wants, above the per-region tables.
  if (cardData?.facts) {
    const f = cardData.facts;
    parts.push(
      `<p>In their most recent candidacy (${formatElectionDateEn(f.electionDate)}), ${escapeHtmlSimple(nameEn)} received ${formatNumber(f.totalPreferences)} preference votes — most in ${escapeHtmlSimple(f.topOblastNameEn)} (${formatNumber(f.topOblastPreferences)}).</p>`,
    );
  }

  const facts: string[] = [];
  const birthDate = fmtEnDate(indexEntry?.birthDate ?? profile?.A_ns_MP_BDate);
  if (birthDate) {
    const place = [profile?.A_ns_B_City, profile?.A_ns_B_Country]
      .filter(Boolean)
      .join(", ");
    facts.push(
      `Born ${escapeHtmlSimple(birthDate)}${place ? ` in ${escapeHtmlSimple(place)}` : ""}`,
    );
  }
  if (profile?.A_ns_MPL_Prof) {
    facts.push(`Profession: ${escapeHtmlSimple(profile.A_ns_MPL_Prof.trim())}`);
  }
  if (profile?.A_ns_MPL_Spec) {
    facts.push(`Specialty: ${escapeHtmlSimple(profile.A_ns_MPL_Spec.trim())}`);
  }
  const langs = (profile?.lngList ?? [])
    .map((l) => l.LngL_value ?? l.A_LngL_value ?? "")
    .filter(Boolean);
  if (langs.length) {
    facts.push(`Languages: ${escapeHtmlSimple(langs.join(", "))}`);
  }
  if (profile?.oldnsList && profile.oldnsList.length) {
    const terms = profile.oldnsList
      .map((t) => t.A_nsL_value_short ?? t.A_nsL_value ?? "")
      .filter(Boolean)
      .join(", ");
    if (terms)
      facts.push(`National Assemblies served: ${escapeHtmlSimple(terms)}`);
  }
  if (facts.length) {
    parts.push(`<ul>${facts.map((f) => `<li>${f}</li>`).join("")}</ul>`);
  }

  if (history.length > 0) {
    const sorted = [...history].sort((a, b) =>
      b.folder.localeCompare(a.folder),
    );
    parts.push(`<h2>Candidacies</h2>`);
    parts.push(
      `<table><thead><tr><th>Election</th><th>List</th><th>Region</th></tr></thead><tbody>`,
    );
    for (const h of sorted) {
      // Reuse the BG date label — it's structured (DD month YYYY in Cyrillic);
      // for an EN audience we render the ISO-like form.
      const m = /^(\d{4})_(\d{2})_(\d{2})$/.exec(h.folder);
      const dateLabel = m ? `${m[3]}.${m[2]}.${m[1]}` : h.folder;
      // The /party/ route slug is the BG nickname; only the label is EN.
      const partyCell = h.partyLabel.startsWith("№")
        ? escapeHtmlSimple(h.partyLabelEn)
        : `<a href="${SITE_URL}/en/party/${encodeURIComponent(h.partyLabel)}">${escapeHtmlSimple(h.partyLabelEn)}</a>`;
      const oblastLabel = h.oblast
        ? (oblastNamesEn.get(h.oblast) ?? h.oblast)
        : "";
      const oblastCell =
        h.oblast && oblastNamesEn.has(h.oblast)
          ? `<a href="${SITE_URL}/en/municipality/${h.oblast}">${escapeHtmlSimple(oblastLabel)}</a>`
          : escapeHtmlSimple(oblastLabel);
      parts.push(
        `<tr><td>${escapeHtmlSimple(dateLabel)}</td><td>${partyCell}</td><td>${oblastCell}</td></tr>`,
      );
    }
    parts.push(`</tbody></table>`);
  }

  if (nameEn !== nameBg) {
    parts.push(
      `<p><small>Bulgarian name: ${escapeHtmlSimple(nameBg)}</small></p>`,
    );
  }
  if (indexEntry?.id) {
    parts.push(
      `<p><a href="https://www.parliament.bg/bg/MP/${indexEntry.id}" rel="nofollow noopener">parliament.bg</a></p>`,
    );
  }
  return parts.join("\n");
};

const buildCandidateBody = (
  name: string,
  partyLabels: string[],
  yearSpan: string,
  indexEntry: MpIndexEntry | undefined,
  profile: RawMpProfile | null,
  history: Array<{ folder: string; partyLabel: string; oblast: string }>,
  oblastNames: Map<string, string>,
  cardData: CandidateCardData | undefined,
): string => {
  const parts: string[] = [];
  parts.push(`<h1>${escapeHtmlSimple(name)}</h1>`);
  const headline: string[] = [];
  if (indexEntry?.position)
    headline.push(escapeHtmlSimple(indexEntry.position));
  if (indexEntry?.currentRegion?.name) {
    headline.push(
      `народен представител от ${escapeHtmlSimple(indexEntry.currentRegion.name)}`,
    );
  } else if (partyLabels.length) {
    headline.push(
      `кандидат за народен представител${yearSpan ? ` (${yearSpan})` : ""}`,
    );
  }
  if (indexEntry?.currentPartyGroup) {
    headline.push(escapeHtmlSimple(indexEntry.currentPartyGroup));
  } else if (partyLabels.length) {
    headline.push(`от ${escapeHtmlSimple(partyLabels.join(", "))}`);
  }
  if (headline.length) parts.push(`<p>${headline.join(" · ")}.</p>`);

  // Plain-language results summary — the answer a name-searcher actually
  // wants, above the per-region tables.
  if (cardData?.facts) {
    const f = cardData.facts;
    parts.push(
      `<p>На последните избори, в които се кандидатира (${formatElectionDateBg(f.electionDate)}), ${escapeHtmlSimple(name)} получи общо ${formatNumber(f.totalPreferences)} преференции — най-много в област ${escapeHtmlSimple(f.topOblastName)} (${formatNumber(f.topOblastPreferences)}).</p>`,
    );
  }

  const facts: string[] = [];
  const birthDate = fmtBgDate(indexEntry?.birthDate ?? profile?.A_ns_MP_BDate);
  if (birthDate) {
    const place = [profile?.A_ns_B_City, profile?.A_ns_B_Country]
      .filter(Boolean)
      .join(", ");
    facts.push(
      `Родена/роден на ${escapeHtmlSimple(birthDate)}${place ? ` в ${escapeHtmlSimple(place)}` : ""}`,
    );
  }
  if (profile?.A_ns_MPL_Prof) {
    facts.push(`Професия: ${escapeHtmlSimple(profile.A_ns_MPL_Prof.trim())}`);
  }
  if (profile?.A_ns_MPL_Spec) {
    facts.push(
      `Специалност: ${escapeHtmlSimple(profile.A_ns_MPL_Spec.trim())}`,
    );
  }
  const langs = (profile?.lngList ?? [])
    .map((l) => l.LngL_value ?? l.A_LngL_value ?? "")
    .filter(Boolean);
  if (langs.length) {
    facts.push(`Чужди езици: ${escapeHtmlSimple(langs.join(", "))}`);
  }
  if (profile?.oldnsList && profile.oldnsList.length) {
    const terms = profile.oldnsList
      .map((t) => t.A_nsL_value_short ?? t.A_nsL_value ?? "")
      .filter(Boolean)
      .join(", ");
    if (terms) facts.push(`Народни събрания: ${escapeHtmlSimple(terms)}`);
  }
  if (facts.length) {
    parts.push(`<ul>${facts.map((f) => `<li>${f}</li>`).join("")}</ul>`);
  }

  if (history.length > 0) {
    // Sort newest-first; the first row is what the candidate's name most often
    // resolves to in current search intent.
    const sorted = [...history].sort((a, b) =>
      b.folder.localeCompare(a.folder),
    );
    parts.push(`<h2>Кандидатствания</h2>`);
    parts.push(
      `<table><thead><tr><th>Избори</th><th>Листа</th><th>Област</th></tr></thead><tbody>`,
    );
    for (const h of sorted) {
      const dateLabel = formatElectionDateBg(h.folder);
      const partyCell = h.partyLabel.startsWith("№")
        ? escapeHtmlSimple(h.partyLabel)
        : `<a href="${SITE_URL}/party/${encodeURIComponent(h.partyLabel)}">${escapeHtmlSimple(h.partyLabel)}</a>`;
      const oblastLabel = h.oblast
        ? (oblastNames.get(h.oblast) ?? h.oblast)
        : "";
      const oblastCell =
        h.oblast && oblastNames.has(h.oblast)
          ? `<a href="${SITE_URL}/municipality/${h.oblast}">${escapeHtmlSimple(oblastLabel)}</a>`
          : escapeHtmlSimple(oblastLabel);
      parts.push(
        `<tr><td>${escapeHtmlSimple(dateLabel)}</td><td>${partyCell}</td><td>${oblastCell}</td></tr>`,
      );
    }
    parts.push(`</tbody></table>`);
  }

  if (indexEntry?.id) {
    parts.push(
      `<p><a href="https://www.parliament.bg/bg/MP/${indexEntry.id}" rel="nofollow noopener">parliament.bg</a></p>`,
    );
  }
  return parts.join("\n");
};

export const buildCandidateRoutes = (
  publicFolder: string,
  oblastNames: Map<string, string>,
  oblastNamesEn: Map<string, string>,
): PrerenderRoute[] => {
  if (!fs.existsSync(publicFolder)) return [];
  const electionFolders = fs
    .readdirSync(publicFolder)
    .filter((f) => /^\d{4}_\d{2}_\d{2}$/.test(f))
    .sort()
    .reverse(); // most-recent first so we keep the latest party label per name

  // Build per-election partyNum → label map once and reuse.
  const partyLabelByElection = new Map<string, Map<number, string>>();
  for (const folder of electionFolders) {
    const partiesFile = path.join(publicFolder, folder, "cik_parties.json");
    if (!fs.existsSync(partiesFile)) continue;
    const parties: PartyInfo[] = JSON.parse(
      fs.readFileSync(partiesFile, "utf-8"),
    );
    const m = new Map<number, string>();
    for (const p of parties) m.set(p.number, p.nickName || p.name);
    partyLabelByElection.set(folder, m);
  }

  // Load the parliament index once.
  const mpIndexFile = path.join(publicFolder, "parliament", "index.json");
  const mpByName = new Map<string, MpIndexEntry>();
  if (fs.existsSync(mpIndexFile)) {
    try {
      const raw: { mps: MpIndexEntry[] } = JSON.parse(
        fs.readFileSync(mpIndexFile, "utf-8"),
      );
      for (const mp of raw.mps) {
        mpByName.set(normalizeName(mp.normalizedName ?? mp.name), mp);
      }
    } catch {
      // ignore — fall through with empty map
    }
  }
  const profilesDir = path.join(publicFolder, "parliament", "profiles");
  const loadProfile = (id: number): RawMpProfile | null => {
    const file = path.join(profilesDir, `${id}.json`);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
      return null;
    }
  };

  // English party names per "{election}|{partyNum}" — cik_parties.json is
  // BG-only, so the EN labels come from canonical_parties.json.
  const enParties = loadEnPartyNames(path.dirname(publicFolder));

  const byName = new Map<string, CandidateAggregate>();
  for (const folder of electionFolders) {
    const candFile = path.join(publicFolder, folder, "candidates.json");
    if (!fs.existsSync(candFile)) continue;
    let cands: CandidatesInfo[];
    try {
      cands = JSON.parse(fs.readFileSync(candFile, "utf-8"));
    } catch {
      continue;
    }
    const partyMap = partyLabelByElection.get(folder);
    for (const c of cands) {
      if (!c.name) continue;
      let agg = byName.get(c.name);
      if (!agg) {
        agg = {
          parties: new Set(),
          partiesEn: new Set(),
          elections: new Set(),
          history: [],
        };
        byName.set(c.name, agg);
      }
      agg.elections.add(folder);
      const partyLabel = partyMap?.get(c.partyNum) ?? `№${c.partyNum}`;
      const partyLabelEn =
        enParties.get(`${folder}|${c.partyNum}`)?.nickNameEn ?? partyLabel;
      if (partyMap?.get(c.partyNum)) {
        agg.parties.add(partyLabel);
        agg.partiesEn.add(partyLabelEn);
      }
      const key = `${folder}|${partyLabel}|${c.oblast ?? ""}`;
      if (
        !agg.history.some(
          (h) => `${h.folder}|${h.partyLabel}|${h.oblast}` === key,
        )
      ) {
        agg.history.push({
          folder,
          partyLabel,
          partyLabelEn,
          oblast: c.oblast ?? "",
        });
      }
    }
  }

  // In-scope card set (latest-election candidates + all MPs) with shared
  // facts — drives the composed OG image, the body summary line, the
  // results clause in the meta description, and the FAQ JSON-LD.
  const candidateCardSet = loadCandidateCardData(path.dirname(publicFolder));

  const result: PrerenderRoute[] = [];
  for (const [name, agg] of byName) {
    const url = `${SITE_URL}/candidate/${encodeURIComponent(name)}`;
    const elections = Array.from(agg.elections).sort();
    const earliest = elections[0];
    const latest = elections[elections.length - 1];
    const earliestYear = earliest?.slice(0, 4);
    const latestYear = latest?.slice(0, 4);
    const yearSpan =
      earliestYear && latestYear && earliestYear !== latestYear
        ? `${earliestYear}–${latestYear}`
        : (latestYear ?? "");
    const partyLabels = Array.from(agg.parties);
    const partyLabelsEn = Array.from(agg.partiesEn);
    const partyClause = partyLabels.length
      ? ` от ${partyLabels.join(", ")}`
      : "";
    const partyClauseEn = partyLabelsEn.length
      ? ` from ${partyLabelsEn.join(", ")}`
      : "";

    const indexEntry = mpByName.get(normalizeName(name));
    const profile = indexEntry ? loadProfile(indexEntry.id) : null;
    const enUrl = `${SITE_URL}/en/candidate/${encodeURIComponent(name)}`;
    const nameEn = indexEntry?.name_en?.trim() || name;
    const cardData = candidateCardSet.byNormalizedName.get(normalizeName(name));
    const factsClauseBg = cardData?.facts
      ? ` ${formatNumber(cardData.facts.totalPreferences)} преференции на изборите на ${formatElectionDateBg(cardData.facts.electionDate)}, най-силно представяне в област ${cardData.facts.topOblastName}.`
      : "";
    const factsClauseEn = cardData?.facts
      ? ` ${formatNumber(cardData.facts.totalPreferences)} preference votes in the ${formatElectionDateEn(cardData.facts.electionDate)} election, strongest in ${cardData.facts.topOblastNameEn}.`
      : "";

    const isMp = !!indexEntry;
    const titleRole = isMp
      ? indexEntry.isCurrent
        ? "народен представител"
        : "бивш народен представител"
      : "кандидат за народен представител";
    const title = `${name} — ${titleRole}${yearSpan ? ` (${yearSpan})` : ""} | electionsbg.com`;
    const descRole = isMp
      ? `${titleRole}${indexEntry.currentPartyGroup ? ` от ${indexEntry.currentPartyGroup}` : partyClause}`
      : `${titleRole}${partyClause}`;
    const description = `${name} — ${descRole} в парламентарните избори в България.${factsClauseBg} Преференции по области, общини, населени места и секции${profile?.A_ns_MPL_Prof ? `. Професия: ${profile.A_ns_MPL_Prof.trim()}` : ""}.`;

    const titleRoleEn = isMp
      ? indexEntry.isCurrent
        ? "Member of Parliament"
        : "Former Member of Parliament"
      : "Parliamentary candidate";
    const descRoleEn = isMp
      ? `${titleRoleEn}${indexEntry.currentPartyGroup ? ` from ${indexEntry.currentPartyGroup}` : partyClauseEn}`
      : `${titleRoleEn}${partyClauseEn}`;
    const titleEn = `${nameEn} — ${titleRoleEn}${yearSpan ? ` (${yearSpan})` : ""} | electionsbg.com`;
    const descriptionEn = `${nameEn} — ${descRoleEn} in Bulgaria's parliamentary elections.${factsClauseEn} Preference votes by region, municipality, settlement and polling section${profile?.A_ns_MPL_Prof ? `. Profession: ${profile.A_ns_MPL_Prof.trim()}` : ""}.`;

    const personLd = buildPersonLd({
      name,
      url,
      affiliations: partyLabels,
      givenName: profile?.A_ns_MPL_Name1,
      additionalName: profile?.A_ns_MPL_Name2,
      familyName: profile?.A_ns_MPL_Name3,
      birthDate: profile?.A_ns_MP_BDate,
      birthPlace:
        profile?.A_ns_B_City || profile?.A_ns_B_Country
          ? {
              city: profile.A_ns_B_City,
              country: profile.A_ns_B_Country,
            }
          : undefined,
      jobTitle: profile?.A_ns_MPL_Prof?.trim(),
      knowsAbout: profile?.A_ns_MPL_Spec?.trim(),
      knowsLanguage: (profile?.lngList ?? [])
        .map((l) => l.LngL_value ?? l.A_LngL_value ?? "")
        .filter(Boolean),
      image: indexEntry?.photoUrl,
      memberOf: indexEntry?.isCurrent
        ? {
            name: "Народно събрание на Република България",
            url: `https://www.parliament.bg/bg/MP/${indexEntry.id}`,
          }
        : undefined,
      sameAs: indexEntry?.id
        ? [`https://www.parliament.bg/bg/MP/${indexEntry.id}`]
        : undefined,
    });

    // Composed OG card for in-scope candidates (every latest-election
    // candidate + every MP); generate.ts writes it under cardData.name, so
    // resolve the filename through the card set rather than the route name.
    const ogImage = cardData
      ? `/og/candidate/${encodeURIComponent(cardData.name)}.webp`
      : indexEntry?.photoUrl;

    const personLdEn =
      nameEn !== name
        ? buildPersonLd({
            name: nameEn,
            url: enUrl,
            affiliations: partyLabelsEn,
            givenName: profile?.A_ns_MPL_Name1,
            additionalName: profile?.A_ns_MPL_Name2,
            familyName: profile?.A_ns_MPL_Name3,
            birthDate: profile?.A_ns_MP_BDate,
            birthPlace:
              profile?.A_ns_B_City || profile?.A_ns_B_Country
                ? {
                    city: profile.A_ns_B_City,
                    country: profile.A_ns_B_Country,
                  }
                : undefined,
            jobTitle: profile?.A_ns_MPL_Prof?.trim(),
            knowsAbout: profile?.A_ns_MPL_Spec?.trim(),
            knowsLanguage: (profile?.lngList ?? [])
              .map((l) => l.LngL_value ?? l.A_LngL_value ?? "")
              .filter(Boolean),
            image: indexEntry?.photoUrl,
            memberOf: indexEntry?.isCurrent
              ? {
                  name: "National Assembly of the Republic of Bulgaria",
                  url: `https://www.parliament.bg/bg/MP/${indexEntry.id}`,
                }
              : undefined,
            sameAs: indexEntry?.id
              ? [`https://www.parliament.bg/bg/MP/${indexEntry.id}`]
              : undefined,
          })
        : personLd;

    // FAQ JSON-LD — only when there's enough for a useful FAQPage (≥2 Q&As).
    const faqBg = cardData ? buildCandidateFaqBg(name, cardData) : [];
    const faqEn = cardData ? buildCandidateFaqEn(nameEn, cardData) : [];
    const jsonLdBg: object[] = [
      personLd,
      buildBreadcrumbLd([
        { name: "Начало", url: `${SITE_URL}/` },
        { name, url },
      ]),
    ];
    if (faqBg.length >= 2) jsonLdBg.push(buildFaqLd(faqBg));
    const jsonLdEn: object[] = [
      personLdEn,
      buildBreadcrumbLd([
        { name: "Home", url: `${SITE_URL}/en/` },
        { name: nameEn, url: enUrl },
      ]),
    ];
    if (faqEn.length >= 2) jsonLdEn.push(buildFaqLd(faqEn));

    result.push({
      path: `candidate/${name}`,
      title,
      description,
      ogImage,
      bodyHtml: buildCandidateBody(
        name,
        partyLabels,
        yearSpan,
        indexEntry,
        profile,
        agg.history,
        oblastNames,
        cardData,
      ),
      jsonLd: jsonLdBg,
      english: {
        title: titleEn,
        description: descriptionEn,
        bodyHtml: buildCandidateBodyEn(
          name,
          nameEn,
          partyLabelsEn,
          yearSpan,
          indexEntry,
          profile,
          agg.history,
          oblastNamesEn,
          cardData,
        ),
        jsonLd: jsonLdEn,
      },
    });
  }
  return result;
};

// Sub-tab paths under /candidate/{name}/{slug} that exist as routes in the SPA
// (see src/routes.tsx). Each gets a thin prerendered variant whose
// <link rel="canonical"> points back to the parent /candidate/{name}, so
// crawlers consolidate signal there instead of treating these as duplicate
// homepage-titled pages — the prior cause of "Crawled - currently not indexed"
// in GSC. Title is unique enough for browser tabs and AI bots that ignore
// canonical hints; the pages themselves stay out of the search index.
const CANDIDATE_SUB_TABS: Array<{ slug: string; bg: string; en: string }> = [
  { slug: "regions", bg: "по области", en: "by region" },
  { slug: "municipalities", bg: "по общини", en: "by municipality" },
  { slug: "settlements", bg: "по населени места", en: "by settlement" },
  { slug: "sections", bg: "по секции", en: "by section" },
  { slug: "donations", bg: "дарения", en: "donations" },
  { slug: "connections", bg: "бизнес връзки", en: "business connections" },
  { slug: "assets", bg: "имущество", en: "assets" },
];

const TITLE_SUFFIX = " | electionsbg.com";

const stripTitleSuffix = (t: string): string =>
  t.endsWith(TITLE_SUFFIX) ? t.slice(0, -TITLE_SUFFIX.length) : t;

const encodeUrlPath = (p: string): string =>
  p.split("/").map(encodeURIComponent).join("/");

export const buildCandidateSubTabRoutes = (
  candidateRoutes: PrerenderRoute[],
): PrerenderRoute[] => {
  const result: PrerenderRoute[] = [];
  for (const parent of candidateRoutes) {
    if (!parent.path.startsWith("candidate/")) continue;
    const name = parent.path.slice("candidate/".length);
    if (!name || name.includes("/")) continue;
    const parentUrl = `${SITE_URL}/${encodeUrlPath(parent.path)}`;
    const parentEnUrl = parent.english
      ? `${SITE_URL}/en/${encodeUrlPath(parent.path)}`
      : undefined;
    const parentTitleBg = stripTitleSuffix(parent.title);
    const parentTitleEn = parent.english
      ? stripTitleSuffix(parent.english.title)
      : parentTitleBg;

    for (const tab of CANDIDATE_SUB_TABS) {
      const subPath = `${parent.path}/${tab.slug}`;
      result.push({
        path: subPath,
        title: `${parentTitleBg} — ${tab.bg}${TITLE_SUFFIX}`,
        description: parent.description,
        ogImage: parent.ogImage,
        canonicalUrl: parentUrl,
        ...(parent.english
          ? {
              english: {
                title: `${parentTitleEn} — ${tab.en}${TITLE_SUFFIX}`,
                description: parent.english.description,
                canonicalUrl: parentEnUrl,
              },
            }
          : {}),
      });
    }
  }
  return result;
};

export const buildSectionRoutes = (
  publicFolder: string,
  latestElection: string,
  oblastNames: Map<string, string>,
): PrerenderRoute[] => {
  const idxFile = path.join(
    publicFolder,
    latestElection,
    "sections_index.json",
  );
  if (!fs.existsSync(idxFile)) return [];
  const idx: SectionIndex[] = JSON.parse(fs.readFileSync(idxFile, "utf-8"));

  // Load all per-oblast section files once into a single map.
  const sectionMap = new Map<string, SectionInfo>();
  const byDir = path.join(
    publicFolder,
    latestElection,
    "sections",
    "by-oblast",
  );
  if (fs.existsSync(byDir)) {
    for (const f of fs.readdirSync(byDir)) {
      if (!f.endsWith(".json")) continue;
      const data: Record<string, SectionInfo> = JSON.parse(
        fs.readFileSync(path.join(byDir, f), "utf-8"),
      );
      for (const [k, v] of Object.entries(data)) sectionMap.set(k, v);
    }
  }

  // Map partyNum → nickName for vote labels.
  const partiesFile = path.join(
    publicFolder,
    latestElection,
    "cik_parties.json",
  );
  const partyLabels = new Map<number, string>();
  if (fs.existsSync(partiesFile)) {
    const parties: PartyInfo[] = JSON.parse(
      fs.readFileSync(partiesFile, "utf-8"),
    );
    for (const p of parties) partyLabels.set(p.number, p.nickName || p.name);
  }

  // Settlement aggregates — turnout + winning party — used to give every
  // section a settlement-relative comparison line in the prerendered body.
  type SettlementAgg = {
    settlementName: string;
    turnoutPct: number;
    winnerPartyNum: number;
    winnerNickName: string;
    winnerPct: number;
  };
  const settlementAgg = new Map<string, SettlementAgg>();
  const settlementsBy = path.join(
    publicFolder,
    latestElection,
    "settlements",
    "by",
  );
  if (fs.existsSync(settlementsBy)) {
    type SettlementBundle = {
      ekatte?: string;
      name?: string;
      t_v_m?: string;
      results?: {
        protocol?: {
          numRegisteredVoters?: number;
          totalActualVoters?: number;
        };
        votes?: Array<{ partyNum: number; totalVotes: number }>;
      };
    };
    for (const f of fs.readdirSync(settlementsBy)) {
      if (!f.endsWith(".json")) continue;
      let bundle: SettlementBundle[];
      try {
        bundle = JSON.parse(
          fs.readFileSync(path.join(settlementsBy, f), "utf-8"),
        );
      } catch {
        continue;
      }
      for (const s of bundle) {
        if (!s.ekatte || !s.results) continue;
        const reg = s.results.protocol?.numRegisteredVoters ?? 0;
        const act = s.results.protocol?.totalActualVoters ?? 0;
        if (reg <= 0) continue;
        const votes = s.results.votes ?? [];
        const total = votes.reduce((a, v) => a + (v.totalVotes ?? 0), 0);
        if (total <= 0) continue;
        let top = votes[0];
        for (const v of votes)
          if ((v.totalVotes ?? 0) > (top.totalVotes ?? 0)) top = v;
        const settlementName =
          `${s.t_v_m ? s.t_v_m + " " : ""}${s.name ?? ""}`.trim();
        settlementAgg.set(s.ekatte, {
          settlementName,
          turnoutPct: (act / reg) * 100,
          winnerPartyNum: top.partyNum,
          winnerNickName: partyLabels.get(top.partyNum) ?? `№${top.partyNum}`,
          winnerPct: (top.totalVotes / total) * 100,
        });
      }
    }
  }

  // National pct per party — for the "vs нац." delta column in the section
  // top-parties table.
  const nationalPctByParty = new Map<number, number>();
  const nsFile = path.join(
    publicFolder,
    latestElection,
    "national_summary.json",
  );
  if (fs.existsSync(nsFile)) {
    try {
      const ns: NationalSummaryFile = JSON.parse(
        fs.readFileSync(nsFile, "utf-8"),
      );
      for (const p of ns.parties) nationalPctByParty.set(p.partyNum, p.pct);
    } catch {
      // ignore
    }
  }

  // Risk-neighborhood flag per section — adds a paragraph on flagged sections.
  const flaggedSections = new Map<string, { name: string; city: string }>();
  const psFile = path.join(
    publicFolder,
    latestElection,
    "problem_sections.json",
  );
  if (fs.existsSync(psFile)) {
    try {
      const ps: {
        neighborhoods: Array<{
          name_bg: string;
          city_bg: string;
          sections: Array<{ section: string }>;
        }>;
      } = JSON.parse(fs.readFileSync(psFile, "utf-8"));
      for (const n of ps.neighborhoods) {
        for (const sec of n.sections) {
          flaggedSections.set(sec.section, {
            name: n.name_bg,
            city: n.city_bg,
          });
        }
      }
    } catch {
      // ignore
    }
  }

  const result: PrerenderRoute[] = [];
  for (const { section, settlement } of idx) {
    const info = sectionMap.get(section);
    const oblastCode = info?.oblast;
    const oblastName = oblastCode ? oblastNames.get(oblastCode) : undefined;
    const url = `${SITE_URL}/section/${section}`;
    const ekatte = info?.ekatte;
    const address = info?.address;
    const placeLabel = oblastName
      ? `${settlement}, обл. ${oblastName}`
      : settlement;
    const title = `Избирателна секция №${section} — ${placeLabel} | electionsbg.com`;
    const description = address
      ? `Резултати по партии в избирателна секция №${section} — ${placeLabel}. Адрес: ${address}.`
      : `Резултати по партии в избирателна секция №${section} — ${placeLabel}.`;
    const breadcrumb: Array<{ name: string; url: string }> = [
      { name: "Начало", url: `${SITE_URL}/` },
    ];
    if (oblastCode && oblastName) {
      breadcrumb.push({
        name: `Област ${oblastName}`,
        url: `${SITE_URL}/municipality/${oblastCode}`,
      });
    }
    if (ekatte) {
      breadcrumb.push({
        name: settlement,
        url: `${SITE_URL}/settlement/${ekatte}`,
      });
    }
    breadcrumb.push({ name: `№${section}`, url });

    const votes: Votes[] | undefined = info?.results?.votes;
    const totalValidVotes = votes
      ? votes.reduce((sum, v) => sum + (v.totalVotes ?? 0), 0)
      : 0;
    const topVotes = votes
      ? [...votes]
          .filter((v) => (v.totalVotes ?? 0) > 0)
          .sort((a, b) => (b.totalVotes ?? 0) - (a.totalVotes ?? 0))
          .slice(0, 5)
          .map((v) => ({
            partyNum: v.partyNum,
            nickName: partyLabels.get(v.partyNum) ?? `№${v.partyNum}`,
            totalVotes: v.totalVotes ?? 0,
          }))
      : undefined;

    result.push({
      path: `section/${section}`,
      title,
      description,
      bodyHtml: buildSectionBody({
        section,
        settlement,
        oblastName,
        oblastCode,
        ekatte,
        address,
        protocol: info?.results?.protocol,
        topVotes,
        totalValidVotes,
        settlementContext: ekatte ? settlementAgg.get(ekatte) : undefined,
        nationalPctByParty,
        flaggedNeighborhood: flaggedSections.get(section),
      }),
      jsonLd: [
        buildWebPageLd({ title, description, url }),
        buildBreadcrumbLd(breadcrumb),
      ],
    });
  }
  return result;
};

// Title-only sub-tab variants for party and municipality landing pages. Each
// derivative reuses the parent's body content but gets a tab-specific title
// and description, so non-JS crawlers see meaningful metadata at the deeper
// URLs that we already declare in the sitemap.
const PARTY_SUB_TABS: Array<{ slug: string; bg: string; en: string }> = [
  { slug: "regions", bg: "по области", en: "by region" },
  { slug: "municipalities", bg: "по общини", en: "by municipality" },
  { slug: "settlements", bg: "по населени места", en: "by settlement" },
  { slug: "preferences", bg: "преференции", en: "preference votes" },
  { slug: "donors", bg: "дарители", en: "donors" },
  { slug: "donors/list", bg: "списък дарители", en: "donor list" },
  { slug: "income", bg: "приходи", en: "campaign income" },
  { slug: "expenses", bg: "разходи", en: "campaign expenses" },
];

const OBLAST_SUB_TABS: Array<{ slug: string; bg: string }> = [
  { slug: "parties", bg: "по партии" },
  { slug: "preferences", bg: "преференции" },
  { slug: "flash-memory", bg: "машинно гласуване" },
  { slug: "municipalities", bg: "по общини" },
  { slug: "recount", bg: "повторно преброяване" },
];

const buildPartySubTabRoutes = (
  parties: PartyInfo[],
  parents: Map<number, PrerenderRoute>,
): PrerenderRoute[] => {
  const result: PrerenderRoute[] = [];
  for (const p of parties) {
    const parent = parents.get(p.number);
    if (!parent) continue;
    const label =
      p.name && p.name !== p.nickName
        ? `${p.name} (${p.nickName})`
        : p.nickName;
    for (const tab of PARTY_SUB_TABS) {
      const url = `${SITE_URL}/party/${p.nickName}/${tab.slug}`;
      const enUrl = `${SITE_URL}/en/party/${p.nickName}/${tab.slug}`;
      result.push({
        path: `party/${p.nickName}/${tab.slug}`,
        title: `${label} — ${tab.bg} | electionsbg.com`,
        description: `Резултати на ${label} ${tab.bg} на парламентарните избори в България.`,
        ogImage: parent.ogImage,
        bodyHtml: parent.bodyHtml,
        jsonLd: [
          buildBreadcrumbLd([
            { name: "Начало", url: `${SITE_URL}/` },
            { name: label, url: `${SITE_URL}/party/${p.nickName}` },
            { name: tab.bg, url },
          ]),
        ],
        english: {
          title: `${label} — ${tab.en} | electionsbg.com`,
          description: `Results of ${label} ${tab.en} in Bulgaria's parliamentary elections.`,
          bodyHtml: parent.bodyHtml,
          jsonLd: [
            buildBreadcrumbLd([
              { name: "Home", url: `${SITE_URL}/en/` },
              { name: label, url: `${SITE_URL}/en/party/${p.nickName}` },
              { name: tab.en, url: enUrl },
            ]),
          ],
        },
      });
    }
  }
  return result;
};

const buildOblastSubTabRoutes = (
  regions: RegionInfo[],
  parents: Map<string, PrerenderRoute>,
): PrerenderRoute[] => {
  const result: PrerenderRoute[] = [];
  for (const r of regions.filter((reg) => reg.oblast !== "32")) {
    const parent = parents.get(r.oblast);
    if (!parent) continue;
    const displayName = oblastDisplayName(r);
    for (const tab of OBLAST_SUB_TABS) {
      const url = `${SITE_URL}/municipality/${r.oblast}/${tab.slug}`;
      result.push({
        path: `municipality/${r.oblast}/${tab.slug}`,
        title: `${displayName} — ${tab.bg} | Парламентарни избори | electionsbg.com`,
        description: `Резултати ${tab.bg} в област ${displayName} на парламентарните избори в България.`,
        ogImage: parent.ogImage,
        bodyHtml: parent.bodyHtml,
        jsonLd: [
          buildBreadcrumbLd([
            { name: "Начало", url: `${SITE_URL}/` },
            {
              name: `Област ${displayName}`,
              url: `${SITE_URL}/municipality/${r.oblast}`,
            },
            { name: tab.bg, url },
          ]),
        ],
      });
    }
  }
  return result;
};

export const buildElectionLandingRoutes = (
  publicFolder: string,
  electionsFile: string,
): PrerenderRoute[] => {
  if (!fs.existsSync(electionsFile)) return [];
  const elections: ElectionInfo[] = JSON.parse(
    fs.readFileSync(electionsFile, "utf-8"),
  );
  return elections
    .filter((e) => /^\d{4}_\d{2}_\d{2}$/.test(e.name))
    .map((e) => {
      const date = e.name;
      const dateLabel = formatElectionDateBg(date);
      const dateLabelEn = formatElectionDateEn(date);
      const url = `${SITE_URL}/elections/${date}`;
      const enUrl = `${SITE_URL}/en/elections/${date}`;
      const title = `Парламентарни избори ${dateLabel} в България — резултати | electionsbg.com`;
      const description = `Резултати от парламентарните избори в България на ${dateLabel} — избирателна активност, разпределение на гласове и мандати по партии, машинно и хартиено гласуване, отклонения по секции.`;
      const titleEn = `Bulgarian parliamentary elections ${dateLabelEn} — results | electionsbg.com`;
      const descriptionEn = `Results of the Bulgarian parliamentary elections on ${dateLabelEn} — turnout, vote and seat distribution by party, paper vs. machine voting, section-level anomalies.`;
      const distribution = [
        {
          url: `${DATA_URL}/${date}/national_summary.json`,
          name: "Национално резюме (JSON)",
        },
        {
          url: `${DATA_URL}/${date}/region_votes.json`,
          name: "Резултати по области (JSON)",
        },
        {
          url: `${DATA_URL}/${date}/cik_parties.json`,
          name: "Списък на партиите (JSON)",
        },
      ];
      const distributionEn = [
        {
          url: `${DATA_URL}/${date}/national_summary.json`,
          name: "National summary (JSON)",
        },
        {
          url: `${DATA_URL}/${date}/region_votes.json`,
          name: "Results by region (JSON)",
        },
        {
          url: `${DATA_URL}/${date}/cik_parties.json`,
          name: "Party list (JSON)",
        },
      ];
      return {
        path: `elections/${date}`,
        title,
        description,
        bodyHtml: buildElectionLandingBody(publicFolder, date),
        jsonLd: [
          buildDatasetLd({
            name: `Парламентарни избори ${dateLabel} — резултати`,
            description,
            url,
            spatialCoverage: "България",
            keywords: [
              "парламентарни избори",
              dateLabel,
              "резултати",
              "България",
            ],
            distribution,
          }),
          buildBreadcrumbLd([
            { name: "Начало", url: `${SITE_URL}/` },
            { name: `Избори ${dateLabel}`, url },
          ]),
        ],
        english: {
          title: titleEn,
          description: descriptionEn,
          bodyHtml: buildElectionLandingBodyEn(publicFolder, date),
          jsonLd: [
            buildDatasetLd({
              name: `Bulgarian parliamentary elections ${dateLabelEn} — results`,
              description: descriptionEn,
              url: enUrl,
              spatialCoverage: "Bulgaria",
              keywords: [
                "Bulgarian parliamentary elections",
                dateLabelEn,
                "results",
                "Bulgaria",
              ],
              distribution: distributionEn,
            }),
            buildBreadcrumbLd([
              { name: "Home", url: `${SITE_URL}/en/` },
              { name: `Elections ${dateLabelEn}`, url: enUrl },
            ]),
          ],
        },
      };
    });
};

type PollAgency = {
  id: string;
  name_bg: string;
  name_en: string;
  abbr_bg?: string;
  website?: string | null;
};

export const buildPollsRoutes = (publicFolder: string): PrerenderRoute[] => {
  const agenciesFile = path.join(publicFolder, "polls", "agencies.json");
  if (!fs.existsSync(agenciesFile)) return [];
  const agencies: PollAgency[] = JSON.parse(
    fs.readFileSync(agenciesFile, "utf-8"),
  );
  const result: PrerenderRoute[] = [
    {
      path: "polls",
      title:
        "Социологически проучвания преди парламентарни избори | electionsbg.com",
      description:
        "Точност на социологическите агенции преди българските парламентарни избори — средна абсолютна грешка по партии, профил на отклоненията и предупреждения по агенции.",
      bodyHtml: buildPollsBody(publicFolder),
      jsonLd: [
        buildDatasetLd({
          name: "Точност на социологическите проучвания за парламентарни избори в България",
          description:
            "Сравнителен анализ на агенциите за социологически проучвания спрямо реалните резултати от вотовете.",
          url: `${SITE_URL}/polls`,
          spatialCoverage: "България",
          keywords: [
            "социологически проучвания",
            "парламентарни избори",
            "точност",
            "агенции",
          ],
          distribution: [
            {
              url: `${DATA_URL}/polls/polls.json`,
              name: "Сурови проучвания (JSON)",
            },
            {
              url: `${DATA_URL}/polls/accuracy.json`,
              name: "Грешки по проучване (JSON)",
            },
            {
              url: `${DATA_URL}/polls/analysis.json`,
              name: "Анализ на агенции (JSON)",
            },
          ],
        }),
        buildBreadcrumbLd([
          { name: "Начало", url: `${SITE_URL}/` },
          { name: "Социологически проучвания", url: `${SITE_URL}/polls` },
        ]),
      ],
    },
  ];
  for (const a of agencies) {
    const url = `${SITE_URL}/polls/${encodeURIComponent(a.id)}`;
    const title = `${a.name_bg} — точност на социологическите проучвания | electionsbg.com`;
    const description = `Точност, систематични отклонения (lean) и предупреждения за социологическата агенция ${a.name_bg} спрямо реалните резултати от парламентарните избори в България.`;
    result.push({
      path: `polls/${a.id}`,
      title,
      description,
      bodyHtml: buildPollsAgencyBody(publicFolder, a),
      jsonLd: [
        buildWebPageLd({ title, description, url }),
        buildBreadcrumbLd([
          { name: "Начало", url: `${SITE_URL}/` },
          { name: "Социологически проучвания", url: `${SITE_URL}/polls` },
          { name: a.name_bg, url },
        ]),
      ],
    });
  }
  return result;
};

// Static report pages live at /reports/{scope}/{report}. Each one is a
// distinct keyword target ("избирателна активност по области", "повторно
// преброяване по секции") so we emit unique title/description/body per page.
type ReportEntry = {
  slug: string;
  bgTitle: string;
  bgDesc: string;
  bgBody: string;
};

const SETTLEMENT_REPORTS: ReportEntry[] = [
  {
    slug: "concentrated",
    bgTitle: "Концентриран вот по населени места",
    bgDesc:
      "Населени места с прекомерно концентриран вот за една партия — индикатор за организирано гласуване.",
    bgBody:
      "Населени места, в които една партия е получила непропорционално висок дял от гласовете спрямо средното за страната. Често срещан индикатор за организирано или контролирано гласуване, особено при ниско общо население на секцията.",
  },
  {
    slug: "top_gainers",
    bgTitle: "Най-голям ръст по населени места",
    bgDesc:
      "Населени места с най-голямо увеличение на гласовете за дадена партия спрямо предходния вот.",
    bgBody:
      "Населени места, в които конкретна партия отбелязва най-голям ръст спрямо предишния парламентарен вот. Полезно за идентифициране на нови мобилизационни усилия или разширяване на електоралната база.",
  },
  {
    slug: "top_losers",
    bgTitle: "Най-голям спад по населени места",
    bgDesc:
      "Населени места с най-голяма загуба на гласове за дадена партия спрямо предходния вот.",
    bgBody:
      "Населени места, в които партия губи най-много гласове спрямо предходния вот. Често обяснимо с разпад на коалиции, смяна на лидер или загуба на местен организатор.",
  },
  {
    slug: "turnout",
    bgTitle: "Избирателна активност по населени места",
    bgDesc:
      "Класация на населените места по избирателна активност в последния парламентарен вот.",
    bgBody:
      "Избирателната активност на ниво населено място — съотношението между гласувалите и регистрираните избиратели. Показва откроени високи и ниски стойности, които често маркират организирано гласуване или обезлюдяване.",
  },
  {
    slug: "invalid_ballots",
    bgTitle: "Недействителни бюлетини по населени места",
    bgDesc:
      "Населени места с най-висок дял недействителни бюлетини на парламентарния вот.",
    bgBody:
      "Делът на недействителните бюлетини спрямо общия брой гласове в населеното място. Високите стойности често са знак за нискa избирателна култура или нарочно объркани бюлетини.",
  },
  {
    slug: "additional_voters",
    bgTitle: "Дописани избиратели по населени места",
    bgDesc:
      "Населени места с най-много избиратели, дописани в избирателния списък в изборния ден.",
    bgBody:
      "Брой избиратели, дописани в допълнителния списък на изборния ден. Прекомерните стойности будят подозрения за организиран „избирателен туризъм“.",
  },
  {
    slug: "supports_no_one",
    bgTitle: "Глас „не подкрепям никого“ по населени места",
    bgDesc:
      "Населени места с най-висок дял на гласове „не подкрепям никого“ — протестен вот.",
    bgBody:
      "Делът на гласовете „не подкрепям никого“ спрямо общия брой гласове. Класически протестен вот — отделянето му от партиите помага да се измери истинският му обхват.",
  },
  {
    slug: "recount",
    bgTitle: "Повторно преброяване по населени места",
    bgDesc:
      "Населени места с най-голяма разлика между първо и второ преброяване на бюлетините.",
    bgBody:
      "Сборът на абсолютните разлики между първото броене в СИК и повторното броене в РИК. Високите стойности маркират проблеми в първоначалното отчитане.",
  },
  {
    slug: "flash_memory",
    bgTitle: "Машинно гласуване по населени места",
    bgDesc:
      "Обхват на машинното гласуване в българските населени места — секции с/без флашка.",
    bgBody:
      "Делът на секциите в населено място, в които е работело СУЕМГ устройство. Индикатор за достъпност на електронното гласуване извън градските центрове.",
  },
  {
    slug: "flash_memory_added",
    bgTitle: "Добавени машини за гласуване по населени места",
    bgDesc:
      "Населени места, в които СУЕМГ устройства са били добавени в последния момент преди изборния ден.",
    bgBody:
      "Брой машини за гласуване, добавени към секциите след първоначалния списък. Често маркира логистични проблеми с разпределението на устройствата.",
  },
  {
    slug: "flash_memory_removed",
    bgTitle: "Премахнати машини за гласуване по населени места",
    bgDesc:
      "Населени места, в които СУЕМГ устройства са били премахнати преди или по време на изборния ден.",
    bgBody:
      "Брой машини за гласуване, премахнати от секциите преди или по време на изборния ден. Често свързано с разпоредено хартиено гласуване след технически проблем.",
  },
  {
    slug: "missing_flash_memory",
    bgTitle: "Липсваща флашка за машинно гласуване по населени места",
    bgDesc:
      "Населени места с регистрирани липсващи флаш-памети в СУЕМГ устройствата.",
    bgBody:
      "Секции, в които флаш-паметта на СУЕМГ устройството липсва или не е приета от РИК. Серьозен инцидент — гласовете трябва да се възстановят от хартиена разпечатка.",
  },
];

const MUNICIPALITY_REPORTS: ReportEntry[] = SETTLEMENT_REPORTS.map((r) => ({
  ...r,
  bgTitle: r.bgTitle.replace("по населени места", "по общини"),
  bgDesc: r.bgDesc.replace(/населен[иa] места?/g, "общини"),
  bgBody: r.bgBody
    .replace(/населен[иa] места?/g, "общини")
    .replace(/населено място/g, "община"),
}));

const SECTION_REPORTS: ReportEntry[] = [
  ...SETTLEMENT_REPORTS.map((r) => ({
    ...r,
    bgTitle: r.bgTitle.replace("по населени места", "по секции"),
    bgDesc: r.bgDesc.replace(/населен[иa] места?/g, "секции"),
    bgBody: r.bgBody
      .replace(/населен[иa] места?/g, "секции")
      .replace(/населено място/g, "секция"),
  })),
  {
    slug: "recount_zero_votes",
    bgTitle: "Повторно преброяване с нулиране на гласове по секции",
    bgDesc:
      "Секции, в които повторното преброяване свежда гласовете на партия до нула.",
    bgBody:
      "Особено крайни случаи на повторно преброяване — секции, в които второто броене изважда всички гласове на дадена партия. Маркира сериозен проблем в първоначалния протокол.",
  },
  {
    slug: "problem_sections",
    bgTitle: "Проблемни секции — обобщен преглед",
    bgDesc:
      "Списък на секциите с натрупани отклонения по различни доклади — повторно преброяване, машинно гласуване, отклонения по партии.",
    bgBody:
      "Обобщеният списък на секциите, които се появяват в няколко независими доклада за отклонения. Това са секциите, които изискват ръчна проверка — машинна срещу хартиена разлика, нулирано броене, организирано гласуване, дописани избиратели.",
  },
];

const buildReportRoutes = (
  scope: "settlement" | "municipality" | "section",
  reports: ReportEntry[],
): PrerenderRoute[] => {
  const scopeLabelBg =
    scope === "settlement"
      ? "населени места"
      : scope === "municipality"
        ? "общини"
        : "секции";
  return reports.map((r) => {
    const url = `${SITE_URL}/reports/${scope}/${r.slug}`;
    const title = `${r.bgTitle} — Парламентарни избори | electionsbg.com`;
    return {
      path: `reports/${scope}/${r.slug}`,
      title,
      description: r.bgDesc,
      bodyHtml: `
<h1>${r.bgTitle}</h1>
<p>${r.bgBody}</p>
<p>Всички доклади за отклонения по ${scopeLabelBg}: <a href="${SITE_URL}/reports/${scope}/concentrated">концентриран вот</a>, <a href="${SITE_URL}/reports/${scope}/turnout">избирателна активност</a>, <a href="${SITE_URL}/reports/${scope}/recount">повторно преброяване</a>, <a href="${SITE_URL}/reports/${scope}/flash_memory">машинно гласуване</a>.</p>`.trim(),
      jsonLd: [
        buildBreadcrumbLd([
          { name: "Начало", url: `${SITE_URL}/` },
          { name: r.bgTitle, url },
        ]),
      ],
    };
  });
};

// Roll-call sessions: index + one URL per voting day.
//
// Data lives in data/parliament/votes/ (uploaded to the GCS bucket; the
// prerender step reads from the local mirror when present). If the local
// directory isn't there yet — e.g. fresh clone before the watcher has run —
// no votes routes are emitted, so SEO doesn't reference 404s.
interface VotesIndexFile {
  scrapedAt: string;
  ns: string;
  lastDate: string;
  sessions: Array<{
    date: string;
    stenogramId: number;
    items: number;
    file: string;
  }>;
}

const BG_MONTH_NAMES = [
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
];

const formatVoteDateBg = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${parseInt(m[3], 10)} ${BG_MONTH_NAMES[parseInt(m[2], 10) - 1]} ${m[1]} г.`;
};

const formatVoteDateEn = (iso: string): string => {
  const d = new Date(iso + "T00:00:00Z");
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(d);
};

export const buildVotesRoutes = (projectRoot: string): PrerenderRoute[] => {
  const idxFile = path.join(projectRoot, "data/parliament/votes/index.json");
  if (!fs.existsSync(idxFile)) return [];
  let idx: VotesIndexFile;
  try {
    idx = JSON.parse(fs.readFileSync(idxFile, "utf-8"));
  } catch {
    return [];
  }
  if (!idx.sessions?.length) return [];

  const indexUrl = `${SITE_URL}/votes`;
  const totalItems = idx.sessions.reduce((n, s) => n + (s.items ?? 0), 0);
  const result: PrerenderRoute[] = [
    {
      path: "votes",
      title:
        "Поименни гласувания в Народното събрание — данни по точки | electionsbg.com",
      description: `Поименни гласувания в Народното събрание на България. ${idx.sessions.length} заседания, общо ${totalItems} точки. Разбивка по депутат и парламентарна група за всяка точка.`,
      ogImage: "/og/votes.png",
      bodyHtml: `
<h1>Поименни гласувания в Народното събрание</h1>
<p>Архив на всички пленарни заседания, в които Народното събрание е провело поименно гласуване. За всяка точка се записва как е гласувал всеки депутат — "за", "против", "въздържал се" или "отсъствал" — заедно с разбивка по парламентарна група.</p>
<p>Данните се извличат от стенограмите на parliament.bg.</p>`.trim(),
      jsonLd: [
        buildBreadcrumbLd([
          { name: "Начало", url: `${SITE_URL}/` },
          { name: "Поименни гласувания", url: indexUrl },
        ]),
      ],
      // EN index mirror — the per-session pages below already emit /en/votes/{date},
      // so the /en/votes hub must resolve too (the sitemap lists it).
      english: {
        title:
          "Roll-call votes in the National Assembly — per-item data | electionsbg.com",
        description: `Roll-call votes in Bulgaria's National Assembly. ${idx.sessions.length} sittings, ${totalItems} items in total, with a per-MP and per-group breakdown for each item.`,
        bodyHtml: `
<h1>Roll-call votes in the National Assembly</h1>
<p>An archive of every plenary sitting in which the National Assembly held a roll-call vote. For each item we record how every MP voted — "for", "against", "abstained" or "absent" — together with a per-parliamentary-group breakdown.</p>
<p>Data is extracted from the parliament.bg stenographic records.</p>`.trim(),
        jsonLd: [
          buildBreadcrumbLd([
            { name: "Home", url: `${SITE_URL}/en/` },
            { name: "Roll-call votes", url: `${SITE_URL}/en/votes` },
          ]),
        ],
      },
    },
  ];

  for (const s of idx.sessions) {
    const url = `${SITE_URL}/votes/${s.date}`;
    const enUrl = `${SITE_URL}/en/votes/${s.date}`;
    const dateBg = formatVoteDateBg(s.date);
    const dateEn = formatVoteDateEn(s.date);
    const title = `Поименно гласуване — ${dateBg} | electionsbg.com`;
    const description = `Поименно гласуване в Народното събрание на ${dateBg}: ${s.items} точки с разбивка по депутат и парламентарна група.`;
    const titleEn = `Roll-call vote — ${dateEn} | electionsbg.com`;
    const descriptionEn = `Roll-call vote in the Bulgarian National Assembly on ${dateEn}: ${s.items} items with per-MP and per-party breakdowns.`;
    result.push({
      path: `votes/${s.date}`,
      title,
      description,
      ogImage: "/og/votes.png",
      bodyHtml: `
<h1>Поименно гласуване · ${dateBg}</h1>
<p>${s.items} ${s.items === 1 ? "точка" : "точки"} в дневния ред на това заседание. Кликнете върху точка, за да видите как е гласувал всеки депутат и обобщение по парламентарни групи.</p>`.trim(),
      jsonLd: [
        buildWebPageLd({ title, description, url }),
        buildDatasetLd({
          name: `Поименно гласуване — ${dateBg}`,
          description,
          url,
          spatialCoverage: "България",
          keywords: ["поименно гласуване", "Народно събрание", s.date],
          distribution: [
            {
              url: `${DATA_URL}/parliament/votes/sessions/${s.date}.json`,
              name: "Подадени гласове по точки (JSON)",
            },
          ],
        }),
        buildBreadcrumbLd([
          { name: "Начало", url: `${SITE_URL}/` },
          { name: "Поименни гласувания", url: indexUrl },
          { name: dateBg, url },
        ]),
      ],
      english: {
        title: titleEn,
        description: descriptionEn,
        bodyHtml: `
<h1>Roll-call vote · ${dateEn}</h1>
<p>${s.items} ${s.items === 1 ? "item" : "items"} on the agenda for this session. Click an item to see how every MP voted and the per-party breakdown.</p>`.trim(),
        jsonLd: [
          buildWebPageLd({
            title: titleEn,
            description: descriptionEn,
            url: enUrl,
            inLanguage: "en",
          }),
        ],
      },
    });
  }
  return result;
};

export const buildBudgetMinistryRoutes = (
  projectRoot: string,
): PrerenderRoute[] => {
  const dir = path.join(projectRoot, "data/budget/ministries");
  if (!fs.existsSync(dir)) return [];
  type MinistryRollup = {
    nameBg?: string;
    nameEn?: string;
    nodeId?: string;
  };
  const out: PrerenderRoute[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    let m: MinistryRollup;
    try {
      m = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
    } catch {
      continue;
    }
    const slug = m.nodeId ?? f.replace(/\.json$/, "");
    const nameBg = m.nameBg ?? slug;
    const nameEn = m.nameEn ?? nameBg;
    const path_ = `budget/ministry/${slug}`;
    const url = `${SITE_URL}/${path_}`;
    const enUrl = `${SITE_URL}/en/${path_}`;
    const title = `${nameBg} — държавен бюджет | electionsbg.com`;
    const description = `Годишен план срещу изпълнение на ${nameBg} от Закона за държавния бюджет и програмния отчет, плюс обществените поръчки на ведомството.`;
    const titleEn = `${nameEn} — Bulgarian state budget | electionsbg.com`;
    const descriptionEn = `Annual planned-versus-actual figures for ${nameEn} from the State Budget Law and program-execution report, plus the ministry's public-procurement footprint.`;
    out.push({
      path: path_,
      title,
      description,
      bodyHtml: `
<h1>${escapeHtmlMinimal(nameBg)} — държавен бюджет</h1>
<p>Първостепенен разпоредител в Закона за държавния бюджет. На страницата се виждат планираните и изпълнените приходи, разходи и баланс по години, програмният бюджет в по-голяма дълбочина и обществените поръчки на ведомството и неговите второстепенни разпоредители.</p>
<p>Виж и <a href="${SITE_URL}/budget">обобщеното табло на държавния бюджет</a> и <a href="${SITE_URL}/budget/methodology">методологията</a>.</p>`.trim(),
      jsonLd: [
        buildWebPageLd({ title, description, url }),
        buildBreadcrumbLd([
          { name: "Начало", url: `${SITE_URL}/` },
          { name: "Държавен бюджет", url: `${SITE_URL}/budget` },
          { name: nameBg, url },
        ]),
      ],
      english: {
        title: titleEn,
        description: descriptionEn,
        bodyHtml: `
<h1>${escapeHtmlMinimal(nameEn)} — Bulgarian state budget</h1>
<p>This first-level spending unit appears in the State Budget Law. The page shows planned versus actual revenue, expenditure and balance per year, the program-level budget one column deeper, and the public-procurement footprint of the ministry and its secondary spending units.</p>
<p>See also the <a href="${SITE_URL}/en/budget">state-budget dashboard</a> and the <a href="${SITE_URL}/en/budget/methodology">methodology</a>.</p>`.trim(),
        jsonLd: [
          buildWebPageLd({
            title: titleEn,
            description: descriptionEn,
            url: enUrl,
            inLanguage: "en",
          }),
          buildBreadcrumbLd([
            { name: "Home", url: `${SITE_URL}/en/` },
            { name: "State budget", url: `${SITE_URL}/en/budget` },
            { name: nameEn, url: enUrl },
          ]),
        ],
      },
    });
  }
  return out;
};

const escapeHtmlMinimal = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// One prerendered HTML page per non-MP official (cabinet, deputy minister,
// state-agency head, regional governor). Body carries enough text for SEO +
// AI crawlers to summarise: name, role, institution, latest net worth, and a
// pointer to the source register. Mirrors buildBudgetMinistryRoutes shape.
const OFFICIAL_CATEGORY_BG: Record<string, string> = {
  cabinet: "Министър / заместник-министър",
  deputy_minister: "Заместник-министър",
  agency_head: "Ръководител на държавна или изпълнителна агенция",
  regional_governor: "Областен управител",
};

const OFFICIAL_CATEGORY_EN: Record<string, string> = {
  cabinet: "Minister or deputy minister",
  deputy_minister: "Deputy minister",
  agency_head: "Head of a state or executive agency",
  regional_governor: "Regional governor",
};

const formatEurForPrerender = (n: number): string =>
  `€${Math.round(n).toLocaleString("en-GB").replace(/,/g, " ")}`;

export const buildOfficialRoutes = (projectRoot: string): PrerenderRoute[] => {
  const rankingsFile = path.join(
    projectRoot,
    "data/officials/assets-rankings.json",
  );
  if (!fs.existsSync(rankingsFile)) return [];
  type RankingEntry = {
    slug: string;
    name: string;
    category: string;
    institution: string;
    positionTitle: string | null;
    latestDeclarationYear: number;
    netWorthEur: number;
  };
  type Rankings = { topOfficials: RankingEntry[] };
  let rankings: Rankings;
  try {
    rankings = JSON.parse(fs.readFileSync(rankingsFile, "utf-8")) as Rankings;
  } catch {
    return [];
  }
  const out: PrerenderRoute[] = [];
  for (const o of rankings.topOfficials) {
    const slug = o.slug;
    const path_ = `officials/${slug}`;
    const url = `${SITE_URL}/${path_}`;
    const enUrl = `${SITE_URL}/en/${path_}`;
    const name = escapeHtmlMinimal(o.name);
    const institution = escapeHtmlMinimal(o.institution);
    const position = o.positionTitle
      ? escapeHtmlMinimal(o.positionTitle)
      : null;
    const categoryBg = OFFICIAL_CATEGORY_BG[o.category] ?? "Длъжностно лице";
    const categoryEn = OFFICIAL_CATEGORY_EN[o.category] ?? "Public official";
    const netWorth = formatEurForPrerender(o.netWorthEur);
    const title = `${o.name} — декларирано имущество | electionsbg.com`;
    const titleEn = `${o.name} — declared assets | electionsbg.com`;
    const description = `Декларирано нетно имущество ${netWorth} (${o.latestDeclarationYear}) на ${o.name}, ${categoryBg} в ${o.institution}. Източник: Сметна палата.`;
    const descriptionEn = `Declared net worth ${netWorth} (${o.latestDeclarationYear}) for ${o.name}, ${categoryEn} at ${o.institution}. Source: Bulgarian Court of Audit.`;
    out.push({
      path: path_,
      title,
      description,
      bodyHtml: `
<h1>${name}</h1>
<p>${categoryBg} в ${institution}${position ? `. Длъжност: ${position}` : ""}.</p>
<p>Декларирано нетно имущество ${netWorth} от подадената за ${o.latestDeclarationYear} г. декларация за имущество и интереси пред Сметната палата (декларант + съпруг/а, минус задължения).</p>
<p>Виж и <a href="${SITE_URL}/officials/assets">класирането на длъжностните лица по активи</a>. Източник: <a href="https://register.cacbg.bg" rel="nofollow noopener">register.cacbg.bg</a>.</p>`.trim(),
      jsonLd: [
        buildWebPageLd({ title, description, url }),
        buildBreadcrumbLd([
          { name: "Начало", url: `${SITE_URL}/` },
          {
            name: "Длъжностни лица",
            url: `${SITE_URL}/officials/assets`,
          },
          { name: o.name, url },
        ]),
      ],
      english: {
        title: titleEn,
        description: descriptionEn,
        bodyHtml: `
<h1>${name}</h1>
<p>${categoryEn} at ${institution}${position ? `. Position: ${position}` : ""}.</p>
<p>Declared net worth ${netWorth} from the ${o.latestDeclarationYear} property/interest declaration filed with the Court of Audit (declarant + spouse, minus debts).</p>
<p>See also the <a href="${SITE_URL}/en/officials/assets">ranking of officials by declared assets</a>. Source: <a href="https://register.cacbg.bg" rel="nofollow noopener">register.cacbg.bg</a>.</p>`.trim(),
        jsonLd: [
          buildWebPageLd({
            title: titleEn,
            description: descriptionEn,
            url: enUrl,
            inLanguage: "en",
          }),
          buildBreadcrumbLd([
            { name: "Home", url: `${SITE_URL}/en/` },
            {
              name: "Officials",
              url: `${SITE_URL}/en/officials/assets`,
            },
            { name: o.name, url: enUrl },
          ]),
        ],
      },
    });
  }
  return out;
};

// === Local elections =====================================================
// National / region / município dashboard pages for each regular local cycle.
// Cycles come from src/data/json/local_elections.json; region + município
// lists from each cycle's data files. Settlement pages are canonicalised to
// the município page and not prerendered. OG image falls back to the default
// (no per-route local card yet).

// "2023_10_29_mi" → "29.10.2023".
const formatLocalCycleDate = (cycle: string): string => {
  const m = /^(\d{4})_(\d{2})_(\d{2})/.exec(cycle);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : cycle;
};

const regularLocalCyclesFor = (projectRoot: string): string[] => {
  const f = path.join(projectRoot, "src/data/json/local_elections.json");
  if (!fs.existsSync(f)) return [];
  try {
    return (
      JSON.parse(fs.readFileSync(f, "utf-8")) as {
        name: string;
        kind: string;
      }[]
    )
      .filter((c) => c.kind === "regular")
      .map((c) => c.name);
  } catch {
    return [];
  }
};

const isRayonShard = (code: string): boolean => /^S2\d{3}$/.test(code);

type LocalIndexFile = {
  municipalities?: Array<{
    obshtinaCode: string;
    name: string;
    oblast: string;
  }>;
  mayorsByCanonical?: Array<{ displayName: string; count: number }>;
  councilVoteShare?: Array<{ displayName: string; pctOfValid: number }>;
};

export const buildLocalCycleRoutes = (
  projectRoot: string,
): PrerenderRoute[] => {
  const publicFolder = path.join(projectRoot, "data");
  const out: PrerenderRoute[] = [];
  for (const cycle of regularLocalCyclesFor(projectRoot)) {
    const idxFile = path.join(publicFolder, cycle, "index.json");
    if (!fs.existsSync(idxFile)) continue;
    let index: LocalIndexFile;
    try {
      index = JSON.parse(fs.readFileSync(idxFile, "utf-8"));
    } catch {
      continue;
    }
    const date = formatLocalCycleDate(cycle);
    const muniCount = (index.municipalities ?? []).filter(
      (m) => !isRayonShard(m.obshtinaCode),
    ).length;
    const topMayor = (index.mayorsByCanonical ?? [])[0];
    const url = `${SITE_URL}/local/${cycle}`;
    const title = `Местни избори ${date} — резултати | electionsbg.com`;
    const description = `Резултати от местните избори на ${date} в България — кметове на общини и общински съветници по области и общини${
      topMayor ? `. Водеща партия по кметове: ${topMayor.displayName}` : ""
    }.`;
    const titleEn = `Bulgarian Local Elections ${date} — Results | electionsbg.com`;
    const descriptionEn = `Results of the ${date} Bulgarian local elections — municipal mayors and councillors by region and municipality.`;
    const bodyHtml = `<h1>Местни избори ${date}</h1><p>Резултати по ${muniCount} общини — кметове на общини, общински съветници, кметове на кметства и районни кметове. Разгледайте по области и общини.</p>`;
    const bodyHtmlEn = `<h1>Bulgarian local elections ${date}</h1><p>Results across ${muniCount} municipalities — municipal mayors, councillors, village mayors and district mayors. Browse by region and municipality.</p>`;
    out.push({
      path: `local/${cycle}`,
      title,
      description,
      ogImage: `/og/local/${cycle}.png`,
      bodyHtml,
      jsonLd: [
        buildWebPageLd({ title, description, url }),
        buildBreadcrumbLd([
          { name: "Начало", url: `${SITE_URL}/` },
          { name: `Местни избори ${date}`, url },
        ]),
      ],
      english: {
        title: titleEn,
        description: descriptionEn,
        bodyHtml: bodyHtmlEn,
        jsonLd: [
          buildWebPageLd({
            title: titleEn,
            description: descriptionEn,
            url: `${SITE_URL}/en/local/${cycle}`,
          }),
        ],
      },
    });
  }
  return out;
};

export const buildLocalRegionRoutes = (
  projectRoot: string,
  regions: RegionInfo[],
): PrerenderRoute[] => {
  const publicFolder = path.join(projectRoot, "data");
  const nameOf = new Map(regions.map((r) => [r.oblast, oblastDisplayName(r)]));
  const nameEnOf = new Map(
    regions.map((r) => [r.oblast, oblastDisplayNameEn(r)]),
  );
  const out: PrerenderRoute[] = [];
  for (const cycle of regularLocalCyclesFor(projectRoot)) {
    const rsFile = path.join(publicFolder, cycle, "regions_summary.json");
    if (!fs.existsSync(rsFile)) continue;
    let rs: { regions?: Array<{ oblast: string }> };
    try {
      rs = JSON.parse(fs.readFileSync(rsFile, "utf-8"));
    } catch {
      continue;
    }
    const date = formatLocalCycleDate(cycle);
    for (const r of rs.regions ?? []) {
      if (r.oblast === "SOF") continue; // redirects to the município page
      const display = nameOf.get(r.oblast) ?? r.oblast;
      const displayEn = nameEnOf.get(r.oblast) ?? r.oblast;
      const url = `${SITE_URL}/local/${cycle}/region/${r.oblast}`;
      const title = `Местни избори ${date} — област ${display} | electionsbg.com`;
      const description = `Резултати от местните избори на ${date} в област ${display} — кметове по общини и места в общинските съвети по партии.`;
      const titleEn = `Local Elections ${date} — ${displayEn} | electionsbg.com`;
      const descriptionEn = `${date} Bulgarian local-election results in ${displayEn} region — mayors by municipality and council seats by party.`;
      out.push({
        path: `local/${cycle}/region/${r.oblast}`,
        title,
        description,
        ogImage: `/og/local/region/${cycle}/${r.oblast}.png`,
        bodyHtml: `<h1>Местни избори ${date} — област ${escapeHtmlSimple(display)}</h1><p>Кметове по общини и разпределение на местата в общинските съвети по партии.</p>`,
        jsonLd: [
          buildWebPageLd({ title, description, url }),
          buildBreadcrumbLd([
            { name: "Начало", url: `${SITE_URL}/` },
            {
              name: `Местни избори ${date}`,
              url: `${SITE_URL}/local/${cycle}`,
            },
            { name: display, url },
          ]),
        ],
        english: {
          title: titleEn,
          description: descriptionEn,
          bodyHtml: `<h1>Local elections ${date} — ${escapeHtmlSimple(displayEn)}</h1><p>Mayors by municipality and council-seat distribution by party.</p>`,
          jsonLd: [
            buildWebPageLd({
              title: titleEn,
              description: descriptionEn,
              url: `${SITE_URL}/en/local/${cycle}/region/${r.oblast}`,
            }),
          ],
        },
      });
    }
  }
  return out;
};

export const buildLocalMunicipalityRoutes = (
  projectRoot: string,
): PrerenderRoute[] => {
  const publicFolder = path.join(projectRoot, "data");
  const out: PrerenderRoute[] = [];
  for (const cycle of regularLocalCyclesFor(projectRoot)) {
    const idxFile = path.join(publicFolder, cycle, "index.json");
    if (!fs.existsSync(idxFile)) continue;
    let index: LocalIndexFile;
    try {
      index = JSON.parse(fs.readFileSync(idxFile, "utf-8"));
    } catch {
      continue;
    }
    const date = formatLocalCycleDate(cycle);
    for (const m of index.municipalities ?? []) {
      const url = `${SITE_URL}/local/${cycle}/${m.obshtinaCode}`;
      const title = `Местни избори ${date} — ${m.name} | electionsbg.com`;
      const description = `Резултати от местните избори на ${date} в община ${m.name} — кмет на община, общински съвет с избрани съветници и кметове на кметства.`;
      const titleEn = `Local Elections ${date} — ${m.name} | electionsbg.com`;
      const descriptionEn = `${date} Bulgarian local-election results in ${m.name} municipality — municipal mayor, council with elected councillors, and village mayors.`;
      out.push({
        path: `local/${cycle}/${m.obshtinaCode}`,
        title,
        description,
        bodyHtml: `<h1>Местни избори ${date} — ${escapeHtmlSimple(m.name)}</h1><p>Кмет на община, разпределение на местата в общинския съвет и избрани общински съветници, кметове на кметства.</p>`,
        jsonLd: [
          buildWebPageLd({ title, description, url }),
          buildBreadcrumbLd([
            { name: "Начало", url: `${SITE_URL}/` },
            {
              name: `Местни избори ${date}`,
              url: `${SITE_URL}/local/${cycle}`,
            },
            { name: m.name, url },
          ]),
        ],
        english: {
          title: titleEn,
          description: descriptionEn,
          bodyHtml: `<h1>Local elections ${date} — ${escapeHtmlSimple(m.name)}</h1><p>Municipal mayor, council-seat distribution, elected councillors and village mayors.</p>`,
          jsonLd: [
            buildWebPageLd({
              title: titleEn,
              description: descriptionEn,
              url: `${SITE_URL}/en/local/${cycle}/${m.obshtinaCode}`,
            }),
          ],
        },
      });
    }
  }
  return out;
};

export const buildDynamicRoutes = async (
  projectRoot: string,
): Promise<PrerenderRoute[]> => {
  // Election data folders moved to /data/ during the GCS migration. The
  // variable name is kept (`publicFolder`) because every helper in this
  // module takes it as `publicFolder` for historical reasons; threading
  // a rename through the whole module is a separate cleanup.
  const publicFolder = path.join(projectRoot, "data");
  const electionsFile = path.join(projectRoot, "src/data/json/elections.json");
  const regionsFile = path.join(projectRoot, "src/data/json/regions.json");
  const latest = getLatestElection(electionsFile);
  const regions: RegionInfo[] = JSON.parse(
    fs.readFileSync(regionsFile, "utf-8"),
  );
  const oblastNames = buildOblastNameMap(regions);
  const oblastNamesEn = buildOblastNameMapEn(regions);
  const partyRoutes = buildPartyRoutes(publicFolder, latest);
  const oblastRoutes = buildOblastRoutes(regionsFile);

  // Look up parents by their numeric/code key so sub-tab generators can clone
  // the rich body without rebuilding it.
  const partiesFile = path.join(publicFolder, latest, "cik_parties.json");
  const parties: PartyInfo[] = fs.existsSync(partiesFile)
    ? JSON.parse(fs.readFileSync(partiesFile, "utf-8"))
    : [];
  const partyParents = new Map<number, PrerenderRoute>();
  parties.forEach((p, i) => partyParents.set(p.number, partyRoutes[i]));
  const oblastParents = new Map<string, PrerenderRoute>();
  regions
    .filter((r) => r.oblast !== "32")
    .forEach((r, i) => oblastParents.set(r.oblast, oblastRoutes[i]));

  const candidateRoutes = buildCandidateRoutes(
    publicFolder,
    oblastNames,
    oblastNamesEn,
  );

  return [
    ...partyRoutes,
    ...buildPartySubTabRoutes(parties, partyParents),
    ...oblastRoutes,
    ...buildOblastSubTabRoutes(regions, oblastParents),
    ...buildDiasporaRoutes(publicFolder, latest),
    ...buildLocalCycleRoutes(projectRoot),
    ...buildLocalRegionRoutes(projectRoot, regions),
    ...buildLocalMunicipalityRoutes(projectRoot),
    ...buildSettlementRoutes(publicFolder, latest, oblastNames),
    // Governance view — place ladder (country node is a static page in
    // routes.ts; these are the region + município + settlement nodes).
    ...buildGovernanceRegionRoutes(projectRoot, regions),
    ...buildGovernanceMuniRoutes(projectRoot, oblastNames),
    ...buildGovernanceRayonRoutes(projectRoot),
    ...buildGovernancePlaceRoutes(publicFolder, latest, oblastNames),
    ...buildSectionsListRoutes(publicFolder, latest, oblastNames),
    ...buildSectionRoutes(publicFolder, latest, oblastNames),
    ...candidateRoutes,
    // Candidate sub-tab prerendering disabled for now — 369k files (7 tabs x 2 langs) pushed the Firebase Hosting deploy past a reliable size.
    // ...buildCandidateSubTabRoutes(candidateRoutes),
    ...buildPollsRoutes(publicFolder),
    ...buildVotesRoutes(projectRoot),
    ...buildElectionLandingRoutes(publicFolder, electionsFile),
    ...buildReportRoutes("settlement", SETTLEMENT_REPORTS),
    ...buildReportRoutes("municipality", MUNICIPALITY_REPORTS),
    ...buildReportRoutes("section", SECTION_REPORTS),
    // Articles are site content (human-authored markdown + same-origin
    // images), not data — they live under /public/ rather than /data/.
    ...(await buildArticleRoutes(path.join(projectRoot, "public"))),
    ...buildBudgetMinistryRoutes(projectRoot),
    ...buildOfficialRoutes(projectRoot),
    ...buildProcurementSettlementRoutes(projectRoot),
    ...buildFundsThemeRoutes(projectRoot),
  ];
};
