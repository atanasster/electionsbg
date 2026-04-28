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
  // English variant for /en/{path}. When present we also emit the EN file and
  // wire bidirectional hreflang alternates between the two URLs.
  english?: {
    title: string;
    description: string;
    bodyHtml?: string;
    jsonLd?: object[];
  };
};

export const SITE_URL = "https://electionsbg.com";
export const DEFAULT_OG_IMAGE = `${SITE_URL}/images/og_image.png`;

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildBreadcrumbLd,
  buildDatasetLd,
  buildOrganizationLd,
  buildWebPageLd,
  buildWebSiteLd,
} from "./jsonLd";
import { buildHomeBody } from "./bodyBuilders";
import { getLatestElection } from "./dynamicRoutes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const PUBLIC_FOLDER = path.join(PROJECT_ROOT, "public");
const ELECTIONS_FILE = path.join(PROJECT_ROOT, "src/data/json/elections.json");

const homeBody = (() => {
  if (!fs.existsSync(ELECTIONS_FILE)) return "";
  try {
    const latest = getLatestElection(ELECTIONS_FILE);
    return buildHomeBody(PUBLIC_FOLDER, latest);
  } catch {
    return "";
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

const staticPage = (
  path: string,
  title: string,
  description: string,
  breadcrumbName: string,
  ogImage?: string,
  english?: { title: string; description: string; breadcrumbName: string },
): PrerenderRoute => {
  const url = `${SITE_URL}/${path}`;
  const enUrl = `${SITE_URL}/en/${path}`;
  return {
    path,
    title,
    description,
    ogImage,
    jsonLd: [
      buildWebPageLd({ title, description, url }),
      buildBreadcrumbLd([
        { name: "Начало", url: `${SITE_URL}/` },
        { name: breadcrumbName, url },
      ]),
    ],
    ...(english
      ? {
          english: {
            title: english.title,
            description: english.description,
            jsonLd: [
              buildWebPageLd({
                title: english.title,
                description: english.description,
                url: enUrl,
              }),
              buildBreadcrumbLd([
                { name: "Home", url: `${SITE_URL}/en/` },
                { name: english.breadcrumbName, url: enUrl },
              ]),
            ],
          },
        }
      : {}),
  };
};

export const prerenderRoutes: PrerenderRoute[] = [
  {
    path: "",
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    ogImage: "/og/home.png",
    bodyHtml: homeBody,
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
  staticPage(
    "sofia",
    "Резултати в София — Парламентарни избори | electionsbg.com",
    "Подробни резултати, обхват на машинното гласуване и отклонения по секции в трите столични района (23, 24 и 25 МИР).",
    "София",
    "/og/sofia.png",
    {
      title:
        "Sofia — Bulgarian Parliamentary Election Results | electionsbg.com",
      description:
        "Detailed results, machine-voting coverage, and section-level anomalies across the three Sofia electoral districts (MIR 23, 24, and 25).",
      breadcrumbName: "Sofia",
    },
  ),
  staticPage(
    "about",
    "За проекта — electionsbg.com",
    "За екипа, методологията и източниците на electionsbg.com — независима платформа за анализ на парламентарните избори в България.",
    "За проекта",
    "/og/about.png",
    {
      title: "About — electionsbg.com",
      description:
        "About the team, methodology, and data sources behind electionsbg.com — an independent platform analysing Bulgaria's parliamentary elections.",
      breadcrumbName: "About",
    },
  ),
  staticPage(
    "financing",
    "Финансиране на партии и предизборни кампании | electionsbg.com",
    "Декларирани приходи и разходи на политическите партии за всеки парламентарен вот — дарители, кандидати, медийни и други разходи.",
    "Финансиране",
    "/og/financing.png",
    {
      title:
        "Party and Campaign Financing — Bulgarian Parliamentary Elections | electionsbg.com",
      description:
        "Declared income and expenditures of Bulgarian political parties for each parliamentary vote — donors, candidates, and media spending.",
      breadcrumbName: "Financing",
    },
  ),
  staticPage(
    "simulator",
    "Симулатор на коалиции и разпределение на мандати | electionsbg.com",
    "Изследвайте как промяната на избирателния праг променя разпределението на 240-те мандата и кои коалиции могат да формират мнозинство от 121.",
    "Симулатор",
    "/og/simulator.png",
    {
      title: "Coalition and Seat-Allocation Simulator | electionsbg.com",
      description:
        "Explore how changes to the electoral threshold reshape the allocation of the 240 parliamentary seats and which coalitions can form a 121-vote majority.",
      breadcrumbName: "Simulator",
    },
  ),
  staticPage(
    "compare",
    "Сравнение на парламентарни избори в България | electionsbg.com",
    "Сравнете рамо до рамо два парламентарни вота — избирателна активност, дял на партиите, мандати и брой секции с отклонения.",
    "Сравнение",
    "/og/compare.png",
    {
      title: "Compare Bulgarian Parliamentary Elections | electionsbg.com",
      description:
        "Side-by-side comparison of any two parliamentary votes — turnout, party shares, seats, and section-level anomaly counts.",
      breadcrumbName: "Compare",
    },
  ),
  staticPage(
    "timeline",
    "Възход и падение на политическите партии в България | electionsbg.com",
    "Балонна времева линия на всичките 13 парламентарни вота от 2005 г. насам — размерът на балона показва получените гласове, цветът — партията.",
    "Времева линия",
    "/og/timeline.png",
    {
      title: "Rise and Fall of Bulgarian Political Parties | electionsbg.com",
      description:
        "Bubble timeline of all 13 parliamentary votes since 2005 — bubble size shows votes won, colour shows party.",
      breadcrumbName: "Timeline",
    },
  ),
];
