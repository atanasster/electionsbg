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
};

export const SITE_URL = "https://electionsbg.com";
export const DEFAULT_OG_IMAGE = `${SITE_URL}/images/og_image.png`;

import {
  buildBreadcrumbLd,
  buildDatasetLd,
  buildOrganizationLd,
  buildWebPageLd,
  buildWebSiteLd,
} from "./jsonLd";

const HOME_TITLE =
  "Парламентарни избори в България — данни и анализ от 2005 | electionsbg.com";
const HOME_DESCRIPTION =
  "Платформа с отворен код за визуализация и анализ на резултатите от всички парламентарни избори в България от 2005 г. насам — по области, общини, населени места и секции.";

const staticPage = (
  path: string,
  title: string,
  description: string,
  breadcrumbName: string,
  ogImage?: string,
): PrerenderRoute => {
  const url = `${SITE_URL}/${path}`;
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
  };
};

export const prerenderRoutes: PrerenderRoute[] = [
  {
    path: "",
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    ogImage: "/og/home.png",
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
  },
  staticPage(
    "sofia",
    "Резултати в София — Парламентарни избори | electionsbg.com",
    "Подробни резултати, обхват на машинното гласуване и отклонения по секции в трите столични района (23, 24 и 25 МИР).",
    "София",
    "/og/sofia.png",
  ),
  staticPage(
    "about",
    "За проекта — electionsbg.com",
    "За екипа, методологията и източниците на electionsbg.com — независима платформа за анализ на парламентарните избори в България.",
    "За проекта",
    "/og/about.png",
  ),
  staticPage(
    "financing",
    "Финансиране на партии и предизборни кампании | electionsbg.com",
    "Декларирани приходи и разходи на политическите партии за всеки парламентарен вот — дарители, кандидати, медийни и други разходи.",
    "Финансиране",
    "/og/financing.png",
  ),
  staticPage(
    "simulator",
    "Симулатор на коалиции и разпределение на мандати | electionsbg.com",
    "Изследвайте как промяната на избирателния праг променя разпределението на 240-те мандата и кои коалиции могат да формират мнозинство от 121.",
    "Симулатор",
    "/og/simulator.png",
  ),
  staticPage(
    "compare",
    "Сравнение на парламентарни избори в България | electionsbg.com",
    "Сравнете рамо до рамо два парламентарни вота — избирателна активност, дял на партиите, мандати и брой секции с отклонения.",
    "Сравнение",
    "/og/compare.png",
  ),
  staticPage(
    "timeline",
    "Възход и падение на политическите партии в България | electionsbg.com",
    "Балонна времева линия на всичките 13 парламентарни вота от 2005 г. насам — размерът на балона показва получените гласове, цветът — партията.",
    "Времева линия",
    "/og/timeline.png",
  ),
];
