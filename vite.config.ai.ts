// Build config for the standalone AI chat app (ai.electionsbg.com).
//
// Second Vite entry in the same repo: root is ./ai, but it imports the shared
// design system straight from ./src via the `@/` alias (theme, i18n, ui). Data
// is fetched from the same GCS bucket in prod; in dev/preview we overlay the
// local data/ dir exactly like the main app does.

import react from "@vitejs/plugin-react-swc";
import fs from "node:fs";
import path from "path";
import type { Connect, Plugin, ResolvedConfig } from "vite";
import { defineConfig, loadEnv } from "vite";

import { dbApi } from "./vite/db-api";
import {
  assertAiOutput,
  AI_PUBLIC_ASSETS,
  copyAiPublicAssets,
  copyAiSeoImages,
  isAiPublicAsset,
} from "./vite/ai-public-assets";

const DATA_DIR = path.resolve(__dirname, "data");

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const serveDataMiddleware: Connect.NextHandleFunction = (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  const url = decodeURIComponent((req.url ?? "").split("?")[0]);
  const resolved = path.resolve(path.join(DATA_DIR, url));
  if (resolved !== DATA_DIR && !resolved.startsWith(DATA_DIR + path.sep)) {
    return next();
  }
  fs.stat(resolved, (err, stat) => {
    if (err || !stat.isFile()) return next();
    const ext = path.extname(resolved).toLowerCase();
    res.setHeader(
      "Content-Type",
      CONTENT_TYPES[ext] || "application/octet-stream",
    );
    res.setHeader("Cache-Control", "no-cache");
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(resolved).pipe(res);
  });
};

const serveDataDir = (): Plugin => ({
  name: "serve-data-dir-ai",
  configureServer(server) {
    server.middlewares.use(serveDataMiddleware);
    server.middlewares.use(serveAiPublicAssetMiddleware);
  },
  configurePreviewServer(server) {
    server.middlewares.use(serveDataMiddleware);
  },
});

// The main app's public/ tree contains its prerendered site and data symlinks.
// Giving that directory to Vite makes the AI build copy gigabytes only to
// delete them in closeBundle. Keep the AI package explicit and small instead.
const serveAiPublicAssetMiddleware: Connect.NextHandleFunction = (
  req,
  res,
  next,
) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  const relative = decodeURIComponent((req.url ?? "").split("?")[0]).replace(
    /^\/+/,
    "",
  );
  if (!isAiPublicAsset(relative)) return next();
  const resolved = path.resolve(__dirname, "public", relative);
  const publicRoot = path.resolve(__dirname, "public");
  if (!resolved.startsWith(`${publicRoot}${path.sep}`)) return next();
  fs.stat(resolved, (err, stat) => {
    if (err || !stat.isFile()) return next();
    res.setHeader(
      "Content-Type",
      CONTENT_TYPES[path.extname(resolved).toLowerCase()] ||
        "application/octet-stream",
    );
    res.setHeader("Cache-Control", "no-cache");
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(resolved).pipe(res);
  });
};

const resolvedBuildOutput = (config: ResolvedConfig): string =>
  path.resolve(config.root, config.build.outDir);

const copyRequiredAiAssets = (): Plugin => {
  let out = "";
  const publicRoot = path.resolve(__dirname, "public");
  return {
    name: "copy-required-public-assets-ai",
    apply: "build",
    configResolved(config) {
      out = resolvedBuildOutput(config);
    },
    closeBundle() {
      if (!fs.existsSync(out)) return;
      copyAiPublicAssets(publicRoot, out);
    },
  };
};

const KEEP = new Set(["index.html", "assets", ...AI_PUBLIC_ASSETS]);
const pruneDistAi = (): Plugin => {
  let out = "";
  return {
    name: "prune-dist-ai",
    apply: "build",
    configResolved(config) {
      out = resolvedBuildOutput(config);
    },
    closeBundle() {
      if (!fs.existsSync(out)) return;
      for (const entry of fs.readdirSync(out)) {
        if (!KEEP.has(entry)) {
          // A concurrent cleanup may already have removed the entry. Any other
          // filesystem error must fail packaging so undeclared output cannot ship.
          try {
            fs.rmSync(path.join(out, entry), { recursive: true, force: true });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
      }
    },
  };
};

const SITE = "https://ai.electionsbg.com";

// /evals benchmark page — built from the index.html shell (same JS bundle;
// main.tsx renders EvalsScreen when the path is /evals). Title/description below
// override the chat's <head> for correct per-page SEO/sharing.
const EVALS_TITLE = "Оценка на извикване на инструменти (EN/BG) — Наясно AI";
const EVALS_DESC =
  "Бенчмарк: може ли малък/отворен езиков модел да управлява инструментите на Наясно и влошава ли се изборът на инструмент на български спрямо английски.";

// /tools reference page — built from the same index.html shell (main.tsx mounts
// App with initialView="tools" for /tools). Per-page <head> for SEO/sharing.
const TOOLS_TITLE = "Инструменти и данни — какво може да отговори Наясно AI";
const TOOLS_DESC =
  "Пълен списък на детерминистичните инструменти зад Наясно AI — какво пресмята всеки, входните параметри и примерни въпроси. Всяко число идва от официалните данни, не е генерирано.";

const ROBOTS_TXT = `User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
`;

// Three indexable URLs: the chat at /, the Tools & data reference at /tools, and
// the /evals benchmark page. /tools and /evals are served via firebase rewrites
// to their own static shells (per-page <head>); see writeSeoFiles below.
const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>
  <url><loc>${SITE}/tools</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>
  <url><loc>${SITE}/evals</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>
</urlset>
`;

// llms.txt — the emerging convention that tells AI crawlers what the site is.
const LLMS_TXT = `# Наясно AI (ai.electionsbg.com)

> A free, bilingual (Bulgarian/English) chat answering questions about Bulgarian
> elections and governance. Every figure is computed deterministically from the
> official datasets at electionsbg.com — never generated by a language model.

## What it answers
- Parliamentary election results by party and election (2005–present)
- Voter turnout and machine-voting trends over time
- Election comparisons and per-region breakdowns
- Local (municipal) elections: councils, mayors, partial elections
- State budget, ministry budgets, EU funds, public procurement, government debt
- MPs & officials: asset declarations, company connections; governments since 2005
- Polling-agency accuracy; macro and sub-national indicators

## Data & method
- Source data: https://electionsbg.com (open data; code: https://github.com/atanasster/electionsbg)
- Numbers are computed by deterministic tools, not generated. The language layer
  only selects a tool and narrates the computed facts, so figures cannot be
  hallucinated.

## Use
- App: ${SITE}/
- Deep-link a question: ${SITE}/?q=<question>

## Example questions
- Какви са резултатите от последните избори?
- Как се променя избирателната активност от 2005 насам?
- Колко гласа взе ГЕРБ-СДС и къде е силна?
- За какво се харчи държавният бюджет?
- Коя социологическа агенция е най-точна?
`;

// Derive a per-page static shell from the built index.html: swap in a page's
// own <title>/description/canonical/OG so each route shares the one hashed JS
// bundle but still gets correct SEO + link previews. Optional `image` overrides
// the OG/Twitter image (omit to keep the default og.png).
//
// The metas in index.html are pretty-printed across multiple lines, so each
// replacer matches the whole element (`[^>]*` spans newlines) and rewrites it
// to a normalized single-line tag — a per-attribute `content="..."` regex would
// silently miss the multi-line ones and leave the chat's copy in place.
const derivePage = (
  indexHtml: string,
  page: { title: string; desc: string; canonical: string; image?: string },
): string => {
  const setMeta = (
    html: string,
    attr: "name" | "property",
    key: string,
    value: string,
  ): string =>
    html.replace(
      new RegExp(`<meta\\s+${attr}="${key}"[^>]*>`),
      () => `<meta ${attr}="${key}" content="${value}" />`,
    );

  let html = indexHtml
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${page.title}</title>`)
    .replace(
      /<link\s+rel="canonical"[^>]*>/,
      () => `<link rel="canonical" href="${page.canonical}" />`,
    );
  html = setMeta(html, "name", "description", page.desc);
  html = setMeta(html, "property", "og:url", page.canonical);
  html = setMeta(html, "property", "og:title", page.title);
  html = setMeta(html, "property", "og:description", page.desc);
  html = setMeta(html, "name", "twitter:title", page.title);
  html = setMeta(html, "name", "twitter:description", page.desc);
  if (page.image) {
    html = setMeta(html, "property", "og:image", page.image);
    html = setMeta(html, "name", "twitter:image", page.image);
  }
  return html;
};

// Write the SEO/AIO files into dist-ai after the prune (so they aren't removed)
// and copy the prebuilt OG image. robots/sitemap/llms are AI-app-specific, so
// they can't live in the shared public/ dir.
const writeSeoFiles = (): Plugin => {
  let out = "";
  return {
    name: "write-seo-files-ai",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      out = resolvedBuildOutput(config);
    },
    closeBundle() {
      if (!fs.existsSync(out)) return;
      fs.writeFileSync(path.join(out, "robots.txt"), ROBOTS_TXT);
      fs.writeFileSync(path.join(out, "sitemap.xml"), SITEMAP_XML);
      fs.writeFileSync(path.join(out, "llms.txt"), LLMS_TXT);
      copyAiSeoImages(path.resolve(__dirname, "ai/assets"), out);
      // Emit the per-page static shells from the built index.html — same hashed
      // JS bundle (main.tsx picks the screen/view by path), each with its own
      // <head>. Written here (post-prune) so pruneDistAi doesn't remove them;
      // served via the firebase.json rewrites (/evals, /tools).
      const indexPath = path.join(out, "index.html");
      if (fs.existsSync(indexPath)) {
        const indexHtml = fs.readFileSync(indexPath, "utf8");
        fs.writeFileSync(
          path.join(out, "evals.html"),
          derivePage(indexHtml, {
            title: EVALS_TITLE,
            desc: EVALS_DESC,
            canonical: `${SITE}/evals`,
            image: `${SITE}/evals-og.png`,
          }),
        );
        fs.writeFileSync(
          path.join(out, "tools.html"),
          derivePage(indexHtml, {
            title: TOOLS_TITLE,
            desc: TOOLS_DESC,
            canonical: `${SITE}/tools`,
            image: `${SITE}/tools-og.png`,
          }),
        );
      }
      assertAiOutput(out);
    },
  };
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  return {
    root: path.resolve(__dirname, "ai"),
    // Dev data has its own middleware; build assets are copied from the
    // allowlist above. Never traverse the main site's public/ tree here.
    publicDir: false,
    envDir: path.resolve(__dirname),
    define: {
      "process.env.API_KEY": JSON.stringify(env.GEMINI_API_KEY),
    },
    // dbApi mounts /api/db/* on the dev/preview server (same handlers as prod)
    // so migrated tools work locally; in the prod build the AI app reaches the
    // deployed function cross-origin via VITE_DB_API_ORIGIN instead.
    plugins: [
      react(),
      serveDataDir(),
      dbApi(),
      pruneDistAi(),
      copyRequiredAiAssets(),
      writeSeoFiles(),
    ],
    resolve: {
      alias: { "@": path.resolve(__dirname, "./src") },
      // Force a single React instance, same as the main app (vite.config.ts).
      // Without this the dev dep-optimizer can pull React in via two module
      // paths → "Invalid hook call — more than one copy of React", which blanks
      // the chat app and throws in ThemeContextProvider's useState.
      dedupe: ["react", "react-dom"],
    },
    server: {
      port: 5180,
      fs: { allow: [path.resolve(__dirname)] },
    },
    build: {
      outDir: path.resolve(__dirname, "dist-ai"),
      emptyOutDir: true,
      chunkSizeWarningLimit: 1200,
    },
  };
});
