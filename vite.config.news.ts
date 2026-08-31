// Build config for the standalone news comparison app (news.electionsbg.com).
//
// Third Vite entry in the same repo, mirroring vite.config.ai.ts: root is
// ./newsapp, importing the shared design system straight from ./src via the `@/'
// alias (theme, ui components, Logo). The bundles produced by
// news/scripts/build_app_data.py are copied into the deploy under /news-data/;
// production may override that with the stable, manifest-backed GCS prefix.
// Dev/preview serves the local news/app-data/ directory directly.

import react from "@vitejs/plugin-react-swc";
import fs from "node:fs";
import path from "path";
import type { Connect, Plugin } from "vite";
import { applyHead, renderSitemap, writeRoute } from "./newsapp/prerender";
import { buildRoutes } from "./newsapp/prerenderRoutes";
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
  writeBundle: {
    sequential: true,
    handler() {
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
  },
});

// Copy the generated data bundles into the deploy. Building the bundles here (in
// this plugin) would duplicate the news:data step; instead build:news runs the
// python script first — a missing dir means a broken deploy, so fail loudly.
const copyNewsData = (): Plugin => ({
  name: "copy-news-data",
  apply: "build",
  enforce: "post",
  writeBundle: {
    sequential: true,
    handler() {
      if (!fs.existsSync(DATA_DIR)) {
        throw new Error(
          `${DATA_DIR} does not exist — run \`npm run news:data\` (or build:news) before building`,
        );
      }
      const dest = path.resolve(__dirname, "dist-news", "news-data");
      fs.cpSync(DATA_DIR, dest, { recursive: true });
    },
  },
});

const SITE = "https://news.electionsbg.com";

const ROBOTS_TXT = `User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
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
  writeBundle: {
    sequential: true,
    handler() {
      const out = path.resolve(__dirname, "dist-news");
      if (!fs.existsSync(out)) return;
      fs.writeFileSync(path.join(out, "robots.txt"), ROBOTS_TXT);
      fs.writeFileSync(path.join(out, "llms.txt"), LLMS_TXT);

      // ⚠️ PER-ROUTE <head>, and a sitemap generated from the corpus.
      //
      // Without this the catch-all rewrite served the SAME index.html at every
      // URL, so every story and outlet page carried the HOMEPAGE's title,
      // description and canonical — to a crawler, duplicates of the homepage.
      // And the sitemap was four hard-coded URLs, so a story added tonight was
      // invisible by omission with nothing to say so.
      const template = path.join(out, "index.html");
      if (!fs.existsSync(template)) {
        throw new Error(
          "prerender: dist-news/index.html is missing — nothing to derive a " +
            "per-route head from",
        );
      }
      const html = fs.readFileSync(template, "utf-8");
      const routes = buildRoutes(path.resolve(__dirname, "news", "app-data"));

      // ⚠️ VALIDATE BEFORE WRITING ANYTHING. The first cut wrote all 161 pages
      // and threw afterwards, which left a dist-news full of pages carrying the
      // homepage's head and NO sitemap.xml — and `deploy:news:fast` skips the
      // predeploy, so that tree was one command away from being published. The
      // template either matches or nothing is written.
      const probe = applyHead(html, routes[0]);
      if (probe.missing.length > 0) {
        throw new Error(
          "prerender: could not rewrite " +
            probe.missing.join(", ") +
            " — newsapp/index.html no longer matches newsapp/prerender.ts. " +
            "Nothing was written.",
        );
      }
      const missing = new Map<string, number>();
      for (const route of routes) {
        for (const tag of writeRoute(out, html, route)) {
          missing.set(tag, (missing.get(tag) ?? 0) + 1);
        }
      }
      // Belt and braces: a route-specific tag (og:image, present only when a
      // route carries an image) can still miss after the probe passed.
      if (missing.size > 0) {
        throw new Error(
          "prerender: could not rewrite " +
            [...missing].map(([t, n]) => `${t} (${n} routes)`).join(", "),
        );
      }
      fs.writeFileSync(path.join(out, "sitemap.xml"), renderSitemap(routes));
      const submitted = routes.filter((r) => r.sitemap !== false).length;
      console.log(
        `news prerender: ${routes.length} routes, ${submitted} in the sitemap`,
      );
    },
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
