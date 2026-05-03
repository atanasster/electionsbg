// Per-article prerender routes for /articles/<slug> (BG default + /en/ mirror).
// Each article is enumerated from public/articles/index.json. The body is a
// curated SEO/AIO summary — title, summary, headline-numbers table, section
// TOC, and an inline link to the full article. The full markdown text is
// served separately via /articles/<slug>-{lang}.md and ingested by AI/LLM
// crawlers via /llms-full.txt.

import fs from "fs";
import path from "path";
import { PrerenderRoute, SITE_URL } from "./routes";
import { buildArticleLd, buildBreadcrumbLd } from "./jsonLd";

type ArticleMeta = {
  slug: string;
  election?: string;
  publishedAt: string;
  category?: string;
  title: { bg: string; en: string };
  summary: { bg: string; en: string };
  ogImage?: string;
};

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

// Strip markdown link syntax → keep just the visible text. Used for headings
// and table cells where we want crawlable text without the URL noise.
const stripMd = (s: string): string =>
  s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");

// Convert a markdown link to a safe anchor (only http(s) and root-relative
// paths are allowed; site-relative links are rebased onto SITE_URL so the
// extracted block makes sense in isolation).
const mdLinkToHtml = (text: string, url: string): string => {
  const safeText = escapeHtml(stripMd(text));
  let safeUrl = url.trim();
  if (safeUrl.startsWith("/")) safeUrl = `${SITE_URL}${safeUrl}`;
  if (!/^https?:\/\//.test(safeUrl)) {
    return safeText; // unknown scheme — drop the link, keep the text
  }
  return `<a href="${escapeHtml(safeUrl)}">${safeText}</a>`;
};

// Render a single markdown line's inline formatting (links, bold, italic,
// code) to HTML. Conservative: any unrecognised character is escaped.
const renderInline = (line: string): string => {
  let i = 0;
  const out: string[] = [];
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  let lastIndex = 0;
  while ((m = linkRe.exec(line)) !== null) {
    if (m.index > lastIndex) {
      out.push(renderInlineNoLinks(line.slice(lastIndex, m.index)));
    }
    out.push(mdLinkToHtml(m[1], m[2]));
    lastIndex = m.index + m[0].length;
    i = lastIndex;
  }
  if (i < line.length) {
    out.push(renderInlineNoLinks(line.slice(i)));
  }
  return out.join("");
};

const renderInlineNoLinks = (s: string): string => {
  // Bold → strong, italic → em, code → code. Escape the surrounding text.
  // Process bold first to avoid ** being treated as italic.
  const parts: string[] = [];
  let i = 0;
  const boldRe = /\*\*([^*]+)\*\*/g;
  let m: RegExpExecArray | null;
  while ((m = boldRe.exec(s)) !== null) {
    if (m.index > i) parts.push(applyItalicAndCode(s.slice(i, m.index)));
    parts.push(`<strong>${applyItalicAndCode(m[1])}</strong>`);
    i = m.index + m[0].length;
  }
  if (i < s.length) parts.push(applyItalicAndCode(s.slice(i)));
  return parts.join("");
};

const applyItalicAndCode = (s: string): string => {
  // First pass: code (escape contents). Then italic on the remainder.
  const codeParts: string[] = [];
  let i = 0;
  const codeRe = /`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = codeRe.exec(s)) !== null) {
    if (m.index > i) codeParts.push(applyItalic(s.slice(i, m.index)));
    codeParts.push(`<code>${escapeHtml(m[1])}</code>`);
    i = m.index + m[0].length;
  }
  if (i < s.length) codeParts.push(applyItalic(s.slice(i)));
  return codeParts.join("");
};

const applyItalic = (s: string): string => {
  const parts: string[] = [];
  let i = 0;
  const re = /(?:^|[^*])\*([^*]+)\*(?!\*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const startOffset = m[0].startsWith("*") ? 0 : 1;
    if (m.index + startOffset > i)
      parts.push(escapeHtml(s.slice(i, m.index + startOffset)));
    parts.push(`<em>${escapeHtml(m[1])}</em>`);
    i = m.index + m[0].length;
  }
  if (i < s.length) parts.push(escapeHtml(s.slice(i)));
  return parts.join("");
};

// Extract the first markdown table block following an h2/h3 whose name
// contains the given marker. Returns the rendered HTML table or null.
const extractFirstTable = (
  md: string,
  headingMarker: string,
): string | null => {
  const lines = md.split(/\r?\n/);
  let inTargetSection = false;
  const collected: string[] = [];
  let started = false;
  for (const raw of lines) {
    const line = raw;
    const h = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    if (h) {
      if (started) break; // hit next heading after collecting table
      inTargetSection = h[2]
        .toLowerCase()
        .includes(headingMarker.toLowerCase());
      continue;
    }
    if (!inTargetSection) continue;
    if (line.trim().startsWith("|")) {
      collected.push(line.trim());
      started = true;
    } else if (started && !line.trim()) {
      break;
    }
  }
  if (collected.length < 2) return null;
  // collected[0] = header, collected[1] = separator, rest = body rows
  const header = parseRow(collected[0]);
  const rows = collected.slice(2).map(parseRow);
  const thead = header.map((c) => `<th>${renderInline(c)}</th>`).join("");
  const tbody = rows
    .map(
      (r) => `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
};

const parseRow = (line: string): string[] => {
  const trimmed = line.replace(/^\||\|$/g, "");
  return trimmed.split("|").map((c) => c.trim());
};

// Extract h2 headings from the markdown for a TOC.
const extractH2Toc = (md: string): string[] => {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  for (const raw of lines) {
    const m = /^##\s+(.*)$/.exec(raw.trim());
    if (m) out.push(stripMd(m[1]));
  }
  return out;
};

// Extract the items in a numbered list following an h3 whose name contains
// the given marker. Stops at the next heading. Returns just the first
// sentence of each item (up to the first `.`, `—`, or `**`).
const extractTopOrderedItems = (
  md: string,
  headingMarker: string,
  max = 5,
): string[] => {
  const lines = md.split(/\r?\n/);
  let inTarget = false;
  const out: string[] = [];
  for (const raw of lines) {
    const h = /^(#{1,6})\s+(.*)$/.exec(raw.trim());
    if (h) {
      if (inTarget && out.length) break;
      inTarget = h[2].toLowerCase().includes(headingMarker.toLowerCase());
      continue;
    }
    if (!inTarget) continue;
    const m = /^\d+\.\s+(.*)$/.exec(raw.trim());
    if (m && out.length < max) {
      // Keep just the lead phrase up to the first em-dash or period to keep
      // the body compact.
      const lead = m[1].split(/—|\.\s/)[0];
      out.push(stripMd(lead));
    }
  }
  return out;
};

const buildArticleBody = (
  meta: ArticleMeta,
  lang: "bg" | "en",
  md: string,
): string => {
  const labels =
    lang === "bg"
      ? {
          published: "Публикувана",
          glossary: "Резюме",
          headline: "Основни числа",
          toc: "Съдържание",
          signals: "Сигнали, заслужаващи обществен контрол",
          readFull: "Прочети пълния анализ",
        }
      : {
          published: "Published",
          glossary: "Summary",
          headline: "Headline numbers",
          toc: "Contents",
          signals: "Signals worth public scrutiny",
          readFull: "Read the full analysis",
        };

  const articleUrl =
    lang === "en"
      ? `${SITE_URL}/en/articles/${meta.slug}`
      : `${SITE_URL}/articles/${meta.slug}`;

  const title = escapeHtml(meta.title[lang]);
  const summary = escapeHtml(meta.summary[lang]);
  const date = escapeHtml(meta.publishedAt);

  const headlineMarker = lang === "bg" ? "Основни числа" : "Headline numbers";
  const signalsMarker =
    lang === "bg"
      ? "Сигнали, заслужаващи обществен контрол"
      : "Signals worth public scrutiny";

  const headlineTable = extractFirstTable(md, headlineMarker);
  const tocItems = extractH2Toc(md);
  const signalLeads = extractTopOrderedItems(md, signalsMarker, 5);

  const tocHtml =
    tocItems.length > 0
      ? `<h2>${labels.toc}</h2><ol>${tocItems.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ol>`
      : "";

  const signalsHtml =
    signalLeads.length > 0
      ? `<h2>${labels.signals}</h2><ol>${signalLeads.map((s) => `<li>${renderInline(s)}</li>`).join("")}</ol>`
      : "";

  const headlineHtml = headlineTable
    ? `<h2>${labels.headline}</h2>${headlineTable}`
    : "";

  return [
    `<h1>${title}</h1>`,
    `<p><strong>${labels.published}:</strong> ${date}</p>`,
    `<h2>${labels.glossary}</h2>`,
    `<p>${summary}</p>`,
    headlineHtml,
    signalsHtml,
    tocHtml,
    `<p><a href="${articleUrl}">${labels.readFull}</a></p>`,
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

export const buildArticleRoutes = (publicFolder: string): PrerenderRoute[] => {
  const indexFile = path.join(publicFolder, "articles", "index.json");
  if (!fs.existsSync(indexFile)) return [];
  const articles: ArticleMeta[] = JSON.parse(
    fs.readFileSync(indexFile, "utf-8"),
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
    const bgMd = fs.existsSync(bgPath) ? fs.readFileSync(bgPath, "utf-8") : "";
    const enMd = fs.existsSync(enPath) ? fs.readFileSync(enPath, "utf-8") : "";

    const path_ = `articles/${meta.slug}`;
    const bgUrl = `${SITE_URL}/${path_}`;
    const enUrl = `${SITE_URL}/en/${path_}`;

    const bgBody = bgMd ? buildArticleBody(meta, "bg", bgMd) : "";
    const enBody = enMd ? buildArticleBody(meta, "en", enMd) : "";

    routes.push({
      path: path_,
      title: `${meta.title.bg} | electionsbg.com`,
      description: meta.summary.bg,
      ogImage: meta.ogImage,
      bodyHtml: bgBody,
      jsonLd: [
        buildArticleLd({
          headline: meta.title.bg,
          description: meta.summary.bg,
          url: bgUrl,
          datePublished: meta.publishedAt,
          inLanguage: "bg",
          keywords: inferKeywords(meta, "bg"),
          articleSection: meta.category,
          image: meta.ogImage,
        }),
        buildBreadcrumbLd([
          { name: "Начало", url: `${SITE_URL}/` },
          { name: "Анализи", url: `${SITE_URL}/articles` },
          { name: meta.title.bg, url: bgUrl },
        ]),
      ],
      english: {
        title: `${meta.title.en} | electionsbg.com`,
        description: meta.summary.en,
        bodyHtml: enBody,
        jsonLd: [
          buildArticleLd({
            headline: meta.title.en,
            description: meta.summary.en,
            url: enUrl,
            datePublished: meta.publishedAt,
            inLanguage: "en",
            keywords: inferKeywords(meta, "en"),
            articleSection: meta.category,
            image: meta.ogImage,
          }),
          buildBreadcrumbLd([
            { name: "Home", url: `${SITE_URL}/en/` },
            { name: "Analyses", url: `${SITE_URL}/en/articles` },
            { name: meta.title.en, url: enUrl },
          ]),
        ],
      },
    });
  }

  return routes;
};
