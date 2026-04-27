import react from "@vitejs/plugin-react-swc";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "path";
import { defineConfig, loadEnv } from "vite";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, ".", "");
  return {
    define: {
      "process.env.API_KEY": JSON.stringify(env.GEMINI_API_KEY),
    },
    plugins: [
      react(),
      tsconfigPaths(),
      {
        name: "gzip-json-preview-headers",
        configurePreviewServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url && /\.json(\?|$)/.test(req.url)) {
              res.setHeader("Content-Encoding", "gzip");
              res.setHeader("Content-Type", "application/json; charset=utf-8");
            }
            next();
          });
        },
      },
    ],
    build: {
      // Lift the warning threshold a bit since we still have some larger
      // domain-specific chunks (maps + jspdf) that are loaded on demand.
      chunkSizeWarningLimit: 800,
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
    },
  };
});
