// Routes for which we emit a per-route static HTML file with route-specific
// <title> and OG/Twitter meta tags. The Vite SPA build only produces a single
// index.html, but social-preview crawlers (Twitter, Telegram, Facebook,
// LinkedIn) and Google's first-pass indexer don't execute JavaScript, so they
// need the metadata to be present in the source HTML.

export type PrerenderRoute = {
  path: string; // "" for home, "about" for /about, "reports/section/turnout" for nested
  title: string;
  description: string;
  ogImage?: string; // absolute URL or path under /; defaults to site OG image
  jsonLd?: object[]; // optional schema.org structured data injected as <script type="application/ld+json">
  // Optional sanitized HTML inlined into the static body so non-JS crawlers
  // (most AI/LLM bots) can read actual content. The block is rendered into a
  // hidden #ssg-content element and is invisible to humans — React mounts
  // separately into #root. Pass only safe HTML; no scripts/styles.
  bodyHtml?: string;
  // If set, the emitted <link rel="canonical"> points here instead of the
  // route's own URL, and hreflang alternates are suppressed (the canonical
  // target carries them). Use for thin variants of a parent page (e.g.
  // candidate /sections, /donations) so crawlers consolidate signal to the
  // parent and stop reporting these as "Crawled - currently not indexed".
  canonicalUrl?: string;
  // English variant for /en/{path}. When present we also emit the EN file and
  // wire bidirectional hreflang alternates between the two URLs.
  english?: {
    title: string;
    description: string;
    bodyHtml?: string;
    jsonLd?: object[];
    canonicalUrl?: string;
  };
};

export const SITE_URL = "https://electionsbg.com";
// Per-election data JSON ships from the GCS bucket (post-migration), not
// from the site origin. JSON-LD Dataset distribution URLs need to point at
// the bucket so Google Dataset Search can actually fetch the data — pointing
// at electionsbg.com/2026_04_19/...json would 404 since those files are no
// longer served by Firebase Hosting.
export const DATA_URL = "https://storage.googleapis.com/data-electionsbg-com";
export const DEFAULT_OG_IMAGE = `${SITE_URL}/images/og_image.webp`;

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildBreadcrumbLd,
  buildDataCatalogLd,
  buildDatasetLd,
  buildOrganizationLd,
  buildWebPageLd,
  buildWebSiteLd,
} from "./jsonLd";
import {
  buildArticlesSection,
  buildHomeBody,
  buildHomeBodyEn,
} from "./bodyBuilders";
import { getLatestElection } from "./dynamicRoutes";
import { AGRI_FINANCIAL_YEARS } from "@/data/agri/constants";
import { SECTOR_DASHBOARD_IDS } from "@/screens/sector/sectorDashboards";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");
// Per-election JSON now lives under /data (post-GCS migration); /public only
// holds static site assets like /og, /articles, /fonts.
const DATA_FOLDER = path.join(PROJECT_ROOT, "data");
const PUBLIC_ASSETS_FOLDER = path.join(PROJECT_ROOT, "public");
const ELECTIONS_FILE = path.join(PROJECT_ROOT, "src/data/json/elections.json");
const REGIONS_FILE = path.join(PROJECT_ROOT, "src/data/json/regions.json");

// The /judiciary prerender body quotes real figures — the prerendered HTML is the
// only thing crawlers see, so a number hardcoded here would go stale the next time
// `update-judiciary` rewrites the artifacts, and stay stale in search results.
// Read them from the same committed JSON the app reads. staticPage() runs at build
// time, so this costs nothing at runtime.
//
// These two artifacts are COMMITTED AND REQUIRED AT BUILD TIME: this IIFE runs at
// module scope, so anything importing routes.ts throws on a checkout where they are
// missing. If data/judiciary/ is ever moved behind bucket:sync (the way
// raw_data/judiciary/ is gitignored), this must become a lazy read with a fallback
// first — otherwise the build breaks with a bare ENOENT.
const judiciaryFacts = (() => {
  const caseload = JSON.parse(
    fs.readFileSync(
      path.join(PROJECT_ROOT, "data/judiciary/caseload.json"),
      "utf-8",
    ),
  ) as {
    latestYear: number;
    years: { year: number; total: { filed: number; pendingEnd: number } }[];
  };
  const decl = JSON.parse(
    fs.readFileSync(
      path.join(PROJECT_ROOT, "data/judiciary/declarations.json"),
      "utf-8",
    ),
  ) as {
    totals: {
      declarations: number;
      magistrates: number;
      firstYear: number;
      lastYear: number;
    };
    filingCalendar: {
      total: number;
      byMonth: { month: number; count: number }[];
    };
  };
  const latest =
    caseload.years.find((y) => y.year === caseload.latestYear) ??
    caseload.years[0];
  const may =
    decl.filingCalendar.byMonth.find((m) => m.month === 5)?.count ?? 0;
  const mayShare =
    decl.filingCalendar.total > 0 ? (100 * may) / decl.filingCalendar.total : 0;
  const nfmt = (n: number, locale: string) => n.toLocaleString(locale);
  // Round the backlog to the nearest 10k for the durable "около N хиляди" claim.
  const backlogK = Math.round(latest.total.pendingEnd / 10000) * 10;
  return {
    firstYear: caseload.years[caseload.years.length - 1].year,
    latestYear: caseload.latestYear,
    filedBg: nfmt(latest.total.filed, "bg-BG"),
    filedEn: nfmt(latest.total.filed, "en-US"),
    backlogK,
    declarationsBg: nfmt(decl.totals.declarations, "bg-BG"),
    declarationsEn: nfmt(decl.totals.declarations, "en-US"),
    magistratesBg: nfmt(decl.totals.magistrates, "bg-BG"),
    magistratesEn: nfmt(decl.totals.magistrates, "en-US"),
    declFirst: decl.totals.firstYear,
    declLast: decl.totals.lastYear,
    mayShareBg: mayShare.toLocaleString("bg-BG", { maximumFractionDigits: 1 }),
    mayShareEn: mayShare.toLocaleString("en-US", { maximumFractionDigits: 1 }),
  };
})();

// The /defense prerender body quotes real figures from data/defense/ (committed,
// required at build time) — the crawlable HTML is the only defence text a search
// engine sees, so it carries the live %GDP and export numbers.
const defenseFacts = (() => {
  const gdp = JSON.parse(
    fs.readFileSync(
      path.join(PROJECT_ROOT, "data/defense/gdp_share.json"),
      "utf-8",
    ),
  ) as {
    targets: { hagueTotal: number; hagueYear: number };
    series: { year: number; pct: number }[];
  };
  const exp = JSON.parse(
    fs.readFileSync(
      path.join(PROJECT_ROOT, "data/defense/exports.json"),
      "utf-8",
    ),
  ) as {
    cumulativeSinceInvasionEur: number;
    series: { year: number; totalEur: number }[];
  };
  const latest = gdp.series[gdp.series.length - 1];
  const latestExp = exp.series[exp.series.length - 1];
  const eurBn = (v: number, locale: string) =>
    (v / 1e9).toLocaleString(locale, { maximumFractionDigits: 2 });
  return {
    latestYear: latest.year,
    latestPct: latest.pct,
    targetPct: gdp.targets.hagueTotal,
    targetYear: gdp.targets.hagueYear,
    exportYear: latestExp.year,
    exportBnBg: eurBn(latestExp.totalEur, "bg-BG"),
    exportBnEn: eurBn(latestExp.totalEur, "en-US"),
    cumulativeBnBg: eurBn(exp.cumulativeSinceInvasionEur, "bg-BG"),
    cumulativeBnEn: eurBn(exp.cumulativeSinceInvasionEur, "en-US"),
  };
})();

// The /culture prerender body quotes real figures from the НФЦ overview blob —
// committed and required at build time (data/culture/overview.json).
const cultureFacts = (() => {
  const o = JSON.parse(
    fs.readFileSync(
      path.join(PROJECT_ROOT, "data/culture/overview.json"),
      "utf-8",
    ),
  ) as {
    totalEur: number;
    filmCount: number;
    producerCount: number;
    firstYear: number;
    lastYear: number;
    top10Share: number;
    topProducers: { producer: string }[];
  };
  const eur = (n: number, locale: string) =>
    `€${(n / 1e6).toLocaleString(locale, { maximumFractionDigits: 1 })}М`;
  return {
    firstYear: o.firstYear,
    lastYear: o.lastYear,
    totalBg: eur(o.totalEur, "bg-BG"),
    totalEn: `€${(o.totalEur / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })}M`,
    filmsBg: o.filmCount.toLocaleString("bg-BG"),
    filmsEn: o.filmCount.toLocaleString("en-US"),
    producersBg: o.producerCount.toLocaleString("bg-BG"),
    producersEn: o.producerCount.toLocaleString("en-US"),
    top10Pct: Math.round(o.top10Share * 100),
    biggestProducer: o.topProducers[0]?.producer ?? "—",
  };
})();

// The /pensions body quotes real figures from the committed pensions.json so the
// prerendered HTML (what crawlers read) matches the page. Read at build time; if
// the artifact is ever moved behind bucket:sync, this must become a lazy read.
const pensionFacts = (() => {
  const j = JSON.parse(
    fs.readFileSync(
      path.join(PROJECT_ROOT, "data/budget/noi/pensions.json"),
      "utf-8",
    ),
  ) as {
    latestYear: number;
    national: { year: number; avgPensionBgn: number | null }[];
    distribution: {
      year: number;
      total: number;
      minPensionBgn: number | null;
      brackets: { hi: number | null; count: number }[];
    }[];
    oblasts: Record<
      string,
      { pensions: number | null; bankPaid: number | null }[]
    >;
  };
  const dist =
    j.distribution.find((d) => d.year === j.latestYear) ??
    j.distribution[j.distribution.length - 1];
  const nat =
    j.national.find((n) => n.year === j.latestYear) ??
    j.national[j.national.length - 1];
  const atOrBelowMin = dist.brackets
    .filter(
      (b) =>
        dist.minPensionBgn != null &&
        b.hi != null &&
        b.hi <= dist.minPensionBgn + 0.01,
    )
    .reduce((s, b) => s + b.count, 0);
  const minSharePct = ((100 * atOrBelowMin) / dist.total).toFixed(1);
  const oblastRows = j.oblasts[String(j.latestYear)] ?? [];
  const totPens = oblastRows.reduce((s, r) => s + (r.pensions ?? 0), 0);
  const totBank = oblastRows.reduce((s, r) => s + (r.bankPaid ?? 0), 0);
  const cashSharePct = totPens
    ? (100 * (1 - totBank / totPens)).toFixed(0)
    : "0";
  return {
    latestYear: j.latestYear,
    avgPensionBg: (nat.avgPensionBgn ?? 0).toLocaleString("bg-BG", {
      maximumFractionDigits: 0,
    }),
    minPension: dist.minPensionBgn ?? 0,
    minSharePct,
    cashSharePct,
    pensionersBg: dist.total.toLocaleString("bg-BG"),
    pensionersEn: dist.total.toLocaleString("en-US"),
  };
})();

// The ДФЗ subsidy corpus lives only in Postgres, so the /subsidies body carries
// no payment figures — only the covered financial years, which come from the
// same constant the app's year picker reads. The years have gaps (2018–2020 are
// absent from the source), so we collapse them into ranges rather than claim a
// continuous span.
const AGRI_YEARS_ASC = [...AGRI_FINANCIAL_YEARS].sort((a, b) => a - b);
const AGRI_EARLIEST_YEAR = AGRI_YEARS_ASC[0];
const AGRI_LATEST_YEAR = AGRI_YEARS_ASC[AGRI_YEARS_ASC.length - 1];
const AGRI_YEAR_RANGES = AGRI_YEARS_ASC.reduce<number[][]>((acc, y) => {
  const last = acc[acc.length - 1];
  if (last && y === last[last.length - 1] + 1) last.push(y);
  else acc.push([y]);
  return acc;
}, [])
  .map((r) => (r.length > 1 ? `${r[0]}–${r[r.length - 1]}` : `${r[0]}`))
  .join(", ");

// Crawlable "browse by region" block for the country /governance body. Gives
// the prerendered region-tier pages a real internal link from the well-linked
// country node (which sits in NAV_HUBS), so the ladder country → region →
// município → settlement is fully discoverable. Both langs: the region node is
// the only place-ladder tier with an /en mirror, so the EN block links
// /en/governance/region/{oblast}; the Sofia-city place node is BG-only, so its
// link points at the BG canonical from both bodies.
const buildGovernanceRegionBrowse = (lang: "bg" | "en"): string => {
  if (!fs.existsSync(REGIONS_FILE)) return "";
  try {
    const regions: {
      oblast: string;
      name: string;
      name_en?: string;
      long_name?: string;
      long_name_en?: string;
    }[] = JSON.parse(fs.readFileSync(REGIONS_FILE, "utf-8"));
    const en = lang === "en";
    const base = en ? `${SITE_URL}/en` : SITE_URL;
    const items = regions
      .filter((r) => r.oblast !== "32")
      .map((r) => ({
        oblast: r.oblast,
        name: en
          ? r.long_name_en || r.name_en || r.name
          : r.long_name || r.name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, en ? "en" : "bg"));
    if (!items.length) return "";
    const lis = items
      .map(
        (r) =>
          `<li><a href="${base}/governance/region/${r.oblast}">${
            en ? `${r.name} province` : `област ${r.name}`
          }</a></li>`,
      )
      .join("");
    return en
      ? `
<h2>Browse governance by province</h2>
<p>Pick a province for the regional cut — representation, Article 53 transfers and regional indicators — and drill down to each municipality and settlement:</p>
<ul>${lis}</ul>
<p><a href="${SITE_URL}/governance/SOF00">Governance — Sofia (capital)</a></p>`
      : `
<h2>Разгледайте управлението по област</h2>
<p>Изберете област за регионалния разрез — представителство, средства по Чл. 53 и регионални индикатори — и оттам надолу към всяка община и населено място:</p>
<ul>${lis}</ul>
<p><a href="${SITE_URL}/governance/SOF00">Управление — София (столица)</a></p>`;
  } catch {
    return "";
  }
};
const governanceRegionBrowseHtml = buildGovernanceRegionBrowse("bg");
const governanceRegionBrowseHtmlEn = buildGovernanceRegionBrowse("en");

const joinBody = (...sections: string[]): string =>
  sections.filter(Boolean).join("\n");

const homeBodies = (() => {
  if (!fs.existsSync(ELECTIONS_FILE)) return { bg: "", en: "" };
  try {
    const latest = getLatestElection(ELECTIONS_FILE);
    const articlesBg = buildArticlesSection(PUBLIC_ASSETS_FOLDER, "bg");
    const articlesEn = buildArticlesSection(PUBLIC_ASSETS_FOLDER, "en");
    return {
      bg: joinBody(buildHomeBody(DATA_FOLDER, latest), articlesBg),
      en: joinBody(buildHomeBodyEn(DATA_FOLDER, latest), articlesEn),
    };
  } catch {
    return { bg: "", en: "" };
  }
})();

const HOME_TITLE =
  "Парламентарни избори в България — данни и анализ от 2005 | electionsbg.com";
const HOME_DESCRIPTION =
  "Платформа с отворен код за визуализация и анализ на резултатите от всички парламентарни избори в България от 2005 г. насам — по области, общини, населени места и секции.";
const HOME_TITLE_EN =
  "Bulgarian Parliamentary Elections — Data and Analysis Since 2005 | electionsbg.com";
const HOME_DESCRIPTION_EN =
  "Open-source platform for visualizing and analyzing every Bulgarian parliamentary election since 2005 — broken down by region, municipality, settlement, and polling section.";

// Reused as the body for /sofia and all /sofia/* sub-tabs so non-JS crawlers
// see indexable content under deep tab URLs without per-tab hand-written copy.
const SOFIA_BODY_BG = `
<h1>Резултати в София — парламентарни избори</h1>
<p>Столицата гласува в три многомандатни избирателни района (МИР 23, 24 и 25), всеки със собствен профил на електорално поведение. Тук са обединените резултати — гласуване по партии, преференции, обхват на машинното гласуване и засечени отклонения по секции.</p>
<h2>Какво ще намерите тук</h2>
<ul>
<li><a href="${SITE_URL}/sofia/parties">Резултати по партии</a> — гласове и проценти в трите столични района.</li>
<li><a href="${SITE_URL}/sofia/preferences">Преференции</a> — водещи кандидати с преференциален вот.</li>
<li><a href="${SITE_URL}/sofia/flash-memory">Машинно гласуване</a> — секции с/без флашка и хартиен заместител.</li>
<li><a href="${SITE_URL}/sofia/recount">Повторно преброяване</a> — отклонения между първо и второ броене.</li>
</ul>`.trim();

const SOFIA_BODY_EN = `
<h1>Sofia — Bulgarian Parliamentary Election Results</h1>
<p>The capital votes across three multi-member districts (MIR 23, 24 and 25), each with a distinct electoral profile. This is the consolidated view — party shares, preference votes, machine-voting coverage, and section-level anomalies for the latest parliamentary election.</p>
<h2>Sections</h2>
<ul>
<li><a href="${SITE_URL}/en/sofia/parties">Results by party</a> — votes and percentages across the three Sofia districts.</li>
<li><a href="${SITE_URL}/en/sofia/preferences">Preference votes</a> — top candidates by within-list preference.</li>
<li><a href="${SITE_URL}/en/sofia/flash-memory">Machine voting</a> — sections with and without flash-memory machines.</li>
<li><a href="${SITE_URL}/en/sofia/recount">Recount</a> — discrepancies between first and second tallies.</li>
</ul>`.trim();

type StaticPageOpts = {
  path: string;
  title: string;
  description: string;
  breadcrumbName: string;
  bodyHtml?: string;
  ogImage?: string;
  // When set, <link rel="canonical"> points here instead of the page's own URL
  // (and hreflang alternates are suppressed). Used by /data-changes to
  // consolidate signal onto the /data hub it now redirects to.
  canonicalUrl?: string;
  // Extra JSON-LD appended after the WebPage + BreadcrumbList nodes (e.g. a
  // DataCatalog on /data).
  extraJsonLd?: object[];
  english?: {
    title: string;
    description: string;
    breadcrumbName: string;
    bodyHtml?: string;
    canonicalUrl?: string;
    extraJsonLd?: object[];
  };
};

const staticPage = (opts: StaticPageOpts): PrerenderRoute => {
  const url = `${SITE_URL}/${opts.path}`;
  const enUrl = `${SITE_URL}/en/${opts.path}`;
  return {
    path: opts.path,
    title: opts.title,
    description: opts.description,
    ogImage: opts.ogImage,
    bodyHtml: opts.bodyHtml,
    ...(opts.canonicalUrl ? { canonicalUrl: opts.canonicalUrl } : {}),
    jsonLd: [
      buildWebPageLd({
        title: opts.title,
        description: opts.description,
        url,
      }),
      buildBreadcrumbLd([
        { name: "Начало", url: `${SITE_URL}/` },
        { name: opts.breadcrumbName, url },
      ]),
      ...(opts.extraJsonLd ?? []),
    ],
    ...(opts.english
      ? {
          english: {
            title: opts.english.title,
            description: opts.english.description,
            bodyHtml: opts.english.bodyHtml,
            ...(opts.english.canonicalUrl
              ? { canonicalUrl: opts.english.canonicalUrl }
              : {}),
            jsonLd: [
              buildWebPageLd({
                title: opts.english.title,
                description: opts.english.description,
                url: enUrl,
              }),
              buildBreadcrumbLd([
                { name: "Home", url: `${SITE_URL}/en/` },
                { name: opts.english.breadcrumbName, url: enUrl },
              ]),
              ...(opts.english.extraJsonLd ?? []),
            ],
          },
        }
      : {}),
  };
};

// --- Generic sector dashboards (/sector/:id) --------------------------------
// The sectors that graduated from a single-awarder deep-link to a proper
// /sector/<id> dashboard (SectorDashboardScreen). Kept as a data table + one
// template so all nine share one prose shell; the sitemap enumerates the same
// ids. When a sector grows bespoke thematic data, replace its entry with a
// hand-authored staticPage() like /defense.
type SectorPageContent = {
  id: string;
  eik: string;
  bg: { title: string; description: string; breadcrumb: string; h1: string; intro: string }; // prettier-ignore
  en: { title: string; description: string; breadcrumb: string; h1: string; intro: string }; // prettier-ignore
};

const SECTOR_PAGES: SectorPageContent[] = [
  {
    id: "health",
    eik: "121858220",
    bg: {
      title: "Здравеопазване — обществените поръчки на НЗОК | electionsbg.com",
      description:
        "Обществените поръчки на Националната здравноосигурителна каса (НЗОК): общо възложени, изпълнители и разбивка по договори, категории и процедури.",
      breadcrumb: "Здравеопазване",
      h1: "Здравеопазване — обществените поръчки на НЗОК",
      intro:
        "Националната здравноосигурителна каса администрира ~5,5 млрд. € годишно; обществените поръчки са ~1,5% от тях — останалото (болници, лекарства, лекари) се плаща извън ЗОП. Тази страница обобщава поръчките на касата.",
    },
    en: {
      title: "Health — the NHIF's public procurement | electionsbg.com",
      description:
        "The public procurement of Bulgaria's National Health Insurance Fund (NHIF): total awarded, contractors and the breakdown by contracts, categories and procedures.",
      breadcrumb: "Health",
      h1: "Health — the NHIF's public procurement",
      intro:
        "The National Health Insurance Fund administers ~€5.5bn a year; public procurement is ~1.5% of it — the rest (hospitals, drugs, doctors) is paid outside the procurement law. This page summarises the fund's tenders.",
    },
  },
  {
    id: "roads",
    eik: "000695089",
    bg: {
      title: "Пътища — обществените поръчки на АПИ | electionsbg.com",
      description:
        "Обществените поръчки на Агенция „Пътна инфраструктура“ (АПИ): общо възложени, изпълнители и разбивка по договори за строителство и поддръжка на пътища.",
      breadcrumb: "Пътища",
      h1: "Пътища — обществените поръчки на АПИ",
      intro:
        "Агенция „Пътна инфраструктура“ е най-големият възложител в пътния сектор. Тази страница обобщава нейните поръчки — строителство, рехабилитация и поддръжка — по избрания парламент или за цялата история.",
    },
    en: {
      title: "Roads — the Road Infrastructure Agency's procurement | electionsbg.com", // prettier-ignore
      description:
        "The public procurement of Bulgaria's Road Infrastructure Agency (АПИ): total awarded, contractors and the breakdown of road construction and maintenance contracts.",
      breadcrumb: "Roads",
      h1: "Roads — the Road Infrastructure Agency's procurement",
      intro:
        "The Road Infrastructure Agency is the largest awarder in the roads sector. This page summarises its tenders — construction, rehabilitation and maintenance — for the selected parliament or the full history.",
    },
  },
  {
    id: "transport",
    eik: "000695388",
    bg: {
      title: "Транспорт — обществените поръчки на МТС | electionsbg.com",
      description:
        "Обществените поръчки на Министерството на транспорта и съобщенията (МТС): общо възложени, изпълнители и разбивка по договори.",
      breadcrumb: "Транспорт",
      h1: "Транспорт — обществените поръчки на МТС",
      intro:
        "Тази страница обобщава обществените поръчки на Министерството на транспорта и съобщенията — по избрания парламент или за цялата история.",
    },
    en: {
      title: "Transport — the Ministry of Transport's procurement | electionsbg.com", // prettier-ignore
      description:
        "The public procurement of Bulgaria's Ministry of Transport and Communications (МТС): total awarded, contractors and the breakdown by contracts.",
      breadcrumb: "Transport",
      h1: "Transport — the Ministry of Transport's procurement",
      intro:
        "This page summarises the public procurement of the Ministry of Transport and Communications — for the selected parliament or the full history.",
    },
  },
  {
    id: "social",
    eik: "121082521",
    bg: {
      title: "Осигуряване — обществените поръчки на НОИ | electionsbg.com",
      description:
        "Обществените поръчки на Националния осигурителен институт (НОИ): общо възложени, изпълнители и разбивка по договори.",
      breadcrumb: "Осигуряване",
      h1: "Осигуряване — обществените поръчки на НОИ",
      intro:
        "Националният осигурителен институт изплаща пенсиите и обезщетенията; обществените поръчки са малка част от бюджета му. Тази страница обобщава тези поръчки.",
    },
    en: {
      title: "Social security — the NSSI's procurement | electionsbg.com",
      description:
        "The public procurement of Bulgaria's National Social Security Institute (НОИ): total awarded, contractors and the breakdown by contracts.",
      breadcrumb: "Social security",
      h1: "Social security — the NSSI's procurement",
      intro:
        "The National Social Security Institute pays pensions and benefits; public procurement is a small part of its budget. This page summarises those tenders.",
    },
  },
  {
    id: "revenue",
    eik: "131063188",
    bg: {
      title: "Приходи — обществените поръчки на НАП | electionsbg.com",
      description:
        "Обществените поръчки на Националната агенция за приходите (НАП): общо възложени, изпълнители и разбивка по договори.",
      breadcrumb: "Приходи",
      h1: "Приходи — обществените поръчки на НАП",
      intro:
        "Националната агенция за приходите събира данъците и осигуровките. Тази страница обобщава нейните обществени поръчки — по избрания парламент или за цялата история.",
    },
    en: {
      title: "Revenue — the National Revenue Agency's procurement | electionsbg.com", // prettier-ignore
      description:
        "The public procurement of Bulgaria's National Revenue Agency (НАП): total awarded, contractors and the breakdown by contracts.",
      breadcrumb: "Revenue",
      h1: "Revenue — the National Revenue Agency's procurement",
      intro:
        "The National Revenue Agency collects taxes and social contributions. This page summarises its public procurement — for the selected parliament or the full history.",
    },
  },
  {
    id: "customs",
    eik: "000627597",
    bg: {
      title: "Митници — обществените поръчки на Агенция „Митници“ | electionsbg.com", // prettier-ignore
      description:
        "Обществените поръчки на Агенция „Митници“: общо възложени, изпълнители и разбивка по договори.",
      breadcrumb: "Митници",
      h1: "Митници — обществените поръчки на Агенция „Митници“",
      intro:
        "Агенция „Митници“ събира митата и акцизите. Тази страница обобщава нейните обществени поръчки — по избрания парламент или за цялата история.",
    },
    en: {
      title: "Customs — the Customs Agency's procurement | electionsbg.com",
      description:
        "The public procurement of Bulgaria's Customs Agency (АМ): total awarded, contractors and the breakdown by contracts.",
      breadcrumb: "Customs",
      h1: "Customs — the Customs Agency's procurement",
      intro:
        "The Customs Agency collects duties and excise. This page summarises its public procurement — for the selected parliament or the full history.",
    },
  },
  {
    id: "administration",
    eik: "180680495",
    bg: {
      title: "Администрация — обществените поръчки на МЕУ | electionsbg.com",
      description:
        "Обществените поръчки на Министерството на електронното управление (МЕУ): общо възложени, изпълнители и разбивка по договори.",
      breadcrumb: "Администрация",
      h1: "Администрация — обществените поръчки на МЕУ",
      intro:
        "Министерството на електронното управление изгражда държавните информационни системи. Тази страница обобщава неговите обществени поръчки.",
    },
    en: {
      title: "Administration — the Ministry of e-Government's procurement | electionsbg.com", // prettier-ignore
      description:
        "The public procurement of Bulgaria's Ministry of e-Government (МЕУ): total awarded, contractors and the breakdown by contracts.",
      breadcrumb: "Administration",
      h1: "Administration — the Ministry of e-Government's procurement",
      intro:
        "The Ministry of e-Government builds the state's information systems. This page summarises its public procurement.",
    },
  },
  {
    id: "edu",
    eik: "000695114",
    bg: {
      title: "Образование — обществените поръчки на МОН | electionsbg.com",
      description:
        "Обществените поръчки на Министерството на образованието и науката (МОН): общо възложени, изпълнители и разбивка по договори.",
      breadcrumb: "Образование",
      h1: "Образование — обществените поръчки на МОН",
      intro:
        "Тази страница обобщава обществените поръчки на Министерството на образованието и науката — по избрания парламент или за цялата история.",
    },
    en: {
      title: "Education — the Ministry of Education's procurement | electionsbg.com", // prettier-ignore
      description:
        "The public procurement of Bulgaria's Ministry of Education and Science (МОН): total awarded, contractors and the breakdown by contracts.",
      breadcrumb: "Education",
      h1: "Education — the Ministry of Education's procurement",
      intro:
        "This page summarises the public procurement of the Ministry of Education and Science — for the selected parliament or the full history.",
    },
  },
  {
    id: "agri",
    eik: "121100421",
    bg: {
      title: "Земеделие — обществените поръчки на ДФ „Земеделие“ | electionsbg.com", // prettier-ignore
      description:
        "Обществените поръчки на Държавен фонд „Земеделие“ (ДФЗ): общо възложени, изпълнители и разбивка по договори. Земеделските субсидии са отделно на /subsidies.",
      breadcrumb: "Земеделие",
      h1: "Земеделие — обществените поръчки на ДФ „Земеделие“",
      intro:
        "Държавен фонд „Земеделие“ администрира земеделските субсидии (виж /subsidies) и същевременно е възложител на обществени поръчки. Тази страница обобщава поръчките му.",
    },
    en: {
      title: "Agriculture — State Fund Agriculture's procurement | electionsbg.com", // prettier-ignore
      description:
        "The public procurement of Bulgaria's State Fund Agriculture (ДФЗ): total awarded, contractors and the breakdown by contracts. Farm subsidies are separate, at /subsidies.",
      breadcrumb: "Agriculture",
      h1: "Agriculture — State Fund Agriculture's procurement",
      intro:
        "State Fund Agriculture administers farm subsidies (see /subsidies) and is also a public-procurement awarder. This page summarises its tenders.",
    },
  },
];

const sectorBody = (c: SectorPageContent, lang: "bg" | "en"): string => {
  const s = c[lang];
  const base = lang === "bg" ? SITE_URL : `${SITE_URL}/en`;
  if (lang === "bg") {
    return `
<h1>${s.h1}</h1>
<p>${s.intro}</p>
<h2>Какво ще намерите тук</h2>
<ul>
<li><strong>Общо възложени</strong> — стойността на обществените поръчки на сектора по избрания парламент или за цялата история.</li>
<li><strong>Изпълнители</strong> — кой печели договорите и с каква концентрация.</li>
<li><strong>Договори</strong> — пълната разбивка по договори, категории и процедури.</li>
</ul>
<p>Виж <a href="${base}/awarder/${c.eik}">страницата на възложителя</a> за пълната разбивка и <a href="${base}/governance/sectors">всички държавни сектори</a>.</p>`.trim();
  }
  return `
<h1>${s.h1}</h1>
<p>${s.intro}</p>
<h2>What you'll find</h2>
<ul>
<li><strong>Total awarded</strong> — the sector's public-procurement value for the selected parliament or the full history.</li>
<li><strong>Contractors</strong> — who wins the contracts and how concentrated the spend is.</li>
<li><strong>Contracts</strong> — the full breakdown by contracts, categories and procedures.</li>
</ul>
<p>See the <a href="${base}/awarder/${c.eik}">awarder page</a> for the full breakdown and <a href="${base}/governance/sectors">all state sectors</a>.</p>`.trim();
};

// Fail the build if a graduated sector dashboard has no prerender copy here —
// otherwise it would ship without prerendered HTML (crawlers never see its
// <meta>). SECTOR_PAGES can't be auto-generated (it carries per-sector SEO
// prose), but its coverage of the source-of-truth id list is asserted.
{
  const missing = SECTOR_DASHBOARD_IDS.filter(
    (id) => !SECTOR_PAGES.some((p) => p.id === id),
  );
  if (missing.length)
    throw new Error(
      `prerender SECTOR_PAGES missing sector(s): ${missing.join(", ")}`,
    );
}

const sectorStaticPages = (): PrerenderRoute[] =>
  SECTOR_PAGES.map((c) =>
    staticPage({
      path: `sector/${c.id}`,
      title: c.bg.title,
      description: c.bg.description,
      breadcrumbName: c.bg.breadcrumb,
      ogImage: `/og/sector-${c.id}.png`,
      bodyHtml: sectorBody(c, "bg"),
      english: {
        title: c.en.title,
        description: c.en.description,
        breadcrumbName: c.en.breadcrumb,
        bodyHtml: sectorBody(c, "en"),
      },
    }),
  );

// Headline datasets the site publishes for download, surfaced as a schema.org
// DataCatalog on /data so Google Dataset Search can ingest them. Distribution
// URLs point at the public GCS bucket (DATA_URL) the app itself fetches from.
const LATEST_ELECTION = (() => {
  try {
    return getLatestElection(ELECTIONS_FILE);
  } catch {
    return "2026_04_19";
  }
})();

type CatalogLang = {
  name: string;
  description: string;
  distName: string;
  keywords: string[];
};
type CatalogSpec = {
  page: string; // path after the site root ("" = home)
  dist: string; // path after DATA_URL
  bg: CatalogLang;
  en: CatalogLang;
};

const CATALOG_SPECS: CatalogSpec[] = [
  {
    page: "",
    dist: `/${LATEST_ELECTION}/cik_parties.json`,
    bg: {
      name: "Парламентарни избори — резултати по партии",
      description:
        "Гласове и проценти по партии за всички парламентарни избори в България от 2005 г. насам, по области, общини, населени места и секции.",
      distName: "Резултати по партии (JSON)",
      keywords: ["парламентарни избори", "резултати", "България"],
    },
    en: {
      name: "Parliamentary elections — results by party",
      description:
        "Votes and percentages by party for every Bulgarian parliamentary election since 2005, broken down by region, municipality, settlement and polling section.",
      distName: "Results by party (JSON)",
      keywords: ["parliamentary elections", "results", "Bulgaria"],
    },
  },
  {
    page: "local/2023_10_29_mi",
    dist: "/2023_10_29_mi/index.json",
    bg: {
      name: "Местни избори — резултати",
      description:
        "Резултати за общински съветници и кметове от местните избори, по общини и населени места.",
      distName: "Национални обобщения (JSON)",
      keywords: ["местни избори", "кметове", "общински съвети"],
    },
    en: {
      name: "Local elections — results",
      description:
        "Council and mayoral results from the local elections, by municipality and settlement.",
      distName: "National rollups (JSON)",
      keywords: ["local elections", "mayors", "municipal councils"],
    },
  },
  {
    page: "parliament",
    dist: "/parliament/votes/index.json",
    bg: {
      name: "Поименни гласувания в Народното събрание",
      description:
        "Поименни гласувания по сесии с показатели за лоялност, кохезия и сходство по парламентарни групи.",
      distName: "Индекс на гласуванията (JSON)",
      keywords: ["поименни гласувания", "Народно събрание", "лоялност"],
    },
    en: {
      name: "Parliament roll-call votes",
      description:
        "Roll-call votes by session with loyalty, cohesion and group-similarity metrics.",
      distName: "Votes index (JSON)",
      keywords: ["roll-call votes", "parliament", "loyalty"],
    },
  },
  {
    page: "parliament",
    dist: "/parliament/connections.json",
    bg: {
      name: "Народни представители и бизнес връзки",
      description:
        "Профили на народните представители и граф на бизнес връзките им от имуществените декларации и Търговския регистър.",
      distName: "Граф на връзките (JSON)",
      keywords: ["народни представители", "декларации", "бизнес интереси"],
    },
    en: {
      name: "MPs and business connections",
      description:
        "MP profiles and a graph of their business connections from asset declarations and the Commerce Registry.",
      distName: "Connections graph (JSON)",
      keywords: ["members of parliament", "declarations", "business interests"],
    },
  },
  {
    page: "financing",
    dist: "/financing/reports.json",
    bg: {
      name: "Финансиране на партии",
      description:
        "Годишни финансови отчети на партиите от Сметната палата — статус на подаване по години.",
      distName: "Каталог на отчетите (JSON)",
      keywords: ["финансиране", "партии", "Сметна палата"],
    },
    en: {
      name: "Party financing",
      description:
        "Party annual financial reports from the Court of Audit — filing status by year.",
      distName: "Reports catalogue (JSON)",
      keywords: ["financing", "parties", "Court of Audit"],
    },
  },
  {
    page: "governments",
    dist: "/governments.json",
    bg: {
      name: "Правителства на България",
      description:
        "Състав и продължителност на всяко българско правителство от 2005 г. насам — министър-председател, коалиционни партии, дати на встъпване и оставка и причина за края на всеки кабинет.",
      distName: "Правителства (JSON)",
      keywords: ["правителства", "кабинети", "България"],
    },
    en: {
      name: "Governments of Bulgaria",
      description:
        "Composition and tenure of every Bulgarian government since 2005 — prime minister, coalition parties, start and end dates, and how each cabinet ended.",
      distName: "Governments (JSON)",
      keywords: ["governments", "cabinets", "Bulgaria"],
    },
  },
  {
    page: "demographics",
    dist: "/census_2021.json",
    bg: {
      name: "Преброяване 2021",
      description:
        "Демографски данни от Преброяване 2021 на НСИ — по области, общини и населени места.",
      distName: "Преброяване 2021 (JSON)",
      keywords: ["преброяване", "демография", "НСИ"],
    },
    en: {
      name: "Census 2021",
      description:
        "Demographic data from the NSI Census 2021 — by region, municipality and settlement.",
      distName: "Census 2021 (JSON)",
      keywords: ["census", "demographics", "NSI"],
    },
  },
  {
    page: "indicators",
    dist: "/macro.json",
    bg: {
      name: "Макроикономически индикатори",
      description:
        "Времеви редове за макроикономически индикатори от Евростат, Световната банка и НСИ.",
      distName: "Макро индикатори (JSON)",
      keywords: ["макроикономика", "Евростат", "индикатори"],
    },
    en: {
      name: "Macroeconomic indicators",
      description:
        "Time series of macroeconomic indicators from Eurostat, the World Bank and the NSI.",
      distName: "Macro indicators (JSON)",
      keywords: ["macroeconomics", "Eurostat", "indicators"],
    },
  },
  {
    page: "indicators/economy",
    dist: "/regional.json",
    bg: {
      name: "Регионални индикатори (NUTS 3)",
      description:
        "Регионални индикатори по области — БВП на човек, население и нетна миграция от Евростат.",
      distName: "Регионални индикатори (JSON)",
      keywords: ["региони", "NUTS 3", "БВП"],
    },
    en: {
      name: "Regional indicators (NUTS 3)",
      description:
        "Sub-national indicators by region — GDP per capita, population and net migration from Eurostat.",
      distName: "Regional indicators (JSON)",
      keywords: ["regions", "NUTS 3", "GDP"],
    },
  },
  {
    page: "funds",
    dist: "/funds/index.json",
    bg: {
      name: "Европейски фондове (ИСУН)",
      description:
        "Бенефициенти и договори по европейските фондове от публичния регистър ИСУН.",
      distName: "ЕС фондове (JSON)",
      keywords: ["еврофондове", "ИСУН", "бенефициенти"],
    },
    en: {
      name: "EU funds (ISUN)",
      description:
        "Beneficiaries and contracts under the EU funds from the public ISUN register.",
      distName: "EU funds (JSON)",
      keywords: ["EU funds", "ISUN", "beneficiaries"],
    },
  },
  {
    page: "procurement",
    dist: "/procurement/index.json",
    bg: {
      name: "Обществени поръчки (АОП)",
      description:
        "Обществени поръчки от Агенцията по обществени поръчки — възложители, изпълнители и суми.",
      distName: "Поръчки (JSON)",
      keywords: ["обществени поръчки", "АОП", "договори"],
    },
    en: {
      name: "Public procurement (AOP)",
      description:
        "Public procurement from the Public Procurement Agency — buyers, contractors and amounts.",
      distName: "Procurement (JSON)",
      keywords: ["public procurement", "AOP", "contracts"],
    },
  },
];

const buildDataCatalog = (lang: "bg" | "en") =>
  buildDataCatalogLd({
    name:
      lang === "bg"
        ? "Отворени данни за изборите и управлението в България"
        : "Open data on Bulgarian elections and governance",
    description:
      lang === "bg"
        ? "Каталог на наборите от данни, които electionsbg.com публикува за свободно изтегляне — резултати от избори, гласувания, декларации, финансиране, бюджет и индикатори."
        : "Catalog of the datasets electionsbg.com publishes for free download — election results, roll-call votes, declarations, financing, budget, and indicators.",
    url: `${SITE_URL}/${lang === "en" ? "en/data" : "data"}`,
    datasets: CATALOG_SPECS.map((s) =>
      buildDatasetLd({
        name: s[lang].name,
        description: s[lang].description,
        url: `${SITE_URL}/${lang === "en" ? "en/" : ""}${s.page}`,
        spatialCoverage: lang === "bg" ? "България" : "Bulgaria",
        keywords: s[lang].keywords,
        distribution: [
          {
            url: `${DATA_URL}${s.dist}`,
            format: "application/json",
            name: s[lang].distName,
          },
        ],
      }),
    ),
  });

// The /water body quotes the real riverbed-cleaning total from the committed
// flood_maintenance.json so the prerendered HTML matches the page. Build-time
// read; if the artifact is ever moved behind bucket:sync, make this a lazy read.
const waterFacts = (() => {
  const j = JSON.parse(
    fs.readFileSync(
      path.join(PROJECT_ROOT, "data/water/flood_maintenance.json"),
      "utf-8",
    ),
  ) as { totalEur: number; contractCount: number; awarderCount: number };
  return {
    floodEurMln: Math.round(j.totalEur / 1e6),
    floodContracts: j.contractCount,
    floodAwarders: j.awarderCount,
  };
})();

// The /customs/warehouses body quotes the real active-operator count from the
// committed excise register. Defensive read (the file is written by the
// customs:excise-register ingest) — fall back to a generic body if absent so the
// build never breaks.
const exciseFacts = (() => {
  try {
    const j = JSON.parse(
      fs.readFileSync(
        path.join(PROJECT_ROOT, "data/customs/excise_register.json"),
        "utf-8",
      ),
    ) as { activeOperators: number };
    return { active: j.activeOperators };
  } catch {
    return { active: 0 };
  }
})();

export const prerenderRoutes: PrerenderRoute[] = [
  ...sectorStaticPages(),
  {
    path: "",
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    ogImage: "/og/dashboard-2026-04-19.png",
    bodyHtml: homeBodies.bg,
    jsonLd: [
      buildWebSiteLd(),
      buildOrganizationLd(),
      buildDatasetLd({
        name: "Парламентарни избори в България — пълни резултати от 2005 г.",
        description: HOME_DESCRIPTION,
        url: `${SITE_URL}/`,
        spatialCoverage: "България",
        keywords: [
          "парламентарни избори",
          "България",
          "Bulgaria elections",
          "избирателна активност",
          "машинно гласуване",
          "повторно преброяване",
        ],
      }),
    ],
    english: {
      title: HOME_TITLE_EN,
      description: HOME_DESCRIPTION_EN,
      bodyHtml: homeBodies.en,
      jsonLd: [
        buildWebSiteLd(),
        buildOrganizationLd(),
        buildDatasetLd({
          name: "Bulgarian parliamentary elections — full results since 2005",
          description: HOME_DESCRIPTION_EN,
          url: `${SITE_URL}/en/`,
          spatialCoverage: "Bulgaria",
          keywords: [
            "Bulgarian elections",
            "parliamentary elections",
            "turnout",
            "machine voting",
            "recount",
          ],
        }),
      ],
    },
  },
  staticPage({
    path: "sverka",
    title:
      "Сверка на местните избори — длъжностни лица срещу ЦИК | electionsbg.com",
    description:
      "Национална сверка на избраните на местните избори срещу настоящите длъжностни лица — кметове на общини и общински съветници по общини.",
    breadcrumbName: "Сверка",
    bodyHtml: `<h1>Сверка на местните избори с настоящи длъжностни лица</h1><p>Съпоставка между избраните кметове и общински съветници по ЦИК и настоящия състав на длъжностните лица по общини, с маркиране на разминаванията и замените след извънредни избори.</p>`,
    english: {
      title:
        "Local-Elections Reconciliation — Officials vs. CIK | electionsbg.com",
      description:
        "National reconciliation of local-election winners against the sitting officials — municipal mayors and councillors by municipality.",
      breadcrumbName: "Reconciliation",
      bodyHtml: `<h1>Local-elections reconciliation with sitting officials</h1><p>Mayors and councillors elected per the CIK results compared against the current roster of officials by municipality, flagging mismatches and post-election replacements.</p>`,
    },
  }),
  staticPage({
    path: "customs/warehouses",
    title: "Лицензирани акцизни складодържатели — регистър | electionsbg.com",
    description:
      "Пълен регистър на лицензираните акцизни складодържатели в България — фирмите с лиценз да държат горива, тютюн и алкохол под отложено плащане на акциз, по категория, брой складове и обществени поръчки.",
    breadcrumbName: "Акцизни складодържатели",
    bodyHtml: `<h1>Лицензирани акцизни складодържатели</h1><p>${exciseFacts.active ? `${exciseFacts.active} действащи фирми` : "Фирмите"} с лиценз от Агенция „Митници“ да държат акцизни стоки — горива, тютюн и алкохол — под режим на отложено плащане на акциз. За всяка са показани категорията акцизни стоки, броят складове, статусът и стойността на спечелените обществени поръчки, с връзка към страницата на дружеството. По данни от регистъра на Агенция „Митници“ (BACIS).</p>`,
    english: {
      title: "Licensed Excise Warehouse Keepers — Register | electionsbg.com",
      description:
        "The full register of Bulgaria's licensed excise warehouse keepers — companies licensed to hold fuels, tobacco and alcohol under excise-duty suspension, by category, warehouse count and public procurement.",
      breadcrumbName: "Excise warehouse keepers",
      bodyHtml: `<h1>Licensed excise warehouse keepers</h1><p>${exciseFacts.active ? `${exciseFacts.active} active companies` : "Companies"} licensed by the Bulgarian Customs Agency to hold excise goods — fuels, tobacco and alcohol — under duty suspension. Each shows its excise-goods category, warehouse count, status and public-contract value won, linking to the company's page. Sourced from the Customs Agency (BACIS) register.</p>`,
    },
  }),
  staticPage({
    path: "local/chmi",
    title: "Извънредни местни избори в България | electionsbg.com",
    description:
      "Хронологичен преглед на всички извънредни (частични и нови) местни избори за кметове на общини, кметства и райони.",
    breadcrumbName: "Извънредни местни избори",
    bodyHtml: `<h1>Извънредни местни избори</h1><p>Хронология на частичните и новите местни избори между редовните цикли — кметове на общини, кметове на кметства и районни кметове.</p>`,
    english: {
      title: "Extraordinary Local Elections in Bulgaria | electionsbg.com",
      description:
        "Chronological feed of all extraordinary (partial and new) local elections for municipal, village and district mayors.",
      breadcrumbName: "Extraordinary local elections",
      bodyHtml: `<h1>Extraordinary local elections</h1><p>A chronology of partial and new local elections between the regular cycles — municipal mayors, village mayors and district mayors.</p>`,
    },
  }),
  staticPage({
    path: "sofia",
    title: "Резултати в София — Парламентарни избори | electionsbg.com",
    description:
      "Подробни резултати, обхват на машинното гласуване и отклонения по секции в трите столични района (23, 24 и 25 МИР).",
    breadcrumbName: "София",
    ogImage: "/og/sofia.png",
    bodyHtml: SOFIA_BODY_BG,
    english: {
      title:
        "Sofia — Bulgarian Parliamentary Election Results | electionsbg.com",
      description:
        "Detailed results, machine-voting coverage, and section-level anomalies across the three Sofia electoral districts (MIR 23, 24, and 25).",
      breadcrumbName: "Sofia",
      bodyHtml: SOFIA_BODY_EN,
    },
  }),
  staticPage({
    path: "about",
    title: "За проекта — electionsbg.com",
    description:
      "За екипа, методологията и източниците на electionsbg.com — независима платформа за анализ на парламентарните избори в България.",
    breadcrumbName: "За проекта",
    ogImage: "/og/about.png",
    bodyHtml: `
<h1>За проекта electionsbg.com</h1>
<p>electionsbg.com е независима платформа с отворен код за визуализация и анализ на парламентарните избори в България от 2005 г. насам. Целта е суровите данни на ЦИК и Сметната палата да станат достъпни и сравними — по области, общини, населени места и секции.</p>
<h2>Източници на данни</h2>
<ul>
<li>Резултати от <strong>Централната избирателна комисия (ЦИК)</strong> — протоколи на СИК и национално резюме.</li>
<li>Финансиране на кампаниите от <strong>Сметната палата</strong> — приходи, разходи, дарители.</li>
<li>Социологически проучвания, събрани от българската Уикипедия и сайтовете на агенциите.</li>
<li>Данни за народните представители — <a href="https://www.parliament.bg" rel="nofollow noopener">parliament.bg</a>.</li>
</ul>
<h2>Методология</h2>
<p>Всеки вот е обработен с един и същ pipeline — парсинг на сурови CSV/ZIP файлове, агрегиране на ниво секция → населено място → община → област → държава, плюс набор от независими доклади за отклонения (повторно преброяване, машинно срещу хартиено гласуване, прекомерна концентрация на гласове, изпратени допълнителни избиратели и т.н.).</p>
<p>Кодът е отворен и възпроизводим — приветстваме предложения и поправки.</p>`.trim(),
    english: {
      title: "About — electionsbg.com",
      description:
        "About the team, methodology, and data sources behind electionsbg.com — an independent platform analysing Bulgaria's parliamentary elections.",
      breadcrumbName: "About",
      bodyHtml: `
<h1>About electionsbg.com</h1>
<p>electionsbg.com is an independent open-source platform for visualising and analysing Bulgaria's parliamentary elections since 2005. The goal is to make raw data from the Central Electoral Commission and the National Audit Office accessible and comparable — by region, municipality, settlement, and polling section.</p>
<h2>Data sources</h2>
<ul>
<li>Results from the <strong>Central Electoral Commission (CEC/ЦИК)</strong> — section-level protocols and national summaries.</li>
<li>Campaign financing from the <strong>National Audit Office</strong> — income, expenses, donors.</li>
<li>Polling data from Bulgarian Wikipedia and pollster websites.</li>
<li>Member-of-parliament profiles — <a href="https://www.parliament.bg" rel="nofollow noopener">parliament.bg</a>.</li>
</ul>
<h2>Methodology</h2>
<p>Every vote is processed through the same pipeline — parsing raw CSV/ZIP files, aggregating from section → settlement → municipality → region → country, plus a battery of independent anomaly reports (recount, machine vs. paper voting, vote concentration, additional voters, and more).</p>
<p>The code is open and reproducible — contributions and corrections welcome.</p>`.trim(),
    },
  }),
  staticPage({
    path: "financing",
    title: "Финансиране на партии и предизборни кампании | electionsbg.com",
    description:
      "Декларирани приходи и разходи на политическите партии за всеки парламентарен вот — дарители, кандидати, агенции и изпълнители, медийни и други разходи, с концентрация на дарителите.",
    breadcrumbName: "Финансиране",
    ogImage: "/og/financing.png",
    bodyHtml: `
<h1>Финансиране на партии и предизборни кампании</h1>
<p>Декларираните приходи и разходи на политическите партии и коалиции за всеки парламентарен вот — данни от Единния регистър по Изборния кодекс (ЕРИК) на Сметната палата, обединени и съпоставими между изборите. Включва общия размер на кампанията, структурата на приходите (собствени средства, дарители, кандидати, медиен пакет), разпределението на разходите по типове (медии, реклама, печат, транспорт), индивидуалните дарители и наетите агенции и изпълнители.</p>
<h2>Какво се вижда тук</h2>
<ul>
<li>Съвкупен приход и разход на всяка партия по години, съпоставими между изборите.</li>
<li>Структура на приходите — собствени средства, дарители, кандидати и медиен пакет.</li>
<li>Топ дарители (физически и юридически лица) — суми и брой дарения.</li>
<li>Концентрация на дарителите — какъв дял държат най-едрите дарители за всяка партия.</li>
<li>Агенции и изпълнители — рекламни, социологически и PR фирми, наети от кампаниите, с ЕИК от Търговския регистър.</li>
<li>Разходи по канали — телевизия, радио, интернет, печатни медии, билбордове.</li>
<li>Данни на ниво кандидат — индивидуални приходи/разходи, когато са декларирани.</li>
</ul>
<p>Източник: <a href="https://www.bulnao.government.bg" rel="nofollow noopener">Сметна палата на Република България</a> (ЕРИК).</p>`.trim(),
    english: {
      title:
        "Party and Campaign Financing — Bulgarian Parliamentary Elections | electionsbg.com",
      description:
        "Declared income and expenditures of Bulgarian political parties for each parliamentary vote — donors, candidates, hired agencies and contractors, media and other spending, with donor concentration.",
      breadcrumbName: "Financing",
      bodyHtml: `
<h1>Party and campaign financing</h1>
<p>Declared income and expenditures of Bulgarian political parties and coalitions for each parliamentary vote — data from the National Audit Office's Unified Register under the Election Code (ЕРИК), consolidated and comparable across elections. Includes total campaign size, income structure (self-funding, donors, candidates, media package), breakdown by spending category (media, advertising, print, transport), individual donors, and the agencies and contractors each campaign hired.</p>
<h2>What you'll find</h2>
<ul>
<li>Aggregate income and expenditure per party, by year, comparable across elections.</li>
<li>Income structure — self-funding, donors, candidates and media package.</li>
<li>Top donors (individuals and legal entities) — totals and donation counts.</li>
<li>Donor concentration — the share held by each party's largest donors.</li>
<li>Agencies and contractors — advertising, polling and PR firms hired by campaigns, with company IDs from the Commercial Register.</li>
<li>Spending by channel — TV, radio, internet, print, billboards.</li>
<li>Candidate-level data when declared.</li>
</ul>
<p>Source: <a href="https://www.bulnao.government.bg" rel="nofollow noopener">National Audit Office of Bulgaria</a> (ЕРИК).</p>`.trim(),
    },
  }),
  staticPage({
    path: "financing/annual-reports",
    title: "Годишни финансови отчети на партиите | electionsbg.com",
    description:
      "Кои политически партии са подали годишните си финансови отчети в Сметната палата в срок, със закъснение, с нередности или изобщо — по години от 2011 г.",
    breadcrumbName: "Годишни отчети",
    ogImage: "/og/financing.png",
    bodyHtml: `
<h1>Годишни финансови отчети на партиите</h1>
<p>Политическите партии са длъжни да подават годишен финансов отчет в Сметната палата до 31 март всяка година (чл. 34 от Закона за политическите партии). Този каталог проследява по години статуса на подаване на всяка партия.</p>
<h2>Какво се вижда тук</h2>
<ul>
<li>Партии, подали отчета <strong>в срок</strong> и отговарящи на изискванията.</li>
<li>Партии, подали <strong>със закъснение</strong> след 31 март.</li>
<li>Партии, подали в срок, но <strong>с нередности</strong> във формата или съдържанието.</li>
<li>Партии, <strong>неподали</strong> годишен финансов отчет.</li>
</ul>
<p>Източник: <a href="https://gfopp.bulnao.government.bg" rel="nofollow noopener">регистър на Сметната палата</a>.</p>`.trim(),
    english: {
      title:
        "Party Annual Financial Reports — Court of Audit Filing Status | electionsbg.com",
      description:
        "Which Bulgarian political parties filed their statutory annual financial reports on time, late, with deficiencies, or not at all — by year since 2011.",
      breadcrumbName: "Annual reports",
      bodyHtml: `
<h1>Party annual financial reports</h1>
<p>Political parties must file an annual financial report with the Court of Audit by 31 March each year (Political Parties Act, art. 34). This catalogue tracks each party's filing status, year by year.</p>
<h2>What you'll find</h2>
<ul>
<li>Parties that filed <strong>on time</strong> and met the requirements.</li>
<li>Parties that filed <strong>late</strong>, after the 31 March deadline.</li>
<li>Parties that filed on time but were <strong>non-compliant</strong> on form or content.</li>
<li>Parties that <strong>did not file</strong> an annual financial report.</li>
</ul>
<p>Source: <a href="https://gfopp.bulnao.government.bg" rel="nofollow noopener">Court of Audit register</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "simulator",
    title: "Симулатор на коалиции и разпределение на мандати | electionsbg.com",
    description:
      "Изследвайте как промяната на избирателния праг променя разпределението на 240-те мандата и кои коалиции могат да формират мнозинство от 121.",
    breadcrumbName: "Симулатор",
    ogImage: "/og/simulator.png",
    bodyHtml: `
<h1>Симулатор на коалиции и разпределение на мандати</h1>
<p>Българското Народно събрание има 240 места — за управляващо мнозинство са необходими 121. Изборният праг от 4% определя кои партии получават мандати, но числото не е природна константа. С този симулатор можете да видите как:</p>
<ul>
<li>Праг от 3%, 4%, 5% или произволна стойност променя броя на партиите в парламента.</li>
<li>Се преразпределят мандатите по метода на Хеър/Найемайер при различни прагове.</li>
<li>Кои потенциални коалиции достигат прага от 121 мандата.</li>
</ul>
<p>Симулаторът използва истинските регионални резултати — не пропорционално мащабиране, а същия алгоритъм на разпределение, който прилага ЦИК.</p>`.trim(),
    english: {
      title: "Coalition and Seat-Allocation Simulator | electionsbg.com",
      description:
        "Explore how changes to the electoral threshold reshape the allocation of the 240 parliamentary seats and which coalitions can form a 121-vote majority.",
      breadcrumbName: "Simulator",
      bodyHtml: `
<h1>Coalition and seat-allocation simulator</h1>
<p>Bulgaria's National Assembly has 240 seats — a governing majority needs 121. The 4% electoral threshold determines which parties receive seats, but the number isn't sacred. With this simulator you can explore:</p>
<ul>
<li>How thresholds of 3%, 4%, 5%, or any custom value change the number of parties in parliament.</li>
<li>How seats are reallocated under the Hare/Niemeyer method at different thresholds.</li>
<li>Which potential coalitions reach the 121-seat majority.</li>
</ul>
<p>The simulator uses the real regional results — not proportional scaling, but the same allocation algorithm the Central Electoral Commission applies.</p>`.trim(),
    },
  }),
  staticPage({
    path: "compare",
    title: "Сравнение на парламентарни избори в България | electionsbg.com",
    description:
      "Сравнете рамо до рамо два парламентарни вота — избирателна активност, дял на партиите, мандати и брой секции с отклонения.",
    breadcrumbName: "Сравнение",
    ogImage: "/og/compare.png",
    bodyHtml: `
<h1>Сравнение на парламентарни избори в България</h1>
<p>Изберете два парламентарни вота от 2005 г. насам и ги сравнете рамо до рамо — избирателна активност, дял и мандати на всяка партия, обхват на машинното гласуване, брой секции с отклонения. Полезно за бърз преглед на динамиката между ранна и късна изборна нощ или между два вота с различни управляващи мнозинства.</p>
<h2>Какво се сравнява</h2>
<ul>
<li>Обща избирателна активност и брой действителни гласове.</li>
<li>Гласове, проценти и мандати по партии.</li>
<li>Хартия срещу машинно гласуване — дял на всеки канал.</li>
<li>Брой секции с отклонения от стандартните доклади (повторно преброяване, концентрация на гласове, дописване на избиратели).</li>
</ul>`.trim(),
    english: {
      title: "Compare Bulgarian Parliamentary Elections | electionsbg.com",
      description:
        "Side-by-side comparison of any two parliamentary votes — turnout, party shares, seats, and section-level anomaly counts.",
      breadcrumbName: "Compare",
      bodyHtml: `
<h1>Compare Bulgarian parliamentary elections</h1>
<p>Pick any two parliamentary votes since 2005 and put them side by side — turnout, vote share and seats per party, machine-voting coverage, and section-level anomaly counts. Useful for a quick read on the gap between an early and late election night, or between two votes that produced different governing majorities.</p>
<h2>What's compared</h2>
<ul>
<li>Total turnout and valid-vote count.</li>
<li>Votes, percentages and seats by party.</li>
<li>Paper vs. machine voting — share of each channel.</li>
<li>Number of sections flagged in the anomaly reports (recount, concentration, additional voters).</li>
</ul>`.trim(),
    },
  }),
  staticPage({
    path: "parties",
    title:
      "Всички партии — резултати на парламентарните избори | electionsbg.com",
    description:
      "Пълен списък на партиите и коалициите, участвали в последния парламентарен вот — гласове, проценти и мандати, плюс линкове към подробни профили.",
    breadcrumbName: "Партии",
    bodyHtml: `
<h1>Всички партии на парламентарните избори</h1>
<p>Пълен списък на партиите и коалициите, участвали в последния парламентарен вот в България. За всяка партия са показани общите гласове, процентен дял и брой мандати, ако е преминала избирателния праг от 4%.</p>
<p>Кликнете името на партия, за да видите профила ѝ — резултати по области, общини и населени места, преференции, дарители и разходи за кампанията.</p>`.trim(),
    english: {
      title:
        "All Parties — Bulgarian Parliamentary Election Results | electionsbg.com",
      description:
        "Full list of parties and coalitions running in the latest parliamentary vote — votes, percentages, seats, and links to detailed profiles.",
      breadcrumbName: "Parties",
      bodyHtml: `
<h1>All parties in the parliamentary election</h1>
<p>Full list of parties and coalitions that ran in Bulgaria's latest parliamentary vote. For each party we show total votes, vote share, and seat count when the 4% electoral threshold was met.</p>
<p>Click a party name for its full profile — results by region, municipality and settlement, preference votes, donors, and campaign spending.</p>`.trim(),
    },
  }),
  staticPage({
    path: "education",
    title:
      "Училища и матури в България — успех спрямо средата | electionsbg.com",
    description:
      "Резултатите от държавните зрелостни изпити (матура) по училища, общини и области — с карта, национален тренд и справедливо сравнение спрямо социално-икономическата среда на общината. По данни на МОН и НСИ.",
    breadcrumbName: "Училища и матури",
    ogImage: "/og/education.png",
    bodyHtml: `
<h1>Училища и матури в България</h1>
<p>Средният успех от държавните зрелостни изпити (матура) по български език и литература за всяко училище, обобщен по общини и области. Намерете своето училище на картата или чрез търсене, вижте петгодишния тренд и къде се нареди то в страната.</p>
<p>Не показваме гола класация. За всяко училище сравняваме успеха му с <strong>очаквания за неговата среда</strong> — социално-икономически индекс на общината (образование и безработица от Преброяване 2021). Така училище в по-бедна община, което постига повече от очакваното, се вижда като силно, а не като „слабо“. Данните са начало на разговор, не присъда.</p>
<p>Виж и <a href="${SITE_URL}/awarder/000695114">Министерството на образованието и пазара на учебници</a>.</p>`.trim(),
    english: {
      title:
        "Schools & matura in Bulgaria — score versus context | electionsbg.com",
      description:
        "State matura (ДЗИ) results by school, municipality and province — with a map, the national trend, and a fair comparison against each municipality's socioeconomic context. Sourced from the Ministry of Education and the census.",
      breadcrumbName: "Schools & matura",
      bodyHtml: `
<h1>Schools &amp; matura in Bulgaria</h1>
<p>The average state-matura (Bulgarian language) score for every school, rolled up by municipality and province. Find your school on the map or by search, see its five-year trend, and where it ranks nationally.</p>
<p>We do not publish a naked league table. Each school's score is set against <strong>what its context predicts</strong> — a socioeconomic index of the municipality (education and unemployment from Census 2021) — so a school in a poorer community that beats expectations reads as strong, not "bad". The data is a starting point, not a verdict.</p>
<p>See also the <a href="${SITE_URL}/en/awarder/000695114">Ministry of Education and the textbook market</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "regions",
    title:
      "Резултати по области в България — парламентарни избори | electionsbg.com",
    description:
      "Резултати на парламентарните избори в България по области (28 МИР) — победител, гласове и активност за всяка област.",
    breadcrumbName: "Области",
    bodyHtml: `
<h1>Резултати по области (28 МИР)</h1>
<p>Резултатите от последния парламентарен вот по 28 многомандатни избирателни района (МИР) в България. За всяка област се вижда коя партия е първа, броят гласове и процентният дял, плюс избирателната активност спрямо предходния вот.</p>
<p>Кликнете името на област, за да видите подробен разрез по общини, населени места, преференции и отклонения по секции.</p>`.trim(),
    english: {
      title:
        "Results by Region — Bulgarian Parliamentary Elections | electionsbg.com",
      description:
        "Bulgarian parliamentary election results across the 28 multi-member districts (MIR) — winner, votes and turnout per region.",
      breadcrumbName: "Regions",
      bodyHtml: `
<h1>Results by region (28 MIR)</h1>
<p>Results of the most recent parliamentary vote across Bulgaria's 28 multi-member districts (MIR). For each region you see the leading party, vote count and share, plus turnout against the previous vote.</p>
<p>Click a region for a deeper breakdown by municipality, settlement, preference votes, and section-level anomalies.</p>`.trim(),
    },
  }),
  staticPage({
    path: "governments",
    title:
      "Български правителства от 2005 г. — макроикономика и наблюдения | electionsbg.com",
    description:
      "Всички български кабинети от 2005 г. на фона на БВП, инфлацията, безработицата, индексите за управление и доверие, плюс наблюденията на ОССЕ/ОДИХР за всеки парламентарен вот.",
    breadcrumbName: "Правителства",
    ogImage: "/og/governments.png",
    bodyHtml: `
<h1>Български правителства от 2005 г.</h1>
<p>Всеки кабинет, заемал властта в България след 2005 г., представен като оцветена ивица на обща времева линия. Линиите налагат годишните макроикономически показатели — растеж на реалния БВП, хармонизирана инфлация (ХИПЦ) и безработица — за да личи кой мандат при какъв икономически контекст е управлявал.</p>
<h2>Какво ще намерите тук</h2>
<ul>
<li><strong>Икономика</strong> — БВП, инфлация и безработица по години (Евростат).</li>
<li><strong>Индекс за възприятие на корупцията</strong> — оценка на България по скалата 0–100 на Transparency International.</li>
<li><strong>Worldwide Governance Indicators</strong> — върховенство на закона, контрол върху корупцията и ефективност на управлението (Световна банка).</li>
<li><strong>Доверие в институциите</strong> — Евробарометър за доверието в Народното събрание, правителството и ЕС.</li>
<li><strong>Европейски средства</strong> — годишни постъпления в България спрямо вноските към бюджета на ЕС.</li>
<li><strong>Наблюдение от ОССЕ/ОДИХР</strong> — резюмета на международните докладите за всеки парламентарен вот.</li>
</ul>
<p>Източници: <a href="https://ec.europa.eu/eurostat/databrowser/" rel="nofollow noopener">Евростат</a>, <a href="https://databank.worldbank.org/source/worldwide-governance-indicators" rel="nofollow noopener">World Bank WGI</a>, <a href="https://www.transparency.org/en/cpi" rel="nofollow noopener">Transparency International CPI</a>, <a href="https://europa.eu/eurobarometer/" rel="nofollow noopener">Евробарометър</a>, <a href="https://www.osce.org/odihr/elections/bulgaria" rel="nofollow noopener">ОССЕ/ОДИХР</a>.</p>`.trim(),
    english: {
      title:
        "Bulgarian Governments Since 2005 — Macro Backdrop and Observations | electionsbg.com",
      description:
        "Every Bulgarian cabinet since 2005 set against GDP, inflation, unemployment, governance and trust indices, with OSCE/ODIHR observation reports for each parliamentary vote.",
      breadcrumbName: "Governments",
      bodyHtml: `
<h1>Bulgarian governments since 2005</h1>
<p>Every cabinet that has held power in Bulgaria since 2005, shown as a coloured band on a shared timeline. Overlaid lines plot the macroeconomic backdrop — real GDP growth, harmonised inflation (HICP), and unemployment — so each term sits next to the economic conditions in which it governed.</p>
<h2>What you'll find</h2>
<ul>
<li><strong>Economy</strong> — GDP, inflation and unemployment by year (Eurostat).</li>
<li><strong>Corruption Perceptions Index</strong> — Bulgaria's score on Transparency International's 0–100 scale.</li>
<li><strong>Worldwide Governance Indicators</strong> — rule of law, control of corruption and government effectiveness (World Bank).</li>
<li><strong>Trust in institutions</strong> — Eurobarometer trust shares for the National Assembly, the government and the EU.</li>
<li><strong>EU funds</strong> — annual inflows to Bulgaria against contributions to the EU budget.</li>
<li><strong>OSCE/ODIHR observation</strong> — summaries of the international reports on each parliamentary vote.</li>
</ul>
<p>Sources: <a href="https://ec.europa.eu/eurostat/databrowser/" rel="nofollow noopener">Eurostat</a>, <a href="https://databank.worldbank.org/source/worldwide-governance-indicators" rel="nofollow noopener">World Bank WGI</a>, <a href="https://www.transparency.org/en/cpi" rel="nofollow noopener">Transparency International CPI</a>, <a href="https://europa.eu/eurobarometer/" rel="nofollow noopener">Eurobarometer</a>, <a href="https://www.osce.org/odihr/elections/bulgaria" rel="nofollow noopener">OSCE/ODIHR</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "indicators",
    title:
      "Индикатори за България — KPI табло, фискални, управление, общество | electionsbg.com",
    description:
      "KPI табло с 12 основни макроикономически, фискални, управленски и социални индикатора за България от 2005 г., с YoY стрелки, позиция в ЕС-27, спарклайн с цветна ивица за всеки кабинет и обобщени средни стойности по правителства.",
    breadcrumbName: "Индикатори",
    ogImage: "/og/indicators.png",
    bodyHtml: `
<h1>Индикатори за България от 2005 г. — основно табло</h1>
<p>KPI таблото на /indicators събира 12 основни показатели — БВП, ХИПЦ инфлация, безработица, потребителско доверие, държавен дълг, бюджетен баланс, фискален резерв, средства от ЕС, контрол върху корупцията (WGI), доверие в правителството, младежка безработица и риск от бедност. За всеки индикатор се показват най-новата стойност, годишна промяна (със семантичен цвят), позиция в ЕС-27 (където е приложимо), и спарклайн с цветна ивица по кабинети. Под таблото — обобщени средни стойности за всеки кабинет (БВП, инфлация, безработица, изменение на дълга, бюджетен баланс, нетни ЕС средства).</p>
<h2>Тематични под-страници</h2>
<ul>
<li><a href="${SITE_URL}/indicators/economy"><strong>Икономика</strong></a> — реален БВП, ХИПЦ инфлация, безработица, трудови доходи, индустриално производство и оборот в търговията; разбивка на инфлацията по ECOICOP; потребителско доверие и Economic Sentiment Indicator (Евростат).</li>
<li><a href="${SITE_URL}/indicators/fiscal"><strong>Фискални</strong></a> — държавен дълг, бюджетен баланс и текуща сметка като % от БВП и в номинални евро; фискален резерв със законов праг; държавни приходи/разходи; FDI; таблица с всички емисии държавен дълг (еврооблигации + ДЦК); средства от ЕС vs вноска.</li>
<li><a href="${SITE_URL}/indicators/budgets"><strong>Бюджети по кабинети</strong></a> — коя двойка премиер и финансов министър управлява най-добре бюджета: салдо (начислено по ЕСС и касово по КФП), просрочени задължения и фискален резерв по години и кабинети, с праг на ЕС от −3%.</li>
<li><a href="${SITE_URL}/indicators/governance"><strong>Управление</strong></a> — Индекс за възприятие на корупцията (CPI, Transparency International); Worldwide Governance Indicators (Световна банка); доверие в Народното събрание, правителството и ЕС (Евробарометър).</li>
<li><a href="${SITE_URL}/indicators/society"><strong>Общество</strong></a> — младежка безработица, годишна промяна на жилищните цени, коефициент на Джини и риск от бедност.</li>
<li><a href="${SITE_URL}/indicators/compare"><strong>Сравнение със страните от ЕС</strong></a> — многослойно табло срещу ЕС-27 и четирите съседа: радиограма на WGI, бюджетна композиция (COFOG), неравенство (SILC), разход срещу резултат (здравеопазване, социална закрила).</li>
</ul>
<p>Виж и <a href="${SITE_URL}/governments">правителствата</a> за визуализация на същите данни по кабинети.</p>
<p>Източници: <a href="https://ec.europa.eu/eurostat/databrowser/" rel="nofollow noopener">Евростат</a>, <a href="https://databank.worldbank.org/source/worldwide-governance-indicators" rel="nofollow noopener">World Bank WGI</a>, <a href="https://www.transparency.org/en/cpi" rel="nofollow noopener">Transparency International CPI</a>, <a href="https://europa.eu/eurobarometer/" rel="nofollow noopener">Евробарометър</a>, <a href="https://commission.europa.eu/strategy-and-policy/eu-budget/performance-and-reporting_en" rel="nofollow noopener">Европейска комисия</a>.</p>`.trim(),
    english: {
      title:
        "Bulgaria Indicators — KPI Dashboard, Fiscal, Governance, Society | electionsbg.com",
      description:
        "12-tile KPI dashboard of Bulgaria's macroeconomic, fiscal, governance and social indicators since 2005, with YoY arrows, EU27 rank badges, cabinet-shaded sparklines and per-cabinet averaged summaries.",
      breadcrumbName: "Indicators",
      bodyHtml: `
<h1>Bulgaria indicators since 2005 — KPI dashboard</h1>
<p>The /indicators dashboard surfaces 12 headline indicators — GDP growth, HICP inflation, unemployment, consumer sentiment, government debt, budget balance, fiscal reserve, EU funds, WGI control of corruption, trust in government, youth unemployment and at-risk-of-poverty rate. Each tile shows the latest value, year-on-year change (coloured by semantic direction), an EU27 rank badge where available, and a sparkline with cabinet-colour bands. Below the dashboard, per-cabinet summary cards average each government's tenure across GDP, inflation, unemployment, debt change, budget balance and net EU funds.</p>
<h2>Domain sub-pages</h2>
<ul>
<li><a href="${SITE_URL}/en/indicators/economy"><strong>Economy</strong></a> — real GDP growth, HICP inflation, unemployment, labour income, industrial production and retail volume; HICP breakdown by ECOICOP sub-groups; consumer confidence and the Economic Sentiment Indicator (Eurostat).</li>
<li><a href="${SITE_URL}/en/indicators/fiscal"><strong>Fiscal</strong></a> — government debt, budget balance and current account as % of GDP and in nominal EUR; fiscal reserve with statutory floor; revenue/expenditure; FDI; full table of Bulgarian sovereign debt emissions (Eurobonds + domestic ДЦК); EU funds vs contribution.</li>
<li><a href="${SITE_URL}/en/indicators/budgets"><strong>Budgets by cabinet</strong></a> — which PM/finance-minister duo ran the budget best: balance (accrual ESA + cash КФП), overdue obligations and the fiscal reserve by year and cabinet, with the EU −3% line.</li>
<li><a href="${SITE_URL}/en/indicators/governance"><strong>Governance</strong></a> — Corruption Perceptions Index (Transparency International); Worldwide Governance Indicators (World Bank); trust in the National Assembly, government and EU (Eurobarometer).</li>
<li><a href="${SITE_URL}/en/indicators/society"><strong>Society</strong></a> — youth unemployment, house-price YoY, Gini coefficient and at-risk-of-poverty rate.</li>
<li><a href="${SITE_URL}/en/indicators/compare"><strong>Compare with EU peers</strong></a> — multi-panel dashboard against EU27 + the four CEE/southern peers: WGI radar, COFOG budget composition, SILC inequality, spend-vs-outcome scatters (health, social).</li>
</ul>
<p>See also <a href="${SITE_URL}/en/governments">governments</a> for the same data overlaid with each cabinet's term.</p>
<p>Sources: <a href="https://ec.europa.eu/eurostat/databrowser/" rel="nofollow noopener">Eurostat</a>, <a href="https://databank.worldbank.org/source/worldwide-governance-indicators" rel="nofollow noopener">World Bank WGI</a>, <a href="https://www.transparency.org/en/cpi" rel="nofollow noopener">Transparency International CPI</a>, <a href="https://europa.eu/eurobarometer/" rel="nofollow noopener">Eurobarometer</a>, <a href="https://commission.europa.eu/strategy-and-policy/eu-budget/performance-and-reporting_en" rel="nofollow noopener">European Commission</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "prices",
    title:
      "Цени в България — кошница от въвеждането на еврото, по вериги и градове | electionsbg.com",
    description:
      "Цените на голямата потребителска кошница (101 продукта) от въвеждането на еврото — дневен индекс, разбивка по категории, най-евтини търговски вериги, класация на най-евтините градове и области и карта на цените по общини. Мониторингов индекс на КЗП, не официален ИПЦ.",
    breadcrumbName: "Цени",
    ogImage: "/og/prices.png",
    bodyHtml: `
<h1>Цени в България — голямата потребителска кошница от въвеждането на еврото</h1>
<p>Страницата /prices проследява цените на дребно на 101-те продукта от голямата потребителска кошница (хляб, мляко, месо, плодове и зеленчуци, хигиенни и лекарствени продукти) от 1 януари 2026 г., когато еврото стана официална валута. Данните идват от ежедневния отворен портал на Комисията за защита на потребителите (КЗП) „Колко струва“ и обхващат над 200 търговски вериги в около 245 населени места.</p>
<p><strong>Това е мониторингов индекс на кошницата, а не официален индекс на потребителските цени (ИПЦ).</strong> За официалната инфлация виж <a href="${SITE_URL}/indicators">индикаторите</a> (ХИПЦ на Евростат).</p>
<h2>Какво показва страницата</h2>
<ul>
<li><strong>Индекс на кошницата от еврото</strong> — дневен ред от 2 януари 2026 г. (база 100), национално и по области, с разбивка коя категория поскъпва и коя поевтинява.</li>
<li><strong>Най-евтини вериги</strong> — класация на търговските вериги по цена на общата кошница, с покритие (брой включени продукти).</li>
<li><strong>Най-евтини и най-поскъпнали места</strong> — кои градове и области имат най-ниска цена на кошницата и къде е поскъпнала най-много от еврото.</li>
<li><strong>Карта на цените</strong> — две хороплет карти по общини: цена на кошницата и промяна от въвеждането на еврото.</li>
</ul>
<p>Цените по конкретно населено място се виждат и на неговото табло в <a href="${SITE_URL}/governance">изгледа „Управление“</a>.</p>
<p>Източник: <a href="https://kolkostruva.bg/opendata" rel="nofollow noopener">КЗП — „Колко струва“ (отворени данни)</a>.</p>`.trim(),
    english: {
      title:
        "Prices in Bulgaria — the consumer basket since the euro, by chain and town | electionsbg.com",
      description:
        "Retail prices of the 101-product large consumer basket since the euro changeover — a daily index, category breakdown, cheapest retail chains, a ranking of the cheapest towns and oblasts, and a municipality price map. CPC monitoring index, not official CPI.",
      breadcrumbName: "Prices",
      bodyHtml: `
<h1>Prices in Bulgaria — the large consumer basket since the euro changeover</h1>
<p>The /prices page tracks retail prices of the 101 products in Bulgaria's large consumer basket (bread, milk, meat, fruit and vegetables, hygiene and medicinal products) since 1 January 2026, when the euro became the official currency. The data comes from the Consumer Protection Commission's (CPC) daily "How Much Does It Cost" open-data portal, covering 200+ retail chains across roughly 245 settlements.</p>
<p><strong>This is a monitoring basket index, not the official Consumer Price Index (CPI).</strong> For official inflation see the <a href="${SITE_URL}/en/indicators">indicators</a> (Eurostat HICP).</p>
<h2>What the page shows</h2>
<ul>
<li><strong>Basket index since the euro</strong> — a daily series from 2 January 2026 (base 100), national and per-oblast, with a breakdown of which category is rising and which is falling.</li>
<li><strong>Cheapest chains</strong> — retail chains ranked by the cost of the shared basket, with coverage (how many products are priced).</li>
<li><strong>Cheapest and fastest-rising places</strong> — which towns and oblasts have the lowest basket cost and where prices rose the most since the euro.</li>
<li><strong>Price map</strong> — two municipality choropleths: basket cost and change since the euro.</li>
</ul>
<p>Prices for a specific settlement also appear on its dashboard in the <a href="${SITE_URL}/en/governance">Governance</a> view.</p>
<p>Source: <a href="https://kolkostruva.bg/opendata" rel="nofollow noopener">CPC — "How Much Does It Cost" (open data)</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "consumption",
    title:
      "Потребление в България — цени и издръжка на живота по места | electionsbg.com",
    description:
      "Изгледът „Потребление“ показва издръжката на живота в България — цените на потребителската кошница от въвеждането на еврото по продукти, вериги, области и населени места. Мониторингов индекс на КЗП, не официален ИПЦ.",
    breadcrumbName: "Потребление",
    ogImage: "/og/consumption.png",
    bodyHtml: `
<h1>Потребление в България — цени и издръжка на живота</h1>
<p>Изгледът „Потребление“ събира на едно място данните за издръжката на живота в България и ги показва на всяко ниво — национално, София, област, община и населено място. В основата засега е голямата потребителска кошница (101 продукта) от въвеждането на еврото на 1 януари 2026 г., с данни от ежедневния отворен портал на Комисията за защита на потребителите (КЗП) „Колко струва“.</p>
<p><strong>Това е мониторингов индекс на кошницата, а не официален индекс на потребителските цени (ИПЦ).</strong> За официалната инфлация виж <a href="${SITE_URL}/indicators">индикаторите</a> (ХИПЦ на Евростат).</p>
<h2>Какво показва изгледът</h2>
<ul>
<li><strong>Кошница на цените</strong> — дневен индекс от въвеждането на еврото, национално и по области, с разбивка по категории и най-евтини вериги.</li>
<li><strong>Карта на цените</strong> — хороплет карти по общини: цена на кошницата и промяна от еврото.</li>
<li><strong>По места</strong> — цените на кошницата за всяка област, община и населено място с покритие.</li>
</ul>
<p>Виж и пълния <a href="${SITE_URL}/prices">обзор на цените</a> по продукти и вериги.</p>
<p>Източник: <a href="https://kolkostruva.bg/opendata" rel="nofollow noopener">КЗП — „Колко струва“ (отворени данни)</a>.</p>`.trim(),
    english: {
      title:
        "Consumption in Bulgaria — prices and cost of living by place | electionsbg.com",
      description:
        "The Consumption view shows the cost of living in Bulgaria — consumer-basket prices since the euro changeover by product, retail chain, region and settlement. CPC monitoring index, not official CPI.",
      breadcrumbName: "Consumption",
      bodyHtml: `
<h1>Consumption in Bulgaria — prices and the cost of living</h1>
<p>The Consumption view brings the cost-of-living data together and shows it at every tier — national, Sofia, oblast, municipality and settlement. The foundation for now is the 101-product large consumer basket since the euro changeover on 1 January 2026, from the Consumer Protection Commission's (CPC) daily "How Much Does It Cost" open-data portal.</p>
<p><strong>This is a monitoring basket index, not the official Consumer Price Index (CPI).</strong> For official inflation see the <a href="${SITE_URL}/en/indicators">indicators</a> (Eurostat HICP).</p>
<h2>What the view shows</h2>
<ul>
<li><strong>Price basket</strong> — a daily index since the euro, national and per-oblast, with a category breakdown and the cheapest chains.</li>
<li><strong>Price map</strong> — municipality choropleths: basket cost and change since the euro.</li>
<li><strong>By place</strong> — basket prices for each oblast, municipality and settlement, with coverage.</li>
</ul>
<p>See also the full <a href="${SITE_URL}/en/prices">price explorer</a> by product and chain.</p>
<p>Source: <a href="https://kolkostruva.bg/opendata" rel="nofollow noopener">CPC — "How Much Does It Cost" (open data)</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "indicators/economy",
    title: "Икономика — БВП, инфлация, безработица, нагласи | electionsbg.com",
    description:
      "Реален БВП, ХИПЦ инфлация, безработица, трудови доходи, индустриално производство, потребителско доверие и Economic Sentiment Indicator за България от 2005 г., разположени по мандати на правителствата.",
    breadcrumbName: "Икономика",
    ogImage: "/og/indicators-economy.png",
    bodyHtml: `
<h1>Индикатори за икономиката на България</h1>
<p>Тримесечни макроикономически показатели от Евростат, поставени паралелно с мандатите на правителствата. Включват реален БВП (растеж YoY), ХИПЦ инфлация и нейната разбивка по ECOICOP подгрупи (храна, енергия, услуги, базова), безработица, трудови доходи, индустриално производство и оборот в търговията на дребно.</p>
<h2>Какво показва страницата</h2>
<ul>
<li><strong>Основни</strong> — реален БВП, ХИПЦ инфлация, безработица и трудови доходи на едно платно.</li>
<li><strong>Активност</strong> — индустриално производство и оборот в търговията на дребно (индекс 2021 = 100).</li>
<li><strong>Разбивка на инфлацията</strong> — приноси на ECOICOP подгрупите към общия ХИПЦ.</li>
<li><strong>Икономически нагласи</strong> — потребителско доверие и Economic Sentiment Indicator (ESI).</li>
</ul>
<p>Бутонът „Сравни със страните от ЕС“ добавя референция за ЕС-27 и линии за Румъния, Гърция, Унгария и Хърватия, заедно с моментна снимка на последните стойности и позиция на България в ЕС-27.</p>
<p>Виж и <a href="${SITE_URL}/indicators/fiscal">фискалните показатели</a>, <a href="${SITE_URL}/indicators/governance">индикаторите за управление</a> и <a href="${SITE_URL}/indicators/society">социалните индикатори</a>. Източник: <a href="https://ec.europa.eu/eurostat/databrowser/" rel="nofollow noopener">Евростат</a>.</p>`.trim(),
    english: {
      title:
        "Economy — GDP, Inflation, Unemployment, Sentiment | electionsbg.com",
      description:
        "Real GDP growth, HICP inflation, unemployment, labour income, industrial production, consumer confidence and the Economic Sentiment Indicator for Bulgaria since 2005, set against each cabinet's term.",
      breadcrumbName: "Economy",
      bodyHtml: `
<h1>Bulgaria — economy indicators</h1>
<p>Quarterly Eurostat macroeconomic series aligned to each cabinet's term. Covers real GDP growth (YoY), HICP inflation with the ECOICOP breakdown (food, energy, services, core), unemployment, labour income, industrial production and retail volume.</p>
<h2>What's on this page</h2>
<ul>
<li><strong>Headline</strong> — real GDP growth, HICP inflation, unemployment and labour income on a single chart.</li>
<li><strong>Activity</strong> — industrial production and retail volume (index 2021 = 100).</li>
<li><strong>Inflation breakdown</strong> — ECOICOP sub-group contributions to headline HICP.</li>
<li><strong>Sentiment</strong> — consumer confidence and the Economic Sentiment Indicator (ESI).</li>
</ul>
<p>The "Compare with EU peers" button layers an EU27 reference and four CEE peer lines (Romania, Greece, Hungary, Croatia) onto every chart, with a snapshot table of latest values and Bulgaria's rank within the EU27.</p>
<p>See also <a href="${SITE_URL}/en/indicators/fiscal">fiscal indicators</a>, <a href="${SITE_URL}/en/indicators/governance">governance indicators</a> and <a href="${SITE_URL}/en/indicators/society">society indicators</a>. Source: <a href="https://ec.europa.eu/eurostat/databrowser/" rel="nofollow noopener">Eurostat</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "indicators/fiscal",
    title:
      "Фискални индикатори на България — дълг, бюджет, резерв, ЕС средства | electionsbg.com",
    description:
      "Държавен дълг, бюджетен баланс, текуща сметка, фискален резерв, държавни приходи и разходи, FDI, емисии държавен дълг и потоци със средства от ЕС за България от 2005 г., разположени по мандати на правителствата.",
    breadcrumbName: "Фискални",
    ogImage: "/og/indicators-fiscal.png",
    bodyHtml: `
<h1>Фискални индикатори на България</h1>
<p>Тримесечни и годишни фискални показатели от Евростат, БНБ и Министерството на финансите, поставени паралелно с мандатите на правителствата. Включват както относителни показатели (като % от БВП), така и номинални нива в евро.</p>
<h2>Какво показва страницата</h2>
<ul>
<li><strong>Като % от БВП</strong> — държавен дълг (Маастрихт), бюджетен баланс (нетно кредитиране/заемане) и текуща сметка.</li>
<li><strong>Номинални нива и потоци</strong> — натрупан дълг (сток), нов дълг емитиран за тримесечие (Δ), бюджетен баланс и текуща сметка в евро.</li>
<li><strong>Фискален резерв</strong> — паричен ресурс в края на тримесечието със законовия праг като референтна линия (Министерство на финансите, КФП).</li>
<li><strong>Размер на държавата</strong> — държавни приходи и разходи, номинален БВП и нетни преки чуждестранни инвестиции (BPM6).</li>
<li><strong>Емисии държавен дълг</strong> — пълна сортируема таблица с всяка значима емисия: международни еврооблигации от 2002 г. и вътрешни ДЦК от 2019 г. (БНБ).</li>
<li><strong>Средства от ЕС</strong> — годишни постъпления спрямо вноска на България в бюджета на ЕС.</li>
</ul>
<p>Виж и <a href="${SITE_URL}/budget">държавния бюджет</a> за изпълнението по КФП и министерства. Източници: <a href="https://ec.europa.eu/eurostat/databrowser/" rel="nofollow noopener">Евростат</a>, <a href="https://www.bnb.bg/" rel="nofollow noopener">БНБ</a>, <a href="https://www.minfin.bg/" rel="nofollow noopener">МФ</a>, <a href="https://commission.europa.eu/strategy-and-policy/eu-budget/performance-and-reporting_en" rel="nofollow noopener">Европейска комисия</a>.</p>`.trim(),
    english: {
      title:
        "Bulgaria Fiscal Indicators — Debt, Balance, Reserve, EU Funds | electionsbg.com",
      description:
        "Government debt, budget balance, current account, fiscal reserve, revenue and expenditure, FDI, sovereign debt emissions and EU-funds flows for Bulgaria since 2005, set against each cabinet's term.",
      breadcrumbName: "Fiscal",
      bodyHtml: `
<h1>Bulgaria — fiscal indicators</h1>
<p>Quarterly and annual fiscal series from Eurostat, the Bulgarian National Bank and the Ministry of Finance, aligned to each cabinet's term. Covers both relative metrics (% of GDP) and nominal levels in euro.</p>
<h2>What's on this page</h2>
<ul>
<li><strong>As % of GDP</strong> — government gross debt (Maastricht), budget balance (net lending/borrowing) and current account.</li>
<li><strong>Nominal levels and flows</strong> — gross debt stock, net new debt issued per quarter, budget balance and current account in EUR.</li>
<li><strong>Fiscal reserve</strong> — end-of-quarter cash stock with the statutory floor as a reference line (Ministry of Finance КФП bulletins).</li>
<li><strong>Government size</strong> — general government revenue, expenditure, nominal GDP and net inward FDI (BPM6).</li>
<li><strong>Debt emissions</strong> — full sortable table of every meaningful sovereign debt instrument: international Eurobonds since 2002 and domestic ДЦК auctioned by the BNB since 2019.</li>
<li><strong>EU funds</strong> — annual receipts vs Bulgaria's contribution to the EU budget.</li>
</ul>
<p>See also <a href="${SITE_URL}/en/budget">state budget</a> for KFP and ministry-level execution. Sources: <a href="https://ec.europa.eu/eurostat/databrowser/" rel="nofollow noopener">Eurostat</a>, <a href="https://www.bnb.bg/" rel="nofollow noopener">BNB</a>, <a href="https://www.minfin.bg/" rel="nofollow noopener">MoF</a>, <a href="https://commission.europa.eu/strategy-and-policy/eu-budget/performance-and-reporting_en" rel="nofollow noopener">European Commission</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "indicators/budgets",
    title:
      "Бюджети по кабинети — салдо, просрочия и резерв по премиер и финансов министър | electionsbg.com",
    description:
      "Коя двойка премиер и финансов министър управлява най-добре държавния бюджет: бюджетно салдо (начислено по ЕСС и касово по КФП), просрочени задължения и фискален резерв по години и кабинети от 2005 г., с праг на ЕС от −3% от БВП.",
    breadcrumbName: "Бюджети",
    ogImage: "/og/indicators-budgets.png",
    bodyHtml: `
<h1>Бюджети по кабинети</h1>
<p>Коя двойка премиер и финансов министър управлява най-добре държавния бюджет? Страницата подрежда всяка календарна година от 2005 г. с нейните показатели и я групира по кабинети според това кой е управлявал най-дълго, така че да се види кои управления са били най-дисциплинирани фискално.</p>
<h2>Какво показва страницата</h2>
<ul>
<li><strong>Бюджетно салдо — две мерки</strong> — на начислена основа по методологията на Евростат (ЕСС 2010, за целия период) и касово по консолидираната фискална програма (КФП) на Министерството на финансите — числото, което политиците обикновено цитират; с праг на ЕС от −3% от БВП.</li>
<li><strong>Просрочени задължения</strong> — натрупан обем в края на годината (консолидирано: централно правителство, социалноосигурителни фондове и общини).</li>
<li><strong>Фискален резерв</strong> — паричен буфер в края на годината.</li>
<li><strong>Кой е защитил и кой е актуализирал бюджета</strong> — финансовият министър, приел бюджета за всяка година, и този, който го е актуализирал — често различни хора.</li>
</ul>
<p>Виж и <a href="${SITE_URL}/budget">държавния бюджет</a> за изпълнението по КФП и министерства и <a href="${SITE_URL}/indicators/fiscal">фискалните индикатори</a>. Източници: <a href="https://ec.europa.eu/eurostat/databrowser/" rel="nofollow noopener">Евростат</a>, <a href="https://www.minfin.bg/" rel="nofollow noopener">Министерство на финансите</a>.</p>`.trim(),
    english: {
      title:
        "Bulgaria Budgets by Cabinet — Balance, Arrears, Reserve by PM & Finance Minister | electionsbg.com",
      description:
        "Which PM / finance-minister duo ran the state budget best: budget balance (accrual ESA + cash КФП), overdue obligations and the fiscal reserve by year and cabinet since 2005, with the EU −3% deficit line.",
      breadcrumbName: "Budgets",
      bodyHtml: `
<h1>Bulgaria — budgets by cabinet</h1>
<p>Which Prime-Minister / Finance-Minister duo ran the state budget best? This page lays out every calendar year since 2005 with its figures and groups them under the cabinet that governed them longest, so you can see which terms were the most fiscally disciplined.</p>
<h2>What's on this page</h2>
<ul>
<li><strong>Budget balance — two measures</strong> — accrual on the Eurostat methodology (ESA 2010, full period) and cash from the Ministry of Finance consolidated fiscal programme (КФП, the figure politicians usually quote); with the EU −3%-of-GDP line.</li>
<li><strong>Overdue obligations</strong> — year-end consolidated stock (central government, social-security funds and municipalities).</li>
<li><strong>Fiscal reserve</strong> — the year-end cash buffer.</li>
<li><strong>Who defended and who revised each budget</strong> — the finance minister who got each year's budget adopted and the one who amended it — often different people.</li>
</ul>
<p>See also the <a href="${SITE_URL}/en/budget">state budget</a> for KFP and ministry-level execution and the <a href="${SITE_URL}/en/indicators/fiscal">fiscal indicators</a>. Sources: <a href="https://ec.europa.eu/eurostat/databrowser/" rel="nofollow noopener">Eurostat</a>, <a href="https://www.minfin.bg/" rel="nofollow noopener">Ministry of Finance</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "indicators/governance",
    title:
      "Индикатори за управление — CPI, WGI, доверие в институциите | electionsbg.com",
    description:
      "Индекс за възприятие на корупцията (Transparency International), Worldwide Governance Indicators (Световна банка) и доверие в Народното събрание, правителството и ЕС (Евробарометър) за България от 2005 г.",
    breadcrumbName: "Управление",
    ogImage: "/og/indicators-governance.png",
    bodyHtml: `
<h1>Индикатори за управление в България</h1>
<p>Годишни индикатори за качеството на управлението и доверието на гражданите в институциите, разположени по мандати на правителствата.</p>
<h2>Какво показва страницата</h2>
<ul>
<li><strong>Индекс за възприятие на корупцията (CPI)</strong> — Transparency International, 0–100 (0 = силно корумпирано, 100 = много чисто).</li>
<li><strong>Worldwide Governance Indicators (WGI)</strong> — върховенство на правото, контрол върху корупцията и ефективност на управлението; скала от −2,5 до +2,5 (по-високо е по-добро).</li>
<li><strong>Доверие в институциите</strong> — Стандартен Евробарометър, дял на отговорилите „по-скоро се доверявам“ за Народното събрание, правителството и ЕС (средногодишна стойност от пролетната и есенната вълна).</li>
</ul>
<p>Виж и <a href="${SITE_URL}/governance">управленското табло</a> за обобщено представяне на същите теми. Източници: <a href="https://www.transparency.org/en/countries/bulgaria" rel="nofollow noopener">Transparency International</a>, <a href="https://databank.worldbank.org/source/worldwide-governance-indicators" rel="nofollow noopener">World Bank WGI</a>, <a href="https://europa.eu/eurobarometer/" rel="nofollow noopener">Евробарометър</a>.</p>`.trim(),
    english: {
      title:
        "Bulgaria Governance — CPI, WGI, Trust in Institutions | electionsbg.com",
      description:
        "Corruption Perceptions Index (Transparency International), Worldwide Governance Indicators (World Bank) and Eurobarometer trust in parliament, government and the EU for Bulgaria since 2005.",
      breadcrumbName: "Governance",
      bodyHtml: `
<h1>Bulgaria — governance indicators</h1>
<p>Annual indicators of governance quality and public trust in institutions, aligned to each cabinet's term.</p>
<h2>What's on this page</h2>
<ul>
<li><strong>Corruption Perceptions Index (CPI)</strong> — Transparency International, 0–100 scale (0 = highly corrupt, 100 = very clean).</li>
<li><strong>Worldwide Governance Indicators (WGI)</strong> — rule of law, control of corruption and government effectiveness; −2.5 to +2.5 scale (higher = better).</li>
<li><strong>Trust in institutions</strong> — Standard Eurobarometer "tend to trust" share for the National Assembly, government and the EU (annual mean of spring + autumn waves).</li>
</ul>
<p>See also the <a href="${SITE_URL}/en/governance">governance dashboard</a> for a consolidated view of the same themes. Sources: <a href="https://www.transparency.org/en/countries/bulgaria" rel="nofollow noopener">Transparency International</a>, <a href="https://databank.worldbank.org/source/worldwide-governance-indicators" rel="nofollow noopener">World Bank WGI</a>, <a href="https://europa.eu/eurobarometer/" rel="nofollow noopener">Eurobarometer</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "indicators/society",
    title:
      "Социални индикатори за България — младежка безработица, неравенство, бедност | electionsbg.com",
    description:
      "Младежка безработица (15-24), годишна промяна на индекса на жилищните цени, коефициент на Джини и риск от бедност за България от 2005 г., разположени по мандати на правителствата.",
    breadcrumbName: "Общество",
    ogImage: "/og/indicators-society.png",
    bodyHtml: `
<h1>Социални индикатори за България</h1>
<p>Четири показателя, които измерват как макросредата се отразява върху домакинствата, разположени паралелно с мандатите на правителствата.</p>
<h2>Какво показва страницата</h2>
<ul>
<li><strong>Младежка безработица (15-24)</strong> — тримесечна безработица за младежката кохорта (Евростат).</li>
<li><strong>Жилищни цени (YoY)</strong> — годишно изменение на индекса на жилищните цени (Евростат).</li>
<li><strong>Коефициент на Джини</strong> — неравенство в разполагаемия доход; по-висока стойност означава по-голямо неравенство.</li>
<li><strong>Риск от бедност</strong> — дял на населението с доход под 60% от медианния (Евростат).</li>
</ul>
<p>Бутонът „Сравни със страните от ЕС“ показва как България се позиционира спрямо ЕС-27 и съседите. Източник: <a href="https://ec.europa.eu/eurostat/databrowser/" rel="nofollow noopener">Евростат</a>.</p>`.trim(),
    english: {
      title:
        "Bulgaria Society — Youth Unemployment, Inequality, Poverty | electionsbg.com",
      description:
        "Youth unemployment (15-24), house-price index YoY, Gini coefficient and at-risk-of-poverty rate for Bulgaria since 2005, set against each cabinet's term.",
      breadcrumbName: "Society",
      bodyHtml: `
<h1>Bulgaria — society indicators</h1>
<p>Four indicators of how the macro environment lands on households, aligned to each cabinet's term.</p>
<h2>What's on this page</h2>
<ul>
<li><strong>Youth unemployment (15-24)</strong> — quarterly unemployment rate for the youth cohort (Eurostat).</li>
<li><strong>House prices (YoY)</strong> — year-on-year change in the house price index (Eurostat).</li>
<li><strong>Gini coefficient</strong> — disposable-income inequality; higher = more unequal.</li>
<li><strong>At-risk-of-poverty rate</strong> — share of the population below 60% of median income (Eurostat).</li>
</ul>
<p>The "Compare with EU peers" button shows where Bulgaria sits against the EU27 and four CEE peers. Source: <a href="https://ec.europa.eu/eurostat/databrowser/" rel="nofollow noopener">Eurostat</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "indicators/compare",
    title:
      "Сравнение на България със страните от ЕС — управление, бюджет, доходи | electionsbg.com",
    description:
      "Многослойно сравнение на България с ЕС-27 и четири съседа (Румъния, Гърция, Унгария, Хърватия): радиограма на WGI, бюджетна композиция (COFOG), неравенство (SILC), разход срещу резултат — с избор на държави в URL.",
    breadcrumbName: "Сравни",
    ogImage: "/og/indicators-compare.png",
    bodyHtml: `
<h1>Сравнение на България с ЕС — табло</h1>
<p>Многослойно сравнение, фокусирано върху България спрямо ЕС-27 и четири съседни/ЦИЕ страни (Румъния, Гърция, Унгария, Хърватия). Целта не е суров достъп до данни (за това има Евростат и Световна банка), а редакторски подреден разказ: къде България изостава, къде харчи под средното за ЕС и къде разходите не носят резултат.</p>
<h2>Какво показва страницата</h2>
<ul>
<li><strong>Радиограма за качеството на управлението (WGI)</strong> — шестте измерения на Световната банка (гласност, стабилност, ефективност, регулации, върховенство на правото, антикорупция) за всички шест страни на една ос. Полигонът на България обикновено е най-малък.</li>
<li><strong>Последни стойности</strong> — таблица с осем тримесечни макро/фискални показателя, оцветена спрямо средното за ЕС-27, с ранг 1/27 за показателите с недвусмислена посока.</li>
<li><strong>Бюджетна композиция (COFOG)</strong> — наслагани колони на разходите на разширения сектор по функция, като дял от БВП. Под графиката — трите най-големи разлики между България и средното за ЕС-27 (типично: социална закрила, общи служби, здравеопазване).</li>
<li><strong>Доходи и риск от бедност (SILC)</strong> — коефициент на Джини, S80/S20 и AROPE. България е на 27-о място в ЕС по всички три.</li>
<li><strong>Разход срещу резултат</strong> — разход за здравеопазване (% от БВП) срещу очаквана продължителност на живота; социална закрила срещу AROPE. Тук става очевидно дали парите дават резултат.</li>
<li><strong>Поделим URL</strong> — изборът на държави се запазва в параметър <code>?peers=</code>, така че текущият изглед е споделим.</li>
</ul>
<p>Източници: <a href="https://ec.europa.eu/eurostat/databrowser/" rel="nofollow noopener">Евростат</a> (макро, COFOG, SILC, демография) и <a href="https://databank.worldbank.org/source/worldwide-governance-indicators" rel="nofollow noopener">Световна банка WGI</a>. Средното за ЕС-27 в радиограмата за WGI е невзвешена средна стойност на 27-те държави членки.</p>`.trim(),
    english: {
      title:
        "Bulgaria vs EU Peers — Governance, Budget, Income Dashboard | electionsbg.com",
      description:
        "Multi-panel comparison of Bulgaria against EU27 and four CEE peers (Romania, Greece, Hungary, Croatia): WGI radar, COFOG budget composition, SILC inequality, spend-vs-outcome scatters — with country selection persisted in the URL.",
      breadcrumbName: "Compare",
      bodyHtml: `
<h1>Bulgaria compared with EU peers — dashboard</h1>
<p>Multi-panel comparison anchored on Bulgaria against the EU27 aggregate and four CEE/southern peers (Romania, Greece, Hungary, Croatia). Goal is not raw data access (Eurostat and the World Bank own that) but editorial framing: where Bulgaria lags, where it underspends relative to the EU mean, and where spending fails to deliver results.</p>
<h2>What's on this page</h2>
<ul>
<li><strong>WGI radar</strong> — World Bank Worldwide Governance Indicators on six axes (voice & accountability, political stability, government effectiveness, regulatory quality, rule of law, control of corruption) overlaid for all six geos. Bulgaria's polygon is typically the smallest.</li>
<li><strong>Latest values</strong> — eight quarterly macro/fiscal indicators in a table coloured against the EU27 average, with a 1/27 rank badge for indicators with an unambiguous direction.</li>
<li><strong>Budget composition (COFOG)</strong> — stacked bars of general-government expenditure by function as % of GDP. Below the chart: the three largest BG-vs-EU27 deltas (typically: social protection, general services, health).</li>
<li><strong>Income & poverty risk (SILC)</strong> — Gini coefficient, S80/S20 ratio and AROPE. Bulgaria ranks 27/27 in the EU on all three.</li>
<li><strong>Spend vs outcome</strong> — health spend (% GDP) vs life expectancy; social-protection spend vs AROPE. This is where it becomes visible whether the money produces results.</li>
<li><strong>Shareable URL</strong> — country selection persists in the <code>?peers=</code> parameter, so the current view is shareable.</li>
</ul>
<p>Sources: <a href="https://ec.europa.eu/eurostat/databrowser/" rel="nofollow noopener">Eurostat</a> (macro, COFOG, SILC, demographics) and <a href="https://databank.worldbank.org/source/worldwide-governance-indicators" rel="nofollow noopener">World Bank WGI</a>. The EU27 average on the WGI radar is an unweighted mean across the 27 member states.</p>`.trim(),
    },
  }),
  staticPage({
    path: "governance",
    title:
      "Управление на държавата — парламент, бюджет, обществени поръчки | electionsbg.com",
    description:
      "Управленско табло за България: поименни гласувания в Народното събрание, имуществени декларации на депутатите, изпълнение на държавния бюджет, обществени поръчки, финансиране на партии и макроикономически контекст.",
    breadcrumbName: "Управление",
    ogImage: "/og/governance.png",
    bodyHtml: `
<h1>Управление на държавата — обобщено табло</h1>
<p>Управленското табло обединява инструментите за следене на изпълнителната и законодателната власт в България: какво гласува парламентът, какво декларират депутатите, как се харчат публичните пари и какъв е макроикономическият контекст. Срещуположното табло — <a href="${SITE_URL}/">Изборите</a> — следи самите парламентарни вотове.</p>
<h2>Какво ще намерите тук</h2>
<ul>
<li><a href="${SITE_URL}/parliament">Парламент</a> — поименни гласувания, кохезия на групите и UMAP проекция на гласовото пространство.</li>
<li><a href="${SITE_URL}/connections">Декларации на депутатите</a> — имущество, доходи, бизнес роли (Сметна палата + Търговски регистър).</li>
<li><a href="${SITE_URL}/budget">Държавен бюджет</a> — изпълнение по КФП и програмни отчети по министерства.</li>
<li><a href="${SITE_URL}/procurement">Обществени поръчки</a> — възложители, изпълнители и потоци от АОП (data.egov.bg).</li>
<li><a href="${SITE_URL}/financing">Финансиране на партии</a> — годишни финансови отчети от Сметната палата.</li>
<li><a href="${SITE_URL}/governments">Правителства</a> и <a href="${SITE_URL}/indicators">индикатори</a> — макроикономически и управленски контекст по мандати.</li>
</ul>${governanceRegionBrowseHtml}`.trim(),
    english: {
      title:
        "Governance Dashboard — Parliament, Budget, Procurement | electionsbg.com",
      description:
        "Bulgaria governance dashboard: roll-call votes, MP property declarations, state budget execution, public procurement, party financing, and macroeconomic context — alongside the elections dashboard.",
      breadcrumbName: "Governance",
      bodyHtml: `
<h1>Governance dashboard</h1>
<p>The governance dashboard ties together the tools for tracking Bulgaria's executive and legislative branches: what parliament votes on, what MPs declare, how public money is spent, and the macroeconomic context. Its companion — the <a href="${SITE_URL}/en/">elections dashboard</a> — covers the parliamentary votes themselves.</p>
<h2>What you'll find</h2>
<ul>
<li><a href="${SITE_URL}/en/parliament">Parliament</a> — roll-call votes, group cohesion, and a UMAP voting-space projection.</li>
<li><a href="${SITE_URL}/en/connections">MP declarations</a> — property, income and business roles (Court of Audit + Commerce Registry).</li>
<li><a href="${SITE_URL}/en/budget">State budget</a> — KFP execution and per-ministry program reports.</li>
<li><a href="${SITE_URL}/en/procurement">Public procurement</a> — awarders, contractors and contract flows from AOP (data.egov.bg).</li>
<li><a href="${SITE_URL}/en/financing">Party financing</a> — annual financial reports from the Court of Audit.</li>
<li><a href="${SITE_URL}/en/governments">Governments</a> and <a href="${SITE_URL}/en/indicators">indicators</a> — macroeconomic and governance context per cabinet.</li>
</ul>${governanceRegionBrowseHtmlEn}`.trim(),
    },
  }),
  staticPage({
    path: "governance/sectors",
    title:
      "Държавни сектори — пари, договори и институции по сектори | electionsbg.com",
    description:
      "Един вход към всяка държавна структура: пътища (АПИ), води (ВиК), транспорт, пенсии и осигуряване (НОИ), здравна каса (НЗОК), образование (МОН), приходи (НАП), митници, администрация (МЕУ), отбрана (МО), съдебна власт (ВСС), земеделие (ДФЗ) и култура — договори, разходи и отговорни институции.",
    breadcrumbName: "Държавни сектори",
    ogImage: "/og/governance-sectors.png",
    bodyHtml: `
<h1>Държавни сектори — къде отиват публичните пари</h1>
<p>Обединен вход към всяка голяма държавна структура и сектор. Всяка страница проследява договорите, разходите и отговорните институции. Секторите са част от <a href="${SITE_URL}/governance">управленското табло</a>.</p>
<h2>Инфраструктура</h2>
<ul>
<li><a href="${SITE_URL}/awarder/000695089">Пътища (АПИ)</a> — договори, поддръжка, километри път.</li>
<li><a href="${SITE_URL}/water">Води (ВиК)</a> — ВиК холдинг, загуби, язовири.</li>
<li><a href="${SITE_URL}/awarder/000695388">Транспорт (МТС)</a> — железници, пристанища, БДЖ.</li>
</ul>
<h2>Социална държава</h2>
<ul>
<li><a href="${SITE_URL}/pensions">Пенсии (НОИ)</a> — ДОО, среден размер, трите стълба.</li>
<li><a href="${SITE_URL}/awarder/121082521">Осигуряване (НОИ)</a> — осигуровки и договори на НОИ.</li>
<li><a href="${SITE_URL}/awarder/121858220">Здравна каса (НЗОК)</a> — болници, лекарства, клинични пътеки.</li>
<li><a href="${SITE_URL}/awarder/000695114">Образование (МОН)</a> — договори и бюджет на МОН.</li>
<li><a href="${SITE_URL}/education">Училища и матури</a> — училища, матури, среден успех.</li>
</ul>
<h2>Приходи и администрация</h2>
<ul>
<li><a href="${SITE_URL}/awarder/131063188">Приходи (НАП)</a> — събираемост, ДДС, договори.</li>
<li><a href="${SITE_URL}/awarder/000627597">Митници</a> — акцизи, внос, договори.</li>
<li><a href="${SITE_URL}/awarder/180680495">Администрация (МЕУ)</a> — е-управление, щат, услуги.</li>
</ul>
<h2>Сигурност и правосъдие</h2>
<ul>
<li><a href="${SITE_URL}/defense">Отбрана (МО)</a> — % от БВП, програми, износ на оръжие.</li>
<li><a href="${SITE_URL}/judiciary">Съдебна власт (ВСС)</a> — натовареност, дела, декларации.</li>
</ul>
<h2>Земя и култура</h2>
<ul>
<li><a href="${SITE_URL}/awarder/121100421">Земеделие (ДФЗ)</a> — субсидии, бенефициенти, САР.</li>
<li><a href="${SITE_URL}/culture">Култура</a> — филмови субсидии и комисии.</li>
</ul>`.trim(),
    english: {
      title:
        "State sectors — money, contracts and institutions by sector | electionsbg.com",
      description:
        "One entry to every state body: roads (АПИ), water (ВиК), transport, pensions and social security (НОИ), health fund (НЗОК), education (МОН), revenue (НАП), customs, administration (МЕУ), defense (МО), judiciary (ВСС), agriculture (ДФЗ) and culture — contracts, spending and the institutions responsible.",
      breadcrumbName: "State sectors",
      bodyHtml: `
<h1>State sectors — where public money goes</h1>
<p>A single entry to every major state body and sector. Each page tracks the contracts, the spending and the institutions responsible. The sectors are part of the <a href="${SITE_URL}/en/governance">governance dashboard</a>.</p>
<h2>Infrastructure</h2>
<ul>
<li><a href="${SITE_URL}/en/awarder/000695089">Roads (АПИ)</a> — contracts, maintenance, kilometres of road.</li>
<li><a href="${SITE_URL}/en/water">Water (ВиК)</a> — the ВиК holding, losses, reservoirs.</li>
<li><a href="${SITE_URL}/en/awarder/000695388">Transport (МТС)</a> — rail, ports, БДЖ.</li>
</ul>
<h2>Social state</h2>
<ul>
<li><a href="${SITE_URL}/en/pensions">Pensions (НОИ)</a> — ДОО, average pension, the three pillars.</li>
<li><a href="${SITE_URL}/en/awarder/121082521">Social security (НОИ)</a> — contributions and НОИ procurement.</li>
<li><a href="${SITE_URL}/en/awarder/121858220">Health fund (НЗОК)</a> — hospitals, drugs, clinical pathways.</li>
<li><a href="${SITE_URL}/en/awarder/000695114">Education (МОН)</a> — МОН contracts and budget.</li>
<li><a href="${SITE_URL}/en/education">Schools & matura</a> — schools, matura, average score.</li>
</ul>
<h2>Revenue & administration</h2>
<ul>
<li><a href="${SITE_URL}/en/awarder/131063188">Revenue (НАП)</a> — collection, VAT, contracts.</li>
<li><a href="${SITE_URL}/en/awarder/000627597">Customs</a> — excise, imports, contracts.</li>
<li><a href="${SITE_URL}/en/awarder/180680495">Administration (МЕУ)</a> — e-government, headcount, services.</li>
</ul>
<h2>Security & justice</h2>
<ul>
<li><a href="${SITE_URL}/en/defense">Defense (МО)</a> — % of GDP, programs, arms exports.</li>
<li><a href="${SITE_URL}/en/judiciary">Judiciary (ВСС)</a> — workload, cases, declarations.</li>
</ul>
<h2>Land & culture</h2>
<ul>
<li><a href="${SITE_URL}/en/awarder/121100421">Agriculture (ДФЗ)</a> — subsidies, beneficiaries, CAP.</li>
<li><a href="${SITE_URL}/en/culture">Culture</a> — film subsidies and commissions.</li>
</ul>`.trim(),
    },
  }),
  staticPage({
    path: "budget",
    title:
      "Държавен бюджет на България — изпълнение, разпоредители, поръчки | electionsbg.com",
    description:
      "Изпълнение на държавния бюджет на България — приходи, разходи, дефицит и финансиране, разпоредители по министерства и програмен бюджет, по данни от data.egov.bg и Държавен вестник.",
    breadcrumbName: "Държавен бюджет",
    ogImage: "/og/budget.png",
    bodyHtml: `
<h1>Държавен бюджет на България</h1>
<p>Изпълнението на държавния бюджет на България — приходи, разходи, дефицит и финансиране — обобщено за всяка фискална година от Консолидираната фискална програма (КФП) на Министерство на финансите и Закона за държавния бюджет, обнародван в Държавен вестник.</p>
<h2>Какво ще намерите тук</h2>
<ul>
<li><strong>Изпълнение по месеци</strong> — кумулативни приходи, разходи, дефицит и вноска в бюджета на ЕС, нанесени върху линията на закона за съответната година.</li>
<li><strong>Сравнение в същата точка от годината</strong> — изпълнение към края на месец X в две избрани години, един до друг.</li>
<li><strong>USAFacts-style баланс</strong> — графика на потока на парите от приходи към разходи с дефицита като „стена".</li>
<li><strong>Първостепенни разпоредители</strong> — план срещу изпълнение по министерства, агенции и независими органи.</li>
<li><strong>Програмен бюджет</strong> — на ниво програма за всяко министерство (Отчет за изпълнението на програмния бюджет).</li>
<li><strong>Обществени поръчки</strong> — кръстосана връзка към АОП за всяко министерство и неговите второстепенни разпоредители.</li>
</ul>
<p>Виж и <a href="${SITE_URL}/budget/methodology">методологията</a> за пълно описание на източниците, обработката и обхвата.</p>
<p>Източници: <a href="https://data.egov.bg/" rel="nofollow noopener">data.egov.bg</a> (Министерство на финансите — КФП), <a href="https://dv.parliament.bg/" rel="nofollow noopener">Държавен вестник</a> (Закон за държавния бюджет), индивидуални „Отчет за изпълнението на програмния бюджет" на всеки първостепенен разпоредител.</p>`.trim(),
    english: {
      title:
        "Bulgarian State Budget — Execution, Ministries, Procurement | electionsbg.com",
      description:
        "Bulgarian state budget execution — revenue, expenditure, deficit and financing, broken down by ministry and program, with cross-links into public procurement. Sourced from data.egov.bg and Държавен вестник.",
      breadcrumbName: "State budget",
      bodyHtml: `
<h1>Bulgarian state budget</h1>
<p>Execution of Bulgaria's state budget — revenue, expenditure, deficit and financing — summarised per fiscal year from the Ministry of Finance Consolidated Fiscal Programme (KFP) feed and the State Budget Law as promulgated in Държавен вестник.</p>
<h2>What you'll find</h2>
<ul>
<li><strong>Execution by month</strong> — cumulative revenue, expenditure, deficit and EU contribution, plotted against the budget-law line for that year.</li>
<li><strong>Same-point year-over-year comparison</strong> — execution at the end of month X in two chosen years, side by side.</li>
<li><strong>USAFacts-style balance bridge</strong> — money flow from revenue into expenditure with the deficit as a wall.</li>
<li><strong>Top-level spending units</strong> — planned versus actual for each ministry, agency and independent body.</li>
<li><strong>Program budget</strong> — program-level drill-down per ministry, from each ministry's annual report.</li>
<li><strong>Public procurement</strong> — cross-link into AOP for each ministry and its secondary spending units.</li>
</ul>
<p>See also the <a href="${SITE_URL}/en/budget/methodology">methodology</a> for a full description of sources, processing and scope.</p>
<p>Sources: <a href="https://data.egov.bg/" rel="nofollow noopener">data.egov.bg</a> (Ministry of Finance — KFP), <a href="https://dv.parliament.bg/" rel="nofollow noopener">Държавен вестник</a> (State Budget Law), individual annual "Отчет за изпълнението на програмния бюджет" reports from each first-level spending unit.</p>`.trim(),
    },
  }),
  staticPage({
    path: "judiciary",
    title:
      "Съдебна власт — дела, срокове и натовареност на съдиите | electionsbg.com",
    description:
      "Колко дела постъпват в българските съдилища, колко се решават, колко остават висящи, какъв дял приключват в 3-месечния срок и с каква натовареност работят съдиите — по данните на Висшия съдебен съвет от 2018 г. насам.",
    breadcrumbName: "Съдебна власт",
    ogImage: "/og/judiciary.png",
    bodyHtml: `
<h1>Съдебна власт — движение на делата и натовареност</h1>
<p>През ${judiciaryFacts.latestYear} г. в българските съдилища постъпват ${judiciaryFacts.filedBg} дела. Тази страница проследява какво се случва с тях: колко се решават, колко приключват в законовия тримесечен срок, колко остават висящи в края на годината и с каква натовареност работят съдиите — по данни от „Обобщени статистически таблици за дейността на съдилищата" на Висшия съдебен съвет.</p>
<h2>Какво ще намерите тук</h2>
<ul>
<li><strong>Движение на делата</strong> — постъпили, свършени и висящи дела за всяка година от ${judiciaryFacts.firstYear} г. насам. Съдилищата свършват почти толкова дела, колкото постъпват, затова висящите дела остават около ${judiciaryFacts.backlogK} хиляди и не намаляват.</li>
<li><strong>Приключваемост</strong> — свършени ÷ постъпили дела. Под 100% висящите дела растат.</li>
<li><strong>Срокове</strong> — какъв дял от свършените дела приключват в законовия срок до 3 месеца.</li>
<li><strong>Натовареност на съдиите</strong> — и двата официални показателя: „по щат" (спрямо съдийските места) и „действителна" (спрямо реално отработените човекомесеци). Разликата измерва незаетите места и отсъствията.</li>
<li><strong>По съдебен ред</strong> — апелативни, военни, окръжни, районни и административни съдилища, всеки със своите показатели.</li>
<li><strong>Имуществени декларации</strong> — индекс на регистъра на ИВСС: ${judiciaryFacts.declarationsBg} декларации от ${judiciaryFacts.magistratesBg} магистрати (${judiciaryFacts.declFirst}–${judiciaryFacts.declLast}), кога се подават (${judiciaryFacts.mayShareBg}% през май, при срок 15 май), плюс списъците на Инспектората за неподадени в срок декларации и установени несъответствия.</li>
</ul>
<p>Парите на съдебната власт — бюджетът по органи, собствените приходи от съдебни такси и обществените поръчки на ВСС — са на <a href="${SITE_URL}/awarder/121513231">страницата на Висшия съдебен съвет</a>. Виж и <a href="${SITE_URL}/budget">държавния бюджет</a>.</p>
<p>Източник: <a href="https://vss.justice.bg/page/view/1082" rel="nofollow noopener">Висш съдебен съвет — съдебна статистика</a>.</p>`.trim(),
    english: {
      title:
        "Bulgaria's Judiciary — Caseload, Delays and Judges' Workload | electionsbg.com",
      description:
        "How many cases enter Bulgaria's courts, how many are resolved, how many stay pending, what share close inside the statutory three-month deadline, and how heavily judges are loaded — from the Supreme Judicial Council's own statistics since 2018.",
      breadcrumbName: "Judiciary",
      bodyHtml: `
<h1>Bulgaria's judiciary — case movement and judges' workload</h1>
<p>In ${judiciaryFacts.latestYear}, ${judiciaryFacts.filedEn} cases entered Bulgaria's courts. This page tracks what happens to them: how many are resolved, how many close within the statutory three-month deadline, how many are still pending at year end, and how heavily judges are loaded — from the Supreme Judicial Council's annual "Summary statistical tables on the activity of the courts".</p>
<h2>What you'll find</h2>
<ul>
<li><strong>Movement of cases</strong> — filed, resolved and pending for each year since ${judiciaryFacts.firstYear}. The courts finish almost exactly as many cases as arrive, so the backlog stays near ${judiciaryFacts.backlogK},000 and never drains.</li>
<li><strong>Clearance rate</strong> — resolved ÷ filed. Below 100% the backlog grows.</li>
<li><strong>Delays</strong> — the share of resolved cases closed inside the statutory three-month deadline.</li>
<li><strong>Judges' workload</strong> — both official measures: "per allocated post" and "actual" (per person-month really worked). The gap measures vacancies and absences.</li>
<li><strong>By court tier</strong> — appellate, military, regional, district and administrative courts, each with its own figures.</li>
<li><strong>Asset declarations</strong> — an index of the Inspectorate's register: ${judiciaryFacts.declarationsEn} declarations from ${judiciaryFacts.magistratesEn} magistrates (${judiciaryFacts.declFirst}–${judiciaryFacts.declLast}), when they are filed (${judiciaryFacts.mayShareEn}% in May, against a 15 May deadline), plus the Inspectorate's lists of late filers and unresolved discrepancies.</li>
</ul>
<p>The judiciary's money — its budget by spending body, own revenue from court fees, and the Supreme Judicial Council's public procurement — is on the <a href="${SITE_URL}/en/awarder/121513231">Supreme Judicial Council page</a>. See also the <a href="${SITE_URL}/en/budget">state budget</a>.</p>
<p>Source: <a href="https://vss.justice.bg/page/view/1082" rel="nofollow noopener">Supreme Judicial Council — court statistics</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "defense",
    title:
      "Отбрана — разходите на България за отбрана, F-16, износ на оръжие | electionsbg.com",
    description: `Разходите на България за отбрана: ${defenseFacts.latestPct}% от БВП през ${defenseFacts.latestYear} г. по пътя към целта от ${defenseFacts.targetPct}% до ${defenseFacts.targetYear} г., техника срещу заплати, големите програми (F-16, Stryker), рекордният износ на оръжие (${defenseFacts.exportBnBg} млрд. € за ${defenseFacts.exportYear} г.) и готовността на армията.`,
    breadcrumbName: "Отбрана",
    ogImage: "/og/defense.png",
    bodyHtml: `
<h1>Отбрана — разходите на България, програмите и износът на оръжие</h1>
<p>През ${defenseFacts.latestYear} г. България отделя ${defenseFacts.latestPct}% от БВП за отбрана — по пътя към целта на НАТО от ${defenseFacts.targetPct}% до ${defenseFacts.targetYear} г. Тази страница проследява как се харчат тези пари: съотношението техника срещу заплати, големите оръжейни програми, износът на оръжие и готовността на армията — по данни на НАТО, Министерството на икономиката и Министерството на отбраната.</p>
<h2>Какво ще намерите тук</h2>
<ul>
<li><strong>Пътят към 5%</strong> — разходите за отбрана като дял от БВП от 2014 г. насам, спрямо старата цел от 2% (Уелс) и новата от ${defenseFacts.targetPct}% до ${defenseFacts.targetYear} г. (Хага). Скокът през 2019 г. е еднократно авансово плащане по F-16.</li>
<li><strong>Техника срещу заплати</strong> — разпределението на разхода; делът за военна техника скача от 8% (2020) на над 30% с доставките на F-16 и Stryker.</li>
<li><strong>Големите програми</strong> — F-16 (~2,6 млрд. $), Stryker (~1,38 млрд. $), патрулните кораби и барутният завод. Тези сделки са по US FMS и не са в регистъра на обществените поръчки.</li>
<li><strong>Износ на оръжие</strong> — рекордният ръст след 2022 г.: ${defenseFacts.exportBnBg} млрд. € за ${defenseFacts.exportYear} г., ${defenseFacts.cumulativeBnBg} млрд. € от началото на войната.</li>
<li><strong>Хора и готовност</strong> — незаетите щатни бройки и запълването на резерва.</li>
</ul>
<p>Обществените поръчки на 25-те структури на Министерството на отбраната са на <a href="${SITE_URL}/awarder/000695324">страницата на МО</a>. Виж и <a href="${SITE_URL}/indicators">показателите</a> и <a href="${SITE_URL}/budget">държавния бюджет</a>.</p>
<p>Източници: НАТО, Министерство на икономиката, Министерство на отбраната.</p>`.trim(),
    english: {
      title:
        "Bulgaria's Defence — spending, F-16, arms exports | electionsbg.com",
      description: `Bulgaria's defence spending: ${defenseFacts.latestPct}% of GDP in ${defenseFacts.latestYear} on the road to the ${defenseFacts.targetPct}% target by ${defenseFacts.targetYear}, equipment vs personnel, the flagship programs (F-16, Stryker), record arms exports (€${defenseFacts.exportBnEn}bn in ${defenseFacts.exportYear}) and force readiness.`,
      breadcrumbName: "Defense",
      bodyHtml: `
<h1>Bulgaria's defence — spending, programs and arms exports</h1>
<p>In ${defenseFacts.latestYear}, Bulgaria spent ${defenseFacts.latestPct}% of GDP on defence — on the road to NATO's ${defenseFacts.targetPct}% target by ${defenseFacts.targetYear}. This page tracks how that money is spent: the equipment-vs-personnel split, the flagship weapons programs, arms exports and force readiness — from NATO, the Ministry of Economy and the Ministry of Defence.</p>
<h2>What you'll find</h2>
<ul>
<li><strong>The road to 5%</strong> — defence spending as a share of GDP since 2014, against the old 2% target (Wales) and the new ${defenseFacts.targetPct}% by ${defenseFacts.targetYear} (Hague). The 2019 spike is a one-off F-16 down-payment.</li>
<li><strong>Equipment vs personnel</strong> — the spending split; the equipment share jumps from 8% (2020) to over 30% as F-16 and Stryker deliveries land.</li>
<li><strong>The flagship programs</strong> — F-16 (~$2.6bn), Stryker (~$1.38bn), the patrol ships and the ammunition plant. These deals run through US FMS and are not in the procurement register.</li>
<li><strong>Arms exports</strong> — the record post-2022 surge: €${defenseFacts.exportBnEn}bn in ${defenseFacts.exportYear}, €${defenseFacts.cumulativeBnEn}bn since the war began.</li>
<li><strong>People and readiness</strong> — unfilled established posts and reserve fill.</li>
</ul>
<p>The public procurement of the 25 Ministry of Defence units is on the <a href="${SITE_URL}/en/awarder/000695324">МО page</a>. See also the <a href="${SITE_URL}/en/indicators">indicators</a> and the <a href="${SITE_URL}/en/budget">state budget</a>.</p>
<p>Sources: NATO, Ministry of Economy, Ministry of Defence.</p>`.trim(),
    },
  }),
  staticPage({
    path: "culture",
    title:
      "Култура — държавните пари за кино и кой ги получава | electionsbg.com",
    description: `Държавната субсидия на Националния филмов център за кино (${cultureFacts.firstYear}–${cultureFacts.lastYear}): ${cultureFacts.totalBg} за ${cultureFacts.filmsBg} проекта на ${cultureFacts.producersBg} продуценти, по вид и по година, с концентрацията у най-финансираните.`,
    breadcrumbName: "Култура",
    ogImage: "/og/culture.png",
    bodyHtml: `
<h1>Култура — къде отиват държавните пари за кино</h1>
<p>Между ${cultureFacts.firstYear} и ${cultureFacts.lastYear} г. Изпълнителна агенция „Национален филмов център" разпределя ${cultureFacts.totalBg} държавна субсидия за ${cultureFacts.filmsBg} филмови проекта на ${cultureFacts.producersBg} продуценти. Тази страница показва кой получава парите, за какъв вид кино и как се менят през годините — по Единния публичен регистър на НФЦ.</p>
<h2>Какво ще намерите тук</h2>
<ul>
<li><strong>Субсидия по вид</strong> — как се разпределят парите между игрално, документално и анимационно кино.</li>
<li><strong>Субсидия по години</strong> — колко държавно финансиране е раздадено всяка година, включително спада през блокираните сесии.</li>
<li><strong>Концентрация</strong> — кои продуценти печелят най-често; топ 10 държат ${cultureFacts.top10Pct}% от цялата субсидия. Най-финансиран: ${cultureFacts.biggestProducer}.</li>
<li><strong>Най-големите субсидии</strong> — отделните проекти с най-голямо държавно финансиране.</li>
<li><strong>Културата като възложител</strong> — обществените поръчки на Министерството на културата и държавните културни институти, извън субсидиите.</li>
</ul>
<p>Средствата се предоставят чрез художествените комисии на НФЦ, извън Закона за обществените поръчки. Виж и <a href="${SITE_URL}/awarder/000695160">поръчките на Министерството на културата</a> и <a href="${SITE_URL}/budget">държавния бюджет</a>.</p>
<p>Източник: <a href="https://www.nfc.bg/статистика-публичен-регистър/единен-публичен-регистър/" rel="nofollow noopener">Национален филмов център — Единен публичен регистър</a>.</p>`.trim(),
    english: {
      title:
        "Culture — Bulgaria's State Film Money and Who Gets It | electionsbg.com",
      description: `The National Film Center's state subsidy for film (${cultureFacts.firstYear}–${cultureFacts.lastYear}): ${cultureFacts.totalEn} across ${cultureFacts.filmsEn} projects and ${cultureFacts.producersEn} producers, by discipline and year, with the concentration among the most-funded.`,
      breadcrumbName: "Culture",
      bodyHtml: `
<h1>Culture — where Bulgaria's state film money goes</h1>
<p>Between ${cultureFacts.firstYear} and ${cultureFacts.lastYear}, the National Film Center awarded ${cultureFacts.totalEn} in state subsidy across ${cultureFacts.filmsEn} film projects to ${cultureFacts.producersEn} producers. This page shows who gets the money, for what kind of film, and how it moved over time — from the НФЦ public register.</p>
<h2>What you'll find</h2>
<ul>
<li><strong>Subsidy by discipline</strong> — how the money splits between feature, documentary and animation film.</li>
<li><strong>Subsidy by year</strong> — how much state financing was awarded each year, including the dip during the blocked sessions.</li>
<li><strong>Concentration</strong> — which producers win most; the top 10 hold ${cultureFacts.top10Pct}% of all subsidy. Most-funded: ${cultureFacts.biggestProducer}.</li>
<li><strong>Largest subsidies</strong> — the individual projects with the most state financing.</li>
<li><strong>Culture as a public buyer</strong> — the public procurement of the Ministry of Culture and the state cultural institutes, separate from the subsidies.</li>
</ul>
<p>Funds are awarded via the НФЦ artistic commissions, outside the Public Procurement Act. See also the <a href="${SITE_URL}/en/awarder/000695160">Ministry of Culture's procurement</a> and the <a href="${SITE_URL}/en/budget">state budget</a>.</p>
<p>Source: <a href="https://www.nfc.bg/статистика-публичен-регистър/единен-публичен-регистър/" rel="nofollow noopener">National Film Center — public register</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "culture/films",
    title: "Всички филмови субсидии — регистър на НФЦ | electionsbg.com",
    description: `Пълният регистър на държавните субсидии за кино на Националния филмов център (${cultureFacts.firstYear}–${cultureFacts.lastYear}): ${cultureFacts.filmsBg} проекта с търсене, сортиране и филтри по вид и година, с износ на данните.`,
    breadcrumbName: "Всички филмови субсидии",
    ogImage: "/og/culture.png",
    bodyHtml: `
<h1>Всички филмови субсидии на Националния филмов център</h1>
<p>Пълният Единен публичен регистър на финансираните от НФЦ филми и сериали (${cultureFacts.firstYear}–${cultureFacts.lastYear}) — ${cultureFacts.filmsBg} проекта, ${cultureFacts.totalBg} държавна субсидия. Търсете по проект или продуцент, сортирайте по сума и филтрирайте по вид (игрално, документално, анимационно) и година; всеки проект има своя страница.</p>
<p>Виж обобщението и анализа на <a href="${SITE_URL}/culture">страницата Култура</a>.</p>
<p>Източник: <a href="https://www.nfc.bg/статистика-публичен-регистър/единен-публичен-регистър/" rel="nofollow noopener">Национален филмов център — Единен публичен регистър</a>.</p>`.trim(),
    english: {
      title: "All Film Subsidies — НФЦ register | electionsbg.com",
      description: `The full register of the National Film Center's state film subsidies (${cultureFacts.firstYear}–${cultureFacts.lastYear}): ${cultureFacts.filmsEn} projects with search, sort and filters by discipline and year, with data export.`,
      breadcrumbName: "All film subsidies",
      bodyHtml: `
<h1>All film subsidies of the National Film Center</h1>
<p>The full public register of НФЦ-financed films and series (${cultureFacts.firstYear}–${cultureFacts.lastYear}) — ${cultureFacts.filmsEn} projects, ${cultureFacts.totalEn} in state subsidy. Search by project or producer, sort by amount and filter by discipline (feature, documentary, animation) and year; every project has its own page.</p>
<p>See the summary and analysis on the <a href="${SITE_URL}/en/culture">Culture page</a>.</p>
<p>Source: <a href="https://www.nfc.bg/статистика-публичен-регистър/единен-публичен-регистър/" rel="nofollow noopener">National Film Center — public register</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "water/operators",
    title:
      "ВиК оператори — поръчки, конкуренция и еврофондове | electionsbg.com",
    description:
      "Всички ВиК оператори в България — обществени поръчки, дял с една оферта и европейски средства (ИСУН, договорени срещу усвоени), по дружество и област.",
    breadcrumbName: "ВиК оператори",
    bodyHtml: `
<h1>ВиК оператори — поръчки, конкуренция и европейски средства</h1>
<p>Таблица на всички водоснабдителни дружества в България: обществените им поръчки (АОП/ЦАИС ЕОП), делът на договорите с една оферта и усвояването на европейските средства по програмите (ИСУН) — по дружество и област, сортируема.</p>
<p>Виж и <a href="${SITE_URL}/water">обзора на водния сектор</a> и <a href="${SITE_URL}/awarder/206086428">Български ВиК холдинг</a>.</p>`.trim(),
    english: {
      title:
        "Water operators — procurement, competition and EU funds | electionsbg.com",
      description:
        "Every water operator in Bulgaria — public procurement, single-bidder share and EU funds (ИСУН, contracted vs absorbed), by company and region.",
      breadcrumbName: "Water operators",
      bodyHtml: `
<h1>Water operators — procurement, competition and EU funds</h1>
<p>A table of every water utility in Bulgaria: their public procurement (АОП/ЦАИС ЕОП), the share of single-bidder contracts, and their absorption of EU funds (ИСУН) — by company and region, sortable.</p>
<p>See also the <a href="${SITE_URL}/water">water-sector overview</a> and the <a href="${SITE_URL}/awarder/206086428">Bulgarian Water Holding</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "water",
    title:
      "Води (ВиК) — обществените поръчки на водния сектор | electionsbg.com",
    description: `Консолидиран изглед на обществените поръчки на Български ВиК холдинг и неговите ~26 регионални дружества, плюс ${waterFacts.floodEurMln} млн. € за почистване и корекция на речни корита и дерета — по данни от регистъра на обществените поръчки (АОП/ЦАИС ЕОП).`,
    breadcrumbName: "Води (ВиК)",
    ogImage: "/og/water.png",
    bodyHtml: `
<h1>Води (ВиК) — обществените поръчки на водния сектор</h1>
<p>Български ВиК холдинг е принципал на около 26 регионални ВиК дружества. Централата почти не купува — поръчките са в дружествата. Тази страница ги събира на едно място: консолидираните обществени поръчки на групата и какво купуват по функция.</p>
<h2>Какво ще намерите тук</h2>
<ul>
<li><strong>Дружествата в групата</strong> — поръчките на всяко ВиК дружество, с връзка към неговата страница.</li>
<li><strong>Какво купуват — по функция</strong> — строителство на мрежи, водоснабдяване, канализация и пречистване, тръби и помпи, електроенергия.</li>
<li><strong>Почистване на речни корита</strong> — ${waterFacts.floodEurMln} млн. € по ${waterFacts.floodContracts} договора от ${waterFacts.floodAwarders} възложителя за почистване и корекция на речни корита и дерета — отговорност, поделена между общини, областни управители и „Напоителни системи".</li>
</ul>
<p>Предстои: показателите на КЕВР (загуби на вода, цени по области), водният режим (НСИ), нивата на язовирите (МОСВ) и картата на риска от наводнения (РЗПРН).</p>
<p>Виж и <a href="${SITE_URL}/awarder/206086428">Български ВиК холдинг като възложител</a> и <a href="${SITE_URL}/procurement">обществените поръчки</a>.</p>`.trim(),
    english: {
      title:
        "Water (ВиК) — public procurement of the water sector | electionsbg.com",
      description: `A consolidated view of the Bulgarian Water Holding and its ~26 regional operators' public procurement, plus €${waterFacts.floodEurMln}M on cleaning and regulating riverbeds and gullies — from the public-procurement register (АОП/ЦАИС ЕОП).`,
      breadcrumbName: "Water (ВиК)",
      bodyHtml: `
<h1>Water (ВиК) — public procurement of the water sector</h1>
<p>The Bulgarian Water Holding is the principal of ~26 regional water operators. The parent buys almost nothing — the procurement is in the operators. This page brings them together: the group's consolidated public procurement and what they buy by function.</p>
<h2>What you'll find</h2>
<ul>
<li><strong>Operators in the group</strong> — each water operator's procurement, linking to its own page.</li>
<li><strong>What they buy — by function</strong> — network construction, water supply, sewerage and treatment, pipes and pumps, electricity.</li>
<li><strong>Riverbed cleaning</strong> — €${waterFacts.floodEurMln}M across ${waterFacts.floodContracts} contracts from ${waterFacts.floodAwarders} awarders for cleaning and regulating riverbeds and gullies — responsibility split between municipalities, regional governors and Irrigation Systems.</li>
</ul>
<p>Coming next: КЕВР indicators (water loss, tariffs by region), water rationing (NSI), reservoir levels (МОСВ) and the flood-risk map (РЗПРН).</p>
<p>See also the <a href="${SITE_URL}/awarder/206086428">Bulgarian Water Holding as a buyer</a> and <a href="${SITE_URL}/procurement">public procurement</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "pensions",
    title:
      "Пенсии — кой плаща, разпределение и средна пенсия по области | electionsbg.com",
    description: `Кой плаща пенсиите в България (вноски срещу трансфер от бюджета), как са разпределени — ${pensionFacts.minSharePct}% получават минимална пенсия или по-малко — средна пенсия и плащания в брой по области, по данни от статистическия годишник на НОИ.`,
    breadcrumbName: "Пенсии",
    ogImage: "/og/pensions.png",
    bodyHtml: `
<h1>Пенсии — кой плаща и как са разпределени</h1>
<p>През ${pensionFacts.latestYear} г. България изплаща пенсии на ${pensionFacts.pensionersBg} пенсионери, при средна пенсия ${pensionFacts.avgPensionBg} лв на месец. Но средната стойност описва малцина: ${pensionFacts.minSharePct}% от пенсионерите получават минималната пенсия (${pensionFacts.minPension} лв) или по-малко. Тази страница показва разпределението, което средното крие, и кой всъщност плаща.</p>
<h2>Какво ще намерите тук</h2>
<ul>
<li><strong>Кой плаща пенсиите</strong> — собствените осигурителни вноски на ДОО покриват само около половината от разходите; останалото е трансфер от държавния бюджет.</li>
<li><strong>Разпределение по размер</strong> — колко пенсионери получават близо до минимума, колко са на тавана, и къде е линията на бедност.</li>
<li><strong>Средна пенсия по области</strong> — от София-град до Кърджали, спред от около 1,5 пъти.</li>
<li><strong>Плащания в брой по области</strong> — около ${pensionFacts.cashSharePct}% от пенсиите се получават в брой, а не по банков път — географията на финансовото изключване сред пенсионерите.</li>
<li><strong>Заплата, осигурителен доход и пенсия</strong> — националните редове през годините.</li>
</ul>
<p>Обществените поръчки на НОИ — какво купува институтът и от кого — са на <a href="${SITE_URL}/awarder/121082521">страницата на НОИ като възложител</a>. Виж и <a href="${SITE_URL}/budget">държавния бюджет</a>.</p>
<p>Източник: <a href="https://www.nssi.bg/" rel="nofollow noopener">НОИ — статистически годишник „Пенсии"</a>.</p>`.trim(),
    english: {
      title:
        "Bulgaria's Pensions — Who Pays, the Distribution, and Average by Oblast | electionsbg.com",
      description: `Who pays for Bulgaria's pensions (contributions vs the state-budget transfer), how they are distributed — ${pensionFacts.minSharePct}% get the minimum pension or less — average pension and cash payment by oblast, from the NSSI statistical yearbook.`,
      breadcrumbName: "Pensions",
      bodyHtml: `
<h1>Bulgaria's pensions — who pays and how they are distributed</h1>
<p>In ${pensionFacts.latestYear}, Bulgaria paid pensions to ${pensionFacts.pensionersEn} pensioners, at an average of ${pensionFacts.avgPensionBg} лв a month. But the average describes almost no one: ${pensionFacts.minSharePct}% of pensioners get the minimum pension (${pensionFacts.minPension} лв) or less. This page shows the distribution the average hides — and who actually pays.</p>
<h2>What you'll find</h2>
<ul>
<li><strong>Who pays for pensions</strong> — ДОО's own contributions cover only about half of the outlay; the rest is a transfer from the state budget.</li>
<li><strong>Distribution by size</strong> — how many pensioners sit near the minimum, how many at the cap, and where the poverty line falls.</li>
<li><strong>Average pension by oblast</strong> — from Sofia-grad to Kardzhali, a spread of about 1.5×.</li>
<li><strong>Cash payment by oblast</strong> — about ${pensionFacts.cashSharePct}% of pensions are collected in cash rather than paid to a bank account — the geography of financial exclusion among pensioners.</li>
<li><strong>Wage, insurable income and pension</strong> — the national series over time.</li>
</ul>
<p>НОИ's public procurement — what the institute buys and from whom — is on the <a href="${SITE_URL}/en/awarder/121082521">NSSI awarder page</a>. See also the <a href="${SITE_URL}/en/budget">state budget</a>.</p>
<p>Source: <a href="https://www.nssi.bg/" rel="nofollow noopener">NSSI — the "Pensions" statistical yearbook</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "budget/tax-calculator",
    title:
      "Данъчен калкулатор — какво купуват вашите данъци? | electionsbg.com",
    description:
      "Изчислете данъка върху доходите, осигуровките и ДДС за работник, самоосигуряващ се или собственик на фирма — и вижте кои функции на държавното управление финансира вашата данъчна сметка.",
    breadcrumbName: "Данъчен калкулатор",
    ogImage: "/og/budget-tax-calculator.png",
    bodyHtml: `
<h1>Данъчен калкулатор</h1>
<p>Интерактивен калкулатор за българската данъчна и осигурителна тежест. Изберете вид данъкоплатец и месечен доход, за да видите месечната си данъчна сметка и как тя се разпределя по функциите на сектор „Държавно управление".</p>
<h2>Какво изчислява</h2>
<ul>
<li><strong>Данък върху доходите</strong> — плосък данък 10% върху облагаемата основа.</li>
<li><strong>Осигуровки</strong> — 13,78% за работник на трудов договор, 27,8% за самоосигуряващ се, върху максималния осигурителен доход (МОД).</li>
<li><strong>Осигуровки за сметка на работодателя</strong> и пълна цена на труда — данъчно-осигурителната тежест.</li>
<li><strong>Данъчно облекчение за деца</strong>, ефективна и пределна ставка.</li>
<li><strong>ДДС</strong> — приблизителна оценка на 20% ДДС, включено в ежедневното потребление.</li>
<li><strong>Корпоративен данък и данък дивидент</strong> — за собственик на фирма.</li>
<li><strong>Прогноза за пенсия</strong> — въз основа на осигурителния стаж.</li>
</ul>
<p>Виж и <a href="${SITE_URL}/budget">държавния бюджет</a> и <a href="${SITE_URL}/budget/methodology">методологията</a>.</p>`.trim(),
    english: {
      title: "Tax Calculator — What Did Your Taxes Buy? | electionsbg.com",
      description:
        "Estimate income tax, social-security contributions and VAT for an employee, self-employed person or company owner — and see which government functions your tax bill funds.",
      breadcrumbName: "Tax calculator",
      bodyHtml: `
<h1>Tax calculator</h1>
<p>An interactive calculator for Bulgaria's tax and social-security burden. Pick a taxpayer profile and monthly income to see your monthly tax bill and how it maps onto general-government spending.</p>
<h2>What it computes</h2>
<ul>
<li><strong>Income tax</strong> — the flat 10% rate on the taxable base.</li>
<li><strong>Social-security contributions</strong> — 13.78% for an employee, 27.8% for a self-employed person, capped at the maximum insurable income (МОД).</li>
<li><strong>Employer contributions</strong> and the full cost of employment — the tax wedge.</li>
<li><strong>Child tax relief</strong>, plus effective and marginal rates.</li>
<li><strong>VAT</strong> — an estimate of the 20% VAT embedded in everyday spending.</li>
<li><strong>Corporate and dividend tax</strong> — for a company owner.</li>
<li><strong>Pension projection</strong> — based on years of service.</li>
</ul>
<p>See also the <a href="${SITE_URL}/en/budget">state budget</a> and the <a href="${SITE_URL}/en/budget/methodology">methodology</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "budget/simulator",
    title:
      "Бюджетен симулатор — какво става, ако данък се промени? | electionsbg.com",
    description:
      "Какво се случва с приходите в бюджета, ако се промени ДДС, плоският данък, корпоративният данък, данъкът върху дивидентите или таванът на осигурителния доход (МОД)? Преместете плъзгач и вижте статичната оценка — и ефекта върху един примерен фиш за заплата.",
    breadcrumbName: "Бюджетен симулатор",
    ogImage: "/og/budget-simulator.png",
    bodyHtml: `
<h1>Бюджетен симулатор</h1>
<p>Интерактивен симулатор на българската данъчна политика: преместете ставка и вижте две числа едновременно — промяната в приходите на консолидирания бюджет за година и промяната по един примерен фиш за заплата на месец. Оценките са статични, спрямо изпълнението на последната приключена бюджетна година.</p>
<h2>Какво може да се променя</h2>
<ul>
<li><strong>ДДС</strong> — стандартната и намалената ставка, плюс прехвърляне на категории (храни, лекарства, енергия, ресторанти, хотели, книги) между ставките. Моделът стъпва върху потреблението на домакинствата по предназначение (Евростат, COICOP), калибрирано към реалните приходи от ДДС.</li>
<li><strong>Данък върху доходите</strong> — плоската ставка, необлагаем минимум и втора ставка над праг, оценени върху моделирано разпределение на заплатите, валидирано спрямо отчета на НАП.</li>
<li><strong>Корпоративен данък и данък върху дивидентите</strong> — статично преоразмеряване на изпълнените бюджетни редове.</li>
<li><strong>Таван на осигурителния доход (МОД)</strong> — вдигане, сваляне или премахване, с явен диапазон на несигурност.</li>
</ul>
<p>Виж и <a href="${SITE_URL}/budget">държавния бюджет</a>, <a href="${SITE_URL}/budget/tax-calculator">данъчния калкулатор</a> и <a href="${SITE_URL}/budget/methodology">методологията</a>.</p>`.trim(),
    english: {
      title: "Budget Simulator — What if a Tax Rate Changes? | electionsbg.com",
      description:
        "What happens to Bulgaria's budget revenue if VAT, the flat income tax, corporate tax, the dividend tax or the МОД insurance cap changes? Move a slider and see the static estimate — and the effect on a worked payslip.",
      breadcrumbName: "Budget simulator",
      bodyHtml: `
<h1>Budget simulator</h1>
<p>An interactive simulator of Bulgarian tax policy: move a rate and see two numbers at once — the change in consolidated budget revenue per year and the change on one worked payslip per month. Estimates are static, against the latest closed fiscal year's execution.</p>
<h2>What can be changed</h2>
<ul>
<li><strong>VAT</strong> — the standard and reduced rates, plus re-rating categories (food, medicines, energy, restaurants, hotels, books). The model runs on household consumption by COICOP purpose (Eurostat), calibrated to actual VAT revenue.</li>
<li><strong>Personal income tax</strong> — the flat rate, an untaxed minimum and a second rate above a threshold, scored over a fitted earnings distribution validated against the НАП annual report.</li>
<li><strong>Corporate and dividend tax</strong> — static rescaling of the executed budget lines.</li>
<li><strong>The МОД insurable-income cap</strong> — raising, lowering or removing it, with an explicit uncertainty range.</li>
</ul>
<p>See also the <a href="${SITE_URL}/en/budget">state budget</a>, the <a href="${SITE_URL}/en/budget/tax-calculator">tax calculator</a> and the <a href="${SITE_URL}/en/budget/methodology">methodology</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "budget/methodology",
    title: "Методология — Държавен бюджет на България | electionsbg.com",
    description:
      "Откъде идват данните за държавния бюджет на electionsbg.com и как се обработват — КФП на Министерство на финансите, Закон за държавния бюджет и годишните отчети на първостепенните разпоредители.",
    breadcrumbName: "Методология — Бюджет",
    bodyHtml: `
<h1>Методология — държавен бюджет</h1>
<p>Описание на източниците, обработката и обхвата на бюджетните данни на electionsbg.com.</p>
<h2>Източник на данните</h2>
<p>Стойностите идват от набора „Изпълнение на държавния бюджет по основни бюджетни показатели" на Министерство на финансите, публикуван в националния портал за отворени данни <a href="https://data.egov.bg/" rel="nofollow noopener">data.egov.bg</a> под публичен лиценз CC0. Министерството публикува отделен ресурс за всяка месечна снимка на касовото изпълнение, в който са описани петте основни раздела на държавния бюджет — план по закона и изпълнено към момента в съответната фискална година.</p>
<h2>Какво се показва</h2>
<ul>
<li><strong>Приходи</strong> — данъчни и неданъчни приходи, дарения.</li>
<li><strong>Разходи</strong> — текущи, капиталови, социални, субсидии и лихви.</li>
<li><strong>Вноска в бюджета на ЕС</strong> — приносът на България в общия бюджет на ЕС.</li>
<li><strong>Баланс</strong> — приходи минус разходи минус вноската в ЕС; отрицателно означава дефицит.</li>
<li><strong>Финансиране</strong> — как се финансира балансът: външен и вътрешен дълг, депозити, приватизация.</li>
</ul>
<h2>Валута и преминаването към еврото</h2>
<p>България прие еврото на 1 януари 2026 г. Месечните снимки до и включително декември 2025 г. са публикувани в лева; от януари 2026 г. — в евро. Всички стойности на сайта се показват в евро.</p>
<h2>Изпълнение по министерства</h2>
<p>Всеки първостепенен разпоредител публикува свой годишен „Отчет за изпълнението на програмния бюджет". Скриптът ги парсва в единен административен формат и ги съпоставя със Закона за държавния бюджет — така за всяко министерство се вижда план срещу изпълнение на ниво министерство и една стъпка по-надолу — програмен бюджет.</p>
<h2>Кръстосана връзка с обществените поръчки</h2>
<p>Всяко министерство е свързано с агрегата си от обществени поръчки в АОП, така че от страницата на ведомството може директно да се преглежда какво то поръчва и на кого.</p>`.trim(),
    english: {
      title: "Methodology — Bulgarian State Budget | electionsbg.com",
      description:
        "Where electionsbg.com's state-budget data comes from and how it is processed — the Ministry of Finance KFP feed, the State Budget Law, and per-ministry program-execution reports.",
      breadcrumbName: "Methodology — Budget",
      bodyHtml: `
<h1>Methodology — state budget</h1>
<p>This page describes the sources, processing and scope of the state-budget data on electionsbg.com.</p>
<h2>Data source</h2>
<p>The figures come from the Ministry of Finance dataset "state budget execution by major budget indicators", published on the national open-data portal <a href="https://data.egov.bg/" rel="nofollow noopener">data.egov.bg</a> under a public-domain (CC0) licence. The Ministry publishes one resource per monthly cash-execution snapshot; each lists, for the five top-level sections of the state budget, the amount set by the budget law and the amount executed so far that fiscal year.</p>
<h2>What is shown</h2>
<ul>
<li><strong>Revenue</strong> — tax and non-tax revenue, grants and donations.</li>
<li><strong>Expenditure</strong> — personnel, operations, capital, social spending, subsidies and interest.</li>
<li><strong>EU budget contribution</strong> — Bulgaria's contribution to the common EU budget.</li>
<li><strong>Balance</strong> — revenue minus expenditure minus the EU contribution; negative means a deficit.</li>
<li><strong>Financing</strong> — how the balance is financed: external and domestic borrowing, deposits, privatisation.</li>
</ul>
<h2>Currency and the euro changeover</h2>
<p>Bulgaria adopted the euro on 1 January 2026. Monthly snapshots up to and including December 2025 are published in leva; from January 2026 they are in euro. Every figure on the dashboard is shown in euro.</p>
<h2>Per-ministry execution</h2>
<p>Each first-level spending unit publishes its own annual "Report on the execution of the programme budget". The ingest parses these into a uniform admin-grain table and reconciles them against the State Budget Law, so each ministry page shows planned versus actual at the ministry level and one column deeper at the program level.</p>
<h2>Procurement cross-link</h2>
<p>Each ministry is linked to its aggregate of public procurement in AOP, so a ministry's page also surfaces what it is buying and from whom.</p>`.trim(),
    },
  }),
  staticPage({
    path: "observations",
    title:
      "Доклади на ОССЕ/ОДИХР за парламентарните избори в България | electionsbg.com",
    description:
      "Резюмета на международните доклади за наблюдение на парламентарните избори в България след 2005 г. — констатации, повтарящи се препоръки и връзки към пълните доклади на ОССЕ/ОДИХР.",
    breadcrumbName: "Доклади ОССЕ/ОДИХР",
    ogImage: "/og/observations.png",
    bodyHtml: `
<h1>Доклади за наблюдение на изборите в България — ОССЕ/ОДИХР</h1>
<p>Всеки парламентарен вот в България след 2005 г. е наблюдаван от мисия на ОССЕ/ОДИХР — пълноценна Мисия за наблюдение на избори (EOM), Ограничена мисия (LEOM) или Мисия за оценка (EAM). Тази страница обединява всички публикувани доклади на едно място, с кратко резюме на ключовите констатации и линк към пълния документ.</p>
<h2>Какво ще намерите тук</h2>
<ul>
<li><strong>Тип на мисията</strong> — EOM, LEOM или EAM, с дата на провеждане и обхват.</li>
<li><strong>Резюме на констатациите</strong> — кратки тематични обобщения (поведение на кампанията, медийно отразяване, регистрация на избиратели, прозрачност на финансирането, купуване на гласове).</li>
<li><strong>Повтарящи се препоръки</strong> — теми, които ОДИХР продължава да повдига от един вот към следващия.</li>
<li><strong>Връзки към пълните доклади</strong> на сайта на ОССЕ/ОДИХР.</li>
</ul>
<p>Резюметата са генерирани от Claude AI на база публичните доклади. За официалните оценки винаги се обръщайте към оригиналните документи на <a href="https://www.osce.org/odihr/elections/bulgaria" rel="nofollow noopener">www.osce.org/odihr/elections/bulgaria</a>.</p>`.trim(),
    english: {
      title:
        "OSCE/ODIHR Reports on Bulgarian Parliamentary Elections | electionsbg.com",
      description:
        "Summaries of international election-observation reports for every Bulgarian parliamentary vote since 2005 — findings, recurring recommendations, and links to the full OSCE/ODIHR publications.",
      breadcrumbName: "OSCE/ODIHR reports",
      bodyHtml: `
<h1>OSCE/ODIHR election observation reports — Bulgaria</h1>
<p>Every Bulgarian parliamentary vote since 2005 has been observed by an OSCE/ODIHR mission — either a full Election Observation Mission (EOM), a Limited Election Observation Mission (LEOM), or an Election Assessment Mission (EAM). This page collects all published reports in one place, with a short summary of the key findings and a link to the full document.</p>
<h2>What you'll find</h2>
<ul>
<li><strong>Mission type</strong> — EOM, LEOM, or EAM, with the election date and scope.</li>
<li><strong>Findings summary</strong> — short thematic recaps (campaign conduct, media coverage, voter registration, campaign-finance transparency, vote buying).</li>
<li><strong>Recurring recommendations</strong> — issues ODIHR keeps raising election after election.</li>
<li><strong>Links to the full reports</strong> on the OSCE/ODIHR website.</li>
</ul>
<p>Summaries are generated by Claude AI from the public reports. For the official assessments always refer to the original documents at <a href="https://www.osce.org/odihr/elections/bulgaria" rel="nofollow noopener">www.osce.org/odihr/elections/bulgaria</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "data",
    title: "Карта на данните — източници, масиви и функции | electionsbg.com",
    description:
      "Интерактивна карта на всички източници, които electionsbg.com обработва — кои масиви от данни се изграждат от тях и кои функции на сайта ги използват.",
    breadcrumbName: "Данни",
    ogImage: "/og/data-map.png",
    extraJsonLd: [buildDataCatalog("bg")],
    bodyHtml: `
<h1>Карта на данните</h1>
<p>Интерактивна карта на пътя на данните в платформата: от външните източници (ЦИК, Народното събрание, Сметната палата, data.egov.bg, НСИ, Евростат, КЗП и още), през изградените от тях масиви от данни, до функциите на сайта, които ги използват. Един източник често захранва няколко функции — картата показва точно кои.</p>
<h2>Какво показва картата</h2>
<ul>
<li><strong>Източници</strong> — всички външни регистри и портали, които се наблюдават ежедневно за промени, с честота на проверка и дата на последното обновяване. Пълният списък с връзки е на <a href="${SITE_URL}/data/sources">страницата с източници</a>.</li>
<li><strong>Масиви данни</strong> — изборните резултати, гласуванията, бюджетът, поръчките, еврофондовете, цените и останалите обработени набори.</li>
<li><strong>Функции</strong> — интерактивните карти, таблата и инструментите на сайта, свързани към данните, върху които стъпват.</li>
</ul>
<p>Картата се генерира автоматично от регистъра на наблюдаваните източници — нов източник се появява на нея още с добавянето си. Дневникът на обновяванията е на <a href="${SITE_URL}/data/updates">страницата със скорошни промени</a>, а обработените данни са свободни за преизползване под лиценз Creative Commons BY 4.0 — вижте <a href="${SITE_URL}/data/sources">източници и изтегляне</a>.</p>
<h2>Какво се публикува</h2>
<ul>
<li><a href="${SITE_URL}/">Парламентарни избори</a> — резултати по партии, области, общини, населени места и секции.</li>
<li><a href="${SITE_URL}/local/2023_10_29_mi">Местни избори</a> — общински съветници и кметове.</li>
<li><a href="${SITE_URL}/parliament">Народно събрание</a> — поименни гласувания и бизнес връзки на народните представители.</li>
<li><a href="${SITE_URL}/financing">Финансиране на партии</a> и <a href="${SITE_URL}/governments">правителства</a>.</li>
<li><a href="${SITE_URL}/indicators">Макроикономически</a> и <a href="${SITE_URL}/indicators/economy">регионални индикатори</a>, <a href="${SITE_URL}/demographics">демография</a>.</li>
<li><a href="${SITE_URL}/funds">Европейски фондове</a> и <a href="${SITE_URL}/procurement">обществени поръчки</a>.</li>
</ul>`.trim(),
    english: {
      title: "Data map — sources, datasets and features | electionsbg.com",
      description:
        "An interactive map of every source electionsbg.com ingests — the datasets built from them and the site features they power.",
      breadcrumbName: "Data",
      extraJsonLd: [buildDataCatalog("en")],
      bodyHtml: `
<h1>Data map</h1>
<p>An interactive map of how data travels through the platform: from external sources (the election commission, parliament, the audit office, data.egov.bg, the statistics institute, Eurostat, the consumer-protection price monitor and more), through the datasets built from them, to the site features that consume them. One source often feeds several features — the map shows exactly which.</p>
<h2>What the map shows</h2>
<ul>
<li><strong>Sources</strong> — every external register and portal watched daily for changes, with check frequency and the date of the latest refresh. The full list with links lives on the <a href="${SITE_URL}/en/data/sources">sources page</a>.</li>
<li><strong>Datasets</strong> — election results, roll-call votes, the budget, procurement, EU funds, prices and the rest of the processed collections.</li>
<li><strong>Features</strong> — the site's interactive maps, dashboards and tools, linked to the data they stand on.</li>
</ul>
<p>The map is generated automatically from the watched-sources registry — a new source appears on it the moment it is added. The refresh log lives on the <a href="${SITE_URL}/en/data/updates">recent-updates page</a>, and the processed data is free to reuse under Creative Commons BY 4.0 — see <a href="${SITE_URL}/en/data/sources">sources and downloads</a>.</p>
<h2>What is published</h2>
<ul>
<li><a href="${SITE_URL}/en/">Parliamentary elections</a> — results by party, region, municipality, settlement and section.</li>
<li><a href="${SITE_URL}/en/local/2023_10_29_mi">Local elections</a> — municipal councillors and mayors.</li>
<li><a href="${SITE_URL}/en/parliament">Parliament</a> — roll-call votes and MP business connections.</li>
<li><a href="${SITE_URL}/en/financing">Party financing</a> and <a href="${SITE_URL}/en/governments">governments</a>.</li>
<li><a href="${SITE_URL}/en/indicators">Macroeconomic</a> and <a href="${SITE_URL}/en/indicators/economy">regional indicators</a>, <a href="${SITE_URL}/en/demographics">demographics</a>.</li>
<li><a href="${SITE_URL}/en/funds">EU funds</a> and <a href="${SITE_URL}/en/procurement">public procurement</a>.</li>
</ul>`.trim(),
    },
  }),
  staticPage({
    path: "data/sources",
    title: "Източници на данни и изтегляне | electionsbg.com",
    description:
      "Пълният списък с източниците на данни зад electionsbg.com — групирани по тема, с връзки към оригиналните данни и условия за изтегляне и преизползване.",
    breadcrumbName: "Източници на данни",
    ogImage: "/og/data-changes.png",
    bodyHtml: `
<h1>Източници на данни</h1>
<p>Платформата обединява открити и държавни източници: ЦИК, Народното събрание, Сметната палата, data.egov.bg, НСИ, ГРАО, Евростат, Световната банка, КЗП и още. На тази страница те са групирани по тема, с връзки към оригиналните данни.</p>
<h2>Изтегляне и преизползване</h2>
<p>Обработените данни са свободни за преизползване под лиценз Creative Commons BY 4.0, а целият pipeline за обработка е с отворен код. Готовите JSON файлове се сервират публично.</p>
<p>Как източниците се превръщат във функции на сайта показва <a href="${SITE_URL}/data">интерактивната карта на данните</a>; кога какво е обновено — <a href="${SITE_URL}/data/updates">дневникът на промените</a>.</p>`.trim(),
    english: {
      title: "Data sources and downloads | electionsbg.com",
      description:
        "The full list of data sources behind electionsbg.com — grouped by theme, with links to the original data and the terms for downloading and reuse.",
      breadcrumbName: "Data sources",
      bodyHtml: `
<h1>Data sources</h1>
<p>The platform brings together open and government sources: the election commission, parliament, the audit office, data.egov.bg, the statistics institute, the civil registry, Eurostat, the World Bank, the consumer-protection price monitor and more. This page groups them by theme, with links to the original data.</p>
<h2>Download and reuse</h2>
<p>The processed data is free to reuse under a Creative Commons BY 4.0 licence, and the entire processing pipeline is open source. The ready-made JSON files are served publicly.</p>
<p>How the sources become site features is shown on the <a href="${SITE_URL}/en/data">interactive data map</a>; when something was refreshed — in the <a href="${SITE_URL}/en/data/updates">update log</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "data/updates",
    title: "Скорошни промени в данните | electionsbg.com",
    description:
      "Дневник на обновяванията — кога и какво е обновено в наборите от данни на сайта: гласувания, декларации, бюджет, поръчки, еврофондове, цени и индикатори.",
    breadcrumbName: "Скорошни промени",
    ogImage: "/og/data-changes.png",
    bodyHtml: `
<h1>Скорошни промени в данните</h1>
<p>Публичният дневник на обновяванията: коя дата кой набор от данни е бил подновен — парламентарни гласувания, имуществени декларации, бюджетно изпълнение, обществени поръчки, еврофондове, цени, социологически проучвания и индикатори — и накъде може да се отиде, за да се види промяната в действие.</p>
<p>Откъде идват данните показва <a href="${SITE_URL}/data">картата на данните</a>, а пълният списък с източници е на <a href="${SITE_URL}/data/sources">страницата с източници</a>.</p>`.trim(),
    english: {
      title: "Recent data updates | electionsbg.com",
      description:
        "The public refresh log — when and what was updated across the site's datasets: roll-call votes, declarations, budget, procurement, EU funds, prices and indicators.",
      breadcrumbName: "Recent updates",
      bodyHtml: `
<h1>Recent data updates</h1>
<p>The public refresh log: on which date which dataset was renewed — roll-call votes, asset declarations, budget execution, public procurement, EU funds, prices, opinion polls and indicators — and where to go to see the change in action.</p>
<p>Where the data comes from is shown on the <a href="${SITE_URL}/en/data">data map</a>, and the full source list lives on the <a href="${SITE_URL}/en/data/sources">sources page</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "data-changes",
    title: "Промени в данните на electionsbg.com | electionsbg.com",
    description:
      "Дневник на обновяванията — кога и какво е обновено в наборите от данни на сайта: парламентарни гласувания, имуществени декларации, социологически проучвания, макро и регионални индикатори.",
    breadcrumbName: "Промени в данните",
    ogImage: "/og/data-changes.png",
    canonicalUrl: `${SITE_URL}/data/updates`,
    bodyHtml: `
<h1>Промени в данните на electionsbg.com</h1>
<p>Сайтът публикува редовно нови или актуализирани набори от данни — от парламентарни гласувания и имуществени декларации на народните представители до макроикономически и регионални индикатори. Тази страница е публичният дневник на тези обновявания: коя дата кое е било подменено и накъде може да се отиде, за да се види то в действие.</p>
<h2>Какво се проследява</h2>
<ul>
<li><strong>Парламентарни гласувания</strong> — нови сесии с поименни гласувания, лоялност, кохезия и сходство по групи.</li>
<li><strong>Народни представители</strong> — биографии, снимки и разпределение на местата след обновяване от parliament.bg.</li>
<li><strong>Бизнес интереси на НП</strong> — нови декларации от Сметната палата и роли в Търговския регистър.</li>
<li><strong>Финансиране на партии</strong> — нови годишни финансови отчети, публикувани от Сметната палата.</li>
<li><strong>Социологически проучвания</strong> — нови предизборни и общи проучвания, добавени към таблицата за точност.</li>
<li><strong>Макро и регионални индикатори</strong> — нови серии от Евростат, Световна банка, Eurobarometer и НСИ.</li>
</ul>
<p>Записите се добавят автоматично от скриптовете в pipeline-а — всеки път, когато един от тях успешно обнови съответната част от данните.</p>`.trim(),
    english: {
      title: "Data Changes on electionsbg.com | electionsbg.com",
      description:
        "Public update log — when and what was refreshed in the site's datasets: roll-call votes, MP property declarations, polling, macro and regional indicators.",
      breadcrumbName: "Data changes",
      canonicalUrl: `${SITE_URL}/en/data`,
      bodyHtml: `
<h1>Data changes on electionsbg.com</h1>
<p>The site regularly publishes new or updated datasets — from parliamentary roll-call votes and MP property declarations through macroeconomic and regional indicators. This page is the public log of those refreshes: on which date what was replaced, and where to look to see it in action.</p>
<h2>What is tracked</h2>
<ul>
<li><strong>Parliamentary roll-call votes</strong> — new sessions with loyalty, cohesion, and group-similarity metrics.</li>
<li><strong>Members of Parliament</strong> — biographies, photos, and seat allocations after a refresh from parliament.bg.</li>
<li><strong>MP business interests</strong> — new declarations filed with the Court of Audit and Commerce Registry roles.</li>
<li><strong>Party financing</strong> — new annual financial reports published by the Court of Audit.</li>
<li><strong>Opinion polls</strong> — new pre-election and general-track polls added to the accuracy table.</li>
<li><strong>Macro and regional indicators</strong> — new series from Eurostat, the World Bank, Eurobarometer, and the NSI.</li>
</ul>
<p>Entries are added automatically by the pipeline scripts — each time one of them successfully refreshes the corresponding slice of the data.</p>`.trim(),
    },
  }),
  staticPage({
    path: "demographics",
    title:
      "Демография на България — Преброяване 2021 и резултати по области | electionsbg.com",
    description:
      "Преброяването 2021 на НСИ наложено върху регионалните изборни данни — етнос, вероизповедание, образование, възраст и заетост по 28-те области и 265 общини, плюс корелации с резултатите на партиите.",
    breadcrumbName: "Демография",
    ogImage: "/og/demographics.png",
    bodyHtml: `
<h1>Демография на България — Преброяване 2021</h1>
<p>Окончателните резултати на Преброяване 2021 на НСИ (към 7 септември 2021 г.), представени паралелно с електоралните данни — за всяка от 28-те области и 265-те общини: етнически състав, вероизповедание, образование, възрастова структура, заетост и пол.</p>
<h2>Какво ще намерите тук</h2>
<ul>
<li><strong>Разбивка за цялата страна</strong> — общи дялове по етнос, вероизповедание, образование, възраст и пол (6 519 789 души).</li>
<li><strong>Карта по демографски показател</strong> — хороплет по 14 показателя на ниво област, превключваем чрез падащо меню.</li>
<li><strong>Резултат на партия спрямо демография</strong> — точкова графика на областно ниво с коефициент на корелация (Pearson r) — изборният резултат на избрана партия срещу избрана демографска променлива.</li>
<li><strong>Сравнение по области</strong> и <strong>сравнение по общини</strong> — отделни сортируеми таблици на дъщерни страници (<code>/demographics/regions</code> и <code>/demographics/municipalities</code>) с филтър по име.</li>
<li><strong>Демография на общинско и селищно ниво</strong> — отделни прозорци на страниците на областите, общините и населените места (за селищата НСИ публикува само население, възраст и пол).</li>
</ul>
<p>Източник: <a href="https://census2021.bg/" rel="nofollow noopener">Преброяване на населението и жилищния фонд 2021 г. на НСИ</a>.</p>`.trim(),
    english: {
      title:
        "Bulgaria Demographics — Census 2021 vs. Election Results by Oblast | electionsbg.com",
      description:
        "NSI Census 2021 mapped onto Bulgaria's regional electoral data — ethnicity, religion, education, age and employment across 28 oblasts and 265 municipalities, with party-level correlation crosstabs.",
      breadcrumbName: "Demographics",
      bodyHtml: `
<h1>Bulgaria demographics — Census 2021</h1>
<p>Final results of Bulgaria's 2021 Population and Housing Census (reference date 7 September 2021), shown alongside the electoral data — for each of the 28 oblasts and 265 municipalities: ethnic composition, religious denomination, education attainment, age structure, employment and sex.</p>
<h2>What you'll find</h2>
<ul>
<li><strong>Country breakdown</strong> — national shares by ethnicity, religion, education, age and sex (6,519,789 residents).</li>
<li><strong>Choropleth map</strong> — 14 toggleable demographic indicators at oblast level.</li>
<li><strong>Vote share vs. demographics</strong> — oblast-level scatter with Pearson correlation between any party's regional vote share and any demographic dimension.</li>
<li><strong>Oblast comparison table</strong> and <strong>municipality comparison table</strong> — sortable, paginated tables on dedicated subpages (<code>/demographics/regions</code> and <code>/demographics/municipalities</code>) with a name filter.</li>
<li><strong>Per-oblast, per-obshtina and per-settlement dashboards</strong> — embedded demographic tile on every regional page (settlements show population, age and sex only — NSI doesn't publish ethnicity, religion or education at that granularity).</li>
</ul>
<p>Source: <a href="https://census2021.bg/" rel="nofollow noopener">NSI Population and Housing Census 2021</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "demographics/regions",
    title: "Демография на 28-те области — Преброяване 2021 | electionsbg.com",
    description:
      "Сортируема таблица с демографските показатели на 28-те административни области от Преброяване 2021 на НСИ — население, етнос, вероизповедание, образование, възраст и заетост.",
    breadcrumbName: "Области — демография",
    bodyHtml: `
<h1>Демография по области — Преброяване 2021</h1>
<p>Преброяване 2021 на НСИ за 28-те административни области на България — население, етнически състав, вероизповедание, образование, възрастова структура и заетост, в сортируема таблица. София-град е представена като една област; областните данни не следят разделението на трите столични МИР, които съществуват само в електоралната статистика.</p>
<p>Източник: <a href="https://census2021.bg/" rel="nofollow noopener">Преброяване на населението и жилищния фонд 2021 г. на НСИ</a>.</p>`.trim(),
    english: {
      title: "Bulgaria oblast demographics — Census 2021 | electionsbg.com",
      description:
        "Sortable table with Census 2021 demographics for Bulgaria's 28 administrative oblasts — population, ethnicity, religion, education, age and employment.",
      breadcrumbName: "Oblast demographics",
      bodyHtml: `
<h1>Bulgaria oblast demographics — Census 2021</h1>
<p>NSI Census 2021 data for Bulgaria's 28 administrative oblasts — population, ethnic composition, religion, education attainment, age structure and employment, in a sortable table. Sofia City is represented as a single oblast; the three Sofia electoral districts (MIRs) only exist in the election dataset.</p>
<p>Source: <a href="https://census2021.bg/" rel="nofollow noopener">NSI Population and Housing Census 2021</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "demographics/municipalities",
    title: "Демография на 265-те общини — Преброяване 2021 | electionsbg.com",
    description:
      "Сортируема таблица с демографските показатели на 265-те общини на България от Преброяване 2021 на НСИ — население, етнос, вероизповедание, образование, възраст и заетост, с филтър по име.",
    breadcrumbName: "Общини — демография",
    bodyHtml: `
<h1>Демография по общини — Преброяване 2021</h1>
<p>Преброяване 2021 на НСИ за 265-те общини на България — население, етнически състав, вероизповедание, образование, възрастова структура и заетост. Таблицата поддържа сортиране по всяка колона, филтър по име на общината и страниране (по 30 общини на страница).</p>
<p>Източник: <a href="https://census2021.bg/" rel="nofollow noopener">Преброяване на населението и жилищния фонд 2021 г. на НСИ</a>.</p>`.trim(),
    english: {
      title:
        "Bulgaria municipality demographics — Census 2021 | electionsbg.com",
      description:
        "Sortable table with Census 2021 demographics for Bulgaria's 265 municipalities — population, ethnicity, religion, education, age and employment, with a name filter.",
      breadcrumbName: "Municipality demographics",
      bodyHtml: `
<h1>Bulgaria municipality demographics — Census 2021</h1>
<p>NSI Census 2021 data for Bulgaria's 265 municipalities — population, ethnic composition, religion, education attainment, age structure and employment. The table supports per-column sorting, a name filter and pagination (30 municipalities per page).</p>
<p>Source: <a href="https://census2021.bg/" rel="nofollow noopener">NSI Population and Housing Census 2021</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "risk-analysis",
    title: "Анализ на изборния риск — обобщен скрининг | electionsbg.com",
    description:
      "Композитен индекс на изборния риск плюс шест независими статистически сигнала: секционен скрининг, тест на Бенфорд, разлики с флаш паметта, концентрация на гласове, рискови махали и съответствие със социологията.",
    breadcrumbName: "Анализ на риска",
    ogImage: "/og/risk-analysis.png",
    bodyHtml: `
<h1>Анализ на изборния риск</h1>
<p>Тази страница обединява всеки статистически сигнал за рисково поведение, който публикуваме за избрания парламентарен вот. Композитният индекс на изборния риск дава една обобщена оценка от 0 до 100, а тилите под него позволяват разглеждане на всеки от отделните сигнали, които я съставят.</p>
<h2>Какво включва</h2>
<ul>
<li><a href="${SITE_URL}/risk-score">Скрининг на риска по секции</a> — композитна оценка от шест независими статистически теста за всяка избирателна секция.</li>
<li><a href="${SITE_URL}/benford">Закон на Бенфорд</a> — разпределение на първата и втората цифра в броя гласове по партии.</li>
<li>Машинно гласуване — секции с разминаване между протокола от флаш паметта и официалния протокол.</li>
<li>Концентрация на гласовете — секции с подозрително висок дял за една партия.</li>
<li>Рискови махали — секции в Ромските махали с исторически тренд.</li>
<li>Съпоставка със социологията — средни предизборни прогнози срещу окончателен резултат.</li>
</ul>
<p>Това е инструмент за <strong>скрининг</strong>, не присъда. Всеки сигнал има невинни обяснения и трябва да се чете в контекст. Виж <a href="${SITE_URL}/risk-analysis/methodology">пълната методология</a> за детайли.</p>`.trim(),
    english: {
      title:
        "Election Risk Analysis — Consolidated Screening | electionsbg.com",
      description:
        "Composite Election Risk Index plus six independent statistical signals: section-level risk score, Benford digit distributions, flash-memory drift, vote concentration, at-risk neighborhoods, and polling expectation gap.",
      breadcrumbName: "Risk analysis",
      bodyHtml: `
<h1>Election risk analysis</h1>
<p>This page consolidates every statistical screening signal we publish for the selected parliamentary vote. The Election Risk Index gives one rolled-up 0–100 reading, and the tiles below let you drill into each of the underlying signals that feed it.</p>
<h2>What's included</h2>
<ul>
<li><a href="${SITE_URL}/en/risk-score">Section-level risk screening</a> — composite score from six independent statistical tests per polling section.</li>
<li><a href="${SITE_URL}/en/benford">Benford's law</a> — first- and second-digit distributions of per-section vote counts, by party.</li>
<li>Machine voting — sections where the flash-memory protocol disagrees with the official protocol.</li>
<li>Vote concentration — sections with a suspiciously high single-party share.</li>
<li>At-risk neighborhoods — sections inside Roma neighborhoods with historical trend.</li>
<li>Polling expectation gap — pre-election poll averages against the final result.</li>
</ul>
<p>This is a <strong>screening</strong> tool, not a verdict. Each signal has innocent explanations and must be read in context. See the <a href="${SITE_URL}/en/risk-analysis/methodology">full methodology</a> for details.</p>`.trim(),
    },
  }),
  staticPage({
    path: "risk-analysis/methodology",
    title: "Индекс на изборния риск — методология | electionsbg.com",
    description:
      "Как се изчислява композитният индекс на изборния риск: тегла на шестте сигнала, скали, бенчмаркове и ограничения.",
    breadcrumbName: "Методология на анализа",
    ogImage: "/og/risk-analysis-methodology.png",
    bodyHtml: `
<h1>Индекс на изборния риск — методология</h1>
<p>Композитният Индекс на изборния риск свежда шест независими сигнала до една обобщена оценка от 0 до 100. Тази страница описва точно как се изчислява всеки от компонентите, как се претеглят и какво НЕ показва числото.</p>
<h2>Какво обхваща страницата</h2>
<ul>
<li>Кои са шестте сигнала и как се изчислява всеки поотделно.</li>
<li>Как се нормализират към единна 0–100 скала, преди да се обединят.</li>
<li>Тегла, прагове и категории (Нисък / Умерен / Висок / Критичен).</li>
<li>Кога индексът подвежда — малки извадки, демографски ефекти, законни корекции.</li>
</ul>
<p>Виж самата страница <a href="${SITE_URL}/risk-analysis">Анализ на изборния риск</a> за приложение върху последните избори.</p>`.trim(),
    english: {
      title: "Election Risk Index — Methodology | electionsbg.com",
      description:
        "How the composite Election Risk Index is built: weights on six signals, normalization, benchmarks, and limitations.",
      breadcrumbName: "Risk analysis methodology",
      bodyHtml: `
<h1>Election Risk Index — methodology</h1>
<p>The composite Election Risk Index distils six independent screening signals into a single 0–100 reading. This page documents exactly how each component is computed, how they are weighted, and what the number does not say.</p>
<h2>What this page covers</h2>
<ul>
<li>The six underlying signals and how each is computed.</li>
<li>How signals are normalized to a common 0–100 scale before they are combined.</li>
<li>Weights, thresholds, and bands (Low / Moderate / High / Critical).</li>
<li>When the index misleads — small samples, demographic effects, lawful recount corrections.</li>
</ul>
<p>See the <a href="${SITE_URL}/en/risk-analysis">Election Risk Analysis</a> page for the index applied to the latest election.</p>`.trim(),
    },
  }),
  staticPage({
    path: "risk-score",
    title:
      "Скрининг на риска по секции — парламентарни избори | electionsbg.com",
    description:
      "Композитна оценка 0–100 за всяка избирателна секция, която обединява шест независими сигнала: разлики при преброяване, разминаване с флаш паметта, дял невалидни бюлетини, допълнително вписани, концентрация и отклонение спрямо съседни секции.",
    breadcrumbName: "Скрининг на секциите",
    ogImage: "/og/risk-score.png",
    bodyHtml: `
<h1>Скрининг на риска по секции</h1>
<p>За всяка избирателна секция изчисляваме композитна оценка от 0 до 100, която обединява шест независими статистически сигнала, вече публикувани като отделни доклади. Висока оценка означава, че секцията заслужава по-внимателен преглед — не присъда.</p>
<h2>Шестте сигнала</h2>
<ul>
<li><strong>Разлики при преброяване</strong> — разлики между първото и второто броене на бюлетините.</li>
<li><strong>Разминаване с флаш паметта</strong> — несъответствие между официалния протокол и протокола от устройството за машинно гласуване.</li>
<li><strong>Дял невалидни бюлетини</strong> — секции с необичайно висок дял на недействителни гласове.</li>
<li><strong>Допълнително вписани</strong> — секции с непропорционално много дописани в избирателния списък.</li>
<li><strong>Концентрация</strong> — секции с подозрително висок дял за една партия.</li>
<li><strong>Отклонение спрямо съседни секции</strong> — резултати, които се различават статистически от близките секции в същото населено място.</li>
</ul>
<p>Виж <a href="${SITE_URL}/risk-score/methodology">пълната методология</a> за прагове, формули и категории.</p>`.trim(),
    english: {
      title:
        "Section-level Risk Screening — Bulgarian Parliamentary Elections | electionsbg.com",
      description:
        "Composite 0–100 score per polling section, combining six independent signals: recount delta, flash-memory mismatch, invalid-ballot share, additional voters, single-party concentration, and outlier vs. peer sections.",
      breadcrumbName: "Section risk screening",
      bodyHtml: `
<h1>Section-level risk screening</h1>
<p>Each polling section receives a composite 0–100 score combining six independent statistical signals already published as standalone reports. A high score means the section is statistically unusual along multiple dimensions and warrants a closer look — that is all.</p>
<h2>The six signals</h2>
<ul>
<li><strong>Recount delta</strong> — discrepancies between the first and second tally of ballots.</li>
<li><strong>Flash-memory mismatch</strong> — gap between the official protocol and the machine-voting device's protocol.</li>
<li><strong>Invalid-ballot share</strong> — sections with an unusually high share of invalid ballots.</li>
<li><strong>Additional voters</strong> — sections with a disproportionately high count of voters added on election day.</li>
<li><strong>Vote concentration</strong> — sections with a suspiciously high single-party share.</li>
<li><strong>Peer-section outliers</strong> — results that diverge statistically from nearby sections in the same settlement.</li>
</ul>
<p>See the <a href="${SITE_URL}/en/risk-score/methodology">full methodology</a> for thresholds, formulas, and bands.</p>`.trim(),
    },
  }),
  staticPage({
    path: "risk-score/methodology",
    title: "Скрининг на секциите — методология | electionsbg.com",
    description:
      "Точните дефиниции, прагове и формули зад секционния скрининг — как всеки от шестте сигнала се изчислява и как се обединяват в обща оценка.",
    breadcrumbName: "Методология на скрининга",
    ogImage: "/og/risk-score-methodology.png",
    bodyHtml: `
<h1>Скрининг на секциите — методология</h1>
<p>Тази страница описва как се изчислява композитната оценка за всяка избирателна секция: какво измерва всеки от шестте сигнала, какви прагове прилагаме и как се обединяват в едно число от 0 до 100.</p>
<h2>Шестте сигнала</h2>
<ul>
<li><strong>Разлики при преброяване</strong> — статистическо отклонение между първото и второто броене.</li>
<li><strong>Разминаване с флаш паметта</strong> — несъответствия между двата протокола.</li>
<li><strong>Дял невалидни бюлетини</strong> — секции, чийто дял е значително над общинския медиан.</li>
<li><strong>Допълнително вписани</strong> — % допълнителни избиратели спрямо първоначалния списък.</li>
<li><strong>Концентрация</strong> — индекс на Хърфиндал–Хиршман по партии.</li>
<li><strong>Отклонение спрямо съседни секции</strong> — z-score спрямо съседи в същото населено място.</li>
</ul>
<p>За резюме виж главната страница <a href="${SITE_URL}/risk-score">Скрининг на риска по секции</a>.</p>`.trim(),
    english: {
      title: "Section Risk Screening — Methodology | electionsbg.com",
      description:
        "Exact definitions, thresholds, and formulas behind the section-level risk screening — how each of the six signals is computed and how they are combined into a single score.",
      breadcrumbName: "Risk screening methodology",
      bodyHtml: `
<h1>Section risk screening — methodology</h1>
<p>This page documents how the composite score per polling section is built: what each of the six signals measures, the thresholds we apply, and how they are combined into a single 0–100 reading.</p>
<h2>The six signals</h2>
<ul>
<li><strong>Recount delta</strong> — statistical departure between the first and second tally.</li>
<li><strong>Flash-memory mismatch</strong> — discrepancies between the two protocols.</li>
<li><strong>Invalid-ballot share</strong> — sections significantly above the municipal median.</li>
<li><strong>Additional voters</strong> — share of voters added on top of the initial roll.</li>
<li><strong>Vote concentration</strong> — Herfindahl–Hirschman index across parties.</li>
<li><strong>Peer-section outliers</strong> — z-score against neighboring sections in the same settlement.</li>
</ul>
<p>For the live screen see <a href="${SITE_URL}/en/risk-score">Section-level risk screening</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "benford",
    title:
      "Законът на Бенфорд по партии — парламентарни избори | electionsbg.com",
    description:
      "Разпределение на първата и втората цифра в броя гласове по секции, по партии. Сравнява наблюдаваните дялове с очакваната крива на Бенфорд, с обяснение защо отклонението не е доказателство за фалшификация.",
    breadcrumbName: "Закон на Бенфорд",
    ogImage: "/og/benford.png",
    bodyHtml: `
<h1>Законът на Бенфорд по партии</h1>
<p>Законът на Бенфорд описва закономерност в естествени числови масиви: водещата цифра не се появява с еднаква честота. Изборната криминалистика заимства теста с хипотезата, че изфабрикуваните резултати трудно биха следвали тази крива.</p>
<p>Тук показваме разпределението на първата и втората цифра в броя гласове по секции за всяка партия и го сравняваме с очакваната крива на Бенфорд. Литературата (Mebane) препоръчва теста за втора цифра (2BL) пред теста за първа цифра при изборни данни, тъй като броят на гласовете в секция е ограничен в малък диапазон.</p>
<p><strong>Това не е доказателство за фалшификация.</strong> Много чисти изборни данни не преминават теста за първа цифра. Виж <a href="${SITE_URL}/benford/methodology">пълната методология</a> за нюансите.</p>`.trim(),
    english: {
      title:
        "Benford's Law by Party — Bulgarian Parliamentary Elections | electionsbg.com",
      description:
        "First- and second-digit distributions of per-section vote counts, by party. Compares observed shares against the Benford-expected curve, with the caveats explaining why deviation is not evidence of fraud.",
      breadcrumbName: "Benford's law",
      bodyHtml: `
<h1>Benford's law by party</h1>
<p>Benford's law describes a regularity in many naturally-occurring numerical datasets: the leading digit does not appear with equal frequency. Election forensics borrowed the test on the hypothesis that fabricated results would struggle to follow the same curve.</p>
<p>This page shows the first- and second-digit distribution of per-section vote counts for each party against the Benford-expected curve. The literature (Mebane) recommends the second-digit test (2BL) over the first-digit test for election data, because per-section vote counts are range-bounded.</p>
<p><strong>This is not evidence of fraud.</strong> Plenty of clean electoral data fails the first-digit test. See the <a href="${SITE_URL}/en/benford/methodology">full methodology</a> for the nuances.</p>`.trim(),
    },
  }),
  staticPage({
    path: "benford/methodology",
    title: "Законът на Бенфорд — методология | electionsbg.com",
    description:
      "Защо съществува тестът на Бенфорд, какво показват резултатите му, защо предпочитаме теста за втора цифра (2BL) и кога отклоненията не бива да ни подвеждат.",
    breadcrumbName: "Методология на Бенфорд",
    ogImage: "/og/benford-methodology.png",
    bodyHtml: `
<h1>Законът на Бенфорд — методология</h1>
<p>Тази страница обяснява защо съществува тестът на Бенфорд, защо предпочитаме теста за втора цифра (2BL) пред този за първа цифра при изборни данни, какви прагове прилагаме и как се четат показателите MAD и χ². Целта е да направим прозрачно както какво може, така и какво не може да каже тестът.</p>
<h2>Какво ще намерите тук</h2>
<ul>
<li>Защо тестът за първа цифра често дава „отклонение“ при чисти изборни данни.</li>
<li>Защо 2BL (втора цифра) е препоръчителен — линията на Mebane.</li>
<li>Прагове: минимум 10 гласа на секция, минимум 30 секции на партия.</li>
<li>Категории по MAD: Близо до Бенфорд / Умерено / Силно отклонение.</li>
</ul>
<p>За приложението виж <a href="${SITE_URL}/benford">Закон на Бенфорд по партии</a>.</p>`.trim(),
    english: {
      title: "Benford's Law — Methodology | electionsbg.com",
      description:
        "Why this test exists, what its results actually tell us, why we prefer the second-digit test (2BL), and when deviations should not mislead us.",
      breadcrumbName: "Benford methodology",
      bodyHtml: `
<h1>Benford's law — methodology</h1>
<p>This page explains why the Benford test exists, why we prefer the second-digit test (2BL) to the first-digit test for election data, what thresholds we apply, and how MAD and χ² should be read. The goal is to make transparent both what the test can and cannot say.</p>
<h2>What you'll find</h2>
<ul>
<li>Why the first-digit test often shows "deviation" on clean electoral data.</li>
<li>Why 2BL (second digit) is preferred — Mebane's line of work.</li>
<li>Thresholds: minimum 10 votes per section, minimum 30 sections per party.</li>
<li>MAD bands: Close to Benford / Moderate / Strong deviation.</li>
</ul>
<p>For the live screen see <a href="${SITE_URL}/en/benford">Benford's law by party</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "persistence",
    title:
      "Лоялност на гласоподавателите — парламентарни избори | electionsbg.com",
    description:
      "Дял на гласоподавателите за идентифицирани партии, които остават при същата партия между два последователни избора — измерено по секции с регресия Goodman и мащабиране RAS.",
    breadcrumbName: "Лоялност",
    ogImage: "/og/persistence.png",
    bodyHtml: `
<h1>Лоялност на гласоподавателите</h1>
<p>За всеки парламентарен вот изчисляваме каква част от гласоподавателите за идентифицирани партии са останали при същата партия между двата последователни избора. Това отделя партийната лоялност от колебанията в избирателната активност.</p>
<h2>Как се чете</h2>
<ul>
<li><strong>Дял на лоялните</strong> — % гласоподаватели, които са избрали същата партия и на двата вота.</li>
<li><strong>Сменили партия</strong> — % гласоподаватели, които са преминали при друга партия между двата избора.</li>
<li><strong>Най-голям преход</strong> — единичното най-голямо движение партия → партия (източник, цел, дял от изходящите гласове на партията-източник).</li>
<li><strong>По МИР</strong> — лоялност за всеки многомандатен район, плюс най-стабилните и най-колебливите.</li>
</ul>
<p>Лоялността е оценена от поток на гласовете по секции (NNLS Goodman регресия + RAS мащабиране). Сигналът е устойчив на регионално ниво, но е <strong>агрегирана оценка</strong>, не индивидуално измерване.</p>`.trim(),
    english: {
      title:
        "Voter Persistence — Bulgarian Parliamentary Elections | electionsbg.com",
      description:
        "Share of named-party voters who stayed with the same party across two consecutive elections — estimated from per-section vote flow with NNLS Goodman regression and RAS scaling.",
      breadcrumbName: "Voter persistence",
      bodyHtml: `
<h1>Voter persistence</h1>
<p>For each parliamentary vote we estimate what share of named-party voters stayed with the same party across two consecutive elections. This isolates party loyalty from swings in turnout.</p>
<h2>How to read it</h2>
<ul>
<li><strong>Stay rate</strong> — share of voters who chose the same named party in both elections.</li>
<li><strong>Churn</strong> — share of named-party voters who switched parties between cycles.</li>
<li><strong>Top defection</strong> — the single largest party-to-party movement (source, destination, share of source-party outflow).</li>
<li><strong>By region</strong> — loyalty per multi-mandate region, plus the most stable and most volatile regions.</li>
</ul>
<p>Persistence is estimated from per-section voter flow (NNLS Goodman regression + RAS scaling). The signal is robust at the regional level but is an <strong>aggregate estimate</strong>, not an individual-voter measurement.</p>`.trim(),
    },
  }),
  staticPage({
    path: "wasted-vote",
    title:
      "Изгубени гласове за партии под 4% — парламентарни избори | electionsbg.com",
    description:
      "Дял на действителните гласове, подадени за партии под прага от 4% — гласове, които не са избрали никого. Разбивка национално и по МИР.",
    breadcrumbName: "Изгубени гласове",
    ogImage: "/og/wasted-vote.png",
    bodyHtml: `
<h1>Изгубени гласове за партии под 4%</h1>
<p>В българската избирателна система партии под прага от 4% не получават мандати. Гласовете, подадени за тях, остават без представителство — често ги наричаме „изгубени гласове“.</p>
<h2>Какво се показва</h2>
<ul>
<li><strong>Изгубени национално</strong> — общ дял на гласовете за партии под прага.</li>
<li><strong>Близо до прага (2–4%)</strong> — партии, които са били почти на ръба.</li>
<li><strong>Под 2%</strong> — фрагментирани „маргинални“ гласове.</li>
<li><strong>По МИР</strong> — карта и сортируема таблица по многомандатни райони. Виж <a href="${SITE_URL}/wasted-vote/regions">пълния списък по области</a>.</li>
</ul>
<p>Изчисление: сума на гласовете за партии под 4% национален праг, разделена на общия брой действителни гласове.</p>`.trim(),
    english: {
      title:
        "Wasted Votes — Sub-4% Parties in Bulgarian Parliamentary Elections | electionsbg.com",
      description:
        "Share of valid votes cast for parties below the 4% national threshold — votes that elected nobody. National and per-region breakdown.",
      breadcrumbName: "Wasted votes",
      bodyHtml: `
<h1>Wasted votes — parties below 4%</h1>
<p>Bulgaria's electoral system gives no seats to parties under the 4% threshold. Votes cast for those parties end up with no representation — what we usually call "wasted votes".</p>
<h2>What you'll find</h2>
<ul>
<li><strong>Wasted nationally</strong> — total share of votes cast for sub-threshold parties.</li>
<li><strong>Almost made it (2–4%)</strong> — parties that came close to passing.</li>
<li><strong>Fringe (&lt;2%)</strong> — fragmented "margin" votes.</li>
<li><strong>By region</strong> — choropleth map plus sortable table by multi-mandate region. See the <a href="${SITE_URL}/en/wasted-vote/regions">full regional ranking</a>.</li>
</ul>
<p>Calculation: sum of votes for parties below the 4% national threshold, divided by total valid votes.</p>`.trim(),
    },
  }),
  staticPage({
    path: "wasted-vote/regions",
    title:
      "Изгубени гласове по области — парламентарни избори | electionsbg.com",
    description:
      "Сортируема таблица с дела на изгубените гласове за всеки от 28-те многомандатни района — гласове за партии под 4% национален праг.",
    breadcrumbName: "Изгубени гласове по МИР",
    ogImage: "/og/wasted-vote.png",
    bodyHtml: `
<h1>Изгубени гласове по области</h1>
<p>Пълна сортируема таблица по 28-те многомандатни избирателни района (МИР). За всяка област — общ брой действителни гласове, гласове за партии под 4% и дял изгубени гласове.</p>
<p>Виж и <a href="${SITE_URL}/wasted-vote">обобщеното представяне</a> на национално ниво с карта и топ партии под прага.</p>`.trim(),
    english: {
      title:
        "Wasted Votes by Region — Bulgarian Parliamentary Elections | electionsbg.com",
      description:
        "Sortable table of wasted-vote share across all 28 Bulgarian multi-mandate districts (MIR) — votes cast for parties below the 4% national threshold.",
      breadcrumbName: "Wasted votes by region",
      bodyHtml: `
<h1>Wasted votes by region</h1>
<p>Sortable table across Bulgaria's 28 multi-mandate districts (MIR). For each region — total valid votes, votes for sub-4% parties, and the wasted-vote share.</p>
<p>See also the <a href="${SITE_URL}/en/wasted-vote">national overview</a> with the choropleth map and top sub-threshold parties.</p>`.trim(),
    },
  }),
  staticPage({
    path: "where-did-votes-go/methodology",
    title: "Къде отидоха гласовете — методология | electionsbg.com",
    description:
      "Методология на анализа на потока на гласовете между две парламентарни сесии — NNLS Goodman регресия по секции, RAS мащабиране и ограниченията на агрегираната оценка.",
    breadcrumbName: "Методология на потока на гласовете",
    ogImage: "/og/vote-flow-methodology.png",
    bodyHtml: `
<h1>Къде отидоха гласовете — методология</h1>
<p>Анализът „Къде отидоха гласовете“ оценява потока от една партия към друга между два последователни вота на ниво многомандатен район. Тази страница описва статистическия метод зад оценките.</p>
<h2>Какво обхваща страницата</h2>
<ul>
<li>Goodman регресия с неотрицателни най-малки квадрати (NNLS) на ниво секция.</li>
<li>RAS мащабиране, което гарантира, че редовете и колоните на матрицата на прехода съответстват на наблюдаваните общи стойности.</li>
<li>Защо включваме „малки партии“ и негласувалите като отделни категории.</li>
<li>Кога методът подвежда — секции с малък брой гласоподаватели, демографски промени, новорегистрирани избиратели.</li>
</ul>
<p>Виж също <a href="${SITE_URL}/persistence">Лоялност на гласоподавателите</a>, която използва същия метод за измерване на партийната устойчивост.</p>`.trim(),
    english: {
      title: "Where Did Votes Go — Methodology | electionsbg.com",
      description:
        "Methodology behind the vote-flow analysis between two parliamentary cycles — per-section NNLS Goodman regression, RAS scaling, and the limits of an aggregate estimate.",
      breadcrumbName: "Vote-flow methodology",
      bodyHtml: `
<h1>Where did votes go — methodology</h1>
<p>The "where did votes go" analysis estimates flows from one party to another between two consecutive cycles at the multi-mandate region level. This page documents the statistical method behind the estimates.</p>
<h2>What this page covers</h2>
<ul>
<li>Non-negative least squares (NNLS) Goodman regression at the section level.</li>
<li>RAS scaling, which forces the row and column sums of the transition matrix to match observed totals.</li>
<li>Why "small parties" and abstainers are included as their own categories.</li>
<li>When the method misleads — sections with few voters, demographic change, newly registered voters.</li>
</ul>
<p>See also <a href="${SITE_URL}/en/persistence">Voter persistence</a>, which uses the same method to measure party loyalty.</p>`.trim(),
    },
  }),
  staticPage({
    path: "connections",
    title: "Бизнес-връзки между народните представители | electionsbg.com",
    description:
      "Графика на бизнес-връзките между действащите народни представители — общи фирми, имуществени декларации и пътища между депутати от различни партии.",
    breadcrumbName: "Бизнес-връзки",
    ogImage: "/og/connections.png",
    bodyHtml: `
<h1>Бизнес-връзки между народните представители</h1>
<p>Графиката на бизнес-връзките показва кои действащи народни представители са свързани чрез обща фирма, съвместно акционерство или роли в управлението. Източник са декларациите, подадени пред Сметната палата, и публичните данни от Търговския регистър.</p>
<h2>Какво ще намерите тук</h2>
<ul>
<li>Графика на връзките с разцветяване по партийна група.</li>
<li>Откриване на пътища между двама конкретни депутати.</li>
<li><a href="${SITE_URL}/mp/companies">Списък на всички фирми</a> с поне един депутат-собственик или ръководител.</li>
<li><a href="${SITE_URL}/mp-assets">Класиране на депутатите</a> по декларирани активи.</li>
<li><a href="${SITE_URL}/mp-cars">Декларирани коли</a> на народните представители.</li>
</ul>
<p>Източник: <a href="https://register.cacbg.bg" rel="nofollow noopener">register.cacbg.bg</a> (Сметна палата) и <a href="https://www.registryagency.bg" rel="nofollow noopener">Търговски регистър</a>.</p>`.trim(),
    english: {
      title: "MP Business Connections — Bulgarian Parliament | electionsbg.com",
      description:
        "Network graph of business connections among sitting Bulgarian MPs — shared companies, asset declarations, and paths between MPs from different parties.",
      breadcrumbName: "MP business connections",
      bodyHtml: `
<h1>MP business connections</h1>
<p>The business-connections graph shows which sitting Bulgarian MPs are connected through a shared company, joint shareholding, or roles on the same board. Sources: declarations filed with the Bulgarian Court of Audit, and public Commerce Registry filings.</p>
<h2>What you'll find</h2>
<ul>
<li>Network graph coloured by parliamentary group.</li>
<li>Path-finding between any two named MPs.</li>
<li><a href="${SITE_URL}/en/mp/companies">List of all companies</a> with at least one MP owner or director.</li>
<li><a href="${SITE_URL}/en/mp-assets">MPs ranked</a> by declared assets.</li>
<li><a href="${SITE_URL}/en/mp-cars">Cars declared</a> by MPs.</li>
</ul>
<p>Sources: <a href="https://register.cacbg.bg" rel="nofollow noopener">register.cacbg.bg</a> (Court of Audit) and the <a href="https://www.registryagency.bg" rel="nofollow noopener">Bulgarian Commerce Registry</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "mp/companies",
    title: "Фирми с участие на народни представители | electionsbg.com",
    description:
      "Списък на всички фирми, в които действащите народни представители са собственици, акционери или членове на управлението — данни от Търговския регистър и декларациите на Сметната палата.",
    breadcrumbName: "Фирми на депутати",
    ogImage: "/og/mp-companies.png",
    bodyHtml: `
<h1>Фирми с участие на народни представители</h1>
<p>Списък на всички фирми, в които поне един действащ народен представител фигурира като собственик, акционер или роля в управлението. Данните се обединяват от декларациите, подадени пред Сметната палата, и от публичните филинги в Търговския регистър.</p>
<p>За мрежовия изглед виж <a href="${SITE_URL}/connections">Бизнес-връзки между депутатите</a>.</p>`.trim(),
    english: {
      title:
        "Companies Owned or Run by MPs — Bulgarian Parliament | electionsbg.com",
      description:
        "Every company in which a sitting Bulgarian MP is an owner, shareholder, or board member — sourced from the Commerce Registry and Court of Audit declarations.",
      breadcrumbName: "MP companies",
      bodyHtml: `
<h1>Companies owned or run by MPs</h1>
<p>Every company in which at least one sitting Bulgarian MP figures as an owner, shareholder, or role on the board. Data is combined from declarations filed with the Court of Audit and public filings in the Commerce Registry.</p>
<p>For the network view see <a href="${SITE_URL}/en/connections">MP business connections</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "mp-assets",
    title: "Народни представители по декларирани активи | electionsbg.com",
    description:
      "Класиране на действащите народни представители по декларирано имущество — недвижими имоти, превозни средства, парични средства, инвестиции и дялове във фирми (декларант + съпруг).",
    breadcrumbName: "Активи на депутати",
    ogImage: "/og/mp-assets.png",
    bodyHtml: `
<h1>Народни представители по декларирани активи</h1>
<p>Класиране на действащите народни представители по нетното имущество, декларирано в последната подадена декларация пред Сметната палата. Нетното имущество се изчислява като сума на декларираните недвижими имоти, превозни средства, парични средства и банкови депозити, вземания, инвестиции, ценни книжа и дялове във фирми (декларант + съпруг), намалена с декларираните задължения.</p>
<p>Източник: <a href="https://register.cacbg.bg" rel="nofollow noopener">register.cacbg.bg</a> (Сметна палата).</p>`.trim(),
    english: {
      title: "MPs by Declared Assets — Bulgarian Parliament | electionsbg.com",
      description:
        "Sitting Bulgarian MPs ranked by net worth from their most recent property/interest declaration filed with the Court of Audit (declarant + spouse, minus declared debts).",
      breadcrumbName: "MPs by assets",
      bodyHtml: `
<h1>MPs by declared assets</h1>
<p>Sitting Bulgarian MPs ranked by net worth from their most recent property/interest declaration filed with the Court of Audit. Net worth is the sum of declared real estate, vehicles, cash, bank deposits, receivables, investments, securities and company shares (declarant + spouse) minus declared debts.</p>
<p>Source: <a href="https://register.cacbg.bg" rel="nofollow noopener">register.cacbg.bg</a> (Bulgarian Court of Audit).</p>`.trim(),
    },
  }),
  staticPage({
    path: "officials/assets",
    title: "Длъжностни лица по декларирано имущество | electionsbg.com",
    description:
      "Министри, ръководители на държавни агенции и областни управители, подредени по нетен имот според най-новата декларация пред Сметната палата.",
    breadcrumbName: "Активи на длъжностните лица",
    ogImage: "/og/officials-assets.png",
    bodyHtml: `
<h1>Длъжностни лица по декларирано имущество</h1>
<p>Класиране на министри, заместник-министри, ръководители на държавни и изпълнителни агенции и областни управители по нетен имот според най-новата декларация за имущество и интереси, подадена пред Сметната палата. Нетният имот се изчислява като сума на декларирани имоти, превозни средства, парични средства, банкови депозити, вземания, инвестиции, ценни книжа и дялове във фирми (декларант + съпруг/а), намалена с декларирани задължения.</p>
<p>Кметове и магистрати са в отделни регистри и не са включени тук.</p>
<p>Виж и <a href="${SITE_URL}/mp-assets">депутатите по декларирано имущество</a>. Източник: <a href="https://register.cacbg.bg" rel="nofollow noopener">register.cacbg.bg</a> (Сметна палата).</p>`.trim(),
    english: {
      title: "Officials by Declared Assets — Bulgaria | electionsbg.com",
      description:
        "Bulgarian cabinet members, state-agency heads, and regional governors ranked by net worth from their most recent property/interest declaration with the Court of Audit.",
      breadcrumbName: "Officials by assets",
      bodyHtml: `
<h1>Officials by declared assets</h1>
<p>Bulgarian cabinet members, deputy ministers, state-agency heads, and regional governors ranked by net worth from their most recent property/interest declaration filed with the Court of Audit. Net worth is the sum of declared real estate, vehicles, cash, bank deposits, receivables, investments, securities and company shares (declarant + spouse) minus declared debts.</p>
<p>Mayors and judiciary are tracked in separate registers and are not included here.</p>
<p>See also <a href="${SITE_URL}/en/mp-assets">MPs by declared assets</a>. Source: <a href="https://register.cacbg.bg" rel="nofollow noopener">register.cacbg.bg</a> (Bulgarian Court of Audit).</p>`.trim(),
    },
  }),
  staticPage({
    path: "mp-cars",
    title: "Коли, декларирани от народните представители | electionsbg.com",
    description:
      "Всеки лек автомобил или джип, деклариран от действащ депутат (или съпруг), от последната подадена декларация — подреден по декларирана стойност в лева.",
    breadcrumbName: "Коли на депутати",
    ogImage: "/og/mp-cars.png",
    bodyHtml: `
<h1>Коли, декларирани от народните представители</h1>
<p>Всеки лек автомобил или джип, деклариран от действащ народен представител (или съпруг) в последната подадена пред Сметната палата декларация — подреден по декларирана стойност в лева. Колите на съпругата/съпруга се показват с притежател „съпруг“.</p>
<p>Източник: <a href="https://register.cacbg.bg" rel="nofollow noopener">register.cacbg.bg</a> (Сметна палата).</p>`.trim(),
    english: {
      title: "Cars Declared by MPs — Bulgarian Parliament | electionsbg.com",
      description:
        "Every passenger car or jeep declared by a sitting Bulgarian MP (or spouse) in their most recent declaration, sorted by declared BGN value.",
      breadcrumbName: "MP cars",
      bodyHtml: `
<h1>Cars declared by MPs</h1>
<p>Every passenger car or jeep declared by a sitting MP (or spouse) in their most recent declaration filed with the Court of Audit — sorted by declared BGN value. Spouse-held cars are listed with holder = spouse.</p>
<p>Source: <a href="https://register.cacbg.bg" rel="nofollow noopener">register.cacbg.bg</a> (Bulgarian Court of Audit).</p>`.trim(),
    },
  }),
  staticPage({
    path: "procurement",
    title:
      "Обществени поръчки — договори и народни представители | electionsbg.com",
    description:
      "Агрегирани данни за обществените поръчки от data.egov.bg — топ изпълнители, възложители и народни представители с бизнес-интереси в спечелили фирми.",
    breadcrumbName: "Обществени поръчки",
    ogImage: "/og/procurement.png",
    bodyHtml: `
<h1>Обществени поръчки — договори и народни представители</h1>
<p>Агрегирани данни за обществените поръчки, публикувани от Агенцията по обществени поръчки (АОП) чрез data.egov.bg. Можете да разгледате данните в рамките на мандата на избраното Народно събрание или за целия наличен период.</p>
<h2>Какво ще намерите тук</h2>
<ul>
<li>Обобщени статистики — брой договори, обща сума, брой изпълнители и възложители.</li>
<li><a href="${SITE_URL}/procurement/contracts">Договори</a> — пълна сортируема и филтрируема таблица с всички договори.</li>
<li><a href="${SITE_URL}/procurement/contractors">Топ изпълнители</a> — фирми с най-голям обем спечелени поръчки.</li>
<li><a href="${SITE_URL}/procurement/awarders">Топ възложители</a> — държавни органи с най-голям обем възложени поръчки.</li>
<li><a href="${SITE_URL}/procurement/mps">Депутати и длъжностни лица с връзки</a> — народни представители и служители, чиито свързани фирми са спечелили поръчки.</li>
<li><a href="${SITE_URL}/procurement/sectors">Какво купува държавата</a> — класация на секторите (CPV) по обща стойност на поръчките.</li>
<li><a href="${SITE_URL}/procurement/by-settlement">Поръчки по населено място</a> — сумите, разпределени по адреса на възложителя.</li>
<li><a href="${SITE_URL}/procurement/appeals">Жалби (КЗК)</a> — жалбите пред Комисията за защита на конкуренцията срещу процедури за обществени поръчки.</li>
<li><a href="${SITE_URL}/procurement/flags">Сигнали за риск</a> — концентрация върху един изпълнител и фирми в черен списък.</li>
</ul>
<p>Източник: <a href="https://data.egov.bg/organisation/about/aop" rel="nofollow noopener">data.egov.bg</a> (АОП OCDS, двуседмични пакети).</p>`.trim(),
    english: {
      title: "Public Procurement — Contracts and MPs | electionsbg.com",
      description:
        "Aggregated public-procurement data from data.egov.bg — top contractors, awarders, and MPs whose connected companies won contracts.",
      breadcrumbName: "Public procurement",
      bodyHtml: `
<h1>Public procurement — contracts and MPs</h1>
<p>Aggregated public-procurement data published by the Bulgarian Public Procurement Agency (АОП) via data.egov.bg. Browse data scoped to the selected parliament's term or across the full corpus.</p>
<h2>What you'll find</h2>
<ul>
<li>Summary statistics — contract count, total value, contractor and awarder counts.</li>
<li><a href="${SITE_URL}/en/procurement/contracts">Contracts</a> — full sortable, filterable table of every contract.</li>
<li><a href="${SITE_URL}/en/procurement/contractors">Top contractors</a> — companies with the highest total procurement.</li>
<li><a href="${SITE_URL}/en/procurement/awarders">Top awarders</a> — state bodies with the highest total awarded.</li>
<li><a href="${SITE_URL}/en/procurement/mps">MPs & officials connected</a> — MPs and officials whose declared business interests received procurement.</li>
<li><a href="${SITE_URL}/en/procurement/sectors">What does the state buy</a> — CPV sectors ranked by total procurement value.</li>
<li><a href="${SITE_URL}/en/procurement/by-settlement">By settlement</a> — totals pinned to the buyer's HQ address.</li>
<li><a href="${SITE_URL}/en/procurement/appeals">Appeals (КЗК)</a> — appeals to the Commission for Protection of Competition against procurement procedures.</li>
<li><a href="${SITE_URL}/en/procurement/flags">Red flags</a> — single-supplier concentration and debarred suppliers.</li>
</ul>
<p>Source: <a href="https://data.egov.bg/organisation/about/aop" rel="nofollow noopener">data.egov.bg</a> (АОП OCDS, fortnightly bundles).</p>`.trim(),
    },
  }),
  staticPage({
    path: "procurement/contracts",
    title: "Договори за обществени поръчки — търсене | electionsbg.com",
    description:
      "Пълна сортируема и филтрируема таблица на договорите за обществени поръчки — възложител, изпълнител, сума, дата и сигнали за риск, с връзка към всеки отделен договор.",
    breadcrumbName: "Договори",
    ogImage: "/og/procurement-contracts.png",
    bodyHtml: `
<h1>Договори за обществени поръчки</h1>
<p>Пълната таблица с договорите от централния регистър на АОП (data.egov.bg) — търсене и филтриране по възложител, изпълнител и сума, с подреждане по стойност, дата или ниво на риск. Всеки ред води към страницата на отделния договор с пълните детайли.</p>
<p>Маркирани са договорите със сигнали за риск (концентрация върху един изпълнител, единствен участник, фирма в черен списък). Може да филтрирате само маркираните.</p>
<p>Виж и <a href="${SITE_URL}/procurement">общия преглед на обществените поръчки</a>, <a href="${SITE_URL}/procurement/sectors">секторите (CPV)</a> и <a href="${SITE_URL}/procurement/flags">сигналите за риск</a>.</p>`.trim(),
    english: {
      title: "Public Procurement Contracts — Search | electionsbg.com",
      description:
        "Full sortable, filterable table of public-procurement contracts — awarder, contractor, amount, date and risk flags, with a link to every individual contract.",
      breadcrumbName: "Contracts",
      bodyHtml: `
<h1>Public procurement contracts</h1>
<p>The full contract table from the central АОП register (data.egov.bg) — search and filter by awarder, contractor and amount, sorted by value, date or risk level. Every row links to that contract's full detail page.</p>
<p>Contracts carrying risk flags (single-supplier concentration, single bidder, debarred company) are highlighted, and you can filter to the flagged ones only.</p>
<p>See also the <a href="${SITE_URL}/en/procurement">procurement overview</a>, <a href="${SITE_URL}/en/procurement/sectors">CPV sectors</a> and <a href="${SITE_URL}/en/procurement/flags">red flags</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "procurement/ngos",
    title:
      "Организации с нестопанска цел — сдружения, фондации, читалища | electionsbg.com",
    description:
      "Търсене в регистъра на юридическите лица с нестопанска цел (ЮЛНЦ) — сдружения, фондации и читалища, техните управителни органи, публично и външно финансиране и сигнали за конфликт на интереси.",
    breadcrumbName: "НПО",
    ogImage: "/og/procurement-ngos.png",
    bodyHtml: `
<h1>Организации с нестопанска цел</h1>
<p>Регистърът на юридическите лица с нестопанска цел (сдружения, фондации и читалища) от общата база на Търговския регистър и регистъра на ЮЛНЦ — сортируема и филтрируема таблица по вид и категория, с връзка към страницата на всяка организация.</p>
<p>За всяка организация се показват управителните органи (управителен съвет, представляващи, настоятелства), целите и статутът за обществена полза, полученото публично и външно финансиране (държавни субсидии, пряко управлявани средства от ЕС), както и сигнали за конфликт на интереси, когато член на властта е в управата на НПО, спечелило обществени поръчки или субсидии.</p>
<p>Виж и <a href="${SITE_URL}/procurement">общия преглед на обществените поръчки</a> и <a href="${SITE_URL}/procurement/mps">депутатите и длъжностните лица с връзки</a>.</p>`.trim(),
    english: {
      title:
        "Non-profit organisations — associations, foundations | electionsbg.com",
      description:
        "Search the register of non-profit legal entities (NPOs) — associations, foundations and community centres, their governing bodies, public and external funding, and conflict-of-interest flags.",
      breadcrumbName: "NPOs",
      bodyHtml: `
<h1>Non-profit organisations</h1>
<p>The register of non-profit legal entities (associations, foundations and community centres) from the shared Commerce and NPO register — a sortable, filterable table by type and category, linking to each organisation's page.</p>
<p>Each organisation shows its governing bodies (management board, representatives, boards of trustees), objectives and public-benefit status, the public and external funding it received (state subsidies, directly-managed EU funds), and conflict-of-interest flags when a person in power sits on the board of an NGO that won public contracts or subsidies.</p>
<p>See also the <a href="${SITE_URL}/en/procurement">procurement overview</a> and <a href="${SITE_URL}/en/procurement/mps">connected MPs and officials</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "procurement/sectors",
    title: "Какво купува държавата — сектори (CPV) | electionsbg.com",
    description:
      "Пълна класация на CPV секторите по обща стойност на обществените поръчки — брой договори и дял от общия разход, с връзка към договорите във всеки сектор.",
    breadcrumbName: "Какво купува държавата",
    ogImage: "/og/procurement-sectors.png",
    bodyHtml: `
<h1>Какво купува държавата</h1>
<p>Пълна класация на секторите на обществените поръчки по CPV (Common Procurement Vocabulary) код, подредени по обща стойност в избрания период. Всеки сектор показва дял от общия разход и брой договори, с връзка към филтрираните договори в сектора.</p>
<p>Виж и <a href="${SITE_URL}/procurement">общия преглед на обществените поръчки</a> и <a href="${SITE_URL}/procurement/contracts">пълната таблица с договори</a>.</p>`.trim(),
    english: {
      title: "What Does the State Buy — CPV Sectors | electionsbg.com",
      description:
        "Full ranking of CPV procurement sectors by total value — contract count and share of total spend, with a link to the contracts in every sector.",
      breadcrumbName: "What does the state buy",
      bodyHtml: `
<h1>What does the state buy</h1>
<p>Full ranking of public-procurement sectors by CPV (Common Procurement Vocabulary) code, sorted by total value in the selected period. Each sector shows its share of total spend and contract count, with a link to that sector's filtered contracts.</p>
<p>See also the <a href="${SITE_URL}/en/procurement">procurement overview</a> and the <a href="${SITE_URL}/en/procurement/contracts">full contracts table</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "procurement/flags",
    title: "Сигнали за риск в обществените поръчки | electionsbg.com",
    description:
      "Концентрация на разход върху един изпълнител, фирми в черен списък и изпълнители, свързани с депутати — сигнали за риск от данните на АОП.",
    breadcrumbName: "Сигнали за риск",
    ogImage: "/og/procurement-flags.png",
    bodyHtml: `
<h1>Сигнали за риск в обществените поръчки</h1>
<p>Сигнали, които заслужават повторен поглед: възложители, чийто разход е концентриран върху един изпълнител, фирми в черния списък на АОП и най-големите изпълнители, свързани с народни представители. Всеки е факт от публичен регистър, а не обвинение.</p>
<p>Виж и <a href="${SITE_URL}/procurement">общия преглед</a>.</p>`.trim(),
    english: {
      title: "Public-Procurement Red Flags | electionsbg.com",
      description:
        "Single-supplier spend concentration, debarred suppliers, and MP-tied contractors — procurement red flags from AOP data.",
      breadcrumbName: "Red flags",
      bodyHtml: `
<h1>Public-procurement red flags</h1>
<p>Signals worth a second look: buyers whose spending is concentrated on a single supplier, suppliers on the AOP debarment register, and the largest MP-tied contractors. Each is a public-record fact, not an accusation.</p>
<p>See also the <a href="${SITE_URL}/en/procurement">overview</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "procurement/appeals",
    title: "Жалби по обществени поръчки (КЗК) | electionsbg.com",
    description:
      "Жалби пред Комисията за защита на конкуренцията (КЗК) срещу обществени поръчки — възложител, жалбоподател, предмет и изход, свързани с процедурата по УНП. Преглед, не доказателство за нарушение.",
    breadcrumbName: "Жалби (КЗК)",
    ogImage: "/og/procurement-appeals.png",
    bodyHtml: `
<h1>Жалби по обществени поръчки (КЗК)</h1>
<p>Пълна, сортируема и филтрируема таблица с жалбите пред Комисията за защита на конкуренцията (КЗК) срещу процедури за обществени поръчки — по възложител, жалбоподател, предмет и изход (уважена, отхвърлена, прекратена), с връзка към съответната процедура по уникалния номер (УНП), когато е налична.</p>
<p>Жалбата е преглед на процедурата от независим орган, а не доказателство за нарушение. Данните са от публичния регистър на КЗК и се обновяват периодично.</p>
<p>Виж и <a href="${SITE_URL}/procurement">общия преглед на обществените поръчки</a>, <a href="${SITE_URL}/procurement/tenders">обявените процедури</a> и <a href="${SITE_URL}/procurement/flags">сигналите за риск</a>.</p>`.trim(),
    english: {
      title: "Public-Procurement Appeals (КЗК) | electionsbg.com",
      description:
        "Appeals to the Commission for Protection of Competition (КЗК) against public-procurement procedures — buyer, complainant, subject and outcome, joined to the procedure by its UNP. A review, not proof of wrongdoing.",
      breadcrumbName: "Appeals (КЗК)",
      bodyHtml: `
<h1>Public-procurement appeals (КЗК)</h1>
<p>A full, sortable and filterable table of appeals to the Commission for Protection of Competition (КЗК) against public-procurement procedures — by buyer, complainant, subject and outcome (upheld, rejected, terminated), each linked to its procedure by the unique procedure number (UNP) where available.</p>
<p>An appeal is an independent review of the procedure, not proof of wrongdoing. The data comes from the public КЗК register and is refreshed periodically.</p>
<p>See also the <a href="${SITE_URL}/en/procurement">procurement overview</a>, the <a href="${SITE_URL}/en/procurement/tenders">announced procedures</a> and the <a href="${SITE_URL}/en/procurement/flags">red flags</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "procurement/contractors",
    title: "Топ изпълнители на обществени поръчки | electionsbg.com",
    description:
      "Пълна сортируема таблица на фирмите, спечелили най-много обществени поръчки — обща сума, брой договори и дали фирмата е свързана с народен представител.",
    breadcrumbName: "Топ изпълнители",
    ogImage: "/og/procurement-contractors.png",
    bodyHtml: `
<h1>Топ изпълнители на обществени поръчки</h1>
<p>Пълна сортируема таблица на фирмите, спечелили най-много обществени поръчки от публичния регистър на АОП. Изпълнителите, свързани с народен представител, са маркирани.</p>
<p>Виж и <a href="${SITE_URL}/procurement">общия преглед на обществените поръчки</a> и <a href="${SITE_URL}/procurement/mps">депутатите с бизнес-интереси</a>.</p>`.trim(),
    english: {
      title: "Top Public Procurement Contractors | electionsbg.com",
      description:
        "Full sortable table of companies that won the most public-procurement contracts — total value, contract count, and whether the company is MP-connected.",
      breadcrumbName: "Top contractors",
      bodyHtml: `
<h1>Top public procurement contractors</h1>
<p>Full sortable table of companies with the highest total procurement from the Bulgarian Public Procurement Agency (АОП) register. MP-connected contractors are highlighted.</p>
<p>See also the <a href="${SITE_URL}/en/procurement">procurement overview</a> and <a href="${SITE_URL}/en/procurement/mps">MPs with business interests</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "procurement/awarders",
    title: "Топ възложители на обществени поръчки | electionsbg.com",
    description:
      "Държавни органи с най-голям обем възложени обществени поръчки — обща сума в евро, брой договори и период на активност.",
    breadcrumbName: "Топ възложители",
    ogImage: "/og/procurement-awarders.png",
    bodyHtml: `
<h1>Топ възложители на обществени поръчки</h1>
<p>Държавни органи и общини, наредили най-много обществени поръчки в рамките на мандата на избраното Народно събрание — подредени по обща стойност на договорите в евро.</p>
<p>Виж и <a href="${SITE_URL}/procurement">общия преглед</a> и <a href="${SITE_URL}/procurement/contractors">топ изпълнителите</a>.</p>`.trim(),
    english: {
      title: "Top Public Procurement Awarders | electionsbg.com",
      description:
        "State bodies with the highest total awarded in public procurement — total EUR value, contract count, and the period covered.",
      breadcrumbName: "Top awarders",
      bodyHtml: `
<h1>Top public procurement awarders</h1>
<p>Government bodies and municipalities that awarded the most procurement during the selected parliament's term — ranked by total contract value converted to EUR.</p>
<p>See also the <a href="${SITE_URL}/en/procurement">overview</a> and <a href="${SITE_URL}/en/procurement/contractors">top contractors</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "procurement/by-settlement",
    title: "Обществени поръчки по населено място | electionsbg.com",
    description:
      "Сумите от обществените поръчки, разпределени по населено място според адреса на седалището на възложителя — общини, училища, болници, университети, регионални администрации. Министерствата и националните държавни компании са обобщени отделно.",
    breadcrumbName: "Поръчки по населено място",
    ogImage: "/og/procurement-by-settlement.png",
    bodyHtml: `
<h1>Обществени поръчки по населено място</h1>
<p>Всеки подписан договор от централния регистър на АОП (data.egov.bg) е привързан към адреса на седалището на възложителя. Изключваме министерствата, държавните агенции и националните държавни компании — софийското им седалище не казва нищо за това къде е похарчена сумата — и ги обобщаваме отделно в "Национални поръчки".</p>
<p>Покрита е сума от ~€36 млрд. в местни договори (~388 населени места) плюс ~€34,7 млрд. в национални поръчки. <a href="${SITE_URL}/about">Прочети методологията</a>.</p>
<p>Виж и <a href="${SITE_URL}/procurement">общия преглед на обществените поръчки</a>, <a href="${SITE_URL}/procurement/contractors">топ изпълнителите</a> и <a href="${SITE_URL}/procurement/awarders">топ възложителите</a>.</p>`.trim(),
    english: {
      title: "Public Procurement by Settlement | electionsbg.com",
      description:
        "Public-procurement totals broken down by settlement based on the buyer's HQ address — municipalities, schools, hospitals, universities and regional offices. Central ministries and national state companies are aggregated separately.",
      breadcrumbName: "Procurement by settlement",
      bodyHtml: `
<h1>Public procurement by settlement</h1>
<p>Every signed contract from the central АОП register (data.egov.bg) is pinned to the buyer's HQ address. Central ministries, state agencies and nationally-operating state companies are excluded from per-settlement pins — their Sofia HQ tells you nothing about where the money was spent — and roll up into a separate "National procurement" card.</p>
<p>Covers ~€36 B in local-tier contracts (~388 settlements) plus ~€34.7 B in national procurement. <a href="${SITE_URL}/en/about">Read the methodology</a>.</p>
<p>See also the <a href="${SITE_URL}/en/procurement">procurement overview</a>, <a href="${SITE_URL}/en/procurement/contractors">top contractors</a> and <a href="${SITE_URL}/en/procurement/awarders">top awarders</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "procurement/mps",
    title:
      "Депутати и длъжностни лица с обществени поръчки на свързани фирми | electionsbg.com",
    description:
      "Народни представители и държавни/местни служители, чиито декларирани бизнес-интереси съвпадат с фирми, спечелили обществени поръчки — обща сума, брой фирми и договори.",
    breadcrumbName: "Свързани депутати и длъжностни лица",
    ogImage: "/og/procurement-mps.png",
    bodyHtml: `
<h1>Депутати и длъжностни лица с обществени поръчки на свързани фирми</h1>
<p>Народни представители и длъжностни лица (министри, областни управители, кметове, общински съветници…), чиито декларирани пред Сметната палата бизнес-интереси (собственост или управление на фирма) съвпадат с изпълнители на обществени поръчки в периода на съответния мандат.</p>
<p>Данните за поръчките са от АОП (data.egov.bg); бизнес-интересите — от имуществените декларации (register.cacbg.bg) и Търговския регистър.</p>
<p>Виж и <a href="${SITE_URL}/procurement">общия преглед</a> и <a href="${SITE_URL}/connections">бизнес-връзките между депутатите</a>.</p>`.trim(),
    english: {
      title:
        "MPs & Officials with Connected-Company Procurement | electionsbg.com",
      description:
        "Bulgarian MPs and public officials whose declared business interests overlap with companies that won public-procurement contracts — total value, company count, and contract count.",
      breadcrumbName: "Connected MPs and officials",
      bodyHtml: `
<h1>MPs and officials with connected-company procurement</h1>
<p>Sitting Bulgarian MPs and public officials (cabinet, regional governors, mayors, councillors…) whose declared business interests (ownership or directorship) at the Court of Audit overlap with companies that won public-procurement contracts during the parliament's term.</p>
<p>Procurement data: АОП via data.egov.bg. Business interests: property declarations at register.cacbg.bg and the Commerce Registry.</p>
<p>See also the <a href="${SITE_URL}/en/procurement">procurement overview</a> and <a href="${SITE_URL}/en/connections">MP business connections</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "preferences",
    title:
      "Преференциален вот по партии — парламентарни избори | electionsbg.com",
    description:
      "Топ кандидати с преференциален вот в българските парламентарни избори — преподредени листи и разлика спрямо подреждането на партията.",
    breadcrumbName: "Преференции",
    bodyHtml: `
<h1>Преференциален вот по партии</h1>
<p>В България избирателят може да даде преференция за конкретен кандидат от партийната листа. Когато преференциите за един кандидат надхвърлят 7% от гласовете на партията в съответния МИР, той се преподрежда напред в листата — често пред първоначалния номер 1.</p>
<p>Тук са обединените резултати от преференциалния вот за последния парламентарен вот — топ кандидати по партия, разлика между първоначалното и крайното подреждане, и кои народни представители влизат в Народното събрание единствено благодарение на преференцията.</p>`.trim(),
  }),
  staticPage({
    path: "flash-memory",
    title: "Машинно гласуване — обхват и отклонения | electionsbg.com",
    description:
      "Доклад за машинното гласуване в България — секции с/без флашка, добавени и липсващи СУЕМГ устройства, хартиен заместител.",
    breadcrumbName: "Машинно гласуване",
    bodyHtml: `
<h1>Машинно гласуване — обхват и отклонения</h1>
<p>Машинното гласуване в България използва специализирани устройства (СУЕМГ — Специализирано устройство за електронно машинно гласуване). На всеки парламентарен вот се обявява дали машината е била работеща в съответната секция и дали е било разпоредено връщане към хартия.</p>
<p>Този доклад показва обхвата на машинното гласуване по години — общо секции с/без машина, добавени машини в последния момент, липсващи устройства, и секции с разпоредено хартиено гласуване.</p>`.trim(),
  }),
  staticPage({
    path: "recount",
    title: "Повторно преброяване — отклонения по партии | electionsbg.com",
    description:
      "Доклад за повторното преброяване на бюлетините в българските парламентарни избори — секции с разлика между първо и второ броене.",
    breadcrumbName: "Повторно преброяване",
    bodyHtml: `
<h1>Повторно преброяване — отклонения по партии</h1>
<p>След първоначалното броене на гласовете в СИК, всички протоколи минават през второ броене в РИК. Когато двете броения дават различен резултат, се отчита отклонение.</p>
<p>Тук са секциите с най-голямо отклонение между двете броения — по обща сума, по партия и по тип разлика (партия → партия, партия → недействителна).</p>`.trim(),
  }),
  staticPage({
    path: "subsidies",
    title:
      "Земеделски субсидии в България — кой получава парите на ОСП | electionsbg.com",
    description: `Кой получава земеделските субсидии на ДФ „Земеделие" — по схема, по област, по година и по получател. Изплатени суми за финансови години ${AGRI_EARLIEST_YEAR}–${AGRI_LATEST_YEAR}, концентрация на плащанията и класация на най-големите получатели.`,
    breadcrumbName: "Земеделски субсидии",
    ogImage: "/og/subsidies.png",
    bodyHtml: `
<h1>Земеделски субсидии — кой получава парите</h1>
<p>Държавен фонд „Земеделие" е разплащателната агенция на Общата селскостопанска политика (ОСП) на ЕС. Тази страница показва какво прави фондът с парите: колко изплаща всяка финансова година, по кои схеми, в кои области и на кои получатели — юридически лица и физически лица поотделно.</p>
<h2>Какво ще намерите тук</h2>
<ul>
<li><strong>Накратко</strong> — изплатена сума, брой получатели (фирми и физически лица), делът на 100-те най-големи фирми и най-голямата схема за избраната финансова година.</li>
<li><strong>Концентрация</strong> — как се разпределя сумата между топ 10, топ 11–100, топ 101–1000 и всички останали фирми. Малка група получатели взима непропорционален дял от парите за юридически лица.</li>
<li><strong>По схема</strong> — от основното подпомагане на доходите до инвестиционните мерки, еко схемите и извънредната помощ, с директна връзка към получателите по всяка схема.</li>
<li><strong>По област</strong> — карта на изплатеното по области.</li>
<li><strong>По година</strong> — изплатено по финансова година (${AGRI_YEAR_RANGES}).</li>
<li><strong>Най-големи получатели</strong> — класация на юридическите лица, всяко със своя <a href="${SITE_URL}/procurement">профил</a>, така че субсидиите се четат заедно с обществените поръчки и европейските средства на същата фирма.</li>
</ul>
<p>Собствените обществени поръчки на фонда са на <a href="${SITE_URL}/awarder/121100421">страницата на ДФ „Земеделие"</a>. Виж и <a href="${SITE_URL}/funds">европейските средства</a> и <a href="${SITE_URL}/procurement">обществените поръчки</a>.</p>
<p>Източници: <a href="https://data.egov.bg/" rel="nofollow noopener">data.egov.bg</a> (ДФ „Земеделие" — отворени данни за плащанията) и публичният регистър на <a href="https://seu.dfz.bg/" rel="nofollow noopener">Системата за електронни услуги на ДФЗ</a> за текущите години.</p>`.trim(),
    english: {
      title:
        "Farm Subsidies in Bulgaria — Who Receives the CAP Money | electionsbg.com",
      description: `Who receives State Fund Agriculture's farm subsidies — by scheme, by province, by year and by recipient. Payments for financial years ${AGRI_EARLIEST_YEAR}–${AGRI_LATEST_YEAR}, payment concentration and a ranking of the largest recipients.`,
      breadcrumbName: "Farm subsidies",
      bodyHtml: `
<h1>Farm subsidies — who receives the money</h1>
<p>State Fund Agriculture is Bulgaria's paying agency for the EU Common Agricultural Policy (CAP). This page shows what the fund does with the money: how much it pays out in each financial year, under which schemes, in which provinces, and to which recipients — legal entities and individuals counted separately.</p>
<h2>What you'll find</h2>
<ul>
<li><strong>At a glance</strong> — total paid, number of recipients (companies and individuals), the share captured by the 100 largest firms, and the largest scheme for the selected financial year.</li>
<li><strong>Concentration</strong> — how the money splits between the top 10, the top 11–100, the top 101–1000 and every other firm. A small group of recipients takes a disproportionate share of the legal-entity money.</li>
<li><strong>By scheme</strong> — from basic income support to investment measures, eco-schemes and emergency aid, each linking through to the recipients under it.</li>
<li><strong>By province</strong> — a map of payments by oblast.</li>
<li><strong>By year</strong> — amounts paid per financial year (${AGRI_YEAR_RANGES}).</li>
<li><strong>Largest recipients</strong> — a ranking of legal entities, each with its own <a href="${SITE_URL}/en/procurement">company profile</a>, so subsidies can be read alongside the same firm's public contracts and EU funds.</li>
</ul>
<p>The fund's own public procurement is on the <a href="${SITE_URL}/en/awarder/121100421">State Fund Agriculture page</a>. See also <a href="${SITE_URL}/en/funds">EU funds</a> and <a href="${SITE_URL}/en/procurement">public procurement</a>.</p>
<p>Sources: <a href="https://data.egov.bg/" rel="nofollow noopener">data.egov.bg</a> (State Fund Agriculture payment open data) and the public register of the fund's <a href="https://seu.dfz.bg/" rel="nofollow noopener">electronic-services system</a> for the current years.</p>`.trim(),
    },
  }),
  staticPage({
    path: "funds",
    title:
      "Европейски средства за България — бенефициенти, договори, политически връзки | electionsbg.com",
    description:
      "Над 80 000 договора за €43 млрд. европейско финансиране от ИСУН 2020 — карта по общини, топ бенефициенти, програми и възложители, потоци пари към свързани с депутати фирми и редфлагове за почтеност.",
    breadcrumbName: "Европейски средства",
    ogImage: "/og/funds.png",
    bodyHtml: `
<h1>Европейски средства за България</h1>
<p>Целият корпус от договори за европейско финансиране, публикуван от ИСУН 2020 (Информационна система за управление и наблюдение на средствата от ЕС) — над 80 000 договора за около €43 млрд. договорено и €16 млрд. изплатено. Данните покриват оперативните програми и ПВУ, с карта по общини, топ бенефициенти, програми и възложители.</p>
<h2>Какво ще намерите тук</h2>
<ul>
<li><strong>Карта по общини</strong> — choropleth на договорените средства, нормализирана по население.</li>
<li><strong>Топ бенефициенти</strong> — фирми и държавни структури с най-голям обем европейско финансиране.</li>
<li><strong>Програми</strong> — разбивка по оперативна програма и фонд (ЕФРР, ЕСФ, ЕЗФРСР и др.), с топ договори и бенефициенти.</li>
<li><a href="${SITE_URL}/funds/political">Политическа икономия</a> — фирми с европейско финансиране и свързан депутат/официално лице.</li>
<li><a href="${SITE_URL}/funds/integrity">Почтеност</a> — концентрация (HHI), серийни победители, дебарирани изпълнители.</li>
<li><a href="${SITE_URL}/funds/rrf">ПВУ (RRF)</a> — Планът за възстановяване и устойчивост: реформи и инвестиции по стълбове.</li>
<li><strong>Тематичен фокус</strong> — редакционни лещи (къщи за гости, пътища, земеделие, училища, общинска инфраструктура).</li>
</ul>
<p>Източник: <a href="https://2020.eufunds.bg/bg/0/0/Beneficiary" rel="nofollow noopener">ИСУН 2020 — публичен модул, Бенефициенти</a>. Свързаните политически фигури идват от <a href="${SITE_URL}/connections">граф на бизнес-връзките на депутатите</a> (декларации в Сметна палата + Търговския регистър).</p>`.trim(),
    english: {
      title:
        "EU Funds for Bulgaria — Beneficiaries, Contracts, Political Links | electionsbg.com",
      description:
        "Over 80,000 contracts for €43B of EU funding from ИСУН 2020 — choropleth by municipality, top beneficiaries, programmes and awarders, money flows to MP-connected companies, and integrity red flags.",
      breadcrumbName: "EU funds",
      bodyHtml: `
<h1>EU funds for Bulgaria</h1>
<p>The full corpus of EU-funding contracts published by ИСУН 2020 (the Bulgarian Management Information System for EU Funds) — over 80,000 contracts for ~€43B contracted and ~€16B paid. Coverage spans operational programmes and the Recovery and Resilience Facility, with a choropleth by municipality, top beneficiaries, programmes and awarders.</p>
<h2>What you'll find</h2>
<ul>
<li><strong>Map by municipality</strong> — choropleth of contracted funds, normalised by population.</li>
<li><strong>Top beneficiaries</strong> — companies and state entities with the largest EU-funding receipts.</li>
<li><strong>Programmes</strong> — breakdown by operational programme and fund (ERDF, ESF, EAFRD, etc.) with top contracts and beneficiaries.</li>
<li><a href="${SITE_URL}/en/funds/political">Political economy</a> — companies that received EU funds and have a connected MP or senior official.</li>
<li><a href="${SITE_URL}/en/funds/integrity">Integrity</a> — concentration (HHI), serial winners, debarred contractors.</li>
<li><a href="${SITE_URL}/en/funds/rrf">RRF</a> — Recovery and Resilience Plan: reforms and investments by pillar.</li>
<li><strong>Editorial focus</strong> — themes such as guest houses, roads, agriculture, schools, municipal infrastructure.</li>
</ul>
<p>Source: <a href="https://2020.eufunds.bg/bg/0/0/Beneficiary" rel="nofollow noopener">ИСУН 2020 — public module, Beneficiaries</a>. Connected politicians come from the <a href="${SITE_URL}/en/connections">MP business-connections graph</a> (Court of Audit declarations + Commerce Registry).</p>`.trim(),
    },
  }),
  staticPage({
    path: "funds/political",
    title:
      "Политическа икономия на европейските средства — фирми с депутатска връзка | electionsbg.com",
    description:
      "Бенефициенти на ЕС-средства, чиито собственици или управители са депутати, министри или висши официални лица — обща сума, брой фирми и съответните политически фигури.",
    breadcrumbName: "Политическа икономия",
    ogImage: "/og/funds-political.png",
    bodyHtml: `
<h1>Политическа икономия на европейските средства</h1>
<p>Фирми-бенефициенти на ИСУН 2020, чиито собственици или управители съвпадат с действащ депутат, кабинетен министър, заместник-министър или висш официален държавен служител, декларирал бизнес-интерес в Сметната палата.</p>
<h2>Какво се вижда тук</h2>
<ul>
<li>Топ свързани фирми по обем европейско финансиране (договорено / изплатено).</li>
<li>Съответната политическа фигура с роля (собственик, управител, член на УС).</li>
<li>Връзка към <a href="${SITE_URL}/connections">графа на бизнес-връзките</a> и към профила на депутата.</li>
</ul>
<p>Източник на бизнес-връзките: <a href="https://register.cacbg.bg" rel="nofollow noopener">register.cacbg.bg</a> (имуществени декларации) + Търговски регистър. Източник на договорите: ИСУН 2020.</p>`.trim(),
    english: {
      title:
        "Political Economy of EU Funds — MP-Connected Beneficiaries | electionsbg.com",
      description:
        "EU-funds beneficiaries whose owners or directors are sitting Bulgarian MPs, ministers or senior officials — totals, company counts, and the corresponding political figures.",
      breadcrumbName: "Political economy",
      bodyHtml: `
<h1>Political economy of EU funds</h1>
<p>Beneficiary companies in the ИСУН 2020 corpus whose owners or directors are a sitting Bulgarian MP, cabinet minister, deputy minister, or senior official with a declared business interest at the Court of Audit.</p>
<h2>What you'll find</h2>
<ul>
<li>Top connected companies by EU-funding volume (contracted and paid).</li>
<li>The matching political figure with their role (owner, director, board member).</li>
<li>Cross-links into the <a href="${SITE_URL}/en/connections">business-connections graph</a> and the MP's candidate profile.</li>
</ul>
<p>Business-connection sources: <a href="https://register.cacbg.bg" rel="nofollow noopener">register.cacbg.bg</a> (property declarations) and the Commerce Registry. Contract source: ИСУН 2020.</p>`.trim(),
    },
  }),
  staticPage({
    path: "funds/integrity",
    title:
      "Почтеност на европейските средства — HHI, серийни победители, дебарирани | electionsbg.com",
    description:
      "Редфлагове в разпределението на ЕС-средствата: концентрация по програма (HHI), бенефициенти с подозрително висок дял на договорите, и фирми, фигуриращи в регистъра на дебарираните по АОП.",
    breadcrumbName: "Почтеност",
    ogImage: "/og/funds-integrity.png",
    bodyHtml: `
<h1>Почтеност на европейските средства</h1>
<p>Структурни редфлагове в разпределението на европейските средства, изчислени за всяка оперативна програма и общо за корпуса.</p>
<h2>Сигнали</h2>
<ul>
<li><strong>Концентрация (HHI)</strong> — Herfindahl–Hirschman индекс на разпределението на договори по бенефициент.</li>
<li><strong>Серийни победители</strong> — фирми с подозрително висок дял на договорите в дадена програма.</li>
<li><strong>Дебарирани изпълнители</strong> — съответствие с регистъра на дебарираните доставчици по Закона за обществените поръчки (АОП).</li>
</ul>
<p>Източници: ИСУН 2020 (договори), АОП — регистър на дебарираните по чл. 55 от ЗОП. Резултатите не са обвинение, а индикатори за по-задълбочена проверка.</p>`.trim(),
    english: {
      title:
        "Integrity of EU Funds — HHI, Serial Winners, Debarred Contractors | electionsbg.com",
      description:
        "Structural red flags in EU-funds allocation: per-programme concentration (HHI), beneficiaries with a suspiciously high contract share, and matches against the АОП debarred-supplier register.",
      breadcrumbName: "Integrity",
      bodyHtml: `
<h1>Integrity of EU funds</h1>
<p>Structural red flags in EU-funds allocation, computed per operational programme and across the full corpus.</p>
<h2>Signals</h2>
<ul>
<li><strong>Concentration (HHI)</strong> — Herfindahl–Hirschman index of the distribution of contracts across beneficiaries.</li>
<li><strong>Serial winners</strong> — companies with a suspiciously high share of contracts in a single programme.</li>
<li><strong>Debarred contractors</strong> — matches against the АОП register of suppliers debarred under art. 55 of the Public Procurement Act.</li>
</ul>
<p>Sources: ИСУН 2020 (contracts) and the АОП debarred-supplier register. The output is not an accusation — it flags cases that warrant a closer look.</p>`.trim(),
    },
  }),
  staticPage({
    path: "funds/rrf",
    title:
      "ПВУ — План за възстановяване и устойчивост на България | electionsbg.com",
    description:
      "Дашборд на Плана за възстановяване и устойчивост (ПВУ / RRF) — стълбове, реформи и инвестиции, договорени и изплатени средства, контекст спрямо ЕС.",
    breadcrumbName: "ПВУ (RRF)",
    ogImage: "/og/funds-rrf.png",
    bodyHtml: `
<h1>ПВУ — План за възстановяване и устойчивост</h1>
<p>Дашборд на българския Национален план за възстановяване и устойчивост (ПВУ / RRF). Прегледи по стълбове, реформи и инвестиции, индикатори за договорени и изплатени средства, и контекст спрямо плановете на останалите държави-членки на ЕС.</p>
<h2>Какво ще намерите тук</h2>
<ul>
<li>Разбивка по четирите стълба: иновативна, зелена, свързана и справедлива България.</li>
<li>Топ договори по обем и съответната реформа/инвестиция.</li>
<li>Топ бенефициенти и обвързаните общини.</li>
<li>Контекст спрямо ЕС: алокация на държава, темп на изплащане.</li>
</ul>
<p>Източници: ИСУН 2020 (договори по фонд "ПВУ"), Европейска комисия — RRF Scoreboard.</p>`.trim(),
    english: {
      title: "Recovery and Resilience Plan — Bulgaria's RRF | electionsbg.com",
      description:
        "Dashboard for Bulgaria's National Recovery and Resilience Plan (RRF) — pillars, reforms and investments, contracted and paid amounts, with EU peer context.",
      breadcrumbName: "RRF",
      bodyHtml: `
<h1>Recovery and Resilience Plan — Bulgaria</h1>
<p>Dashboard of Bulgaria's National Recovery and Resilience Plan (RRF). Breakdown by pillar, reforms and investments, indicators for contracted and paid amounts, and peer context across the EU member states.</p>
<h2>What you'll find</h2>
<ul>
<li>Breakdown across the four pillars: innovative, green, connected and fair Bulgaria.</li>
<li>Top contracts by volume and the matching reform / investment.</li>
<li>Top beneficiaries and the municipalities they reach.</li>
<li>EU context — per-country allocation and disbursement pace.</li>
</ul>
<p>Sources: ИСУН 2020 (contracts under the RRF fund) and the European Commission's RRF Scoreboard.</p>`.trim(),
    },
  }),
  staticPage({
    path: "parliament",
    title:
      "Парламент — анализ на гласуванията в Народното събрание | electionsbg.com",
    description:
      "Анализ на поименните гласувания в българското Народно събрание — архив на заседанията, партийна дисциплина, гласови близнаци и UMAP визуализация на гласовото пространство.",
    breadcrumbName: "Парламент",
    ogImage: "/og/parliament.png",
    bodyHtml: `
<h1>Парламент — анализ на гласуванията</h1>
<p>Аналитични страници върху поименните гласувания в българското Народно събрание. Данните се извличат от стенограмите на parliament.bg.</p>
<ul>
<li><a href="${SITE_URL}/votes">Архив на поименните гласувания</a> по заседания, с разбивка по точка и парламентарна група.</li>
<li><a href="${SITE_URL}/parliament/cohesion">Партийна дисциплина</a> — колко обединени гласуват членовете на всяка група, с динамика по време.</li>
<li>Гласови близнаци — кои депутати гласуват най-сходно с други, с акцент на близнаци от различни групи. Достъпни от страницата на всеки депутат.</li>
<li><a href="${SITE_URL}/parliament/embedding">Гласово пространство</a> — UMAP визуализация на цялото гласово поведение.</li>
</ul>`.trim(),
    english: {
      title:
        "Parliament — Bulgarian National Assembly Voting Analytics | electionsbg.com",
      description:
        "Roll-call voting analytics for the Bulgarian National Assembly — session archive, group cohesion, voting twins, and a UMAP map of MP voting behaviour.",
      breadcrumbName: "Parliament",
      bodyHtml: `
<h1>Parliament — voting analytics</h1>
<p>Analytical views over roll-call voting in the Bulgarian National Assembly. Data is sourced from parliament.bg stenograms.</p>
<ul>
<li><a href="${SITE_URL}/en/votes">Roll-call vote archive</a>, broken down per item and per parliamentary group.</li>
<li><a href="${SITE_URL}/en/parliament/cohesion">Group cohesion</a> — how unified each parliamentary group votes, with a per-session trend.</li>
<li>Voting twins — which MPs vote most similarly, surfacing twins from different groups. Available from each MP's candidate page.</li>
<li><a href="${SITE_URL}/en/parliament/embedding">Voting space</a> — UMAP projection of every MP's voting behaviour.</li>
</ul>`.trim(),
    },
  }),
  staticPage({
    path: "parliament/embedding",
    title:
      "Гласовото пространство на Народното събрание — UMAP визуализация | electionsbg.com",
    description:
      "2D проекция (UMAP) на гласуванията на всеки действащ народен представител. Депутати, които гласуват сходно, се появяват близо един до друг — клъстерите разкриват неформални блокове.",
    breadcrumbName: "Гласово пространство",
    ogImage: "/og/parliament-embedding.png",
    bodyHtml: `
<h1>Гласовото пространство на Народното събрание</h1>
<p>Всяка точка е един депутат. Разстоянието приближено отразява колко различно гласуват двама депутати — съседите гласуват по същия начин в по-голяма част от случаите.</p>
<p>Подредбата е UMAP проекция на векторите от поименните гласувания (за / против / въздържал се) на всеки депутат. Цветът показва парламентарната група. Клъстерите разкриват неформалните блокове.</p>
<p>Виж и <a href="${SITE_URL}/parliament/cohesion">партийната дисциплина</a> и <a href="${SITE_URL}/votes">архива на поименните гласувания</a>.</p>`.trim(),
    english: {
      title: "MP Voting Space — UMAP Embedding | electionsbg.com",
      description:
        "2D UMAP projection of every sitting Bulgarian MP's roll-call vote vector. MPs who vote similarly appear close together; clusters reveal informal blocs.",
      breadcrumbName: "Voting space",
      bodyHtml: `
<h1>MP voting space</h1>
<p>Each dot is one MP. Distance approximates how differently two MPs vote — neighbours vote the same way most of the time.</p>
<p>Layout is a UMAP projection of the full vote-vector space, coloured by parliamentary group. Clusters reveal informal blocs.</p>
<p>See also <a href="${SITE_URL}/en/parliament/cohesion">parliamentary group cohesion</a> and the <a href="${SITE_URL}/en/votes">roll-call archive</a>.</p>`.trim(),
    },
  }),
  staticPage({
    path: "parliament/cohesion",
    title:
      "Партийна дисциплина в Народното събрание — обединеност при гласуване | electionsbg.com",
    description:
      "Колко обединени гласуват парламентарните групи в българското Народно събрание — средна и медианна обединеност по точки, размер на групата и брой обхванати гласувания.",
    breadcrumbName: "Партийна дисциплина",
    ogImage: "/og/parliament-cohesion.png",
    bodyHtml: `
<h1>Партийна дисциплина в Народното събрание</h1>
<p>За всяка точка, по която Народното събрание гласува, измерваме каква част от членовете на дадена парламентарна група са гласували еднакво. След това усредняваме по всички точки в текущия мандат.</p>
<p>1,00 означава, че всеки път цялата група е гласувала по един и същ начин; 0,50 означава равноделно разцепление. Отсъствията не се отчитат.</p>
<p>Виж и <a href="${SITE_URL}/votes">архива на поименните гласувания</a> и <a href="${SITE_URL}/connections">бизнес-връзките между депутатите</a>.</p>`.trim(),
    english: {
      title:
        "Parliamentary Group Cohesion — Bulgarian National Assembly | electionsbg.com",
      description:
        "How unified the parliamentary groups vote in Bulgaria's National Assembly — mean and median cohesion per item, group size, and items covered.",
      breadcrumbName: "Group cohesion",
      bodyHtml: `
<h1>Parliamentary group cohesion</h1>
<p>For each item on which the National Assembly votes, we measure the share of a group's members who voted the same way. We then average across every item in the current parliament.</p>
<p>1.00 means the entire group voted identically every time; 0.50 is an even split. Absences are excluded.</p>
<p>See also the <a href="${SITE_URL}/en/votes">archive of roll-call votes</a> and the <a href="${SITE_URL}/en/connections">business-connections graph</a>.</p>`.trim(),
    },
  }),
];

const sofiaSubTabs: Array<{
  slug: string;
  bgLabel: string;
  enLabel: string;
  bgDesc: string;
  enDesc: string;
}> = [
  {
    slug: "parties",
    bgLabel: "по партии",
    enLabel: "by party",
    bgDesc: "Резултати по партии в трите столични района (МИР 23, 24, 25).",
    enDesc:
      "Results by party across Sofia's three multi-member districts (MIR 23, 24, 25).",
  },
  {
    slug: "preferences",
    bgLabel: "преференции",
    enLabel: "preference votes",
    bgDesc:
      "Преференциален вот по кандидати в София — преподредени листи и водещи имена.",
    enDesc:
      "Preference votes for candidates in Sofia — reordered party lists and top names.",
  },
  {
    slug: "flash-memory",
    bgLabel: "машинно гласуване",
    enLabel: "machine voting",
    bgDesc:
      "Обхват на машинното гласуване в София — секции с/без флашка и с хартиен заместител.",
    enDesc:
      "Machine-voting coverage in Sofia — sections with/without flash-memory devices and paper fallback.",
  },
  {
    slug: "recount",
    bgLabel: "повторно преброяване",
    enLabel: "recount",
    bgDesc:
      "Отклонения между първо и второ броене на бюлетините в столичните секции.",
    enDesc:
      "Discrepancies between first and second tally counts in Sofia's polling sections.",
  },
];

for (const tab of sofiaSubTabs) {
  prerenderRoutes.push(
    staticPage({
      path: `sofia/${tab.slug}`,
      title: `София — ${tab.bgLabel} | Парламентарни избори | electionsbg.com`,
      description: tab.bgDesc,
      breadcrumbName: tab.bgLabel,
      ogImage: "/og/sofia.png",
      bodyHtml: SOFIA_BODY_BG,
      english: {
        title: `Sofia — ${tab.enLabel} | Bulgarian Parliamentary Elections | electionsbg.com`,
        description: tab.enDesc,
        breadcrumbName: tab.enLabel,
        bodyHtml: SOFIA_BODY_EN,
      },
    }),
  );
}

// Per-cabinet detail pages /governments/<slug>. Read the cabinets file at
// build time so adding a future cabinet to data/governments.json
// automatically generates a new prerendered page (no script edit needed).
// Crawlers without JS see PM name, tenure, coalition, and end reason as
// indexable content; the React SPA still owns the live rendering.
type CabinetEntry = {
  id: string;
  pmBg: string;
  pmEn: string;
  startDate: string;
  endDate: string | null;
  type: "regular" | "caretaker";
  parties: string[];
  partiesEn?: string[];
  endReasonBg?: string;
  endReasonEn?: string;
};

// Roman numeral disambiguation, mirrors src/data/governments/cabinetLabel.ts.
// Keeps SEO titles + body copy consistent with what users see in-app
// ("Кабинет Бойко Методиев Борисов III" instead of just "...Борисов").
const PRERENDER_ROMAN: Record<number, string> = {
  1: "I",
  2: "II",
  3: "III",
  4: "IV",
  5: "V",
};
const cabinetNumeral = (c: CabinetEntry, siblings: CabinetEntry[]): string => {
  if (siblings.length <= 1) return "";
  const idx = siblings.findIndex((s) => s.id === c.id);
  if (idx < 0) return "";
  return PRERENDER_ROMAN[idx + 1] ?? String(idx + 1);
};

const GOVERNMENTS_FILE = path.join(PROJECT_ROOT, "data/governments.json");
if (fs.existsSync(GOVERNMENTS_FILE)) {
  try {
    const payload = JSON.parse(fs.readFileSync(GOVERNMENTS_FILE, "utf8")) as {
      governments: CabinetEntry[];
    };
    const fmtDateBg = (iso: string | null): string => {
      if (!iso) return "—";
      const d = new Date(iso);
      return d.toLocaleDateString("bg-BG", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    };
    const fmtDateEn = (iso: string | null): string => {
      if (!iso) return "—";
      const d = new Date(iso);
      return d.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    };
    // Pre-group cabinets by PM surname so we can compute the Roman numeral
    // for each. Sort by start date so the chronological order maps to the
    // numeral correctly (Borisov-1 = I, Borisov-2 = II, etc.).
    const lastBgToken = (s: string): string => s.split(" ").pop() ?? "";
    const sortedAll = [...payload.governments].sort((a, b) =>
      a.startDate.localeCompare(b.startDate),
    );
    const siblingsByPm = new Map<string, CabinetEntry[]>();
    for (const c of sortedAll) {
      const key = lastBgToken(c.pmBg);
      const arr = siblingsByPm.get(key) ?? [];
      arr.push(c);
      siblingsByPm.set(key, arr);
    }
    for (const c of payload.governments) {
      const typeBg = c.type === "caretaker" ? "служебен" : "редовен";
      const typeEn = c.type === "caretaker" ? "caretaker" : "regular";
      const partiesBg = (c.parties ?? []).join(", ") || "—";
      const partiesEn = (c.partiesEn ?? c.parties ?? []).join(", ") || "—";
      const tenureBg = `${fmtDateBg(c.startDate)} – ${fmtDateBg(c.endDate)}`;
      const tenureEn = `${fmtDateEn(c.startDate)} – ${fmtDateEn(c.endDate)}`;
      const endBg = c.endReasonBg ?? "";
      const endEn = c.endReasonEn ?? "";
      const numeral = cabinetNumeral(
        c,
        siblingsByPm.get(lastBgToken(c.pmBg)) ?? [],
      );
      const suffix = numeral ? ` ${numeral}` : "";
      const pmBgLabel = `${c.pmBg}${suffix}`;
      const pmEnLabel = `${c.pmEn}${suffix}`;
      prerenderRoutes.push(
        staticPage({
          path: `governments/${c.id}`,
          title: `Кабинет ${pmBgLabel} — макро профил | electionsbg.com`,
          description: `Профил на мандата на ${pmBgLabel} (${typeBg}, ${tenureBg}): основни макроикономически и управленски показатели, средни стойности за периода и графика.`,
          breadcrumbName: pmBgLabel,
          // Per-cabinet OG card emitted by scripts/og/generate.ts from the
          // same data/governments.json entry — social shares of
          // /governments/<id> get a cabinet-specific card instead of
          // falling back to the generic site default.
          ogImage: `/og/cabinet/${c.id}.png`,
          bodyHtml: `
<h1>Кабинет ${pmBgLabel}</h1>
<p><strong>${typeBg}</strong> · ${tenureBg}${partiesBg !== "—" ? ` · ${partiesBg}` : ""}${endBg ? ` · ${endBg}` : ""}</p>
<p>Профил на мандата с показатели в началото и края, средни стойности за периода и графика на БВП, инфлация и безработица в рамките на мандата ±1 година.</p>
<p>Виж и <a href="${SITE_URL}/governments">всички кабинети</a> или <a href="${SITE_URL}/indicators/compare?cabinet=${encodeURIComponent(c.id)}">сравнението с ЕС</a> към края на този мандат.</p>`.trim(),
          english: {
            title: `${pmEnLabel} cabinet — macro profile | electionsbg.com`,
            description: `Profile of ${pmEnLabel}'s cabinet (${typeEn}, ${tenureEn}): headline macroeconomic and governance indicators, tenure averages and macro chart.`,
            breadcrumbName: pmEnLabel,
            bodyHtml: `
<h1>${pmEnLabel} cabinet</h1>
<p><strong>${typeEn}</strong> · ${tenureEn}${partiesEn !== "—" ? ` · ${partiesEn}` : ""}${endEn ? ` · ${endEn}` : ""}</p>
<p>Term profile with start vs. end indicator values, time-weighted averages across the tenure, and a macro chart for GDP growth, inflation and unemployment zoomed to the term ±1 year.</p>
<p>See also <a href="${SITE_URL}/en/governments">all cabinets</a> or <a href="${SITE_URL}/en/indicators/compare?cabinet=${encodeURIComponent(c.id)}">peer comparison</a> at the end of this term.</p>`.trim(),
          },
        }),
      );
    }
  } catch (err) {
    console.warn("prerender: failed to enumerate cabinet detail pages", err);
  }
}

// Per-theme focus pages /funds/focus/<slug>. One staticPage per theme listed
// in data/funds/themes.json — same source the in-app /funds focus tile uses.
// Themes with zero matched contracts are skipped so we don't ship dead pages
// to the index.
type FundsThemeEntry = {
  slug: string;
  labelBg: string;
  labelEn: string;
  summaryBg?: string;
  summaryEn?: string;
  contractCount?: number;
  beneficiaryCount?: number;
  totalEur?: number;
};
const FUNDS_THEMES_FILE = path.join(PROJECT_ROOT, "data/funds/themes.json");
if (fs.existsSync(FUNDS_THEMES_FILE)) {
  try {
    const payload = JSON.parse(fs.readFileSync(FUNDS_THEMES_FILE, "utf8")) as {
      themes?: FundsThemeEntry[];
    };
    const themes = (payload.themes ?? []).filter(
      (th) => th.slug && (th.contractCount ?? 0) > 0,
    );
    for (const th of themes) {
      const labelBg = th.labelBg || th.slug;
      const labelEn = th.labelEn || th.slug;
      prerenderRoutes.push(
        staticPage({
          path: `funds/focus/${th.slug}`,
          title: `${labelBg} — европейско финансиране | electionsbg.com`,
          description:
            (th.summaryBg && th.summaryBg.slice(0, 240)) ||
            `Тематичен фокус върху европейските средства: ${labelBg}. Топ бенефициенти, програми, география и журналистически източници.`,
          breadcrumbName: labelBg,
          ogImage: "/og/funds-focus.png",
          bodyHtml: `
<h1>${labelBg} — европейско финансиране</h1>
${th.summaryBg ? `<p>${th.summaryBg}</p>` : ""}
<p>Тематична извадка от корпуса на ИСУН 2020 за <strong>${labelBg.toLowerCase()}</strong>. Страницата показва топ бенефициенти и договори, разбивка по програма и общини, плюс препратки към разследваща журналистика по темата.</p>
<p>Виж и <a href="${SITE_URL}/funds">общия преглед на европейските средства</a> или <a href="${SITE_URL}/funds/political">политическата икономия</a>.</p>`.trim(),
          english: {
            title: `${labelEn} — EU funding focus | electionsbg.com`,
            description:
              (th.summaryEn && th.summaryEn.slice(0, 240)) ||
              `Editorial focus on EU funds: ${labelEn}. Top beneficiaries, programmes, geography, and investigative-journalism sources.`,
            breadcrumbName: labelEn,
            bodyHtml: `
<h1>${labelEn} — EU funding focus</h1>
${th.summaryEn ? `<p>${th.summaryEn}</p>` : ""}
<p>A thematic slice of the ИСУН 2020 corpus filtered to <strong>${labelEn.toLowerCase()}</strong>. The page shows top beneficiaries and contracts, programme and municipality breakdowns, plus pointers to investigative-journalism sources on the topic.</p>
<p>See also the <a href="${SITE_URL}/en/funds">EU-funds overview</a> or the <a href="${SITE_URL}/en/funds/political">political-economy view</a>.</p>`.trim(),
          },
        }),
      );
    }
  } catch (err) {
    console.warn("prerender: failed to enumerate funds theme pages", err);
  }
}

// Per-programme detail pages /funds/programme/<code>. One staticPage per
// operational-programme summary shard. Crawlers without JS see the
// programme name, fund, contract count and €-volumes as indexable content
// instead of an empty SPA shell.
type FundsProgrammeSummary = {
  programCode: string;
  programName?: string;
  programNameEn?: string;
  fundLabel?: string;
  rollup?: {
    contractCount?: number;
    beneficiaryCount?: number;
    totalEur?: number;
    paidEur?: number;
  };
};
const FUNDS_BY_PROGRAM_DIR = path.join(
  PROJECT_ROOT,
  "data/funds/projects/by-program",
);
if (fs.existsSync(FUNDS_BY_PROGRAM_DIR)) {
  const eurFmt = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
  const numFmtBg = new Intl.NumberFormat("bg-BG");
  const numFmtEn = new Intl.NumberFormat("en-US");
  const summaryFiles = fs
    .readdirSync(FUNDS_BY_PROGRAM_DIR)
    .filter((f) => f.endsWith("-summary.json"));
  for (const fileName of summaryFiles) {
    const full = path.join(FUNDS_BY_PROGRAM_DIR, fileName);
    let summary: FundsProgrammeSummary | null = null;
    try {
      summary = JSON.parse(fs.readFileSync(full, "utf8"));
    } catch {
      continue;
    }
    if (!summary?.programCode) continue;
    const code = summary.programCode;
    const nameBg = summary.programName || code;
    const nameEn = summary.programNameEn || nameBg;
    const fundLabel = summary.fundLabel || "";
    const contracts = summary.rollup?.contractCount ?? 0;
    const beneficiaries = summary.rollup?.beneficiaryCount ?? 0;
    const totalEur = summary.rollup?.totalEur ?? 0;
    const paidEur = summary.rollup?.paidEur ?? 0;
    const stats =
      contracts > 0
        ? `${numFmtBg.format(contracts)} договора · ${numFmtBg.format(beneficiaries)} бенефициенти · ${eurFmt.format(totalEur)} договорени · ${eurFmt.format(paidEur)} изплатени`
        : "";
    const statsEn =
      contracts > 0
        ? `${numFmtEn.format(contracts)} contracts · ${numFmtEn.format(beneficiaries)} beneficiaries · ${eurFmt.format(totalEur)} contracted · ${eurFmt.format(paidEur)} paid`
        : "";
    prerenderRoutes.push(
      staticPage({
        path: `funds/programme/${code}`,
        title: `${nameBg} (${code}) — европейско финансиране | electionsbg.com`,
        description:
          `${nameBg} — оперативна програма от ИСУН 2020${fundLabel ? ` (${fundLabel})` : ""}. ${stats}`.trim(),
        breadcrumbName: nameBg,
        ogImage: "/og/funds.png",
        bodyHtml: `
<h1>${nameBg}</h1>
<p><strong>${code}</strong>${fundLabel ? ` · ${fundLabel}` : ""}</p>
${stats ? `<p>${stats}.</p>` : ""}
<p>Топ договори, бенефициенти и общини за оперативна програма ${nameBg}, извлечени от корпуса на ИСУН 2020.</p>
<p>Виж и <a href="${SITE_URL}/funds">общия преглед на ЕС-средствата</a>, <a href="${SITE_URL}/funds/political">политическата икономия</a> или <a href="${SITE_URL}/funds/integrity">сигналите за почтеност</a>.</p>`.trim(),
        english: {
          title: `${nameEn} (${code}) — EU funding | electionsbg.com`,
          description:
            `${nameEn} — operational programme from ИСУН 2020${fundLabel ? ` (${fundLabel})` : ""}. ${statsEn}`.trim(),
          breadcrumbName: nameEn,
          bodyHtml: `
<h1>${nameEn}</h1>
<p><strong>${code}</strong>${fundLabel ? ` · ${fundLabel}` : ""}</p>
${statsEn ? `<p>${statsEn}.</p>` : ""}
<p>Top contracts, beneficiaries and municipalities for operational programme ${nameEn}, extracted from the ИСУН 2020 corpus.</p>
<p>See also the <a href="${SITE_URL}/en/funds">EU-funds overview</a>, <a href="${SITE_URL}/en/funds/political">political-economy view</a>, or <a href="${SITE_URL}/en/funds/integrity">integrity signals</a>.</p>`.trim(),
        },
      }),
    );
  }
}
