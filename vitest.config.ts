import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import tsconfigPaths from "vite-tsconfig-paths";

// Vitest owns the unit + component layer (`npm run test:unit`). Playwright keeps
// the end-to-end / SEO / perf smoke layer (`npm test`); the two do not overlap.
//
// This config is deliberately standalone rather than merging the whole
// vite.config.ts. We want the two things the app config provides that tests
// need — the `@/*` alias (via vite-tsconfig-paths, reading the same tsconfig
// that the app build uses) and the React/SWC transform for `.tsx` component
// tests — but NOT the dev-only middleware plugins (serveDataDir, sqlBrowser,
// dbApi). Those mount live-Postgres and data-dir routes on the dev server and
// have no business in a hermetic test run.
//
// Environment split (Vitest 4 `projects`, since `environmentMatchGlobs` was
// removed): src/** runs in jsdom (component/hook tests via Testing Library),
// everything under scripts/** runs in node.
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    // Surface committed `.only` and empty files instead of silently passing.
    projects: [
      {
        extends: true,
        test: {
          name: "browser",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
          // jest-dom matchers + Testing Library auto-cleanup.
          setupFiles: ["./vitest.setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          // Covers scripts/** and the shared libs under scripts/**/lib. The
          // *.data.test.ts integration gates live here too; they auto-skip when
          // Postgres is unreachable, so a plain `npm run test:unit` stays green
          // without a database (see docs/testing-standards.md). When Postgres
          // IS up they run for real and pull large tables, so this project gets
          // a generous timeout (node:test, the previous runner, had none).
          include: ["scripts/**/*.test.ts"],
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
      // Enforce coverage on the modules we actually unit-test (see the doc: the
      // expectation is "cover new/changed modules", not a global percentage).
      include: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.harness.ts",
        "**/*.d.ts",
        "**/__fixtures__/**",
        "**/__mocks__/**",
        "scripts/**/tests/**",
      ],
    },
  },
});
