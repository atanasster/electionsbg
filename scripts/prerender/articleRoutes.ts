// Per-article prerender routes for /articles/<slug> (BG default + /en/ mirror).
// Each article is enumerated from public/articles/index.json. The body is the
// full markdown article rendered to inline HTML — crawlers and AIO bots
// (GPTBot, ClaudeBot, Perplexity, all explicitly allowed in robots.txt) can
// read the actual content, not just a summary stub. SPA visitors still hit
// the React renderer; the inlined HTML lives in a hidden #ssg-content block.
//
// Per-article SEO/AIO metadata can also be authored as YAML frontmatter at
// the top of each `{slug}-{lang}.md` file:
//
//   ---
//   keywords: [parliament, integrity, anomalies]
//   updatedAt: 2026-05-06
//   author: Atanas Stoyanov
//   schemaType: NewsArticle
//   noindex: false
//   ---
//
// Frontmatter fields override the index.json defaults; missing fields fall
// through to the index.json values + the standard inferred keywords.

import fs from "fs";
import path from "path";
import { PrerenderRoute, SITE_URL } from "./routes";
import { buildArticleLd, buildBreadcrumbLd } from "./jsonLd";
import {
  ArticleImageDimensions,
  collectImageDimensions,
  Frontmatter,
  parseFrontmatter,
  renderMarkdownToHtml,
} from "./articleMarkdown";

type ArticleMeta = {
  slug: string;
  election?: string;
  publishedAt: string;
  updatedAt?: string;
  category?: string;
  title: { bg: string; en: string };
  summary: { bg: string; en: string };
  ogImage?: string;
};

type FrontmatterFields = {
  title?: string;
  description?: string;
  keywords?: string[];
  updatedAt?: string;
  author?: string;
  canonical?: string;
  noindex?: boolean;
  schemaType?: string;
  ogImage?: string;
};

const asString = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

const asStringList = (v: unknown): string[] | undefined => {
  if (Array.isArray(v)) {
    const arr = v
      .filter((x): x is string => typeof x === "string" && !!x.trim())
      .map((x) => x.trim());
    return arr.length ? arr : undefined;
  }
  if (typeof v === "string" && v.trim()) {
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return undefined;
};

const liftFrontmatter = (data: Frontmatter): FrontmatterFields => ({
  title: asString(data.title),
  description: asString(data.description) ?? asString(data.summary),
  keywords: asStringList(data.keywords),
  updatedAt: asString(data.updatedAt) ?? asString(data.dateModified),
  author: asString(data.author),
  canonical: asString(data.canonical),
  noindex: data.noindex === true,
  schemaType: asString(data.schemaType),
  ogImage: asString(data.ogImage) ?? asString(data.image),
});

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const buildArticleBody = (
  meta: ArticleMeta,
  lang: "bg" | "en",
  md: string,
  fm: FrontmatterFields,
  imageDimensions: ArticleImageDimensions,
): string => {
  const labels =
    lang === "bg"
      ? { published: "Публикувана", updated: "обновена" }
      : { published: "Published", updated: "updated" };

  const titleStr = fm.title ?? meta.title[lang];
  const summaryStr = fm.description ?? meta.summary[lang];
  const date = meta.publishedAt;
  const updated = fm.updatedAt ?? meta.updatedAt;

  const bodyHtml = renderMarkdownToHtml(md, {
    stripFirstH1: true,
    imageDimensions,
  });

  const dateLine =
    updated && updated !== date
      ? `<p><strong>${labels.published}:</strong> ${escapeHtml(date)} · <em>${labels.updated}: ${escapeHtml(updated)}</em></p>`
      : `<p><strong>${labels.published}:</strong> ${escapeHtml(date)}</p>`;

  return [
    `<h1>${escapeHtml(titleStr)}</h1>`,
    dateLine,
    summaryStr ? `<p><em>${escapeHtml(summaryStr)}</em></p>` : "",
    bodyHtml,
  ]
    .filter(Boolean)
    .join("\n");
};

const inferKeywords = (meta: ArticleMeta, lang: "bg" | "en"): string[] => {
  const base =
    lang === "bg"
      ? [
          "парламентарни избори",
          "България",
          "анализ на изборите",
          "интегритет на изборите",
        ]
      : [
          "Bulgarian elections",
          "parliamentary elections",
          "election integrity",
          "Bulgaria",
        ];
  if (meta.election) base.push(meta.election);
  if (meta.category) base.push(meta.category);
  return base;
};

const buildIndexBody = (articles: ArticleMeta[], lang: "bg" | "en"): string => {
  const labels =
    lang === "bg"
      ? {
          h1: "Анализи на данни",
          intro:
            "Задълбочен анализ на парламентарните избори в България — активност, разминавания между протокол и флаш памет, рискови махали, точност на социологията.",
        }
      : {
          h1: "Data Analysis",
          intro:
            "Long-form data analysis of Bulgarian parliamentary elections — turnout, machine flash discrepancies, risk neighborhoods, polling accuracy.",
        };

  const items = articles
    .map((a) => {
      const url =
        lang === "en"
          ? `${SITE_URL}/en/articles/${a.slug}`
          : `${SITE_URL}/articles/${a.slug}`;
      return `<li><a href="${url}"><strong>${escapeHtml(a.title[lang])}</strong></a> <em>(${escapeHtml(a.publishedAt)})</em><br/>${escapeHtml(a.summary[lang])}</li>`;
    })
    .join("\n");

  return [
    `<h1>${labels.h1}</h1>`,
    `<p>${labels.intro}</p>`,
    `<ul>${items}</ul>`,
  ].join("\n");
};

export const buildArticleRoutes = async (
  publicFolder: string,
): Promise<PrerenderRoute[]> => {
  const indexFile = path.join(publicFolder, "articles", "index.json");
  if (!fs.existsSync(indexFile)) return [];
  const articles: ArticleMeta[] = JSON.parse(
    fs.readFileSync(indexFile, "utf-8"),
  );

  // Pre-scan article images so the markdown renderer can stamp explicit
  // width/height on each <img> — prevents CLS when the prerendered shell
  // hands off to the SPA.
  const imageDimensions = await collectImageDimensions(
    publicFolder,
    "articles/images",
  );

  const routes: PrerenderRoute[] = [];

  // /articles index page (BG default + EN mirror).
  const indexBgUrl = `${SITE_URL}/articles`;
  const indexEnUrl = `${SITE_URL}/en/articles`;
  routes.push({
    path: "articles",
    title: "Анализи на данни — парламентарни избори | electionsbg.com",
    description:
      "Задълбочен анализ на парламентарните избори в България — активност, разминавания между протокол и флаш памет, рискови махали, точност на социологията.",
    bodyHtml: buildIndexBody(articles, "bg"),
    jsonLd: [
      buildBreadcrumbLd([
        { name: "Начало", url: `${SITE_URL}/` },
        { name: "Анализи", url: indexBgUrl },
      ]),
    ],
    english: {
      title:
        "Data Analysis — Bulgarian Parliamentary Elections | electionsbg.com",
      description:
        "Long-form data analysis of Bulgarian parliamentary elections — turnout, machine flash discrepancies, risk neighborhoods, polling accuracy.",
      bodyHtml: buildIndexBody(articles, "en"),
      jsonLd: [
        buildBreadcrumbLd([
          { name: "Home", url: `${SITE_URL}/en/` },
          { name: "Analyses", url: indexEnUrl },
        ]),
      ],
    },
  });

  for (const meta of articles) {
    const bgPath = path.join(publicFolder, "articles", `${meta.slug}-bg.md`);
    const enPath = path.join(publicFolder, "articles", `${meta.slug}-en.md`);
    const bgRaw = fs.existsSync(bgPath) ? fs.readFileSync(bgPath, "utf-8") : "";
    const enRaw = fs.existsSync(enPath) ? fs.readFileSync(enPath, "utf-8") : "";

    const { data: bgFmRaw, content: bgMd } = parseFrontmatter(bgRaw);
    const { data: enFmRaw, content: enMd } = parseFrontmatter(enRaw);
    const bgFm = liftFrontmatter(bgFmRaw);
    const enFm = liftFrontmatter(enFmRaw);

    const path_ = `articles/${meta.slug}`;
    const bgUrl = `${SITE_URL}/${path_}`;
    const enUrl = `${SITE_URL}/en/${path_}`;

    const bgBody = bgMd
      ? buildArticleBody(meta, "bg", bgMd, bgFm, imageDimensions)
      : "";
    const enBody = enMd
      ? buildArticleBody(meta, "en", enMd, enFm, imageDimensions)
      : "";

    const bgTitle = bgFm.title ?? meta.title.bg;
    const bgDescription = bgFm.description ?? meta.summary.bg;
    const enTitle = enFm.title ?? meta.title.en;
    const enDescription = enFm.description ?? meta.summary.en;
    const bgKeywords = bgFm.keywords ?? inferKeywords(meta, "bg");
    const enKeywords = enFm.keywords ?? inferKeywords(meta, "en");
    const ogImage = bgFm.ogImage ?? enFm.ogImage ?? meta.ogImage;
    const bgSchemaType = bgFm.schemaType;
    const enSchemaType = enFm.schemaType;

    routes.push({
      path: path_,
      title: `${bgTitle} | electionsbg.com`,
      description: bgDescription,
      ogImage,
      bodyHtml: bgBody,
      jsonLd: [
        buildArticleLd({
          headline: bgTitle,
          description: bgDescription,
          url: bgUrl,
          datePublished: meta.publishedAt,
          dateModified: bgFm.updatedAt ?? meta.updatedAt,
          author: bgFm.author,
          inLanguage: "bg",
          keywords: bgKeywords,
          articleSection: meta.category,
          image: ogImage,
          schemaType: bgSchemaType,
        }),
        buildBreadcrumbLd([
          { name: "Начало", url: `${SITE_URL}/` },
          { name: "Анализи", url: `${SITE_URL}/articles` },
          { name: bgTitle, url: bgUrl },
        ]),
      ],
      english: {
        title: `${enTitle} | electionsbg.com`,
        description: enDescription,
        bodyHtml: enBody,
        jsonLd: [
          buildArticleLd({
            headline: enTitle,
            description: enDescription,
            url: enUrl,
            datePublished: meta.publishedAt,
            dateModified: enFm.updatedAt ?? meta.updatedAt,
            author: enFm.author,
            inLanguage: "en",
            keywords: enKeywords,
            articleSection: meta.category,
            image: ogImage,
            schemaType: enSchemaType,
          }),
          buildBreadcrumbLd([
            { name: "Home", url: `${SITE_URL}/en/` },
            { name: "Analyses", url: `${SITE_URL}/en/articles` },
            { name: enTitle, url: enUrl },
          ]),
        ],
      },
    });
  }

  return routes;
};
