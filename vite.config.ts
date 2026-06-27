import react from "@vitejs/plugin-react-swc";
import tsconfigPaths from "vite-tsconfig-paths";
import fs from "node:fs";
import path from "path";
import type { Connect, Plugin } from "vite";
import { defineConfig, loadEnv } from "vite";

// In production we serve large/changing JSON from a GCS bucket via the
// `dataUrl` helper (see src/data/dataUrl.ts). The historical archives and
// per-domain data folders moved out of public/ into data/ so they don't
// get bundled into the Firebase Hosting deploy.
//
// Dev and `vite preview` still need to serve those files locally though,
// or every data fetch would 404. This plugin mounts data/ as a second
// "public dir" that overlays onto the dev/preview server at root.
const DATA_DIR = path.resolve(__dirname, "data");

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};

const serveDataMiddleware: Connect.NextHandleFunction = (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  const url = decodeURIComponent((req.url ?? "").split("?")[0]);
  // Reject path traversal attempts; resolve and then verify it's still
  // inside DATA_DIR.
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
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(resolved).pipe(res);
  });
};

const serveDataDir = (): Plugin => ({
  name: "serve-data-dir",
  configureServer(server) {
    server.middlewares.use(serveDataMiddleware);
  },
  configurePreviewServer(server) {
    server.middlewares.use(serveDataMiddleware);
  },
});

// Vite emits a `<link rel="stylesheet">` for every CSS chunk reachable from
// the entry import graph, including chunks loaded only by lazy/dynamic
// imports. For heavy "only used on a few routes" CSS (leaflet, charts, pdf,
// markdown), this turns into render-blocking bytes the landing page never
// uses. The dynamic `import("leaflet/dist/leaflet.css")` inside LeafletMap
// already tells Vite to bundle the CSS as a separate chunk and load it via
// runtime injection when the JS chunk loads — we just need to stop Vite
// from also injecting an eager stylesheet link in the prerendered HTML.
const stripLazyCss = (): Plugin => ({
  name: "strip-lazy-css",
  enforce: "post",
  transformIndexHtml(html) {
    return html.replace(
      /<link rel="stylesheet"[^>]*\/assets\/vendor-(leaflet|charts|pdf|markdown)[^>]*>\s*/g,
      "",
    );
  },
});

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, ".", "");
  return {
    define: {
      "process.env.API_KEY": JSON.stringify(env.GEMINI_API_KEY),
    },
    // Pre-bundle every Radix/UI primitive at server startup. Most of these are
    // only reachable through lazily-imported routes, so Vite would otherwise
    // discover them one-at-a-time as you navigate and re-run the dep optimizer
    // mid-session. Each re-optimization forces a full reload, and a reload that
    // races the swap can leave two React module instances live at once — which
    // surfaces as "Invalid hook call" / "Cannot read properties of null
    // (reading 'useMemo')" from deep inside a Radix component (e.g. <Select>).
    // Listing them here means they're optimized once, up front, alongside the
    // single deduped React, so no runtime re-optimization happens.
    optimizeDeps: {
      include: [
        "@radix-ui/react-accordion",
        "@radix-ui/react-avatar",
        "@radix-ui/react-checkbox",
        "@radix-ui/react-dialog",
        "@radix-ui/react-dropdown-menu",
        "@radix-ui/react-label",
        "@radix-ui/react-popover",
        "@radix-ui/react-select",
        "@radix-ui/react-separator",
        "@radix-ui/react-slot",
        "@radix-ui/react-switch",
        "@radix-ui/react-tabs",
        "@radix-ui/react-tooltip",
        "cmdk",
        // react-markdown + its remark/micromark/unified subtree are only
        // reached through the lazily-imported ArticleScreen (and the dashboard
        // party-assessment tile). Without pre-bundling, navigating to an
        // /articles/:slug page is the first time Vite sees this large subtree,
        // so it re-runs the dep optimizer mid-session — the same reload race
        // that blanks the app with "Invalid hook call" / "Cannot read
        // properties of null (reading 'useEffect')" from QueryClientProvider.
        "react-markdown",
        "remark-gfm",
        // d3-sankey is only reached through lazily-imported Sankey tiles
        // (budget flow, procurement flow, EU-funds, vote flow). Without
        // pre-bundling, the first navigation to one of those pages is when
        // Vite discovers it and re-runs the dep optimizer mid-session — the
        // reload race that 504s the dep chunk ("Outdated Optimize Dep") and
        // blanks the route with "Failed to fetch dynamically imported module".
        "d3-sankey",
      ],
    },
    plugins: [react(), tsconfigPaths(), serveDataDir(), stripLazyCss()],
    server: {
      // Honor a PORT env var when one is set (e.g. a preview/dev harness that
      // assigns a free port), otherwise fall back to Vite's default 5173.
      port: process.env.PORT ? Number(process.env.PORT) : undefined,
      // The public scenario tally (functions/index.js `scenarios`) is reached
      // same-origin via the /api/scenarios hosting rewrite in prod; in dev,
      // proxy to the deployed function so the card works on localhost too.
      // Point VITE_SCENARIOS_PROXY at the emulator when testing locally
      // (http://127.0.0.1:5001 with the function's full path).
      proxy: {
        "/api/scenarios": {
          target: env.VITE_SCENARIOS_PROXY || "https://electionsbg.com",
          changeOrigin: true,
        },
      },
      // dist/ and dist.old-* are build artifacts. The dev server never serves
      // from them, but chokidar (Vite's file watcher) sees them by default
      // and every file event there falls through to Vite's "unknown file
      // change → full page reload" fallback. The prebuild script renames
      // dist/ → dist.old-<ts>/ and forks a detached rm -rf, so a single
      // `npm run build` triggers thousands of delete events that storm the
      // dev server with full reloads for minutes. Exclude both from the
      // watcher so dev is unaffected by parallel builds.
      watch: {
        ignored: ["**/dist/**", "**/dist.old-*/**"],
      },
    },
    build: {
      // Lift the warning threshold a bit since we still have some larger
      // domain-specific chunks (maps + jspdf) that are loaded on demand.
      chunkSizeWarningLimit: 800,
      modulePreload: {
        // Vite's default preloads every chunk reachable from the entry's
        // import graph, including async deps. That pulls jspdf, leaflet,
        // recharts, and react-markdown into the initial download — none of
        // which are needed for the LCP element on most landing pages.
        // Filter them out so the browser fetches them only when the route
        // that actually needs them is loaded.
        resolveDependencies: (_filename, deps) =>
          deps.filter(
            (d) =>
              !/vendor-(pdf|leaflet|markdown|charts|flow)/.test(d) &&
              !/exportToPDF-/.test(d),
          ),
      },
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;

            // Foundational chunk. React + tiny utility packages (clsx,
            // class-variance-authority, tslib) that downstream chunks reach
            // for. Keeping them here means no other split chunk needs to
            // import from the catch-all `vendor`, which would create a
            // cycle.
            if (
              id.match(/[\\/]node_modules[\\/]react[\\/]/) ||
              id.match(/[\\/]node_modules[\\/]react-dom[\\/]/) ||
              id.includes("/react-router") ||
              id.includes("/scheduler") ||
              id.includes("/react-is") ||
              id.includes("/prop-types") ||
              id.includes("/use-sync-external-store") ||
              id.match(/[\\/]node_modules[\\/]clsx[\\/]/) ||
              id.includes("/class-variance-authority") ||
              id.match(/[\\/]node_modules[\\/]tslib[\\/]/)
            ) {
              return "vendor-react";
            }

            // Heavy deps that only specific routes need — split them out so
            // the landing page doesn't pay for them.
            if (
              id.match(/[\\/]node_modules[\\/]leaflet[\\/]/) ||
              id.match(/[\\/]node_modules[\\/]react-leaflet[\\/]/) ||
              id.includes("/@react-leaflet/")
            ) {
              return "vendor-leaflet";
            }
            // Recharts pulls in a deep CJS subtree (lodash, react-smooth +
            // react-transition-group + dom-helpers, recharts-scale,
            // eventemitter3, tiny-invariant, fast-equals, decimal.js-light,
            // and the d3 family — including the `d3` meta package that
            // re-exports from every `d3-*`). If any of these leak into the
            // catch-all chunk, Rollup's split creates a circular import
            // between vendor-charts and vendor that surfaces in production
            // as "Cannot access 'X' before initialization". Keep the whole
            // recharts subgraph self-contained here. All listed packages
            // are recharts-only deps in this repo.
            if (
              id.includes("/recharts") ||
              id.includes("/recharts-scale") ||
              id.includes("/victory-vendor") ||
              id.includes("/react-smooth") ||
              id.includes("/react-transition-group") ||
              id.includes("/dom-helpers") ||
              id.includes("/d3-") ||
              id.match(/[\\/]node_modules[\\/]d3[\\/]/) ||
              id.includes("/lodash/") ||
              id.match(/[\\/]node_modules[\\/]lodash[\\/]/) ||
              id.includes("/eventemitter3") ||
              id.includes("/tiny-invariant") ||
              id.includes("/fast-equals") ||
              id.includes("/decimal.js-light")
            ) {
              return "vendor-charts";
            }
            if (id.includes("/jspdf") || id.includes("/canvg")) {
              return "vendor-pdf";
            }
            // React Flow + its small deps — only the /data/map route needs
            // them; keep them out of the always-loaded catch-all vendor.
            if (
              id.includes("/@xyflow/") ||
              id.match(/[\\/]node_modules[\\/]zustand[\\/]/) ||
              id.includes("/classcat")
            ) {
              return "vendor-flow";
            }
            if (
              id.includes("/react-markdown") ||
              id.includes("/remark-") ||
              id.includes("/micromark") ||
              id.includes("/mdast-") ||
              id.includes("/unified") ||
              id.includes("/hast-")
            ) {
              return "vendor-markdown";
            }

            // Always-loaded but logically grouped deps.
            if (id.includes("/fuse.js")) return "vendor-search";
            if (id.includes("/i18next") || id.includes("/react-i18next")) {
              return "vendor-i18n";
            }
            // Radix family. Bundle the wrappers (cmdk, vaul) and the
            // radix-only support deps (aria-hidden, react-remove-scroll +
            // family, @floating-ui/*) here so radix doesn't have to reach
            // into the catch-all vendor chunk.
            if (
              id.includes("/@radix-ui/") ||
              id.includes("/@floating-ui/") ||
              id.match(/[\\/]node_modules[\\/]cmdk[\\/]/) ||
              id.match(/[\\/]node_modules[\\/]vaul[\\/]/) ||
              id.includes("/aria-hidden") ||
              id.includes("/react-remove-scroll") ||
              id.includes("/react-style-singleton") ||
              id.includes("/use-callback-ref") ||
              id.includes("/use-sidecar") ||
              id.includes("/get-nonce") ||
              id.includes("/detect-node-es")
            ) {
              return "vendor-radix";
            }
            if (id.includes("/@tanstack/")) return "vendor-query";

            // Everything else (lucide-react, tailwind-merge, react-ga4, …).
            return "vendor";
          },
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      // Force a single React instance. Without this the dev dep-optimizer can
      // pull React in via two module paths ("Invalid hook call — more than one
      // copy of React"), blanking the app in `npm run dev`.
      dedupe: ["react", "react-dom"],
    },
  };
});
