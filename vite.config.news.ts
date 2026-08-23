// Build config for the standalone news comparison app (news.electionsbg.com).
//
// Third Vite entry in the same repo, mirroring vite.config.ai.ts: root is
// ./newsapp, importing the shared design system straight from ./src via the `@/'
// alias (theme, ui components, Logo). Data is NOT fetched from the GCS bucket —
// the bundles produced by news/scripts/build_app_data.py are copied into the
// deploy under /news-data/ (overridable with VITE_NEWS_DATA_BASE_URL), and in
// dev/preview a middleware serves the local news/app-data/ dir directly.

import react from "@vitejs/plugin-react-swc";
import fs from "node:fs";
import path from "path";
import type { Connect, Plugin } from "vite";
import { defineConfig } from "vite";

const DATA_DIR = path.resolve(__dirname, "news", "app-data");
const MOUNT = "/news-data";

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
};

const serveNewsDataMiddleware: Connect.NextHandleFunction = (
  req,
  res,
  next,
) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  let url: string;
  try {
    url = decodeURIComponent((req.url ?? "").split("?")[0]);
  } catch {
    return next(); // malformed percent-encoding — fall through to 404
  }
  const relative = url.startsWith(MOUNT + "/") ? url.slice(MOUNT.length) : null;
  if (!relative) return next();
  const resolved = path.resolve(path.join(DATA_DIR, relative));
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

const serveNewsData = (): Plugin => ({
  name: "serve-news-data",
  configureServer(server) {
    server.middlewares.use(serveNewsDataMiddleware);
  },
  configurePreviewServer(server) {
    server.middlewares.use(serveNewsDataMiddleware);
  },
});

// publicDir copies ALL of public/ (prerendered pages, images, sitemaps…) into
// dist-news. The news app needs only the shell assets — same situation (and same
// fix) as vite.config.ai.ts's pruneDistAi. Runs BEFORE copyNewsData/writeSeoFiles
// (both enforced post), which re-add the deploy's own content afterwards.
const KEEP = new Set([
  "index.html",
  "assets",
  "fonts",
  "favicon.svg",
  "favicon.ico",
  "favicon-16x16.png",
  "favicon-32x32.png",
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
  "icon-512-maskable.png",
  "site.webmanifest",
]);
const pruneDistNews = (): Plugin => ({
  name: "prune-dist-news",
  apply: "build",
  closeBundle() {
    const out = path.resolve(__dirname, "dist-news");
    if (!fs.existsSync(out)) return;
    for (const entry of fs.readdirSync(out)) {
      if (!KEEP.has(entry)) {
        try {
          fs.rmSync(path.join(out, entry), { recursive: true, force: true });
        } catch {
          /* already gone — ignore */
        }
      }
    }
  },
});

// Copy the generated data bundles into the deploy. Building the bundles here (in
// this plugin) would duplicate the news:data step; instead build:news runs the
// python script first — a missing dir means a broken deploy, so fail loudly.
const copyNewsData = (): Plugin => ({
  name: "copy-news-data",
  apply: "build",
  enforce: "post",
  closeBundle() {
    if (!fs.existsSync(DATA_DIR)) {
      throw new Error(
        `${DATA_DIR} does not exist — run \`npm run news:data\` (or build:news) before building`,
      );
    }
    const dest = path.resolve(__dirname, "dist-news", "news-data");
    fs.cpSync(DATA_DIR, dest, { recursive: true });
  },
});

const SITE = "https://news.electionsbg.com";

const ROBOTS_TXT = `User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
`;

const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${["/", "/outlets", "/topics", "/methodology"]
  .map(
    (path) =>
      `  <url><loc>${SITE}${path}</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>`,
  )
  .join("\n")}
</urlset>
`;

const LLMS_TXT = `# Наясно Новини (news.electionsbg.com)

> Сравнение как българските медии отразяват едни и същи истории: спектър на
> пристрастията, позиция спрямо Русия, сигнали за ИИ-генерирано съдържание,
> теми и източници. Част от electionsbg.com.

## Какво показва
- Фийд с истории (клъстери от статии за едно и също събитие) с разпределение
  по пристрастие (консервативно ↔ прогресивно) и по позиция спрямо Русия
- "Слепи петна": истории, отразявани само от едната страна на спектъра
- Профили на източниците: тип, обхват, посещаемост, разпределения
- Теми по таксономия от 26 категории и 103 подтеми
- Анализ на статия: резюме (бг/ен), пристрастие + доказателства, ИИ-сигнали,
  субекти, тонове към партии

## Данни и метод
- Корпус: ~5 000 статии от 60 български медии, събирани автоматично
- Анализът е LLM-рубрика с детерминистична валидация (news/scripts/analyze_articles.py)
- Пълните текстове не се препубликуват — приложението сочи към източника

## Използване
- Приложение: ${SITE}/
- Данни (JSON): ${SITE}/news-data/stories.json, /news-data/latest.json,
  /news-data/outlets.json, /news-data/taxonomy.json, /news-data/stats.json
- Основен сайт: https://electionsbg.com
`;

const writeSeoFilesNews = (): Plugin => ({
  name: "write-seo-files-news",
  apply: "build",
  enforce: "post",
  closeBundle() {
    const out = path.resolve(__dirname, "dist-news");
    if (!fs.existsSync(out)) return;
    fs.writeFileSync(path.join(out, "robots.txt"), ROBOTS_TXT);
    fs.writeFileSync(path.join(out, "sitemap.xml"), SITEMAP_XML);
    fs.writeFileSync(path.join(out, "llms.txt"), LLMS_TXT);
  },
});

export default defineConfig({
  root: path.resolve(__dirname, "newsapp"),
  publicDir: path.resolve(__dirname, "public"),
  envDir: path.resolve(__dirname),
  plugins: [
    react(),
    serveNewsData(),
    pruneDistNews(),
    copyNewsData(),
    writeSeoFilesNews(),
  ],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
    // Force a single React instance, same as the main app and the AI app.
    dedupe: ["react", "react-dom"],
  },
  server: {
    port: 5190,
    fs: { allow: [path.resolve(__dirname)] },
  },
  build: {
    outDir: path.resolve(__dirname, "dist-news"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
});
