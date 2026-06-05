// Build config for the standalone AI chat app (ai.electionsbg.com).
//
// Second Vite entry in the same repo: root is ./ai, but it imports the shared
// design system straight from ./src via the `@/` alias (theme, i18n, ui). Data
// is fetched from the same GCS bucket in prod; in dev/preview we overlay the
// local data/ dir exactly like the main app does.

import react from "@vitejs/plugin-react-swc";
import fs from "node:fs";
import path from "path";
import type { Connect, Plugin } from "vite";
import { defineConfig, loadEnv } from "vite";

const DATA_DIR = path.resolve(__dirname, "data");

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
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
  },
  configurePreviewServer(server) {
    server.middlewares.use(serveDataMiddleware);
  },
});

// publicDir copies ALL of public/ (parliament prerender, articles, images, og,
// sitemaps, llms…) into dist-ai. The chat needs almost none of it, so after the
// build we prune dist-ai down to the build outputs + the few static assets the
// AI index.html actually references. Keeps the deploy small + well under the
// Firebase file ceiling. (Dev still serves all of public/ via publicDir.)
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
const pruneDistAi = (): Plugin => ({
  name: "prune-dist-ai",
  apply: "build",
  closeBundle() {
    const out = path.resolve(__dirname, "dist-ai");
    if (!fs.existsSync(out)) return;
    for (const entry of fs.readdirSync(out)) {
      if (!KEEP.has(entry)) {
        fs.rmSync(path.join(out, entry), { recursive: true, force: true });
      }
    }
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  return {
    root: path.resolve(__dirname, "ai"),
    publicDir: path.resolve(__dirname, "public"),
    envDir: path.resolve(__dirname),
    define: {
      "process.env.API_KEY": JSON.stringify(env.GEMINI_API_KEY),
    },
    plugins: [react(), serveDataDir(), pruneDistAi()],
    resolve: {
      alias: { "@": path.resolve(__dirname, "./src") },
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
