import react from "@vitejs/plugin-react-swc";
import tsconfigPaths from "vite-tsconfig-paths";
import fs from "node:fs";
import path from "path";
import type { Connect, Plugin } from "vite";
import { defineConfig, loadEnv } from "vite";
import { sqlBrowser } from "./vite/sql-browser";
import { dbApi } from "./vite/db-api";

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
    plugins: [
      react(),
      tsconfigPaths(),
      serveDataDir(),
      stripLazyCss(),
      // Dev-only SQL browser backend (/__sql/*). apply:"serve" keeps it out of
      // production builds and `vite preview`.
      sqlBrowser(),
      // Dev-only DB API backing the person page (/__db/*).
      dbApi(),
    ],
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
        // The Postgres-backed /api/db/* routes (procurement, prices, funds,
        // subsidies, …) are served same-origin in prod via a hosting rewrite,
        // but the Vite dev server has no such function locally. Proxy them to
        // the deployed backend (or a functions emulator via VITE_DB_API_PROXY)
        // so data-driven screens render in `npm run dev` without a local PG.
        "/api/db": {
          target: env.VITE_DB_API_PROXY || "https://electionsbg.com",
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
      // "On demand" is enforced, not merely intended: the entry-static-import
      // gate in tests/perf.spec.ts fails if one of them rejoins the critical
      // path. It read as true here for months while jspdf was in fact a static
      // import of the entry.
      chunkSizeWarningLimit: 800,
      modulePreload: {
        // Vite's default preloads every chunk reachable from the entry's
        // import graph. Trim the heavy route-only chunks out of the <head>
        // hint list so a landing page does not pay for them before its LCP.
        //
        // This filter is a HINT-level optimization only — it does not make a
        // chunk lazy. A chunk the entry *statically imports* is downloaded
        // whether or not it is preloaded; stripping its hint only costs a
        // round-trip. That is exactly what happened to vendor-pdf (see the
        // preload-helper rule below), and to vendor-charts / vendor-leaflet
        // until the home dashboard stopped being an eager import. As of T2.1
        // none of the chunks named here are reachable from the entry's static
        // graph, so the filter is a no-op for them; the entry-static-import
        // gate in tests/perf.spec.ts is the assertion that keeps it that way.
        //
        // vendor-editor is deliberately NOT in this pattern: it is not a static
        // import of the entry, so it never reaches the html dep list — and
        // keeping it out is what lets the perf.spec preload assertion for it
        // actually fail. For every chunk listed here the filter strips it
        // unconditionally, which makes the matching assertion tautological.
        //
        // Scoped to hostType "html" deliberately: the hook is also called for
        // each dynamic import's dependency list, and filtering there strips
        // the chunks from __vite__mapDeps, so a route that genuinely needs
        // jsPDF or recharts discovers it one serial round-trip late.
        resolveDependencies: (_filename, deps, { hostType }) =>
          hostType === "html"
            ? deps.filter(
                (d) =>
                  !/vendor-(pdf|leaflet|markdown|charts|flow)/.test(d) &&
                  !/exportToPDF-/.test(d),
              )
            : deps,
      },
      rollupOptions: {
        output: {
          manualChunks(id) {
            // Vite's __vitePreload helper is a VIRTUAL module
            // ("\0vite/preload-helper.js"), so it never matches the
            // node_modules guard below and Rollup parks it in whichever chunk
            // it happens to land in — historically vendor-pdf, which put jsPDF
            // + canvg (122 KB brotli) on the critical path of EVERY page:
            // every dynamic import in the app imports the helper, so the entry
            // statically imported the chunk it lives in. Pin it to the
            // foundational chunk that every other chunk already depends on.
            // Must stay ABOVE the node_modules guard — that guard is exactly
            // what let it drift.
            // The \0 prefix is Rollup's virtual-module marker and cannot occur
            // in a real filesystem path, so this cannot collide with a
            // first-party file under this repo's own vite/ directory
            // (vite/sql-browser.ts, vite/db-api.ts). Verified against Vite
            // 6.4.3: the id is exactly "\0vite/preload-helper.js". `includes`
            // rather than `===` so a suffix change does not break it.
            if (id.includes("\0vite/preload-helper")) return "vendor-react";

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
            // Geo projections, split out of the recharts subgraph below.
            // MUST stay above the broad `/d3-/` matcher, and must stay NARROW.
            //
            // Every map and choropleth in the app needs exactly geoMercator /
            // geoPath / geoBounds, but vendor-charts was the only non-leaflet
            // chunk holding d3-geo — so a geo-only route downloaded all of
            // recharts + lodash + victory-vendor (124 KB brotli) for three
            // functions.
            //
            // d3-array moves WITH d3-geo, and that is the whole trick:
            // victory-vendor/es/d3-array.js is `export * from "d3-array"`, not
            // an inlined copy, so it resolves to the same top-level module
            // d3-geo depends on. Left in vendor-charts the edge would point
            // vendor-geo -> vendor-charts and the map route would download
            // recharts anyway — a split that costs a chunk and saves nothing.
            // Moved, the edge is vendor-charts -> vendor-geo: one-directional.
            //
            // Do NOT widen this to d3-scale / d3-shape / d3-time: those are
            // the recharts half, and sweeping them in recreates a two-way
            // edge. internmap (d3-array's own dep) is tree-shaken out of the
            // reachable subgraph — only the bisect/sort/ticks family is live —
            // so vendor-geo comes out a true leaf today. That is incidental:
            // the invariant tests/perf.spec.ts guards is the one that costs
            // bytes, "no edge to vendor-charts", not "no edges at all".
            //
            // NB this also captures d3-sankey's nested d3-array@2 pin
            // (node_modules/d3-sankey/node_modules/d3-array/src/{max,min,sum}.js),
            // so vendor-geo is not strictly geo-only. Harmless — three trivial
            // functions, and vendor-charts -> vendor-geo already exists, so no
            // new edge — but it is why "deliberately narrow" is about the
            // package list, not about what npm nests underneath it.
            if (
              id.match(/[\\/]node_modules[\\/]d3-geo[\\/]/) ||
              id.match(/[\\/]node_modules[\\/]d3-array[\\/]/)
            ) {
              return "vendor-geo";
            }
            // Recharts pulls in a deep CJS subtree (lodash, react-smooth +
            // react-transition-group + dom-helpers, recharts-scale,
            // eventemitter3, tiny-invariant, fast-equals, decimal.js-light,
            // and the rest of the d3 family). If any of these leak into the
            // catch-all chunk, Rollup's split creates a circular import
            // between vendor-charts and vendor that surfaces in production
            // as "Cannot access 'X' before initialization". Keep the whole
            // recharts subgraph self-contained here. All listed packages
            // are recharts-only deps in this repo.
            //
            // The `d3` meta-package matcher below is a GUARD, not a
            // description: the package was removed in T3 (src imports
            // d3-geo / d3-ease / d3-sankey per-module) and is no longer
            // installed. If it ever returns it must land here rather than in
            // the catch-all, or vendor <-> vendor-charts closes into the cycle
            // described above.
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
            // The SQL browser's CodeMirror editor. /sql is a real production
            // route (backed by the hardened `sql` Cloud Function), and
            // routes.tsx lazy-loads the screen precisely so the editor stays
            // out of the initial download — but without this rule the
            // catch-all `vendor` return below swallows the whole family and
            // re-attaches ~156 KB brotli to the chunk every page preloads,
            // defeating that lazy boundary entirely.
            //
            // style-mod / w3c-keyname / crelt are listed for a SIZE reason,
            // not a cycle reason: they are CodeMirror-only deps in this tree
            // (`npm ls`), so leaving them out would strand them in the
            // always-preloaded catch-all and give back part of the saving.
            //
            // Cycle status: vendor-editor DOES statically import `vendor` —
            // @uiw/react-codemirror compiles against two @babel/runtime
            // helpers, which fall through to the catch-all. That edge is safe
            // only while it stays one-directional, so the invariant to
            // preserve is "`vendor` never imports `vendor-editor`": nothing
            // that falls through to the catch-all may re-export the CodeMirror
            // family. The `codemirror` meta package is matched below for
            // exactly that reason — it is installed (a dep of
            // @uiw/react-codemirror) and re-exports @codemirror/*, so the
            // documented `import { basicSetup } from "codemirror"` would
            // otherwise land in the catch-all and close the loop. Same patch
            // the vendor-charts rule above carries for the `d3` meta package;
            // see its comment for what breaking this looked like in
            // production. Enforced by the cycle gate in tests/perf.spec.ts.
            if (
              id.includes("/@codemirror/") ||
              id.match(/[\\/]node_modules[\\/]codemirror[\\/]/) ||
              id.includes("/@lezer/") ||
              // @uiw exists in this tree solely as the CodeMirror React
              // wrapper, so the namespace and the family are the same set —
              // matching it whole survives a wrapper renaming its subpackages.
              id.includes("/@uiw/") ||
              id.match(/[\\/]node_modules[\\/]style-mod[\\/]/) ||
              id.match(/[\\/]node_modules[\\/]w3c-keyname[\\/]/) ||
              id.match(/[\\/]node_modules[\\/]crelt[\\/]/)
            ) {
              return "vendor-editor";
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
