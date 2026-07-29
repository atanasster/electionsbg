import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import tseslint from "typescript-eslint";

// Shared so both the base block and the `ai/**` override can list it. In flat
// config a later block's rule entry REPLACES an earlier one rather than merging
// with it, so a rule defined only in the base block is silently dropped
// wherever an override redefines the same rule name.
const D3_UMBRELLA_BAN = {
  name: "d3",
  message:
    "Import the specific d3-* module (d3-geo, d3-ease, d3-sankey). The meta package re-exports every d3-*, which collapses the vendor-geo / vendor-charts chunk boundary and re-attaches all of recharts to every map route. It is also not installed, so this would only ever appear alongside an `npm i d3`.",
};
const D3_UMBRELLA_BAN_PATTERN = {
  group: ["d3", "d3/*"],
  message: D3_UMBRELLA_BAN.message,
};

export default tseslint.config(
  {
    ignores: [
      "dist",
      "dist.old-*",
      "dist-ai",
      "functions",
      ".claude",
      "ai/m0/.venv",
      "ai/m0/dist",
      "ai/m0/models",
      "ai/m5/dataset",
      "brand/posts",
    ],
  },
  {
    extends: [
      js.configs.recommended,
      eslintPluginPrettierRecommended,
      ...tseslint.configs.recommended,
    ],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [D3_UMBRELLA_BAN],
          patterns: [D3_UMBRELLA_BAN_PATTERN],
        },
      ],
    },
  },
  {
    // src/main.tsx AWAITS initI18n() before the first render: only the active
    // language's bundle is loaded, and react-i18next runs with
    // useSuspense: false, so there is no boundary that would retry a render
    // started without resources.
    //
    // Components calling useTranslation() are fine — they run after the render
    // begins. What breaks the invariant is a module calling t() at MODULE
    // SCOPE: the module evaluates while the entry executes, before initI18n()
    // resolves, so it captures an empty translation table and freezes a raw key
    // into a constant. Nothing throws; the label is just permanently wrong,
    // which is why this needs a static gate rather than a runtime one.
    //
    // `:not(:function CallExpression)` is what makes it precise — esquery's
    // `:function` covers function declarations, expressions and arrows, so
    // "module scope" is expressed structurally as "not inside any function
    // body" rather than approximated by indentation.
    //
    // Scoped to src/**: ai/** has its own module-scope-safe `t(bg, en)` helper
    // (see the ai/** block above) and must not trip this.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='t']:not(:function CallExpression)",
          message:
            "t() at module scope evaluates before initI18n() resolves and freezes a raw translation key into a constant — nothing throws, the label is just permanently wrong. Call it inside a component via useTranslation(), or take TFunction as a parameter.",
        },
        {
          selector:
            "CallExpression[callee.object.name='i18n'][callee.property.name='t']:not(:function CallExpression)",
          message:
            "i18n.t() at module scope — same reason as above: it runs before initI18n() resolves and captures an empty translation table.",
        },
      ],
    },
  },
  {
    // The AI site (`ai/`) is a separate, much smaller Vite build that does NOT
    // use i18next. It renders bilingual UI with a homegrown inline
    // `t(bg, en)` helper, so it must never import the main site's i18n stack
    // or the 844 KB of translation JSON behind it. Pulling in a `@/data/*`
    // React-Query hook is the usual way this regresses: those hooks call
    // `useTranslation`, which drags i18next + both translation.json files into
    // dist-ai AND breaks at runtime (the AI app never calls i18n.init(), so
    // useTranslation would silently render raw keys). Keep the boundary hard.
    files: ["ai/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            // Repeated from the base block: flat-config rule entries replace,
            // they do not merge, so omitting it here would drop the ban in ai/.
            D3_UMBRELLA_BAN,
            {
              name: "i18next",
              message:
                "The AI site does not use i18next — render bilingual text with an inline t(bg, en) helper (see ai/App.tsx).",
            },
            {
              name: "react-i18next",
              message:
                "The AI site does not use i18next — render bilingual text with an inline t(bg, en) helper (see ai/App.tsx).",
            },
            {
              name: "@/i18n",
              message:
                "Don't import the main site's i18n instance into the AI app — it pulls in 844 KB of translation JSON. Use an inline t(bg, en) helper.",
            },
          ],
          patterns: [
            D3_UMBRELLA_BAN_PATTERN,
            {
              group: ["@/data", "@/data/*", "@/data/**"],
              message:
                "AI tools fetch JSON directly (see ai/tools/) rather than reusing @/data React-Query hooks — those hooks call useTranslation, which would bundle i18next + the translation JSON into dist-ai and break at runtime.",
            },
            {
              group: ["@/locales/*", "@/locales/**", "src/locales/*"],
              message:
                "The AI site must not bundle the main site's translation JSON. Use an inline t(bg, en) helper.",
            },
          ],
        },
      ],
    },
  },
);
