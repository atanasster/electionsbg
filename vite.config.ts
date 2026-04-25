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

            // React core + anything that lives downstream of React's runtime
            // (router, scheduler, react-is, prop-types). Putting these
            // foundational deps in one chunk avoids circular-chunk warnings
            // since every UI library imports from this set.
            if (
              id.match(/[\\/]node_modules[\\/]react[\\/]/) ||
              id.match(/[\\/]node_modules[\\/]react-dom[\\/]/) ||
              id.includes("/react-router") ||
              id.includes("/scheduler") ||
              id.includes("/react-is") ||
              id.includes("/prop-types") ||
              id.includes("/use-sync-external-store")
            ) {
              return "vendor-react";
            }

            // Heavy deps that only specific routes need — split them out so
            // the landing page doesn't pay for them.
            if (id.includes("/leaflet") || id.includes("/react-leaflet")) {
              return "vendor-leaflet";
            }
            if (
              id.includes("/recharts") ||
              id.includes("/victory-vendor") ||
              id.includes("/d3-")
            ) {
              return "vendor-charts";
            }
            if (id.includes("/jspdf")) {
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
            if (id.includes("/@radix-ui/")) return "vendor-radix";
            if (id.includes("/@tanstack/")) return "vendor-query";

            // Everything else (lucide-react, clsx, vaul, cmdk, etc.).
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
